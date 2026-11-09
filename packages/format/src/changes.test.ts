import { describe, expect, it } from 'vitest';
import { applyChanges, eolOf } from './changes.ts';

describe('eolOf (format §2.5)', () => {
  const ledger = '<!-- redlines\nversion: 1\ntracking: everyone\n-->';
  const crlf = ledger.replaceAll('\n', '\r\n');

  it('is CRLF when the file has one, and LF otherwise', () => {
    expect(eolOf('a\nb\n')).toBe('\n');
    expect(eolOf('a\rb\r')).toBe('\n');
    expect(eolOf('a\nb\r\n')).toBe('\r\n');
    expect(eolOf('')).toBe('\n');
  });

  it("is the body's: the ledger and the blank line in front of it don't count", () => {
    // A CR at the end of the body and the LF that starts the blank line are no CRLF of the body.
    expect(eolOf(`Body.\r\n\n${ledger}\r`)).toBe('\n');
    expect(eolOf(`Body.\r\n\n${ledger}\n`)).toBe('\n');
    expect(eolOf(`Body.\r\nTwo\n\n${ledger}\n`)).toBe('\r\n');
    // Text after the ledger is the body's, and so is the line break after `-->`.
    expect(eolOf(`Body.\n\n${ledger}\r\n`)).toBe('\r\n');
    expect(eolOf(`Body.\n\n${ledger}\nAfter.\r\n`)).toBe('\r\n');
  });

  it('is the ledger’s when the body has no CRLF', () => {
    // As when the body's last CRLFs are deleted: the ledger's lines were written while the body had
    // them, and keep its style.
    expect(eolOf(`Body.\nTwo<!--del k3x9 \\n-->\r\n\r\n${crlf}`)).toBe('\r\n');
    expect(eolOf(`Body.\n\n${crlf}\n`)).toBe('\r\n');
    expect(eolOf(`Body.\r\n\r\n${crlf}\r`)).toBe('\r\n');
    expect(eolOf(`Body.<!--del k3x9 \\n-->\r\n\r\n${crlf}`)).toBe('\r\n');
    expect(eolOf(`Body.\r\n\r\n${crlf}`)).toBe('\r\n');
    expect(eolOf(`Body.\n\n${ledger}`)).toBe('\n');
    expect(eolOf(`Body.\rTwo\r\n\n${ledger}\r`)).toBe('\n');
    expect(eolOf(`${crlf}`)).toBe('\r\n');
  });
});

describe('applyChanges', () => {
  it('applies sorted changes in offsets of the original', () => {
    expect(
      applyChanges('abcdef', [
        { from: 1, to: 3, insert: 'X' },
        { from: 3, to: 3, insert: 'Y' },
        { from: 5, to: 6, insert: '' },
      ]),
    ).toBe('aXYde');
  });

  it('returns the text when there are no changes', () => {
    expect(applyChanges('abc', [])).toBe('abc');
  });

  it('rejects changes that are out of order, overlap or lie outside the text', () => {
    expect(() =>
      applyChanges('abcdef', [
        { from: 3, to: 4, insert: '' },
        { from: 1, to: 2, insert: '' },
      ]),
    ).toThrow(RangeError);
    expect(() =>
      applyChanges('abcdef', [
        { from: 1, to: 4, insert: '' },
        { from: 3, to: 5, insert: '' },
      ]),
    ).toThrow(RangeError);
    expect(() => applyChanges('abc', [{ from: 2, to: 4, insert: '' }])).toThrow(RangeError);
    expect(() => applyChanges('abc', [{ from: 2, to: 1, insert: '' }])).toThrow(RangeError);
  });
});
