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
//
// In a payload as the code holds it, U+FFFF is an escape, and always has a letter after it: `a` for
// an LF in a CRLF file (`LF_IN_CRLF`), `b` for a U+FFFF of the text itself (`LITERAL_FFFF`), so that
// text which holds that character comes back as it was (#943). A U+FFFF in a file's payload is
// written as it is, and no file written before has one: the old writer made it an `\x0a`.

/** What `\x0a` decodes to: an LF that stays an LF in a file whose line breaks are CRLF, where the
 * LF that `\n` stands for comes back as a CRLF. */
export const LF_IN_CRLF = '\uffffa';

/** A U+FFFF of the text, in a payload as the code holds it. */
export const LITERAL_FFFF = '\uffffb';

/** `s` with each U+FFFF of its text as a payload holds it. */
const literalFfff = (s: string): string => s.replaceAll('\uffff', LITERAL_FFFF);

/** The characters that would form an escape with a backslash written before them. */
const ESCAPED_AFTER_BACKSLASH = new Set(['-', 'n', 'x', '|', '{', '%', '\\', '`', '\n', '\r']);

/**
 * The text of a file, as the payload that stands for it holds it (what `decodePayload` gives): a
 * line break of the file's kind, `style`, is `\n`, and one of another kind stays what it is, an LF
 * in a CRLF file as `LF_IN_CRLF`.
 */
export function payloadText(raw: string, style: '\r\n' | '\n'): string {
  // One pass of replace, not a split and a string built by parts: a code block of thousands of
  // lines is read on its first key. A CRLF right after a CR alone stays explicit: `\r` and an
  // implicit `\n` would read as one CRLF. A U+FFFF of the text is held as `LITERAL_FFFF` (#943).
  return raw.replace(/\r\n|\r|\n|\uffff/g, (found, at: number) =>
    found === '\uffff'
      ? LITERAL_FFFF
      : found === style && raw.charAt(at - 1) !== '\r'
        ? '\n'
        : found === '\n'
          ? LF_IN_CRLF
          : found,
  );
}

/**
 * Encodes text as a one-line payload. With `style`, the line breaks of the file the text is from, a
 * line break of the other kind is written as the kind it is (above). Without it, every line break
 * is written as `\n`, for text that has no kind of its own.
 */
export function encodePayload(text: string, style?: '\r\n' | '\n'): string {
  return encodePayloadText(
    style === undefined ? literalFfff(text.replace(/\r\n?/g, '\n')) : payloadText(text, style),
  );
}

/** Encodes text that is already as a payload holds it: `\n` the file's own line break (above). */
export function encodePayloadText(s: string): string {
  // Only the characters below are written otherwise: the text between them is copied as it is, which
  // is most of a long payload, such as a whole block of code.
  let out = '';
  let copied = 0;
  const special = /[\r\uffff\n`|\-{%\\\u2028\u2029]/g;
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
      case '\uffff': {
        // An LF of a CRLF file, or a U+FFFF of the text, by the letter after it.
        const letter = s.charAt(i + 1);
        out += letter === 'a' ? '\\x0a' : '\uffff';
        if (letter === 'a' || letter === 'b') copied = special.lastIndex = i + 2;
        break;
      }
      case '\n':
        out += '\\n';
        break;
      case '\u2028':
      case '\u2029':
        // A YAML 1.1 reader (PyYAML) takes these two for line breaks inside a literal block.
        out += c === '\u2028' ? '\\u2028' : '\\u2029';
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
        // A backslash, the one character left of `special`.
        out +=
          ESCAPED_AFTER_BACKSLASH.has(s.charAt(i + 1)) ||
          s.startsWith(LF_IN_CRLF, i + 1) ||
          // A U+2028 or U+2029 after it is written `\u2028` too.
          s.charAt(i + 1) === '\u2028' ||
          s.charAt(i + 1) === '\u2029' ||
          s.startsWith('u2028', i + 1) ||
          s.startsWith('u2029', i + 1)
            ? '\\\\'
            : '\\';
    }
  }
  return out + s.slice(copied);
}

/** The escapes of `encodePayload`, and what each stands for. */
const ESCAPE = /\\(?:n|[\\|{%-]|x[0-9a-fA-F]{2}|u202[89])|\uffff/g;

/** Decodes a payload written by `encodePayload`. */
export function decodePayload(written: string): string {
  if (!written.includes('\\') && !written.includes('\uffff')) return written;
  // Left to right, an escape and then what follows it: `\\` is one backslash, so the `n` after it
  // is a letter. Any other backslash is literal.
  return written.replace(ESCAPE, (escape) => {
    if (escape === '\uffff') return LITERAL_FFFF;
    const c = escape.charAt(1);
    if (c === 'n') return '\n';
    if (c === 'u') return String.fromCharCode(parseInt(escape.slice(2), 16));
    if (c !== 'x') return c;
    const code = parseInt(escape.slice(2), 16);
    return code === 0x0a ? LF_IN_CRLF : String.fromCharCode(code);
  });
}

/** Decodes a value that has no payload's meaning for the line breaks (a comment's text, a format
 * operation's value): an LF in a CRLF file is an LF, and a U+FFFF is itself. */
export function decodeText(written: string): string {
  return decodePayload(written).replace(/\uffff([ab])/g, (_, k: string) =>
    k === 'a' ? '\n' : '\uffff',
  );
}
