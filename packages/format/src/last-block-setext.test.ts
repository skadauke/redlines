// Deleting the last block of a text with Track Changes on, when the block above it is a setext
// heading (#372). The deletion takes the break in front of the block (format §3.4), and that break
// holds the heading's underline (`breakLength`), which is the heading's own: no marker may stand
// behind it (§3.1), and a payload that held it would leave the heading's text a paragraph once the
// deletion was accepted, and in the file as other readers read it. The block goes without that
// break, as the only block of a text does. A range that starts behind the underline starts at the
// block, and a setext heading that is deleted takes its own underline with it.

import { describe, expect, it } from 'vitest';
import { underlineOfBreak } from './blocks.ts';
import { applyChanges } from './changes.ts';
import { accept, reject } from './decide.ts';
import { EditError } from './errors.ts';
import { parse } from './parse.ts';
import { fuzzCount, seeded } from './random-docs.ts';
import {
  REFUSALS,
  ada,
  blockLeaves,
  bodyOf,
  context,
  expectEveryOrderAlike,
  file,
} from './test-helpers.ts';
import { trackedEdits } from './track.ts';
import { newestView, originalView } from './views.ts';

/** The body of a file without the line breaks that end it. */
const bodyText = (text: string) => bodyOf(text).replace(/\n+$/, '');

/** The leaf blocks of a text as CommonMark reads them, as a string: a heading that became a
 * paragraph is a different string. */
const leaves = (text: string) => JSON.stringify(blockLeaves(text));

/** Ada deletes `from` to `to` of the body, with Track Changes on: the file before and after. */
function deleteRange(body: string, from: number, to: number) {
  const before = file(body);
  const result = trackedEdits(before, [{ from, to, insert: '' }], context(ada, ['m2bd']));
  return { before, after: applyChanges(before, result.changes) };
}

/**
 * Checks what a deletion of blocks leaves, in every state: `after` is the file with the deletion
 * pending, `body` the text it was made from, and `kept` the text of the blocks that stay. The file
 * is read as other renderers read it, and the newest view, as `kept` is; accepting gives `kept`'s
 * blocks, and rejecting gives every byte of `body` back.
 */
function expectBlocksKept(label: string, body: string, kept: string, after: string): void {
  const wanted = leaves(file(kept));
  expect(leaves(after), `${label}: the file as other readers read it`).toBe(wanted);
  expect(leaves(newestView(after).text), `${label}: the newest view`).toBe(wanted);
  const accepted = applyChanges(after, accept(after, 'm2bd'));
  expect(leaves(accepted), `${label}: accepting`).toBe(wanted);
  const rejected = applyChanges(after, reject(after, 'm2bd'));
  expect(bodyText(rejected), `${label}: rejecting`).toBe(body);
  expect(bodyText(originalView(after).text), `${label}: the original view`).toBe(body);
  expect(parse(after).warnings, label).toEqual([]);
  expectEveryOrderAlike(label, after);
}

describe('a deletion of the last block, under a setext heading (#372)', () => {
  it('goes without the break that holds the underline: the heading stays a heading', () => {
    // [the text, what is deleted, the file with the deletion pending, what stays]
    const cases: [string, string, string, string][] = [
      [
        'Title\n---\n\nLast paragraph',
        'Last paragraph',
        'Title\n---\n\n<!--del m2bd Last paragraph-->',
        'Title\n---',
      ],
      [
        'Title\n===\n\nLast paragraph',
        'Last paragraph',
        'Title\n===\n\n<!--del m2bd Last paragraph-->',
        'Title\n===',
      ],
      // The heading after other blocks, and a longer underline.
      [
        'Intro\n\nTitle\n=====\n\nOne',
        'One',
        'Intro\n\nTitle\n=====\n\n<!--del m2bd One-->',
        'Intro\n\nTitle\n=====',
      ],
      // A heading of two lines of text, and a block of two lines.
      [
        'Long\ntitle\n---\n\nTwo\nlines',
        'Two\nlines',
        'Long\ntitle\n---\n\n<!--del m2bd Two\\nlines-->',
        'Long\ntitle\n---',
      ],
      // More than one block, and a block that is a list, a quote, a heading, a table, an image.
      [
        'Title\n---\n\nOne\n\nTwo',
        'One\n\nTwo',
        'Title\n---\n\n<!--del m2bd One\\n\\nTwo-->',
        'Title\n---',
      ],
      [
        'Title\n---\n\n- one\n- two',
        'one\n- two',
        'Title\n---\n\n<!--del m2bd - one\\n- two-->',
        'Title\n---',
      ],
      ['Title\n---\n\n- item', 'item', 'Title\n---\n\n<!--del m2bd - item-->', 'Title\n---'],
      ['Title\n---\n\n> quoted', 'quoted', 'Title\n---\n\n<!--del m2bd > quoted-->', 'Title\n---'],
      ['Title\n---\n\n## Head', 'Head', 'Title\n---\n\n<!--del m2bd ## Head-->', 'Title\n---'],
      [
        'Title\n---\n\n![img](a.png)',
        '![img](a.png)',
        'Title\n---\n\n<!--del m2bd ![img](a.png)-->',
        'Title\n---',
      ],
      [
        'Title\n---\n\n| a | b |\n| - | - |\n| 1 | 2 |',
        '| a | b |\n| - | - |\n| 1 | 2 |',
        'Title\n---\n\n<!--del m2bd \\| a \\| b \\|\\n\\| - \\| - \\|\\n\\| 1 \\| 2 \\|-->',
        'Title\n---',
      ],
      // In a quote, and in a list item: the heading and the block are in the same container.
      [
        '> Title\n> ---\n>\n> Last paragraph',
        'Last paragraph',
        '> Title\n> ---\n>\n<!--del m2bd > Last paragraph-->',
        '> Title\n> ---',
      ],
      [
        '- Title\n  ---\n\n  Last paragraph',
        'Last paragraph',
        '- Title\n  ---\n\n<!--del m2bd   Last paragraph-->',
        '- Title\n  ---',
      ],
      // Windows line breaks.
      [
        'Title\r\n---\r\n\r\nLast paragraph',
        'Last paragraph',
        'Title\r\n---\r\n\r\n<!--del m2bd Last paragraph-->',
        'Title\r\n---',
      ],
      // The line above is no heading's text, a rule or an ATX heading: CommonMark makes a rule of
      // the line, but the break reads it as the underline it looks like, and the block goes alone.
      ['# Head\n---\n\nLast', 'Last', '# Head\n---\n\n<!--del m2bd Last-->', '# Head\n---'],
      ['***\n---\n\nLast', 'Last', '***\n---\n\n<!--del m2bd Last-->', '***\n---'],
    ];
    for (const [body, target, written, kept] of cases) {
      const label = JSON.stringify(body);
      const at = body.lastIndexOf(target);
      const { after } = deleteRange(body, at, at + target.length);
      expect(bodyText(after), label).toBe(written);
      expectBlocksKept(label, body, kept, after);
    }
  });

  it('goes the same from the first column of the block, in front of its prefix', () => {
    for (const [body, line, written] of [
      ['Title\n---\n\n- item', '- item', 'Title\n---\n\n<!--del m2bd - item-->'],
      ['Title\n---\n\n> quoted', '> quoted', 'Title\n---\n\n<!--del m2bd > quoted-->'],
      ['Title\n---\n\n## Head', '## Head', 'Title\n---\n\n<!--del m2bd ## Head-->'],
    ] as const) {
      const at = body.lastIndexOf(line);
      const { after } = deleteRange(body, at, body.length);
      expect(bodyText(after), body).toBe(written);
      expectBlocksKept(body, body, 'Title\n---', after);
    }
  });

  it('goes with the break after the blocks where that break is the stronger one', () => {
    // Three blank lines follow the block, more than the break in front of it has even without the
    // underline's own: the break in front, which would hold the underline, is not the one to take.
    for (const [body, target, written, kept] of [
      [
        'Title\n---\n\nOne\n\n\n\nTwo',
        'One',
        'Title\n---\n\n<!--del m2bd One\\n\\n\\n\\n-->\n\nTwo',
        'Title\n---\n\nTwo',
      ],
      [
        'Title\n---\n\n- one\n\n\n\nPara',
        'one',
        'Title\n---\n\n<!--del m2bd - one\\n\\n\\n\\n-->\n\nPara',
        'Title\n---\n\nPara',
      ],
    ] as const) {
      const at = body.indexOf(target);
      const { after } = deleteRange(body, at, at + target.length);
      expect(bodyText(after), body).toBe(written);
      expectBlocksKept(body, body, kept, after);
    }
  });

  it('is written as it was where the heading is deleted too: the underline is in the block', () => {
    const body = 'A\n===\n\nB\n---\n\nLast';
    const { after } = deleteRange(body, body.indexOf('B'), body.length);
    expect(bodyText(after)).toBe('A\n===\n\n<!--del m2bd B\\n-\\-\\-\\n\\nLast-->');
    expectBlocksKept(body, body, 'A\n===', after);
    const heading = deleteRange(body, body.indexOf('B'), body.indexOf('Last') - 2);
    expect(bodyText(heading.after)).toBe('A\n===\n\n<!--del m2bd B\\n-\\-\\-\\n\\n-->\n\nLast');
    expectBlocksKept(body, body, 'A\n===\n\nLast', heading.after);
  });

  it('takes its own underline with a deleted setext heading, and leaves the block in front a paragraph', () => {
    // The underline is in the break after the heading: a deletion that took the break in front of
    // the heading instead would end in front of it, and leave it under the block above (#372).
    // [the text, what is deleted, the file with the deletion pending, what stays]
    for (const [body, target, written, kept] of [
      [
        'Intro\n\nTitle\n---\n\nAfter',
        'Title',
        'Intro\n\n<!--del m2bd Title\\n-\\-\\-\\n\\n-->\n\nAfter',
        'Intro\n\nAfter',
      ],
      [
        'Intro\n\nTitle\n---\n\nAfter',
        'Title\n---',
        'Intro\n\n<!--del m2bd Title\\n-\\-\\-\\n\\n-->\n\nAfter',
        'Intro\n\nAfter',
      ],
      // The last block of the text, with the ledger after it.
      ['Intro\n\nTitle\n---', 'Title', 'Intro\n\n<!--del m2bd Title\\n-\\-\\x2d-->', 'Intro'],
      ['Intro\n\nTitle\n---', 'Title\n---', 'Intro\n\n<!--del m2bd Title\\n-\\-\\x2d-->', 'Intro'],
      // After a list, where an underline under the item would make a rule of it.
      [
        '- a\n- b\n\nTitle\n===\n\nAfter',
        'Title\n===',
        '- a\n- b\n\n<!--del m2bd Title\\n===\\n\\n-->\n\nAfter',
        '- a\n- b\n\nAfter',
      ],
      // In a quote, and with Windows line breaks.
      [
        '> Intro\n>\n> Title\n> ---\n>\n> After',
        'Title\n> ---',
        '> Intro\n>\n> <!--del m2bd Title\\n> -\\-\\-\\n>\\n> -->\n>\n> After',
        '> Intro\n>\n> After',
      ],
      [
        'Intro\r\n\r\nTitle\r\n---\r\n\r\nAfter',
        'Title',
        'Intro\r\n\r\n<!--del m2bd Title\\n-\\-\\-\\n\\n-->\r\n\r\nAfter',
        'Intro\r\n\r\nAfter',
      ],
    ] as const) {
      const at = body.indexOf(target);
      const { after } = deleteRange(body, at, at + target.length);
      expect(bodyText(after), JSON.stringify(body)).toBe(written);
      expectBlocksKept(JSON.stringify(body), body, kept, after);
    }
  });

  it('starts a range that starts behind the underline at the block, and keeps the blank lines', () => {
    // From the end of the underline's line, or the blank line under it, to the end of the text.
    // [the text, where the range starts, where it ends (the end of the text when absent), the
    // file with the deletion pending, what stays]
    for (const [body, start, end, written, kept] of [
      [
        'Title\n---\n\nLast',
        '\n\nLast',
        undefined,
        'Title\n---\n\n<!--del m2bd Last-->',
        'Title\n---',
      ],
      [
        'Title\n---\n\nLast',
        '\nLast',
        undefined,
        'Title\n---\n\n<!--del m2bd Last-->',
        'Title\n---',
      ],
      [
        'Title\n---\n\nMid\n\nLast',
        '\n\nMid',
        '\n\nMid',
        'Title\n---\n\n<!--del m2bd Mid\\n\\n-->\n\nLast',
        'Title\n---\n\nLast',
      ],
      [
        'Title\r\n---\r\n\r\nLast',
        '\r\n\r\nLast',
        undefined,
        'Title\r\n---\r\n\r\n<!--del m2bd Last-->',
        'Title\r\n---',
      ],
      [
        '> Title\n> ---\n>\n> Last',
        '\n>\n> Last',
        undefined,
        '> Title\n> ---\n>\n<!--del m2bd > Last-->',
        '> Title\n> ---',
      ],
      [
        '- Title\n  ---\n\n  Last',
        '\n\n  Last',
        undefined,
        '- Title\n  ---\n\n<!--del m2bd   Last-->',
        '- Title\n  ---',
      ],
    ] as const) {
      const from = body.indexOf(start);
      const to = end === undefined ? body.length : from + end.length;
      const { after } = deleteRange(body, from, to);
      expect(bodyText(after), JSON.stringify(body)).toBe(written);
      expectBlocksKept(JSON.stringify(body), body, kept, after);
    }
  });

  it('refuses a range that takes part of the underline, or only the blank lines under it', () => {
    // The join of the block below onto the heading, a part of the underline, and a range that ends
    // inside the block: the line of the underline takes no change, and nothing is written.
    const words = 'A line that is only Markdown syntax takes no change.';
    const body = 'Title\n---\n\nLast';
    for (const [from, to] of [
      [body.indexOf('\n\n'), body.indexOf('Last')],
      [body.indexOf('\n\n'), body.indexOf('Last') + 2],
      [body.indexOf('--\n'), body.length],
      [body.indexOf('-\n'), body.length],
    ]) {
      expect(() => deleteRange(body, from as number, to as number), `${from}-${to}`).toThrow(words);
    }
  });

  it('takes the underline when the range starts at it or in front of it, as it was asked', () => {
    // The person selected the underline too: it goes, and the heading with it.
    const body = 'Title\n---\n\nLast';
    for (const from of [body.indexOf('\n---'), body.indexOf('---')]) {
      const { after } = deleteRange(body, from, body.length);
      expect(bodyText(after), String(from)).toBe('Title<!--del m2bd \\n-\\-\\-\\n\\nLast-->');
      expectBlocksKept(String(from), body, 'Title', after);
    }
  });

  it('leaves the other breaks as they were: after an ATX heading, a paragraph, a list', () => {
    for (const [body, target, written, kept] of [
      ['# Head\n\nLast', 'Last', '# Head<!--del m2bd \\n\\nLast-->', '# Head'],
      ['One\n\nTwo', 'Two', 'One<!--del m2bd \\n\\nTwo-->', 'One'],
      ['- a\n- b\n\nLast', 'Last', '- a\n- b<!--del m2bd \\n\\nLast-->', '- a\n- b'],
      [
        'Title\n---\n\nOne\n\nTwo',
        'Two',
        'Title\n---\n\nOne<!--del m2bd \\n\\nTwo-->',
        'Title\n---\n\nOne',
      ],
    ] as const) {
      const at = body.lastIndexOf(target);
      const { after } = deleteRange(body, at, at + target.length);
      expect(bodyText(after), body).toBe(written);
      expectBlocksKept(body, body, kept, after);
    }
  });

  it('still refuses right under the underline, with no blank line: the line takes no marker', () => {
    // As under a rule or a fence: the line above the block takes no change, and nothing is written.
    const syntax = 'A line that is only Markdown syntax takes no change.';
    for (const [body, text, words] of [
      ['Title\n---\nLast', 'Last', syntax],
      ['Title\n===\nLast', 'Last', 'A marker here would start a line.'],
      ['Title\n---\n- item', 'item', syntax],
    ] as const) {
      const at = body.lastIndexOf(text);
      expect(() => deleteRange(body, at, body.length), body).toThrow(words);
    }
  });

  it('keeps the heading where another person has a change in the block or in the heading', () => {
    const marks = { h3q9: 'bo' };
    for (const [body, target, kept] of [
      // Bo's deletion inside the block, which the deletion is split around.
      ['Title\n---\n\nLast <!--del h3q9 old -->paragraph', 'Last paragraph', 'Title\n---'],
      // Bo's insertion in the heading's text.
      ['Ti<!--ins h3q9-->x<!--/h3q9-->tle\n---\n\nLast paragraph', 'Last paragraph', 'Tixtle\n---'],
    ] as const) {
      const before = file(body, marks);
      const view = newestView(before);
      const at = view.text.indexOf(target);
      const from = view.map.toSource(at, 1);
      const to = view.map.toSource(at + target.length, -1);
      const result = trackedEdits(before, [{ from, to, insert: '' }], context(ada, ['m2bd']));
      const after = applyChanges(before, result.changes);
      // The heading is the heading in the file, and in each state of the deletion.
      expect(leaves(after), body).toBe(leaves(file(kept)));
      expect(parse(after).warnings, body).toEqual([]);
      const accepted = applyChanges(after, accept(after, 'm2bd'));
      expect(leaves(accepted), body).toBe(leaves(file(kept)));
      expectEveryOrderAlike(body, after);
    }
  });
});

describe('the break that holds a setext underline (underlineOfBreak)', () => {
  it('ends the underline, before its line break, where the break holds one', () => {
    for (const [text, end] of [
      ['Title\n---\n\nLast', 'Title\n---'.length],
      ['Title\n=\n\nLast', 'Title\n='.length],
      ['Title\r\n=====\r\n\r\nLast', 'Title\r\n====='.length],
      ['> Title\n> ---\n>\n> Last', '> Title\n> ---'.length],
      ['- Title\n  ---\n\n  Last', '- Title\n  ---'.length],
    ] as const) {
      // The break starts where the line of text ends: at its CR, or its LF.
      const start = text.includes('\r') ? text.indexOf('\r') : text.indexOf('\n');
      expect(underlineOfBreak(text, start), JSON.stringify(text)).toBe(end);
    }
  });

  it('is undefined where the break holds none', () => {
    for (const text of [
      // No blank line after the line: it is no underline of a break.
      'Title\n---\nLast',
      // A blank line is no underline.
      'One\n\nTwo',
      // A bullet is no underline in the item's text.
      '- one\n-\n\nTwo',
      // A line in another container than the line above it.
      '> Title\n---\n\nLast',
      // Nothing after the line break.
      'Title\n',
    ]) {
      expect(underlineOfBreak(text, text.indexOf('\n')), JSON.stringify(text)).toBeUndefined();
    }
  });
});

describe('a deletion of the last blocks under a setext heading, in random texts', () => {
  it('reads the heading as it was in the file, the views and each decision', () => {
    let written = 0;
    let refused = 0;
    for (let seed = 1; seed <= fuzzCount(150); seed++) {
      const random = seeded(seed * 7907);
      const below = (n: number) => Math.floor(random() * n);
      const pick = <T>(items: readonly T[]): T => items[below(items.length)] as T;
      const words = (n: number) =>
        Array.from({ length: 1 + below(n) }, () => pick(['alpha', 'beta', 'gamma'])).join(' ');
      // The blocks above the heading, at the top level.
      const above = [() => words(3), () => `## ${words(2)}`, () => `- ${words(2)}\n- ${words(2)}`];
      const heading = () => `${words(2)}\n${pick(['===', '---', '=====', '----', '='])}`;
      // The blocks under it, in the heading's container.
      const last = [
        () => words(4),
        () => `${words(3)}\n${words(3)}`,
        () => `- ${words(2)}\n- ${words(2)}`,
        () => `> ${words(3)}`,
        () => `## ${words(2)}`,
        () => `| a | b |\n| - | - |\n| ${words(1)} | ${words(1)} |`,
        () => `![${words(1)}](${pick(['a', 'b'])}.png)`,
      ];
      const top = Array.from({ length: below(3) }, () => pick(above)());
      const blocks = [heading(), ...Array.from({ length: 1 + below(3) }, () => pick(last)())];
      // The container of the heading and the blocks under it: none, a quote, a list item.
      const [first, other, blank] = pick([
        ['', '', ''],
        ['> ', '> ', '>'],
        ['- ', '  ', ''],
      ] as const);
      /** The lines of the text with the first `count` blocks of the container. */
      const render = (count: number) => {
        const lines = top.flatMap((block) => [...block.split('\n'), '']);
        blocks.slice(0, count).forEach((block, i) => {
          if (i > 0) lines.push(blank);
          block
            .split('\n')
            .forEach((line, j) => lines.push((i === 0 && j === 0 ? first : other) + line));
        });
        return lines;
      };
      // Where the range starts: at the first column of the first block that goes, or after its
      // prefix; or behind the heading's underline, at the end of its line or at the start of the
      // blank line under it, which takes all the blocks under the heading.
      const mode = below(4);
      const gone = mode < 2 ? 1 + below(blocks.length - 1) : blocks.length - 1;
      const kept = render(blocks.length - gone);
      const eol = below(4) === 0 ? '\r\n' : '\n';
      const whole = render(blocks.length);
      const body = whole.join(eol);
      /** Where line `n` of the text starts. */
      const lineAt = (n: number) =>
        whole.slice(0, n).reduce((at, text) => at + text.length + eol.length, 0);
      // The first block that goes starts on the line after the blank one that follows what stays.
      const underline = top.flatMap((block) => [...block.split('\n'), '']).length + 1;
      const from =
        mode < 2
          ? lineAt(kept.length + 1) + (mode === 0 ? 0 : other.length)
          : mode === 2
            ? lineAt(underline + 1) - eol.length
            : lineAt(underline + 1);
      const label = `seed ${seed}: ${JSON.stringify(body)} from ${from}`;
      try {
        const { after } = deleteRange(body, from, body.length);
        written++;
        const wanted = leaves(file(kept.join(eol)));
        expect(leaves(after), `${label}: the file`).toBe(wanted);
        expect(leaves(newestView(after).text), `${label}: the newest view`).toBe(wanted);
        const accepted = applyChanges(after, accept(after, 'm2bd'));
        expect(leaves(accepted), `${label}: accepting`).toBe(wanted);
        const rejected = applyChanges(after, reject(after, 'm2bd'));
        expect(bodyText(rejected), `${label}: rejecting`).toBe(body);
      } catch (error) {
        if (error instanceof EditError && REFUSALS.includes(error.code ?? '')) {
          refused++;
          continue;
        }
        throw new Error(`${label}: ${String(error)}`, { cause: error });
      }
    }
    expect(written).toBeGreaterThan(refused);
  });
});
