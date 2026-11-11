// The empty paragraph Return opens, and the record of Returns (design: block editing, "The empty
// paragraph" and "Taking a Return back").
//
// Markdown can't hold an empty paragraph, so the one Return opens exists only while the caret is in
// it, or in the block Return was pressed in: type and it is a paragraph, leave it and it goes, and
// the file never gets it. Everything that reads the document for the file reads `textWithoutOpen`,
// the text as if it had been taken back.
//
// The record keeps the last Returns pressed one after the other, each with the exact changes that
// undo it, so that Backspace right after a Return takes it back byte for byte (`takeBack`), and so
// that leaving the empty paragraph takes back the Returns that opened it, outside the history, which
// then drops their steps: ⌘Z after that undoes what came before them. Any other edit ends the record;
// the empty paragraph then goes as an ordinary edit of its own, which ⌘Z brings back.

import { isolateHistory } from '@codemirror/commands';
import { syntaxTree } from '@codemirror/language';
import {
  Annotation,
  type ChangeDesc,
  ChangeSet,
  EditorSelection,
  EditorState,
  type Extension,
  type Line,
  Prec,
  StateEffect,
  StateField,
  type Text,
  Transaction,
  type TransactionSpec,
} from '@codemirror/state';
import { EditorView, ViewPlugin } from '@codemirror/view';
import { EditError, reject } from '@redlines/format';
import type { ViewMode } from '../api.ts';
import { lineChanges } from '../diff.ts';
import { doneDepth, dropStepsEffect } from '../history/index.ts';
import { visibleSelection } from '../tracked/decorations.ts';
import {
  parsedField,
  setViewModeEffect,
  trackedEditAnnotation,
  viewModeField,
} from '../tracked/field.ts';
import { unsoundEmptyLine } from './empty-item.ts';
import { BLANK } from './hidden.ts';
import { blockAt, isGapLine, loose, type Span } from './structure.ts';

/** The empty paragraph, or the empty line, that Return opened, while it is open. */
export interface OpenBlock {
  /** Its line, from start to end: empty, or a container's syntax alone (`> `, an item's indent). */
  empty: Span;
  /** The lines of the block Return was pressed in, where the caret may be while it stays open. */
  pressedIn: Span | null;
  /**
   * An empty list item that Markdown can't hold at its level (`empty-item.ts`), open as an empty
   * paragraph is: its line is the item's, marker and all, left out of the file with its line break.
   */
  item?: true;
}

/** What one Return did, kept so that it can be taken back exactly. */
export interface Taken {
  /** The changes that undo it, from the document after it to the one before. */
  changes: ChangeSet;
  /** The view it switched from, as a split switches Clean to Redlines; null when it didn't. */
  view: ViewMode | null;
  /** The selection before it, which taking it back gives back. */
  before: EditorSelection;
  /** Where it left the caret: Backspace takes it back only from there. */
  caret: number;
  /** The open block before it, which taking it back gives back. */
  openBefore: OpenBlock | null;
  /** Whether it opened the empty block (there was none before it). */
  opened: boolean;
  /** Whether its step in the history is joined to the one before it (a Return over a selection). */
  joined: boolean;
  /** How many steps were done before it, to take the history back to (`dropStepsEffect`). */
  depth: number;
}

/** Where a key's transaction leaves the open block, in its start document's offsets. */
export interface OpenRequest {
  /** A position on the open block's line, mapped through the transaction with `assoc`. */
  at: number;
  assoc: -1 | 1;
  /** How many lines above that position the open block's line is. */
  up?: number;
  /**
   * How many lines below `at` the open block's line is, `at` mapped to the start of the text the
   * key inserts there (`assoc` is then not used). For a key at the end of a document: the ledger
   * the tracked layer appends there goes after the key's text, and mapping `at` forward would
   * land past it.
   */
  down?: number;
  /** The block Return was pressed in, where the caret may be while it stays open. */
  pressedIn?: Span | null;
  /** The line is an empty item's, not an empty paragraph's. */
  item?: true;
}

/** Marks a key's transaction that opens (or keeps) the empty block, and where. */
export const openAnnotation = Annotation.define<OpenRequest>();

/** Marks a Return, whose transaction the record keeps. */
export const returnAnnotation = Annotation.define<true>();

/**
 * Marks a take-back of Returns. One that goes in outside the history (`addToHistory: false`) the
 * history's guard leaves out of the changes made outside it (`history/guard.ts`), since it maps the
 * steps of the Returns it takes back to nothing; one that is a step of its own is named for typing
 * (`history/names.ts`).
 */
export const takeBackAnnotation = Annotation.define<true>();

/** Sets the open block, or closes it: for tests, a reload and the take-backs. */
export const setOpenEffect = StateEffect.define<OpenBlock | null>({
  map: (open, mapping) => (open ? mapOpen(open, mapping) : null),
});

/** Takes the last Return out of the record (Backspace took it back). */
const poppedEffect = StateEffect.define<null>();

/** Ends the record. */
const endRecordEffect = StateEffect.define<null>();

/**
 * Whether a mouse button is down in the editor: a take-back waits for the selection to end.
 * Exported for tests, which can't press a button in CodeMirror under happy-dom.
 */
export const pointerEffect = StateEffect.define<boolean>();

const pointerField = StateField.define<boolean>({
  create: () => false,
  update: (down, tr) => tr.effects.findLast((e) => e.is(pointerEffect))?.value ?? down,
});

/** The open block through a change, or null when the change took its line apart. */
function mapOpen(open: OpenBlock, mapping: ChangeDesc): OpenBlock | null {
  let touched = false;
  mapping.iterChangedRanges((from, to) => {
    if (from <= open.empty.to && to >= open.empty.from) touched = true;
  });
  if (touched) return null;
  const empty = { from: mapping.mapPos(open.empty.from, 1), to: mapping.mapPos(open.empty.to, -1) };
  // Text typed at the start of the block Return was pressed in (as Return at its start leaves the
  // caret there) is in that block.
  const pressedIn = open.pressedIn && {
    from: mapping.mapPos(open.pressedIn.from, -1),
    to: mapping.mapPos(open.pressedIn.to, 1),
  };
  return {
    empty,
    pressedIn: pressedIn && pressedIn.from <= pressedIn.to ? pressedIn : null,
    ...(open.item ? { item: true as const } : {}),
  };
}

/** The blocks whose blank lines are content: no empty paragraph opens in them. */
const HOLDERS = new Set([
  'FencedCode',
  'CodeBlock',
  'HTMLBlock',
  'CommentBlock',
  'ProcessingInstructionBlock',
  'FrontMatter',
]);

type SyntaxNode = ReturnType<typeof syntaxTree>['topNode'];

function inHolder(state: EditorState, pos: number): boolean {
  for (
    let node: ReturnType<typeof syntaxTree>['topNode'] | null = syntaxTree(state).resolveInner(
      pos,
      1,
    );
    node;
    node = node.parent
  ) {
    if (HOLDERS.has(node.name)) return true;
  }
  return false;
}

/** Whether a line is blank for a reader: white space and quote markers, or markers alone. */
const gap = (state: EditorState, line: Line) => isGapLine(state, line);

/**
 * The empty paragraph the caret is on, if it is one: an empty line (or a container's syntax alone)
 * with a blank line, or the document's edge, on either side, outside the blocks whose blank lines
 * are content. An empty document is one empty paragraph.
 */
function emptyParagraphAt(state: EditorState): OpenBlock | null {
  const { main } = state.selection;
  if (!main.empty || state.field(viewModeField, false) === 'raw') return null;
  const { doc } = state;
  const line = doc.lineAt(main.head);
  if (!BLANK.test(line.text) || inHolder(state, line.from)) return null;
  const blankAt = (n: number) => n < 1 || n > doc.lines || gap(state, doc.line(n));
  if (!blankAt(line.number - 1) || !blankAt(line.number + 1)) return null;
  return { empty: { from: line.from, to: line.to }, pressedIn: null };
}

/**
 * The empty paragraph right above the block the caret is in, when ⌘Z or ⇧⌘Z has just put it back
 * (a Return at a block's start, taken back, and Undone: the caret is in the block under it, where
 * the Return left it), opened as the Return opened it.
 */
function emptyParagraphAbove(tr: Transaction): OpenBlock | null {
  if (!tr.isUserEvent('undo') && !tr.isUserEvent('redo')) return null;
  const { state } = tr;
  const { main } = state.selection;
  if (!main.empty || state.field(viewModeField, false) === 'raw') return null;
  const { doc } = state;
  const block = blockAt(state, main.head);
  if (!block) return null;
  const first = doc.lineAt(block.lines.from).number;
  const line = first >= 3 ? doc.line(first - 2) : null;
  if (!line || !BLANK.test(line.text) || inHolder(state, line.from)) return null;
  if (
    !gap(state, doc.line(first - 1)) ||
    (line.number > 1 && !gap(state, doc.line(line.number - 1)))
  ) {
    return null;
  }
  let touched = false;
  tr.changes.iterChangedRanges((_a, _b, fromB, toB) => {
    if (fromB <= line.to + 1 && toB >= line.from - 1) touched = true;
  });
  if (!touched) return null;
  return {
    empty: { from: line.from, to: line.to },
    pressedIn: { from: block.lines.from, to: block.lines.to },
  };
}

/**
 * The empty item Markdown can't hold that the caret is on after ⌘Z or ⇧⌘Z has put it back (the Tab
 * that made it, undone and redone): open again, since the file must not get it.
 */
function emptyItemAt(tr: Transaction): OpenBlock | null {
  if (!tr.isUserEvent('undo') && !tr.isUserEvent('redo')) return null;
  const { state } = tr;
  const { main } = state.selection;
  if (!main.empty || state.field(viewModeField, false) === 'raw') return null;
  const line = state.doc.lineAt(main.head);
  if (!unsoundEmptyLine(state.doc, line.number) || inHolder(state, line.from)) return null;
  return { empty: { from: line.from, to: line.to }, pressedIn: null, item: true };
}

/** The line of the new document a key's open request names (`OpenRequest`). */
export function requestedLine(tr: Transaction, request: OpenRequest): Line {
  const doc = tr.newDoc;
  if (request.down !== undefined) {
    const at = tr.changes.mapPos(request.at, -1);
    return doc.line(Math.min(doc.lines, doc.lineAt(at).number + request.down));
  }
  const at = tr.changes.mapPos(request.at, request.assoc);
  return doc.line(Math.max(1, doc.lineAt(at).number - (request.up ?? 0)));
}

/** The open block a key asked for, in the transaction's new document. */
function requested(tr: Transaction, request: OpenRequest): OpenBlock | null {
  const line = requestedLine(tr, request);
  if (request.item) {
    return { empty: { from: line.from, to: line.to }, pressedIn: null, item: true };
  }
  if (!gap(tr.state, line)) return null;
  let pressedIn: Span | null = null;
  if (request.pressedIn) {
    const from = tr.changes.mapPos(request.pressedIn.from, 1);
    const to = tr.changes.mapPos(request.pressedIn.to, -1);
    if (from <= to && (to < line.from || from > line.to)) pressedIn = { from, to };
  }
  return { empty: { from: line.from, to: line.to }, pressedIn };
}

/** The empty paragraph or line that is open, if any. */
export const openBlockField = StateField.define<OpenBlock | null>({
  create: () => null,
  update(open, tr) {
    const set = tr.effects.findLast((effect) => effect.is(setOpenEffect));
    if (set) return set.value;
    if (tr.state.field(viewModeField, false) === 'raw') return null;
    const request = tr.annotation(openAnnotation);
    if (request && tr.docChanged) return requested(tr, request);
    if (!tr.docChanged) {
      // A selection that moves onto an empty paragraph of the record's (⌘Z after a take-back puts
      // it there with a change) is found below; a caret that only moves keeps what is open.
      return open;
    }
    if (open) {
      const mapped = mapOpen(open, tr.changes);
      if (mapped) return mapped;
    }
    // A change that leaves the caret on an empty line between blank lines opens it: ⌘Z of typing
    // in it, of a take-back, deleting all of a paragraph's text.
    if (tr.annotation(Transaction.remote)) return null;
    return emptyParagraphAt(tr.state) ?? emptyParagraphAbove(tr) ?? emptyItemAt(tr);
  },
});

/** The record of the last Returns pressed one after the other. */
export const recordField = StateField.define<readonly Taken[]>({
  create: () => [],
  update(record, tr) {
    for (const effect of tr.effects) {
      if (effect.is(endRecordEffect)) return [];
      if (effect.is(poppedEffect)) return record.slice(0, -1);
    }
    if (tr.annotation(returnAnnotation) && tr.docChanged) {
      const view = tr.startState.field(viewModeField, false) ?? null;
      const now = tr.state.field(viewModeField, false) ?? null;
      const openBefore = tr.startState.field(openBlockField, false) ?? null;
      const openAfter = tr.state.field(openBlockField, false) ?? null;
      return [
        ...record,
        {
          changes: tr.changes.invert(tr.startState.doc),
          view: view !== now ? view : null,
          before: tr.startState.selection,
          caret: tr.newSelection.main.head,
          openBefore,
          opened: openBefore === null && openAfter !== null,
          joined: tr.annotation(isolateHistory) === 'after',
          depth: doneDepth(tr.startState),
        },
      ];
    }
    // Any other edit ends it: typing, a command, a decision, an agent's edit.
    return tr.docChanged ? [] : record;
  },
});

/** The open block, if any. */
export function openBlock(state: EditorState): OpenBlock | null {
  return state.field(openBlockField, false) ?? null;
}

/** The Returns that opened the open block, from the record, last first; null if it has none. */
function openers(state: EditorState): readonly Taken[] | null {
  const open = openBlock(state);
  const record = state.field(recordField, false) ?? [];
  if (!open || !record.length) return null;
  const first = record.findLastIndex((taken) => taken.opened);
  return first < 0 ? null : record.slice(first).reverse();
}

/**
 * The changes that take the open block away without a record: its line and a blank line beside
 * it, with the line break between them, or null when it can't go plainly (a marker on its line).
 */
function removal(state: EditorState, open: OpenBlock): ChangeSet | null {
  const { doc } = state;
  const line = doc.lineAt(open.empty.from);
  if (open.item) return itemRemoval(state, line);
  if (!BLANK.test(line.text)) return null;
  const plainBlank = (n: number) => n >= 1 && n <= doc.lines && BLANK.test(doc.line(n).text);
  const n = line.number;
  const tight = tightListAround(state, line);
  if (tight) return state.changes(tight);
  const other = plainBlank(n - 1) ? n - 1 : plainBlank(n + 1) ? n + 1 : n;
  const a = Math.min(n, other);
  const b = Math.max(n, other);
  let from: number;
  let to: number;
  if (b < doc.lines) {
    from = doc.line(a).from;
    to = doc.line(b + 1).from;
  } else if (a > 1) {
    from = doc.line(a - 1).to;
    to = doc.line(b).to;
  } else {
    from = 0;
    to = doc.length;
  }
  return from < to ? state.changes({ from, to }) : null;
}

/** What `itemRemoval` found for a document, so that a file read isn't a parse each time. */
let lastItemRemoval: { doc: Text; line: number; changes: ChangeSet | null } | undefined;

/**
 * The changes that take an open empty item away: its line and the line break before it, and with
 * Track Changes on the split of the author's own that made the break, rejected, which takes its
 * ledger entry with it. Null when the line is no item's.
 */
function itemRemoval(state: EditorState, line: Line): ChangeSet | null {
  const { doc } = state;
  const hit = lastItemRemoval;
  if (hit && hit.doc === doc && hit.line === line.from) return hit.changes;
  let changes: ChangeSet | null = null;
  if (line.number > 1 && /^[ \t>]*(?:[-*+]|\d{1,9}[.)])[ \t]*$/.test(line.text)) {
    const above = doc.line(line.number - 1);
    const split = state
      .field(parsedField, false)
      ?.marks.find(
        (mark) => mark.kind === 'split' && mark.segments.some((g) => g.open.to === above.to),
      );
    if (split) {
      try {
        changes = ChangeSet.of(reject(doc.toString(), split.id), doc.length);
      } catch (error) {
        if (!(error instanceof EditError)) throw error;
      }
    }
    changes ??= state.changes({ from: above.to, to: line.to });
  }
  lastItemRemoval = { doc, line: line.from, changes };
  return changes;
}

/**
 * In the middle of a tight list, the blank lines around the open line, and their line breaks,
 * which leave the items on either side of it right on top of each other again: one blank line
 * left between them would turn the list loose. Null elsewhere, where one blank line stays.
 */
function tightListAround(state: EditorState, line: Line): { from: number; to: number } | null {
  const { doc } = state;
  let first = line.number;
  let last = line.number;
  while (first > 1 && BLANK.test(doc.line(first - 1).text)) first--;
  while (last < doc.lines && BLANK.test(doc.line(last + 1).text)) last++;
  if (first <= 1 || last >= doc.lines) return null;
  const above = doc.line(first - 1);
  const below = doc.line(last + 1);
  // The line below starts an item of a list that the text above is in.
  const marker = /^[ \t>]*(?=(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$))/.exec(below.text);
  if (!marker) return null;
  let item: SyntaxNode | null = syntaxTree(state).resolveInner(below.from + marker[0].length, 1);
  while (item && item.name !== 'ListItem') item = item.parent;
  const list = item?.parent;
  if (!item || !list || item.from !== below.from + marker[0].length) return null;
  if (list.from > above.from) return null;
  // Tight but for the open line's gap: read without it.
  const gap = { from: above.to, to: below.from - 1 };
  const apart = {
    sliceDoc: (from = 0, to = doc.length) =>
      from <= gap.from && gap.to <= to
        ? state.sliceDoc(from, gap.from) + state.sliceDoc(gap.to, to)
        : state.sliceDoc(from, to),
  };
  return loose(apart, list) ? null : gap;
}

/**
 * The changes that take the open block back: the Returns that opened it, from the record, when
 * nothing else was done since; otherwise its line and a blank line beside it. Null when nothing is
 * open, or it can't be taken back.
 */
export function takeBackChanges(state: EditorState): ChangeSet | null {
  const open = openBlock(state);
  if (!open) return null;
  const takes = openers(state);
  if (takes) {
    let changes = takes[0]!.changes;
    for (const taken of takes.slice(1)) changes = changes.compose(taken.changes);
    return changes;
  }
  return removal(state, open);
}

/** The document's text as the file has it: with the open block taken back. */
export function textWithoutOpen(state: EditorState): string {
  const changes = takeBackChanges(state);
  return changes ? changes.apply(state.doc).toString() : state.doc.toString();
}

/** Whether a selection is in the open block, or in the block Return was pressed in. */
function inOpen(open: OpenBlock, selection: EditorSelection): boolean {
  const { head, anchor } = selection.main;
  const inside = (span: Span | null, pos: number) =>
    span !== null && pos >= span.from && pos <= span.to;
  return (
    (inside(open.empty, head) && inside(open.empty, anchor)) ||
    (inside(open.pressedIn, head) && inside(open.pressedIn, anchor))
  );
}

/** The take-back of the open block, for a state, as a transaction after `selection`. */
function takeBackSpec(
  state: EditorState,
  selection: EditorSelection,
): { spec: TransactionSpec; outside: boolean } | null {
  const open = openBlock(state);
  if (!open) return null;
  const takes = openers(state);
  const changes = takeBackChanges(state);
  if (!changes)
    return { spec: { effects: [setOpenEffect.of(null), endRecordEffect.of(null)] }, outside: true };
  const effects: StateEffect<unknown>[] = [setOpenEffect.of(null), endRecordEffect.of(null)];
  const view = takes?.findLast((taken) => taken.view !== null)?.view;
  if (view) effects.push(setViewModeEffect.of(view));
  // Where the selection's ends stand once the block is gone: not inside text that the caret steps
  // over (the closer of a mark and the line breaks after it, which the open block kept apart).
  const gone = state.update({
    changes,
    selection: selection.map(changes),
    effects: [setOpenEffect.of(null)],
    filter: false,
  }).state;
  const mapped = visibleSelection(gone);
  if (takes) {
    // From the record: outside the history, which goes back to its depth before the first of the
    // Returns, whatever was done and taken back between them.
    const first = takes.at(-1)!;
    effects.push(
      dropStepsEffect.of({
        // A joined Return's step is the deletion's too: that step stays, and only the Return is
        // mapped out of it.
        depth: first.depth,
        mapping: first.joined ? first.changes.desc : null,
      }),
    );
    return {
      spec: {
        changes,
        selection: mapped,
        effects,
        annotations: [
          Transaction.addToHistory.of(false),
          takeBackAnnotation.of(true),
          trackedEditAnnotation.of(true),
        ],
      },
      outside: true,
    };
  }
  // An edit of its own, which ⌘Z brings back with the caret inside.
  return {
    spec: {
      changes,
      selection: mapped,
      effects,
      annotations: [
        isolateHistory.of('full'),
        trackedEditAnnotation.of(true),
        takeBackAnnotation.of(true),
        Transaction.userEvent.of('delete.block'),
      ],
    },
    outside: false,
  };
}

/**
 * Takes the open block back when the selection leaves it and the block Return was pressed in, and
 * before the view switches to Raw. A mouse selection waits for the button to come up, so that the
 * text under the pointer doesn't move first; an input method's composition is never interrupted.
 */
const leaving = EditorState.transactionFilter.of((tr) => {
  const start = tr.startState;
  const open = openBlock(start);
  if (!open) return tr;
  if (
    tr.annotation(takeBackAnnotation) ||
    tr.annotation(Transaction.remote) ||
    tr.annotation(openAnnotation) ||
    tr.effects.some((effect) => effect.is(setOpenEffect)) ||
    tr.isUserEvent('input.type.compose')
  ) {
    return tr;
  }
  const toRaw = tr.effects.some((effect) => effect.is(setViewModeEffect) && effect.value === 'raw');
  if (!toRaw && tr.state.field(pointerField)) return tr;
  if (tr.docChanged) {
    // Typing in it fills it; a change elsewhere (a decision) keeps it open, mapped, with the record
    // ended. The caret leaves it with the next transaction.
    return tr;
  }
  if (!toRaw && inOpen(open, tr.newSelection)) return tr;
  const back = takeBackSpec(start, tr.newSelection);
  if (!back) return tr;
  if (back.outside) return [tr, { ...back.spec, sequential: true }];
  // An edit of its own goes into the transaction that moves the caret, so that ⌘Z puts the caret
  // back inside.
  return {
    ...back.spec,
    effects: [...tr.effects, ...((back.spec.effects as StateEffect<unknown>[]) ?? [])],
    scrollIntoView: tr.scrollIntoView,
  };
});

/**
 * Backspace (or Delete) right after a Return, with the caret where that Return left it: takes it
 * back from the record exactly, as an edit of its own that ⌘Z brings back, with the view it
 * switched from. False when there is no such Return.
 */
export function takeBack(
  view: EditorView,
  userEvent = 'delete.backward.block',
  place?: (state: EditorState) => number | null,
): boolean {
  const { state } = view;
  const record = state.field(recordField, false) ?? [];
  const last = record.at(-1);
  const { main } = state.selection;
  if (!last || !main.empty || main.head !== last.caret || state.selection.ranges.length > 1) {
    return false;
  }
  // Delete takes a Return back only from the empty block it opened.
  const open = openBlock(state);
  if (place && (!open || main.head < open.empty.from || main.head > open.empty.to)) return false;
  const effects: StateEffect<unknown>[] = [
    poppedEffect.of(null),
    setOpenEffect.of(last.openBefore),
  ];
  if (last.view) effects.push(setViewModeEffect.of(last.view));
  view.dispatch({
    changes: last.changes,
    selection: last.before,
    effects,
    annotations: [
      trackedEditAnnotation.of(true),
      takeBackAnnotation.of(true),
      isolateHistory.of('full'),
    ],
    userEvent,
    scrollIntoView: true,
  });
  // Delete: the caret at the start of the next block's text, where the rules put it, in the same
  // step to undo.
  const at = place?.(view.state);
  if (at !== undefined && at !== null) {
    view.dispatch({
      selection: EditorSelection.cursor(at),
      userEvent: 'select',
      scrollIntoView: true,
    });
  }
  return true;
}

/**
 * Takes the open block away as the caret moves to `selection` (given in the offsets of the text
 * with it), as leaving it does: Backspace or Delete in it with no Return to take back. False when
 * nothing is open.
 */
export function closeOpen(view: EditorView, selection: EditorSelection): boolean {
  const back = takeBackSpec(view.state, selection);
  if (!back) return false;
  view.dispatch({ ...back.spec, scrollIntoView: true });
  return true;
}

/** Tells the state when a mouse button goes down in the editor and comes up anywhere. */
const pointer = ViewPlugin.define(
  (view) => {
    const up = () => {
      window.removeEventListener('mouseup', up, true);
      if (view.state.field(pointerField)) view.dispatch({ effects: pointerEffect.of(false) });
    };
    return {
      destroy: () => window.removeEventListener('mouseup', up, true),
      down() {
        if (!openBlock(view.state)) return;
        window.addEventListener('mouseup', up, true);
        view.dispatch({ effects: pointerEffect.of(true) });
      },
    };
  },
  {
    eventHandlers: {
      mousedown(event) {
        if (event.button === 0) this.down();
        return false;
      },
    },
  },
);

/**
 * The open block and the record on the content element, so that the page can be asked:
 * `data-rl-open-block` the open block's line number (none while nothing is open), and
 * `data-rl-returns` how many Returns the record holds. Not a class on the line: the empty
 * paragraph is drawn exactly as a body line, so that the first composed character changes nothing.
 */
const observable = EditorView.contentAttributes.compute(
  [openBlockField, recordField],
  (state): Record<string, string> => {
    const open = openBlock(state);
    const attributes: Record<string, string> = {
      'data-rl-returns': String(state.field(recordField).length),
    };
    if (open) attributes['data-rl-open-block'] = String(state.doc.lineAt(open.empty.from).number);
    return attributes;
  },
);

/** The empty block, the record, and their take-backs. */
export function openBlocks(): Extension {
  return [
    openBlockField,
    recordField,
    pointerField,
    Prec.high(leaving),
    Prec.highest(pointer),
    observable,
  ];
}

/** What a new version of the file does to the document, with the open block kept where it can be. */
export interface ThroughOpen {
  changes: ChangeSet;
  /** Where the caret goes, when the open block decides it; else null. */
  selection: EditorSelection | null;
  effects: StateEffect<unknown>[];
}

/**
 * A new version of the file while the empty paragraph is open (an agent's edit, a reload): the new
 * text is diffed against `textWithoutOpen`, what the file had, not the live text, and the open block
 * goes back in where it was when the blocks on either side of it survive. Otherwise the caret goes
 * to the end of the block above. Null when nothing is open.
 */
export function throughOpen(state: EditorState, next: Text): ThroughOpen | null {
  const open = openBlock(state);
  const back = takeBackChanges(state);
  if (!open || !back) return null;
  const { doc } = state;
  const base = back.apply(doc);
  const diff = ChangeSet.of(lineChanges(base.toString(), next.toString()), base.length);
  if (diff.empty) return { changes: ChangeSet.empty(doc.length), selection: null, effects: [] };
  const restore = back.invert(doc);
  // Where the open block was taken out, in the file's text, and the blocks on either side.
  let from = base.length;
  let to = 0;
  restore.iterChangedRanges((fromA, toA) => {
    from = Math.min(from, fromA);
    to = Math.max(to, toA);
  });
  if (from > to) from = to = back.mapPos(open.empty.from, -1);
  let above: Line | null = null;
  for (let n = base.lineAt(from).number; n >= 1 && !above; n--) {
    const line = base.line(n);
    if (!BLANK.test(line.text) && line.from < from) above = line;
  }
  let below: Line | null = null;
  for (let n = base.lineAt(to).number; n <= base.lines && !below; n++) {
    const line = base.line(n);
    if (!BLANK.test(line.text) && line.to > to) below = line;
  }
  // The break the open block was in, between the ends of the blocks on either side: a change in
  // it (a block beside it gone, a block put there) takes the open block's place away. Changes in
  // the blocks themselves leave it.
  const gap = { from: above?.to ?? -1, to: below?.from ?? base.length + 1 };
  let survives = true;
  const gone = (line: Line | null) => line !== null && fromA0(line);
  function fromA0(line: Line): boolean {
    let whole = false;
    diff.iterChangedRanges((fromA, toA) => {
      if (fromA < toA && fromA <= line.from && toA >= line.to) whole = true;
    });
    return whole;
  }
  if (gone(above) || gone(below) || open.item) survives = false;
  diff.iterChangedRanges((fromA, toA) => {
    if (fromA < gap.to && toA > gap.from && (fromA !== toA || (fromA > gap.from && fromA < gap.to)))
      survives = false;
  });
  if (!survives) {
    const changes = back.compose(diff);
    const end = above ? diff.mapPos(above.to, -1) : 0;
    return {
      changes,
      selection: EditorSelection.single(end),
      effects: [setOpenEffect.of(null), endRecordEffect.of(null)],
    };
  }
  const again = restore.map(diff);
  const changes = back.compose(diff).compose(again);
  // The text of the open block's line, as it was taken out, goes back in as a piece.
  let piece = { from: open.empty.from, to: open.empty.from };
  back.iterChanges((fromA, toA) => {
    if (fromA <= open.empty.from && open.empty.from <= toA) piece = { from: fromA, to: toA };
  });
  const start = again.mapPos(diff.mapPos(back.mapPos(piece.from, -1), 1), -1);
  const shift = (pos: number) => start + (pos - piece.from);
  const empty = { from: shift(open.empty.from), to: shift(open.empty.to) };
  const pressedIn = open.pressedIn && {
    from: changes.mapPos(open.pressedIn.from, 1),
    to: changes.mapPos(open.pressedIn.to, -1),
  };
  const { main } = state.selection;
  const inside = main.empty && main.head >= open.empty.from && main.head <= open.empty.to;
  return {
    changes,
    selection: inside ? EditorSelection.single(shift(main.head)) : null,
    effects: [setOpenEffect.of({ empty, pressedIn }), endRecordEffect.of(null)],
  };
}
