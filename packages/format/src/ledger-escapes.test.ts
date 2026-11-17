import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { addComment } from './comments.ts';
import { decodePayload, encodePayload } from './payload.ts';
import { parse } from './parse.ts';
import { ada, context } from './test-helpers.ts';

const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);
const SOH = String.fromCharCode(1);

/** A file with one comment of this text, and the text that is read back from it. */
function commented(text: string): { back: string; ledger: string } {
  const body = 'Hello world.\n';
  const { changes, id } = addComment(body, { from: 0, to: 5 }, text, context(ada, ['c8d2']));
  const file = applyChanges(body, changes);
  const ledger = file.slice(file.indexOf('<!-- redlines'));
  return { back: parse(file).ledger.comments.find((t) => t.id === id)?.text ?? 'MISSING', ledger };
}

describe('a comment whose text a second YAML reader would read otherwise (format §5.5)', () => {
  it.each([
    ['U+2028', `a${LS}b`],
    ['U+2029', `a${PS}b`],
    ['a backslash before U+2028', `a\\${LS}b`],
    ['a backslash before a control character', `a\\${SOH}b`],
    ['two backslashes before a control character', `a\\\\${SOH}b`],
    ['a backslash before a control character at the end', `\\${SOH}`],
    ['the letters of an escape for U+2028', 'a\\u2028b'],
    ['a backslash before the letters of an escape', 'a\\\\u2029b'],
    ['a line of spaces', 'a\n   \nb'],
    ['a line of tabs and spaces', 'a\n \t \nb'],
    ['a first line of spaces', '  \nb'],
  ])('reads back %s as it was written', (_, text) => {
    const { back, ledger } = commented(text);
    expect(back).toBe(text);
    // Nothing that a YAML 1.1 reader takes for a line break, or a Markdown tool for a blank line.
    expect(ledger).not.toContain(LS);
    expect(ledger).not.toContain(PS);
    expect(ledger.split('\n').filter((l) => l !== '' && l.trim() === '')).toEqual([]);
  });

  it('writes a line of only spaces as escapes', () => {
    expect(commented('a\n   \nb').ledger).toContain('\\x20\\x20\\x20');
  });

  it('keeps a payload with the two separators round-tripping', () => {
    for (const text of [`a${LS}b${PS}`, 'a\\u2028', '\\\\u2028', `\\${LS}`]) {
      expect(decodePayload(encodePayload(text)), text).toBe(text);
    }
    expect(encodePayload(`x${LS}`)).toBe('x\\u2028');
  });
});
