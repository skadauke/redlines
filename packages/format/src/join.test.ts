import { describe, expect, it } from 'vitest';
import { joinRuns, joinable, prefixSpans, runsOf, wordsIn } from './join.ts';
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
