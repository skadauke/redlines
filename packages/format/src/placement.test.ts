import { describe, expect, it } from 'vitest';
import { suggestReplace } from './agent.ts';
import { applyChanges } from './changes.ts';
import { addComment } from './comments.ts';
import { accept, acceptAll, reject, rejectAll } from './decide.ts';
import { EditError } from './errors.ts';
import { parse } from './parse.ts';
import { ada, bo, bodyOf, claudeAda, context, file } from './test-helpers.ts';
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
    const { body, after } = track(text, { from: 0, to: 9, insert: '' }, ['t6wv']);
    expect(body).toBe('<!--del t6wv Para one.\\n\\n-->\n\n- first item\n- second');
    expect(newest(after)).toBe('- first item\n- second');
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

  it('refuses to delete a break that someone inserted, before that is decided', () => {
    const before = file('Hello<!--split s3vb-->\n\n world', { s3vb: 'bo' });
    const edit = { from: at(before, '\n\n'), to: at(before, '\n\n') + 2, insert: '' };
    expect(() => trackedEdit(before, edit, context(ada, ['k3x9']))).toThrow(EditError);
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
