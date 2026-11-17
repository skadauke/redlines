// Format intents, below the editor (multiuser §4.2): writeFormat writes what the format does and
// says how, and deriveFormat writes it again, for every writer and for several ranges.
import { applyChanges, newestView } from '@redlines/format';
import type { FormatOp } from '@redlines/format';
import { describe, expect, it } from 'vitest';
import { deriveFormat, writeFormat } from './format-intent.ts';

const ada = { handle: 'ada', name: 'Ada Lovelace' };
const time = '2026-11-17T10:00Z';
const bold: FormatOp = { kind: 'inline', format: 'bold', on: true };

/** A source with a stream of its own, to give ids that differ. */
const source = () => {
  let a = 20261117;
  return (n: number) =>
    Uint8Array.from({ length: n }, () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return (t ^ (t >>> 14)) & 0xff;
    });
};

const text = 'One two three four.\n\nFive six seven.\n';
const ranges = [
  { from: 4, to: 7 },
  { from: 8, to: 13 },
  { from: 26, to: 29 },
];

describe('writing a format and deriving it again', () => {
  it.each([
    ['one range, tracked', { tracking: true, ranges: ranges.slice(0, 1) }],
    ['one range, fine', { tracking: true, ranges: ranges.slice(0, 1), writer: 'fine' as const }],
    ['one range, composed', { tracking: true, ranges: ranges.slice(0, 1), compose: true }],
    ['ranges, together', { tracking: true, ranges, writer: 'ranges' as const, group: 'g3g3' }],
    ['ranges, one at a time', { tracking: true, ranges, group: 'g3g3' }],
    ['one range, untracked', { tracking: false, ranges: ranges.slice(0, 1) }],
    ['ranges, untracked', { tracking: false, ranges }],
  ])('%s gives the same changes the second time', (_, request) => {
    const first = writeFormat(text, { ...request, op: bold, author: ada, time, random: source() });
    expect(first.changes.length).toBeGreaterThan(0);
    const intent = { ...first.intent, id: 'x' };
    expect(deriveFormat(text, intent)).toEqual(first.changes);
    expect(deriveFormat(text, intent)).toEqual(first.changes);
  });

  it('formats the same words at their new places', () => {
    const first = writeFormat(text, {
      tracking: true,
      ranges: ranges.slice(0, 1),
      op: bold,
      author: ada,
      time,
      random: source(),
    });
    const newer = `Zero ${text}`;
    const changes = deriveFormat(newer, { ...first.intent, id: 'x' }, [{ from: 9, to: 12 }]);
    expect(newestView(applyChanges(newer, changes)).text).toContain('Zero One **two** three');
    expect(applyChanges(newer, changes)).toContain('**two**');
  });

  it('does nothing for words that are gone', () => {
    const first = writeFormat(text, {
      tracking: false,
      ranges: ranges.slice(0, 1),
      op: bold,
      author: ada,
      time,
    });
    expect(deriveFormat(text, { ...first.intent, id: 'x' }, [])).toEqual([]);
  });

  it('draws past an id that is taken on newer text', () => {
    const first = writeFormat(text, {
      tracking: true,
      ranges: ranges.slice(0, 1),
      op: bold,
      author: ada,
      time,
      random: source(),
    });
    const id = /<!--fmt (\w+) /.exec(first.changes.map((c) => c.insert).join(''))![1]!;
    const newer = `${text}Taken: ${id}\n`;
    const changes = deriveFormat(newer, { ...first.intent, id: 'x' });
    expect(changes.map((c) => c.insert).join('')).not.toContain(`<!--fmt ${id} `);
  });

  it('needs an author when tracked', () => {
    expect(() =>
      writeFormat(text, { tracking: true, ranges, op: bold, author: null, time }),
    ).toThrow(TypeError);
  });
});
