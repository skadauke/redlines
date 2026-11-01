// Typing with Track Changes on (design §5.3–§5.5, format §3.6). A transaction filter rewrites the
// author's edits through the format's trackedEdit: typing becomes an insertion, deleting a
// deletion and replacing a substitution, each with the markers and the ledger entry the format
// writes for it, in one transaction, so one Undo takes it back exactly. A tracked edit made in
// Clean switches the view to Redlines, and Raw is read-only while Track Changes is on, because
// typing there could forge or break markers.
//
// With Track Changes on or off, outside Raw, Backspace and Delete never delete a marker: next to
// hidden text they act on the visible character beyond it. A plain edit, with Track Changes off,
// keeps the markers and the ledger in what it deletes, and nothing is typed after the ledger at
// the end of the file.

import { defaultKeymap, toggleBlockComment, toggleComment } from '@codemirror/commands';
import {
  type Annotation,
  ChangeSet,
  EditorSelection,
  EditorState,
  type Extension,
  Facet,
  findClusterBreak,
  type SelectionRange,
  StateEffect,
  type StateCommand,
  StateField,
  type Text,
  Transaction,
  type TransactionSpec,
} from '@codemirror/state';
import {
  type Command,
  type EditorView,
  type KeyBinding,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view';
import {
  applyChanges,
  type EditContext,
  EditError,
  openerRange,
  parse,
  type Parsed,
  type Range,
  type TextChange,
  trackedEdit,
} from '@redlines/format';
import { lineChanges } from '../diff.ts';
import { onlyHidden, pastHidden } from './decorations.ts';
import {
  authorFacet,
  bodyEnd,
  parsedField,
  setViewModeEffect,
  trackedEditAnnotation,
  viewModeField,
} from './field.ts';

export const setTrackingEffect = StateEffect.define<boolean>();

/**
 * Whether the author's edits are tracked (design §5.4). It starts on when the file asks for it
 * (`tracking: everyone`, format §5.6).
 */
export const trackingField = StateField.define<boolean>({
  create: (state) => state.field(parsedField).ledger.tracking === 'everyone',
  update: (on, tr) => tr.effects.findLast((effect) => effect.is(setTrackingEffect))?.value ?? on,
});

/** Comes with an edit that can't be made, such as a tracked change inside code: why, for people. */
export const refusedEditEffect = StateEffect.define<string>();

/** Where tracked edits take their time and the random bytes of new ids from. */
export interface EditSource {
  now: () => Date;
  random?: (n: number) => Uint8Array;
}

/** The clock and random source of tracked edits: the system's, unless tests fix them. */
export const editSourceFacet = Facet.define<EditSource, EditSource>({
  combine: (sources) => sources[0] ?? { now: () => new Date() },
});

/** The editing author, at the current minute (format §2.4). */
function contextFor(state: EditorState): EditContext {
  const author = state.facet(authorFacet);
  if (!author) throw new EditError('Track Changes needs to know who is editing.');
  const { now, random } = state.facet(editSourceFacet);
  return { author, time: `${now().toISOString().slice(0, 16)}Z`, random };
}

/** A change of a transaction, in its start document's offsets. */
interface Edit extends TextChange {
  /** The change the main selection ends at, which the caret follows. */
  main: boolean;
}

function editsOf(tr: Transaction): Edit[] {
  const edits: Edit[] = [];
  const { head } = tr.newSelection.main;
  let main = -1;
  tr.changes.iterChanges((from, to, fromB, toB, inserted) => {
    if (fromB <= head && head <= toB) main = edits.length;
    edits.push({ from, to, insert: inserted.toString(), main: false });
  });
  if (main >= 0) edits[main]!.main = true;
  return edits;
}

/** Typing, pasting, dropping, deleting, moving and indenting text: what a person does to it. */
function isUserEdit(tr: Transaction): boolean {
  return ['input', 'delete', 'move', 'indent'].some((event) => tr.isUserEvent(event));
}

/** A command whose changes count as typing, so that Track Changes records them. */
function asInput(command: StateCommand): Command {
  return (view) =>
    command({
      state: view.state,
      dispatch: (tr) =>
        view.dispatch({
          changes: tr.changes,
          selection: tr.selection,
          effects: tr.effects,
          scrollIntoView: tr.scrollIntoView,
          userEvent: 'input.comment',
        }),
    });
}

/**
 * CodeMirror's default keymap. Its comment commands set no user event, so Track Changes would take
 * what they do for a change made by code: here they count as typing.
 */
export const editingKeymap: readonly KeyBinding[] = defaultKeymap.map((binding) => {
  if (binding.run === toggleComment) return { ...binding, run: asInput(toggleComment) };
  if (binding.run === toggleBlockComment) return { ...binding, run: asInput(toggleBlockComment) };
  return binding;
});

/** Edits that would reach past the body stop where it ends. */
function inBody(edits: Edit[], end: number | null): Edit[] {
  if (end === null) return edits;
  return edits.flatMap((edit) => {
    if (edit.to <= end) return [edit];
    const from = Math.min(edit.from, end);
    return from < end || edit.insert ? [{ ...edit, from, to: end }] : [];
  });
}

/** The visible character beside `pos`, past any hidden text, or null at the document's edge. */
function visibleChar(state: EditorState, pos: number, forward: boolean): Range | null {
  const at = pastHidden(state, pos, forward);
  const { doc } = state;
  if (forward ? at >= doc.length : at <= 0) return null;
  const line = doc.lineAt(at);
  // A line break is one character.
  if (at === (forward ? line.to : line.from)) {
    return forward ? { from: at, to: at + 1 } : { from: at - 1, to: at };
  }
  const end = line.from + findClusterBreak(line.text, at - line.from, forward);
  return forward ? { from: at, to: end } : { from: end, to: at };
}

/**
 * Backspace and Delete next to hidden text, which CodeMirror would delete whole because the caret
 * steps over it, delete the visible character beyond it instead (design §5.5).
 */
function pastHiddenText(state: EditorState, edits: Edit[], forward: boolean): Edit[] {
  return edits.flatMap((edit) => {
    if (edit.insert || !onlyHidden(state, edit.from, edit.to)) return [edit];
    const char = visibleChar(state, forward ? edit.to : edit.from, forward);
    return char ? [{ ...edit, ...char }] : [];
  });
}

/**
 * The markers of a parse, in document order. An opener on a line of its own before a block comes
 * with its carrier, the line break, blank line and prefix after it (format §3.3), which go with it.
 */
function markersOf(parsed: Parsed): Range[] {
  const ranges: Range[] = [];
  for (const { segments } of parsed.marks) {
    for (const segment of segments) {
      ranges.push(openerRange(segment));
      if (segment.close) ranges.push(segment.close);
    }
  }
  return ranges.sort((a, b) => a.from - b.from);
}

/**
 * A plain edit keeps the markers and the ledger in the text it deletes: the text around them goes,
 * they stay, and the new text goes where the edit starts.
 */
function keepingMarkers(edits: Edit[], parsed: Parsed): Edit[] {
  const kept = markersOf(parsed);
  if (parsed.ledgerRange) kept.push(parsed.ledgerRange);
  return edits.flatMap((edit) => {
    const inside = kept.filter((range) => range.from < edit.to && range.to > edit.from);
    if (!inside.length) return [edit];
    const pieces: Edit[] = [];
    let pos = edit.from;
    for (const range of inside) {
      if (range.from > pos) pieces.push({ from: pos, to: range.from, insert: '', main: false });
      pos = Math.max(pos, range.to);
    }
    if (pos < edit.to) pieces.push({ from: pos, to: edit.to, insert: '', main: false });
    const at = inside[0]!.from < edit.from ? inside[0]!.from : edit.from;
    const first = pieces[0];
    if (first?.from === at) Object.assign(first, { insert: edit.insert, main: edit.main });
    else if (edit.insert)
      pieces.unshift({ from: at, to: at, insert: edit.insert, main: edit.main });
    return pieces;
  });
}

/** The markers as stretches of hidden text: markers that touch make one stretch. */
function stretchesOf(parsed: Parsed): Range[] {
  const stretches: Range[] = [];
  for (const range of markersOf(parsed)) {
    const last = stretches.at(-1);
    if (last && range.from <= last.to) last.to = Math.max(last.to, range.to);
    else stretches.push({ ...range });
  }
  return stretches;
}

/** How many characters of text, markers left out, come before `pos`. */
function visibleOffset(stretches: readonly Range[], pos: number): number {
  let hidden = 0;
  for (const stretch of stretches) {
    if (stretch.from >= pos) break;
    hidden += Math.min(stretch.to, pos) - stretch.from;
  }
  return pos - hidden;
}

/** The position after `offset` characters of text: before markers there (`side` -1), or after. */
function positionAt(stretches: readonly Range[], offset: number, side: -1 | 1): number {
  let hidden = 0;
  for (const stretch of stretches) {
    const at = stretch.from - hidden;
    if (offset < at) break;
    if (offset === at) return side < 0 ? stretch.from : stretch.to;
    hidden += stretch.to - stretch.from;
  }
  return offset + hidden;
}

/**
 * Where the caret goes after a tracked edit: after the text typed; before text deleted with
 * Backspace, so that Backspace goes on to the left; and after text deleted otherwise, so that
 * typing then follows it, as a replacement's new text does. A tracked edit changes the text that
 * shows between the markers only by what is typed and deleted, so the caret is found by counting
 * that text, from where the format's changes start (`start`). Typed text starts there when the
 * format keeps the start of what was selected, such as the `# ` of the first heading when
 * everything is replaced (format §3.4); it may also rewrite markers before the edit, which leaves
 * the text before it as it was. Deleted text starts there too when the format deletes more than
 * the edit, such as the whole of a split's break (format §3.4).
 */
function caretAfter(
  before: Parsed,
  after: Parsed,
  edit: TextChange,
  start: number,
  backward: boolean,
): number {
  const stretches = stretchesOf(before);
  const changed = visibleOffset(stretches, start);
  const from = edit.insert ? Math.max(visibleOffset(stretches, edit.from), changed) : changed;
  const offset = from + edit.insert.length;
  const pos = positionAt(stretchesOf(after), offset, edit.insert || backward ? -1 : 1);
  const end = bodyEnd(after);
  return end === null ? pos : Math.min(pos, end);
}

interface Tracked {
  /** In the offsets of the text the edits were made to. */
  changes: ChangeSet;
  /** Where the caret goes, when the main edit made a change. */
  caret: number | null;
}

/**
 * The edits, in offsets of `text` (whose parse is `parsed`), as tracked changes by the editing
 * author. Each goes through trackedEdit on its own, the last first, so the others keep their
 * offsets.
 *
 * @throws EditError when the format refuses an edit, or when its result would start a line with a
 *   marker.
 */
function trackEdits(
  state: EditorState,
  text: string,
  parsed: Parsed,
  edits: readonly Edit[],
  backward: boolean,
): Tracked {
  const ctx = contextFor(state);
  let changes = ChangeSet.empty(text.length);
  let caret: number | null = null;
  let before = parsed;
  for (let i = edits.length - 1; i >= 0; i--) {
    const edit = edits[i]!;
    const mapped = {
      from: changes.mapPos(edit.from, -1),
      to: changes.mapPos(edit.to, -1),
      insert: edit.insert,
    };
    const result = trackedEdit(text, mapped, ctx);
    if (!result.length) continue;
    const step = ChangeSet.of(result, text.length);
    const next = applyChanges(text, result);
    const after = parse(next, before);
    // Where the format puts a marker at the start of a line (format §3.2), a renderer reads the
    // rest of the line as raw HTML. That is the format's to prevent; until it does everywhere, the
    // editor refuses such a change rather than write it.
    if (lineStartMarkers(after) > lineStartMarkers(before)) {
      throw new EditError("Redlines can't make this change here yet.", 'no-legal-placement');
    }
    if (edit.main) caret = caretAfter(before, after, mapped, result[0]!.from, backward);
    else if (caret !== null) caret = step.mapPos(caret, -1);
    changes = changes.compose(step);
    text = next;
    before = after;
  }
  return { changes, caret };
}

/** How many markers start a line of text. */
const lineStartMarkers = (parsed: Parsed) =>
  parsed.warnings.filter((warning) => warning.code === 'line-start-marker').length;

/**
 * A transaction's annotations, such as the user event that history groups typing by, whether to
 * add it to the history, and other extensions' own, with the tracked layer's mark.
 */
function annotationsOf(tr: Transaction): Annotation<unknown>[] {
  // CodeMirror reads annotations by type only; a transaction keeps the list in `annotations`.
  const all = (tr as unknown as { annotations?: readonly Annotation<unknown>[] }).annotations;
  return [...(all ?? []), trackedEditAnnotation.of(true)];
}

/** A transaction's edits, rewritten, as a transaction of their own. */
function rewritten(
  tr: Transaction,
  changes: ChangeSet,
  caret: number | null,
  effects: readonly StateEffect<unknown>[] = [],
): TransactionSpec {
  // From the transaction's new document back to its start, and on to the rewritten one.
  const mapping = tr.changes.invertedDesc.composeDesc(changes.desc);
  return {
    changes,
    selection: caret === null ? tr.newSelection.map(mapping) : EditorSelection.cursor(caret),
    effects: [...StateEffect.mapEffects(tr.effects, mapping), ...effects],
    annotations: annotationsOf(tr),
    scrollIntoView: tr.scrollIntoView,
  };
}

/** The author's edits as tracked changes, or nothing, with the reason, when they can't be. */
function trackedSpec(tr: Transaction, edits: Edit[], backward: boolean): TransactionSpec {
  const start = tr.startState;
  let tracked: Tracked;
  try {
    tracked = trackEdits(start, start.doc.toString(), start.field(parsedField), edits, backward);
  } catch (error) {
    if (error instanceof EditError) return { effects: refusedEditEffect.of(error.message) };
    throw error;
  }
  if (tracked.changes.empty) return {};
  const toRedlines = suggests(start, start.doc, edits, tracked.changes)
    ? [setViewModeEffect.of('redlines')]
    : [];
  return rewritten(tr, tracked.changes, tracked.caret, toRedlines);
}

/**
 * Whether a tracked edit made in Clean suggests something, which switches the view to Redlines so
 * that suggestions are never invisible to their author (design §5.3): whether the format wrote
 * more than the plain edit would have, unlike a line break at the end of a paragraph.
 */
function suggests(state: EditorState, doc: Text, edits: readonly Edit[], tracked: ChangeSet) {
  if (state.field(viewModeField) !== 'clean') return false;
  return !tracked.apply(doc).eq(ChangeSet.of(edits, doc.length).apply(doc));
}

/** A plain edit, after the changes that keep markers and the ledger. */
function plainSpec(tr: Transaction, edits: Edit[]): TransactionSpec {
  const changes = ChangeSet.of(edits, tr.startState.doc.length);
  const main = edits.find((edit) => edit.main);
  const caret = main ? changes.mapPos(main.from, -1) + main.insert.length : null;
  return rewritten(tr, changes, caret);
}

const same = (a: readonly TextChange[], b: readonly TextChange[]) =>
  a.length === b.length &&
  a.every((x, i) => x.from === b[i]?.from && x.to === b[i]?.to && x.insert === b[i]?.insert);

/** A selection that reaches past the body, onto the line after the hidden ledger, stops at it. */
function selectionInBody(tr: Transaction): Transaction | readonly TransactionSpec[] {
  const end = bodyEnd(tr.startState.field(parsedField));
  const selection = tr.newSelection;
  if (end === null || selection.ranges.every((r) => r.anchor <= end && r.head <= end)) return tr;
  const ranges = selection.ranges.map((r) =>
    EditorSelection.range(Math.min(r.anchor, end), Math.min(r.head, end)),
  );
  return [tr, { selection: EditorSelection.create(ranges, selection.mainIndex), sequential: true }];
}

/** Text an input method composes while Track Changes is on (see `compositionField`). */
function isDeferred(tr: Transaction): boolean {
  return (
    tr.isUserEvent('input.type.compose') &&
    !tr.annotation(trackedEditAnnotation) &&
    tr.startState.field(trackingField) &&
    tr.startState.field(viewModeField) !== 'raw'
  );
}

const typingFilter = EditorState.transactionFilter.of((tr) => {
  const start = tr.startState;
  if (start.field(viewModeField) === 'raw') return tr;
  if (tr.annotation(trackedEditAnnotation) || tr.annotation(Transaction.remote)) return tr;
  if (!tr.docChanged) return tr.selection ? selectionInBody(tr) : tr;
  if (!isUserEdit(tr) || isDeferred(tr)) return tr;
  const parsed = start.field(parsedField);
  const original = editsOf(tr);
  let edits = inBody(original, bodyEnd(parsed));
  const backward = tr.isUserEvent('delete.backward');
  if (backward || tr.isUserEvent('delete.forward')) edits = pastHiddenText(start, edits, !backward);
  if (start.field(trackingField)) return trackedSpec(tr, edits, backward);
  edits = keepingMarkers(edits, parsed);
  if (!same(edits, original)) return plainSpec(tr, edits);
  // As it is, marked so that the caret moves out of hidden text, which the edit can leave it in
  // when it brings markers together.
  return [tr, { annotations: trackedEditAnnotation.of(true), sequential: true }];
});

/** Text being composed: where it is now, and the text it replaced. */
interface Composition {
  from: number;
  to: number;
  replaced: string;
}

const composedEffect = StateEffect.define<null>();

/**
 * An input method changes the text it composes in the page and expects to find it there; rewriting
 * it into a tracked change midway would break the composition. So composed text goes in plain, and
 * when the composition ends it becomes a tracked change, in a step that history joins to it.
 */
const compositionField = StateField.define<Composition | null>({
  create: () => null,
  update(pending, tr) {
    if (tr.effects.some((effect) => effect.is(composedEffect))) return null;
    if (!tr.docChanged) return pending;
    const doc = tr.startState.doc;
    if (isDeferred(tr)) {
      let next = pending;
      tr.changes.iterChangedRanges((from, to) => {
        if (!next) next = { from, to, replaced: doc.sliceString(from, to) };
        // The composition reaches outside what it composed so far: that text it replaced.
        if (from < next.from)
          next = { ...next, from, replaced: doc.sliceString(from, next.from) + next.replaced };
        if (to > next.to)
          next = { ...next, to, replaced: next.replaced + doc.sliceString(next.to, to) };
      });
      return (
        next && {
          ...next,
          from: tr.changes.mapPos(next.from, -1),
          to: tr.changes.mapPos(next.to, 1),
        }
      );
    }
    if (!pending) return null;
    let touched = false;
    tr.changes.iterChangedRanges((from, to) => {
      if (from < pending.to && to > pending.from) touched = true;
    });
    // A change to the composed text from elsewhere, such as a reload, ends the wait.
    if (touched) return null;
    return {
      ...pending,
      from: tr.changes.mapPos(pending.from, 1),
      to: tr.changes.mapPos(pending.to, -1),
    };
  },
});

/** Turns a finished composition into a tracked change, or takes it back when that can't be. */
function finishComposition(view: EditorView): void {
  const { state } = view;
  const pending = state.field(compositionField, false);
  if (!pending || view.composing) return;
  const composed = state.sliceDoc(pending.from, pending.to);
  if (composed === pending.replaced) {
    view.dispatch({ effects: composedEffect.of(null) });
    return;
  }
  const back = state.changes({ from: pending.from, to: pending.to, insert: pending.replaced });
  const edits = lineChanges(pending.replaced, composed).map((change, i, all) => ({
    from: pending.from + change.from,
    to: pending.from + change.to,
    insert: change.insert,
    main: i === all.length - 1,
  }));
  const effects: StateEffect<unknown>[] = [composedEffect.of(null)];
  let changes = back;
  let selection: SelectionRange | undefined;
  try {
    const base = back.apply(state.doc);
    const text = base.toString();
    const tracked = trackEdits(state, text, parse(text, state.field(parsedField)), edits, false);
    changes = back.compose(tracked.changes);
    if (tracked.caret !== null) selection = EditorSelection.cursor(tracked.caret);
    if (suggests(state, base, edits, tracked.changes))
      effects.push(setViewModeEffect.of('redlines'));
  } catch (error) {
    if (!(error instanceof EditError)) throw error;
    effects.push(refusedEditEffect.of(error.message));
  }
  view.dispatch({
    changes,
    selection,
    effects,
    annotations: [trackedEditAnnotation.of(true), Transaction.userEvent.of('input.type.compose')],
  });
}

class CompositionEnd {
  readonly view: EditorView;
  timer: ReturnType<typeof setTimeout> | undefined;

  constructor(view: EditorView) {
    this.view = view;
  }

  update(update: ViewUpdate): void {
    if (update.state.field(compositionField) && !update.view.composing) this.schedule();
  }

  /** After the update, and after CodeMirror reads the composition's last change. */
  schedule(): void {
    if (this.timer !== undefined) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      finishComposition(this.view);
    }, 0);
  }

  destroy(): void {
    clearTimeout(this.timer);
  }
}

const compositionEnd = ViewPlugin.fromClass(CompositionEnd, {
  eventHandlers: {
    compositionend() {
      this.schedule();
    },
  },
});

/** Raw shows markers as text, which typing could forge or break while edits are tracked. */
const rawWhileTracking = EditorState.readOnly.compute(
  [trackingField, viewModeField],
  (state) => state.field(trackingField) && state.field(viewModeField) === 'raw',
);

/** Track Changes: the setting, and the author's edits as tracked changes while it is on. */
export function trackedTyping(): Extension {
  return [trackingField, compositionField, typingFilter, compositionEnd, rawWhileTracking];
}
