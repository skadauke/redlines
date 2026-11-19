// A tracked move of a table to any gap, not only the ones beside it (#1279): the move is written so
// that the file reads the table as a table in every order of decisions, judged by micromark, or it is
// widened to the blocks it passes.

import { describe, expect, it, vi } from 'vitest';
import { blockRunAt, trackedBlockMove } from './block-move.ts';
import { applyChanges } from './changes.ts';
import { fineEdits } from './track.ts';
import { expectEveryOrderRead } from './oracle.ts';
import { ada, context, file } from './test-helpers.ts';
import { newestView, originalView } from './views.ts';

vi.setConfig({ testTimeout: 60_000 });

/** A deterministic random source of its own, for ids. */
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

/** The cases of the issue: where the table stands, and what is around it. */
const FILES: Record<string, string> = {
  'between paragraphs': `One.\n\n${TABLE}\n\nThree.\n\nFour.\n\nFive.\n`,
  'first in the file': `${TABLE}\n\nTwo.\n\nThree.\n\nFour.\n`,
  'last in the file': `One.\n\nTwo.\n\nThree.\n\n${TABLE}\n`,
  'under headings': `# Head\n\n${TABLE}\n\n## Sub\n\nText.\n\nMore.\n`,
  'next to another table': `${TABLE}\n\nMid.\n\n| C | D |\n| - | - |\n| 3 | 4 |\n\nEnd.\n`,
  'in a quote, with blocks around': `> Quote.\n>\n> ${TABLE.replaceAll('\n', '\n> ')}\n>\n> After.\n\nOutside.\n`,
  'in a list item, with other items': `- one\n- two\n\n  ${TABLE.replaceAll('\n', '\n  ')}\n\n  after\n- three\n\nEnd.\n`,
  'across ten blocks (no cap)': `${TABLE}\n\n${Array.from({ length: 10 }, (_, i) => `Block ${i}.`).join('\n\n')}\n`,
  CRLF: `One.\n\n${TABLE}\n\nThree.\n\nFour.\n`.replaceAll('\n', '\r\n'),
};

/** The same file with a one-line paragraph where the table is, for the count to be read beside. */
function asParagraph(body: string): string {
  const lines = body.split(/(?<=\n)/);
  const at = lines.findIndex((line) => line.includes('| A | B |'));
  const prefix = /^(\s*(?:>\s?)*)/.exec(lines[at]!)?.[1] ?? '';
  const eol = lines[at]!.endsWith('\r\n') ? '\r\n' : '\n';
  lines.splice(at, 3, `${prefix}Moved.${eol}`);
  return lines.join('');
}

const counts: string[] = [];

describe('a table typed or pasted with Track Changes on (#1279)', () => {
  it('is written with its rows one line break apart, and reads as a table in every order', () => {
    const text = file('One.\n\nTwo.\n');
    const at = text.indexOf('Two.');
    const { changes } = fineEdits(text, [{ from: at, to: at, insert: `${TABLE}\n\n` }], {
      ...context(ada),
      random: source(5),
    });
    const after = applyChanges(text, changes);
    expect(after).not.toMatch(/\|<!--split/);
    expectEveryOrderRead('pasted table', after);
    expect(newestView(after).text).toContain(TABLE);
  });
});

describe('a tracked move of a table to every gap (#1279)', () => {
  for (const [name, body] of Object.entries(FILES)) {
    it(`${name}: every gap reads as a table in every order`, () => {
      const text = file(body);
      const view = newestView(text);
      const at = view.text.indexOf('| A |');
      const run = blockRunAt(text, {
        from: view.map.toSource(at, 1),
        to: view.map.toSource(view.text.indexOf('| 1 | 2 |', at) + '| 1 | 2 |'.length, -1),
      });
      expect(run, name).toBeDefined();
      for (const gap of run!.gaps) {
        const label = `${name}, gap ${gap.index}`;
        const result = trackedBlockMove(text, run!, gap, { ...context(ada), random: source(7) });
        expect(result, label).toBeDefined();
        const after = applyChanges(text, result!.changes);
        const refused = expectEveryOrderRead(label, after);
        // Beside the same move of a paragraph: no more decisions are refused.
        const para = file(asParagraph(body));
        const pview = newestView(para);
        const pat = pview.text.indexOf('Moved.');
        const prun = blockRunAt(para, {
          from: pview.map.toSource(pat, 1),
          to: pview.map.toSource(pat + 'Moved.'.length, -1),
        });
        const pgap = prun?.gaps.find((g) => g.index === gap.index);
        if (prun && pgap) {
          const pdone = trackedBlockMove(para, prun, pgap, { ...context(ada), random: source(7) });
          const pafter = applyChanges(para, pdone!.changes);
          const prefused = expectEveryOrderRead(`${label} (paragraph)`, pafter);
          counts.push(`${label}: table ${refused.length}, paragraph ${prefused.length}`);
          expect(refused.length, `${label}: refused decisions`).toBeLessThanOrEqual(
            prefused.length,
          );
        }
        // Rejected, the file is the original; accepted, the table has moved whole.
        expect(originalView(after).text.replace(/\r/g, ''), label).toBe(
          originalView(text).text.replace(/\r/g, ''),
        );
        const newest = newestView(after)
          .text.replace(/\r/g, '')
          .replace(/^[ \t>]*/gm, '');
        expect(newest, label).toContain(TABLE);
      }
    });
  }

  it('several moves to the top of the file in a row read as tables in every order', () => {
    let text = file(`One.\n\n${TABLE}\n\nTwo.\n\n| C | D |\n| - | - |\n| 3 | 4 |\n\nThree.\n`);
    const top = (needle: string, last: string, seed: number) => {
      const view = newestView(text);
      const at = view.text.indexOf(needle);
      const end = view.text.indexOf(last, at) + last.length;
      const run = blockRunAt(text, {
        from: view.map.toSource(at, 1),
        to: view.map.toSource(end, -1),
      })!;
      const gap = run.gaps.find((g) => g.index === 0)!;
      const done = trackedBlockMove(text, run, gap, { ...context(ada), random: source(seed) });
      expect(done).toBeDefined();
      text = applyChanges(text, done!.changes);
      expectEveryOrderRead(`to the top: ${needle}`, text);
    };
    top('| C | D |', '| 3 | 4 |', 11);
    top('| A | B |', '| 1 | 2 |', 29);
    const newest = newestView(text).text;
    expect(newest.indexOf('| A | B |')).toBeLessThan(newest.indexOf('| C | D |'));
    expect(newest.indexOf('| C | D |')).toBeLessThan(newest.indexOf('One.'));
  });
});

describe('the counts', () => {
  it('are printed', () => {
    console.log(counts.join('\n'));
  });
});
