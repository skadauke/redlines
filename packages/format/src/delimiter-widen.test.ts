// An edit against an emphasis delimiter in a paragraph that holds another person's marks, written as
// a replacement of the paragraph where the fine form reads otherwise than the newest view in some
// order of decisions (#299, #265; format §3.12). micromark, with GFM, is the oracle.

import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { expectSound, readsAsNewest } from './oracle.ts';
import { ada, bodyOf, context, file } from './test-helpers.ts';
import { trackedEdits } from './track.ts';
import { newestView, originalView } from './views.ts';
import { ordersReadOtherwiseNear } from './widen.ts';

/** `body` with Bo's marks (`k3x9`), and the edit of the source range `[from, to]` by `insert`. */
function type(body: string, from: number, to: number, insert: string) {
  const before = file(body, { k3x9: 'bo' });
  const changes = trackedEdits(
    before,
    [{ from, to, insert }],
    context(ada, ['m2bd', 'n8fx', 'p7qd']),
  ).changes;
  return { before, after: applyChanges(before, changes) };
}

function expectWhole(before: string, after: string, edited: string, label: string): void {
  expect(readsAsNewest(after), label).toBe(true);
  expect(newestView(after).text.replace(/\n+$/, ''), label).toBe(edited);
  expect(originalView(after).text, label).toBe(originalView(before).text);
  expectSound(label, after);
}

describe('typing over a delimiter of a pending bold (#299)', () => {
  const body = 'A <!--fmt k3x9 +bold-->**word**<!--/k3x9--> b.';
  const open = body.indexOf('**word');

  it('writes the paragraph as a replacement, where the fine form reads otherwise', () => {
    for (const [from, to, insert, edited] of [
      // The second `*` of the opener replaced, or deleted.
      [open + 1, open + 2, 'x', 'A *xword** b.'],
      [open + 1, open + 2, '', 'A *word** b.'],
      // The first `*` of the closer replaced, or deleted.
      [open + 6, open + 7, 'x', 'A **wordx* b.'],
    ] as const) {
      const label = JSON.stringify([from - open, to - open, insert]);
      const { before, after } = type(body, from, to, insert);
      expect(bodyOf(after), label).toMatch(/^<!--sub m2bd A /);
      expectWhole(before, after, edited, label);
    }
  });

  it('keeps the fine form where it reads alike', () => {
    const { before, after } = type(body, open, open + 1, 'x');
    expect(bodyOf(after)).toContain('<!--sub m2bd **w-->');
    expectWhole(before, after, 'A x*word** b.', 'the first `*`');
    // The first `*` of the closer deleted: the change takes the letter in front of it, so the run it
    // leaves closes the bold as the views read it, in every order (since #896's flanking rules).
    const closer = type(body, open + 6, open + 7, '');
    expect(bodyOf(closer.after)).toContain('<!--sub m2bd d**-->d*<!--/m2bd-->');
    expectWhole(
      closer.before,
      closer.after,
      'A **word* b.',
      'the first `*` of the closer, deleted',
    );
  });
});

describe("a delimiter run pasted next to another person's pending split or deletion (#265)", () => {
  it('is written as a replacement of the blocks that hold their split', () => {
    const body = 'Start *one <!--split k3x9-->\n\ntwo* End';
    const at = body.indexOf('<!--split');
    const { before, after } = type(body, at, at, '***_');
    expect(bodyOf(after)).toMatch(/^<!--sub m2bd Start \*one <!-\\-split k3x9-\\->/);
    expectWhole(before, after, 'Start *one ***_\n\ntwo* End', 'a split');
  });
});

describe("a delimiter typed after a letter, beside another person's pending bold (#265)", () => {
  it('is written as a replacement of the paragraph, never over the text of their format change', () => {
    const body = 'x ca<!--fmt k3x9 +bold-->**f**<!--/k3x9-->é';
    const at = body.length;
    for (const [insert, edited] of [
      ['_', 'x ca**f**é_'],
      ['**', 'x ca**f**é**'],
      ['*', 'x ca**f**é*'],
      ['~~', 'x ca**f**é~~'],
    ] as const) {
      const { before, after } = type(`${body}z`, at, at, insert);
      expect(bodyOf(after), insert).toMatch(/^<!--sub m2bd x ca<!-\\-fmt k3x9 \+bold-\\->/);
      expectWhole(before, after, `${edited}z`, insert);
    }
  }, 60_000);
});

describe("a change beside another person's pending bold keeps the fine form where it reads alike (#265)", () => {
  it('writes a letter right after their bold as typed', () => {
    const body = 'x <!--fmt k3x9 +bold-->**word**<!--/k3x9--> y';
    const at = body.indexOf('<!--/k3x9-->') + '<!--/k3x9-->'.length;
    const { before, after } = type(body, at, at, 'a');
    expect(bodyOf(after)).not.toMatch(/^<!--sub m2bd/);
    expectWhole(before, after, 'x **word**a y', 'a letter after the bold');
  });

  it('writes a word right before their bold as typed', () => {
    const body = 'x <!--fmt k3x9 +bold-->**word**<!--/k3x9--> y';
    const at = body.indexOf('<!--fmt');
    const { before, after } = type(body, at, at, 'a ');
    expect(bodyOf(after)).not.toMatch(/^<!--sub m2bd/);
    expectWhole(before, after, 'x a **word** y', 'a word before the bold');
  });

  it('refuses nothing in a table cell, which has no replacement of its own here', () => {
    const cell = 'x ca<!--fmt k3x9 +bold-->**f**<!--/k3x9-->é z';
    const body = `| a | b |\n|---|---|\n| ${cell} | q |`;
    const closer = body.indexOf('<!--/k3x9-->') + '<!--/k3x9-->'.length;
    const c = body.indexOf('ca<!--fmt') + 1;
    for (const insert of ['a', '**', '*', '~~', '\\']) {
      for (const at of [closer, c]) {
        const label = `${JSON.stringify(insert)} at ${at}`;
        expect(() => type(body, at, at, insert), label).not.toThrow();
      }
    }
  }, 60_000);
});

describe("a change beside a chain of another person's pending bold (#265)", () => {
  it('is read with the marks of its whole paragraph, not a window of characters', () => {
    // His deletion of a `*` is 380 characters from the bold; rejecting it and accepting the bold
    // reads the typed run otherwise.
    const filler = 'word '.repeat(76);
    const body = `x <!--del n5tz *-->${filler}ca<!--fmt k3x9 +bold-->**f**<!--/k3x9-->é z`;
    const at = body.indexOf('é z');
    const before = file(body, { k3x9: 'bo', n5tz: 'bo' });
    const { changes } = trackedEdits(
      before,
      [{ from: at, to: at, insert: '**' }],
      context(ada, ['m2bd', 'n8fx', 'p7qd']),
    );
    expectWhole(
      before,
      applyChanges(before, changes),
      body.replace('é z', '**é z').replace(/<!--[^]*?-->/g, ''),
      'far mark',
    );
  }, 60_000);
});

// A timing test: it runs with REDLINES_COST set, as the others do (AGENTS.md).
describe.skipIf(!process.env['REDLINES_COST'])(
  'the cost of reading the orders beside a chain (#265)',
  () => {
    const ids = ['k3x9', 'n4tz', 'p5qw', 'r6st', 'v7wx', 'z8bc'];
    const chainOf = (count: number) =>
      ids
        .slice(0, count)
        .map((id, n) => `<!--fmt ${id} +bold-->**w${n}**<!--/${id}-->`)
        .join(' ');
    const marksOf = (count: number) =>
      Object.fromEntries(ids.slice(0, count).map((id) => [id, 'bo']));
    const filler = (bytes: number) =>
      Array.from(
        { length: Math.ceil(bytes / 60) },
        (_, n) => `Filler paragraph number ${n} of text.`,
      ).join('\n\n');
    const run = (bytes: number, count: number): number => {
      const body = `${filler(bytes)}\n\nx ca ${chainOf(count)} é_z\n\n${filler(bytes)}`;
      const text = file(body, marksOf(count));
      const at = text.indexOf('é_z');
      const started = performance.now();
      const reads = ordersReadOtherwiseNear(text, at, at + 1);
      const took = performance.now() - started;
      expect(reads, `${count} marks`).toBe(count > 4);
      return took;
    };

    it.each([3, 4])(
      'does not depend on the size of the document, %i marks in a chain',
      (count) => {
        run(1_000, count);
        const ratios: number[] = [];
        let small = 0;
        let large = 0;
        for (let turn = 0; turn < 5; turn++) {
          small = run(5_000, count);
          large = run(50_000, count);
          ratios.push(large / small);
        }
        ratios.sort((a, b) => a - b);
        console.log(
          `orders beside a chain of ${count}: 10 KB ${small.toFixed(0)} ms, 100 KB ${large.toFixed(0)} ms`,
        );
        // Ten times the text: the stretch is read, not the file (a whole-file read was ten times
        // slower), and over four marks the unit is replaced without reading.
        expect(ratios[2]).toBeLessThan(4);
        expect(large).toBeLessThan(1_000);
      },
      120_000,
    );
  },
);
