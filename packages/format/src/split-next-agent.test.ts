// An agent's str_replace at the start of the line after another person's split, or after an
// agent's own (#107, #276): written as the replacement of the block that holds the split, as typing
// is, and every order of decisions reads alike.

import { describe, expect, it } from 'vitest';
import { suggestReplace } from './agent.ts';
import { applyChanges } from './changes.ts';
import { ada, bo, expectEveryOrderAlike, file, TIME } from './test-helpers.ts';
import type { Person } from './types.ts';
import { newestView } from './views.ts';

let used = 0;
const random = (n: number) => Uint8Array.from({ length: n }, () => (used++ * 7 + 3) % 19);
const claudeBo: Person = { handle: 'claude-bo', name: 'Claude', agent: true, for: 'bo' };

describe("an agent's str_replace after a split (#107, #276)", () => {
  it('writes where a person typing would, and reads alike in every order', () => {
    for (const [body, to] of [
      ['- alpha<!--split k3x9-->\n  beta', 'xbeta'],
      ['alpha<!--split k3x9-->\n\nbeta', '## beta'],
      ['alpha<!--split k3x9-->\nbeta', ' beta'],
      ['> alpha<!--split k3x9-->\n>\n> beta', '- beta'],
    ] as const) {
      for (const [by, splitter] of [
        [bo, 'ada'],
        [claudeBo, 'ada'],
        [ada, 'claude-bo'],
        [claudeBo, 'claude-bo'],
      ] as const) {
        const text = file(body, { k3x9: splitter });
        const result = suggestReplace(text, 'beta', to, { author: by, time: TIME, random });
        const after = applyChanges(text, result.changes);
        expectEveryOrderAlike(`${body} ${to} by ${by.handle}`, after);
        expect(newestView(after).text, `${body} ${to}`).toContain(to);
      }
    }
  }, 60_000);
});
