// A tracked move of blocks: the delete-and-insert that `moveBlockEdits` gives, written by the tracked
// layer with one group, reads as the moved file when accepted and as the first when rejected, and
// reads alike in every order of decisions, judged by micromark (format §3.15).

import { describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 60_000 });
import { blockRunAt, moveBlockEdits, neighbourGap, trackedBlockMove } from './block-move.ts';
import { applyChanges } from './changes.ts';
import { expectEveryOrderRead, expectSound } from './oracle.ts';
import { parse } from './parse.ts';
import { ada, bo, bodyOf, context, file, problemsOf } from './test-helpers.ts';
import { newestView, originalView } from './views.ts';

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

/** Moves the blocks that `at` (a string in the view) is in, up or down, tracked. */
function moved(text: string, at: string, up: boolean, who = ada, to = at): string {
  const view = newestView(text).text;
  const from = view.indexOf(at);
  const end = view.indexOf(to) + to.length;
  const { map } = newestView(text);
  const run = blockRunAt(text, { from: map.toSource(from, 1), to: map.toSource(end, -1) });
  if (!run) throw new Error('no run');
  const gap = neighbourGap(run, up);
  if (!gap) throw new Error('no gap');
  const changes = trackedBlockMove(text, run, gap, {
    ...context(who),
    random: source(7),
  });
  if (!changes) throw new Error('no changes');
  const after = applyChanges(text, changes.changes);
  // The run is where it says in the newest view after the move.
  expect(viewOf(after).slice(changes.moved.from, changes.moved.to)).toBe(
    viewOf(text).slice(run.viewFrom, run.viewTo),
  );
  return after;
}

const viewOf = (text: string) => newestView(text).text;

describe('moving blocks, tracked', () => {
  const BASE = file('One.\n\nTwo.\n\nThree.\n\nFour.');

  it('moves a paragraph down and up, and is one group', () => {
    const down = moved(BASE, 'Two.', false);
    expect(viewOf(down)).toBe('One.\n\nThree.\n\nTwo.\n\nFour.\n');
    expect(originalView(down).text).toBe(originalView(BASE).text);
    expect(problemsOf(parse(down))).toEqual([]);
    const groups = new Set(parse(down).marks.map((mark) => mark.entry.group));
    expect(groups.size).toBe(1);
    expect([...groups][0]).toBeTruthy();
    const up = moved(BASE, 'Three.', true);
    expect(viewOf(up)).toBe('One.\n\nThree.\n\nTwo.\n\nFour.\n');
    expectSound('down', down);
    expectSound('up', up);
  });

  it('moves to the top and to the end', () => {
    expect(viewOf(moved(BASE, 'Two.', true))).toBe('Two.\n\nOne.\n\nThree.\n\nFour.\n');
    expect(viewOf(moved(BASE, 'Three.', false))).toBe('One.\n\nTwo.\n\nFour.\n\nThree.\n');
    expectSound('top', moved(BASE, 'Two.', true));
    expectSound('end', moved(BASE, 'Three.', false));
  });

  it('moves a run of several blocks', () => {
    const run = moved(BASE, 'Two.', false, ada, 'Three.');
    expect(viewOf(run)).toBe('One.\n\nFour.\n\nTwo.\n\nThree.\n');
    expectSound('run', run);
  });

  it('moves a list item among its siblings, a nested one, and a whole list', () => {
    const list = file('Intro.\n\n- a\n- b\n  - b1\n  - b2\n- c\n\nEnd.');
    const item = moved(list, '- b', false);
    expect(viewOf(item)).toBe('Intro.\n\n- a\n- c\n- b\n  - b1\n  - b2\n\nEnd.\n');
    expectSound('item', item);
    const nested = moved(list, 'b2', true);
    expect(viewOf(nested)).toBe('Intro.\n\n- a\n- b\n  - b2\n  - b1\n- c\n\nEnd.\n');
    expectSound('nested', nested);
    const whole = moved(list, 'Intro.', false);
    expect(viewOf(whole)).toBe('- a\n- b\n  - b1\n  - b2\n- c\n\nIntro.\n\nEnd.\n');
    expectSound('whole', whole);
  });

  it('moves a code block, a table and a quote', () => {
    const body = '```js\nlet a = 1;\n```\n\n| A |\n| - |\n| 1 |\n\n> q1\n>\n> q2\n\nEnd.';
    const text = file(body);
    for (const [at, up] of [
      ['let a', false],
      ['| 1 |', true],
      ['q2', true],
    ] as const) {
      const out = moved(text, at, up);
      expect(viewOf(out), `${at} ${up}`).not.toBe(viewOf(text));
      expectSound(`${at} ${up}`, out);
    }
  });

  it('keeps another person’s pending changes in the old place, and reads alike', () => {
    const text = file(
      'One.\n\nTwo <!--ins k3x9-->new<!--/k3x9--> words.\n\nThree.\n\n<!--del w2rf Gone.\\n\\n-->\n\nFour.',
      { k3x9: 'bo', w2rf: 'bo' },
    );
    const out = moved(text, 'Two', false);
    expect(viewOf(out)).toBe('One.\n\nThree.\n\nTwo new words.\n\nFour.\n');
    expect(bodyOf(out)).toContain('k3x9');
    expectEveryOrderRead('bo marks', out);
  });

  it('is a plain edit with Track Changes off: the same text, no marks', () => {
    const view = viewOf(BASE);
    const run = blockRunAt(BASE, { from: view.indexOf('Two.'), to: view.indexOf('Two.') });
    expect(run?.canMoveUp && run.canMoveDown).toBe(true);
    const gap = neighbourGap(run!, false)!;
    const edits = moveBlockEdits(BASE, run!, gap)!.edits;
    expect(viewOf(applyChanges(BASE, edits))).toBe('One.\n\nThree.\n\nTwo.\n\nFour.\n');
  });

  it('has no place above the first or below the last', () => {
    const first = blockRunAt(BASE, { from: 0, to: 0 })!;
    expect(first.canMoveUp).toBe(false);
    expect(neighbourGap(first, true)).toBeUndefined();
    const view = viewOf(BASE);
    const last = blockRunAt(BASE, { from: view.indexOf('Four.'), to: view.indexOf('Four.') })!;
    expect(last.canMoveDown).toBe(false);
  });

  it('two people, in either order', () => {
    const one = moved(BASE, 'Two.', false, ada);
    const two = moved(one, 'Four.', true, bo);
    expect(problemsOf(parse(two))).toEqual([]);
    expectEveryOrderRead('two', two);
  });
});
