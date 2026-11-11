import { describe, expect, it, vi } from 'vitest';
import { applyChanges } from './changes.ts';
import { ada, context, file } from './test-helpers.ts';
import { trackedEdit } from './track.ts';

// The tables read, by the keys of this file: `readTables` is called through a spy.
const reads = vi.hoisted(() => ({ count: 0 }));
vi.mock('./table.ts', async (original) => {
  const actual = await original<typeof import('./table.ts')>();
  return {
    ...actual,
    readTables: (...args: Parameters<typeof actual.readTables>) => {
      reads.count++;
      return actual.readTables(...args);
    },
  };
});

const paragraphs = Array.from({ length: 200 }, (_, i) => `Paragraph ${i} of words.`).join('\n\n');
const rows = Array.from({ length: 300 }, (_, i) => `| row ${i} | ${i} |`).join('\n');
const table = `| a | b |\n| - | - |\n${rows}`;

describe('a tracked key outside every table', () => {
  /** How many times the tables of the file were read for one typed letter in a paragraph. */
  const readsFor = (body: string, ledger: Record<string, string>) => {
    const text = file(body, ledger);
    const at = text.indexOf('Paragraph 100') + 3;
    reads.count = 0;
    applyChanges(
      text,
      trackedEdit(text, { from: at, to: at, insert: 'x' }, context(ada, ['k3x9'])),
    );
    return reads.count;
  };

  it('reads no table, with an own row pending as with none', () => {
    const plain = `${paragraphs}\n\n${table}`;
    const pending = `${paragraphs}\n\n${table}\n| <!--ins n4pq row--> new | 1 |`;
    expect(readsFor(plain, {})).toBe(0);
    expect(readsFor(pending, { n4pq: 'ada' })).toBe(0);
  });
});
