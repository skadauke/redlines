// A tracked move of an item in a list that follows code and a quote (#586, seed 102 of
// `block-move-random.test.ts` at `REDLINES_FUZZ=300`): the fine write was a replacement that
// started at the closing fence of the code block before them, so its marker stood inside the code
// and the newest view gained a stray closing fence. It is not kept: the move is written another way
// or, where none can be, throws Untrackable and the person is asked.
import { describe, expect, it, vi } from 'vitest';
import { blockRunAt, trackedBlockMove } from './block-move.ts';
import { applyChanges } from './changes.ts';
import { readsAsNewest } from './oracle.ts';
import { ada, context } from './test-helpers.ts';
import { Untrackable } from './widen.ts';
import { newestView } from './views.ts';

vi.setConfig({ testTimeout: 60_000 });

const BODY =
  'plan beta note text\n\n1. text ship plan gamma\n   ship delta code alpha plan\n   ship plan\n   1. review gamma review beta ship\n   beta code\n      * code beta alpha note review\n          code plan code alpha plan\n          gamma plan delta alpha beta\n      * ship plan alpha review ship delta\n      text beta delta beta text\n         * beta beta plan\n                 plan text review note ship\n           > delta delta delta plan\n         * beta plan delta beta\n         plan note plan\n          alpha note alpha delta plan\n\n               gamma review code\n               text alpha\n\n   2. note gamma delta alpha ship ship plan\n       alpha alpha gamma\n   text note\n\n      ```\n          alpha text\n      ```\n      1. text code text text plan\n           delta ship code\n           ship note\n\n             delta ship gamma\n             ship ship\n2. note note note alpha\n beta ship ship\n\n- beta gamma ship note review ship\n      text plan code review beta\n  1. alpha review gamma delta review code\n  text delta\n  gamma delta\n+ plan plan alpha\n\n| a | b |\n| - | - |\n| code | plan |\n\n```\nreview ship\n    code beta delta\n```\n\n> gamma review gamma text\n> plan plan code\n>\n> - beta delta\n>   - code plan\n\n1. text alpha beta gamma beta beta\n  code delta review\n alpha gamma\n2. gamma code note code delta alpha\n\n       beta text note\n       plan text\n\n   + delta text review review\n       ship review beta beta\n      ship ship gamma\n     1. ship alpha ship\n     plan delta delta gamma delta\n     alpha plan gamma ship\n\n        text alpha gamma code\n              text code\n        plan text plan\n        * beta delta delta\n          code review text review ship\n        * note beta delta gamma plan note review\n              alpha review\n        * beta ship plan gamma text\n\n     2. beta alpha code alpha\n        1. beta note gamma code\n        2. code delta ship ship beta delta beta\n              gamma note delta code\n            code review\n\n               review plan plan\n               beta note\n\n<div>\nbeta gamma text\n</div>\n';
const fences = (view: string) =>
  view.split('\n').filter((l) => /^[ \t>]*(?:`{3,}|~{3,})/.test(l)).length;

describe('a move after a code block does not write inside the code (#586)', () => {
  it('keeps the fences of the newest view', () => {
    const at = 1649;
    const run = blockRunAt(BODY, { from: at, to: at })!;
    const gap = run.gaps.find((g) => g.index === 0)!;
    let after: string | undefined;
    try {
      const result = trackedBlockMove(BODY, run, gap, {
        ...context(ada),
        random: (n) => Uint8Array.from({ length: n }, (_, i) => (i * 7 + 3) % 19),
      });
      after = result && applyChanges(BODY, result.changes);
    } catch (error) {
      if (!(error instanceof Untrackable)) throw error;
    }
    if (after === undefined) return;
    expect(fences(newestView(after).text)).toBe(fences(newestView(BODY).text));
    expect(readsAsNewest(after)).toBe(true);
  });
});
