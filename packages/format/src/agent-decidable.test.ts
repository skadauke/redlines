// An agent's edit leaves every decision that could be made before it possible after it (#246, #251):
// the edit is written so that it is, or it is refused, and the file is as it was.

import { describe, expect, it } from 'vitest';
import { suggestReplace } from './agent.ts';
import { applyChanges } from './changes.ts';
import { accept, reject } from './decide.ts';
import { EditError } from './errors.ts';
import { parse } from './parse.ts';
import { TIME, claudeAda, file } from './test-helpers.ts';
import { expectSound } from './oracle.ts';

const ctx = {
  author: claudeAda,
  time: TIME,
  random: (n: number) => Uint8Array.from({ length: n }, (_, i) => 7 + i),
};

const can = (text: string, id: string, decide: typeof accept) => {
  try {
    decide(text, id);
    return true;
  } catch {
    return false;
  }
};

describe('an agent edit next to another person’s substitution (#251)', () => {
  // The item's first word goes, and the substitution after it is Bo's: before the edit it can be
  // accepted and rejected.
  const before = file('- one gamma\n- delta <!--sub kvs3 beta-->éclair<!--/kvs3--> x\n- two', {
    kvs3: 'bo',
  });

  it('can be accepted and rejected before the edit', () => {
    expect(can(before, 'kvs3', accept)).toBe(true);
    expect(can(before, 'kvs3', reject)).toBe(true);
  });

  it('is refused, or leaves the substitution decidable, as the issue’s example', () => {
    let result: string | undefined;
    try {
      result = applyChanges(
        before,
        suggestReplace(before, 'ma\n- delta éclair ', 'ma\n-  éclair ', ctx).changes,
      );
    } catch (error) {
      if (!(error instanceof EditError)) throw error;
      expect(error.code).toBe('no-legal-placement');
    }
    if (result === undefined) return;
    // Every mark is decided in some order, and every order reads alike.
    expect(parse(result).marks.length).toBeGreaterThan(0);
    expectSound('every order', result);
  });
});
