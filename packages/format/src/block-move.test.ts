// A tracked move of blocks: the delete-and-insert that `moveBlockEdits` gives, written by the tracked
// layer with one group, reads as the moved file when accepted and as the first when rejected, and
// reads alike in every order of decisions, judged by micromark (format §3.14).

import { describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 60_000 });
import { blockRunAt, moveBlockEdits, neighbourGap, trackedBlockMove } from './block-move.ts';
import { applyChanges } from './changes.ts';
import { Untrackable } from './widen.ts';
import { expectEveryOrderRead, expectSound } from './oracle.ts';
import { parse } from './parse.ts';
import { ada, bo, bodyOf, context, file, problemsOf, thread } from './test-helpers.ts';
import { trackedEdits } from './track.ts';
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

describe('moving blocks that bring two lists side by side (#871)', () => {
  it('is not written as marks: the newest view reads one list, the file with a marker, two', () => {
    expect(() => moved(file('- a\n\npara\n\n- b'), 'para', false)).toThrow(Untrackable);
    expect(() => moved(file('1. a\n\npara\n\n   1. b'), 'para', false)).toThrow(Untrackable);
  });

  it('writes a move that leaves the lists apart, or that swaps lists that are side by side', () => {
    const apart = moved(file('- a\n\npara\n\nmore\n\n- b'), 'para', false);
    expect(viewOf(apart)).toBe('- a\n\nmore\n\npara\n\n- b\n');
    const swapped = moved(file('- a\n\n1. b'), '- a', false);
    expect(viewOf(swapped)).toBe('1. b\n\n- a\n');
    expect(problemsOf(parse(swapped))).toEqual([]);
  });
});

describe('moving blocks that hold comments or pending changes (#1052)', () => {
  const ASKED = file(
    '- alpha <!--cmt k6hg-->x<!--/k6hg-->\n- beta <!--cmt k6hj-->y<!--/k6hj-->',
    {},
    [...thread('k6hg', 'bo', 'One.'), ...thread('k6hj', 'bo', 'Two.')],
  );

  it('moves the text without tracking with the markers of its comments (verbatim edits)', () => {
    const view = viewOf(ASKED);
    const at = view.indexOf('alpha');
    const run = blockRunAt(ASKED, { from: at, to: at })!;
    const plan = moveBlockEdits(ASKED, run, neighbourGap(run, false)!)!;
    expect(plan.verbatim).toBe(true);
    const after = applyChanges(ASKED, plan.edits);
    expect(bodyOf(after)).toContain(
      '- beta <!--cmt k6hj-->y<!--/k6hj-->\n- alpha <!--cmt k6hg-->x<!--/k6hg-->',
    );
    expect(problemsOf(parse(after))).toEqual([]);
  });

  it('carries a comment that starts at the first character of a paragraph, and a highlight that ends one', () => {
    const text = file(
      '<!--cmt k6hg-->Alpha<!--/k6hg--> one\n\nBeta <!--hl k6hj-->two<!--/k6hj-->',
      { k6hj: 'ada' },
      thread('k6hg', 'bo', 'One.'),
    );
    for (const [at, up, expected] of [
      [
        'Alpha',
        false,
        'Beta <!--hl k6hj-->two<!--/k6hj-->\n\n<!--cmt k6hg-->Alpha<!--/k6hg--> one',
      ],
      ['Beta', true, 'Beta <!--hl k6hj-->two<!--/k6hj-->\n\n<!--cmt k6hg-->Alpha<!--/k6hg--> one'],
    ] as const) {
      const view = viewOf(text);
      const from = newestView(text).map.toSource(view.indexOf(at), 1);
      const run = blockRunAt(text, { from, to: from })!;
      const plan = moveBlockEdits(text, run, neighbourGap(run, up)!)!;
      expect(plan.verbatim, at).toBe(true);
      expect(bodyOf(applyChanges(text, plan.edits)).trim(), at).toBe(expected);
    }
  });

  it('writes a plain move that holds no comment as it did', () => {
    const plain = file('- alpha\n- beta');
    const run = blockRunAt(plain, { from: 3, to: 3 })!;
    expect(moveBlockEdits(plain, run, neighbourGap(run, false)!)!.verbatim).toBeUndefined();
  });

  it('is one replacement where the blocks hold pending changes, which read alike in every order', () => {
    const text = file(
      'One.\n\ndelta <!--ins m94w-->new\ncafé <!--del bv23 gone--><!--/m94w-->\n\nLast.',
      { m94w: 'bo', bv23: 'ada' },
    );
    const out = moved(text, 'delta', true);
    expect(bodyOf(out)).toContain('<!--sub ');
    expectEveryOrderRead('pending', out);
  });
});

describe('a fence that nothing closes (#1103)', () => {
  const text = file('alpha\n\n```js\ncode\n');

  it('has no place to go, and nothing goes below it', () => {
    const view = viewOf(text);
    const fence = blockRunAt(text, { from: view.indexOf('code'), to: view.indexOf('code') })!;
    expect(fence.unclosed).toBe(true);
    expect(fence.gaps).toEqual([]);
    const alpha = blockRunAt(text, { from: 1, to: 1 })!;
    expect(alpha.gaps.some((gap) => gap.index > 1)).toBe(false);
  });
});

describe('a block taken from between a line of text and a list (#586, block-move-random seed 142)', () => {
  const text = file('para\n<div>\nx\n</div>\n\n- item one\n\nlast\n');

  it('leaves the list a list, which a join of the line above to the item would not', () => {
    const view = newestView(text);
    const at = viewOf(text).indexOf('x');
    const run = blockRunAt(text, { from: view.map.toSource(at, 1), to: view.map.toSource(at, 1) })!;
    const gap = neighbourGap(run, false)!;
    const out = applyChanges(
      text,
      trackedBlockMove(text, run, gap, { ...context(ada), random: source(7) })!.changes,
    );
    expect(viewOf(out)).toContain('para\n- item one');
    expectEveryOrderRead('html block down', out);
  });
});

describe('a move of blocks is written as a move (§3.14, #1201)', () => {
  const BASE = file('One.\n\nTwo.\n\nThree.\n\nFour.');

  it('links the insertion and the deletion with `move`, both ways, in one group', () => {
    const after = moved(BASE, 'Two.', false);
    const marks = parse(after).marks;
    const insertion = marks.find((mark) => mark.kind === 'ins');
    const deletion = marks.find((mark) => mark.kind === 'del');
    expect(insertion?.entry.move).toBe(deletion?.id);
    expect(deletion?.entry.move).toBe(insertion?.id);
    expect(insertion?.entry.group).toBe(deletion?.entry.group);
    expect(insertion?.entry.group).toBeDefined();
  });

  it('reads alike in every order of decisions, and accepts or rejects whole', () => {
    for (const [at, up] of [
      ['Two.', false],
      ['Three.', true],
      ['One.', false],
    ] as const) {
      const after = moved(BASE, at, up);
      expectEveryOrderRead(`move ${at}`, after);
    }
  });

  it('is a move in a list and in a quote too', () => {
    for (const doc of ['- a\n- b\n- c', '> a\n>\n> b\n>\n> c']) {
      const after = moved(file(doc), 'b', true);
      const marks = parse(after).marks;
      expect(
        marks
          .filter((mark) => mark.kind !== 'split')
          .every((mark) => mark.entry.move !== undefined),
      ).toBe(true);
      expectEveryOrderRead('move in a container', after);
    }
  });
});

describe('a link whose partner is gone (§3.14, #1201 review)', () => {
  const BASE = file('One.\n\nTwo.\n\nThree.\n\nFour.');
  const dangling = (text: string) => {
    const parsed = parse(text);
    return parsed.marks.filter(
      (mark) =>
        mark.entry.move !== undefined &&
        !parsed.marks.some((other) => other.id === mark.entry.move),
    );
  };

  it('moving the same block again leaves no link to the first insertion', () => {
    const once = moved(BASE, 'Two.', false);
    expect(dangling(once)).toEqual([]);
    const twice = moved(once, 'Two.', false);
    expect(dangling(twice)).toEqual([]);
    expectEveryOrderRead('moved twice', twice);
  });

  it('deleting the moved block at its new place leaves the old deletion with no link', () => {
    const once = moved(BASE, 'Two.', false);
    const view = newestView(once).text;
    const at = view.lastIndexOf('Two.');
    const done = trackedEdits(
      once,
      [{ from: at, to: at + 4, insert: '' }],
      context(ada, ['k3x9', 'm4yz', 'p5qr']),
    );
    const after = applyChanges(once, done.changes);
    expect(dangling(after)).toEqual([]);
    expectEveryOrderRead('moved then deleted', after);
  });

  it('a deletion typed beside the old place stays a deletion of its own', () => {
    const once = moved(BASE, 'Two.', false);
    const view = newestView(once).text;
    const at = view.indexOf('One.') + 'One.'.length;
    const done = trackedEdits(
      once,
      [{ from: at - 1, to: at, insert: '' }],
      context(ada, ['k3x9', 'm4yz', 'p5qr']),
    );
    const after = applyChanges(once, done.changes);
    expect(parse(after).marks.filter((mark) => mark.kind === 'del').length).toBe(2);
  });
});
