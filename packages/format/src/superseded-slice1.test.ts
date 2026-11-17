// Regression tests for format issues that the widening (lane R2 to R5, format §3.12) superseded: each
// is the reproduction the issue gave, written by the format's own edit functions, and held to the
// four properties of docs/hardening.md: it is written, every order of decisions reads alike, the
// file reads as its newest view after every decision, and rejecting what it added gives the text
// before it back.

import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { rejectAll } from './decide.ts';
import { expectEveryOrderRead } from './oracle.ts';
import { parse } from './parse.ts';
import {
  ada,
  bo,
  bodyOf,
  context,
  exactly,
  expectEveryOrderAlike,
  file,
  randomIds,
} from './test-helpers.ts';
import type { Person } from './types.ts';
import { trackedEdits } from './track.ts';
import { untrackedEdit } from './untracked.ts';

const IDS = ['m2bd', 'n8fx', 'p5qm', 'q6rs', 'r7st'];

/** A tracked edit of `text` by `who`, as the editor writes it (the widened write where the fine one
 * refuses); the new file. */
function press(text: string, from: number, to: number, insert: string, who: Person = ada): string {
  const done = trackedEdits(text, [{ from, to, insert }], context(who, [...IDS]));
  return applyChanges(text, done.changes);
}

const at = (text: string, find: string, offset = 0): number => {
  const index = text.indexOf(find);
  if (index < 0) throw new Error(`no ${JSON.stringify(find)} in ${JSON.stringify(text)}`);
  return index + offset;
};

/** Every order of decisions reads alike, exactly, and each file on the way reads as its newest
 * view; accepting all gives the newest view, and rejecting all the text before the edit with the
 * author's pending changes rejected. */
function held(label: string, before: string, after: string): void {
  expectEveryOrderAlike(label, after, exactly);
  expectEveryOrderRead(label, after);
  const rejected = applyChanges(after, rejectAll(after));
  expect(bodyOf(rejected).trimEnd(), `${label}: rejects back`).toBe(
    bodyOf(applyChanges(before, rejectAll(before))).trimEnd(),
  );
}

describe('#109: a second Delete above another person’s split', () => {
  const base = file('new words');

  it('keeps the deletion of the break apart from the text deleted after it', () => {
    // Ada presses Enter, Bo presses Delete at the end of the line above: the break goes.
    const split = press(base, 3, 3, '\n', ada);
    const joined = press(split, at(split, '\n words'), at(split, '\n words', 1), '', bo);
    held('first Delete', split, joined);
    // The next Delete takes the space, which is refused, or the next letter, which is written as a
    // deletion of its own and leaves the deletion of the break as it was.
    const letter = press(joined, at(joined, 'words'), at(joined, 'words', 1), '', bo);
    held('second Delete', joined, letter);
    expect(bodyOf(letter)).toMatch(/<!--del \w+ \\n-->.*<!--del \w+ w-->ords/s);
  });

  it('reads the issue’s files alike in every order', () => {
    const marks = { ckqw: 'ada', k2f6: 'bo' };
    expectEveryOrderAlike(
      'one Delete',
      file('new<!--split ckqw--><!--del k2f6 \n-->words', marks),
      exactly,
    );
    expectEveryOrderAlike(
      'merged Delete',
      file('new<!--split ckqw--><!--del k2f6 \nw-->ords', marks),
      exactly,
    );
  });
});

describe('#110: a substitution whose new text starts with a line break', () => {
  it('reads alike in every order, whatever it brings after a split that has no break', () => {
    expectEveryOrderAlike(
      'the issue’s file',
      file(
        '<!--split dj4k--><!--del tsqq \n--><!--del tsqq *4--><!--ins vbh5-->\nx*4<!--/vbh5-->',
        {
          dj4k: 'ada',
          tsqq: 'bo',
          vbh5: 'bo',
        },
      ),
      exactly,
    );
  });
});

describe('#120: rare edits next to your own paragraph break', () => {
  it('writes text typed at once, with its line break, at the end of the line above the break', () => {
    const base = press(file('- one two'), 6, 6, '\n  \n  ', ada);
    const split = at(base, '<!--split');
    const after = press(base, split, split, 'new\n', ada);
    held('new and a line break', base, after);
  });

  it('writes text at the start of the line after a split that follows two spaces', () => {
    const base = press(file('one  two'), 5, 5, '\n\n', ada);
    const start = at(base, 'two');
    const after = press(base, start, start, 'x', ada);
    held('text after two spaces', base, after);
  });
});

describe('#44: rare edits with Track Changes off', () => {
  const edit = (text: string, from: number, to: number, insert: string) =>
    applyChanges(text, untrackedEdit(text, { from, to, insert }, { random: randomIds(...IDS) }));
  const insertion = file('one <!--ins a1b2-->ab cd<!--/a1b2--> two', { a1b2: 'bo' });

  it('writes a blank line inside someone’s insertion in front of a space', () => {
    const after = edit(insertion, at(insertion, ' cd'), at(insertion, ' cd'), '\n\n');
    expectEveryOrderAlike('blank line in an insertion', after, exactly);
  });

  it('writes Enter in front of a point comment that has a space before it', () => {
    const text = file('one <!--cmt c7g3--> two');
    const after = edit(text, at(text, '<!--cmt'), at(text, '<!--cmt'), '\n');
    expect(parse(after).warnings.map((w) => w.code)).not.toContain('bad-ledger');
    expect(bodyOf(after)).toContain('one \n<!--cmt c7g3-->');
  });

  it('writes Enter in front of and inside someone’s insertion', () => {
    const front = edit(insertion, at(insertion, '<!--ins'), at(insertion, '<!--ins'), '\n');
    expectEveryOrderAlike('Enter in front', front, exactly);
    const inside = edit(insertion, at(insertion, 'ab ', 1), at(insertion, 'ab ', 1), '\n');
    expectEveryOrderAlike('Enter inside', inside, exactly);
  });
});

describe('#136: a break that would split a quote or end a paragraph in front of a fence-like line', () => {
  it('widens Enter at the end of a quote’s lazy line', () => {
    const base = file('> A long quote that\nwraps lazily.\n> q');
    const p = at(base, '.\n> q', 1);
    held('quote', base, press(base, p, p, '\n', ada));
  });

  it('widens Enter in front of a line that only looks like a fence', () => {
    const base = file('para text\n```a`b`\nmore');
    const p = at(base, 'text', 4);
    held('fence', base, press(base, p, p, '\n', ada));
  });
});
