// A file's line breaks (format §9.2: untouched parts of a file keep their line endings).
// CodeMirror's document always has LF line breaks, so its positions are the editor's offsets.
// The file's text is put back on the way out: while the document still matches the file as
// given, that string byte for byte; after edits, each line break the file had keeps its own
// style, and new ones take the file's line ending, the style of its first line break.

import {
  type EditorState,
  type Extension,
  type Range,
  RangeSet,
  RangeValue,
  StateField,
  Text,
} from '@codemirror/state';

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

const lineBreaks = StateField.define<RangeSet<LineBreak>>({
  create: () => RangeSet.empty,
  update(breaks, tr) {
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
  };
}

/** The file's text for the document in `state`. */
export function fileText(file: LoadedFile, state: EditorState): string {
  const { doc } = state;
  if (doc.eq(file.doc)) return file.text;
  const kept = state.field(lineBreaks);
  if (!kept.size) return doc.sliceString(0, doc.length, file.lineBreak);
  // The break after each line: its kept style, or the file's line ending.
  const breaks = new Array<string>(doc.lines - 1).fill(file.lineBreak);
  for (let it = kept.iter(); it.value; it.next()) {
    breaks[doc.lineAt(it.from).number - 1] = it.value.text;
  }
  // A lone CR right before a lone LF would read back as a single CRLF, so that CR is written as
  // CRLF. An edit can bring them together across an emptied line; a file can't have them.
  for (let i = 0; i + 1 < breaks.length; i++) {
    if (breaks[i] === '\r' && breaks[i + 1] === '\n' && !doc.line(i + 2).length) breaks[i] = '\r\n';
  }
  let text = doc.line(1).text;
  for (let n = 2; n <= doc.lines; n++) text += breaks[n - 2]! + doc.line(n).text;
  return text;
}
