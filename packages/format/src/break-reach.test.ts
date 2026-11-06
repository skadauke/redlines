import { describe, expect, it } from 'vitest';
import { breakComesToDepend, pairWords } from './break-reach.ts';
import { parse } from './parse.ts';
import { ada, file } from './test-helpers.ts';

const marks = { s3vb: 'bo', w8nn: 'ada', d3x9: 'ada', k3x9: 'ada' };

/** The split and the change in the way, when the body `after` has a split whose break could read
 * otherwise once other changes are decided, which `before` does not. */
const depends = (after: string, before = 'one two') => {
  const [a, b] = [file(after, marks), file(before, marks)];
  return breakComesToDepend(b, parse(b), a, parse(a));
};

describe('a split whose break depends on other changes (format §3.4, #101)', () => {
  it('is one alone on the line after another split’s line break', () => {
    expect(depends('one <!--split s3vb-->\n<!--split w8nn-->\ntwo')).toEqual({
      split: 's3vb',
      other: 'w8nn',
    });
    // In a quote, behind the quote's marker; on a line that is indented.
    expect(depends('> one <!--split s3vb-->\n> <!--split w8nn-->\n> two')?.split).toBe('s3vb');
    expect(depends('one <!--split s3vb-->\n  <!--split w8nn-->\ntwo')?.split).toBe('s3vb');
  });

  it('is one with other changes and then a line break after it', () => {
    // The deletion of its break, a space, and another split.
    expect(
      depends('one<!--split s3vb--><!--del d3x9 \\n\\n--> <!--split w8nn-->\ntwo')?.split,
    ).toBe('s3vb');
    // The deletion of its break, and an insertion whose text rejecting it takes away.
    expect(
      depends('one<!--split s3vb--><!--del d3x9 \\n--><!--ins k3x9-->**<!--/k3x9-->\ntwo')?.split,
    ).toBe('s3vb');
  });

  it('is one with white space or syntax in a change in front of it, on its line', () => {
    // Accepted, the space is the indentation of the split's line, which tells its break how much
    // of the next line's indentation is its own.
    expect(
      depends('one <!--split s3vb-->\n\n<!--ins k3x9--> <!--/k3x9--><!--split w8nn-->\n world'),
    ).toEqual({ split: 'w8nn', other: 'k3x9' });
    expect(
      depends('- one <!--split s3vb-->\n  \n  <!--ins k3x9--> <!--/k3x9--><!--split w8nn-->\n  two')
        ?.split,
    ).toBe('w8nn');
  });

  it('is one whose next line starts with a change that leaves syntax the break reads', () => {
    // Bo's block of a list item after Ada's paragraph break: accepted, the bullet would be the
    // prefix that the break reads.
    expect(depends('one <!--split s3vb-->\n\n<!--ins k3x9-->\n\n- x<!--/k3x9-->two')?.split).toBe(
      's3vb',
    );
  });

  it('is one whose line after it reads more prefix once a change there is decided', () => {
    // A space typed after a hyphen at the start of the line: accepted, the line is a list item, and
    // the break takes its bullet.
    expect(depends('one<!--split s3vb-->\n-<!--ins k3x9--> <!--/k3x9-->b')?.split).toBe('s3vb');
  });

  it('is one whose deleted break reads longer once the deletion is rejected', () => {
    // Bo's paragraph break, deleted by Ada, then a bullet typed after it: rejected, the deletion
    // gives the break back, which would take the bullet as the next line's prefix.
    expect(
      depends('one<!--split s3vb--><!--del d3x9 \\n\\n--> <!--ins k3x9-->- x<!--/k3x9-->two')
        ?.split,
    ).toBe('s3vb');
    // And an insertion's text right after the deletion, with a split in it: accepted, the line
    // break of that text would be the first split's.
    expect(
      depends(
        'one<!--split s3vb--><!--del d3x9 \\n--> <!--ins k3x9--><!--split w8nn-->\nnew<!--/k3x9-->two',
      )?.split,
    ).toBe('s3vb');
  });

  it('is not one that no decision can make read otherwise', () => {
    // A blank line, which a break takes once; a bullet, a number or text on the line after it.
    expect(depends('one <!--split s3vb-->\n\n<!--split w8nn-->\ntwo')).toBeUndefined();
    expect(depends('- one <!--split w8nn-->\n- <!--split s3vb-->\n- two')).toBeUndefined();
    expect(depends('1. one <!--split w8nn-->\n2. <!--split s3vb-->\n3. two')).toBeUndefined();
    expect(depends('one <!--split s3vb-->\nx<!--split w8nn-->\ntwo')).toBeUndefined();
    // The deletion of a split's break, with the text after it.
    expect(depends('one<!--split s3vb--><!--del d3x9 \\n\\n-->two')).toBeUndefined();
    // Words in front of a split on its line, and a block of words after a paragraph break.
    expect(
      depends('one <!--split s3vb-->\n\n<!--ins k3x9-->\n\nnew<!--/k3x9--><!--split w8nn-->\ntwo'),
    ).toBeUndefined();
    // A block of words, or the deletion of a letter, at the start of the line after a split that
    // stands alone on its line: every decision leaves that line with text.
    expect(
      depends('one <!--split s3vb-->\n\n<!--split w8nn-->\n<!--ins k3x9-->\n\nx<!--/k3x9-->two'),
    ).toBeUndefined();
    expect(
      depends('one <!--split s3vb-->\n\n<!--split w8nn-->\n<!--del d3x9 t-->\n\nwo'),
    ).toBeUndefined();
    // A bullet's spaces in front of a split that change with the insertion in front of it, where
    // the break reads the next line's bullet either way (Enter twice in a list item).
    expect(
      depends('- one<!--ins k3x9--><!--split w8nn-->\n-  <!--/k3x9--><!--split s3vb-->\n-  two'),
    ).toBeUndefined();
    // But not after a split with text in front of it on its line: rejecting the split would join the
    // opener to that text, where it would no longer stand alone.
    expect(depends('one <!--split w8nn-->\n<!--ins k3x9-->\n\nx<!--/k3x9-->two')?.split).toBe(
      'w8nn',
    );
  });

  it('lets a file keep a pair it had, and edits elsewhere be', () => {
    const pair = 'one <!--split s3vb-->\n<!--split w8nn-->\ntwo';
    expect(depends(`${pair} three`, pair)).toBeUndefined();
  });

  it('names the two changes, and another person’s to decide first', () => {
    const text = file('one <!--split s3vb-->\n<!--split w8nn-->\ntwo', marks);
    const found = { split: 'w8nn', other: 's3vb' };
    expect(pairWords(parse(text), found, ada)).toEqual({
      pair: "your line break right next to Bo Chen's line break",
      first: "Bo Chen's line break",
    });
    const own = file('one <!--split s3vb-->\n<!--split w8nn-->\ntwo', { s3vb: 'ada', w8nn: 'ada' });
    expect(pairWords(parse(own), found, ada)).toEqual({
      pair: 'your line break right next to another',
      first: 'one of them',
    });
  });
});
