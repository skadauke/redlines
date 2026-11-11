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
function paste(body: string, pasted: string): string {
  const at = body.indexOf('‸');
  const before = file(body.replace('‸', ''));
  const changes = trackedEdit(
    before,
    { from: at, to: at, insert: pasted },
    context(ada, ['m2bd', 'n8fx', 'p7qd']),
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
