// Payload encoding (format-changes §4). A payload is the text that a `del`, `sub` or `fmt` marker
// carries after its id, author and time, such as the old text in
// `<!--sub p7qd ada 2026-10-13T22:31Z March-->April<!--/p7qd-->`.
//
// An encoded payload is always one line and is safe in an HTML comment anywhere in a Markdown
// file: it has no `--` and doesn't end in `-`, so the comment can't end early; no backtick, so
// knitr finds no code in it; no unescaped `|`, so it can't split a table cell; and no `{{` or
// `{%`, so Liquid (Jekyll, GitHub Pages) runs nothing.
//
// Encoding, after CRLF and CR become LF:
//
//   a line break                          \n
//   a `-` that follows a `-`              \-
//   a `-` that is the last character      \x2d   (instead of the rule above)
//   a backtick                            \x60
//   a `|`                                 \|
//   a `{` or `%` that follows a `{`       \{ \%  (`{{` is `{\{`, `{%` is `{\%`, `{{{` is `{\{\{`)
//   a `\` before - n x | { % \ ` or LF    \\     (anything that would otherwise read as an escape)
//
// Everything else, including any other backslash, is written as it is. Decoding reverses this
// from left to right.

// A line break keeps its own kind (format §2.5). `\n` is a break of the file's kind, which is all
// that a file of one kind needs, and what every file written before had. A break of the other kind
// is written as the kind it is: `\x0d\n` for a CRLF, `\x0d` for a CR, and `\x0a` for an LF in a
// file whose line breaks are CRLF. A reader gives the first two back as the characters they are,
// and the third as `LF_IN_CRLF`, since an LF there would read as the file's own.

/** What `\x0a` decodes to: an LF that stays an LF in a file whose line breaks are CRLF, where the
 * LF that `\n` stands for comes back as a CRLF. A noncharacter, which text never holds. */
export const LF_IN_CRLF = '\uffff';

/** The characters that would form an escape with a backslash written before them. */
const ESCAPED_AFTER_BACKSLASH = new Set([
  '-',
  'n',
  'x',
  '|',
  '{',
  '%',
  '\\',
  '`',
  '\n',
  '\r',
  LF_IN_CRLF,
]);

/**
 * The text of a file, as the payload that stands for it holds it (what `decodePayload` gives): a
 * line break of the file's kind, `style`, is `\n`, and one of another kind stays what it is, an LF
 * in a CRLF file as `LF_IN_CRLF`.
 */
export function payloadText(raw: string, style: '\r\n' | '\n'): string {
  // One pass of replace, not a split and a string built by parts: a code block of thousands of
  // lines is read on its first key.
  return raw.replace(/\r\n|\r|\n/g, (found, at: number) =>
    // A CRLF right after a CR alone stays explicit: `\r` and an implicit `\n` would read as one CRLF.
    found === style && raw.charAt(at - 1) !== '\r' ? '\n' : found === '\n' ? LF_IN_CRLF : found,
  );
}

/**
 * Encodes text as a one-line payload. With `style`, the line breaks of the file the text is from, a
 * line break of the other kind is written as the kind it is (above). Without it, every line break
 * is written as `\n`, for text that has no kind of its own.
 */
export function encodePayload(text: string, style?: '\r\n' | '\n'): string {
  return encodePayloadText(
    style === undefined ? text.replace(/\r\n?/g, '\n') : payloadText(text, style),
  );
}

/** Encodes text that is already as a payload holds it: `\n` the file's own line break (above). */
export function encodePayloadText(s: string): string {
  // Only the characters below are written otherwise: the text between them is copied as it is, which
  // is most of a long payload, such as a whole block of code.
  let out = '';
  let copied = 0;
  const special = /[\r\uffff\n`|\-{%\\]/g;
  for (let found = special.exec(s); found !== null; found = special.exec(s)) {
    const i = found.index;
    const c = s.charAt(i);
    const previous = s.charAt(i - 1);
    out += s.slice(copied, i);
    copied = i + 1;
    switch (c) {
      case '\r':
        // A CRLF, or a CR alone.
        if (s.charAt(i + 1) === '\n') {
          out += '\\x0d\\n';
          copied = special.lastIndex = i + 2;
        } else out += '\\x0d';
        break;
      case LF_IN_CRLF:
        out += '\\x0a';
        break;
      case '\n':
        out += '\\n';
        break;
      case '`':
        out += '\\x60';
        break;
      case '|':
        out += '\\|';
        break;
      case '-':
        if (i === s.length - 1) out += '\\x2d';
        else if (previous === '-') out += '\\-';
        else out += '-';
        break;
      case '{':
      case '%':
        out += previous === '{' ? `\\${c}` : c;
        break;
      default:
        out += ESCAPED_AFTER_BACKSLASH.has(s.charAt(i + 1)) ? '\\\\' : '\\';
    }
  }
  return out + s.slice(copied);
}

/** The escapes of `encodePayload`, and what each stands for. */
const ESCAPE = /\\(?:n|[\\|{%-]|x[0-9a-fA-F]{2})/g;

/** Decodes a payload written by `encodePayload`. */
export function decodePayload(written: string): string {
  if (!written.includes('\\')) return written;
  // Left to right, an escape and then what follows it: `\\` is one backslash, so the `n` after it
  // is a letter. Any other backslash is literal.
  return written.replace(ESCAPE, (escape) => {
    const c = escape.charAt(1);
    if (c === 'n') return '\n';
    if (c !== 'x') return c;
    const code = parseInt(escape.slice(2), 16);
    return code === 0x0a ? LF_IN_CRLF : String.fromCharCode(code);
  });
}
