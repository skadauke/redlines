// A block change of a block that is all your own new text (format §2.6, "Your own pending
// changes don't count", #173): a paragraph you typed becomes a heading, a quote or an item by typing
// the syntax into your insertion, whichever side of its hidden markers the caret stands, and with your
// own split or another person's change right after it. Every state of every order of decisions is
// read by micromark 4.0.2 with GFM (`expectEveryDecision`, `expectEveryOrderAlike`).

import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { EditError } from './errors.ts';
import type { BlockType, FormatOp } from './format-ops.ts';
import { trackedFormat } from './formatting.ts';
import { parse } from './parse.ts';
import {
  bodyOf,
  context,
  ada,
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
  'Rejecting the line break after your new paragraph would join the text below to it, which this change would read otherwise. Accept your new paragraph first.';

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

/** What a block change of your own new text is: no mark, the syntax typed in front of the words. */
function expectTyped(label: string, text: string, range: Range, to: BlockType, words = WORDS) {
  const op = block(to);
  const { changes, markIds, extendedIds } = trackedFormat(text, range, op, ctx());
  const after = applyChanges(text, changes);
  expect(markIds, `${label}: makes no mark`).toEqual([]);
  expect(parse(after).marks.filter((mark) => mark.kind === 'fmt')).toEqual([]);
  expect(bodyOf(after), label).toBe(bodyOf(text).replace(words, `${SYNTAX[to] ?? ''}${words}`));
  // Every order of every decision reads as it does without the syntax, and the same in every order,
  // by micromark: the typed block as the op asks, every other block as it was.
  expectEveryOrderAlike(label, after, exactly);
  expectEveryOrderAlike(label, after);
  expectEveryDecision(label, text, after, [], {
    inPlace: true,
    structure: op,
    alsoChanged: 1,
    limit: 6,
  });
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
const SHAPES: Record<
  string,
  { body: string; marks: Record<string, string>; refuses?: BlockType[]; because?: string }
> = {
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
  'typed in front of a quote': {
    body: `<!--ins k3x9-->\n\n${WORDS}<!--/k3x9--><!--split d3x9-->\n\n> quoted\n> more`,
    marks: { k3x9: 'ada', d3x9: 'ada' },
    // Rejecting the split would join the quote's first line to the new quote, and the lines after
    // it would go on it: another block would read otherwise.
    refuses: ['quote'],
    because: JOINS,
  },
};

describe('a block change of a block that is all your own new text (format §2.6, #173)', () => {
  for (const [name, shape] of Object.entries(SHAPES)) {
    it(`types the syntax into a paragraph ${name}, wherever the caret stands`, () => {
      const text = file(shape.body, shape.marks);
      for (const [where, range] of Object.entries(carets(bodyOf(text)))) {
        for (const to of TYPES) {
          const label = `${to} with the caret ${where}`;
          if (shape.refuses?.includes(to)) {
            expect(refusal(text, range, to), label).toBe(shape.because);
          } else {
            expectTyped(label, text, range, to);
          }
        }
      }
    });
  }

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
    }
  });

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
      expect(refusal(text, { from, to: from }, 'h2'), name).toMatch(
        /starts this block, and would have to move\. (?:Decide it|Accept or reject it) first\.$/,
      );
    }
  });

  it("refuses where another person's change starts the paragraph, with words to decide it first", () => {
    // Typed after it, `## ` would stand in the middle of a line once their deletion is rejected.
    const text = file(
      `Intro.\n\n<!--ins k3x9-->\n\n<!--del m2bd A -->\n\ntyped paragraph<!--/k3x9-->`,
      { k3x9: 'ada', m2bd: 'bo' },
    );
    const from = text.indexOf('typed paragraph');
    expect(refusal(text, { from, to: from }, 'h2')).toBe(
      'Accept or reject the changes in this paragraph first.',
    );
  });
});
