// A block change of a block that is all your own new text (format §2.6, "Your own pending
// changes don't count", #173): a paragraph you typed becomes a heading, a quote or an item by typing
// the syntax into your insertion, whichever side of its hidden markers the caret stands, in a document
// typed in one go, and with your own split right after it. Every state of every order of decisions is
// read by micromark 4.0.2 with GFM: the structure (`expectEveryDecision`, `expectEveryOrderAlike`) and
// the words (`expectSameWords`).

import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { EditError } from './errors.ts';
import type { BlockType, FormatOp } from './format-ops.ts';
import { trackedFormat } from './formatting.ts';
import { parse } from './parse.ts';
import { expectSameWords, expectSampledDecisions } from './own-block-oracle.ts';
import {
  ada,
  bodyOf,
  context,
  exactly,
  expectEveryDecision,
  expectEveryOrderAlike,
  file,
  thread,
} from './test-helpers.ts';
import type { EditContext, Range } from './types.ts';

const ctx = (): EditContext => context(ada, ['m2bd', 'n8fx', 'p7qd', 'd3x9', 'g3rp']);
const block = (to: BlockType): FormatOp => ({ kind: 'block', to });

/** What the serializer writes in front of the text of each type. */
const SYNTAX: Partial<Record<BlockType, string>> = {
  p: '',
  h1: '# ',
  h2: '## ',
  h3: '### ',
  h4: '#### ',
  h5: '##### ',
  h6: '###### ',
  quote: '> ',
  ul: '- ',
  ol: '1. ',
  task: '- [ ] ',
};
const TYPES = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'quote', 'ul', 'ol', 'task'] as const;

const JOINS =
  'Rejecting the line break after your new paragraph would join the text below to it, which this change would read otherwise. Accept your new paragraph and its line break first.';
const JOINS_MARKED =
  'A pending change stands in the lines just below your new paragraph, which its line break parts it from. Accept or reject it, your new paragraph and its line break first.';
const AT_START_OWN =
  'Your new text starts this block, and would have to move. Accept or reject your new text and its line breaks first.';
const IN_PARAGRAPH = 'Accept or reject the changes in this paragraph first.';

/** The words of the typed paragraph in every shape below. */
const WORDS = 'A typed paragraph';

/** Where the caret can stand in a typed paragraph, as the editor puts it: at the start of its text,
 * in it, at its end (before the hidden closer), after the closer (the End key, a click past the end
 * of the line), after the closer and your split's marker, and a selection of all of it. */
function carets(text: string, words = WORDS): Record<string, Range> {
  const from = text.indexOf(words);
  const to = from + words.length;
  const markers = /^(?:<!--\/[a-z0-9]+-->|<!--split [a-z0-9]+-->)*/.exec(text.slice(to))?.[0] ?? '';
  const closer = /^<!--\/[a-z0-9]+-->/.exec(markers)?.[0].length ?? 0;
  return {
    start: { from, to: from },
    middle: { from: from + 7, to: from + 7 },
    end: { from: to, to },
    'after the closer': { from: to + closer, to: to + closer },
    'after the markers': { from: to + markers.length, to: to + markers.length },
    selected: { from, to },
    'selected with the markers': { from, to: to + markers.length },
  };
}

/**
 * What a block change of your own new text is: no mark, the syntax typed in front of the words. Every
 * order of every decision reads as it does without the syntax, and the same in every order, by
 * micromark: the words, and the typed block as the op asks, every other block as it was. With
 * `sampled`, for a document with more marks than every order can be tried for, random orders.
 */
function expectTyped(
  label: string,
  text: string,
  range: Range,
  to: BlockType,
  words = WORDS,
  sampled = false,
) {
  const op = block(to);
  const { changes, markIds, extendedIds } = trackedFormat(text, range, op, ctx());
  const after = applyChanges(text, changes);
  expect(markIds, `${label}: makes no mark`).toEqual([]);
  expect(parse(after).marks.filter((mark) => mark.kind === 'fmt')).toEqual([]);
  expect(bodyOf(after), label).toBe(bodyOf(text).replace(words, `${SYNTAX[to] ?? ''}${words}`));
  if (sampled) {
    expectSampledDecisions(label, text, after, op, 7, 30);
  } else {
    expectEveryOrderAlike(label, after, exactly);
    expectEveryOrderAlike(label, after);
    const states = expectEveryDecision(label, text, after, [], {
      inPlace: true,
      structure: op,
      alsoChanged: 1,
      limit: 7,
    });
    expect(states, `${label}: the states are looked at`).toBeGreaterThan(0);
    expect(
      expectSameWords(label, text, after, 7),
      `${label}: the words are looked at`,
    ).toBeGreaterThan(0);
  }
  expect(extendedIds.length, label).toBeLessThanOrEqual(1);
  return after;
}

const refusal = (text: string, range: Range, to: BlockType): string => {
  try {
    trackedFormat(text, range, block(to), ctx());
  } catch (error) {
    if (error instanceof EditError) return error.message;
    throw error;
  }
  return 'no error';
};

/** The shapes of a paragraph that is all your own insertion, as the editor writes them. */
const SHAPES: Record<string, { body: string; marks: Record<string, string> }> = {
  'typed between two blocks (the opener alone on its line)': {
    body: `Intro.\n\n<!--ins k3x9-->\n\n${WORDS}<!--/k3x9-->\n\nNext.`,
    marks: { k3x9: 'ada' },
  },
  'typed after the paragraph above, in the break of your split': {
    body: `Intro.<!--ins k3x9--><!--split d3x9-->\n\n${WORDS}<!--/k3x9-->`,
    marks: { k3x9: 'ada', d3x9: 'ada' },
  },
  'typed in an empty file': {
    body: `<!--ins k3x9-->\n\n${WORDS}<!--/k3x9-->`,
    marks: { k3x9: 'ada' },
  },
  'typed in front of the first paragraph, your split after it': {
    body: `<!--ins k3x9-->\n\n${WORDS}<!--/k3x9--><!--split d3x9-->\n\nOne.\n\nTwo.`,
    marks: { k3x9: 'ada', d3x9: 'ada' },
  },
  'typed in front of a paragraph, your split after it': {
    body: `Intro.\n\n<!--ins k3x9-->\n\n${WORDS}<!--/k3x9--><!--split d3x9-->\n\nNext.`,
    marks: { k3x9: 'ada', d3x9: 'ada' },
  },
  'typed under a heading, in front of a heading': {
    body: `# Title\n\n<!--ins k3x9-->\n\n${WORDS}<!--/k3x9--><!--split d3x9-->\n\n## Next`,
    marks: { k3x9: 'ada', d3x9: 'ada' },
  },
  'typed in front of a list': {
    body: `Intro.\n\n<!--ins k3x9-->\n\n${WORDS}<!--/k3x9--><!--split d3x9-->\n\n- one\n- two`,
    marks: { k3x9: 'ada', d3x9: 'ada' },
  },
  'typed in front of a list of task items': {
    body: `Intro.\n\n<!--ins k3x9-->\n\n${WORDS}<!--/k3x9--><!--split d3x9-->\n\n- [ ] one\n- [x] two`,
    marks: { k3x9: 'ada', d3x9: 'ada' },
  },
};

/**
 * What follows the split that parts your new paragraph from the text after it, which rejecting the
 * split joins to the new block's line: what reads alike, as a paragraph's, is allowed, and the rest is
 * refused for every type, with the words that say what to do. Each is a case micromark reads
 * differently after the new syntax than before it, in the state where the paragraph is accepted and
 * the split rejected.
 */
const AFTER_THE_SPLIT: {
  name: string;
  tail: string;
  /** The types it is refused for, with the words; all of them where `all`. */
  refuses?: { types: readonly BlockType[] | 'all'; because: string };
}[] = [
  { name: 'a line of text', tail: 'Next.' },
  { name: 'a line of text and a paragraph after it', tail: 'Next.\n\nAfter.' },
  { name: 'a heading', tail: '## Next' },
  { name: 'a list', tail: '- one\n- two' },
  { name: 'a list of task items', tail: '- [ ] one\n- [x] two' },
  { name: 'a numbered list that starts at 1 under a line', tail: 'Text\n1. one\n2. two' },
  {
    name: 'a line of text and a quote under it',
    tail: 'Text\n> quoted\n> more',
    // The quote's lines would go on the new quote.
    refuses: { types: ['quote'], because: JOINS },
  },
  { name: 'a fence', tail: 'Text\n```sh\ncode\n```' },
  {
    name: 'a quote',
    tail: '> quoted\n> more',
    // The quote's lines would go on the new quote.
    refuses: { types: ['quote'], because: JOINS },
  },
  {
    name: 'a wrapped paragraph',
    tail: 'Line one\nline two',
    refuses: { types: 'all', because: JOINS },
  },
  {
    name: 'a line of text and a setext underline',
    tail: 'Text\n---',
    refuses: { types: 'all', because: JOINS },
  },
  {
    name: 'a line of text and a table delimiter row',
    tail: '| a | b |\n| - | - |\n| c | d |',
    refuses: { types: 'all', because: JOINS },
  },
  {
    // A blank line, then lines indented to the item's text go on the item, not on the code they
    // were: the item swallows them.
    name: 'a line of text, a blank line and indented code',
    tail: 'Run this:\n\n    npm install\n\nNext.',
    refuses: { types: 'all', because: JOINS },
  },
  {
    name: 'an item with a block under it, after a blank line',
    tail: '- a\n\n  para\n- b',
    refuses: { types: 'all', because: JOINS },
  },
  {
    // After a heading an item that holds another marker starts a list inside it; after a paragraph
    // it is text.
    name: 'a line of text and an item that holds a bare marker',
    tail: 'Text\n- -',
    refuses: { types: 'all', because: JOINS },
  },
  {
    name: 'a quote that holds a numbered list',
    tail: '> 1. a\n> 2. b',
    refuses: { types: 'all', because: JOINS },
  },
  {
    name: 'a numbered list under a line, which a number other than 1 does not interrupt',
    tail: 'Text\n2. two\n3. three',
    refuses: { types: 'all', because: JOINS },
  },
  {
    // A backtick fence whose info string holds a backtick is no fence: the line is text.
    name: 'a line of text and a line that looks like a fence',
    tail: 'Text\n```x`y\nmore',
    refuses: { types: 'all', because: JOINS },
  },
  {
    name: 'a line of text and a pending change in the line under it',
    tail: 'Text\n<!--ins m2bd-->new<!--/m2bd--> words',
    refuses: { types: 'all', because: JOINS_MARKED },
  },
];

/** A document typed in one go, in one insertion: the paragraphs have your split between them. */
function typedDocument(paragraphs: number): { body: string; marks: Record<string, string> } {
  const letters = 'bcdfghjkmnpqrstvwxz';
  const marks: Record<string, string> = { k3x9: 'ada' };
  const parts = ['<!--ins k3x9-->\n\nParagraph 0 words'];
  for (let i = 1; i < paragraphs; i++) {
    const id = `s${letters[Math.floor(i / letters.length)]}${letters[i % letters.length]}x`;
    marks[id] = 'ada';
    parts.push(`<!--split ${id}-->\n\nParagraph ${i} words`);
  }
  parts.push('<!--/k3x9-->');
  return { body: parts.join(''), marks };
}

describe('a block change of a block that is all your own new text (format §2.6, #173)', () => {
  for (const [name, shape] of Object.entries(SHAPES)) {
    it(`types the syntax into a paragraph ${name}, wherever the caret stands`, () => {
      const text = file(shape.body, shape.marks);
      for (const [where, range] of Object.entries(carets(bodyOf(text)))) {
        for (const to of TYPES) expectTyped(`${to} with the caret ${where}`, text, range, to);
      }
    });
  }

  for (const { name, tail, refuses } of AFTER_THE_SPLIT) {
    it(`takes your split, or refuses it, in front of ${name}`, () => {
      const marks = { k3x9: 'ada', d3x9: 'ada', m2bd: 'bo' };
      const text = file(
        `Intro.\n\n<!--ins k3x9-->\n\n${WORDS}<!--/k3x9--><!--split d3x9-->\n\n${tail}`,
        marks,
      );
      const range = { from: text.indexOf(WORDS), to: text.indexOf(WORDS) };
      for (const to of TYPES) {
        const refused = refuses && (refuses.types === 'all' || refuses.types.includes(to));
        if (refused) {
          expect(refusal(text, range, to), `${to} in front of ${name}`).toBe(refuses.because);
        } else {
          expectTyped(`${to} in front of ${name}`, text, range, to);
        }
      }
    });
  }

  it('holds for a grid of the lines after your split, each type, each state read by micromark', () => {
    // What follows the split, as plain and as strange as lines get: whatever is allowed reads alike in
    // every order of decisions, and whatever is not says why. (A block indented by a tab, which
    // becomes part of the item that the new block is, is #445, on main as well.)
    const tails = [
      'Next.',
      'Next.\n\nAfter.',
      '## Next',
      '- one\n- two',
      '- [ ] one\n- [x] two',
      '> quoted\n> more',
      '1. one\n2. two',
      'Text\n1. one',
      'Line one\nline two',
      'Text\n---',
      'Text\n===',
      '| a | b |\n| - | - |',
      'Run this:\n\n    npm install',
      '- a\n\n  para\n- b',
      '> 1. a\n> 2. b',
      'Text\n- -',
      'Text\n```x`y\nmore',
      '```\ncode\n```',
      '    code',
      '<div>x</div>',
      '[ref]: http://x.example',
      '* * *',
      '- - -',
      '+ plus',
      '1) paren',
      '# H\ntext',
      '#hashtag',
      '>quoted no space',
      '- [ ]',
      '-',
      '- ',
      '> ',
      '1.',
      '    - nested',
      'a\\\nb',
      'a  \nb',
      '***bold***\nmore',
      '$$\nmath\n$$',
      'Text\n> - a',
      'Text\n> 1. a',
      'Text\n- 1. a',
      'Text\n+ -',
      'Text\n#',
      'Text\n##',
      'Text\n#\nmore',
      'Text\n~~~\ncode\n~~~',
      'Text\n~~~x`y\nmore',
      'Text\n````\ncode\n````',
      'Text\n<!-- note -->',
      'Text\n[a]: b',
      'Text\n\n[a]: b',
      'Text\n\n- a',
      'Text\n\n> q',
      'Text\n\n\n    code',
      'Text\n\n  indented by two',
      'Text\n\n   indented by three',
      'Text\n\n 1',
      'Text\n\n1. a\n\n   para',
      'Text ##\nmore',
      'Text #\n\nAfter',
      'x\n\n---',
      'x\n\n===',
      'x\n\n    ',
      'x\n\n```\n',
    ];
    let allowed = 0;
    let refused = 0;
    for (const tail of tails) {
      const text = file(
        `Intro.\n\n<!--ins k3x9-->\n\n${WORDS}<!--/k3x9--><!--split d3x9-->\n\n${tail}`,
        { k3x9: 'ada', d3x9: 'ada' },
      );
      const range = { from: text.indexOf(WORDS), to: text.indexOf(WORDS) };
      for (const to of ['h2', 'quote', 'ul', 'ol', 'task'] as const) {
        const said = refusal(text, range, to);
        if (said === 'no error') {
          expectTyped(`${to} in front of ${JSON.stringify(tail)}`, text, range, to);
          allowed++;
        } else {
          expect(
            said.length,
            `${to} in front of ${JSON.stringify(tail)}: says why`,
          ).toBeGreaterThan(20);
          refused++;
        }
      }
    }
    expect(allowed, 'what is allowed').toBeGreaterThan(80);
    expect(refused, 'what is refused').toBeGreaterThan(80);
  }, 60_000);

  it('changes a heading to another level and takes it back to body text, in front of a wrapped paragraph', () => {
    // Both are headings: no line after it reads otherwise. Body text would join the lines.
    const text = file(
      `Intro.\n\n<!--ins k3x9-->\n\n## ${WORDS}<!--/k3x9--><!--split d3x9-->\n\nLine one\nline two`,
      { k3x9: 'ada', d3x9: 'ada' },
    );
    const range = { from: text.indexOf(WORDS), to: text.indexOf(WORDS) };
    const level = trackedFormat(text, range, block('h4'), ctx());
    expect(bodyOf(applyChanges(text, level.changes))).toBe(
      bodyOf(text).replace(`## ${WORDS}`, `#### ${WORDS}`),
    );
    expect(refusal(text, range, 'p')).toBe(JOINS);
  });

  it('changes every paragraph of a selection that is all your own new text', () => {
    // Typed in one go: two paragraphs, your split between them, a selection over both.
    const text = file(
      'Intro.<!--ins k3x9--><!--split d3x9-->\n\nFirst words<!--split m2bd-->\n\nSecond words<!--/k3x9-->\n\nNext.',
      { k3x9: 'ada', d3x9: 'ada', m2bd: 'ada' },
    );
    const from = text.indexOf('First');
    const to = text.indexOf('Second words') + 'Second words'.length;
    for (const type of ['h2', 'quote', 'ul'] as const) {
      const op = block(type);
      const { changes, markIds } = trackedFormat(text, { from, to }, op, ctx());
      const after = applyChanges(text, changes);
      expect(markIds, type).toEqual([]);
      const syntax = SYNTAX[type] ?? '';
      expect(bodyOf(after), type).toBe(
        bodyOf(text)
          .replace('First words', `${syntax}First words`)
          .replace('Second words', `${syntax}Second words`),
      );
      expectEveryOrderAlike(type, after, exactly);
      expectEveryDecision(type, text, after, [], {
        inPlace: true,
        structure: op,
        alsoChanged: 2,
        limit: 6,
      });
      expect(expectSameWords(type, text, after), type).toBeGreaterThan(0);
    }
  });

  it('makes a heading of any paragraph of a document typed in one go, the title first', () => {
    // Four paragraphs: every order of every decision. The title is the first paragraph of the
    // insertion, whose opener stands alone in front of it.
    const small = typedDocument(4);
    const text = file(small.body, small.marks);
    for (const which of [0, 1, 2, 3]) {
      const words = `Paragraph ${which} words`;
      const at = text.indexOf(words);
      for (const to of ['h1', 'h2', 'quote', 'ul', 'task'] as const) {
        expectTyped(`${to} on paragraph ${which} of 4`, text, { from: at, to: at }, to, words);
      }
    }
    // Twelve: more marks than every order is tried for; random orders instead, and the same words
    // and blocks in each.
    const long = typedDocument(12);
    const big = file(long.body, long.marks);
    for (const which of [0, 5, 11]) {
      const words = `Paragraph ${which} words`;
      const at = big.indexOf(words);
      for (const to of ['h1', 'h3', 'quote', 'ol'] as const) {
        expectTyped(
          `${to} on paragraph ${which} of 12`,
          big,
          { from: at, to: at },
          to,
          words,
          true,
        );
      }
    }
  }, 60_000);

  it('takes a typed heading back to body text, and changes its level', () => {
    const text = file(
      `Intro.\n\n<!--ins k3x9-->\n\n## ${WORDS}<!--/k3x9--><!--split d3x9-->\n\nNext.`,
      {
        k3x9: 'ada',
        d3x9: 'ada',
      },
    );
    for (const [where, range] of Object.entries(carets(bodyOf(text)))) {
      const body = trackedFormat(text, range, block('p'), ctx());
      expect(body.markIds, where).toEqual([]);
      expect(bodyOf(applyChanges(text, body.changes)), where).toBe(
        bodyOf(text).replace(`## ${WORDS}`, WORDS),
      );
      const level = trackedFormat(text, range, block('h4'), ctx());
      expect(bodyOf(applyChanges(text, level.changes)), where).toBe(
        bodyOf(text).replace(`## ${WORDS}`, `#### ${WORDS}`),
      );
    }
  });

  it('leaves a block that has the type asked already as it is, with no refusal', () => {
    const body = file(`Intro.\n\n<!--ins k3x9-->\n\n${WORDS}<!--/k3x9-->\n\nNext.`, {
      k3x9: 'ada',
    });
    const at = body.indexOf(WORDS);
    expect(trackedFormat(body, { from: at, to: at }, block('p'), ctx()).changes).toEqual([]);
    const heading = file(`Intro.\n\n<!--ins k3x9-->\n\n## ${WORDS}<!--/k3x9-->\n\nNext.`, {
      k3x9: 'ada',
    });
    const there = heading.indexOf(WORDS);
    expect(trackedFormat(heading, { from: there, to: there }, block('h2'), ctx()).changes).toEqual(
      [],
    );
    // An alert you typed, with the type it has.
    const alert = file('Intro.\n\n<!--ins k3x9-->\n\n> [!NOTE]\n> Typed.<!--/k3x9-->\n\nAfter.', {
      k3x9: 'ada',
    });
    const inside = alert.indexOf('Typed');
    expect(
      trackedFormat(alert, { from: inside, to: inside }, { kind: 'callout', type: 'note' }, ctx())
        .changes,
    ).toEqual([]);
    // But a row of a table is no body text: where nothing is written, it says so, as it does for
    // any block.
    const row = file(
      '| a | b |\n| - | - |\n| c | d |<!--ins k3x9--><!--split d3x9-->\n| e | f |<!--/k3x9-->',
      { k3x9: 'ada', d3x9: 'ada' },
    );
    const cell = row.indexOf('e |');
    expect(
      () => trackedFormat(row, { from: cell, to: cell }, block('p'), ctx()).changes,
    ).not.toThrow();
  });

  it("types the syntax where another person's change is in the middle of your insertion", () => {
    const text = file(
      `Intro.\n\n<!--ins k3x9-->\n\nA typed <!--del m2bd big -->paragraph<!--/k3x9-->`,
      { k3x9: 'ada', m2bd: 'bo' },
    );
    const from = text.indexOf('paragraph');
    for (const to of ['h2', 'quote', 'ul'] as const) {
      expectTyped(to, text, { from, to: from }, to, 'A typed ');
    }
  });

  it('types the syntax where a comment or a highlight is inside your insertion, at its start too', () => {
    for (const [name, body, marks, threads] of [
      [
        'a comment at the start',
        'Intro.\n\n<!--ins k3x9-->\n\n<!--cmt c8d2-->\n\nA typed paragraph<!--/c8d2--><!--/k3x9-->\n\nNext.',
        { k3x9: 'ada' },
        thread('c8d2', 'bo'),
      ],
      [
        'a comment on some words',
        'Intro.\n\n<!--ins k3x9-->\n\nA typed <!--cmt c8d2-->paragraph<!--/c8d2--><!--/k3x9-->\n\nNext.',
        { k3x9: 'ada' },
        thread('c8d2', 'bo'),
      ],
      [
        'a highlight at the start',
        'Intro.\n\n<!--ins k3x9-->\n\n<!--hl h6bz-->\n\nA typed paragraph<!--/h6bz--><!--/k3x9-->\n\nNext.',
        { k3x9: 'ada', h6bz: 'bo' },
        [],
      ],
      [
        'a highlight on some words',
        'Intro.\n\n<!--ins k3x9-->\n\nA typed <!--hl h6bz-->paragraph<!--/h6bz--><!--/k3x9-->\n\nNext.',
        { k3x9: 'ada', h6bz: 'bo' },
        [],
      ],
    ] as const) {
      const text = file(body, marks, [...threads]);
      const from = text.indexOf('A typed');
      for (const to of ['h2', 'quote', 'ul'] as const) {
        expectTyped(`${name}, ${to}`, text, { from, to: from }, to, 'A typed ');
      }
    }
  });

  it('refuses where a comment or a highlight stands around your insertion, with words to decide it first', () => {
    for (const [name, body, marks, threads] of [
      [
        'a comment',
        'Intro.\n\n<!--cmt c8d2-->\n\n<!--ins k3x9-->\n\nA typed paragraph<!--/k3x9--><!--/c8d2-->\n\nNext.',
        { k3x9: 'ada' },
        thread('c8d2', 'bo'),
      ],
      [
        'a highlight',
        'Intro.\n\n<!--hl h6bz-->\n\n<!--ins k3x9-->\n\nA typed paragraph<!--/k3x9--><!--/h6bz-->\n\nNext.',
        { k3x9: 'ada', h6bz: 'ada' },
        [],
      ],
    ] as const) {
      const text = file(body, marks, [...threads]);
      const from = text.indexOf('A typed');
      expect(refusal(text, { from, to: from }, 'h2'), name).toBe(AT_START_OWN);
    }
  });

  it("refuses where another person's change starts the paragraph, with words to decide it first", () => {
    // Typed after it, `## ` would stand in the middle of a line once their deletion is rejected.
    const text = file(
      `Intro.\n\n<!--ins k3x9-->\n\n<!--del m2bd A -->\n\ntyped paragraph<!--/k3x9-->`,
      { k3x9: 'ada', m2bd: 'bo' },
    );
    const from = text.indexOf('typed paragraph');
    expect(refusal(text, { from, to: from }, 'h2')).toBe(IN_PARAGRAPH);
  });

  it("refuses where another person's change inside your paragraph holds a line break", () => {
    // With their deletion of `⏎| - |` rejected, the paragraph and `| - |` are a table to micromark; with
    // `## ` typed in front, a heading and a line of text.
    const text = file(
      `Intro.\n\n<!--ins k3x9-->\n\nA typed paragraph<!--del m2bd \\n| - |--><!--/k3x9-->\n\nNext.`,
      { k3x9: 'ada', m2bd: 'bo' },
    );
    const from = text.indexOf('A typed');
    for (const to of ['h2', 'quote', 'ul'] as const) {
      expect(refusal(text, { from, to: from }, to), to).toBe(IN_PARAGRAPH);
    }
    // And another person's split in it.
    const split = file(
      `Intro.\n\n<!--ins k3x9-->\n\nA typed <!--split m2bd-->\n\nparagraph<!--/k3x9-->\n\nNext.`,
      { k3x9: 'ada', m2bd: 'bo' },
    );
    const there = split.indexOf('A typed');
    expect(refusal(split, { from: there, to: there }, 'h2')).toBe(IN_PARAGRAPH);
  });

  it('takes three changes of other people inside the paragraph and refuses five: four marks at most', () => {
    const marks = (n: number): Record<string, string> => {
      const found: Record<string, string> = { k3x9: 'ada' };
      for (let i = 0; i < n; i++) found[`m${i + 2}bd`] = 'bo';
      return found;
    };
    const body = (n: number) =>
      `Intro.\n\n<!--ins k3x9-->\n\nA typed ${[...Array(n).keys()]
        .map((i) => `<!--del m${i + 2}bd x-->w${i} `)
        .join('')}end<!--/k3x9-->\n\nNext.`;
    const three = file(body(3), marks(3));
    const at = three.indexOf('A typed');
    expectTyped('three', three, { from: at, to: at }, 'h2', 'A typed ');
    const five = file(body(5), marks(5));
    expect(refusal(five, { from: at, to: at }, 'h2')).toBe(IN_PARAGRAPH);
  });

  it('refuses where an older change starts the block', () => {
    // Another person's pending insertion starts the paragraph; yours is the new text after it.
    const text = file('Intro.\n\n<!--ins m2bd-->\n\nTheirs<!--/m2bd--> and ours.', { m2bd: 'bo' });
    const from = text.indexOf('Theirs');
    expect(refusal(text, { from, to: from }, 'h2')).toBe(IN_PARAGRAPH);
  });
});

// A timing test: it runs with REDLINES_COST set, and a run over its bound is timed twice more, each
// time with its yardstick, before it fails. The bound is what a block change costs for a paragraph
// of the same file that has no insertion of yours in it (the format's mark), five times and 10 ms.
describe.skipIf(!process.env['REDLINES_COST'])(
  'the cost of a block change of your own new text',
  () => {
    const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1] as number;
    const time = (text: string, at: number) => {
      const runs: number[] = [];
      for (let i = 0; i < 12; i++) {
        const start = performance.now();
        trackedFormat(text, { from: at, to: at }, block('h2'), ctx());
        runs.push(performance.now() - start);
      }
      return median(runs.slice(2));
    };
    const filler = Array.from(
      { length: 1500 },
      (_, i) =>
        `Paragraph ${i} has some words, with *emphasis* and a [link](https://example.org/${i}).`,
    );

    it('is at most five times and 10 ms more than for a paragraph of the same file that is not', () => {
      const plain = file([...filler, 'Plain target paragraph here.'].join('\n\n'), {});
      const typed = file(
        `${filler.join('\n\n')}<!--ins k3x9--><!--split d3x9-->\n\nTyped target words<!--/k3x9-->`,
        { k3x9: 'ada', d3x9: 'ada' },
      );
      const attempt = () => ({
        yardstick: time(plain, plain.indexOf('Plain target') + 2),
        ours: time(typed, typed.indexOf('Typed target') + 2),
      });
      let best = attempt();
      for (let n = 0; n < 2 && best.ours >= 5 * best.yardstick + 10; n++) {
        const next = attempt();
        if (next.ours / (5 * next.yardstick + 10) < best.ours / (5 * best.yardstick + 10))
          best = next;
      }
      console.log(
        `cost: heading on a typed paragraph ${best.ours.toFixed(1)} ms, plain ${best.yardstick.toFixed(1)} ms`,
      );
      expect(best.ours).toBeLessThan(5 * best.yardstick + 10);
    }, 120_000);

    it('is the same for any paragraph of a document typed in one go, 300 paragraphs', () => {
      const long = typedDocument(300);
      const text = file(long.body, long.marks);
      const yardstick = time(
        file([...filler, 'Plain target paragraph here.'].join('\n\n'), {}),
        40,
      );
      for (const which of [0, 150, 299]) {
        const ours = time(text, text.indexOf(`Paragraph ${which} words`) + 2);
        console.log(
          `cost: heading on paragraph ${which} of 300 typed in one go ${ours.toFixed(1)} ms`,
        );
        expect(ours).toBeLessThan(50 * yardstick + 50);
      }
    }, 120_000);
  },
);
