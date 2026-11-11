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

/** The escapes of `encodePayload`, and what each stands for. */
const ESCAPE = /\\(?:n|[\\|{%-]|x[0-9a-fA-F]{2})/g;

/** Decodes a payload written by `encodePayload`. */
export function decodePayload(written: string): string {
  if (!written.includes('\\')) return written;
  // Left to right, an escape and then what follows it: `\\` is one backslash, so the `n` after it
  // is a letter. Any other backslash is literal.
  return written.replace(ESCAPE, (escape) => {
    const c = escape.charAt(1);
    return c === 'n' ? '\n' : c === 'x' ? String.fromCharCode(parseInt(escape.slice(2), 16)) : c;
  });
}
