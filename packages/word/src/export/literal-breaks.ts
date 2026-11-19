/**
 * The line breaks that an insertion was written with as the two characters backslash and `n`.
 *
 * A tool that writes text into a tracked insertion can pass a line break as `\n` the characters (a
 * shell string, a JSON string read twice), and the file then holds `Footnotes<!--ins k3x9-->\n- Tags`
 * on one line. Word showed the two characters. The text of an insertion (and of what a substitution
 * puts in) that stands outside a code span reads `\n` as the line break it was meant to be, so the
 * export writes the paragraphs or the break that the lines would have been (#1178). A backslash
 * before it keeps it (`\\n` is a backslash and an `n`), and so does a code span or a fence.
 */

const OPENING = /<!--(?:ins|sub) ([a-z0-9]{4})\b[^>]*?-->/g;

/** `text` with the literal `\n` of its insertions turned into line breaks. */
export function breakInsertedLiteralNewlines(text: string): string {
  if (!text.includes('\\n')) return text;
  let out = '';
  let at = 0;
  OPENING.lastIndex = 0;
  for (let open = OPENING.exec(text); open !== null; open = OPENING.exec(text)) {
    const start = open.index + open[0].length;
    const closing = `<!--/${open[1]}-->`;
    const end = text.indexOf(closing, start);
    if (end < 0) continue;
    const body = text.slice(start, end);
    out += text.slice(at, start) + breakBody(body);
    at = end;
    OPENING.lastIndex = end;
  }
  return out + text.slice(at);
}

function breakBody(body: string): string {
  if (!body.includes('\\n') || body.includes('```')) return body;
  // Code spans are kept as they are: split on them and change only what is between.
  return body
    .split(/(`+[^`]*`+)/)
    .map((part, i) => (i % 2 === 1 ? part : part.replace(/(\\*)\\n/g, breakOne)))
    .join('');
}

function breakOne(found: string, slashes: string): string {
  // The run of backslashes before the `n` is `slashes` and one more. An even `slashes` makes an odd
  // run, whose last backslash is the one of `\n`; an odd one ends in `\\`, and the `n` is only a letter.
  return slashes.length % 2 === 0 ? slashes + '\n' : found;
}
