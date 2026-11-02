// Typing with Track Changes on (design §5.3–§5.5, format §3.6). A transaction filter rewrites the
// author's edits through the format's trackedEdit: typing becomes an insertion, deleting a
// deletion and replacing a substitution, each with the markers and the ledger entry the format
// writes for it, in one transaction, so one Undo takes it back exactly. A tracked edit made in
// Clean switches the view to Redlines, and Raw is read-only while Track Changes is on, because
// typing there could forge or break markers.
//
// With Track Changes off, outside Raw, an edit is an edit of the text itself (format §3.10), which
// the format's untrackedEdit writes: what is typed never becomes part of a pending change, and what
// is deleted is gone for good, with the marks that have no text left. It is one transaction too.
//
// With Track Changes on or off, outside Raw, Backspace and Delete never delete a marker: next to
// hidden text they act on the visible character beyond it, and nothing is typed after the ledger
// at the end of the file.

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
  EditorView,
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
  untrackedEdit,
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

export const RAW_READ_ONLY =
  'Raw is read-only while Track Changes is on. Turn Track Changes off to edit the source.';

/** Raw shows markers as text, which typing could forge or break while edits are tracked. */
export function rawIsReadOnly(state: EditorState): boolean {
  return state.field(trackingField) && state.field(viewModeField) === 'raw';
}

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
 * Enter, whose commands delete the spaces after the caret, or before it when they continue a list,
 * keeps them while Track Changes is on: the line break goes after them, the caret to the start of
 * the new line, and no deletion of a space appears beside the break.
 */
function keepingSpaces(tr: Transaction, edits: Edit[]): Edit[] {
  // CodeMirror's Enter commands, and only they, give their edits this user event.
  if (tr.annotation(Transaction.userEvent) !== 'input') return edits;
  const { doc } = tr.startState;
  return edits.map((edit) => {
    const spaces = edit.from < edit.to && /^[ \t]+$/.test(doc.sliceString(edit.from, edit.to));
    return spaces && edit.insert.startsWith('\n') ? { ...edit, from: edit.to } : edit;
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
 * A text as the newest view shows it (format §8): without its markers, the carriers of own-line
 * openers or the ledger. `hidden` holds those, in order, the ones that touch joined.
 */
interface Newest {
  text: string;
  hidden: Range[];
}

function newestOf(parsed: Parsed): Newest {
  const ranges = markersOf(parsed);
  if (parsed.ledgerRange) ranges.push(parsed.ledgerRange);
  const hidden: Range[] = [];
  for (const range of ranges.sort((a, b) => a.from - b.from)) {
    const last = hidden.at(-1);
    if (last && range.from <= last.to) last.to = Math.max(last.to, range.to);
    else hidden.push({ ...range });
  }
  let text = '';
  let pos = 0;
  for (const range of hidden) {
    text += parsed.text.slice(pos, range.from);
    pos = range.to;
  }
  return { text: text + parsed.text.slice(pos), hidden };
}

/** How many characters of the newest text come before `pos`. */
function newestOffset({ hidden }: Newest, pos: number): number {
  let gone = 0;
  for (const range of hidden) {
    if (range.from >= pos) break;
    gone += Math.min(range.to, pos) - range.from;
  }
  return pos - gone;
}

/** What is hidden after `offset` characters of the newest text, if anything. */
function hiddenAt({ hidden }: Newest, offset: number): Range | undefined {
  let gone = 0;
  for (const range of hidden) {
    const at = range.from - gone;
    if (offset <= at) return offset === at ? range : undefined;
    gone += range.to - range.from;
  }
  return undefined;
}

/**
 * The position after `offset` characters of the newest text: before what is hidden there
 * (`side` -1), or after it.
 */
function positionAt({ hidden }: Newest, offset: number, side: -1 | 1): number {
  let gone = 0;
  for (const range of hidden) {
    const at = range.from - gone;
    if (offset < at) break;
    if (offset === at) return side < 0 ? range.from : range.to;
    gone += range.to - range.from;
  }
  return offset + gone;
}

/** How many characters `a` and `b` share at their start. */
function sharedStart(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a.charCodeAt(n) === b.charCodeAt(n)) n++;
  return n;
}

/** How many characters `a` and `b` share at their end, leaving out the first `start` of each. */
function sharedEnd(a: string, b: string, start: number): number {
  let n = 0;
  const most = Math.min(a.length, b.length) - start;
  while (n < most && a.charCodeAt(a.length - 1 - n) === b.charCodeAt(b.length - 1 - n)) n++;
  return n;
}

/** A block's markers at the start of a line: quote marks, a list item's bullet, a heading's. */
const BLOCK_MARKERS = /^(?:[ \t]*(?:>|[-*+]|\d{1,9}[.)]|#{1,6})(?=[ \t]|$))+[ \t]*/;

/** The end of the block markers of the line that holds `pos`, when `pos` is inside them; else `pos`. */
function pastBlockMarkers(text: string, pos: number): number {
  const start = text.lastIndexOf('\n', pos - 1) + 1;
  const end = text.indexOf('\n', pos);
  const markers = BLOCK_MARKERS.exec(text.slice(start, end < 0 ? text.length : end))?.[0] ?? '';
  return pos > start && pos < start + markers.length ? start + markers.length : pos;
}

/**
 * Where typed text ends in the newest text after the edit, `next`, given the newest text before it,
 * `old`, and the edit's range there, `from` to `to` (see `caretAfter`).
 */
function typedEnd(old: string, next: string, from: number, to: number, typed: string): number {
  // Text typed inside a block's markers, as between a bullet and its space, goes after them.
  for (const at of new Set([from, pastBlockMarkers(old, from)])) {
    const typedOn = old.slice(0, at) + typed;
    if (next.startsWith(typedOn)) return typedOn.length;
  }
  // The first tracked edit writes the ledger, after which the text ends in one line break.
  const oldText = old.replace(/\n+$/, '');
  let nextText = next.replace(/\n+$/, '');
  // Typed text that reaches the end of the text keeps its own line breaks there.
  if (to >= oldText.length) {
    const breaks = /\n*$/.exec(typed)![0].length;
    nextText = next.slice(0, Math.min(next.length, nextText.length + breaks));
  }
  const kept = nextText.length - Math.max(0, oldText.length - to);
  const differ = nextText.length - sharedEnd(oldText, nextText, sharedStart(oldText, nextText));
  /** How many of the typed text's last characters the newest text has right before `at`. */
  const typedBefore = (at: number) => {
    let n = 0;
    while (
      n < at &&
      n < typed.length &&
      next.charCodeAt(at - 1 - n) === typed.charCodeAt(typed.length - 1 - n)
    ) {
      n++;
    }
    return n;
  };
  return typedBefore(differ) > typedBefore(kept) ? differ : kept;
}

/**
 * Where the caret goes after a tracked edit (format §3.6): after the text typed; before text
 * deleted with Backspace, so that Backspace goes on to the left; and after text deleted otherwise,
 * so that typing then follows it, as a replacement's new text does.
 *
 * It is found in the newest text before and after the edit. The format keeps that text what the
 * edit means, but it may change more than the edit's range: it widens a deletion to a whole link
 * destination or a split's whole break, drops the next block's prefix when typed text joins two
 * blocks, keeps the prefix of a block (`# `, `- `) that typed text repeats or replaces, puts text
 * typed inside a block's markers after them, moves the next item's bullet in front of text typed
 * over a whole item, and with the first tracked edit, which writes the ledger, changes how the text
 * ends.
 *
 * Typed text usually follows the text before the edit, as it was, or the block's markers it was
 * typed inside: then the caret goes right after it. Otherwise, as when the format keeps a prefix in
 * front of it, the texts are compared without the line breaks that end them, except those of typed
 * text that reaches the end: typed text ends where the text after the edit starts again,
 * counted from that end (`kept`), or where the two texts start to agree at that end (`differ`),
 * whichever the typed text ends at, and `kept` when both are. Deleted text starts where the two
 * texts first differ, and no later than the edit.
 *
 * The caret goes before what is hidden there, so that typing goes on inside an insertion, except
 * after typed text that ends a line, when markers on lines of their own open the block below it
 * (format §3.3), as when it splits someone's inserted paragraph: then it goes to that block's text.
 */
function caretAfter(before: Parsed, after: Parsed, edit: TextChange, backward: boolean): number {
  const old = newestOf(before);
  const next = newestOf(after);
  const from = newestOffset(old, edit.from);
  let offset: number;
  if (edit.insert) {
    offset = typedEnd(old.text, next.text, from, newestOffset(old, edit.to), edit.insert);
  } else {
    offset = Math.min(sharedStart(old.text, next.text), from);
  }
  offset = Math.max(0, Math.min(offset, next.text.length));
  const below = edit.insert.endsWith('\n') ? hiddenAt(next, offset) : undefined;
  const opensBlock =
    below !== undefined && (below.from === 0 || after.text[below.from - 1] === '\n');
  const pos = positionAt(next, offset, opensBlock || !(edit.insert || backward) ? 1 : -1);
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
  return formatEdits(text, parsed, edits, backward, (doc, edit, read) =>
    trackedEdit(doc, rangeSide(read, edit), ctx),
  );
}

/**
 * Text typed beside the hidden markers of a comment's or a highlight's range lands where format §4
 * says, whichever side of them the caret rests on: in the range at its end, and in front of it at
 * its start. With Track Changes off, the format puts it there itself (format §3.10). A range of whole
 * blocks, whose opener stands on a line of its own, is left as it is.
 */
function rangeSide(parsed: Parsed, edit: TextChange): TextChange {
  if (edit.from !== edit.to || !edit.insert) return edit;
  const markers = parsed.marks.flatMap(({ kind, segments }) =>
    kind === 'cmt' || kind === 'hl'
      ? segments.flatMap((s) => (s.close && !s.carrier ? [s.open, s.close] : []))
      : [],
  );
  let at = edit.from;
  for (let marker = markers.find((m) => m.to === at); marker;) {
    at = marker.from;
    marker = markers.find((m) => m.to === at);
  }
  return at === edit.from ? edit : { ...edit, from: at, to: at };
}

/**
 * The edits as edits of the text itself, with Track Changes off (format §3.10): what the format's
 * untrackedEdit makes of each, as `trackEdits` does. Who edits is not recorded, so no author is
 * needed; the marks that typed text splits take their ids from the edit source.
 *
 * @throws EditError when the format refuses an edit.
 */
function untrackEdits(
  state: EditorState,
  text: string,
  parsed: Parsed,
  edits: readonly Edit[],
  backward: boolean,
): Tracked {
  const { random } = state.facet(editSourceFacet);
  return formatEdits(text, parsed, edits, backward, (doc, edit) =>
    untrackedEdit(doc, edit, { random }),
  );
}

/**
 * The edits as the changes that `make` gives for each, given the text and its parse, the last
 * first, and where the caret goes.
 */
function formatEdits(
  text: string,
  parsed: Parsed,
  edits: readonly Edit[],
  backward: boolean,
  make: (text: string, edit: TextChange, parsed: Parsed) => TextChange[],
): Tracked {
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
    const result = make(text, mapped, before);
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
    if (edit.main) caret = caretAfter(before, after, mapped, backward);
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

/**
 * The author's edits with Track Changes off (format §3.10), or nothing, with the reason, when they
 * can't be made. An edit that the format leaves as it is goes in as it is.
 */
function untrackedSpec(
  tr: Transaction,
  edits: Edit[],
  backward: boolean,
): TransactionSpec | readonly (Transaction | TransactionSpec)[] {
  const start = tr.startState;
  let result: Tracked;
  try {
    result = untrackEdits(start, start.doc.toString(), start.field(parsedField), edits, backward);
  } catch (error) {
    if (error instanceof EditError) return { effects: refusedEditEffect.of(error.message) };
    throw error;
  }
  if (JSON.stringify(result.changes.toJSON()) === JSON.stringify(tr.changes.toJSON())) {
    // Marked so that the caret moves out of hidden text, which the edit can leave it in when it
    // brings markers together.
    return [tr, { annotations: trackedEditAnnotation.of(true), sequential: true }];
  }
  return rewritten(tr, result.changes, result.caret);
}

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

/** Text an input method composes outside Raw (see `compositionField`). */
function isDeferred(tr: Transaction): boolean {
  return (
    tr.isUserEvent('input.type.compose') &&
    !tr.annotation(trackedEditAnnotation) &&
    tr.startState.field(viewModeField) !== 'raw'
  );
}

const typingFilter = EditorState.transactionFilter.of((tr) => {
  const start = tr.startState;
  if (start.field(viewModeField) === 'raw') {
    // Markdown's own Enter and Backspace edit without looking at the read-only setting.
    const refused = tr.docChanged && isUserEdit(tr) && rawIsReadOnly(start);
    return refused ? { effects: refusedEditEffect.of(RAW_READ_ONLY) } : tr;
  }
  if (tr.annotation(trackedEditAnnotation) || tr.annotation(Transaction.remote)) return tr;
  if (!tr.docChanged) return tr.selection ? selectionInBody(tr) : tr;
  if (!isUserEdit(tr) || isDeferred(tr)) return tr;
  let edits = inBody(editsOf(tr), bodyEnd(start.field(parsedField)));
  const backward = tr.isUserEvent('delete.backward');
  if (backward || tr.isUserEvent('delete.forward')) edits = pastHiddenText(start, edits, !backward);
  if (start.field(trackingField)) return trackedSpec(tr, keepingSpaces(tr, edits), backward);
  return untrackedSpec(tr, edits, backward);
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
 * when the composition ends it becomes a tracked change, or with Track Changes off what the format
 * makes of an untracked edit (the text moved out of an insertion it was composed at the end of), in
 * a step that history joins to it.
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

/** Turns a finished composition into a tracked change, or an untracked edit with Track Changes
 * off, or takes it back when that can't be. */
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
    const parsed = parse(text, state.field(parsedField));
    const tracking = state.field(trackingField);
    const made = (tracking ? trackEdits : untrackEdits)(state, text, parsed, edits, false);
    // Text composed with Track Changes off that goes in as it was composed needs no step.
    if (!tracking && made.changes.apply(base).eq(state.doc)) {
      view.dispatch({ effects: composedEffect.of(null) });
      return;
    }
    changes = back.compose(made.changes);
    if (made.caret !== null) selection = EditorSelection.cursor(made.caret);
    if (tracking && suggests(state, base, edits, made.changes)) {
      effects.push(setViewModeEffect.of('redlines'));
    }
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

/** Raw is read-only while Track Changes is on (see `rawIsReadOnly`). */
const rawWhileTracking = EditorState.readOnly.compute(
  [trackingField, viewModeField],
  rawIsReadOnly,
);

/** In Raw while it is read-only, says why what the page would edit doesn't go in. */
function sayReadOnly(view: EditorView): void {
  if (rawIsReadOnly(view.state)) view.dispatch({ effects: refusedEditEffect.of(RAW_READ_ONLY) });
}

/**
 * Typing, deleting, pasting, cutting and dropping in Raw while it is read-only, which the editor
 * takes no change from. Undo and Redo say why themselves.
 */
const rawEditsRefused = EditorView.domEventObservers({
  beforeinput(event, view) {
    if (!event.inputType.startsWith('history')) sayReadOnly(view);
  },
  paste: (_event, view) => sayReadOnly(view),
  cut: (_event, view) => sayReadOnly(view),
  drop: (_event, view) => sayReadOnly(view),
});

/** Track Changes: the setting, and the author's edits as tracked changes while it is on. */
export function trackedTyping(): Extension {
  return [
    trackingField,
    compositionField,
    typingFilter,
    compositionEnd,
    rawWhileTracking,
    rawEditsRefused,
  ];
}
