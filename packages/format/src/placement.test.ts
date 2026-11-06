import { micromark } from 'micromark';
import { describe, expect, it } from 'vitest';
import { suggestReplace } from './agent.ts';
import { applyChanges } from './changes.ts';
import { addComment } from './comments.ts';
import { accept, acceptAll, reject, rejectAll } from './decide.ts';
import { EditError } from './errors.ts';
import { parse } from './parse.ts';
import { ada, bo, bodyOf, claudeAda, context, file, thread } from './test-helpers.ts';
import { trackedEdit } from './track.ts';
import type { Person, Range, TextChange } from './types.ts';
import { newestView, originalView } from './views.ts';

/** The body of a file without the line break that ends it. */
const bodyText = (text: string) => bodyOf(text).replace(/\n+$/, '');

/** The newest and the original view of a file without the line breaks that end them. */
const newest = (text: string) => newestView(text).text.replace(/\n+$/, '');
const original = (text: string) => originalView(text).text.replace(/\n+$/, '');

/** What every edit must leave (format §3.2): no marker starts a line that has other text on it,
 * nothing else is wrong with the file, and the original view is the one it was. */
function expectPlaced(before: string, after: string): void {
  expect(parse(after).warnings).toEqual([]);
  expect(original(after)).toBe(original(before));
}

/** A tracked edit of a file with `body`: the new file. */
function track(
  body: string,
  edit: TextChange,
  ids: string[],
  author: Person = ada,
  marks: Record<string, string> = {},
): { before: string; after: string; body: string } {
  const before = file(body, marks);
  const after = applyChanges(before, trackedEdit(before, edit, context(author, ids)));
  expectPlaced(before, after);
  return { before, after, body: bodyText(after) };
}

const at = (body: string, needle: string): number => {
  const found = body.indexOf(needle);
  if (found < 0) throw new Error(`No ${needle} in the body`);
  return found;
};

describe('a mark that starts a block has its opener on the line before (format §3.3)', () => {
  it('goes before typing at the start of a paragraph', () => {
    const { body, after } = track('Para text.', { from: 0, to: 0, insert: 'Also, ' }, ['k3x9']);
    expect(body).toBe('<!--ins k3x9-->\n\nAlso, <!--/k3x9-->Para text.');
    expect(newest(after)).toBe('Also, Para text.');
  });

  it('goes before typing at the start of a list item, and does not loosen the list', () => {
    const text = '- one\n- two\n- three';
    const { body, after } = track(
      text,
      { from: at(text, 'two'), to: at(text, 'two'), insert: 'new ' },
      ['k3x9'],
    );
    expect(body).toBe('- one\n- <!--ins k3x9-->\n  new <!--/k3x9-->two\n- three');
    expect(newest(after)).toBe('- one\n- new two\n- three');
  });

  it('goes before typing at the start of a numbered item and of a quote line', () => {
    const numbered = '1. one\n2. two';
    const item = track(
      numbered,
      { from: at(numbered, 'two'), to: at(numbered, 'two'), insert: 'x' },
      ['k3x9'],
    );
    expect(item.body).toBe('1. one\n2. <!--ins k3x9-->\n   x<!--/k3x9-->two');
    const quote = '> quoted line\n> next';
    const quoted = track(quote, { from: 2, to: 2, insert: 'new ' }, ['k3x9']);
    expect(quoted.body).toBe('> <!--ins k3x9-->\n>\n> new <!--/k3x9-->quoted line\n> next');
    expect(newest(quoted.after)).toBe('> new quoted line\n> next');
  });

  it('goes before typing at the start of a paragraph after another', () => {
    const text = 'First.\n\nSecond.';
    const { body } = track(
      text,
      { from: at(text, 'Second'), to: at(text, 'Second'), insert: 'And ' },
      ['k3x9'],
    );
    expect(body).toBe('First.\n\n<!--ins k3x9-->\n\nAnd <!--/k3x9-->Second.');
  });

  it('goes before the deletion of the first word of a block', () => {
    const word = track('Note: The importer ships.', { from: 0, to: 6, insert: '' }, ['t6wv']);
    expect(word.body).toBe('<!--del t6wv Note: -->\n\nThe importer ships.');
    expect(newest(word.after)).toBe('The importer ships.');
    const text = '- one two\n- three';
    const item = track(text, { from: 2, to: 6, insert: '' }, ['t6wv']);
    expect(item.body).toBe('- <!--del t6wv one -->\n  two\n- three');
  });

  it('goes before the replacement of the first word of a block', () => {
    const { body, after } = track('Alpha beta', { from: 0, to: 5, insert: 'Omega' }, ['k3x9']);
    expect(body).toBe('<!--sub k3x9 Alpha-->\n\nOmega<!--/k3x9--> beta');
    expect(newest(after)).toBe('Omega beta');
  });

  it('goes before the deletion of the whole first line of a block, with the line break', () => {
    // The break is not lost with the carrier of the opener: it goes into the deletion.
    const para = track('first line\nsecond line', { from: 0, to: 10, insert: '' }, ['t6wv']);
    expect(para.body).toBe('<!--del t6wv first line\\n-->\n\nsecond line');
    expect(newest(para.after)).toBe('second line');
    expect(bodyText(applyChanges(para.after, reject(para.after, 't6wv')))).toBe(
      'first line\nsecond line',
    );
    const item = track('- one\n  two', { from: 2, to: 5, insert: '' }, ['t6wv']);
    expect(item.body).toBe('- <!--del t6wv one\\n  -->\n  two');
    expect(bodyText(applyChanges(item.after, reject(item.after, 't6wv')))).toBe('- one\n  two');
  });

  it('goes before a deletion that takes a whole paragraph in front of a list', () => {
    // The bug of the review: `<!--del … \n\n-->- first item`, which a renderer reads as raw HTML.
    const text = 'Para one.\n\n- first item\n- second';
    const wanted = '<!--del t6wv Para one.\\n\\n-->\n\n- first item\n- second';
    // The text of the paragraph, the paragraph and a line break, and the paragraph with its blank
    // line, up to the first column of the bullet: all delete the block and leave the bullet alone.
    for (const to of [9, 10, 11]) {
      const { body, after } = track(text, { from: 0, to, insert: '' }, ['t6wv']);
      expect(body, `to ${to}`).toBe(wanted);
      expect(newest(after), `to ${to}`).toBe('- first item\n- second');
    }
  });

  it('is taken away with the opener when the mark is decided', () => {
    const { after } = track('Para text.', { from: 0, to: 0, insert: 'Also, ' }, ['k3x9']);
    expect(newest(applyChanges(after, accept(after, 'k3x9')))).toBe('Also, Para text.');
    expect(bodyText(applyChanges(after, accept(after, 'k3x9')))).toBe('Also, Para text.');
    expect(bodyText(applyChanges(after, reject(after, 'k3x9')))).toBe('Para text.');
  });

  it('is kept for a mark that a decision puts at the start of a block', () => {
    // Rejecting Ada's deletion brings back the word that stood in front of Bo's comment.
    const text = file('Alpha <!--cmt c8d2-->beta<!--/c8d2--> gamma', {}, [
      '  c8d2:',
      '    by: bo',
      '    at: 2026-10-13T22:40Z',
      '    text: |-',
      '      Why?',
    ]);
    const deleted = applyChanges(
      text,
      trackedEdit(text, { from: 0, to: 6, insert: '' }, context(ada, ['t6wv'])),
    );
    expect(bodyText(deleted)).toBe(
      '<!--del t6wv Alpha -->\n\n<!--cmt c8d2-->\n\nbeta<!--/c8d2--> gamma',
    );
    expect(parse(deleted).warnings).toEqual([]);
    // Accepting it leaves the comment at the start of the block, with its own line.
    const accepted = applyChanges(deleted, accept(deleted, 't6wv'));
    expect(bodyText(accepted)).toBe('<!--cmt c8d2-->\n\nbeta<!--/c8d2--> gamma');
    expect(parse(accepted).warnings).toEqual([]);
    // Rejecting it puts the word back in front of the comment, which loses its own line.
    const rejected = applyChanges(deleted, reject(deleted, 't6wv'));
    expect(bodyText(rejected)).toBe('Alpha <!--cmt c8d2-->beta<!--/c8d2--> gamma');
    expect(parse(rejected).warnings).toEqual([]);
  });
});

describe('a mark that ends a block closes at the end of its last line (format §3.3)', () => {
  it('comments on a whole paragraph and a whole list item', () => {
    const para = 'Para one.\n\nPara two.';
    const first = file(para);
    const range: Range = { from: at(para, 'Para two.'), to: para.length };
    const { changes } = addComment(first, range, 'A note.', context(ada, ['c9qf']));
    const commented = applyChanges(first, changes);
    expect(bodyText(commented)).toBe('Para one.\n\n<!--cmt c9qf-->\n\nPara two.<!--/c9qf-->');
    expect(parse(commented).warnings).toEqual([]);
    expect(newest(commented)).toBe(newest(first));

    const list = file('- one\n- two');
    const item = addComment(list, { from: 8, to: 11 }, 'A note.', context(ada, ['c9qf']));
    const listed = applyChanges(list, item.changes);
    expect(bodyText(listed)).toBe('- one\n- <!--cmt c9qf-->\n  two<!--/c9qf-->');
    expect(parse(listed).warnings).toEqual([]);
  });

  it('ends a comment at the end of the paragraph when the range reaches the next block', () => {
    const body = 'Para one.\n\nPara two.';
    const text = file(body);
    // The range ends where the second paragraph starts: after the break.
    const range: Range = { from: 5, to: at(body, 'Para two.') };
    const { changes } = addComment(text, range, 'A note.', context(ada, ['c9qf']));
    const commented = applyChanges(text, changes);
    expect(bodyText(commented)).toBe('Para <!--cmt c9qf-->one.<!--/c9qf-->\n\nPara two.');
    expect(parse(commented).warnings).toEqual([]);
  });

  it('ends a comment before the start of a wrapped line, and starts it at the end of the line before', () => {
    const body = 'one two\nthree four';
    const text = file(body);
    const range: Range = { from: at(body, 'three'), to: body.length };
    const { changes } = addComment(text, range, 'A note.', context(ada, ['c9qf']));
    const commented = applyChanges(text, changes);
    expect(bodyText(commented)).toBe('one two<!--cmt c9qf-->\nthree four<!--/c9qf-->');
    expect(parse(commented).warnings).toEqual([]);
    const other = addComment(
      text,
      { from: 0, to: at(body, 'three') },
      'A note.',
      context(ada, ['c9qf']),
    );
    expect(bodyText(applyChanges(text, other.changes))).toBe(
      '<!--cmt c9qf-->\n\none two<!--/c9qf-->\nthree four',
    );
  });
});

describe('a line break is a split (format §3.4)', () => {
  it('is made by Enter in the middle of a paragraph', () => {
    const { body, after } = track('Hello world', { from: 5, to: 5, insert: '\n\n' }, ['s3vb']);
    expect(body).toBe('Hello<!--split s3vb-->\n\n world');
    expect(newest(after)).toBe('Hello\n\n world');
    expect(original(after)).toBe('Hello world');
    expect(bodyText(applyChanges(after, reject(after, 's3vb')))).toBe('Hello world');
    expect(bodyText(applyChanges(after, accept(after, 's3vb')))).toBe('Hello\n\n world');
  });

  it('is made by Enter in a list item, with the bullet of the new item', () => {
    const { body, after } = track('- one two', { from: 5, to: 5, insert: '\n- ' }, ['s3vb']);
    expect(body).toBe('- one<!--split s3vb-->\n-  two');
    expect(newest(after)).toBe('- one\n-  two');
    expect(bodyText(applyChanges(after, reject(after, 's3vb')))).toBe('- one two');
  });

  it('is made by typed text with a break in it, which is not an insertion with a break in it', () => {
    const { body, after } = track('a b', { from: 1, to: 1, insert: 'x\n\ny' }, ['k3x9', 's3vb']);
    expect(body).toBe('a<!--ins k3x9-->x<!--split s3vb-->\n\ny<!--/k3x9--> b');
    expect(newest(after)).toBe('ax\n\ny b');
    // The original text has no break and none of the new text.
    expect(original(after)).toBe('a b');
  });

  it('puts a break after typed text behind the insertion', () => {
    const { body, after } = track('First.\n\nThird.', { from: 8, to: 8, insert: 'Second.\n\n' }, [
      'k3x9',
      's3vb',
    ]);
    expect(newest(after)).toBe('First.\n\nSecond.\n\nThird.');
    expect(original(after)).toBe('First.\n\nThird.');
    expect(parse(after).warnings).toEqual([]);
    expect(body).toContain('<!--split s3vb-->');
  });

  it('is not an insertion of a text that holds a break, in the middle of one of my insertions', () => {
    const before = file('a <!--ins k3x9-->bc<!--/k3x9--> d', { k3x9: 'ada' });
    const edit = { from: at(before, 'c<'), to: at(before, 'c<'), insert: '\n\n' };
    const after = applyChanges(before, trackedEdit(before, edit, context(ada, ['s3vb'])));
    expect(bodyText(after)).toBe('a <!--ins k3x9-->b<!--split s3vb-->\n\nc<!--/k3x9--> d');
    expect(parse(after).warnings).toEqual([]);
  });
});

describe('a deletion takes a break with the prefix of the next block (format §3.4)', () => {
  it('joins two paragraphs: the break is the deletion', () => {
    const { body, after } = track('Para\n\nHeading text', { from: 4, to: 6, insert: '' }, ['j7mm']);
    expect(body).toBe('Para<!--del j7mm \\n\\n-->Heading text');
    expect(newest(after)).toBe('ParaHeading text');
  });

  it('takes the # of a heading with the break', () => {
    const text = 'Para\n\n## Heading text';
    const { body, after } = track(text, { from: 4, to: 6, insert: '' }, ['j7mm']);
    expect(body).toBe('Para<!--del j7mm \\n\\n## -->Heading text');
    expect(newest(after)).toBe('ParaHeading text');
    expect(bodyText(applyChanges(after, reject(after, 'j7mm')))).toBe(text);
  });

  it('takes the bullet with the break, even when the range stops short of the bullet', () => {
    const text = 'Intro text.\n\n- first item\n- second';
    const { body } = track(text, { from: 6, to: at(text, '- first'), insert: '' }, ['k3x9']);
    expect(body).toBe('Intro <!--del k3x9 text.\\n\\n- -->first item\n- second');
  });

  it('is one mark across blocks, as in the example of format §3.4', () => {
    const text = 'Alpha one two three.\n\n## Middle heading\n\nGamma four five six.';
    const { body, after } = track(
      text,
      { from: at(text, 'two'), to: at(text, 'five'), insert: '' },
      ['k3x9'],
    );
    expect(body).toBe(
      'Alpha one <!--del k3x9 two three.\\n\\n## Middle heading\\n\\nGamma four -->five six.',
    );
    expect(newest(after)).toBe('Alpha one five six.');
    expect(bodyText(applyChanges(after, reject(after, 'k3x9')))).toBe(text);
  });

  it('takes the break and the item of a list item that is deleted whole', () => {
    const text = '- one\n- two\n- three';
    const middle = track(text, { from: at(text, 'two'), to: at(text, 'two') + 3, insert: '' }, [
      'k3x9',
    ]);
    expect(middle.body).toBe('- one\n- <!--del k3x9 two\\n- -->\n  three');
    expect(newest(middle.after)).toBe('- one\n- three');
    const last = track(text, { from: at(text, 'three'), to: text.length, insert: '' }, ['k3x9']);
    expect(last.body).toBe('- one\n- two<!--del k3x9 \\n- three-->');
    expect(newest(last.after)).toBe('- one\n- two');
  });

  it('refuses to delete a break that someone inserted together with other text', () => {
    const before = file('Hello<!--split s3vb-->\n\n world', { s3vb: 'bo' });
    const edit = { from: at(before, 'Hello') + 3, to: at(before, '\n\n') + 2, insert: '' };
    expect(() => trackedEdit(before, edit, context(ada, ['k3x9']))).toThrow(EditError);
  });
});

describe('Backspace over the break of a split (format §3.4)', () => {
  /** A file whose first paragraph is split by `author` after `One`. */
  function split(author: Person, brk: string) {
    const id = 's3vb';
    const before = file(`One<!--split ${id}-->${brk}two three.\n\nNext.`, { [id]: author.handle });
    return { before, start: at(before, brk), end: at(before, brk) + brk.length };
  }

  it('cancels my own split and puts the paragraph back together', () => {
    for (const brk of ['\n', '\n\n']) {
      const { before, start, end } = split(ada, brk);
      // The last character of the break, as Backspace at the start of the line deletes it, and
      // the whole break, as a selection does.
      for (const edit of [
        { from: end - 1, to: end, insert: '' },
        { from: start, to: end, insert: '' },
      ]) {
        const after = applyChanges(before, trackedEdit(before, edit, context(ada)));
        expect(bodyText(after), JSON.stringify(brk)).toBe('Onetwo three.\n\nNext.');
        expect(parse(after).marks).toEqual([]);
        expect(parse(after).ledger.marks).toEqual({});
      }
    }
  });

  it('cancels my own split with a bullet of its break, and the whole of a split it is part of', () => {
    const list = file('- one<!--split s3vb-->\n-  two', { s3vb: 'ada' });
    const edit = { from: at(list, '\n- '), to: at(list, '\n- ') + 3, insert: '' };
    expect(bodyText(applyChanges(list, trackedEdit(list, edit, context(ada))))).toBe('- one two');
    // Inside my insertion, the split goes and the insertion goes on.
    const inside = file('a <!--ins k3x9-->b<!--split s3vb-->\n\nc<!--/k3x9--> d', {
      k3x9: 'ada',
      s3vb: 'ada',
    });
    const at2 = { from: at(inside, '\n\n'), to: at(inside, '\n\n') + 2, insert: '' };
    const after = applyChanges(inside, trackedEdit(inside, at2, context(ada)));
    expect(bodyText(after)).toBe('a <!--ins k3x9-->bc<!--/k3x9--> d');
  });

  it('dissolves an insertion of mine that holds nothing but the split when its text goes', () => {
    const typed = file('One<!--ins k3x9--><!--split s3vb-->\nX<!--/k3x9--> two', {
      k3x9: 'ada',
      s3vb: 'ada',
    });
    // Delete the X: the split is what is left of the Enter, and the closer would start a line.
    const x = at(typed, 'X<');
    const withoutX = applyChanges(
      typed,
      trackedEdit(typed, { from: x, to: x + 1, insert: '' }, context(ada)),
    );
    expect(bodyText(withoutX)).toBe('One<!--split s3vb-->\n two');
    expect(Object.keys(parse(withoutX).ledger.marks)).toEqual(['s3vb']);
    // And the Backspace after it takes the break.
    const brk = at(withoutX, '\n');
    const after = applyChanges(
      withoutX,
      trackedEdit(withoutX, { from: brk, to: brk + 1, insert: '' }, context(ada)),
    );
    expect(bodyText(after)).toBe('One two');
    expect(parse(after).ledger.marks).toEqual({});
  });

  it('records the deletion of the break of another person’s split, which is a join', () => {
    for (const brk of ['\n', '\n\n']) {
      const { before, start, end } = split(bo, brk);
      const edit = { from: end - 1, to: end, insert: '' };
      const after = applyChanges(before, trackedEdit(before, edit, context(ada, ['d3x9'])));
      // The deletion stands right after the marker, with the break as its text.
      expect(bodyText(after), JSON.stringify(brk)).toBe(
        `One<!--split s3vb--><!--del d3x9 ${brk.replaceAll('\n', '\\n')}-->two three.\n\nNext.`,
      );
      expect(parse(after).warnings).toEqual([]);
      expect(newest(after)).toBe('Onetwo three.\n\nNext.');
      // The break was not there before the split, and still is not in the original text.
      expect(original(after)).toBe(original(before));
      // Rejecting the split takes the deletion with it; accepting it leaves the deletion.
      expect(bodyText(applyChanges(after, reject(after, 's3vb')))).toBe('Onetwo three.\n\nNext.');
      expect(bodyText(applyChanges(after, accept(after, 's3vb')))).toBe(
        `One<!--del d3x9 ${brk.replaceAll('\n', '\\n')}-->two three.\n\nNext.`,
      );
      // Rejecting the deletion brings the break back, still bo's pending split.
      expect(bodyText(applyChanges(after, reject(after, 'd3x9')))).toBe(bodyText(before));
      expect(bodyText(applyChanges(after, accept(after, 'd3x9')))).toBe(
        'One<!--split s3vb-->two three.\n\nNext.',
      );
      expect(start).toBeLessThan(end);
    }
  });

  it('is decided with the rest, whichever is first', () => {
    const { before } = split(bo, '\n\n');
    const brk = at(before, '\n\n');
    const after = applyChanges(
      before,
      trackedEdit(before, { from: brk, to: brk + 2, insert: '' }, context(ada, ['d3x9'])),
    );
    expect(bodyText(applyChanges(after, rejectAll(after)))).toBe('Onetwo three.\n\nNext.');
    expect(bodyText(applyChanges(after, acceptAll(after)))).toBe('Onetwo three.\n\nNext.');
  });
});

describe('typing on the line after a break that was typed (format §3.4)', () => {
  it('is part of my insertion with the break, when the split is mine', () => {
    for (const brk of ['\n', '\n\n']) {
      const before = file(`One<!--split s3vb-->${brk}two three.`, { s3vb: 'ada' });
      const x = at(before, brk) + brk.length;
      const after = applyChanges(
        before,
        trackedEdit(before, { from: x, to: x, insert: 'X' }, context(ada, ['k3x9', 'w8nn'])),
      );
      expect(bodyText(after), JSON.stringify(brk)).toBe(
        `One<!--ins k3x9--><!--split w8nn-->${brk}X<!--/k3x9-->two three.`,
      );
      expect(parse(after).warnings).toEqual([]);
      expect(newest(after)).toBe(`One${brk}Xtwo three.`);
      expect(original(after)).toBe('Onetwo three.');
      expect(bodyText(applyChanges(after, rejectAll(after)))).toBe('Onetwo three.');
      // More text goes on at the end of the insertion.
      const more = after.indexOf('X<') + 1;
      const next = applyChanges(
        after,
        trackedEdit(after, { from: more, to: more, insert: 'Y' }, context(ada)),
      );
      expect(bodyText(next)).toContain('X' + 'Y<!--/k3x9-->');
    }
  });

  it('starts my insertion at the start of the block when the split is another person’s', () => {
    const before = file('One<!--split s3vb-->\n\ntwo three.', { s3vb: 'bo' });
    const x = at(before, '\n\n') + 2;
    const after = applyChanges(
      before,
      trackedEdit(before, { from: x, to: x, insert: 'X' }, context(ada, ['k3x9'])),
    );
    expect(bodyText(after)).toBe(
      'One<!--split s3vb-->\n\n<!--ins k3x9-->\n\nX<!--/k3x9-->two three.',
    );
    expect(parse(after).warnings).toEqual([]);
    expect(bodyText(applyChanges(after, reject(after, 's3vb')))).toBe(
      'One<!--ins k3x9-->X<!--/k3x9-->two three.',
    );
  });

  it('is refused on a wrapped line after the break of another person’s split', () => {
    const before = file('One<!--split s3vb-->\ntwo three.', { s3vb: 'bo' });
    const x = at(before, '\n') + 1;
    expect(() =>
      trackedEdit(before, { from: x, to: x, insert: 'X' }, context(ada, ['k3x9'])),
    ).toThrow(EditError);
  });
});

describe('a deletion of whole blocks leaves the syntax around them as it is (format §3.4)', () => {
  /** Deletes `[from, to)` of `text` and checks that rejecting brings the text back exactly. */
  function remove(text: string, from: number, to: number, ids = ['t6wv']) {
    const result = track(text, { from, to, insert: '' }, ids);
    const [id = ''] = ids;
    expect(bodyText(applyChanges(result.after, reject(result.after, id)))).toBe(
      bodyText(file(text)),
    );
    expect(newest(applyChanges(result.after, acceptAll(result.after)))).toBe(newest(result.after));
    return result;
  }

  it('does not take the bullet, number, quote marker or #s of the block that follows', () => {
    for (const next of [
      '- first item\n- second',
      '1. first item\n2. second',
      '> first\n> second',
    ]) {
      const text = `Para one.\n\n${next}`;
      const { body, after } = remove(text, 0, at(text, next));
      expect(body).toBe(`<!--del t6wv Para one.\\n\\n-->\n\n${next}`);
      expect(newest(after)).toBe(next);
    }
    const heading = 'Para one.\n\n## Heading\n\nText';
    expect(remove(heading, 0, at(heading, '## Heading')).body).toBe(
      '<!--del t6wv Para one.\\n\\n-->\n\n## Heading\n\nText',
    );
  });

  it('does this in a file with CRLF line breaks', () => {
    const text = 'Para one.\r\n\r\n- first item\r\n- second';
    const before = file(text);
    const edit = { from: 0, to: at(text, '- first'), insert: '' };
    const after = applyChanges(before, trackedEdit(before, edit, context(ada, ['t6wv'])));
    expect(parse(after).warnings).toEqual([]);
    expect(bodyText(after)).toBe('<!--del t6wv Para one.\\n\\n-->\r\n\r\n- first item\r\n- second');
    expect(bodyText(applyChanges(after, reject(after, 't6wv')))).toBe(text);
    const items = file('- one\r\n- two\r\n- three');
    const second = { from: 7, to: 14, insert: '' };
    const gone = applyChanges(items, trackedEdit(items, second, context(ada, ['t6wv'])));
    expect(bodyText(gone)).toBe('- one\r\n- <!--del t6wv two\\n- -->\r\n  three');
    expect(bodyText(applyChanges(gone, reject(gone, 't6wv')))).toBe('- one\r\n- two\r\n- three');
  });

  it('takes the item whole when the range starts in front of its bullet', () => {
    // The review: `- one`, `- two`, `- three` without `- two⏎` was `- onethree`.
    const text = '- one\n- two\n- three';
    const { body, after } = remove(text, at(text, '- two'), at(text, '- three'));
    expect(body).toBe('- one\n- <!--del t6wv two\\n- -->\n  three');
    expect(newest(after)).toBe('- one\n- three');
    const numbered = '1. one\n2. two\n3. three';
    expect(remove(numbered, at(numbered, '2. two'), at(numbered, '3. three')).body).toBe(
      '1. one\n2. <!--del t6wv two\\n3. -->\n   three',
    );
    const several = '- one\n- two\n- three\n- four';
    expect(remove(several, at(several, '- two'), at(several, '- four')).body).toBe(
      '- one\n- <!--del t6wv two\\n- three\\n- -->\n  four',
    );
  });

  it('takes a quote or a heading with its marker, and leaves the paragraph after it a paragraph', () => {
    // The review: `One.⏎⏎> quote⏎⏎Two.` without `> quote⏎⏎` was `One.Two.`.
    const quote = 'One.\n\n> quote\n\nTwo.';
    const whole = remove(quote, at(quote, '> quote'), at(quote, 'Two.'));
    expect(whole.body).toBe('One.\n\n<!--del t6wv > quote\\n\\n-->\n\nTwo.');
    expect(newest(whole.after)).toBe('One.\n\nTwo.');
    // Its text alone is the same block: the marker is not left behind with nothing after it.
    expect(remove(quote, at(quote, 'quote'), at(quote, 'quote') + 5).body).toBe(whole.body);
    const heading = 'Intro.\n\n## Commands\n\nRequires Node.';
    const text = remove(heading, at(heading, 'Commands'), at(heading, 'Commands') + 8);
    expect(text.body).toBe('Intro.\n\n<!--del t6wv ## Commands\\n\\n-->\n\nRequires Node.');
    expect(newest(text.after)).toBe('Intro.\n\nRequires Node.');
  });

  it('takes a heading in front of another heading, and the first and the only block', () => {
    const two = '## One\n\n## Two';
    expect(remove(two, 3, 6).body).toBe('<!--del t6wv ## One\\n\\n-->\n\n## Two');
    const first = '> quote\n\nTwo.';
    expect(remove(first, 0, at(first, 'Two.')).body).toBe('<!--del t6wv > quote\\n\\n-->\n\nTwo.');
    const only = remove('## Only', 3, 7);
    expect(only.body).toBe('<!--del t6wv ## Only-->');
    expect(newest(only.after)).toBe('');
  });

  it('takes the break in front of the last block, with its marker', () => {
    const quote = 'One.\n\n> quote';
    expect(remove(quote, at(quote, '> quote'), quote.length).body).toBe(
      'One.<!--del t6wv \\n\\n> quote-->',
    );
    const item = '- one\n- two';
    expect(remove(item, at(item, 'two'), item.length).body).toBe('- one<!--del t6wv \\n- two-->');
  });

  it('keeps the blank line that follows the last item of a list', () => {
    // Taking the break after the item would make `Para` a line of the item before it.
    const text = '- one\n- two\n\nPara';
    const { body, after } = remove(text, at(text, 'two'), at(text, 'two') + 3);
    expect(body).toBe('- one<!--del t6wv \\n- two-->\n\nPara');
    expect(newest(after)).toBe('- one\n\nPara');
  });

  it('keeps the type of the first block when the range goes on into the next', () => {
    const text = '- one\n- two\n- three';
    const { body, after } = remove(text, at(text, '- two'), at(text, 'three') - 3 + 5);
    expect(body).toBe('- one\n- <!--del t6wv two\\n- th-->\n  ree');
    expect(newest(after)).toBe('- one\n- ree');
  });

  it('joins from the middle of a block into the bullet of the next and takes the bullet', () => {
    const text = 'Para one here.\n\n- first item';
    const { body } = remove(text, at(text, 'here'), at(text, '- first'));
    expect(body).toBe('Para one <!--del t6wv here.\\n\\n- -->first item');
  });
});

describe('a closer is not left at the start of a line (format §3.2)', () => {
  /** Ada deletes all the visible text of the paragraph that starts with `first`. */
  function deleteParagraph(
    body: string,
    first: string,
    last: string,
    marks: Record<string, string>,
    threads: string[] = [],
  ) {
    const before = file(body, marks, threads);
    const view = newestView(before);
    const from = view.map.toSource(view.text.indexOf(first), 1);
    const to = view.map.toSource(view.text.indexOf(last) + last.length, -1);
    const edit = { from, to, insert: '' };
    const after = applyChanges(before, trackedEdit(before, edit, context(ada, ['w2rf'])));
    expectPlaced(before, after);
    return { before, after, body: bodyText(after) };
  }

  it('puts the closer of an insertion in front of the opener that follows it on the line', () => {
    // The review: `<!--/k3x9--><!--del w2rf …-->**End** of the file.`, which rendered the next
    // block as raw HTML.
    const { body, after } = deleteParagraph(
      'Intro.\n\nThe old <!--ins k3x9-->very <!--/k3x9-->exporter stays.\n\n**End** of the file.',
      'The old',
      'exporter stays.',
      { k3x9: 'bo' },
    );
    expect(body).toBe(
      'Intro.\n\n<!--del w2rf The old -->\n\n<!--ins k3x9-->\n\n<!--del w2rf very -->\n\n' +
        '<!--/k3x9--><!--del w2rf exporter stays.\\n\\n-->\n\n**End** of the file.',
    );
    expect(newest(after)).toBe('Intro.\n\n**End** of the file.');
    expect(bodyText(applyChanges(after, rejectAll(after)))).toBe(
      'Intro.\n\nThe old exporter stays.\n\n**End** of the file.',
    );
  });

  it('does this for the closer of a comment, on a word and on the whole paragraph', () => {
    const word = deleteParagraph(
      'Intro.\n\nThe old <!--cmt c8d2-->exporter<!--/c8d2--> stays.\n\n**End** of the file.',
      'The old',
      'stays.',
      {},
      thread('c8d2', 'bo'),
    );
    expect(word.body).toContain('<!--/c8d2--><!--del w2rf  stays.\\n\\n-->\n\n**End**');
    const whole = deleteParagraph(
      'Intro.\n\n<!--cmt c8d2-->\n\nThe old exporter stays.<!--/c8d2-->\n\n- item one\n- item two',
      'The old',
      'stays.',
      {},
      thread('c8d2', 'bo'),
    );
    expect(whole.body).toBe(
      'Intro.\n\n<!--cmt c8d2-->\n\n<!--del w2rf The old exporter stays.-->\n\n' +
        '<!--/c8d2--><!--del w2rf \\n\\n-->\n\n- item one\n- item two',
    );
    // The comment and the deletion are decided one by one, and the text comes back whole.
    const back = applyChanges(whole.after, reject(whole.after, 'w2rf'));
    expect(bodyText(back)).toBe(
      'Intro.\n\n<!--cmt c8d2-->\n\nThe old exporter stays.<!--/c8d2-->\n\n- item one\n- item two',
    );
    expect(parse(back).warnings).toEqual([]);
  });

  it('puts the closers in front of the opener in a list item and a quote', () => {
    const item = deleteParagraph(
      '- one\n- two <!--ins k3x9-->three<!--/k3x9--> four\n- five',
      'two',
      'four',
      { k3x9: 'bo' },
    );
    expect(item.body).toContain('<!--/k3x9--><!--del w2rf  four\\n- -->\n  five');
    expect(newest(item.after)).toBe('- one\n- five');
  });

  it('refuses a change that would leave a closer in front of the text of its line', () => {
    // Bo's insertion starts the paragraph; deleting its text leaves its closer, and then text.
    const body = 'Intro.\n\n<!--ins k3x9-->\n\nvery <!--/k3x9-->exporter stays.\n\n**End**';
    const before = file(body, { k3x9: 'bo' });
    const view = newestView(before);
    const at = view.text.indexOf('very ');
    const edit = {
      from: view.map.toSource(at, 1),
      to: view.map.toSource(at + 5, -1),
      insert: '',
    };
    expect(() => trackedEdit(before, edit, context(ada, ['w2rf']))).toThrow(EditError);
    try {
      trackedEdit(before, edit, context(ada, ['w2rf']));
    } catch (error) {
      expect(error instanceof EditError && error.code).toBe('no-legal-placement');
    }
  });
});

describe('a marker is not written inside a construct that takes none (format §3.1)', () => {
  it('replaces a link whole when its destination is edited', () => {
    const text = 'see [the guide](https://example.org/a) now';
    const link = '[the guide](https://example.org/a)';
    const edit = { from: at(text, 'example'), to: at(text, 'example'), insert: 'X' };
    const { body, after } = track(text, edit, ['k3x9']);
    expect(body).toBe(
      `see <!--sub k3x9 ${link}-->[the guide](https://Xexample.org/a)<!--/k3x9--> now`,
    );
    expect(newest(after)).toBe('see [the guide](https://Xexample.org/a) now');
  });

  it('takes the text of a link as it is', () => {
    const text = 'see [the guide](https://example.org/a) now';
    const { body } = track(text, { from: at(text, 'guide'), to: at(text, 'guide'), insert: 'X' }, [
      'k3x9',
    ]);
    expect(body).toBe('see [the <!--ins k3x9-->X<!--/k3x9-->guide](https://example.org/a) now');
  });

  it('replaces an image, an autolink and an entity whole', () => {
    const image = '![A cat](cat.png)';
    const a = track(`a ${image} b`, { from: 4, to: 6, insert: 'Big ' }, ['k3x9']);
    expect(a.body).toBe(`a <!--sub k3x9 ${image}-->![Big cat](cat.png)<!--/k3x9--> b`);
    const url = '<https://example.org>';
    const b = track(`go ${url} now`, { from: 12, to: 12, insert: 'X' }, ['k3x9']);
    expect(b.body).toBe(
      `go <!--sub k3x9 ${url}-->${url.replace('example', 'Xexample')}<!--/k3x9--> now`,
    );
    const c = track('a &amp; b', { from: 4, to: 4, insert: 'x' }, ['k3x9']);
    expect(c.body).toBe('a <!--sub k3x9 &amp;-->&axmp;<!--/k3x9--> b');
  });

  it('writes no marker after a backslash', () => {
    const text = 'a \\* b';
    const { body } = track(text, { from: 3, to: 3, insert: 'x' }, ['k3x9']);
    expect(body).toBe('a <!--sub k3x9 \\*-->\\x*<!--/k3x9--> b');
  });

  it('keeps a marker away from the inner side of emphasis that would stop flanking', () => {
    const text = 'a foo**bar**baz b';
    const { body, after } = track(
      text,
      { from: at(text, 'bar'), to: at(text, 'bar'), insert: 'X' },
      ['k3x9'],
    );
    expect(newest(after)).toBe('a foo**Xbar**baz b');
    // No marker touches a run of asterisks.
    expect(body).not.toMatch(/\*<!--|-->\*/);
  });

  it('allows a marker at the edge of emphasis that has a space outside it', () => {
    const text = 'a **bold** b';
    const { body } = track(text, { from: 4, to: 4, insert: 'X' }, ['k3x9']);
    expect(body).toBe('a **<!--ins k3x9-->X<!--/k3x9-->bold** b');
  });
});

/** The HTML that CommonMark (micromark) makes of a file's body, without the HTML comments: what a
 * reader sees. White space at the end of a paragraph and blank lines between blocks, which a
 * marker that is a block of its own leaves, are not looked at. */
const rendered = (text: string) =>
  micromark(bodyOf(text), { allowDangerousHtml: true })
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+<\/p>/g, '</p>')
    .replace(/\n\s*\n/g, '\n')
    .trim();

/**
 * Decides the marks of `text` in every order, and expects each file on the way, the first one
 * too, to read as its newest view does: the markers change nothing that is rendered. Returns the
 * orders whose last decision is refused, as ` a<id>` and ` r<id>` steps; by default there must be
 * none.
 */
function expectEveryOrderReads(text: string, refusable = false, path = ''): string[] {
  expect(rendered(text), `${path} => ${JSON.stringify(bodyOf(text))}`).toBe(
    rendered(newestView(text).text),
  );
  const refused: string[] = [];
  for (const { id, kind } of parse(text).marks) {
    if (kind === 'cmt') continue;
    for (const [step, decide] of [
      [`${path} a${id}`, accept],
      [`${path} r${id}`, reject],
    ] as const) {
      let next: string;
      try {
        next = applyChanges(text, decide(text, id));
      } catch (error) {
        if (!(error instanceof EditError) || !refusable) throw error;
        refused.push(step);
        continue;
      }
      refused.push(...expectEveryOrderReads(next, refusable, step));
    }
  }
  return refused;
}

describe('a mark that ends with a fenced code block closes on the line after it (format §3.3)', () => {
  /** A tracked edit of `text`: the body, what accepting and rejecting every change give, what
   * accepting and rejecting the edit's first mark alone give, and the decisions that are refused
   * in some order. */
  const fenced = (text: string, edit: TextChange) => {
    const { after, body } = track(text, edit, ['k3x9', 'w8nn', 'p2rt']);
    const [first] = parse(after).marks;
    return {
      body,
      accepted: bodyText(applyChanges(after, acceptAll(after))),
      rejected: bodyText(applyChanges(after, rejectAll(after))),
      alone: [accept, reject].map((decide) =>
        bodyText(applyChanges(after, decide(after, first!.id))),
      ),
      refused: [
        ...new Set(expectEveryOrderReads(after, true).map((path) => path.split(' ').at(-1))),
      ].sort(),
    };
  };
  const typeAt = (text: string, at: number, insert: string) =>
    fenced(text, { from: at, to: at, insert });

  it('ends an insertion after the closing fence, on a line of its own', () => {
    // On the fence's line, the closer would keep the fence from closing the block, which would run
    // to the end of the file. The line break in front of it is part of the insertion.
    const text = 'Start middle End';
    expect(typeAt(text, text.length, 'Some text\n\n```\ncode\n```')).toEqual({
      body: 'Start middle End<!--ins k3x9-->Some text<!--split w8nn-->\n\n```\ncode\n```\n<!--/k3x9-->',
      accepted: 'Start middle EndSome text\n\n```\ncode\n```',
      rejected: 'Start middle End',
      alone: ['Start middle EndSome text<!--split w8nn-->\n\n```\ncode\n```', 'Start middle End'],
      // Without the break in front of it, the closing fence would open a block that never ends.
      refused: ['rw8nn'],
    });
  });

  it('puts the breaks typed after the fence behind the closer, in the middle of a paragraph', () => {
    // What a paste of a code block in the middle of a paragraph types: blank lines around it.
    const text = 'Start middle End';
    expect(typeAt(text, at(text, 'middle'), '\n\n```\ncode\n```\n\n')).toEqual({
      body: 'Start <!--ins k3x9--><!--split w8nn-->\n\n```\ncode\n```\n<!--/k3x9--><!--split p2rt-->\n\nmiddle End',
      accepted: 'Start \n\n```\ncode\n```\n\n\nmiddle End',
      rejected: 'Start middle End',
      alone: [
        'Start <!--split w8nn-->\n\n```\ncode\n```\n<!--split p2rt-->\n\nmiddle End',
        'Start <!--split p2rt-->\n\nmiddle End',
      ],
      // Rejecting the break after the block alone would leave the closer at the start of
      // `middle End`: it waits for the insertion to be decided.
      refused: ['rp2rt', 'rw8nn'],
    });
  });

  it('puts a split after the fence on the line after it, for text typed after the block', () => {
    const text = 'Start middle End';
    expect(typeAt(text, text.length, '\n\n```\ncode\n```\n\nMore text').body).toBe(
      'Start middle End<!--ins k3x9--><!--split w8nn-->\n\n```\ncode\n```\n<!--split p2rt-->\n\nMore text<!--/k3x9-->',
    );
  });

  it('keeps the line breaks of the file, and knows tildes and longer fences', () => {
    const text = 'Start middle End\r\n\r\nNext';
    const tildes = typeAt(text, 16, '\r\n\r\n~~~\r\ncode\r\n~~~');
    expect(tildes.body).toBe(
      'Start middle End<!--ins k3x9--><!--split w8nn-->\r\n\r\n~~~\r\ncode\r\n~~~\r\n<!--/k3x9-->\r\n\r\nNext',
    );
    expect(tildes.accepted).toBe('Start middle End\r\n\r\n~~~\r\ncode\r\n~~~\r\n\r\n\r\nNext');
    expect(tildes.rejected).toBe('Start middle End\r\n\r\nNext');
    // A fence of four backticks is closed by four, not by the three inside it.
    const longer = typeAt('Start middle End', 16, '\n\n````md\n```\ncode\n```\n````');
    expect(longer.body).toBe(
      'Start middle End<!--ins k3x9--><!--split w8nn-->\n\n````md\n```\ncode\n```\n````\n<!--/k3x9-->',
    );
    expect(longer.rejected).toBe('Start middle End');
  });

  it('indents the closer with the block in a list item', () => {
    const text = '- item\n- two';
    expect(typeAt(text, 6, '\n\n  ```\n  code\n  ```')).toEqual({
      body: '- item<!--ins k3x9--><!--split w8nn-->\n\n  ```\n  code\n  ```\n  <!--/k3x9-->\n- two',
      accepted: '- item\n\n  ```\n  code\n  ```\n  \n- two',
      rejected: '- item\n- two',
      alone: ['- item<!--split w8nn-->\n\n  ```\n  code\n  ```\n  \n- two', '- item\n- two'],
      refused: ['rw8nn'],
    });
  });

  it('makes a paragraph a code block as a whole-block substitution', () => {
    // What the Code Block command types with Track Changes on (format §3.5): the opener on the
    // line before the fence, the closer on the line after it.
    const text = 'Intro.\n\nlet x = 1;\nlet y = 2;\n\nEnd.';
    const from = at(text, 'let');
    const to = at(text, '\n\nEnd');
    expect(fenced(text, { from, to, insert: '```\nlet x = 1;\nlet y = 2;\n```' })).toEqual({
      body: 'Intro.\n\n<!--sub k3x9 let x = 1;\\nlet y = 2;-->\n\n```\nlet x = 1;\nlet y = 2;\n```\n<!--/k3x9-->\n\nEnd.',
      accepted: 'Intro.\n\n```\nlet x = 1;\nlet y = 2;\n```\n\n\nEnd.',
      rejected: 'Intro.\n\nlet x = 1;\nlet y = 2;\n\nEnd.',
      alone: [
        'Intro.\n\n```\nlet x = 1;\nlet y = 2;\n```\n\n\nEnd.',
        'Intro.\n\nlet x = 1;\nlet y = 2;\n\nEnd.',
      ],
      refused: [],
    });
  });

  it('still refuses a fence that the typed text does not close', () => {
    // `code` then a fence right before `middle`: the line is ```middle, which closes nothing.
    const before = file('Start middle End');
    expect(() =>
      trackedEdit(
        before,
        { from: 6, to: 6, insert: '\n\n```\ncode\n```' },
        context(ada, ['k3x9', 'w8nn', 'p2rt', 'q4ms', 'a2b3']),
      ),
    ).toThrow(EditError);
  });
});

describe('a marker is not written at the start of a wrapped line (format §3.2)', () => {
  it('takes the line break into the change when text is typed there', () => {
    const text = 'one two\nthree four';
    const { body, after } = track(
      text,
      { from: at(text, 'three'), to: at(text, 'three'), insert: 'X ' },
      ['k3x9'],
    );
    expect(body).toBe('one two<!--sub k3x9 \\n-->\nX <!--/k3x9-->three four');
    expect(newest(after)).toBe('one two\nX three four');
  });

  it('takes the line break into the deletion of the first word of a wrapped line', () => {
    const text = 'one two\nthree four';
    const { body, after } = track(
      text,
      { from: at(text, 'three'), to: at(text, 'three') + 6, insert: '' },
      ['k3x9'],
    );
    expect(newest(after)).toBe('one two\nfour');
    expect(body).not.toMatch(/\n<!--/);
  });

  it('does this in a list item and a quote too', () => {
    const list = track('- one two\n  three four', { from: 12, to: 12, insert: 'X ' }, ['k3x9']);
    expect(newest(list.after)).toBe('- one two\n  X three four');
    expect(list.body).not.toMatch(/\n\s*<!--/);
    const quote = track('> one two\n> three four', { from: 12, to: 12, insert: 'X ' }, ['k3x9']);
    expect(newest(quote.after)).toBe('> one two\n> X three four');
    expect(quote.body).not.toMatch(/\n[ >]*<!--/);
  });
});

describe('what has no place for a marker is refused', () => {
  const codeOf = (body: string, edit: TextChange): string | undefined => {
    try {
      trackedEdit(file(body), edit, context(ada, ['k3x9']));
    } catch (error) {
      if (error instanceof EditError) return error.code;
      throw error;
    }
    return undefined;
  };

  it('refuses front matter, before and inside it', () => {
    const body = '---\ntitle: Launch\n---\n\nBody text.';
    expect(codeOf(body, { from: 0, to: 0, insert: 'x' })).toBe('front-matter');
    expect(codeOf(body, { from: 10, to: 12, insert: '' })).toBe('front-matter');
    expect(
      codeOf(body, { from: at(body, '---\n\n'), to: at(body, '---\n\n') + 3, insert: '' }),
    ).toBe('front-matter');
    // The text after it can be edited.
    expect(
      codeOf(body, { from: at(body, 'Body'), to: at(body, 'Body'), insert: 'x' }),
    ).toBeUndefined();
    const text = file(body);
    expect(() => addComment(text, { from: 5, to: 9 }, 'A note.', context(ada, ['c9qf']))).toThrow(
      "A comment can't be anchored in front matter yet.",
    );
  });

  it('refuses a position in the prefix of a block, or on a line that is only syntax', () => {
    expect(codeOf('- one', { from: 0, to: 0, insert: 'x' })).toBe('no-legal-placement');
    expect(codeOf('## Heading', { from: 1, to: 1, insert: 'x' })).toBe('no-legal-placement');
    expect(codeOf('para\n\n---\n\nnext', { from: 7, to: 7, insert: 'x' })).toBe(
      'no-legal-placement',
    );
    expect(codeOf('a\\', { from: 2, to: 2, insert: 'x' })).toBe('no-legal-placement');
  });
});

describe('suggestReplace adds a paragraph or a bullet', () => {
  function suggest(body: string, oldStr: string, newStr: string, ids: string[]) {
    const before = file(body);
    const { changes } = suggestReplace(before, oldStr, newStr, context(claudeAda, ids));
    const after = applyChanges(before, changes);
    expectPlaced(before, after);
    return { before, after, body: bodyText(after) };
  }

  it('adds a paragraph after one', () => {
    const { after, body } = suggest(
      'First.\n\nThird.',
      'First.\n\nThird.',
      'First.\n\nSecond.\n\nThird.',
      ['k3x9', 's3vb', 'w8nn'],
    );
    expect(newest(after)).toBe('First.\n\nSecond.\n\nThird.');
    expect(body).toContain('<!--split ');
  });

  it('adds a bullet after one', () => {
    const { after } = suggest('- one\n- two', '- one\n- two', '- one\n- two\n- three', [
      'k3x9',
      's3vb',
    ]);
    expect(newest(after)).toBe('- one\n- two\n- three');
    expect(bodyText(applyChanges(after, rejectAll(after)))).toBe('- one\n- two');
    expect(bodyText(applyChanges(after, acceptAll(after)))).toBe('- one\n- two\n- three');
  });

  it('adds a bullet in front of one, and a paragraph in front of a heading', () => {
    const bullet = suggest('- one\n- three', '- one\n- three', '- one\n- two\n- three', [
      'k3x9',
      's3vb',
    ]);
    expect(newest(bullet.after)).toBe('- one\n- two\n- three');
    expect(bodyText(applyChanges(bullet.after, rejectAll(bullet.after)))).toBe('- one\n- three');
    const heading = suggest(
      'Intro.\n\n## Heading',
      'Intro.\n\n## Heading',
      'Intro.\n\nNew.\n\n## Heading',
      ['k3x9', 's3vb'],
    );
    expect(newest(heading.after)).toBe('Intro.\n\nNew.\n\n## Heading');
    expect(bodyText(applyChanges(heading.after, rejectAll(heading.after)))).toBe(
      'Intro.\n\n## Heading',
    );
  });

  it('changes a word at the start of a paragraph, and a wrapped line', () => {
    const para = suggest('Alpha beta\n\ngamma\ndelta', 'Alpha beta', 'Omega beta', ['k3x9']);
    expect(para.body).toBe('<!--sub k3x9 Alpha-->\n\nOmega<!--/k3x9--> beta\n\ngamma\ndelta');
    const wrapped = suggest('Alpha beta\n\ngamma\ndelta', 'gamma\ndelta', 'gamma\nomega', ['k3x9']);
    expect(newest(wrapped.after)).toBe('Alpha beta\n\ngamma\nomega');
  });
});

describe('edits that are refused leave the file as it is', () => {
  it('does not change the text, or write anything', () => {
    const text = file('- one');
    expect(() => trackedEdit(text, { from: 0, to: 0, insert: 'x' }, context(bo, ['k3x9']))).toThrow(
      EditError,
    );
  });
});
