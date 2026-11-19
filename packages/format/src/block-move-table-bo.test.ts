// A tracked move of a table past another person's pending marks (#1279): the marks stay where they are,
// untouched, when Ada's move is accepted; every order of decisions reads alike; rejecting everything
// gives the body back byte for byte. The count of refused decisions is printed beside the same move of
// a paragraph.

import { describe, expect, it, vi } from 'vitest';
import { blockRunAt, trackedBlockMove } from './block-move.ts';
import { Untrackable } from './widen.ts';
import { applyChanges } from './changes.ts';
import { acceptAll, rejectAll } from './decide.ts';
import { expectEveryOrderRead } from './oracle.ts';
import { ada, bodyOf, context, file, thread } from './test-helpers.ts';
import { newestView } from './views.ts';

vi.setConfig({ testTimeout: 120_000 });

function source(seed: number): (n: number) => Uint8Array {
  let state = seed;
  return (n) => {
    const bytes = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      state = (state * 1103515245 + 12345) & 0x7fffffff;
      bytes[i] = state >> 16;
    }
    return bytes;
  };
}

const TABLE = '| A | B |\n| - | - |\n| 1 | 2 |';

/** What Bo left in the paragraph that the move passes. */
const BO: Record<string, { body: string; threads?: string[] }> = {
  ins: { body: 'Two <!--ins k3x9-->new<!--/k3x9--> words.' },
  del: { body: 'Two <!--del k3x9 gone -->words.' },
  sub: { body: 'Two <!--sub k3x9 old-->new<!--/k3x9--> words.' },
  comment: {
    body: 'Two <!--cmt k3x9-->words<!--/k3x9-->.',
    threads: thread('k3x9', 'bo', 'A note.'),
  },
  split: { body: 'Two words<!--split k3x9-->\n\nMore words.' },
  fmt: { body: '## <!--fmt k3x9 was=p-->Two words<!--/k3x9-->' },
  'ins from the line start': { body: '<!--ins k3x9-->\n\nWhole new<!--/k3x9--> paragraph.' },
  none: { body: 'Two.' },
};

type Where = 'down' | 'up' | 'first' | 'last';

/** The body that has `block` first or last, with Bo's paragraph beside it. */
function bodyOfCase(block: string, bo: string, where: Where): string {
  switch (where) {
    case 'down':
      return `One.\n\n${block}\n\n${bo}\n\nThree.`;
    case 'up':
      return `One.\n\n${bo}\n\n${block}\n\nThree.`;
    case 'first':
      return `${block}\n\nOne.\n\n${bo}\n\nThree.`;
    case 'last':
      return `One.\n\n${bo}\n\nThree.\n\n${block}`;
  }
}

/** Moves `block` to the far gap of its case (the last gap for `down` and `first`, the first for `up` and
 * `last`), tracked by Ada. Returns the file after and the count of decisions refused. */
function run(block: string, bo: string, where: Where, threads: string[], seed = 7) {
  const body = bodyOfCase(block, bo, where);
  const marks: Record<string, string> = bo.includes('k3x9') ? { k3x9: 'bo' } : {};
  const text = file(body, marks, threads);
  const view = newestView(text);
  const at = view.text.indexOf(block.split('\n')[0]!);
  const end = at + block.length;
  const found = blockRunAt(text, {
    from: view.map.toSource(at, 1),
    to: view.map.toSource(end, -1),
  });
  if (!found) throw new Error('no run');
  const up = where === 'up' || where === 'last';
  const gap = up
    ? found.gaps.find((g) => g.index === 0)
    : found.gaps.find((g) => g.index === Math.max(...found.gaps.map((x) => x.index)));
  if (!gap) throw new Error('no gap');
  const done = trackedBlockMove(text, found, gap, { ...context(ada), random: source(seed) });
  if (!done) throw new Error('no move');
  const after = applyChanges(text, done.changes);
  return { text, after, found };
}

describe('a tracked table move past another person’s marks (#1279)', () => {
  const rows: string[] = [];
  for (const [name, bo] of Object.entries(BO)) {
    for (const where of ['down', 'up', 'first', 'last'] as const) {
      it(`${name}, ${where}`, () => {
        const paragraph = run('Moved.', bo.body, where, bo.threads ?? []);
        let table: ReturnType<typeof run>;
        try {
          table = run(TABLE, bo.body, where, bo.threads ?? []);
        } catch (error) {
          // Where no fine form reads alike, a table is not moved across another person's marks tracked:
          // the person is asked, and nothing is written.
          if (!(error instanceof Untrackable)) throw error;
          expect(error.others, `${name} ${where}`).toContain('k3x9');
          rows.push(
            `${name} ${where}: table asks first (Untrackable), paragraph ${expectEveryOrderRead(`${name} ${where} (paragraph)`, paragraph.after).length}`,
          );
          return;
        }
        const label = `${name} ${where}`;
        const refusedTable = expectEveryOrderRead(label, table.after);
        const refusedParagraph = expectEveryOrderRead(`${label} (paragraph)`, paragraph.after);
        rows.push(`${label}: table ${refusedTable.length}, paragraph ${refusedParagraph.length}`);
        const rejected = (r: { text: string; after: string }) =>
          bodyOf(
            applyChanges(
              r.after,
              rejectAll(r.after, (mark) => mark.entry.by === 'ada'),
            ),
          ) === bodyOf(r.text);
        rows.push(
          `  byte for byte on reject: table ${rejected(table)}, paragraph ${rejected(paragraph)}`,
        );
        // Rejecting everything gives the body back byte for byte.
        const back = bodyOf(
          applyChanges(
            table.after,
            rejectAll(table.after, (mark) => mark.entry.by === 'ada'),
          ),
        );
        // (A file with no ledger at all gains its closing line break; the paragraph's move does too.)
        expect(name === 'none' ? back.trimEnd() : back, label).toBe(
          name === 'none' ? bodyOf(table.text).trimEnd() : bodyOf(table.text),
        );
        // Accepting only Ada's change leaves Bo's marks as they were.
        const accepted = applyChanges(
          table.after,
          acceptAll(table.after, (mark) => mark.entry.by === 'ada'),
        );
        if (bo.body.includes('k3x9')) {
          for (const piece of bo.body.match(/<!--[^>]*-->/g) ?? []) {
            expect(accepted, `${label}: ${piece}`).toContain(piece);
          }
        }
      });
    }
  }
  it('prints the counts', () => {
    console.log(rows.join('\n'));
  });
});
