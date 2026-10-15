import { describe, expect, it } from 'vitest';
import { decodePayload, encodePayload } from './payload.ts';

// Every character the encoding treats specially, and some that only look special.
const ALPHABET = ['a', '-', '\\', '\n', '`', '|', '{', '%', 'x', 'n', ' ', '}'];

// Strings of up to 4 characters (22,621 of them) by default; up to 5 (271,453) with
// PAYLOAD_EXHAUSTIVE=1.
const MAX_LENGTH = process.env.PAYLOAD_EXHAUSTIVE === '1' ? 5 : 4;

/** Every string of up to `max` characters over `alphabet`, starting with the empty string. */
function* strings(alphabet: readonly string[], max: number): Generator<string> {
  let shorter = [''];
  yield '';
  for (let length = 1; length <= max; length++) {
    shorter = shorter.flatMap((s) => alphabet.map((c) => s + c));
    yield* shorter;
  }
}

/** What would be wrong with `written` inside an HTML comment in a Markdown file. */
function problems(written: string): string[] {
  const found: string[] = [];
  if (written.includes('--')) found.push('--');
  if (written.endsWith('-')) found.push('a final -');
  if (written.includes('`')) found.push('a backtick');
  if (/[\n\r]/.test(written)) found.push('a line break');
  if (written.includes('{{')) found.push('{{');
  if (written.includes('{%')) found.push('{%');
  if (written.includes('-->')) found.push('-->');
  // A `|` is escaped when an odd number of backslashes come right before it.
  if (/(?:^|[^\\])(?:\\\\)*\|/.test(written)) found.push('an unescaped |');
  return found;
}

const show = (s: string) => JSON.stringify(s);

describe(`every string of up to ${MAX_LENGTH} characters`, () => {
  it('round-trips', () => {
    const failures: string[] = [];
    let count = 0;
    for (const text of strings(ALPHABET, MAX_LENGTH)) {
      count++;
      const written = encodePayload(text);
      const back = decodePayload(written);
      if (back !== text) failures.push(`${show(text)} → ${show(written)} → ${show(back)}`);
    }
    expect(failures.slice(0, 20)).toEqual([]);
    expect(count).toBe((ALPHABET.length ** (MAX_LENGTH + 1) - 1) / (ALPHABET.length - 1));
  });

  it('encodes to a safe payload', () => {
    const failures: string[] = [];
    for (const text of strings(ALPHABET, MAX_LENGTH)) {
      const written = encodePayload(text);
      for (const problem of problems(written)) {
        failures.push(`${show(text)} → ${show(written)} has ${problem}`);
      }
    }
    expect(failures.slice(0, 20)).toEqual([]);
  });
});

describe('encodePayload', () => {
  it.each([
    // The examples from the spec
    ['a--', 'a-\\x2d'],
    ['---', '-\\-\\x2d'],
    ['x---y', 'x-\\-\\-y'],
    ['-->', '-\\->'],
    // One for each rule
    ['one\ntwo', 'one\\ntwo'],
    ['a `b`', 'a \\x60b\\x60'],
    ['a | b', 'a \\| b'],
    ['{{ x }} {% y %}', '{\\{ x }} {\\% y %}'],
    ['{{{', '{\\{\\{'],
    ['C:\\new', 'C:\\\\new'],
    ['a\\-', 'a\\\\\\x2d'],
    // Other backslashes stay as they are.
    ['\\*not emphasis\\*', '\\*not emphasis\\*'],
    ['ends with \\', 'ends with \\'],
  ])('writes %j as %j', (text, written) => {
    expect(encodePayload(text)).toBe(written);
    expect(decodePayload(written)).toBe(text);
  });

  it('turns CRLF and CR into line breaks', () => {
    expect(encodePayload('a\r\nb\rc')).toBe('a\\nb\\nc');
  });
});

describe('decodePayload', () => {
  it('reads \\xHH as that character and any other backslash as itself', () => {
    expect(decodePayload('\\x41\\x2D \\x4 \\xzz \\q \\')).toBe('A- \\x4 \\xzz \\q \\');
  });
});
