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
  type Range,
  RangeSet,
  RangeValue,
  StateEffect,
  StateField,
  Text,
} from '@codemirror/state';
import type { Range as TextRange } from '@redlines/format';
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
  const breaks: Range<LineBreak>[] = [];
  let lineBreak: string | undefined;
  let start = 0;
  let pos = 0;
  for (const match of text.matchAll(/\r\n?|\n/g)) {
    const line = text.slice(start, match.index);
    lines.push(line);
    pos += line.length;
    lineBreak ??= match[0];
    if (match[0] !== lineBreak) breaks.push(new LineBreak(match[0]).range(pos, pos + 1));
    pos += 1;
    start = match.index + match[0].length;
  }
  lines.push(text.slice(start));
  const set = RangeSet.of(breaks);
  return {
    text,
    lineBreak: lineBreak ?? '\n',
    doc: Text.of(lines),
    extension: lineBreaks.init(() => set),
    reset: resetLineBreaks.of(set),
  };
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
 * The line breaks of the ledger and of its blank line, as the format writes them (format §2.5,
 * §5.1), whatever the file's first line break is: CRLF when the body has a CRLF, and when it has
 * none, the style the ledger's first line has. The blank line is two CRLFs after a body that ends
 * in a CR alone. `breakAt(i)` is the style of the break after line i + 1 as the file has it, the
 * ledger's own as they were.
 */
function ledgerStyle(
  doc: Text,
  own: LedgerBreaks,
  breakAt: (i: number) => string,
): { blank: string; lines: string } {
  let crlf = false;
  for (let i = 0; i < doc.lines - 1 && !crlf; i++) {
    if (i < own.first || i >= own.last) crlf = breakAt(i) === '\r\n';
  }
  const lines = crlf || breakAt(own.header) === '\r\n' ? '\r\n' : '\n';
  // The line in front of the blank line is empty: the break before it ends the body.
  const crBefore =
    own.first > 0 && !doc.line(own.first + 1).length && breakAt(own.first - 1) === '\r';
  return { blank: crBefore ? '\r\n' : lines, lines };
}

/** The file's text for the document in `state`. */
export function fileText(file: LoadedFile, state: EditorState): string {
  const { doc } = state;
  if (doc.eq(file.doc)) return file.text;
  const kept = state.field(lineBreaks);
  const ledger = state.field(parsedField, false)?.ledgerRange ?? null;
  const own = ledgerBreaks(doc, ledger);
  const lineBreak = file.lineBreak;
  if (!kept.size && (!own || !ledger)) return doc.sliceString(0, doc.length, lineBreak);
  if (!kept.size && own && ledger) {
    // Every other break is the file's line ending.
    const style = ledgerStyle(doc, own, () => lineBreak);
    if (style.blank === lineBreak && style.lines === lineBreak) {
      return doc.sliceString(0, doc.length, lineBreak);
    }
    const header = doc.line(own.header + 1).from;
    return (
      doc.sliceString(0, ledger.from, lineBreak) +
      doc.sliceString(ledger.from, header, style.blank) +
      doc.sliceString(header, ledger.to, style.lines) +
      doc.sliceString(ledger.to, doc.length, lineBreak)
    );
  }
  // The break after each line: its kept style, or the file's line ending.
  const breaks = new Array<string>(doc.lines - 1).fill(lineBreak);
  for (let it = kept.iter(); it.value; it.next()) {
    breaks[doc.lineAt(it.from).number - 1] = it.value.text;
  }
  const isOwn = (i: number) => own !== null && i >= own.first && i < own.last;
  // A lone CR right before a lone LF would read back as a single CRLF, so that CR is written as
  // CRLF. An edit can bring them together across an emptied line; a file can't have them. The
  // ledger's breaks are never a CR, and after one its blank line is CRLFs.
  for (let i = 0; i + 1 < breaks.length; i++) {
    if (isOwn(i) || isOwn(i + 1)) continue;
    if (breaks[i] === '\r' && breaks[i + 1] === '\n' && !doc.line(i + 2).length) breaks[i] = '\r\n';
  }
  if (own) {
    const style = ledgerStyle(doc, own, (i) => breaks[i] ?? lineBreak);
    for (let i = own.first; i < own.last; i++)
      breaks[i] = i < own.header ? style.blank : style.lines;
  }
  let text = doc.line(1).text;
  for (let n = 2; n <= doc.lines; n++) text += breaks[n - 2]! + doc.line(n).text;
  return text;
}
