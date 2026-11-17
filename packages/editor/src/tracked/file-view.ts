// The file's text beside the editor's document, for a file with line breaks of more than one kind
// (#924). The document has LF line breaks only, so the format, which reads a text's own kinds,
// can't name the kind of a break that a change takes out. The funnel gives it the file's text
// instead, and brings what it writes back to the document: a CRLF is one character there.

import { eolOf, type TextChange } from '@redlines/format';

const BREAK = /\r\n?|\n/g;

/** A file's text and the way between its offsets and the document's. */
export class FileView {
  readonly text: string;
  /** The offset of each CRLF's CR in the file; the document has one LF there. */
  readonly #crlfs: number[] = [];

  constructor(text: string) {
    this.text = text;
    for (const match of text.matchAll(BREAK)) {
      if (match[0] === '\r\n') this.#crlfs.push(match.index);
    }
  }

  /** The file's own line break, for text typed or pasted as LF. */
  get eol(): '\r\n' | '\n' {
    return eolOf(this.text);
  }

  /** The offset in the file of a document offset. */
  toFile(pos: number): number {
    // The i-th CRLF has its LF at `crlfs[i] - i` in the document.
    let n = 0;
    while (n < this.#crlfs.length && this.#crlfs[n]! - n < pos) n++;
    return pos + n;
  }

  /** The offset in the document of a file offset; between a CR and its LF is before the break. */
  toDoc(pos: number): number {
    let n = 0;
    while (n < this.#crlfs.length && this.#crlfs[n]! + 2 <= pos) n++;
    return pos - n - (n < this.#crlfs.length && this.#crlfs[n]! + 1 === pos ? 1 : 0);
  }

  /** A change of the document as one of the file: typed line breaks are the file's own. */
  changeToFile(change: TextChange): TextChange {
    const eol = this.eol;
    return {
      from: this.toFile(change.from),
      to: this.toFile(change.to),
      insert: change.insert.replace(BREAK, eol),
    };
  }

  /** A change of the file as one of the document, the line breaks of its text as LFs. */
  changeToDoc(change: TextChange): TextChange {
    return {
      from: this.toDoc(change.from),
      to: this.toDoc(change.to),
      insert: change.insert.replace(BREAK, '\n'),
    };
  }

  /**
   * Changes of the file as changes of the document, with the style of each line break they bring
   * that isn't `ending`, the file's, on its LF in the document after them.
   */
  changesToDoc(
    changes: readonly TextChange[],
    ending: string,
  ): { changes: TextChange[]; styles: { at: number; style: string }[] } {
    const out: TextChange[] = [];
    const styles: { at: number; style: string }[] = [];
    let shift = 0;
    for (const change of [...changes].sort((a, b) => a.from - b.from)) {
      const doc = this.changeToDoc(change);
      for (const match of change.insert.matchAll(BREAK)) {
        if (match[0] === ending) continue;
        const before = change.insert.slice(0, match.index).replace(BREAK, '\n').length;
        styles.push({ at: doc.from + shift + before, style: match[0] });
      }
      shift += doc.insert.length - (doc.to - doc.from);
      out.push(doc);
    }
    return { changes: out, styles };
  }
}
