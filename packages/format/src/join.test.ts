import { describe, expect, it } from 'vitest';
import { wordHunks } from './agent.ts';
import { blocksOf, joinRuns, joinable, joinedHunks, prefixSpans, runsOf, wordsIn } from './join.ts';
import type { JoinGuards, Run } from './join.ts';

/** Guards for text with no marker in it. */
const open: JoinGuards = { plain: () => true };

const changes = (runs: readonly Run[]) => runs.filter((run) => !run.equal).length;

/** How many changes the comparison makes, and how many are left once rule 1 has joined them. */
function counts(before: string, after: string, guards: JoinGuards = open): [number, number] {
  const runs = runsOf(before, after);
  return [changes(runs), changes(joinRuns(runs, before, guards))];
}

// Paragraphs of design.md, and rewrites of the kind an agent makes when asked.
const PARAGRAPHS = {
  light: [
    'Creating a beautiful, minimal and functional user interface is the goal. The document looks like a finished document while you write it. Controls appear when they are needed and stay out of sight otherwise.',
    'Creating a beautiful, minimal and functional interface is the goal. The document looks finished while you write it. Controls appear when they are needed and stay out of sight otherwise.',
  ],
  tighten: [
    'The first use case is collaborative editing of design documents: authors and reviewers, human and AI, propose changes and discuss them in place, and the owner accepts or rejects them.',
    'It starts with design documents: people and agents propose changes and discuss them in place, and the owner decides.',
  ],
  rewrite: [
    "Redlines never reads, stores or passes Claude or ChatGPT credentials. Whether someone is signed in is what the agent's own status command says, and when they aren't, the thread says so in one line.",
    "Sign-in stays with each agent: Redlines asks the agent's status command whether you are signed in, never touches the credentials, and says in one line of the thread when you are not.",
  ],
  bullet: [
    '- **Quitting never loses work.** However the app is asked to quit (the menu, the Dock, logging out) or to restart for an update, each window with unsaved edits comes forward in turn and asks whether to save them.',
    '- **Quitting never loses work.** Whatever asks the app to quit or restart, each window with unsaved edits comes forward and asks you to save them, one at a time.',
  ],
  farApart: [
    "Each person keeps the color they picked unless someone already shown has it. Within one document no two people share a color while there are seven or fewer others, and past the palette's eight colors, colors repeat.",
    "Each person keeps the color they chose unless someone already shown has it. Within one document no two people share a color while there are seven or fewer others, and past the palette's eight colors, they repeat.",
  ],
  added: [
    "The view is each person's own and is never saved in the file.",
    "The view is each person's own and is never saved in the file. It is kept in the app's settings instead.",
  ],
} as const;

const IMPORTER = [
  'The importer reads every file in the folder and writes one record for each line it finds there.',
  'The importer reads each file once and writes a record per line.',
] as const;

/** The hunks of an edit with the joining rule, with no marker anywhere. */
const joined = (before: string, after: string, guards: JoinGuards = open) =>
  joinedHunks(before, after, guards);

/** The hunk that replaces all of `before` with `after`. */
const whole = (before: string, after: string) => [{ from: 0, to: before.length, insert: after }];

describe('runsOf', () => {
  it('gives runs that spell both texts, unchanged and changed in turn', () => {
    const runs = runsOf('the quick brown fox', 'the slow brown cat');
    expect(runs.map((run) => run.old.join('')).join('')).toBe('the quick brown fox');
    expect(runs.map((run) => run.new.join('')).join('')).toBe('the slow brown cat');
    expect(runs.map((run) => run.equal)).toEqual([true, false, true, false]);
  });

  it('gives no change for the same text', () => {
    expect(changes(runsOf('a b', 'a b'))).toBe(0);
    expect(runsOf('', '')).toEqual([]);
  });
});

describe('wordsIn', () => {
  it('counts the tokens of letters, digits, marks and _', () => {
    expect(wordsIn(['café', ' ', 'x_1', ',', ' ', '42', '—'])).toBe(3);
  });
});

describe('joinRuns', () => {
  it('joins the middle of "quick brown -> fast red, fox, jumps -> leaps"', () => {
    expect(counts('the quick brown fox jumps over', 'the fast red fox leaps over')[1]).toBe(1);
  });

  it('keeps two one-word fixes with two words between them apart', () => {
    expect(counts('a b c d', 'x b c y')).toEqual([2, 2]);
  });

  it('joins on a tie', () => {
    expect(counts('a b c', 'x b y')).toEqual([2, 1]);
  });

  it('counts a change by the larger of its sides', () => {
    // Two words between a change of three words to one and a change of one: 2 <= min(3, 1) fails.
    expect(counts('one two three b c four', 'uno b c cuatro')).toEqual([2, 2]);
    expect(counts('one two three b four', 'uno b cuatro')).toEqual([2, 1]);
    // Two words between a change of three words to one and one of two words: 2 <= min(3, 2).
    expect(counts('one two three b c four five', 'uno b c cuatro cinco')[1]).toBe(1);
  });

  it('counts the words a join took in when it looks at the next join', () => {
    // "c" and "f g" alone have two words between them, more than "c" has; once "a b c" is one
    // change of three words, they are joined.
    expect(counts('b c d e f g', 'b y d e z w')[1]).toBe(2);
    expect(counts('a b c d e f g', 'x b y d e z w')[1]).toBe(1);
  });

  it('does not join over syntax, a blank line, a line that starts a block or a prefix', () => {
    for (const unchanged of [
      '`x`',
      '**b**',
      '[a](b)',
      'a + b',
      '\n\n',
      '\r\n\r\n',
      '\n- ',
      '\n1. ',
    ]) {
      expect(joinable(unchanged), JSON.stringify(unchanged)).toBe(false);
    }
    expect(joinable(' and the ')).toBe(true);
    expect(joinable(' wraps\nhere ')).toBe(true);
    expect(joinable(' wraps\r\n  here ')).toBe(true);
    for (const [before, after] of [
      ['1. one b', '2. uno b'],
      ['- a b', '* x b'],
      ['## a b', '### x b'],
      ['x\n> a b', 'x\n>> y b'],
      ['x\n  a b', 'x\n    y b'],
    ] as const) {
      const [today, joined] = counts(before, after);
      expect(joined, before).toBe(today);
    }
    // A change that only follows a prefix may join.
    expect(counts('- a b c', '- x b y')).toEqual([2, 1]);
  });

  it('does not join over a marker', () => {
    expect(counts('a b c', 'x b y', { plain: () => false })).toEqual([2, 2]);
    // The guard is asked about the unchanged text, in offsets of the old text.
    const asked: [number, number][] = [];
    counts('a b c', 'x b y', {
      plain: (from, to) => {
        asked.push([from, to]);
        return true;
      },
    });
    expect(asked).toEqual([[1, 4]]);
  });

  it('makes 3 marks of the light copy edit 2, 6 of the tightened sentence 2 and 9 of the bullet 4', () => {
    expect(counts(...PARAGRAPHS.light)).toEqual([3, 2]);
    expect(counts(...PARAGRAPHS.tighten)).toEqual([6, 2]);
    expect(counts(...PARAGRAPHS.bullet)).toEqual([9, 4]);
    expect(counts(...PARAGRAPHS.farApart)).toEqual([2, 2]);
    expect(counts(...PARAGRAPHS.added)).toEqual([1, 1]);
  });
});

describe('prefixSpans', () => {
  it('gives the prefix of each line that has one', () => {
    expect(prefixSpans('- a\nb\n  c\n> ## d')).toEqual([
      [0, 2],
      [6, 8],
      [10, 15],
    ]);
  });
});

describe('joinedHunks', () => {
  it('replaces the rewritten design §8.6 paragraph whole: 28 hunks become 1', () => {
    expect(wordHunks(...PARAGRAPHS.rewrite)).toHaveLength(28);
    expect(joined(...PARAGRAPHS.rewrite)).toEqual(whole(...PARAGRAPHS.rewrite));
  });

  it('replaces the importer sentence whole: 3 of 18 words survive', () => {
    expect(wordHunks(...IMPORTER)).toHaveLength(5);
    expect(joined(...IMPORTER)).toEqual(whole(...IMPORTER));
  });

  it('counts text a join took in as changed', () => {
    // Three of six words are unchanged, half; the joins take "b" and "d" in, and one is left.
    expect(wordHunks('a b c d e f', 'x b y d z f')).toHaveLength(3);
    expect(joined('a b c d e f', 'x b y d z f')).toEqual(whole('a b c d e f', 'x b y d z f'));
    // Two of four words are left after the joins: exactly half, not fewer.
    expect(joined('a b c d', 'x y c d')).toEqual([{ from: 0, to: 3, insert: 'x y' }]);
  });

  it('needs fewer than half on both sides', () => {
    for (const [before, after] of [
      PARAGRAPHS.farApart,
      PARAGRAPHS.added,
      [PARAGRAPHS.added[1], PARAGRAPHS.added[0]],
      ['We ship it. Then we rest. And then we go home.', 'We ship it. And then we go home.'],
    ] as const) {
      expect(joined(before, after), before).toEqual(wordHunks(before, after));
    }
    // No word on one side.
    const before = 'a. b c d e.';
    expect(joined(before, '. .')).toEqual([{ from: 0, to: before.length - 1, insert: '. ' }]);
  });

  it('does not replace whole over syntax or a prefix', () => {
    const bold = joined('a b **keep** c d e f', 'x y **keep** z w v u');
    expect(bold.length).toBeGreaterThan(1);
    for (const prefix of ['- ', '## ', '> ', '1. ', '- [ ] ']) {
      const before = `${prefix}one two three four five six`;
      const after = `${prefix}uno dos tres four cinco seis`;
      expect(joined(before, after), prefix).toEqual([
        { from: prefix.length, to: before.length, insert: after.slice(prefix.length) },
      ]);
    }
    // A wrapped line's indentation that comes back as it was: the block is replaced whole, the
    // indentation inside the change; the first line's own marker stays out of it.
    expect(joined('the a b c\n  d e f', 'the x y z\n  u v w')).toEqual([
      { from: 0, to: 17, insert: 'the x y z\n  u v w' },
    ]);
    expect(joined('- the a b c\n  d e f', '- the x y z\n  u v w')).toEqual([
      { from: 2, to: 19, insert: 'the x y z\n  u v w' },
    ]);
    expect(joined('> the a b c\n> d e f', '> the x y z\n> u v w')).toEqual([
      { from: 2, to: 19, insert: 'the x y z\n> u v w' },
    ]);
    // An indentation, a quote depth or a marker that would change: changes join across it no
    // further than the change that reaches into it, and nothing is replaced whole.
    for (const after of ['the x y z\n   u v w', 'the x y z\n u v w', 'the x y z\n- u v w']) {
      expect(joined('the a b c\n  d e f', after).length, after).toBeGreaterThan(1);
    }
    expect(joined('> the a b c\n> d e f', '> the x y z\n> > u v w').length).toBeGreaterThan(1);
  });

  it('does not replace whole over a marker in text it would take in', () => {
    // A marker behind "The importer reads ": the rest still joins where it may.
    const hunks = joined(...IMPORTER, { plain: (from) => from !== 0 });
    expect(hunks).toEqual([
      { from: 19, to: 94, insert: 'each file once and writes a record per line' },
    ]);
  });

  it('leaves a light edit with a hunk per phrase', () => {
    expect(joined('in March', 'in April')).toEqual([{ from: 3, to: 8, insert: 'April' }]);
    expect(joined(...PARAGRAPHS.light)).toHaveLength(2);
    expect(joined(...PARAGRAPHS.tighten)).toHaveLength(2);
    expect(joined(...PARAGRAPHS.bullet)).toHaveLength(4);
  });

  it('joins a change of white space only into the change beside it', () => {
    // An unwrapped line break is free: it joins with a neighbour that the text between can join.
    expect(joined('a b\nc d e f g h', 'x b c d e f g h')).toEqual([
      { from: 0, to: 4, insert: 'x b ' },
    ]);
    expect(joined('a b c d e f\ng h', 'a b c d e f g z')).toEqual([
      { from: 11, to: 15, insert: ' g z' },
    ]);
    // Not past what the other change allows, and not two of them with a long text between.
    expect(joined('a b c d e f\ng h', 'x b c d e f g h').length).toBe(2);
    expect(joined('a\nb c d e f g h i\nj', 'a b c d e f g h i j')).toEqual(
      wordHunks('a\nb c d e f g h i\nj', 'a b c d e f g h i j'),
    );
  });

  it('is one hunk with nothing unchanged, as the word form is', () => {
    expect(joined('a', 'b')).toEqual(wordHunks('a', 'b'));
    expect(joined('a b', 'a b')).toEqual([]);
  });
});

describe('block by block', () => {
  // A paragraph that keeps two of its eight words, and one that keeps all six.
  const ONE = ['a b c d e f g h.', 'x b c y z w v u.'] as const;
  const TWO = ['Five six seven eight nine ten.', 'Cinco seis siete ocho nine diez.'] as const;
  const KEPT = 'Five six seven eight nine ten.';

  /** The hunks of an edit of two blocks with `between` between them, each rewritten or not. */
  function two(between: string, first: boolean, second: boolean, lead = '') {
    const before = ONE[0] + between + TWO[0];
    const after = (first ? ONE[1] : ONE[0]) + between + (second ? TWO[1] : TWO[0]);
    return { before, hunks: joinedHunks(before, after, { plain: () => true, lead }) };
  }

  it('judges two paragraphs of one edit separately', () => {
    const first = two('\n\n', true, false);
    expect(first.hunks).toEqual([{ from: 0, to: 16, insert: ONE[1] }]);
    // As one block it keeps 8 of 14 words, and is not replaced whole.
    expect(joinedHunks(ONE[0] + ' ' + KEPT, ONE[1] + ' ' + KEPT, open)).not.toContainEqual({
      from: 0,
      to: 16,
      insert: ONE[1],
    });
    const second = two('\n\n', false, true);
    expect(second.hunks).toEqual([{ from: 18, to: second.before.length, insert: TWO[1] }]);
    const both = two('\n\n', true, true);
    expect(both.hunks).toEqual([
      { from: 0, to: 16, insert: ONE[1] },
      { from: 18, to: both.before.length, insert: TWO[1] },
    ]);
  });

  it('does the same for two list items, a heading and its paragraph, two table cells', () => {
    for (const between of ['\n- ', '\n  - ', '\n1. ', '\n> ', '\n\n## ', '\n\n']) {
      const both = two(between, true, true);
      const at = 16 + between.length;
      expect(both.hunks, JSON.stringify(between)).toEqual([
        { from: 0, to: 16, insert: ONE[1] },
        { from: at, to: both.before.length, insert: TWO[1] },
      ]);
    }
    // A row of a table, quoted from its first pipe, and from inside its first cell.
    const before = `| ${ONE[0]} | ${TWO[0]} |`;
    const after = `| ${ONE[1]} | ${TWO[0]} |`;
    expect(joinedHunks(before, after, open)).toEqual([{ from: 2, to: 18, insert: ONE[1] }]);
    expect(joinedHunks(before.slice(2), after.slice(2), { plain: () => true, lead: '| ' })).toEqual(
      [{ from: 0, to: 16, insert: ONE[1] }],
    );
    // Without the line's start, the pipe is only syntax: nothing is replaced whole.
    expect(joinedHunks(before.slice(2), after.slice(2), open)).not.toContainEqual({
      from: 0,
      to: 16,
      insert: ONE[1],
    });
  });

  it('keeps a split paragraph apart', () => {
    // A paragraph break added after "d": that change is a barrier, and the block before it
    // keeps fewer than half of its words but is not replaced whole.
    expect(joinedHunks('a b c d e f', 'x b y z\n\ne f', open)).toEqual([
      { from: 0, to: 7, insert: 'x b y' },
      { from: 8, to: 8, insert: 'z\n\n' },
    ]);
    // Two paragraphs joined: the break taken away is a change of its own.
    expect(joinedHunks('a b c d.\n\ne f', 'x b y d e f', open)).toEqual([
      { from: 0, to: 5, insert: 'x b y' },
      { from: 7, to: 10, insert: ' ' },
    ]);
    const parts = blocksOf(runsOf('a b c d.\n\ne f', 'x b y d e f'), 'a b c d.\n\ne f');
    expect(parts.map((part) => [part.kind, part.besideBarrier ?? false])).toEqual([
      ['block', true],
      ['barrier', false],
      ['block', true],
    ]);
  });

  it('leaves an unchanged separator run unchanged', () => {
    for (const [first, second] of [
      [true, false],
      [false, true],
      [true, true],
    ] as const) {
      const { hunks } = two('\n\n', first, second);
      expect(hunks.every((hunk) => hunk.to <= 16 || hunk.from >= 18)).toBe(true);
    }
  });

  it('cuts the runs at the breaks of unchanged text', () => {
    const before = `${ONE[0]}\n\n${TWO[0]}`;
    const parts = blocksOf(runsOf(before, `${ONE[1]}\n\n${TWO[0]}`), before);
    expect(parts.map((part) => [part.kind, part.at])).toEqual([
      ['block', 0],
      ['break', 16],
      ['block', 18],
    ]);
  });
});
