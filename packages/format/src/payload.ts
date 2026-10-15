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

/** The characters that would form an escape with a backslash written before them. */
const ESCAPED_AFTER_BACKSLASH = new Set(['-', 'n', 'x', '|', '{', '%', '\\', '`', '\n']);

/** Encodes text as a one-line payload. */
export function encodePayload(text: string): string {
  const s = text.replace(/\r\n?/g, '\n');
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charAt(i);
    const previous = s.charAt(i - 1);
    switch (c) {
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
      case '\\':
        out += ESCAPED_AFTER_BACKSLASH.has(s.charAt(i + 1)) ? '\\\\' : '\\';
        break;
      default:
        out += c;
    }
  }
  return out;
}

/** Decodes a payload written by `encodePayload`. */
export function decodePayload(written: string): string {
  let out = '';
  for (let i = 0; i < written.length; i++) {
    const c = written.charAt(i);
    const next = written.charAt(i + 1);
    if (c !== '\\') {
      out += c;
    } else if (next === 'n') {
      out += '\n';
      i++;
    } else if (next === '\\' || next === '-' || next === '|' || next === '{' || next === '%') {
      out += next;
      i++;
    } else if (next === 'x' && /^[0-9a-f]{2}$/i.test(written.slice(i + 2, i + 4))) {
      out += String.fromCharCode(parseInt(written.slice(i + 2, i + 4), 16));
      i += 3;
    } else {
      // Any other backslash is literal.
      out += c;
    }
  }
  return out;
}
