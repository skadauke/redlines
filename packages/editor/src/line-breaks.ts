// A file's line breaks (format §9.2: untouched parts of a file keep their line endings).
// CodeMirror's document always has LF line breaks, so its positions are the editor's offsets.
// The file's text is put back on the way out: while the document still matches the file as
// given, that string byte for byte; after edits, each line break the file had keeps its own
// style, and new ones take the file's line ending, the style of its first line break. The
// ledger's line breaks, and its blank line's, are the format's instead (format §2.5, §5.1), so
// that the editor writes the ledger the command line writes, and the command line can read it.
//
// The loaded file and the record of its line breaks are state, which Undo gives back: a change of
// file (a reload, an agent's edit) carries them as effects, and taking it back gives the file and
// the record from before; an edit of yours that drops a line break of the other style gives the
// record back, since the record forgets the style of a break whose LF is deleted.

import { invertedEffects } from '@codemirror/commands';
import {
  type EditorState,
  type Extension,
  RangeSet,
  RangeValue,
  StateEffect,
  type StateEffectType,
  StateField,
  Text,
  type Transaction,
} from '@codemirror/state';
import { eolOf, parse, type Range as TextRange } from '@redlines/format';
import { takeBackChanges } from './blocks/open.ts';
import { parsedField } from './tracked/field.ts';

/** A line break whose style differs from the file's line ending, on the LF that stands for it. */
class LineBreak extends RangeValue {
  // Text typed on either side of the line break stays outside it; deleting it drops the range.
  override startSide = 1;
  override endSide = -1;
  readonly text: string;

  constructor(text: string) {
    super();
    this.text = text;
  }

  override eq(other: RangeValue): boolean {
    return other instanceof LineBreak && other.text === this.text;
  }
}

/**
 * Puts a record of line breaks in place of the tracked one: a newly loaded file's, or the one an
 * undo gives back. Its ranges map through changes, as the history maps what it keeps.
 */
const resetLineBreaks = StateEffect.define<RangeSet<LineBreak>>({
  map: (breaks, mapping) => breaks.map(mapping),
});

/** Makes a file the editor's: the one it was loaded with, or the one an undo gives back. */
const setFile = StateEffect.define<LoadedFile>();

/** The last of the effects of `type` in `tr`, which stands when there are several. */
function lastOf<T>(tr: Transaction, type: StateEffectType<T>): StateEffect<T> | undefined {
  return tr.effects.findLast((effect): effect is StateEffect<T> => effect.is(type));
}

const lineBreaks = StateField.define<RangeSet<LineBreak>>({
  create: () => RangeSet.empty,
  update(breaks, tr) {
    // Of several, as in the undo of a joined step, the last stands: the record before its first.
    const reset = tr.effects.length ? lastOf(tr, resetLineBreaks) : undefined;
    if (reset) return reset.value;
    if (!tr.docChanged || !breaks.size) return breaks;
    // A line break replaced on its own keeps its range, now over the new text: keep only the
    // ranges that still stand on a single LF.
    return breaks.map(tr.changes).update({
      filter: (from, to) => to - from === 1 && tr.newDoc.sliceString(from, to) === '\n',
    });
  },
});

/** The file the editor has: the one it was loaded with, or a change of file made it. */
const fileField = StateField.define<LoadedFile | null>({
  create: () => null,
  update(file, tr) {
    const set = tr.effects.length ? lastOf(tr, setFile) : undefined;
    return set ? set.value : file;
  },
});

/**
 * What the history keeps to give the file and its line breaks back: for a change of file, the
 * file and the record before it; for any other change that drops a line break of the other style,
 * the record before it. A count of ranges against another, per step.
 */
const lineBreaksBack = invertedEffects.of((tr) => {
  const before = tr.startState.field(lineBreaks);
  if (tr.effects.length && lastOf(tr, setFile)) {
    const file = tr.startState.field(fileField);
    return file ? [setFile.of(file), resetLineBreaks.of(before)] : [resetLineBreaks.of(before)];
  }
  if (tr.docChanged && before.size && tr.state.field(lineBreaks).size < before.size) {
    return [resetLineBreaks.of(before)];
  }
  return [];
});

/** A file as given, with the document CodeMirror holds for it. */
export interface LoadedFile {
  text: string;
  /** The style of the file's first line break, or LF when it has none. */
  lineBreak: string;
  /** The line break the format writes in the file as it was given (`eolOf`): the style of the
   * ledger's lines where the body has no CRLF, as when its last CRLFs are deleted. */
  formatBreak: string;
  doc: Text;
  /** The file and its line breaks as the state holds them: install it with the document. */
  extension: Extension;
  /**
   * Make this the editor's file, its line breaks with it, in a transaction that turns the
   * document into this file's (a reload, an agent's edit). Taking that transaction back gives the
   * file before.
   */
  effects: readonly StateEffect<unknown>[];
}

export function loadFile(text: string): LoadedFile {
  const lines: string[] = [];
  /** Each line break: where its LF is in the document, and how the file writes it. */
  const found: [at: number, style: string][] = [];
  let lineBreak: string | undefined;
  let start = 0;
  let pos = 0;
  for (const match of text.matchAll(/\r\n?|\n/g)) {
    const line = text.slice(start, match.index);
    lines.push(line);
    pos += line.length;
    lineBreak ??= match[0];
    found.push([pos, match[0]]);
    pos += 1;
    start = match.index + match[0].length;
  }
  lines.push(text.slice(start));
  const doc = Text.of(lines);
  const ending = lineBreak ?? '\n';
  // The blank line in front of the ledger is kept as the file has it, whatever its style: the
  // format writes it with a new ledger and never again (format §5.1, §9.2), and so does the editor.
  const blank = blankLineOf(doc);
  const inBlank = (at: number) => blank !== null && at >= blank.from && at < blank.to;
  const breaks = found
    .filter(([at, style]) => style !== ending || inBlank(at))
    .map(([at, style]) => new LineBreak(style).range(at, at + 1));
  const set = RangeSet.of(breaks);
  const loaded: LoadedFile = {
    text,
    lineBreak: ending,
    formatBreak: eolOf(text),
    doc,
    extension: [],
    effects: [],
  };
  loaded.extension = [fileField.init(() => loaded), lineBreaks.init(() => set), lineBreaksBack];
  loaded.effects = [setFile.of(loaded), resetLineBreaks.of(set)];
  return loaded;
}

/** The line breaks of the blank line in front of the document's ledger, as a range of it. */
function blankLineOf(doc: Text): TextRange | null {
  const text = doc.toString();
  if (!text.includes('<!-- redlines')) return null;
  const ledger = parse(text).ledgerRange;
  if (!ledger) return null;
  // The document's line breaks are LFs, and the blank line is at most two of them.
  const blank = /^\n*/.exec(doc.sliceString(ledger.from, ledger.from + 2))?.[0].length ?? 0;
  return { from: ledger.from, to: ledger.from + blank };
}

/**
 * Where the ledger's own line breaks are, as indices into the breaks after each line (the break
 * after line n is n - 1): those of its blank line, `[first, header)`, and those of its lines,
 * `[header, last)`. The break after `-->` is the body's.
 */
interface LedgerBreaks {
  first: number;
  header: number;
  last: number;
}

function ledgerBreaks(doc: Text, ledger: TextRange | null): LedgerBreaks | null {
  if (!ledger) return null;
  // The document's line breaks are LFs, and the blank line is at most two of them.
  const blank = /^\n*/.exec(doc.sliceString(ledger.from, ledger.from + 2))?.[0].length ?? 0;
  return {
    first: doc.lineAt(ledger.from).number - 1,
    header: doc.lineAt(ledger.from + blank).number - 1,
    last: doc.lineAt(ledger.to).number - 1,
  };
}

/**
 * The line breaks of the ledger and of a new blank line in front of it, as the format writes them
 * (format §2.5, §5.1), whatever the file's first line break is: CRLF when the body has a CRLF, and
 * when it has none, the style the ledger's lines had, which the file as it was given tells
 * (`formatBreak`): the editor writes no CRLF into the body that the file didn't have. The blank
 * line is two CRLFs after a body that ends in a CR alone. `breakAt(i)` is the style of the break
 * after line i + 1 as the file has it, the ledger's own as they were.
 */
function ledgerStyle(
  doc: Text,
  own: LedgerBreaks,
  breakAt: (i: number) => string,
  formatBreak: string,
): { blank: string; lines: string } {
  let crlf = false;
  for (let i = 0; i < doc.lines - 1 && !crlf; i++) {
    if (i < own.first || i >= own.last) crlf = breakAt(i) === '\r\n';
  }
  const lines = crlf || formatBreak === '\r\n' ? '\r\n' : '\n';
  // The line in front of the blank line is empty: the break before it ends the body.
  const crBefore =
    own.first > 0 && !doc.line(own.first + 1).length && breakAt(own.first - 1) === '\r';
  return { blank: crBefore ? '\r\n' : lines, lines };
}

/**
 * How the blank line's break `i` is written: as the file has it when it was there when the file
 * was read (`kept`), as the format's in-place rewrite of the ledger leaves it, but for a CR alone,
 * which no reader takes in front of a ledger (format §5.1); and a new one, written with a new
 * ledger, as the format writes it (`blank`).
 */
function blankBreak(kept: string | undefined, blank: string): string {
  return kept !== undefined && kept !== '\r' ? kept : blank;
}

/**
 * The file's text for the document in `state`: with the empty paragraph Return opened taken back
 * (`blocks/open.ts`), since the file never gets it.
 */
export function fileText(state: EditorState): string {
  const back = takeBackChanges(state);
  if (!back) {
    const ledger = state.field(parsedField, false)?.ledgerRange ?? null;
    return textOf(
      state,
      state.doc,
      state.field(lineBreaks, false) ?? (RangeSet.empty as RangeSet<LineBreak>),
      ledger,
    );
  }
  const doc = back.apply(state.doc);
  const breaks = (state.field(lineBreaks, false) ?? (RangeSet.empty as RangeSet<LineBreak>))
    .map(back)
    .update({
      filter: (from, to) => to - from === 1 && doc.sliceString(from, to) === '\n',
    });
  const parsed = state.field(parsedField, false);
  // The ledger of the document with the paragraph taken back: the live one, moved by the take-back
  // (which never touches it), not a parse of the whole file for each update.
  const live = parsed?.ledgerRange;
  const ledger = live ? { from: back.mapPos(live.from, 1), to: back.mapPos(live.to, -1) } : null;
  return textOf(state, doc, breaks, ledger);
}

/** The file's text for `doc`, given the record of its line breaks and its ledger. */
function textOf(
  state: EditorState,
  doc: Text,
  kept: RangeSet<LineBreak>,
  ledger: TextRange | null,
): string {
  const file = state.field(fileField, false);
  if (!file) return doc.toString();
  if (doc.eq(file.doc)) return file.text;
  const own = ledgerBreaks(doc, ledger);
  const lineBreak = file.lineBreak;
  // The breaks that keep their own style, by the line they end (the break after line n is n - 1).
  const keptAt = new Map<number, string>();
  for (let it = kept.iter(); it.value; it.next()) {
    keptAt.set(doc.lineAt(it.from).number - 1, it.value.text);
  }
  if (!own || !ledger) {
    if (!keptAt.size) return doc.sliceString(0, doc.length, lineBreak);
  } else if ([...keptAt.keys()].every((i) => i >= own.first && i < own.header)) {
    // Every other break is the file's line ending: the document in four pieces.
    const style = ledgerStyle(doc, own, (i) => keptAt.get(i) ?? lineBreak, file.formatBreak);
    let blank = '';
    for (let i = own.first; i < own.header; i++) blank += blankBreak(keptAt.get(i), style.blank);
    const header = doc.line(own.header + 1).from;
    return (
      doc.sliceString(0, ledger.from, lineBreak) +
      blank +
      doc.sliceString(header, ledger.to, style.lines) +
      doc.sliceString(ledger.to, doc.length, lineBreak)
    );
  }
  // The break after each line: its kept style, or the file's line ending.
  const breaks = new Array<string>(doc.lines - 1).fill(lineBreak);
  for (const [i, style] of keptAt) breaks[i] = style;
  const isOwn = (i: number) => own !== null && i >= own.first && i < own.last;
  // A lone CR right before a lone LF would read back as a single CRLF, so that CR is written as
  // CRLF. An edit can bring them together across an emptied line; a file can't have them. The
  // ledger's breaks are left out: its lines are never a CR, and its blank line is its own.
  for (let i = 0; i + 1 < breaks.length; i++) {
    if (isOwn(i) || isOwn(i + 1)) continue;
    if (breaks[i] === '\r' && breaks[i + 1] === '\n' && !doc.line(i + 2).length) breaks[i] = '\r\n';
  }
  if (own) {
    const style = ledgerStyle(doc, own, (i) => breaks[i] ?? lineBreak, file.formatBreak);
    for (let i = own.first; i < own.last; i++) {
      breaks[i] = i < own.header ? blankBreak(keptAt.get(i), style.blank) : style.lines;
    }
  }
  let text = doc.line(1).text;
  for (let n = 2; n <= doc.lines; n++) text += breaks[n - 2]! + doc.line(n).text;
  return text;
}
