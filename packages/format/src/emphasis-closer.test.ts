// A run of `*` that closes an emphasis opened earlier in the inserted text is a closer, so text that
// ends in one, pasted before a letter, stays an insertion (#81). micromark, with GFM, is the oracle:
// the file must read as its newest view does, and every order of decisions must give the same text.

import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { EditError } from './errors.ts';
import { expectSound, readsAsNewest } from './oracle.ts';
import { fuzzCount, seeded } from './random-docs.ts';
import { ada, bodyOf, context, file } from './test-helpers.ts';
import { trackedEdit } from './track.ts';
import { newestView, originalView } from './views.ts';

/** `pasted` typed at the caret `‸` of `body`: the file it leaves. */
function paste(body: string, pasted: string, marks: Record<string, string> = {}): string {
  const at = body.indexOf('‸');
  const before = file(body.replace('‸', ''), marks);
  const changes = trackedEdit(
    before,
    { from: at, to: at, insert: pasted },
    context(ada, ['m2bd', 'n8fx', 'p7qd', 'q4wx', 'r5yz', 's6bc', 't7df', 'v8gh']),
  );
  return applyChanges(before, changes);
}

const body = (text: string) => bodyOf(text).replace(/\n+$/, '');

describe('a closer at the end of inserted text, before a letter (#81)', () => {
  it('keeps the insertion an insertion when the run closes an emphasis in the text', () => {
    for (const [pasted, written] of [
      ['Hello **there**', 'Start <!--ins m2bd-->Hello **there**<!--/m2bd-->middle End'],
      ['Hello *there*', 'Start <!--ins m2bd-->Hello *there*<!--/m2bd-->middle End'],
      ['Hello ***there***', 'Start <!--ins m2bd-->Hello ***there***<!--/m2bd-->middle End'],
      ['Hello **a *b***', 'Start <!--ins m2bd-->Hello **a *b***<!--/m2bd-->middle End'],
      ['Hello *a **b***', 'Start <!--ins m2bd-->Hello *a **b***<!--/m2bd-->middle End'],
      ['**Hello** there', 'Start <!--ins m2bd-->**Hello** there<!--/m2bd-->middle End'],
    ] as const) {
      const after = paste('Start ‸middle End', pasted);
      expect(body(after), pasted).toBe(written);
      expect(readsAsNewest(after), pasted).toBe(true);
      expect(newestView(after).text, pasted).toBe(`Start ${pasted}middle End\n`);
      expect(originalView(after).text, pasted).toBe('Start middle End\n');
      expectSound(pasted, after);
    }
  });

  it('keeps the closer in a list item, a quote and after a word', () => {
    for (const text of ['- Start ‸middle End', '> Start ‸middle End', 'Start‸ middle End']) {
      const after = paste(text, 'Hello **there**');
      expect(parseKinds(after), text).toEqual(['ins']);
      expect(readsAsNewest(after), text).toBe(true);
      expectSound(text, after);
    }
  });

  it('widens the change by a character where the run is no closer of the text', () => {
    // No opener in the text: the run opens in the newest view, and the marker would make it a
    // closer that nothing opens. Or the rule of three reads the run one way with the marker and
    // the other without.
    for (const pasted of [
      'Hello there**',
      'Hello there*',
      'a*b**',
      'Hello *there**',
      'x__',
      '*a**',
    ]) {
      const after = paste('Start ‸middle End', pasted);
      expect(readsAsNewest(after), pasted).toBe(true);
      expectSound(pasted, after);
    }
    expect(body(paste('Start ‸middle End', 'Hello there**'))).toBe(
      'Start <!--sub m2bd m-->Hello there**m<!--/m2bd-->iddle End',
    );
  });
});

const parseKinds = (text: string) =>
  [...bodyOf(text).matchAll(/<!--(ins|sub|del|split) /g)].map((m) => m[1]);

describe('a change next to a delimiter that is no emphasis (#81)', () => {
  it('stays an insertion beside an escaped delimiter, a code span and an autolink', () => {
    for (const text of ['a \\*‸ b', 'a _x_ \\_‸ b', 'a `*`‸ b', 'a <http://x_y_z>‸ b']) {
      const after = paste(text, 'x');
      expect(parseKinds(after), text).toEqual(['ins']);
      expect(readsAsNewest(after), text).toBe(true);
      expectSound(text, after);
    }
  });
});

describe("a paste that stands against another person's pending mark (#81)", () => {
  const bo = { k3x9: 'bo' };
  it('is written as typed where it reads alike in every order of decisions', () => {
    for (const [pasted, target, written] of [
      [
        '*a**_',
        'Start ‸<!--ins k3x9-->yy<!--/k3x9-->middle End',
        'Start <!--ins m2bd-->*a**_<!--/m2bd--><!--ins k3x9-->yy<!--/k3x9-->middle End',
      ],
      [
        '**a*_',
        'Start ‸<!--sub k3x9 old-->new<!--/k3x9-->middle End',
        'Start <!--ins m2bd-->**a*_<!--/m2bd--><!--sub k3x9 old-->new<!--/k3x9-->middle End',
      ],
      [
        '*a**~~',
        '*Start ‸<!--ins k3x9-->yy<!--/k3x9-->middle* End',
        '*Start <!--ins m2bd-->*a**~~<!--/m2bd--><!--ins k3x9-->yy<!--/k3x9-->middle* End',
      ],
    ] as const) {
      const after = paste(target, pasted, bo);
      expect(body(after), pasted).toBe(written);
      expect(readsAsNewest(after), pasted).toBe(true);
      expectSound(`${pasted} in ${target}`, after);
    }
  });

  it('goes over a deletion that holds no text, never into the text of an insertion', () => {
    // The deletion's marker holds no text: the change stands behind it, and takes the letter after.
    const after = paste('Start ‸<!--del k3x9 **-->middle End', 'a**a**', bo);
    expect(body(after)).toBe(
      'Start <!--del k3x9 **--><!--del n8fx m--><!--ins m2bd-->a**a**m<!--/m2bd-->iddle End',
    );
    expectSound('a deletion', after);
    expect(readsAsNewest(after)).toBe(true);
  });

  it('is refused, naming the person, where only a character of their text would read alike', () => {
    // `a*` closes in front of his `*`, and the text of his insertion is not the author's to write again.
    expect(() => paste('Start ‸<!--ins k3x9-->*yy*<!--/k3x9-->middle End', 'a*a', bo)).toThrow(
      "This would change how Bo Chen's insertion reads. Decide it first, or turn off Track Changes.",
    );
    // Where the other side is free, the change takes the letter there instead.
    const after = paste('Start <!--ins k3x9-->yy<!--/k3x9-->‸middle End', 'a*_', bo);
    expect(readsAsNewest(after)).toBe(true);
    expectSound('a*_', after);
  });
});

describe("another person's pending marks around the change (#81)", () => {
  it('read as micromark reads them, in every order of decisions', { timeout: 5_400_000 }, () => {
    const pieces = ['a', 'bc', ' ', '*', '**', '***', '_', '__', 'word'];
    // Bo's mark stands next to the caret, or a word or a space away, or touches the change.
    const targets = [
      'Start <!--ins k3x9-->yy<!--/k3x9--> ‸middle End',
      'Start ‸middle <!--ins k3x9-->yy<!--/k3x9--> End',
      '**x <!--ins k3x9-->yy<!--/k3x9--> ‸middle** End',
      'Start one <!--del k3x9 zz-->two ‸three End',
      'Start *one <!--sub k3x9 old-->new<!--/k3x9--> ‸middle* End',
      // Touching his mark: his markers and his text come and go with his decisions.
      'Start ‸<!--ins k3x9-->yy<!--/k3x9-->middle End',
      'Start <!--ins k3x9-->yy<!--/k3x9-->‸middle End',
      'Start ‸<!--sub k3x9 old-->new<!--/k3x9-->middle End',
      'Start <!--sub k3x9 old-->new<!--/k3x9-->‸middle End',
      'Start ‸<!--del k3x9 zz-->middle End',
      'Start <!--del k3x9 **-->‸middle End',
      '*Start ‸<!--ins k3x9-->yy<!--/k3x9-->middle* End',
      '**Start <!--ins k3x9-->yy<!--/k3x9-->‸middle** End',
      '_a *b <!--ins k3x9-->yy<!--/k3x9-->‸c_ d',
      'Start ‸<!--ins k3x9-->*yy*<!--/k3x9-->middle End',
    ];
    const total = fuzzCount(400);
    let written = 0;
    for (let seed = 1; seed <= total; seed++) {
      const random = seeded(seed * 6151);
      let pasted = '';
      for (let i = 0, n = 2 + Math.floor(random() * 7); i < n; i++) {
        pasted += pieces[Math.floor(random() * pieces.length)] ?? '';
      }
      const target = targets[Math.floor(random() * targets.length)] ?? targets[0]!;
      let after: string;
      try {
        after = paste(target, pasted, { k3x9: 'bo' });
      } catch (error) {
        if (!(error instanceof EditError)) throw error;
        continue;
      }
      written++;
      const label = `seed ${seed}: ${JSON.stringify(pasted)} in ${target}`;
      expect(readsAsNewest(after), label).toBe(true);
      expectSound(label, after);
    }
    expect(written).toBeGreaterThan(total / 4);
  });
});

describe('an emphasis opened far back on the line (#81)', () => {
  it('is read whole: random long lines with a far opener, pasted runs and letters', () => {
    const openers = ['**x ', '*x ', '***x ', '_x ', '__x ', '*foo **'];
    const runs = ['*', '**', '***', '_', '__', 'a', 'bc', ' ', 'w '];
    let wrong = 0;
    const total = fuzzCount(500);
    for (let seed = 1; seed <= total; seed++) {
      const random = seeded(seed * 7907);
      const below = (n: number) => Math.floor(random() * n);
      const pick = <T>(items: readonly T[]): T => items[below(items.length)] as T;
      const make = (n: number) => Array.from({ length: n }, () => pick(runs)).join('');
      const filler = 'w '.repeat(50 + below(30));
      const target = `${pick(openers)}${filler}${make(1 + below(3))}‸${make(1 + below(4))}a${make(below(4))} end`;
      const pasted = make(2 + below(6));
      let after: string;
      try {
        after = paste(target, pasted);
      } catch (error) {
        if (!(error instanceof EditError)) throw error;
        continue;
      }
      if (!readsAsNewest(after)) wrong++;
    }
    expect(wrong).toBe(0);
  });
});

describe('text pasted before a letter reads as micromark reads it (#81)', () => {
  it('for random words and runs of `*`, `_` and `**`', () => {
    const pieces = ['a', 'bc', ' ', ' ', '*', '**', '***', '_', '__', '*', '**', 'word'];
    const targets = ['Start ‸middle End', 'Start‸ middle End', 'one *two ‸three* four'];
    let insertions = 0;
    let substitutions = 0;
    let refused = 0;
    const total = fuzzCount(400);
    for (let seed = 1; seed <= total; seed++) {
      const random = seeded(seed);
      let pasted = '';
      const length = 2 + Math.floor(random() * 9);
      for (let i = 0; i < length; i++) pasted += pieces[Math.floor(random() * pieces.length)] ?? '';
      const target = targets[Math.floor(random() * targets.length)] ?? targets[0]!;
      let after: string;
      try {
        after = paste(target, pasted);
      } catch (error) {
        if (!(error instanceof EditError)) throw error;
        refused++;
        continue;
      }
      expect(readsAsNewest(after), `seed ${seed}: ${JSON.stringify(pasted)} in ${target}`).toBe(
        true,
      );
      expectSound(`seed ${seed}: ${JSON.stringify(pasted)} in ${target}`, after);
      if (parseKinds(after).includes('sub')) substitutions++;
      else insertions++;
    }
    if (process.env['REDLINES_FUZZ'])
      console.log('closer paste', { insertions, substitutions, refused });
    expect(insertions).toBeGreaterThan(total / 10);
  });
});
