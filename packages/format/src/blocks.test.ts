import { describe, expect, it } from 'vitest';
import {
  breakEnd,
  breakLength,
  breaksBetween,
  carrierEnd,
  continuationPrefix,
  frontMatterEnd,
  lineEnd,
  lineStart,
  lineStartKind,
  linePrefixAt,
  scaffold,
} from './blocks.ts';

/** The marker `<!--ins k3x9-->` in `text`, as the range `carrierEnd` is asked about. */
function carrierOf(text: string, marker = '<!--ins k3x9-->'): string {
  const from = text.indexOf(marker);
  if (from < 0) throw new Error('No marker');
  return text.slice(from, carrierEnd(text, from, from + marker.length));
}

describe('lines', () => {
  it('finds where a line starts and ends, with LF and CRLF', () => {
    const text = 'ab\ncd\r\nef';
    expect(lineStart(text, 0)).toBe(0);
    expect(lineStart(text, 2)).toBe(0);
    expect(lineStart(text, 3)).toBe(3);
    expect(lineStart(text, 6)).toBe(3);
    expect(lineStart(text, 8)).toBe(7);
    expect(lineEnd(text, 0)).toBe(2);
    expect(lineEnd(text, 3)).toBe(5);
    expect(lineEnd(text, 8)).toBe(9);
    expect(lineStart('\nab', 0)).toBe(0);
  });
});

describe('the prefix of a block’s lines', () => {
  it('is continued with spaces in place of a bullet', () => {
    expect(continuationPrefix('')).toBe('');
    expect(continuationPrefix('> ')).toBe('> ');
    expect(continuationPrefix('- ')).toBe('  ');
    expect(continuationPrefix('12. ')).toBe('    ');
    expect(continuationPrefix('> - ')).toBe('>   ');
    expect(continuationPrefix('  * ')).toBe('    ');
    expect(continuationPrefix('- [ ] ')).toBe('  ');
  });
});

describe('the scaffold of an own-line opener (format §3.3)', () => {
  it('is a blank line at top level, in a quote and after the indentation of a list item', () => {
    expect(scaffold('', '\n')).toBe('\n\n');
    expect(scaffold('> ', '\n')).toBe('\n>\n> ');
    expect(scaffold('  ', '\n')).toBe('\n\n  ');
    expect(scaffold('', '\r\n')).toBe('\r\n\r\n');
  });

  it('is only a line break after a bullet, which a blank line would make loose', () => {
    expect(scaffold('- ', '\n')).toBe('\n  ');
    expect(scaffold('2. ', '\n')).toBe('\n   ');
    expect(scaffold('  - ', '\n')).toBe('\n    ');
    expect(scaffold('> - ', '\n')).toBe('\n>   ');
  });
});

describe('the carrier of an opener', () => {
  it('is the line break and the blank line after one that is alone before a block', () => {
    expect(carrierOf('Para.\n\n<!--ins k3x9-->\n\nNew start of two.')).toBe('<!--ins k3x9-->\n\n');
    expect(carrierOf('<!--ins k3x9-->\n\nNew')).toBe('<!--ins k3x9-->\n\n');
    // Without a blank line, as in an older form.
    expect(carrierOf('Para.\n\n<!--ins k3x9-->\nNew start')).toBe('<!--ins k3x9-->\n');
    expect(carrierOf('<!--ins k3x9-->\r\n\r\nNew')).toBe('<!--ins k3x9-->\r\n\r\n');
  });

  it('is the line break and the indentation after one that follows a bullet', () => {
    expect(carrierOf('- one\n- <!--ins k3x9-->\n  two')).toBe('<!--ins k3x9-->\n  ');
    expect(carrierOf('2. <!--ins k3x9-->\n   two')).toBe('<!--ins k3x9-->\n   ');
    expect(carrierOf('- a\n  - <!--ins k3x9-->\n    b')).toBe('<!--ins k3x9-->\n    ');
  });

  it('is the quote prefix as well in a block quote', () => {
    expect(carrierOf('> <!--ins k3x9-->\n> b')).toBe('<!--ins k3x9-->\n> ');
    expect(carrierOf('> <!--ins k3x9-->\n>\n> b')).toBe('<!--ins k3x9-->\n>\n> ');
  });

  it('is nothing for a marker that has text on its line, or that no block follows', () => {
    expect(carrierOf('a <!--ins k3x9-->b<!--/k3x9-->')).toBe('<!--ins k3x9-->');
    expect(carrierOf('<!--ins k3x9-->b<!--/k3x9-->')).toBe('<!--ins k3x9-->');
    expect(carrierOf('- <!--ins k3x9-->b')).toBe('<!--ins k3x9-->');
    expect(carrierOf('a\n\n<!--ins k3x9-->')).toBe('<!--ins k3x9-->');
    expect(carrierOf('a\n\n<!--ins k3x9-->\n\n')).toBe('<!--ins k3x9-->');
    expect(carrierOf('a\n\n<!--ins k3x9-->  \n\nb')).toBe('<!--ins k3x9-->  \n\n');
  });

  it('goes up to the next marker when markers stand one after the other', () => {
    const text = '<!--cmt c9qf-->\n\n<!--ins k3x9-->\n\nText';
    expect(carrierOf(text, '<!--cmt c9qf-->')).toBe('<!--cmt c9qf-->\n\n');
    expect(carrierOf(text)).toBe('<!--ins k3x9-->\n\n');
  });

  it('keeps the indentation of a block that is a paragraph’s own', () => {
    // A block's leading spaces go after an own-line marker, never before it (format §3.3).
    expect(carrierOf('<!--ins k3x9-->\n\n  Indented')).toBe('<!--ins k3x9-->\n\n');
  });
});

describe('the break after a split', () => {
  it('is a blank line, or a line break and the prefix of the next block', () => {
    const at = (text: string) =>
      breakEnd(text, text.indexOf('<!--split') + '<!--split s3vb-->'.length);
    const slice = (text: string) =>
      text.slice(text.indexOf('<!--split') + '<!--split s3vb-->'.length, at(text));
    expect(slice('First.<!--split s3vb-->\n\nSecond.')).toBe('\n\n');
    expect(slice('- one<!--split s3vb-->\n- two')).toBe('\n- ');
    expect(slice('> one<!--split s3vb-->\n>\n> two')).toBe('\n>\n> ');
    expect(slice('A<!--split s3vb-->\n\n## Heading')).toBe('\n\n## ');
    expect(slice('A<!--split s3vb-->\r\n\r\nB')).toBe('\r\n\r\n');
  });

  it('is a line break and the indentation of an item’s lines, not the indentation of a paragraph', () => {
    const slice = (text: string) => {
      const from = text.indexOf('<!--split') + '<!--split s3vb-->'.length;
      return text.slice(from, breakEnd(text, from));
    };
    expect(slice('one<!--split s3vb-->\n two')).toBe('\n');
    expect(slice('- one<!--split s3vb-->\n  two')).toBe('\n  ');
    expect(slice('  - one<!--split s3vb-->\n    - two')).toBe('\n    - ');
    expect(slice('1. one<!--split s3vb-->\n2. two')).toBe('\n2. ');
  });

  it('takes the syntax of a hard break along with the line break', () => {
    const slice = (text: string) => {
      const from = text.indexOf('<!--split') + '<!--split s3vb-->'.length;
      return text.slice(from, breakEnd(text, from));
    };
    expect(slice('A<!--split s3vb-->  \nB')).toBe('  \n');
    expect(slice('A<!--split s3vb-->\\\nB')).toBe('\\\n');
  });

  it('takes one break, and leaves the blank lines that were there before', () => {
    const text = 'A<!--split s3vb-->\n\n\n\nB';
    const from = text.indexOf('<!--split') + '<!--split s3vb-->'.length;
    expect(text.slice(from, breakEnd(text, from))).toBe('\n\n');
  });

  it('takes nothing where no line break follows', () => {
    const text = 'A<!--split s3vb--> b';
    const from = text.indexOf(' b');
    expect(breakEnd(text, from)).toBe(from);
  });
});

describe('the length of a break', () => {
  it('is the line break, a blank line and the prefix of the next line', () => {
    expect(breakLength('', '\n\n## x')).toBe(5);
    expect(breakLength('', '\n- item')).toBe(3);
    expect(breakLength('> ', '\n>\n> x')).toBe(5);
    expect(breakLength('', '\r\n\r\nNext')).toBe(4);
    expect(breakLength('', 'no break')).toBe(0);
  });

  it('counts indentation only for the lines of a list item', () => {
    expect(breakLength('- ', '\n  more')).toBe(3);
    expect(breakLength('', '\n more')).toBe(1);
    expect(breakLength('', '  \nmore')).toBe(3);
  });

  it('knows the prefix of the line that holds a position', () => {
    expect(linePrefixAt('- one\n> two three', 12)).toBe('> ');
    expect(linePrefixAt('plain text', 5)).toBe('');
  });
});

describe('the breaks between lines', () => {
  it('finds wrapped lines, blocks, list items and headings', () => {
    const text = 'One two\nthree.\n\n- a\n- b\n\n## H\n\nEnd';
    const found = breaksBetween(text, 0, text.length).map((b) => [
      text.slice(b.start, b.end),
      b.block,
    ]);
    expect(found).toEqual([
      ['\n', false],
      ['\n\n- ', true],
      ['\n- ', true],
      ['\n\n## ', true],
      ['\n\n', true],
    ]);
  });

  it('starts at the line before the one with `from` and stops after `to`', () => {
    const text = 'a\n\nb\n\nc\n\nd';
    const near = breaksBetween(text, 4, 5).map((b) => text.slice(b.start, b.end));
    expect(near).toEqual(['\n\n', '\n\n']);
    expect(breaksBetween(text, 4, 5).map((b) => b.start)).toEqual([1, 4]);
  });

  it('leaves out a line break inside a marker', () => {
    const text = 'a\n\n<!--ins k3x9-->\n\nb';
    const hidden = [{ from: 3, to: 20 }];
    expect(breaksBetween(text, 0, text.length, hidden).map((b) => b.start)).toEqual([1]);
  });
});

describe('front matter (format §3.8)', () => {
  it('ends at the line that closes it', () => {
    const text = '---\ntitle: Launch\n---\n\n# Body\n';
    expect(frontMatterEnd(text)).toBe('---\ntitle: Launch\n---'.length);
    expect(frontMatterEnd('---\r\ntitle: x\r\n...\r\nBody')).toBe('---\r\ntitle: x\r\n...'.length);
  });

  it('is not there without a closing line, or when text comes first', () => {
    expect(frontMatterEnd('---\ntitle: Launch\n')).toBe(-1);
    expect(frontMatterEnd('Body\n\n---\ntitle: x\n---\n')).toBe(-1);
    expect(frontMatterEnd('# Notes\n')).toBe(-1);
    // A rule at the top, with a blank line after it, is not front matter.
    expect(frontMatterEnd('---\n\ntext\n\n---\n')).toBe(-1);
  });
});

describe('where a position is in its line', () => {
  it('starts a block at the first line, after a blank line, and at a bullet', () => {
    expect(lineStartKind('Para.\n', 0)).toBe('block');
    expect(lineStartKind('One.\n\nTwo.', 6)).toBe('block');
    expect(lineStartKind('- one\n- two', 8)).toBe('block');
    expect(lineStartKind('- one\n- two', 6)).toBe('block');
    expect(lineStartKind('> one\n> two', 0)).toBe('block');
    expect(lineStartKind('1. one\n2. two', 10)).toBe('block');
    expect(lineStartKind('para\n# Heading', 5)).toBe('block');
    expect(lineStartKind('para\n```js\ncode\n```', 5)).toBe('block');
  });

  it('is a continuation at the start of a wrapped line, of a paragraph or an item', () => {
    expect(lineStartKind('one two\nthree four', 8)).toBe('continuation');
    expect(lineStartKind('- one two\n  three', 12)).toBe('continuation');
    expect(lineStartKind('> one two\n> three', 12)).toBe('continuation');
    // A lazy line.
    expect(lineStartKind('> one two\nthree', 10)).toBe('continuation');
  });

  it('is inline inside a line', () => {
    expect(lineStartKind('one two', 4)).toBe('inline');
    expect(lineStartKind('- one two', 4)).toBe('inline');
    expect(lineStartKind('a <!--x--> b', 10)).toBe('inline');
  });

  it('is syntax on a line that is only syntax', () => {
    expect(lineStartKind('Title\n=====', 6)).toBe('syntax');
    expect(lineStartKind('Title\n-----', 6)).toBe('syntax');
    expect(lineStartKind('| a | b |\n|---|---|\n| 1 | 2 |', 10)).toBe('syntax');
    expect(lineStartKind('| a | b |\n|---|---|\n| 1 | 2 |', 20)).toBe('syntax');
    expect(lineStartKind('| a | b |', 0)).toBe('syntax');
  });

  it('treats a line made of markers as blank, as the blank line before the next block', () => {
    const hidden = [{ from: 0, to: 15 }];
    expect(lineStartKind('<!--cmt c9qf-->\nText here.', 16, hidden)).toBe('block');
    expect(lineStartKind('<!--cmt c9qf-->\nText here.', 16)).toBe('continuation');
  });

  it('starts a block on the line after an opener that follows a bullet', () => {
    // `- <!--ins k3x9-->` then the content at the item's indentation (format §3.3).
    const hidden = [{ from: 2, to: 21 }];
    expect(lineStartKind('- <!--ins k3x9-->\n  Text', 20, hidden)).toBe('block');
    expect(lineStartKind('1. <!--del k3x9 a-->\n   Text', 24, [{ from: 3, to: 24 }])).toBe('block');
    expect(lineStartKind('> <!--ins k3x9-->\n> Text', 20, [{ from: 2, to: 20 }])).toBe('block');
  });
});
