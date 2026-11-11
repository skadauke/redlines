import { micromark } from 'micromark';
import { describe, expect, it } from 'vitest';
import {
  betweenIndentedCode,
  breakEnd,
  breakLength,
  breaksBetween,
  carrierEnd,
  continuationPrefix,
  continuesList,
  frontMatterEnd,
  LIST_START,
  lineEnd,
  lineSoFar,
  lineStart,
  lineStartKind,
  linePrefixAt,
  listMemo,
  listStep,
  loosensList,
  nextLineStart,
  numberedFromTwo,
  onlyMarkers,
  scaffold,
  withoutMarkers,
} from './blocks.ts';
import type { ListState } from './blocks.ts';
import { holdsMisreadItem } from './format-apart.ts';
import { fuzzCount, seeded } from './random-docs.ts';
import { blockLeaves } from './test-helpers.ts';

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

  it('is the same with closers in front of the opener on its line', () => {
    // Where one mark ends and the next starts a block: the review's `<!--/k3x9--><!--del …-->`.
    expect(carrierOf('Intro.\n\n<!--/k3x9--><!--del w2rf x-->\n\nEnd.', '<!--del w2rf x-->')).toBe(
      '<!--del w2rf x-->\n\n',
    );
    expect(carrierOf('<!--/c8d2--><!--/k3x9--><!--ins w8nn-->\n\nEnd.', '<!--ins w8nn-->')).toBe(
      '<!--ins w8nn-->\n\n',
    );
    expect(carrierOf('- one\n  <!--/k3x9--><!--ins w8nn-->\n  two', '<!--ins w8nn-->')).toBe(
      '<!--ins w8nn-->\n  ',
    );
    // Not when there is text in front of them.
    expect(carrierOf('a <!--/k3x9--><!--ins w8nn-->\n\nEnd.', '<!--ins w8nn-->')).toBe(
      '<!--ins w8nn-->',
    );
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
    // In a quote in a list item, a line of the item without the quote markers (#129).
    expect(breakLength('- > ', '\n  > more')).toBe(5);
    expect(breakLength('- > ', '\n  more')).toBe(3);
    expect(breakLength('1. > ', '\n   more')).toBe(4);
    expect(breakLength('- - > ', '\n    more')).toBe(5);
    expect(breakLength('- > ', '\nmore')).toBe(1);
    // A later line of the item, which has its indentation in front of the quote's markers.
    expect(breakLength('  > ', '\n  more')).toBe(3);
    expect(breakLength('  > ', '\n more')).toBe(1);
    // An item in a quote has the quote's marker in front: the line without it is out of both.
    expect(breakLength('> - ', '\n  more')).toBe(1);
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

  it('takes an ordered list for a block only when it starts with 1, or goes on a list', () => {
    // CommonMark: a list interrupts a paragraph with a number other than 1 never.
    const wrapped = 'We shipped it in the spring of\n2024. That year was good.';
    expect(lineStartKind(wrapped, wrapped.indexOf('2024'))).toBe('continuation');
    expect(lineStartKind(wrapped, wrapped.indexOf('That'))).toBe('continuation');
    expect(lineStartKind('We have\n1. First', 8)).toBe('block');
    expect(lineStartKind('We have\n1) First', 11)).toBe('block');
    expect(lineStartKind('We have\n01. First', 8)).toBe('block');
    expect(lineStartKind('> We have\n> 2. Second', 12)).toBe('continuation');
    // After a blank line, any number starts a list.
    expect(lineStartKind('We have\n\n2024. That year', 9)).toBe('block');
    expect(lineStartKind('We have\n\n2024. That year', 15)).toBe('block');
    // And it goes on a list, also after a wrapped line of an item.
    expect(lineStartKind('1. a\n2. b', 8)).toBe('block');
    const wrappedItem = '1. a\nwrapped\n2024. b';
    expect(lineStartKind(wrappedItem, wrappedItem.indexOf('2024. ') + 6)).toBe('block');
    const bullets = '- a\nwrapped\n3. b';
    expect(lineStartKind(bullets, bullets.indexOf('3. ') + 3)).toBe('block');
  });

  it('reads a numbered item or a bullet under a line of an item as micromark does (#139)', () => {
    // A line in the item that holds the paragraph above, as far in as its text or further, goes on
    // the paragraph when it is a number other than 1, which can't interrupt one, or four columns or
    // more past the text, which would be indented code, and that can't either. Left of the text, it
    // ends the item and starts a block of its own, whatever its number.
    const cases = [
      '- six a\n  2. two',
      '- six a\n   2. two',
      '- six a\n      - two',
      '- six a\n      1. two',
      '- six a\n     - two',
      '- six a\n  - two',
      '- six a\n2. two',
      '- six a\n1) two',
      '1. a\n2) b',
      '1. a\n2. b',
      '1. a\n   3. b',
      '1. a\n  3. b',
      '10. a\n   3. b',
      '- a\n  - b\n  2. c',
      '- a\n  - b\n    2. c',
      '- a\n  - b\n        - c',
      '- a\n  1. b\n  2. c',
      '- a\nlazy\n  2. c',
      '- a\n  more\n  2. c',
      'para\n    - x',
      'para\n   - x',
      '> - six a\n>   2. two',
      '> - six a\n>       - two',
      '> - six a\n> 2. two',
      '-   four a\n    2. two',
      '-   four a\n  2. two',
      // A line above that only looks like an item is more of the paragraph, and holds nothing.
      '- a\n  2. b\n  3. c',
      '1. a\n   2. b\n   3. c',
      'para\n2. b\n3. c',
      '- a\n      - b\n      - c',
      '   w1\n   -  - w2\n    1.     w3\n       2.    w4',
      ' 1.  3)  w1\n    2.  w2\n        2.  w3',
      '  2.  2.  w1\n        1.    w2\n    -  w3\n        2.    1.   w4',
      // Left of the item's text, four columns past the container it is in.
      '  10.   w1\n       *   w2',
      '   para\n    - x',
    ];
    for (const text of cases) {
      const last = text.lastIndexOf('\n') + 1;
      const line = text.slice(last);
      const content = last + (/^(?:[ >]*(?:[-*+]|\d+[.)]) +)/.exec(line)?.[0].length ?? 0);
      // As micromark reads it, the line's marker is text of the paragraph above, or no text.
      const written = line.replace(/^[ >]*/, '').replace(/\s+/g, ' ');
      const apart = !blockLeaves(text).some((leaf) => leaf.text.includes(written));
      expect(lineStartKind(text, content), JSON.stringify(text)).toBe(
        apart ? 'block' : 'continuation',
      );
    }
  });

  it('reads the line under a thematic break or a closing fence as micromark does (rule 2)', () => {
    // A line under a thematic break or a closing fence starts a block; under a break indented by
    // four columns or more, which is text of the paragraph above, it goes on that paragraph.
    const shapes: string[] = [];
    for (const indent of ['', ' ', '  ', '   ', '    ', '     ']) {
      for (const rule of ['---', '***', '___', '- - -', '* * *']) {
        shapes.push(`para\n${indent}${rule}\nnext`, `> para\n> ${indent}${rule}\n> next`);
      }
    }
    shapes.push(
      '```\nx\n```\nnext',
      '~~~\nx\n~~~~\nnext',
      '- a\n  ```\n  x\n```\nfoo',
      '- a\n  ```\n  x\n  ```\nfoo',
      '> ```\n> x\n```\nfoo',
      '1. a\n   ```\n   x\n```\nfoo\n```\nbar',
    );
    for (const text of shapes) {
      const lines = text.split('\n');
      const last = text.lastIndexOf('\n') + 1;
      const word = lines.at(-1)!.replace(/^[ >]*/, '');
      const leaves = blockLeaves(text);
      const holder = leaves.find((leaf) => leaf.text.includes(word));
      // `next` goes on a block of text above it, or is a block of its own (code, or text).
      const goesOn = holder !== undefined && /para|\ba\b/.test(holder.text) && holder.kind === 'p';
      const kind = lineStartKind(text, last + (/^(?:> )?/.exec(lines.at(-1)!)?.[0].length ?? 0));
      // Where a fence stands in a container, the line is read as before, a line of the text above,
      // unless micromark reads it as a block start too.
      if (/^[ >\d.-]+(?:```|~~~)/m.test(text)) {
        if (kind === 'block') expect(goesOn, JSON.stringify(text)).toBe(false);
        continue;
      }
      expect(kind, JSON.stringify(text)).toBe(goesOn ? 'continuation' : 'block');
    }
  });

  it('reads random layouts of items as micromark does, or as an item that the checks fall back on', () => {
    // 30,000 layouts by default, in two halves. Two to four lines, each indented zero to eight
    // columns, with up to two list markers and one to five spaces after each; in the wider half,
    // in a quote too, with blank lines and headings above the last line. The last line is judged where micromark reads the line above it as a
    // line of a paragraph: it starts a block, or goes on that paragraph (#139).
    const MARKERS = ['-', '*', '1.', '2.', '3)', '10.', '1)'];
    const layout = (seed: number, wide: boolean) => {
      const random = seeded(seed);
      const pick = <T>(list: readonly T[]) => list[Math.floor(random() * list.length)] as T;
      const quote = wide && random() < 0.3 ? '> ' : '';
      const count = 2 + Math.floor(random() * 3);
      const lines: string[] = [];
      for (let i = 1; i <= count; i++) {
        let line = ' '.repeat(Math.floor(random() * 9));
        const items = random() < 0.75 ? 1 + Math.floor(random() * 2) : 0;
        for (let k = 0; k < items; k++)
          line += pick(MARKERS) + ' '.repeat(1 + Math.floor(random() * 5));
        if (wide && i > 1 && i < count && random() < 0.15) lines.push(quote.trim());
        if (wide && i < count && random() < 0.1) line = line.replace(/^ */, (m) => `${m}# `);
        lines.push(`${quote}${line}w${i}`);
      }
      return lines.join('\n');
    };
    let judged = 0;
    for (const wide of [false, true]) {
      for (let seed = 1; seed <= fuzzCount(15000); seed++) {
        const text = layout(seed + (wide ? 1_000_000 : 0), wide);
        const n = Number(/w(\d+)$/.exec(text)?.[1]);
        const leaves = blockLeaves(text);
        const above = leaves.find((leaf) => new RegExp(`(?:^| )w${n - 1}(?: |$)`).test(leaf.text));
        if (above?.kind !== 'p') continue;
        judged++;
        const micromarkReads = above.text.includes(`w${n}`) ? 'continuation' : 'block';
        const last = text.lastIndexOf('\n') + 1;
        const prefix = /^(?:> )?(?: *(?:[-*+]|\d+[.)]) +)*/.exec(text.slice(last))?.[0] ?? '';
        const kind = lineStartKind(text, last + prefix.length);
        if (kind === micromarkReads) continue;
        const label = `${wide ? 'wide ' : ''}seed ${seed}: ${JSON.stringify(text)}`;
        if (kind === 'block') {
          // The editor reads an item where micromark reads text, as on main: without quotes,
          // blank lines and headings, the format checks fall back on trying every mark there.
          if (!wide) expect(holdsMisreadItem(text, [], text.length), label).toBe(true);
        } else {
          // Text where micromark reads an item: only under a blank line, as in a loose list,
          // whose item the reading can't tell, as on main.
          expect(/\n>?\n/.test(text), label).toBe(true);
        }
      }
    }
    expect(judged).toBeGreaterThan(fuzzCount(15000) / 2);
  }, 60_000);

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

describe('where a blank line would matter (format §3.4)', () => {
  const at = (text: string, needle: string) => text.indexOf(needle) + needle.length;

  it('would make a list loose between the items of a tight one', () => {
    const list = '- one\n- two\n- three';
    expect(loosensList(list, at(list, 'one'))).toBe(true);
    expect(loosensList(list, at(list, 'one\n'))).toBe(true);
    expect(loosensList(list, at(list, 'two'))).toBe(true);
    // The end of the last item has no item after it.
    expect(loosensList(list, at(list, 'three'))).toBe(false);
    // A blank line is there already, or a paragraph and not an item follows.
    expect(loosensList('- one\n\n- two', at('- one\n\n- two', 'one'))).toBe(false);
    expect(loosensList('- one\n\nPara', at('- one\n\nPara', 'one'))).toBe(false);
    // A paragraph in front of a list is not an item of it.
    expect(loosensList('Steps:\n- one', at('Steps:\n- one', 'Steps:'))).toBe(false);
    // Numbers, nested items, and the lines of an item.
    expect(loosensList('1. one\n2. two', 6)).toBe(true);
    expect(loosensList('- one\n  - nested\n- two', 5)).toBe(true);
    expect(loosensList('- one\n  - nested\n- two', at('- one\n  - nested', 'nested'))).toBe(true);
    expect(loosensList('> - one\n> - two', 7)).toBe(true);
    expect(loosensList('Para one.\nPara two.', 9)).toBe(false);
  });

  it('is content between the lines of indented code', () => {
    const code = 'Intro.\n\n    code one\n\n    code two\n\nAfter.';
    expect(betweenIndentedCode(code, at(code, 'code one'))).toBe(true);
    expect(betweenIndentedCode(code, at(code, 'code one\n'))).toBe(true);
    // Not in front of the code, or after it, or between paragraphs.
    expect(betweenIndentedCode(code, at(code, 'Intro.'))).toBe(false);
    expect(betweenIndentedCode(code, at(code, 'code two'))).toBe(false);
    expect(betweenIndentedCode('One.\n\nTwo.', 4)).toBe(false);
    // The content of a list item, indented as much, is not code.
    const item = '- one\n\n    two\n\n    three';
    expect(betweenIndentedCode(item, at(item, '    two'))).toBe(true);
    const items = '- one\n    two\n- three';
    expect(betweenIndentedCode(items, at(items, 'two'))).toBe(false);
  });
});

describe('a line of only markers', () => {
  it('is one with nothing but markers and white space on it', () => {
    expect(onlyMarkers('Intro\n<!--del k3x9 gone-->\n- item', 8)).toBe(true);
    expect(onlyMarkers('> <!--fmt m2bd was=p--> <!--split s3vb-->', 0)).toBe(true);
    expect(onlyMarkers('<!--del k3x9 a - b -> c-->', 0)).toBe(true);
    expect(onlyMarkers('<!--ins k3x9-->text<!--/k3x9-->', 0)).toBe(false);
    expect(onlyMarkers('', 0)).toBe(false);
  });

  it('reads a line of many markers in one pass (REDLINES_FUZZ=6000, formatting)', () => {
    // A pattern whose marker text could hold `-->` tried every way of cutting such a line into
    // markers before it gave up: seconds for 32 markers in front of a word, and twice as long for
    // each two more.
    const line = `${Array.from({ length: 32 }, (_, i) => `<!--fmt m${i} was=p-->`).join('')}text`;
    const start = performance.now();
    expect(onlyMarkers(line, 0)).toBe(false);
    expect(performance.now() - start).toBeLessThan(250);
  });
});

describe('whether a numbered item from 2 goes on with a list (format §2.6)', () => {
  it('reads the lines right above it, with either kind of line break', () => {
    for (const eol of ['\n', '\r\n']) {
      const lines = (...all: string[]) => all.join(eol);
      const cases: [string, boolean][] = [
        [lines('1. one', '2. two', '3. three'), true],
        // A lazy line of the item's paragraph, or a line of the item, goes on with it.
        [lines('1. one', 'lazy', '3. three'), true],
        [lines('1. one', '   more', '3. three'), true],
        // A paragraph, which `3.` can't interrupt; an empty item, which takes no lazy line.
        [lines('Intro', '3. three'), false],
        [lines('1. ', 'gamma beta', '3. three'), false],
        // Nothing above it: it starts a list.
        [lines('3. three'), true],
      ];
      for (const [text, goesOn] of cases) {
        expect(continuesList(text, text.indexOf('3.'), '.'), JSON.stringify(text)).toBe(goesOn);
      }
    }
  });

  it('takes a heading, a fence or a thematic break for no lazy line of an item', () => {
    const goesOn = (text: string) => continuesList(text, text.indexOf('3.'), '.');
    // The heading interrupts the item's paragraph and ends the list; `3.` can't interrupt the
    // paragraph after it.
    expect(goesOn('1. one\n# new\nnew words\n3. three')).toBe(false);
    expect(goesOn('1. one\n```\n3. three')).toBe(false);
    expect(goesOn('1. one\n---\nwords\n3. three')).toBe(false);
    // Right after the heading no paragraph is open, and `3.` starts a list.
    expect(goesOn('1. one\n# new\n3. three')).toBe(true);
    // Words and a `#` without its space are lazy lines.
    expect(goesOn('1. one\nmore words\n3. three')).toBe(true);
    expect(goesOn('1. one\n#tag\n3. three')).toBe(true);
  });

  it('reads the number of an item in a deep quote in one pass', () => {
    expect(numberedFromTwo('> > 2. ')).toBe('.');
    expect(numberedFromTwo('> 1) ')).toBeUndefined();
    // The space after each `>` could go with it or with the next one: a pattern that tried both
    // took seconds on thirty of them.
    for (const prefix of ['> ', '>  ', '>\t']) {
      const start = performance.now();
      expect(numberedFromTwo(`${prefix.repeat(30)}text`)).toBeUndefined();
      expect(numberedFromTwo(`${prefix.repeat(30)}3) text`)).toBe(')');
      expect(performance.now() - start).toBeLessThan(50);
    }
  });

  it('takes the markers out of a stretch of text in one pass', () => {
    expect(withoutMarkers('1. <!--fmt m2bd was=ul-->one <!--ins k3x9-->two<!--/k3x9-->')).toBe(
      '1. one two',
    );
    expect(withoutMarkers('a <!--b c')).toBe('a <!--b c');
    const start = performance.now();
    expect(withoutMarkers('<!--a'.repeat(20000)).length).toBe(100000);
    expect(performance.now() - start).toBeLessThan(250);
  });

  it('never reads an item where CommonMark reads text', () => {
    // Lines of many kinds above `2. Z`, chosen at random: where the model says it goes on with the
    // list, micromark must read an item. (Fences and HTML blocks, which run on over blank lines,
    // are left out: the model takes the item to be text after one in its lines, but not after one
    // above a blank line before them.)
    const kinds = ['1. a', '1. ', '1.', '2. b', '10. c', '3) x', '- s', '- ', '-', '* s', '+ t'];
    kinds.push('   - n', '    - d', '  - t', '     - e', 'text', ' text', '  more', '   more');
    kinds.push('    code', '# h', '#', '***', '---', '--', '===', '', '   2. s', '   1. s');
    kinds.push('1) y', '- [ ] box', '      deep', '   10. w', '\tTab');
    kinds.push('> q', '>', '> # h', '> - a', '  > q', '   > q');
    kinds.push('- - -', '* * *', '   - - -', '_ _ _', '   ***', '- - x', '* *');
    let seed = 7;
    const random = () => {
      seed = (seed * 1103515245 + 12345) >>> 0;
      return seed / 4294967296;
    };
    for (let k = 0; k < fuzzCount(3000); k++) {
      const lines = Array.from(
        { length: 1 + Math.floor(random() * 5) },
        () => kinds[Math.floor(random() * kinds.length)] ?? '',
      );
      const text = `${lines.join('\n')}\n2. Z\n`;
      if (!continuesList(text, text.indexOf('2. Z'), '.')) continue;
      expect(micromark(text), JSON.stringify(text)).toMatch(/<li>Z<\/li>|<li>\s*<p>Z<\/p>/);
    }
  });

  it('takes a lazy line under an item of another list, or an item there, as micromark does', () => {
    const goesOn = (text: string) => continuesList(text, text.indexOf('2. Z'), '.');
    // A bullet three spaces deep starts a list of its own, which `2.` breaks out of.
    expect(goesOn('1. \none\n   - sub\n2. Z')).toBe(true);
    expect(goesOn('- sub\ntext\n2. Z')).toBe(true);
    // Four spaces deep, after a paragraph, it is more of the paragraph; so is `   2. sub`.
    expect(goesOn('1. \nalpha\n    - sub\n2. Z')).toBe(false);
    expect(goesOn('1. \nalpha\n   2. sub\n2. Z')).toBe(false);
    // A second paragraph of an item, and an empty item, which takes nothing after a blank line.
    expect(goesOn('1. a\n\n   b\n2. Z')).toBe(true);
    expect(goesOn('1. \n\n   b\n2. Z')).toBe(false);
    // A lazy line after a nested item, and code, after which `2.` is text.
    expect(goesOn('1. a\n   - sub\nlazy\n2. Z')).toBe(true);
    expect(goesOn('    code\n\n2. Z')).toBe(false);
    expect(goesOn('\tcode\n\n2. Z')).toBe(false);
    // A quote, and a lazy line of the paragraph in it, which `2.` breaks out of.
    expect(goesOn('1. x\n> q\nlazy\n2. Z')).toBe(true);
    expect(goesOn('>\ntext\n2. Z')).toBe(false);
    // A spaced thematic break is one, not a bullet: it ends the paragraph above it and opens none,
    // so the lines after it are a paragraph, which `2.` can't interrupt. Inside an item, it opens no
    // paragraph for a lazy line to go on with.
    expect(goesOn('more words\n- - -\n   text\n   text\n2. Z')).toBe(false);
    expect(micromark('more words\n- - -\n   text\n   text\n2. Z\n')).not.toContain('<li>');
    expect(goesOn('1. a\n* * *\n2. Z')).toBe(true);
    expect(goesOn('1. a\n   - - -\nlazy\n2. Z')).toBe(false);
    expect(micromark('1. a\n   - - -\nlazy\n2. Z\n')).not.toContain('<li>Z');
    expect(goesOn('1. a\n   ***\nlazy\n2. Z')).toBe(false);
    expect(goesOn('- - x\n2. Z')).toBe(true);
  });

  it('reads a line so far by what the list can see of it, the same as by its text', () => {
    // The reading of the lines above an item keeps the line read so far in each state of the list,
    // summed up to what `listStep` can read of it once the rest of the line comes: its indentation
    // (as far as the widths that matter), a list marker and the spaces after it, a box, a quote's
    // marks, and of the text the start of a heading or a fence, a thematic break or an underline
    // in the making, and otherwise that there is text. Random lines of many pieces, parted at a
    // random place: whatever comes after the part, the list reads the same from the sum as from the
    // text, in every state it can be in.
    const pieces = [' ', '  ', '   ', '    ', '\t', '-', '*', '+', '_', '=', '#', '`', '~', '>'];
    pieces.push('<', '[', ']', 'x', '.', ')', '1', '2', '0', '10', 'alpha', 'w2', '- ', '* ');
    pieces.push('1. ', '2. ', '10) ', '[x] ', '[ ] ', '***', '- - -', '===', '```', '~~~', '# ');
    pieces.push('###', '> ', '>>', '\r', '\u00a0', '12345678901. ', '-x', '==', ' = ', '--');
    pieces.push('+ ', '1.', '12', '12. ', '- -', '* *', '- [ ] ', '> - ');
    const states: ListState[] = [LIST_START];
    for (const column of [0, 2, 3, 4, 5, 7, Number.MAX_SAFE_INTEGER]) {
      for (const flags of [
        [true, false, false, false, false],
        [true, true, false, false, false],
        [true, false, false, true, false],
        [false, true, false, false, false],
        [false, false, true, false, false],
        [false, true, false, false, true],
        [false, false, false, false, true],
      ] as const) {
        const [list, paragraph, inner, fresh, code] = flags;
        states.push({ list, paragraph, inner, column, fresh, code });
      }
    }
    let seed = 11;
    const random = () => {
      seed = (seed * 1103515245 + 12345) >>> 0;
      return seed / 4294967296;
    };
    const pick = <T>(from: readonly T[]) => from[Math.floor(random() * from.length)] as T;
    const strip = (line: string) => line.replace(/\r$/, '');
    const seen = new Map<number, Set<string>>();
    for (let k = 0; k < fuzzCount(3000); k++) {
      const line = Array.from({ length: 1 + Math.floor(random() * 6) }, () => pick(pieces)).join(
        '',
      );
      const cut = Math.floor(random() * (line.length + 1));
      const part = line.slice(0, cut);
      const rest = line.slice(cut);
      const own = pick([0, 1, 2, 3, 4, 5, 6, 8]);
      const summed = lineSoFar(part, own);
      let ofOwn = seen.get(own);
      if (!ofOwn) seen.set(own, (ofOwn = new Set()));
      ofOwn.add(summed);
      const label = `${JSON.stringify(part)} + ${JSON.stringify(rest)} at ${own}`;
      expect(summed === '', label).toBe(part === '');
      for (const state of states) {
        for (const delimiter of ['.', ')']) {
          expect(
            listStep(state, strip(summed + rest), own, delimiter),
            `${label}, ${JSON.stringify(state)} ${delimiter}`,
          ).toEqual(listStep(state, strip(part + rest), own, delimiter));
        }
      }
    }
    // Words typed onto a line, however many, are one state.
    const words = (prefix: string) =>
      new Set(
        Array.from({ length: 40 }, (_, n) =>
          lineSoFar(`${prefix}alpha${Array.from({ length: n }, (_, i) => `w${i}`).join('')}`, 0),
        ),
      );
    expect(words('')).toHaveLength(1);
    expect(words('2. ')).toHaveLength(1);
    expect(words('- [x] ')).toHaveLength(1);
    expect(words('> ')).toHaveLength(1);
    expect(words('   ')).toHaveLength(1);
    for (const [own, sums] of seen) expect(sums.size, `at ${own}`).toBeLessThan(600);
  });

  it('steps from line to line past either kind of line break', () => {
    expect(nextLineStart('one\ntwo', 1)).toBe(4);
    expect(nextLineStart('one\r\ntwo', 1)).toBe(5);
    expect(nextLineStart('one\r\ntwo', 4)).toBe(5);
    expect(nextLineStart('one', 1)).toBe(4);
  });
});

describe('the readings that calls of lineStartKind share', () => {
  /** A text of lines that read from the lines above them, with a comment at its end whose markers
   * are hidden (a non-empty `hidden` is what lets the calls share what they read). */
  const layout = (random: () => number) => {
    const below = (n: number) => Math.floor(random() * n);
    const pick = <T>(items: readonly T[]) => items[below(items.length)] as T;
    const lines: string[] = [];
    // Now and then a paragraph with a run of numbered lines under it: each reads from the lines
    // above, further than the depth the reading goes (a number other than 1 is text there).
    if (below(2) === 0) {
      lines.push(pick(['para', '# h', '---', '']));
      const first = 2 + below(3);
      for (let i = 0; i < 9 + below(8); i++) lines.push(`${first + i}. x${i}`);
    }
    for (let n = 3 + below(40); n > 0; n--) {
      const run = below(8) === 0 ? 8 + below(8) : 1;
      for (let i = 0; i < run; i++) {
        lines.push(
          pick([
            `${below(12)}. x`,
            `${2 + below(9)}. x`,
            `${2 + below(9)}) x`,
            ' '.repeat(below(5)) + `${below(12)}. x`,
            ' '.repeat(below(5)) + '- x',
            '1. x',
            'para text',
            '  more text',
            '> q',
            '> 2. q',
            '',
            '# h',
            '---',
            '```',
            '    code',
            '- 1. x',
            ' 2. x',
          ]),
        );
      }
    }
    const body = lines.join('\n');
    const text = `${body}\n<!--x-->`;
    return { text, hidden: [{ from: body.length + 1, to: text.length }] };
  };

  it('answer as a fresh reading does, in any order of the calls', () => {
    let compared = 0;
    let differing = 0;
    for (let seed = 1; seed <= fuzzCount(300); seed++) {
      const random = seeded(seed * 7919);
      const { text, hidden } = layout(random);
      const starts: number[] = [];
      for (let at = 0; at < text.length; at = text.indexOf('\n', at) + 1 || text.length) {
        starts.push(at);
        for (const extra of [1, 2, 3]) if (text[at + extra] !== undefined) starts.push(at + extra);
      }
      const fresh = (at: number) => lineStartKind(text, at, hidden, 0, listMemo(text, []));
      const orders = [
        starts,
        [...starts].reverse(),
        starts
          .map((at) => ({ at, key: random() }))
          .sort((a, b) => a.key - b.key)
          .map(({ at }) => at),
      ];
      for (const order of orders) {
        // The markers as a new array each time: what is shared is not carried between orders.
        const markers = hidden.map((range) => ({ ...range }));
        for (const at of order) {
          compared++;
          const shared = lineStartKind(text, at, markers);
          if (shared !== fresh(at)) {
            differing++;
            expect(shared, `seed ${seed} at ${at} in ${JSON.stringify(text)}`).toBe(fresh(at));
          }
        }
      }
    }
    expect(compared).toBeGreaterThan(1000);
    expect(differing).toBe(0);
  });

  it('never share an answer between two different sets of ranges in one array', () => {
    // A run of numbered lines under a paragraph, with a comment after it at the end; the same array
    // is changed in place to every set of ranges that hides some of the lines, and each answer is the
    // one a fresh reading gives: the check is the ranges themselves, not a sum of them.
    const body = ['para', ...Array.from({ length: 12 }, (_, i) => `${i + 2}. x${i}`)].join('\n');
    const text = `${body}\n<!--x-->`;
    const starts: number[] = [];
    for (let at = 0; at < text.length; at = text.indexOf('\n', at) + 1 || text.length)
      starts.push(at);
    const markers: { from: number; to: number }[] = [];
    for (let seed = 1; seed <= 300; seed++) {
      const random = seeded(seed);
      markers.length = 0;
      for (let n = 1 + Math.floor(random() * 4); n > 0; n--) {
        const at = starts[Math.floor(random() * starts.length)] ?? 0;
        markers.push({ from: at, to: Math.min(text.length, at + Math.floor(random() * 4)) });
      }
      markers.sort((a, b) => a.from - b.from);
      for (const at of starts) {
        expect(lineStartKind(text, at, markers), `seed ${seed} at ${at}`).toBe(
          lineStartKind(text, at, markers, 0, listMemo(text, [])),
        );
      }
    }
  });

  it('read afresh the markers that a caller changed', () => {
    const text = 'para\n2. x0\n<!--x-->';
    const markers = [{ from: 13, to: text.length }];
    const before = lineStartKind(text, 5, markers);
    markers[0] = { from: 0, to: 4 };
    expect(lineStartKind(text, 5, markers)).toBe(
      lineStartKind(text, 5, [{ from: 0, to: 4 }], 0, listMemo(text, [])),
    );
    expect(before).toBe('continuation');
  });
});
