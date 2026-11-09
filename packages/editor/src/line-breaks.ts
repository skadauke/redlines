// A file's line breaks (format §9.2: untouched parts of a file keep their line endings).
// CodeMirror's document always has LF line breaks, so its positions are the editor's offsets.
// The file's text is put back on the way out: while the document still matches the file as
// given, that string byte for byte; after edits, each line break the file had keeps its own
// style, and new ones take the file's line ending, the style of its first line break. The
// ledger's line breaks, and its blank line's, are the format's instead (format §2.5, §5.1), so
// that the editor writes the ledger the command line writes, and the command line can read it.

import {
  type EditorState,
  type Extension,
  RangeSet,
  RangeValue,
  StateEffect,
  StateField,
  Text,
} from '@codemirror/state';
import { eolOf, parse, type Range as TextRange } from '@redlines/format';
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

/** Puts a newly loaded file's line breaks in place of the tracked ones. */
const resetLineBreaks = StateEffect.define<RangeSet<LineBreak>>();

const lineBreaks = StateField.define<RangeSet<LineBreak>>({
  create: () => RangeSet.empty,
  update(breaks, tr) {
    for (const effect of tr.effects) if (effect.is(resetLineBreaks)) return effect.value;
    if (!tr.docChanged || !breaks.size) return breaks;
    // A line break replaced on its own keeps its range, now over the new text: keep only the
    // ranges that still stand on a single LF.
    return breaks.map(tr.changes).update({
      filter: (from, to) => to - from === 1 && tr.newDoc.sliceString(from, to) === '\n',
    });
  },
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
  /** Tracks the file's other line breaks through edits; install it with the document. */
  extension: Extension;
  /**
   * Starts tracking the file's line breaks in an editor that has another version of the file:
   * add it to the transaction that makes the document this file's.
   */
  reset: StateEffect<unknown>;
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
  return {
    text,
    lineBreak: ending,
    formatBreak: eolOf(text),
    doc,
    extension: lineBreaks.init(() => set),
    reset: resetLineBreaks.of(set),
  };
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

/** The file's text for the document in `state`. */
export function fileText(file: LoadedFile, state: EditorState): string {
  const { doc } = state;
  if (doc.eq(file.doc)) return file.text;
  const kept = state.field(lineBreaks);
  const ledger = state.field(parsedField, false)?.ledgerRange ?? null;
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
