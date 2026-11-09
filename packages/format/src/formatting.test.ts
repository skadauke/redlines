import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { accept, acceptAll, canReject, reject, rejectAll } from './decide.ts';
import { EditError } from './errors.ts';
import { parseFormatOps } from './format-ops.ts';
import type { FormatOp, InlineFormat } from './format-ops.ts';
import { trackedFormat, tryingEveryMark, untrackedFormat } from './formatting.ts';
import { parse } from './parse.ts';
import { fuzzCount, randomDocument, seeded } from './random-docs.ts';
import { trackedEdit } from './track.ts';
import type { TrackedEdits } from './track.ts';
import {
  REFUSALS,
  TIME,
  ada,
  bo,
  bodyOf,
  context,
  editedDocument,
  exactly,
  expectBlocksAs,
  expectEveryDecision,
  expectEveryOrderAlike,
  expectNoNewLineStarts,
  file,
  naturalOffsets,
  problemsOf,
  randomIds,
  reading,
} from './test-helpers.ts';
import type { EditContext, Person, Range, TextChange } from './types.ts';
import { newestView } from './views.ts';

const inline = (format: InlineFormat, on: boolean): FormatOp => ({ kind: 'inline', format, on });
const bold = (on: boolean) => inline('bold', on);
const italic = (on: boolean) => inline('italic', on);
const link = (url: string | null): FormatOp => ({ kind: 'link', url });
const clear: FormatOp = { kind: 'clear' };

const ctx = (...ids: string[]): EditContext => context(ada, ids.length > 0 ? ids : ['m2bd']);

/** The range of `word` in `text`: the first place it stands, or the one after `after`. */
function rangeOf(text: string, word: string, after = 0): Range {
  const from = text.indexOf(word, after);
  if (from === -1) throw new Error(`${word} is not in the text`);
  return { from, to: from + word.length };
}

/** A tracked format change, as the new file. */
function format(text: string, range: Range, op: FormatOp, c: EditContext = ctx()): string {
  return applyChanges(text, trackedFormat(text, range, op, c).changes);
}

/** The body of a file, ending in one line break: a ledger leaves a blank line in front of it. */
const body = (text: string) => `${bodyOf(text).replace(/[\r\n]+$/, '')}\n`;

const rejected = (text: string, id: string) => applyChanges(text, reject(text, id));
const accepted = (text: string, id: string) => applyChanges(text, accept(text, id));

const IN_PARAGRAPH = 'Accept or reject the changes in this paragraph first.';

const codeOf = (run: () => unknown): string | undefined => {
  try {
    run();
  } catch (error) {
    if (error instanceof EditError) return error.code ?? 'no code';
    throw error;
  }
  return 'no error';
};

describe('inline formats', () => {
  const text = 'Plain text here.\n';
  const range = { from: 6, to: 10 };

  it('adds bold as a format change', () => {
    const { changes, markIds } = trackedFormat(text, range, bold(true), ctx());
    expect(applyChanges(text, changes)).toMatch(
      /^Plain <!--fmt \w+ \+bold-->\*\*text\*\*<!--\/\w+--> here\.\n/,
    );
    expect(markIds).toHaveLength(1);
  });

  it('records who made it and when', () => {
    const after = format(text, range, bold(true));
    expect(parse(after).ledger.marks['m2bd']).toEqual({ by: 'ada', at: TIME });
    expect(parse(after).ledger.people.map((person) => person.handle)).toEqual(['ada']);
  });

  it('rejecting restores the exact bytes', () => {
    expect(rejected(format(text, range, bold(true)), 'm2bd')).toBe(text);
  });

  it('accepting leaves the formatting and no marker', () => {
    expect(accepted(format(text, range, bold(true)), 'm2bd')).toBe('Plain **text** here.\n');
  });

  it('writes * for italic, ~~ for strike and backticks for code', () => {
    const write = (name: InlineFormat) => body(format(text, range, inline(name, true)));
    expect(write('italic')).toBe('Plain <!--fmt m2bd +italic-->*text*<!--/m2bd--> here.\n');
    expect(write('strike')).toBe('Plain <!--fmt m2bd +strike-->~~text~~<!--/m2bd--> here.\n');
    expect(write('code')).toBe('Plain <!--fmt m2bd +code-->`text`<!--/m2bd--> here.\n');
    for (const name of ['italic', 'strike', 'code'] as const) {
      expect(rejected(format(text, range, inline(name, true)), 'm2bd')).toBe(text);
    }
  });

  it('removes bold as -bold, and rejecting brings it back', () => {
    const source = 'Plain **text** here.\n';
    for (const selected of [rangeOf(source, 'text'), rangeOf(source, '**text**')]) {
      const after = format(source, selected, bold(false));
      expect(body(after)).toBe('Plain <!--fmt m2bd -bold-->text<!--/m2bd--> here.\n');
      expect(rejected(after, 'm2bd')).toBe(source);
      expect(accepted(after, 'm2bd')).toBe(text);
    }
  });

  it('keeps the syntax a format was written with: rejecting never rewrites it', () => {
    for (const [source, op, written] of [
      ['Plain _text_ here.\n', italic(false), '-italic=_'],
      ['Plain __text__ here.\n', bold(false), '-bold=__'],
      ['Plain ``text`` here.\n', inline('code', false), '-code=\\x60\\x60'],
      ['Plain `` te`xt `` here.\n', inline('code', false), '-code=\\x60\\x60\\x20'],
    ] as const) {
      const after = format(source, rangeOf(source, 'te'), op);
      expect(parse(after).marks[0]?.payload, source).toBe(written);
      expect(rejected(after, 'm2bd'), source).toBe(source);
    }
  });

  it('never rewrites _ that it finds around the text', () => {
    const source = 'Plain _text_ here.\n';
    const after = format(source, rangeOf(source, 'text'), bold(true));
    expect(body(after)).toBe('Plain <!--fmt m2bd +bold-->**_text_**<!--/m2bd--> here.\n');
    expect(accepted(after, 'm2bd')).toBe('Plain **_text_** here.\n');
    expect(rejected(after, 'm2bd')).toBe(source);
  });

  it('turning off your own pending +bold takes the mark away', () => {
    const after = format(text, range, bold(true));
    const off = trackedFormat(after, rangeOf(after, 'text'), bold(false), ctx('z9z9'));
    expect(applyChanges(after, off.changes)).toBe(text);
    expect(off.markIds).toEqual([]);
  });

  it('turning on again what you turned off takes the mark away', () => {
    const source = 'Plain **text** here.\n';
    const after = format(source, rangeOf(source, 'text'), bold(false));
    expect(format(after, rangeOf(after, 'text'), bold(true), ctx('z9z9'))).toBe(source);
  });

  it('takes one operation of your own pending change back, and leaves the others', () => {
    const source = 'Plain ***text*** here.\n';
    const cleared = format(source, rangeOf(source, 'text'), clear);
    const on = trackedFormat(cleared, rangeOf(cleared, 'text'), bold(true), ctx('z9z9'));
    const after = applyChanges(cleared, on.changes);
    expect(body(after)).toBe('Plain <!--fmt m2bd -italic-->**text**<!--/m2bd--> here.\n');
    expect(on.extendedIds).toEqual(['m2bd']);
    expect(rejected(after, 'm2bd')).toBe(source);
  });

  it('takes back one segment of your own pending change, and leaves the others', () => {
    const across = 'a **one** b **two** c\n';
    const off = format(across, { from: 0, to: across.length }, clear);
    const again = format(off, rangeOf(off, 'one'), bold(true), ctx('z9z9'));
    expect(body(again)).toBe('a **one** b <!--fmt m2bd -bold-->two<!--/m2bd--> c\n');
    expect(rejected(again, 'm2bd')).toBe(across);
  });

  it('asks nothing when the text already is as asked', () => {
    const source = 'Plain **text** here.\n';
    expect(trackedFormat(source, rangeOf(source, 'text'), bold(true), ctx()).changes).toEqual([]);
    expect(trackedFormat(text, range, bold(false), ctx()).changes).toEqual([]);
    expect(trackedFormat(text, { from: 6, to: 6 }, bold(true), ctx()).changes).toEqual([]);
    expect(trackedFormat(text, { from: 5, to: 6 }, bold(true), ctx()).changes).toEqual([]);
  });

  it('turns off the whole run when part of it is selected', () => {
    const source = 'Plain **more text** here.\n';
    const after = format(source, rangeOf(source, 'text'), bold(false));
    expect(body(after)).toBe('Plain <!--fmt m2bd -bold-->more text<!--/m2bd--> here.\n');
    expect(rejected(after, 'm2bd')).toBe(source);
  });

  it('leaves the spaces at the ends of a selection outside', () => {
    const after = format(text, { from: 5, to: 11 }, bold(true));
    expect(body(after)).toBe('Plain <!--fmt m2bd +bold-->**text**<!--/m2bd--> here.\n');
  });

  it('formats what is not yet formatted, and leaves the rest', () => {
    const source = 'one **two** three\n';
    const after = format(source, { from: 0, to: source.length - 1 }, bold(true));
    expect(body(after)).toBe(
      [
        '<!--fmt m2bd +bold-->',
        '',
        '**one**<!--/m2bd--> **two** <!--fmt m2bd +bold-->**three**<!--/m2bd-->\n',
      ].join('\n'),
    );
    expect(rejected(after, 'm2bd')).toBe(source);
    expect(accepted(after, 'm2bd')).toBe('**one** **two** **three**\n');
  });

  it('formats inside a word with * and ~~, which may stand there', () => {
    const source = 'rebuilt\n';
    const after = format(source, { from: 2, to: 7 }, italic(true));
    expect(body(after)).toBe('re<!--fmt m2bd +italic-->*built*<!--/m2bd-->\n');
    expect(rejected(after, 'm2bd')).toBe(source);
  });

  it('stacks formats on the same text, and either can go first', () => {
    const first = format(text, range, bold(true));
    // Another person's change is in the way, until it is decided.
    expect(() =>
      trackedFormat(first, rangeOf(first, 'text'), italic(true), context(bo, ['n8fx'])),
    ).toThrow(IN_PARAGRAPH);
    const second = format(first, rangeOf(first, 'text'), italic(true), ctx('n8fx'));
    expect(body(second)).toBe(
      'Plain <!--fmt m2bd +bold--><!--fmt n8fx +italic-->***text***<!--/n8fx--><!--/m2bd--> here.\n',
    );
    expect(rejected(second, 'n8fx').split('\n')[0]).toBe(first.split('\n')[0]);
    expect(body(rejected(second, 'm2bd'))).toBe(
      'Plain <!--fmt n8fx +italic-->*text*<!--/n8fx--> here.\n',
    );
    expect(applyChanges(second, rejectAll(second))).toBe(text);
    expect(applyChanges(second, acceptAll(second))).toBe('Plain ***text*** here.\n');
  });

  it('does not nest a format in part of another: it cuts it at the edge', () => {
    const source = '*one two* three\n';
    const after = format(source, rangeOf(source, 'two* three'), bold(true));
    expect(body(after)).toBe(
      '*one <!--fmt m2bd +bold-->**two**<!--/m2bd-->* <!--fmt m2bd +bold-->**three**<!--/m2bd-->\n',
    );
    expect(rejected(after, 'm2bd')).toBe(source);
    expect(accepted(after, 'm2bd')).toBe('*one **two*** **three**\n');
  });

  it("refuses to change what another person's pending format change is changing", () => {
    const pending = file('Plain <!--fmt m2bd +bold-->**text**<!--/m2bd--> here.', { m2bd: 'bo' });
    const selected = rangeOf(pending, 'text');
    expect(() => trackedFormat(pending, selected, bold(false), ctx('n8fx'))).toThrow(IN_PARAGRAPH);
    expect(codeOf(() => trackedFormat(pending, selected, bold(false), ctx('n8fx')))).toBe(
      'no-legal-placement',
    );
    const removed = file('Plain <!--fmt m2bd -bold-->text<!--/m2bd--> here.', { m2bd: 'bo' });
    expect(codeOf(() => trackedFormat(removed, rangeOf(removed, 'text'), bold(true), ctx()))).toBe(
      'no-legal-placement',
    );
  });

  it('refuses a format that Markdown would read as text next to its neighbours', () => {
    // Bold right after bold would be `****` once it is accepted; `**` after a letter and before
    // punctuation opens nothing.
    for (const [source, word] of [
      ['**one**two\n', 'two'],
      ['a(b) c\n', '(b)'],
      ['one**two** three\n', 'one'],
    ] as const) {
      const c = ctx();
      expect(codeOf(() => trackedFormat(source, rangeOf(source, word), bold(true), c))).toBe(
        'no-legal-placement',
      );
    }
  });

  it('refuses a marker next to a _ that has a letter on its other side', () => {
    const source = 'snake_case\n';
    expect(codeOf(() => trackedFormat(source, rangeOf(source, 'case'), bold(true), ctx()))).toBe(
      'no-legal-placement',
    );
  });
});

describe('where the markers go (format §3)', () => {
  it('puts the opener on a line of its own at the start of a block', () => {
    const text = 'Plain text.\n';
    const after = format(text, rangeOf(text, 'Plain'), bold(true));
    expect(body(after)).toBe('<!--fmt m2bd +bold-->\n\n**Plain**<!--/m2bd--> text.\n');
    expect(rejected(after, 'm2bd')).toBe(text);
    expect(accepted(after, 'm2bd')).toBe('**Plain** text.\n');
  });

  it('removes a format at the start of a block, and brings it back', () => {
    const text = '**Plain** text.\n';
    const after = format(text, rangeOf(text, 'Plain'), bold(false));
    expect(body(after)).toBe('<!--fmt m2bd -bold-->\n\nPlain<!--/m2bd--> text.\n');
    expect(rejected(after, 'm2bd')).toBe(text);
    expect(accepted(after, 'm2bd')).toBe('Plain text.\n');
  });

  it('keeps a list item a list item, and a quote a quote', () => {
    for (const [text, expected] of [
      ['- one two\n', '- <!--fmt m2bd +bold-->\n  **one**<!--/m2bd--> two\n'],
      ['> one two\n', '> <!--fmt m2bd +bold-->\n>\n> **one**<!--/m2bd--> two\n'],
    ] as const) {
      const after = format(text, rangeOf(text, 'one'), bold(true));
      expect(body(after)).toBe(expected);
      expect(rejected(after, 'm2bd')).toBe(text);
    }
  });

  it("skips the prefix and a heading's #s when they are selected", () => {
    for (const text of ['## Title\n', '- Title\n', '1. Title\n', '- [ ] Title\n']) {
      const after = format(text, { from: 0, to: text.length }, bold(true));
      expect(rejected(after, 'm2bd'), text).toBe(text);
      expect(accepted(after, 'm2bd'), text).toBe(text.replace('Title', '**Title**'));
    }
    const closed = '## Title ##\n';
    const after = format(closed, { from: 0, to: closed.length }, bold(true));
    expect(body(after)).toBe('## <!--fmt m2bd +bold-->**Title**<!--/m2bd--> ##\n');
  });

  it('never starts a wrapped line with a marker: the line break goes in the mark', () => {
    const text = 'one two\nthree four\n';
    const after = format(text, rangeOf(text, 'three'), bold(true));
    expect(body(after)).toBe('one two<!--fmt m2bd +bold-->\n**three**<!--/m2bd--> four\n');
    expect(rejected(after, 'm2bd')).toBe(text);
    expect(accepted(after, 'm2bd')).toBe('one two\n**three** four\n');
    const off = 'one two\n**three** four\n';
    const removed = format(off, rangeOf(off, 'three'), bold(false));
    expect(body(removed)).toBe('one two<!--fmt m2bd -bold-->\nthree<!--/m2bd--> four\n');
    expect(rejected(removed, 'm2bd')).toBe(off);
  });

  it('takes no marker on a line of nothing but syntax', () => {
    for (const text of ['***\nbar\n', '*\nbar\n']) {
      expect(
        codeOf(() => trackedFormat(text, rangeOf(text, 'bar'), bold(true), ctx())),
        text,
      ).toBe('no-legal-placement');
    }
  });

  it('keeps the syntax of a hard break behind the marker', () => {
    const text = 'one two  \nthree four\n';
    const after = format(text, rangeOf(text, 'three'), bold(true));
    expect(body(after)).toBe('one two<!--fmt m2bd +bold-->  \n**three**<!--/m2bd--> four\n');
    expect(rejected(after, 'm2bd')).toBe(text);
  });

  it('goes on across a wrapped line, and stays one mark', () => {
    const text = 'one two\nthree four\n';
    const after = format(text, rangeOf(text, 'two\nthree'), bold(true));
    expect(body(after)).toBe('one <!--fmt m2bd +bold-->**two\nthree**<!--/m2bd--> four\n');
    expect(rejected(after, 'm2bd')).toBe(text);
  });

  it('widens over what takes no marker', () => {
    const text = 'see &eacute; now\n';
    const after = format(text, rangeOf(text, 'ea'), bold(true));
    expect(body(after)).toBe('see <!--fmt m2bd +bold-->**&eacute;**<!--/m2bd--> now\n');
    expect(rejected(after, 'm2bd')).toBe(text);
    const image = 'a ![alt](x.png) b\n';
    const over = format(image, rangeOf(image, 'lt'), bold(true));
    expect(body(over)).toBe('a <!--fmt m2bd +bold-->**![alt](x.png)**<!--/m2bd--> b\n');
    expect(rejected(over, 'm2bd')).toBe(image);
  });

  it('formats inside the text of a link, and around a whole one', () => {
    const text = 'a [one two](https://x.example) b\n';
    const inside = format(text, rangeOf(text, 'two'), bold(true));
    expect(body(inside)).toBe(
      'a [one <!--fmt m2bd +bold-->**two**<!--/m2bd-->](https://x.example) b\n',
    );
    expect(rejected(inside, 'm2bd')).toBe(text);
    const whole = format(text, rangeOf(text, 'one two'), bold(true));
    expect(body(whole)).toBe(
      'a <!--fmt m2bd +bold-->**[one two](https://x.example)**<!--/m2bd--> b\n',
    );
    expect(rejected(whole, 'm2bd')).toBe(text);
    // A selection that goes on past the link is cut at its end.
    const over = format(text, rangeOf(text, 'two](https://x.example) b'), bold(true));
    expect(accepted(over, 'm2bd')).toBe('a [one **two**](https://x.example) **b**\n');
    expect(rejected(over, 'm2bd')).toBe(text);
  });

  it('reads what follows a link as text, not as the end of its address', () => {
    const text = '[a](https://x.example)**b** c\n';
    const after = format(text, rangeOf(text, 'c'), bold(true));
    expect(accepted(after, 'm2bd')).toBe('[a](https://x.example)**b** **c**\n');
    // Taken away, a marker in front of `**` would let it open what it did not open before.
    const odd = 'one [b](https://x.example)\n\nb**c*\n';
    expect(
      codeOf(() => trackedFormat(odd, rangeOf(odd, 'b', odd.indexOf('\n\n')), link('d'), ctx())),
    ).toBe('no-legal-placement');
  });

  it('formats each cell of a table by itself', () => {
    const text = '| a b | c d |\n| --- | --- |\n| e f | g h |\n';
    const after = format(text, rangeOf(text, 'b | c'), bold(true));
    expect(accepted(after, 'm2bd').split('\n')[0]).toBe('| a **b** | **c** d |');
    expect(rejected(after, 'm2bd')).toBe(text);
    const across = format(
      text,
      { from: 0, to: text.length },
      bold(true),
      ctx('m2bd', 'n8fx', 'g3rp'),
    );
    expect(applyChanges(across, acceptAll(across))).toBe(
      '| **a b** | **c d** |\n| --- | --- |\n| **e f** | **g h** |\n',
    );
    expect(applyChanges(across, rejectAll(across))).toBe(text);
  });

  it('knows a table in a CRLF file', () => {
    const text = '| a | b |\r\n| - | - |\r\n';
    const after = format(text, rangeOf(text, 'a | b'), bold(true));
    expect(accepted(after, 'm2bd').split('\r\n')[0]).toBe('| **a** | **b** |');
    expect(rejected(after, 'm2bd')).toBe(text);
  });

  it('refuses a table row without a leading |, which a marker needs (format §3.2)', () => {
    const text = 'a | b\n--- | ---\nc | d\n';
    expect(codeOf(() => trackedFormat(text, rangeOf(text, 'c'), bold(true), ctx()))).toBe(
      'no-legal-placement',
    );
  });

  it('keeps a CRLF file CRLF, and offsets right next to emoji', () => {
    const text = 'One 😀 two\r\n\r\nThree 😀\r\n';
    const after = format(text, { from: 4, to: 10 }, bold(true));
    expect(body(after)).toBe('One <!--fmt m2bd +bold-->**😀 two**<!--/m2bd-->\r\n\r\nThree 😀\n');
    expect(after).not.toMatch(/[^\r]\n/);
    expect(rejected(after, 'm2bd')).toBe(text);
    const start = format(text, rangeOf(text, 'One'), bold(true));
    expect(body(start)).toBe(
      '<!--fmt m2bd +bold-->\r\n\r\n**One**<!--/m2bd--> 😀 two\r\n\r\nThree 😀\n',
    );
    expect(rejected(start, 'm2bd')).toBe(text);
  });

  it('formats no text in an HTML block or an indented code block', () => {
    for (const [text, word] of [
      ['<details>\n<summary>Title</summary>\nSome text here.\n</details>\n', 'text'],
      ['<div>\nSome text here.\n</div>\n', 'text'],
      ['<b>\nSome text here.\n', 'text'],
      ['One.\n\n    code here\n', 'here'],
      ['- one\n\n      code here\n', 'here'],
    ] as const) {
      expect(
        codeOf(() => trackedFormat(text, rangeOf(text, word), bold(true), ctx())),
        text,
      ).toBe('inside-code');
      expect(
        codeOf(() => untrackedFormat(text, rangeOf(text, word), bold(true))),
        text,
      ).toBe('inside-code');
    }
    // Text after a blank line is Markdown again, and so is text indented as the text of an item.
    for (const text of ['<div>\n\nSome text here.\n\n</div>\n', '- one\n\n  Some text here.\n']) {
      const after = format(text, rangeOf(text, 'text'), bold(true));
      expect(accepted(after, 'm2bd'), text).toBe(text.replace('text', '**text**'));
    }
    // A selection goes on around them.
    const around = 'One.\n\n    code\n\nTwo.\n';
    const after = format(
      around,
      { from: 0, to: around.length },
      bold(true),
      ctx('m2bd', 'n8fx', 'g3rp'),
    );
    expect(applyChanges(after, acceptAll(after))).toBe('**One.**\n\n    code\n\n**Two.**\n');
    // A tag in a line of text is no block.
    const line = 'A <b>tag</b> word.\n';
    expect(accepted(format(line, rangeOf(line, 'word'), bold(true)), 'm2bd')).toBe(
      'A <b>tag</b> **word**.\n',
    );
  });

  it('reads one tilde as strikethrough too, as GFM does', () => {
    const text = 'a ~b~ c\n';
    const off = format(text, rangeOf(text, 'b'), inline('strike', false));
    expect(body(off)).toBe('a <!--fmt m2bd -strike=~-->b<!--/m2bd--> c\n');
    expect(rejected(off, 'm2bd')).toBe(text);
    expect(trackedFormat(text, rangeOf(text, 'b'), inline('strike', true), ctx()).changes).toEqual(
      [],
    );
    const long = 'a ~~~b~~~ c\n';
    expect(trackedFormat(long, rangeOf(long, 'b'), inline('strike', false), ctx()).changes).toEqual(
      [],
    );
  });

  it('takes no change in front matter', () => {
    const text = '---\ntitle: x\n---\n\nBody text.\n';
    expect(codeOf(() => trackedFormat(text, rangeOf(text, 'title'), bold(true), ctx()))).toBe(
      'front-matter',
    );
    const after = format(text, { from: 0, to: text.length }, bold(true));
    expect(accepted(after, 'm2bd')).toBe('---\ntitle: x\n---\n\n**Body text.**\n');
    expect(rejected(after, 'm2bd')).toBe(text);
  });
});

describe('links', () => {
  const text = 'See the guide now.\n';
  const old = 'See the [guide](https://old.example) now.\n';

  it('records a link added, changed and removed', () => {
    const added = format(text, rangeOf(text, 'guide'), link('https://new.example'));
    expect(body(added)).toBe(
      'See the <!--fmt m2bd +link-->[guide](https://new.example)<!--/m2bd--> now.\n',
    );
    expect(rejected(added, 'm2bd')).toBe(text);
    expect(accepted(added, 'm2bd')).toBe('See the [guide](https://new.example) now.\n');

    const changed = format(old, rangeOf(old, 'guide'), link('https://new.example'));
    expect(body(changed)).toBe(
      'See the <!--fmt m2bd link=https://old.example-->[guide](https://new.example)<!--/m2bd--> now.\n',
    );
    expect(rejected(changed, 'm2bd')).toBe(old);
    expect(accepted(changed, 'm2bd')).toBe('See the [guide](https://new.example) now.\n');

    const removed = format(old, rangeOf(old, 'guide'), link(null));
    expect(body(removed)).toBe(
      'See the <!--fmt m2bd -link=https://old.example-->guide<!--/m2bd--> now.\n',
    );
    expect(rejected(removed, 'm2bd')).toBe(old);
    expect(accepted(removed, 'm2bd')).toBe(text);
  });

  it('keeps a title and an address in angle brackets exactly as they were', () => {
    for (const source of [
      'A [b](https://x.example/a--b "A title") c.\n',
      'A [b](<a b> "T") c.\n',
      "A [b](/c 'it|is') c.\n",
    ]) {
      const removed = format(source, rangeOf(source, 'b'), link(null));
      expect(body(removed), source).toMatch(/^A <!--fmt m2bd -link=\S+-->b<!--\/m2bd--> c\.\n$/);
      expect(rejected(removed, 'm2bd'), source).toBe(source);
      const changed = format(source, rangeOf(source, 'b'), link('https://new.example'));
      expect(rejected(changed, 'm2bd'), source).toBe(source);
    }
    const titled = 'A [b](https://x.example "T") c.\n';
    const changed = format(titled, rangeOf(titled, 'b'), link('https://new.example'));
    expect(accepted(changed, 'm2bd')).toBe('A [b](https://new.example "T") c.\n');
  });

  it('writes an address with a space in angle brackets', () => {
    const after = format(text, rangeOf(text, 'guide'), link('a b.md'));
    expect(accepted(after, 'm2bd')).toBe('See the [guide](<a b.md>) now.\n');
    expect(rejected(after, 'm2bd')).toBe(text);
  });

  it('refuses an address that would be read as markup', () => {
    for (const url of ['<!--x', 'a-->b', 'a\nb']) {
      expect(codeOf(() => trackedFormat(text, rangeOf(text, 'guide'), link(url), ctx()))).toBe(
        'markup',
      );
    }
  });

  it('changes the whole link when part of its text is selected', () => {
    const source = 'See the [good guide](https://old.example) now.\n';
    const after = format(source, rangeOf(source, 'guide'), link(null));
    expect(body(after)).toBe(
      'See the <!--fmt m2bd -link=https://old.example-->good guide<!--/m2bd--> now.\n',
    );
    expect(rejected(after, 'm2bd')).toBe(source);
  });

  it('edits your own pending link in place, and ends it when nothing is left to record', () => {
    const added = format(text, rangeOf(text, 'guide'), link('https://a.example'));
    const moved = format(added, rangeOf(added, 'guide'), link('https://b.example'), ctx('z9z9'));
    expect(body(moved)).toBe(
      'See the <!--fmt m2bd +link-->[guide](https://b.example)<!--/m2bd--> now.\n',
    );
    expect(format(moved, rangeOf(moved, 'guide'), link(null), ctx('z9z9'))).toBe(text);

    const changed = format(old, rangeOf(old, 'guide'), link('https://b.example'));
    expect(
      format(changed, rangeOf(changed, 'guide'), link('https://old.example'), ctx('z9z9')),
    ).toBe(old);
    const gone = format(changed, rangeOf(changed, 'guide'), link(null), ctx('z9z9'));
    expect(body(gone)).toBe(
      'See the <!--fmt m2bd -link=https://old.example-->guide<!--/m2bd--> now.\n',
    );
    expect(rejected(gone, 'm2bd')).toBe(old);

    const removed = format(old, rangeOf(old, 'guide'), link(null));
    expect(
      format(removed, rangeOf(removed, 'guide'), link('https://old.example'), ctx('z9z9')),
    ).toBe(old);
    const other = format(
      removed,
      rangeOf(removed, 'guide'),
      link('https://c.example'),
      ctx('z9z9'),
    );
    expect(body(other)).toBe(
      'See the <!--fmt m2bd link=https://old.example-->[guide](https://c.example)<!--/m2bd--> now.\n',
    );
    expect(rejected(other, 'm2bd')).toBe(old);
  });

  it('asks nothing when the link already goes there, or there is no link to remove', () => {
    expect(
      trackedFormat(old, rangeOf(old, 'guide'), link('https://old.example'), ctx()).changes,
    ).toEqual([]);
    expect(trackedFormat(text, rangeOf(text, 'guide'), link(null), ctx()).changes).toEqual([]);
  });

  it('refuses a reference, which has no address of its own and is a link already', () => {
    for (const source of [
      'See [guide][g] now.\n\n[g]: https://x.example\n',
      'See [guide] now.\n\n[guide]: https://x.example\n',
      'See [guide][] now.\n\n[guide]: https://x.example\n',
      'See guide[^1] now.\n\n[^1]: A note.\n',
    ]) {
      for (const url of [null, 'https://y.example']) {
        const selected = { from: 4, to: source.indexOf(' now') };
        expect(
          codeOf(() => trackedFormat(source, selected, link(url), ctx())),
          source,
        ).toBe('no-legal-placement');
      }
    }
    // Bold goes around it.
    const shortcut = 'See [guide] now.\n\n[guide]: https://x.example\n';
    const after = format(shortcut, rangeOf(shortcut, '[guide]'), bold(true));
    expect(accepted(after, 'm2bd')).toBe('See **[guide]** now.\n\n[guide]: https://x.example\n');
  });

  it('does not put a link around a bracket that is text', () => {
    const text = 'a [b c\n';
    expect(codeOf(() => trackedFormat(text, { from: 0, to: 6 }, link('d'), ctx()))).toBe(
      'no-legal-placement',
    );
    // Parentheses after brackets are no link when no address can be in them.
    const odd = 'a [b](c d) e\n';
    expect(codeOf(() => trackedFormat(odd, rangeOf(odd, 'b](c'), bold(true), ctx()))).toBe(
      'no-legal-placement',
    );
    const after = format(odd, rangeOf(odd, 'e'), bold(true));
    expect(accepted(after, 'm2bd')).toBe('a [b](c d) **e**\n');
  });

  it('escapes a | in an address in a table cell, which would end the cell', () => {
    const text = '| a | b |\n| - | - |\n| c | d |\n';
    const after = format(text, rangeOf(text, 'c'), link('x|y'));
    expect(accepted(after, 'm2bd').split('\n')[2]).toBe('| [c](x\\|y) | d |');
    expect(rejected(after, 'm2bd')).toBe(text);
    const direct = applyChanges(text, untrackedFormat(text, rangeOf(text, 'c'), link('x|y')));
    expect(direct.split('\n')[2]).toBe('| [c](x\\|y) | d |');
    const plain = 'A b c.\n';
    expect(accepted(format(plain, rangeOf(plain, 'b'), link('x|y')), 'm2bd')).toBe(
      'A [b](x|y) c.\n',
    );
  });
});

describe('clearing', () => {
  it('clears several formats as one mark', () => {
    const text = 'Plain ***text*** here.\n';
    const { changes, markIds } = trackedFormat(text, rangeOf(text, 'text'), clear, ctx());
    const after = applyChanges(text, changes);
    expect(markIds).toEqual(['m2bd']);
    expect(body(after)).toBe('Plain <!--fmt m2bd -bold -italic-->text<!--/m2bd--> here.\n');
    expect(rejected(after, 'm2bd')).toBe(text);
    expect(accepted(after, 'm2bd')).toBe('Plain text here.\n');
  });

  it('keeps the order of the syntax it clears', () => {
    const text = 'Plain _**text**_ and ~~**more**~~.\n';
    const after = format(text, { from: 6, to: text.length - 2 }, clear);
    expect(body(after)).toBe(
      'Plain <!--fmt m2bd -italic=_ -bold-->text<!--/m2bd--> and <!--fmt m2bd -strike -bold-->more<!--/m2bd-->.\n',
    );
    expect(rejected(after, 'm2bd')).toBe(text);
  });

  it('is one mark over separate runs, and two in a group where one is inside another', () => {
    const text = '**a** and `b`.\n';
    const after = format(text, { from: 0, to: text.length }, clear);
    expect(accepted(after, 'm2bd')).toBe('a and b.\n');
    expect(rejected(after, 'm2bd')).toBe(text);
    const nested = 'x **a *b* c** y\n';
    const { changes, markIds } = trackedFormat(
      nested,
      rangeOf(nested, 'a *b* c'),
      clear,
      ctx('m2bd', 'n8fx', 'g3rp'),
    );
    const both = applyChanges(nested, changes);
    expect(markIds).toEqual(['m2bd', 'n8fx']);
    expect(body(both)).toBe(
      'x <!--fmt m2bd -bold-->a <!--fmt n8fx -italic-->b<!--/n8fx--> c<!--/m2bd--> y\n',
    );
    expect(parse(both).ledger.marks['m2bd']?.group).toBe('g3rp');
    expect(parse(both).ledger.marks['n8fx']?.group).toBe('g3rp');
    expect(applyChanges(both, rejectAll(both))).toBe(nested);
    expect(applyChanges(both, acceptAll(both))).toBe('x a b c y\n');
  });

  it('leaves code that holds Markdown as it is: clearing it would change the words', () => {
    const text = 'x **a** `*b*` y\n';
    const after = format(text, { from: 0, to: text.length }, clear);
    expect(accepted(after, 'm2bd')).toBe('x a `*b*` y\n');
  });
});

describe('across blocks', () => {
  it('splits a selection across paragraphs into one mark per block, in one group', () => {
    const text = 'One two.\n\nThree four.\n\n- Five six.\n';
    const { changes, markIds } = trackedFormat(
      text,
      rangeOf(text, 'two.\n\nThree four.\n\n- Five'),
      bold(true),
      ctx('m2bd', 'n8fx', 'p7qd', 'g3rp'),
    );
    const after = applyChanges(text, changes);
    expect(markIds).toEqual(['m2bd', 'n8fx', 'p7qd']);
    expect(body(after)).toBe(
      [
        'One <!--fmt m2bd +bold-->**two.**<!--/m2bd-->',
        '',
        '<!--fmt n8fx +bold-->',
        '',
        '**Three four.**<!--/n8fx-->',
        '',
        '- <!--fmt p7qd +bold-->',
        '  **Five**<!--/p7qd--> six.',
        '',
      ].join('\n'),
    );
    const { marks } = parse(after).ledger;
    expect(marks).toEqual({
      m2bd: { by: 'ada', at: TIME, group: 'g3rp' },
      n8fx: { by: 'ada', at: TIME, group: 'g3rp' },
      p7qd: { by: 'ada', at: TIME, group: 'g3rp' },
    });
    expect(applyChanges(after, rejectAll(after))).toBe(text);
    expect(applyChanges(after, acceptAll(after))).toBe(
      'One **two.**\n\n**Three four.**\n\n- **Five** six.\n',
    );
  });

  it('uses the group of the context, and has none for one mark', () => {
    const text = 'One.\n\nTwo.\n';
    const grouped = format(
      text,
      { from: 0, to: 9 },
      bold(true),
      context(ada, ['m2bd', 'n8fx'], { group: 'g3rp' }),
    );
    expect(parse(grouped).ledger.marks['n8fx']?.group).toBe('g3rp');
    expect(parse(format(text, { from: 0, to: 3 }, bold(true))).ledger.marks['m2bd']?.group).toBe(
      undefined,
    );
  });

  it('skips a code block in the middle of a selection', () => {
    const text = 'One.\n\n```\ncode\n```\n\nTwo.\n';
    const after = format(
      text,
      { from: 0, to: text.length },
      bold(true),
      ctx('m2bd', 'n8fx', 'g3rp'),
    );
    expect(applyChanges(after, acceptAll(after))).toBe('**One.**\n\n```\ncode\n```\n\n**Two.**\n');
    expect(applyChanges(after, rejectAll(after))).toBe(text);
  });

  it('cuts at a deletion that holds a block break: rejecting it would part the emphasis', () => {
    const text = file('Alpha <!--del k3x9 two.\\n\\nGamma -->five six.', { k3x9: 'ada' });
    const after = format(text, rangeOf(text, 'five', 0), bold(true));
    expect(body(after)).toContain('<!--fmt m2bd +bold-->**five**<!--/m2bd-->');
    const whole = format(text, { from: 0, to: rangeOf(text, 'six.').to }, bold(true));
    expect(body(whole).split('\n')[2]).toBe(
      '**Alpha**<!--/m2bd--> <!--del k3x9 two.\\n\\nGamma --><!--fmt m2bd +bold-->**five six.**<!--/m2bd-->',
    );
    expect(body(rejected(whole, 'm2bd'))).toBe(body(text));
  });
});

describe('next to pending changes', () => {
  const threads = [
    '  c8d2:',
    '    by: bo',
    '    at: 2026-10-13T22:40Z',
    '    text: |-',
    '      A note.',
  ];

  it("nests around another author's insertion: no, it is refused until that is decided", () => {
    for (const [written, word] of [
      ['Hello<!--ins k3x9-->, big<!--/k3x9--> world here.', 'Hello'],
      ['Hello <!--del k3x9 big -->world here.', 'world'],
      ['Hello <!--sub k3x9 big-->small<!--/k3x9--> world here.', 'world'],
      ['Hello <!--fmt k3x9 +bold-->**big**<!--/k3x9--> world here.', 'world'],
      // Rejecting the split makes one paragraph of the two.
      ['Hello big.<!--split k3x9-->\n\nWorld here.', 'World'],
    ] as const) {
      const text = file(written, { k3x9: 'bo' });
      expect(() => trackedFormat(text, rangeOf(text, word), bold(true), ctx()), text).toThrow(
        IN_PARAGRAPH,
      );
      expect(codeOf(() => trackedFormat(text, rangeOf(text, word), bold(true), ctx()))).toBe(
        'no-legal-placement',
      );
      expect(() => untrackedFormat(text, rangeOf(text, word), bold(true), { author: ada })).toThrow(
        IN_PARAGRAPH,
      );
    }
  });

  it('formats next to comments, highlights, and changes in other paragraphs', () => {
    const text = file(
      'One <!--cmt c8d2-->two<!--/c8d2--> <!--hl h4kz-->three<!--/hl--> four.\n\nFive <!--ins k3x9-->six<!--/k3x9-->.',
      { h4kz: 'bo', k3x9: 'bo' },
      threads,
    ).replace('<!--/hl-->', '<!--/h4kz-->');
    const after = format(text, rangeOf(text, 'four'), bold(true));
    expect(body(after).split('\n')[0]).toBe(
      'One <!--cmt c8d2-->two<!--/c8d2--> <!--hl h4kz-->three<!--/h4kz--> <!--fmt m2bd +bold-->**four**<!--/m2bd-->.',
    );
    expect(expectEveryDecision('comments', text, after, ['m2bd'])).toBeGreaterThan(0);
  });

  it('writes syntax as typed text into your own insertion, whatever else the paragraph has', () => {
    const text = file('Plain <!--ins k3x9-->new words<!--/k3x9--> and <!--del d3x9 old -->here.', {
      k3x9: 'ada',
      d3x9: 'bo',
    });
    const { changes, markIds, extendedIds } = trackedFormat(
      text,
      rangeOf(text, 'new'),
      bold(true),
      ctx(),
    );
    const after = applyChanges(text, changes);
    expect(body(after)).toBe(
      'Plain <!--ins k3x9-->**new** words<!--/k3x9--> and <!--del d3x9 old -->here.\n',
    );
    expect(markIds).toEqual([]);
    expect(extendedIds).toEqual(['k3x9']);
    // It changes the insertion, and turning it off changes it back.
    expect(body(format(after, rangeOf(after, 'new'), bold(false)))).toBe(body(text));
    // So does your own substitution.
    const replaced = file('Plain <!--sub p7qd old-->new<!--/p7qd--> here.', { p7qd: 'ada' });
    expect(body(format(replaced, rangeOf(replaced, 'new'), bold(true)))).toBe(
      'Plain <!--sub p7qd old-->**new**<!--/p7qd--> here.\n',
    );
  });

  it('wraps around your own insertion when text stands on both sides of it', () => {
    const text = file('Hello<!--ins k3x9-->, big<!--/k3x9--> world here.', { k3x9: 'ada' });
    const whole = { from: 0, to: rangeOf(text, 'world').to };
    const after = format(text, whole, bold(true));
    expect(body(after)).toBe(
      '<!--fmt m2bd +bold-->\n\n**Hello<!--ins k3x9-->, big<!--/k3x9--> world**<!--/m2bd--> here.\n',
    );
    expect(body(rejected(after, 'k3x9'))).toBe(
      '<!--fmt m2bd +bold-->\n\n**Hello world**<!--/m2bd--> here.\n',
    );
    expect(body(applyChanges(after, acceptAll(after)))).toBe('**Hello, big world** here.\n');
    expect(body(applyChanges(after, rejectAll(after)))).toBe('Hello world here.\n');
    expect(expectEveryDecision('wrap', text, after, ['m2bd'])).toBeGreaterThan(0);
  });

  it('writes the part in your own insertion as typed text, and marks the rest', () => {
    const text = file('Plain <!--ins k3x9-->new <!--/k3x9-->text here.', { k3x9: 'ada' });
    const covered = { from: rangeOf(text, 'new').from, to: rangeOf(text, 'text').to };
    const after = format(text, covered, bold(true));
    expect(body(after)).toBe(
      'Plain <!--ins k3x9-->**new** <!--/k3x9--><!--fmt m2bd +bold-->**text**<!--/m2bd--> here.\n',
    );
    expect(body(rejected(after, 'k3x9'))).toBe(
      'Plain <!--fmt m2bd +bold-->**text**<!--/m2bd--> here.\n',
    );
    expect(expectEveryDecision('edge', text, after, ['m2bd'], { inPlace: true })).toBeGreaterThan(
      0,
    );
    const last = file('Hello world<!--ins k3x9--> again<!--/k3x9-->.', { k3x9: 'ada' });
    const end = format(
      last,
      { from: rangeOf(last, 'world').from, to: rangeOf(last, 'again').to },
      bold(true),
    );
    expect(body(applyChanges(end, acceptAll(end)))).toBe('Hello **world** **again**.\n');
    expect(body(applyChanges(end, rejectAll(end)))).toBe('Hello world.\n');
    const out = file('Plain <!--ins k3x9-->new thing<!--/k3x9--> here.', { k3x9: 'ada' });
    const cut = format(out, rangeOf(out, 'thing<!--/k3x9--> here'), bold(true));
    expect(body(cut)).toBe(
      'Plain <!--ins k3x9-->new **thing**<!--/k3x9--> <!--fmt m2bd +bold-->**here**<!--/m2bd-->.\n',
    );
  });

  it('refuses what a decision of your own changes would leave as stray syntax', () => {
    for (const [written, marks, selected, op] of [
      // Accepting all of it would leave `**w****, al**`.
      ['k<!--ins k3x9--> new<!--/k3x9-->, alpha', { k3x9: 'ada' }, 'w<!--/k3x9-->, al', bold(true)],
      // Accepting the deletion would leave `**a****b**`.
      ['**a**<!--del d3x9  x-->b c', { d3x9: 'ada' }, 'b c', bold(true)],
      // A colon deleted and a space inserted: accepting one and rejecting the other leaves
      // `it**(page 4)**`.
      [
        'Read it<!--del c3x9 :--><!--ins k3x9--> <!--/k3x9-->(page 4) today.',
        { c3x9: 'ada', k3x9: 'ada' },
        '(page 4)',
        bold(true),
      ],
      // A star that a deletion far off lets pair with the new one.
      [
        'Prices*<!--del d3x9 s--> may vary, see the a(b) table.',
        { d3x9: 'ada' },
        'abl',
        italic(true),
      ],
      // Rejecting the insertion and its break makes `_gamma_`, which `**amma_**` would cross.
      [
        'alpha<!--del d3x9  _g--><!--ins k3x9-->new<!--split p7qd-->\n\nmore <!--/k3x9-->amma_ rest',
        { d3x9: 'ada', k3x9: 'ada', p7qd: 'ada' },
        'amma_',
        bold(true),
      ],
      // Accepting your own link would leave `~~f~~~~[oo](u)~~`.
      [
        '> 42 <!--ins r9xz-->f<!--fmt khcc +link-->[oo](u)<!--/khcc--> x<!--/r9xz--> end',
        { r9xz: 'ada', khcc: 'ada' },
        'f<!--fmt khcc +link-->[oo](u)',
        inline('strike', true),
      ],
    ] as const) {
      const text = file(written, marks);
      const c = ctx();
      expect(
        codeOf(() => trackedFormat(text, rangeOf(text, selected), op, c)),
        written,
      ).toBe('no-legal-placement');
    }
  });

  it('tries every order of your own changes in the paragraph', () => {
    const text = file(
      'Some **<!--del d3x9 big--><!--del g3rp  -->deal** text, <!--ins k3x9-->new <!--/k3x9-->here.',
      { d3x9: 'ada', g3rp: 'ada', k3x9: 'ada' },
    );
    for (const [word, op] of [
      ['text', italic(true)],
      ['here', bold(true)],
    ] as const) {
      const after = format(text, rangeOf(text, word), op);
      expect(parse(after).marks).toHaveLength(4);
      // Three marks of Ada's and the new one: 81 states, in every order of reaching them.
      expect(expectEveryDecision(word, text, after, ['m2bd'])).toBe(81);
    }
    // Turning the bold off around a deletion that holds its space is refused.
    expect(codeOf(() => format(text, rangeOf(text, 'deal'), bold(false)))).toBe(
      'no-legal-placement',
    );
  });

  it('tries the whole list, table or quote that the paragraph is in', () => {
    // Out of their lists, these lines would be indented code.
    for (const written of [
      '- top item\n    - nested item here\n',
      '1. top item\n    1. nested item here\n',
      '- [ ] task\n    - [ ] sub task here\n',
      '1. item\n\n    more text here.\n',
      '- item\n\n    more text here.\n',
      '- top\n    - mid\n        - deep item here\n',
      '> - top\n>     - nested item here\n',
    ]) {
      const here = rangeOf(written, 'here');
      const after = format(written, here, bold(true), ctx());
      expect(body(after), written).toBe(
        written.replace('here', '<!--fmt m2bd +bold-->**here**<!--/m2bd-->'),
      );
      expect(rejected(after, 'm2bd')).toBe(written);
      expect(
        applyChanges(written, untrackedFormat(written, here, bold(true), { author: ada })),
      ).toBe(written.replace('here', '**here**'));
    }
    // With the opener on its own line in the first item, the nested item is still an item.
    const nested = '- top item here\n    - nested *item*\n';
    const top = format(nested, rangeOf(nested, 'top item here'), bold(true), ctx());
    expect(body(top)).toBe(
      '- <!--fmt m2bd +bold-->\n  **top item here**<!--/m2bd-->\n    - nested *item*\n',
    );
    expect(reading(top)).toEqual(reading(nested));
    // Out of its table, a row has no cells, and the | of the old text would be no wall.
    const table = file('| a | b |\n| - | - |\n| k f<!--sub d3x9 \\|--> new<!--/d3x9--> x | y |', {
      d3x9: 'ada',
    });
    const cell = { from: table.indexOf('k f'), to: table.indexOf(' x |') + 2 };
    expect(() => trackedFormat(table, cell, italic(true), ctx())).toThrow(/stray syntax/);
    // Another person's change in another row is tried with the new mark.
    const rows = file('| a<!--ins k3x9--> z<!--/k3x9--> | b |\n| - | - |\n| one | two |', {
      k3x9: 'bo',
    });
    const after = format(rows, rangeOf(rows, 'one'), bold(true));
    expect(expectEveryDecision('rows', rows, after, ['m2bd'])).toBe(9);
  });

  it('refuses to format a line that defines a link or a footnote', () => {
    const DEFINES = 'This line defines a link.';
    for (const [written, word] of [
      ['See [r] here.\n\n[r]: https://r.example\n', '[r]: https://r.example'],
      ['See [r] here.\n\n[r]: https://r.example\n', 'https://r.example'],
      ['See [r] here.\n\n[r]: https://r.example "Title"\n', 'Title'],
      ['See [r] here.\n\n[r]:\nhttps://r.example\n', 'https://r.example'],
      ['See [r] here.\n\n[r]: <https://r.example>\n', '[r]:'],
      ['A note.[^1]\n\n[^1]: The footnote.\n', 'footnote'],
      ['See the [guide][g] here.\n\nMore text.\n\n[g]: https://g.example\n', 'See'],
    ] as const) {
      const selected =
        word === 'See'
          ? { from: 0, to: written.length }
          : rangeOf(written, word, written.indexOf(']:') - 3);
      expect(() => trackedFormat(written, selected, bold(true), ctx()), written).toThrow(DEFINES);
      expect(() => untrackedFormat(written, selected, bold(true), { author: ada })).toThrow(
        DEFINES,
      );
    }
    // The rest of the file is formatted as before, and a link by a definition still reads as one.
    const text = 'See the [guide][g] here.\n\nMore text.\n\n[g]: https://g.example\n';
    expect(body(format(text, rangeOf(text, 'More'), bold(true)))).toBe(
      'See the [guide][g] here.\n\n<!--fmt m2bd +bold-->\n\n**More**<!--/m2bd--> text.\n\n[g]: https://g.example\n',
    );
    expect(() => format(text, rangeOf(text, 'the [guide][g]'), bold(true))).not.toThrow();
  });

  it('refuses a line that is a definition once the pending changes in it are rejected', () => {
    const text = file('See [r] here.\n\n<!--del k3x9 [r]: -->https://r.example', { k3x9: 'ada' });
    expect(() => format(text, rangeOf(text, 'https'), italic(true))).toThrow(
      'This line defines a link.',
    );
  });

  it('formats what CommonMark reads as text, though it looks like a definition', () => {
    for (const [written, word] of [
      // A destination with a space in it is no destination, and no title follows.
      ['[Note]: this is important for everyone.\n', 'important'],
      // The line under a definition is a paragraph of its own, when it is no title.
      ['[r]: https://r.example\nMore text here.\n', 'More'],
      ['[r]: https://r.example "Title"\nMore text here.\n', 'More'],
    ] as const) {
      const selected = rangeOf(written, word);
      expect(body(format(written, selected, bold(true))), written).toContain(`**${word}**`);
      expect(
        applyChanges(written, untrackedFormat(written, selected, bold(true), { author: ada })),
      ).toContain(`**${word}**`);
    }
    // A title on the line under the address is the definition's.
    const titled = '[r]: https://r.example\n"Title"\n';
    expect(() => format(titled, rangeOf(titled, 'Title'), bold(true))).toThrow(
      'This line defines a link.',
    );
  });

  it('says so when too many pending changes stand in the paragraph to try them all', () => {
    const text = file(
      'one <!--del k3x9 v--><!--del n8fx w--><!--del p7qd x--><!--del d3x9 y--><!--del g3rp z--><!--del h4kz q-->word here.',
      { k3x9: 'ada', n8fx: 'ada', p7qd: 'ada', d3x9: 'ada', g3rp: 'ada', h4kz: 'ada' },
    );
    const selected = rangeOf(text, 'word');
    expect(() => trackedFormat(text, selected, bold(true), ctx('m2bd'))).toThrow(
      'Accept or reject some of the changes in this paragraph first.',
    );
    // In a list, the list is what is tried: the first words of five other items deleted, which
    // leave another word to start each item, are too many to try with the new mark.
    const marks = { k3x9: 'ada', n8fx: 'ada', p7qd: 'ada', d3x9: 'ada', g3rp: 'ada' };
    const list = file(
      '- <!--del k3x9 v -->\n  one\n- <!--del n8fx w -->\n  two\n- <!--del p7qd x -->\n  three\n- <!--del d3x9 y -->\n  four\n- <!--del g3rp z -->\n  five\n- six word\n',
      marks,
    );
    expect(() => trackedFormat(list, rangeOf(list, 'word'), bold(true), ctx('m2bd'))).toThrow(
      'Accept or reject some of the changes in this list first.',
    );
    // Words deleted further in are apart from the change, and are not tried (format §2.6).
    const apart = file(
      '- one <!--del k3x9 v-->\n- two <!--del n8fx w-->\n- three <!--del p7qd x-->\n- four <!--del d3x9 y-->\n- five <!--del g3rp z-->\n- six word\n',
      marks,
    );
    expect(() =>
      trackedFormat(apart, rangeOf(apart, 'word'), bold(true), ctx('m2bd')),
    ).not.toThrow();
  });

  it('does not count the definitions of the file as part of the paragraph it tries', () => {
    const definitions = Array.from(
      { length: 60 },
      (_, i) => `[d${i}]: https://example.com/a/long/address/for/definition/number/${i}`,
    ).join('\n');
    const text = file(
      `See [d1] and a few <!--ins k3x9-->typo<!--/k3x9--> fixes <!--ins n8fx-->in<!--/n8fx--> this <!--ins p7qd-->one<!--/p7qd--> paragraph <!--ins d3x9-->here<!--/d3x9--> now.\n\n${definitions}`,
      { k3x9: 'ada', n8fx: 'ada', p7qd: 'ada', d3x9: 'ada' },
    );
    expect(() => format(text, rangeOf(text, 'now'), bold(true))).not.toThrow();
  });

  it('says that bold against your own bold reads otherwise, as with Track Changes off', () => {
    const text = file('Some <!--fmt k3x9 +bold-->**text**<!--/k3x9-->here.', { k3x9: 'ada' });
    expect(() => format(text, rangeOf(text, 'here'), bold(true))).toThrow(
      'Markdown would read the text next to it differently',
    );
    const plain = 'Some **text**here.\n';
    expect(() =>
      untrackedFormat(plain, rangeOf(plain, 'here'), bold(true), { author: ada }),
    ).toThrow('Markdown would read the text next to it differently');
  });

  it('reads right once a comment next to the syntax is gone', () => {
    const text = file('<!--cmt c8d2-->\n\n(a)<!--/c8d2-->b', {}, threads);
    expect(codeOf(() => trackedFormat(text, rangeOf(text, '(a)'), bold(true), ctx()))).toBe(
      'no-legal-placement',
    );
  });

  it('covers a deletion inside it: rejecting the deletion brings the text back formatted', () => {
    const text = file('Plain one <!--del d3x9 two -->three here.', { d3x9: 'ada' });
    const after = format(text, rangeOf(text, 'one <!--del d3x9 two -->three'), bold(true));
    expect(body(after)).toBe(
      'Plain <!--fmt m2bd +bold-->**one <!--del d3x9 two -->three**<!--/m2bd--> here.\n',
    );
    expect(body(rejected(after, 'd3x9'))).toBe(
      'Plain <!--fmt m2bd +bold-->**one two three**<!--/m2bd--> here.\n',
    );
    expect(body(rejected(after, 'm2bd'))).toBe(body(text));
    expect(expectEveryDecision('deletion', text, after, ['m2bd'])).toBeGreaterThan(0);
  });

  it('keeps delimiters on the text next to a deletion at the edge of a selection', () => {
    const text = file('Plain <!--del d3x9 old -->text here.', { d3x9: 'ada' });
    const after = format(text, rangeOf(text, '<!--del d3x9 old -->text'), bold(true));
    expect(body(after)).toBe(
      'Plain <!--del d3x9 old --><!--fmt m2bd +bold-->**text**<!--/m2bd--> here.\n',
    );
    expect(body(rejected(after, 'm2bd'))).toBe(body(text));
  });

  it('keeps comments and highlights where they are, overlapping if they do', () => {
    const text = file('Plain <!--cmt c8d2-->some text<!--/c8d2--> here.', {}, threads);
    const inside = format(text, rangeOf(text, 'some text'), bold(true));
    expect(body(inside)).toBe(
      'Plain <!--cmt c8d2--><!--fmt m2bd +bold-->**some text**<!--/m2bd--><!--/c8d2--> here.\n',
    );
    expect(body(rejected(inside, 'm2bd'))).toBe(body(text));
    const over = format(text, rangeOf(text, 'text<!--/c8d2--> here'), bold(true));
    expect(body(over)).toBe(
      'Plain <!--cmt c8d2-->some <!--fmt m2bd +bold-->**text<!--/c8d2--> here**<!--/m2bd-->.\n',
    );
    expect(body(rejected(over, 'm2bd'))).toBe(body(text));
  });

  it('cuts code at every marker, whose markers it would hide', () => {
    const text = file('Plain one<!--del d3x9  two--> three here.', { d3x9: 'ada' });
    const after = format(
      text,
      rangeOf(text, 'one<!--del d3x9  two--> three'),
      inline('code', true),
    );
    expect(body(after)).toBe(
      'Plain <!--fmt m2bd +code-->`one`<!--/m2bd--><!--del d3x9  two--> <!--fmt m2bd +code-->`three`<!--/m2bd--> here.\n',
    );
    expect(parse(after).marks.map((mark) => mark.id)).toEqual(['m2bd', 'd3x9']);
    expect(body(rejected(after, 'm2bd'))).toBe(body(text));
  });

  it('refuses inside code, in the words the editor shows', () => {
    const text = 'Run `npm test` now.\n';
    const inside = () => trackedFormat(text, rangeOf(text, 'test'), bold(true), ctx());
    expect(inside).toThrow(EditError);
    expect(inside).toThrow(
      "Text inside code can't be formatted. Select the whole code span instead.",
    );
    expect(codeOf(inside)).toBe('inside-code');
    expect(codeOf(() => untrackedFormat(text, rangeOf(text, 'test'), bold(true)))).toBe(
      'inside-code',
    );
    expect(codeOf(() => trackedFormat(text, rangeOf(text, 'npm test'), link('x'), ctx()))).toBe(
      'inside-code',
    );

    const fenced = 'One.\n\n```\ncode here\n```\n';
    const block = () => trackedFormat(fenced, rangeOf(fenced, 'here'), bold(true), ctx());
    expect(block).toThrow("Text inside code, an HTML block or an HTML comment can't be formatted.");
    expect(codeOf(block)).toBe('inside-code');
    expect(
      codeOf(() => trackedFormat(fenced, rangeOf(fenced, 'here'), inline('code', true), ctx())),
    ).toBe('inside-code');

    const comment = 'One <!-- a note --> two.\n';
    expect(codeOf(() => trackedFormat(comment, rangeOf(comment, 'note'), bold(true), ctx()))).toBe(
      'inside-code',
    );
  });

  it('does not put a link around a link, which would stop being one', () => {
    const text = 'a <https://x.example> b\n';
    const after = format(text, { from: 0, to: text.length }, link('c'));
    expect(accepted(after, 'm2bd')).toBe('[a](c) <https://x.example> [b](c)\n');
    expect(rejected(after, 'm2bd')).toBe(text);
  });

  it('reads an image by what it shows: code would show its syntax', () => {
    const text = 'a ![b](c.png) d\n';
    expect(
      codeOf(() => trackedFormat(text, rangeOf(text, '![b](c.png)'), inline('code', true), ctx())),
    ).toBe('no-legal-placement');
  });

  it('never cuts a run of delimiters in two', () => {
    const text = 'a ** b\n';
    const c = ctx();
    expect(codeOf(() => trackedFormat(text, { from: 0, to: 3 }, bold(true), c))).toBe(
      'no-legal-placement',
    );
    // Syntax that reads as a format is not cut by what goes around it.
    const nestedRun = '**a *b***\n';
    const after = format(nestedRun, rangeOf(nestedRun, 'b'), inline('strike', true));
    expect(accepted(after, 'm2bd')).toBe('**a ~~*b*~~**\n');
    expect(rejected(after, 'm2bd')).toBe(nestedRun);
  });

  it('reads right whether an emoji is punctuation or not, as renderers disagree', () => {
    // After an emoji, `**` in front of punctuation opens on one reading and not on the other.
    const text = '😀, b\n';
    expect(codeOf(() => trackedFormat(text, rangeOf(text, ','), bold(true), ctx()))).toBe(
      'no-legal-placement',
    );
    const between = 'a 😀 b\n';
    expect(accepted(format(between, rangeOf(between, '😀'), bold(true)), 'm2bd')).toBe(
      'a **😀** b\n',
    );
  });

  it('formats a whole code span from outside, and turns code off from inside it', () => {
    const text = 'Run `npm test` now.\n';
    const whole = format(text, rangeOf(text, '`npm test`'), bold(true));
    expect(body(whole)).toBe('Run <!--fmt m2bd +bold-->**`npm test`**<!--/m2bd--> now.\n');
    expect(rejected(whole, 'm2bd')).toBe(text);
    const off = format(text, rangeOf(text, 'test'), inline('code', false));
    expect(body(off)).toBe('Run <!--fmt m2bd -code-->npm test<!--/m2bd--> now.\n');
    expect(rejected(off, 'm2bd')).toBe(text);
    expect(trackedFormat(text, rangeOf(text, 'test'), inline('code', true), ctx()).changes).toEqual(
      [],
    );
  });

  it('writes code around backticks, and refuses what code would read differently', () => {
    const text = 'Use a`b here.\n';
    const after = format(text, rangeOf(text, 'a`b'), inline('code', true));
    expect(accepted(after, 'm2bd')).toBe('Use ``a`b`` here.\n');
    expect(rejected(after, 'm2bd')).toBe(text);
    const emphasis = 'Use *b* here.\n';
    expect(
      codeOf(() => trackedFormat(emphasis, rangeOf(emphasis, '*b*'), inline('code', true), ctx())),
    ).toBe('no-legal-placement');
    const star = 'Use `*b*` here.\n';
    expect(
      codeOf(() => trackedFormat(star, rangeOf(star, 'b'), inline('code', false), ctx())),
    ).toBe('no-legal-placement');
  });
});

describe('pending changes apart from the change (format §2.6)', { timeout: 120_000 }, () => {
  // A co-author's insertions, deletions and substitutions in five items, and a sixth left alone.
  const EDITS = [
    'one <!--ins k3x9-->new <!--/k3x9-->apple',
    'two <!--del n8fx big -->pear',
    'three <!--sub p7qd old-->fresh<!--/p7qd--> plum',
    'four <!--ins d3x9-->ripe <!--/d3x9-->fig',
    'five <!--del g3rp sour -->lime',
  ];
  const BO = { k3x9: 'bo', n8fx: 'bo', p7qd: 'bo', d3x9: 'bo', g3rp: 'bo' };
  const REGIONS: readonly (readonly [string, (items: readonly string[]) => string])[] = [
    ['list', (items) => items.map((item) => `- ${item}`).join('\n')],
    [
      'table',
      (items) => ['| a | b |', '| - | - |', ...items.map((i) => `| ${i} | x |`)].join('\n'),
    ],
    ['quote', (items) => items.map((item) => `> ${item}`).join('\n>\n')],
  ];
  const OPS: readonly (readonly [string, FormatOp])[] = [
    ['bold', bold(true)],
    ['italic', italic(true)],
    ['code', inline('code', true)],
    ['link', link('https://new.example/a')],
  ];

  it('formats a word in an item that pending changes in five other items leave alone', () => {
    for (const [name, region] of REGIONS) {
      const text = file(region([...EDITS, 'six word here']), BO);
      for (const [label, op] of OPS) {
        const after = format(text, rangeOf(text, 'word'), op);
        expect(parse(after).marks.map((mark) => mark.id)).toContain('m2bd');
        expect(rejected(after, 'm2bd'), `${name} ${label}`).toBe(text);
        // Every order of every decision, the co-author's included, reads as the same decisions
        // without it, with the same blocks; rejected, it gives the bytes back.
        expect(
          expectEveryDecision(`${name} ${label}`, text, after, ['m2bd'], { structure: op }),
        ).toBe(3 ** 6);
        // And the same decisions give the same file, in whichever order they are made.
        expectEveryOrderAlike(`${name} ${label}`, after, exactly);
      }
    }
  });

  it('formats with Track Changes off there too', () => {
    for (const [name, region] of REGIONS) {
      const text = file(region([...EDITS, 'six word here']), BO);
      const word = rangeOf(text, 'word');
      const after = applyChanges(text, untrackedFormat(text, word, bold(true), { author: ada }));
      expect(body(after), name).toBe(body(text).replace('word', '**word**'));
      expectEveryDecision(name, text, after, [], { inPlace: true, structure: bold(true) });
    }
  });

  it('tries every mark that a decision could make it read otherwise with', () => {
    // Four changes of Ada's own in the item and the new mark are as many as can be tried: one
    // more mark that has to be tried is too many, and one apart from the change is not.
    const own =
      'six <!--ins b2cd-->one <!--/b2cd-->two <!--ins c3df-->three <!--/c3df-->four <!--ins d4fg-->more <!--/d4fg-->five <!--ins f5gh-->less <!--/f5gh-->and word here';
    const OWN = { b2cd: 'ada', c3df: 'ada', d4fg: 'ada', f5gh: 'ada' };
    const TOO_MANY = 'Accept or reject some of the changes in this';
    const tries = (body: string, marks: Record<string, string>) => {
      const text = file(body, { ...OWN, ...marks });
      return () => trackedFormat(text, rangeOf(text, 'word'), bold(true), ctx());
    };
    // Apart: a word inserted, deleted, replaced or highlighted in another item, row or paragraph.
    const items = (...lines: string[]) => lines.map((line) => `- ${line}`).join('\n');
    for (const [label, body] of [
      ['bullet', items('one <!--ins k3x9-->new <!--/k3x9-->apple', own)],
      ['numbered', `1. one apple\n2. two <!--del k3x9 big -->pear\n3. ${own}`],
      ['nested', `- one apple\n    - two <!--sub k3x9 old-->new<!--/k3x9--> pear\n- ${own}`],
      ['second paragraph', `- one apple\n\n  more <!--ins k3x9-->new <!--/k3x9-->text\n\n- ${own}`],
      ['highlight', items('one <!--hl k3x9-->apple<!--/k3x9--> pie', own)],
      [
        'row',
        `| a | b |\n| - | - |\n| one <!--ins k3x9-->new <!--/k3x9-->apple | x |\n| ${own} | y |`,
      ],
      ['quote', `> one <!--ins k3x9-->new <!--/k3x9-->apple\n>\n> ${own}`],
    ] as const) {
      expect(tries(body, { k3x9: 'bo' }), label).not.toThrow();
    }
    for (const [label, body, marks] of [
      // In the same item: Ada's own, as another person's change there refuses the change.
      [
        'same item',
        items('one apple', own.replace('and', 'and <!--ins k3x9-->so <!--/k3x9-->')),
        { k3x9: 'ada' },
      ],
      // A line break between items deleted, which joins them.
      ['join', items('one apple<!--del k3x9 \\n- -->two pear', own), { k3x9: 'bo' }],
      // A line break inserted in an item, which splits it.
      ['split', items('one<!--split k3x9-->\n-  apple', own), { k3x9: 'bo' }],
      // The bullet of an item deleted.
      [
        'bullet',
        '- one apple<!--sub k3x9 \\n- two-->\ntwo<!--/k3x9--> pear\n' + items(own),
        { k3x9: 'bo' },
      ],
      // A new item.
      [
        'new item',
        items('one apple<!--ins k3x9--><!--split n8fx-->\n- new<!--/k3x9-->', own),
        { k3x9: 'bo', n8fx: 'bo' },
      ],
      // A definition that the item's link uses.
      [
        'definition',
        items(
          '[r]: <!--sub k3x9 https://old.example-->https://new.example<!--/k3x9-->',
          own.replace('and', 'and [r]'),
        ),
        { k3x9: 'bo' },
      ],
      // The delimiter row of a table, and its header row.
      [
        'delimiter row',
        `| a | b |\n| - | -<!--ins k3x9-->-<!--/k3x9--> |\n| ${own} | x |`,
        { k3x9: 'bo' },
      ],
      [
        'header row',
        `| a | <!--sub k3x9 b-->bee<!--/k3x9--> |\n| - | - |\n| ${own} | x |`,
        { k3x9: 'bo' },
      ],
      // A word whose text could end a code span, or start a line of its own.
      ['backtick', items('one <!--ins k3x9-->`new` <!--/k3x9-->apple', own), { k3x9: 'bo' }],
      ['line start', items('<!--del k3x9 old -->\n  one apple', own), { k3x9: 'bo' }],
    ] as const) {
      expect(tries(body, marks), label).toThrow(TOO_MANY);
    }
  });

  it('tries every mark when a decision is refused only while a mark apart is pending', () => {
    // Accepting Ada's deletion makes `<!--`, a comment that ends at the next `-->`: the opener of
    // Bo's insertion while it is pending, which refuses it, and once Bo's is decided, the `-->` in
    // the third item. With the change, the comment ends at the new opener and hides it, so that the
    // decision that works without the change doesn't with it.
    const text = file(
      '- one <<!--del d3x9 x-->!-- word here\n- two <!--ins k3x9-->new <!--/k3x9-->pear\n- three --> plum',
      { d3x9: 'ada', k3x9: 'bo' },
    );
    const word = rangeOf(text, 'word');
    expect(() => trackedFormat(text, word, bold(true), ctx())).toThrow(/stray syntax/);
    expect(() => tryingEveryMark.trackedFormat(text, word, bold(true), ctx())).toThrow(
      /stray syntax/,
    );
  });

  it('costs about what it does with the pending changes in paragraphs of their own', () => {
    const ids = [...'bcdfghjkmn'].map((c) => `k${c}x9`);
    const marks = Object.fromEntries(ids.map((id) => [id, 'bo']));
    const edited = (i: number) => `<!--ins ${ids[i] ?? ''}-->new <!--/${ids[i] ?? ''}-->`;
    // Ten of Bo's insertions in the other items of the list, or in paragraphs after it.
    const items = ids.map((_, i) => `- item ${i} ${edited(i)}words here`);
    const inItems = file(`${items.join('\n')}\n- the last word here`, marks);
    const plainItems = ids.map((_, i) => `- item ${i} new words here`);
    const paragraphs = ids.map((_, i) => `Paragraph ${i} ${edited(i)}words here.`);
    const inParagraphs = file(
      `${plainItems.join('\n')}\n- the last word here\n\n${paragraphs.join('\n\n')}`,
      marks,
    );
    const best = (text: string) => {
      const selected = rangeOf(text, 'word', text.indexOf('the last'));
      let fastest = Infinity;
      for (let run = 0; run < 7; run++) {
        const start = performance.now();
        trackedFormat(text, selected, bold(true), ctx());
        fastest = Math.min(fastest, performance.now() - start);
      }
      return fastest;
    };
    best(inItems);
    // About 1.3 here. Every order of the ten marks would be 2·11·3^10 decisions, far past any
    // budget, and walking them is what was refused.
    expect(best(inItems) / best(inParagraphs)).toBeLessThan(3);
  });
});

describe('a line that goes on from an opener alone on the line before (format §3.3)', () => {
  it('puts the opener at the end of the line before, in a quoted list item too', () => {
    const text = file(
      '> - <!--fmt k3x9 -bold-->\n>   c d<!--/k3x9--> alpha beta\n>   *e* (b) beta',
      {
        k3x9: 'ada',
      },
    );
    const after = format(text, rangeOf(text, '*e*'), italic(false));
    expect(body(after)).toBe(
      '> - <!--fmt k3x9 -bold-->\n>   c d<!--/k3x9--> alpha beta<!--fmt m2bd -italic-->\n>   e<!--/m2bd--> (b) beta\n',
    );
    expectEveryDecision('quoted item', text, after, ['m2bd'], { structure: italic(false) });
  });

  it('refuses an opener alone on a line that rejecting would make go on from the one above', () => {
    // Ada's own substitution took a break and a quoted list item's bullet away: the line starts a
    // block now, and goes on from the line above once it is rejected.
    const text = file(
      '1. [r] beta\n\n    x (b)<!--sub zsw7 \\n\\n> - -->*<!--/zsw7-->b) x alpha\n>   beta `g` more',
      { zsw7: 'ada' },
    );
    const range = { from: text.indexOf('alpha'), to: text.indexOf(' more') };
    const result = codeOf(() => format(text, range, link('https://new.example/a')));
    if (result === 'no error') {
      const after = format(text, range, link('https://new.example/a'), ctx('n8fx'));
      expectEveryDecision('quoted', text, after, ['n8fx'], { structure: link('x') });
    } else expect(result).toBe('no-legal-placement');
  });

  it('refuses a second opener under a task item’s box, which would end its paragraph', () => {
    const text = file('- [ ] <!--fmt k3x9 was=ul-->\n  alpha beta<!--/k3x9-->', { k3x9: 'ada' });
    expect(() => format(text, rangeOf(text, 'alpha'), bold(true))).toThrow(/task item/);
    // Further in, it is text like any other.
    const after = format(text, rangeOf(text, 'beta'), bold(true));
    expectEveryDecision('box', text, after, ['m2bd'], { structure: bold(true) });
  });
});

describe('delimiters that are text', () => {
  it('formats text made of delimiter characters, and decides it as the views read it', () => {
    for (const [text, word, op] of [
      ['Type ** for bold.\n', '**', inline('code', true)],
      ['Use __init__ or __ alone.\n', '__ alone', inline('code', true)],
      ['Press ~ then go.\n', '~', inline('code', true)],
      ['a ~ b\n', '~', bold(true)],
    ] as const) {
      const selected =
        word === '__ alone' ? rangeOf(text, '__', text.indexOf('or')) : rangeOf(text, word);
      const after = format(text, selected, op);
      expect(rejected(after, 'm2bd'), text).toBe(text);
      expect(applyChanges(after, acceptAll(after)), text).toBe(newestView(after).text);
    }
    // Ada bolds `1~2`, and Bo deletes the 1 and the 2: accepting all leaves the tilde bold.
    let text = 'Range 1~2 here.\n';
    text = format(text, rangeOf(text, '1~2'), bold(true));
    for (const digit of ['1', '2']) {
      const at = text.indexOf(digit, text.indexOf('**'));
      text = applyChanges(
        text,
        trackedEdit(
          text,
          { from: at, to: at + 1, insert: '' },
          context(bo, [digit === '1' ? 'k3x9' : 'n8fx']),
        ),
      );
    }
    expect(applyChanges(text, acceptAll(text))).toBe('Range **~** here.\n');
  });
});

describe('stacks of marks', () => {
  /** The file after `first` and then `second` by Ada, on the word; every order of rejecting them
   * gives back `text`, as all of them together do. */
  function roundTrips(text: string, first: FormatOp, second: FormatOp, word: string): string {
    const one = format(text, rangeOf(text, word), first);
    const two = format(one, rangeOf(one, word), second, ctx('n8fx'));
    expect(applyChanges(two, rejectAll(two)), text).toBe(text);
    for (const order of [
      ['m2bd', 'n8fx'],
      ['n8fx', 'm2bd'],
    ]) {
      let undone = two;
      for (const id of order) undone = rejected(undone, id);
      expect(undone, `${text} ${order.join(' ')}`).toBe(text);
    }
    return two;
  }

  it('rejects the outer mark of a stack at the start of a block', () => {
    const two = roundTrips('Plain text.\n', bold(true), italic(true), 'Plain');
    expect(body(rejected(two, 'm2bd'))).toBe(
      '<!--fmt n8fx +italic-->\n\n*Plain*<!--/n8fx--> text.\n',
    );
    expect(body(rejected(two, 'n8fx'))).toBe(
      '<!--fmt m2bd +bold-->\n\n**Plain**<!--/m2bd--> text.\n',
    );
    expect(body(accepted(two, 'm2bd'))).toBe(
      '<!--fmt n8fx +italic-->\n\n***Plain***<!--/n8fx--> text.\n',
    );
    expect(applyChanges(two, acceptAll(two))).toBe('***Plain*** text.\n');
  });

  it('does so after a format was removed, in a list, a quote and a CRLF file', () => {
    expect(
      applyChanges(
        roundTrips('**Plain** text.\n', bold(false), italic(true), 'Plain'),
        acceptAll(roundTrips('**Plain** text.\n', bold(false), italic(true), 'Plain')),
      ),
    ).toBe('*Plain* text.\n');
    roundTrips('- one two\n', bold(true), italic(true), 'one');
    roundTrips('> one two\n', bold(true), italic(true), 'one');
    roundTrips('Plain text.\r\n', bold(true), italic(true), 'Plain');
    roundTrips('A whole sentence\n', bold(true), italic(true), 'A whole sentence');
    roundTrips('one two\nthree four\n', bold(true), italic(true), 'three');
  });

  it('undoes a format with a comment inside it', () => {
    const threads = [
      '  c8d2:',
      '    by: bo',
      '    at: 2026-10-13T22:40Z',
      '    text: |-',
      '      A note.',
    ];
    const text = file(
      '<!--fmt m2bd +bold-->\n\n<!--cmt c8d2-->\n\n**Plain**<!--/c8d2--><!--/m2bd--> text.',
      { m2bd: 'ada' },
      threads,
    );
    expect(body(applyChanges(text, rejectAll(text)))).toBe(
      '<!--cmt c8d2-->\n\nPlain<!--/c8d2--> text.\n',
    );
  });

  it('turns off your own mark on the outside of a stack, and takes the syntax with it', () => {
    const one = format('Plain text.\n', { from: 0, to: 5 }, bold(true));
    const two = format(one, rangeOf(one, 'Plain'), italic(true), ctx('n8fx'));
    const off = format(two, rangeOf(two, 'Plain'), bold(false), ctx('z9z9'));
    expect(body(off)).toBe('<!--fmt n8fx +italic-->\n\n*Plain*<!--/n8fx--> text.\n');
  });

  it('keeps syntax in front of the syntax of another mark on a wrapped line', () => {
    const text = 'zero\n**c d** more\n';
    const two = roundTrips(text, bold(false), italic(true), 'c d');
    expect(body(two)).toBe(
      'zero<!--fmt m2bd -bold--><!--fmt n8fx +italic-->\n*c d*<!--/n8fx--><!--/m2bd--> more\n',
    );
  });

  it('reads stars that a marker parts as two runs', () => {
    const two = roundTrips('x *e* y\n', italic(false), bold(true), 'e');
    expect(body(rejected(two, 'm2bd'))).toBe('x *<!--fmt n8fx +bold-->**e**<!--/n8fx-->* y\n');
    expect(body(rejected(rejected(two, 'm2bd'), 'n8fx'))).toBe('x *e* y\n');
  });

  it('cuts a format that starts or ends on a pending removal, and it comes back', () => {
    for (const [text, first, word, second] of [
      ['x **c d** rest y\n', bold(false), 'c d', 'c d<!--/m2bd--> rest'],
      ['x [c d](u.md) rest y\n', link(null), 'c d', 'c d<!--/m2bd--> rest'],
      ['x rest **c d** y\n', bold(false), 'c d', 'rest <!--fmt m2bd -bold-->c d'],
    ] as const) {
      const one = format(text, rangeOf(text, word), first);
      const two = format(one, rangeOf(one, second), italic(true), ctx('n8fx'));
      expect(parse(two).marks.find((mark) => mark.id === 'n8fx')?.segments, text).toHaveLength(2);
      expect(applyChanges(two, rejectAll(two)), text).toBe(text);
      for (const order of [
        ['m2bd', 'n8fx'],
        ['n8fx', 'm2bd'],
      ]) {
        let undone = two;
        for (const id of order) undone = rejected(undone, id);
        expect(undone, `${text} ${order.join(' ')}`).toBe(text);
      }
    }
  });
});

describe('a format change whose text is in another change', () => {
  it('asks for the deletion to be decided first, and rejecting everything does that', () => {
    const text = 'Plain text here.\n';
    const bolded = format(text, rangeOf(text, 'text'), bold(true));
    const deleted = applyChanges(
      bolded,
      trackedEdit(bolded, { ...rangeOf(bolded, '**text**'), insert: '' }, context(bo, ['d3x9'])),
    );
    expect(body(deleted)).toBe(
      'Plain <!--fmt m2bd +bold--><!--del d3x9 **text**--><!--/m2bd--> here.\n',
    );
    expect(() => reject(deleted, 'm2bd')).toThrow(/changes inside it/);
    expect(codeOf(() => reject(deleted, 'm2bd'))).toBe('no-legal-placement');
    expect(applyChanges(deleted, rejectAll(deleted))).toBe(text);
    expect(rejected(rejected(deleted, 'd3x9'), 'm2bd')).toBe(text);
    // Rejecting only the format change stays pending, and stops nothing.
    const only = rejectAll(deleted, (mark) => mark.id === 'm2bd');
    expect(only).toEqual([]);
  });

  it('does the same when only the word is deleted, and accepting both gives the newest view', () => {
    const text = 'Plain text here.\n';
    const bolded = format(text, rangeOf(text, 'text'), bold(true));
    const deleted = applyChanges(
      bolded,
      trackedEdit(bolded, { ...rangeOf(bolded, 'text'), insert: '' }, context(bo, ['d3x9'])),
    );
    // Deleting the word between the delimiters replaced all of it with them.
    expect(body(deleted)).toBe(
      'Plain <!--fmt m2bd +bold--><!--sub d3x9 **text**-->****<!--/d3x9--><!--/m2bd--> here.\n',
    );
    expect(() => reject(deleted, 'm2bd')).toThrow(/changes inside it/);
    expect(applyChanges(deleted, rejectAll(deleted))).toBe(text);
    // Accepting both leaves the delimiters, as the newest view reads them.
    expect(applyChanges(deleted, acceptAll(deleted))).toBe(newestView(deleted).text);
  });

  it('goes on past a format change that has no form to leave behind', () => {
    const typed = file(
      'one<!--fmt m2bd +bold-->\n**<!--ins k3x9-->x<!--/k3x9-->three**<!--/m2bd--> four <!--fmt n8fx +bold-->**five**<!--/n8fx-->',
      { m2bd: 'ada', k3x9: 'bo', n8fx: 'ada' },
    );
    expect(codeOf(() => reject(typed, 'm2bd'))).toBe('no-legal-placement');
    const after = applyChanges(
      typed,
      rejectAll(typed, (mark) => mark.kind === 'fmt'),
    );
    expect(body(after)).toBe(
      'one<!--fmt m2bd +bold-->\n**<!--ins k3x9-->x<!--/k3x9-->three**<!--/m2bd--> four five\n',
    );
    expect(body(applyChanges(typed, rejectAll(typed)))).toBe('one\nthree four five\n');
  });
});

describe('emphasis next to letters (format §2.6)', () => {
  it('keeps emphasis off letters: accepting never leaves re_built_', () => {
    const made = format('rebuilt\n', { from: 2, to: 7 }, italic(true));
    expect(accepted(made, 'm2bd')).toBe('re*built*\n');

    const found = file('re<!--fmt m2bd +italic-->_built_<!--/m2bd-->', { m2bd: 'ada' });
    expect(body(accepted(found, 'm2bd'))).toBe('re*built*\n');
    expect(body(rejected(found, 'm2bd'))).toBe('rebuilt\n');

    const after = file('<!--fmt m2bd +italic-->_re_<!--/m2bd-->built', { m2bd: 'ada' });
    expect(body(accepted(after, 'm2bd'))).toBe('*re*built\n');

    const beside = file('re<!--fmt m2bd -bold-->x<!--/m2bd-->_built_', { m2bd: 'ada' });
    expect(body(accepted(beside, 'm2bd'))).toBe('rex*built*\n');
  });

  it('writes * instead of the _ a rejection would bring back next to a letter', () => {
    const text = file('re<!--fmt m2bd -italic=_-->built<!--/m2bd-->', { m2bd: 'ada' });
    expect(body(rejected(text, 'm2bd'))).toBe('re*built*\n');
  });

  it('leaves _ alone that is no emphasis, or that a marker still keeps off the letter', () => {
    const plain = file('snake_case_name <!--fmt m2bd +bold-->**x**<!--/m2bd-->', { m2bd: 'ada' });
    expect(body(accepted(plain, 'm2bd'))).toBe('snake_case_name **x**\n');
    const kept = file(
      're<!--fmt m2bd +bold--><!--fmt n8fx +italic-->_built_<!--/n8fx--><!--/m2bd-->',
      { m2bd: 'ada', n8fx: 'ada' },
    );
    expect(body(accepted(kept, 'n8fx'))).toBe('re<!--fmt m2bd +bold-->_built_<!--/m2bd-->\n');
    expect(body(applyChanges(kept, acceptAll(kept)))).toBe('re*built*\n');
  });
});

describe('decisions the text no longer fits', () => {
  it('refuses to reject a change whose text lost its syntax, and still accepts it', () => {
    const text = file('Plain <!--fmt m2bd +bold-->text<!--/m2bd--> here.', { m2bd: 'ada' });
    expect(codeOf(() => reject(text, 'm2bd'))).toBe('no-legal-placement');
    expect(body(accepted(text, 'm2bd'))).toBe('Plain text here.\n');
  });

  it('offers to reject only what rejecting can be worked out for', () => {
    const offered = (body: string, by: Record<string, string> = { m2bd: 'ada' }) => {
      const parsed = parse(file(body, by));
      const mark = parsed.marks.find((candidate) => candidate.id === 'm2bd');
      return mark ? canReject(parsed, mark) : undefined;
    };
    expect(offered('Plain <!--fmt m2bd +bold-->text<!--/m2bd--> here.')).toBe(false);
    expect(offered('Some <!--fmt m2bd +bold-->****<!--/m2bd--> here.')).toBe(false);
    expect(offered('Some <!--fmt m2bd +bold-->**text**<!--/m2bd--> here.')).toBe(true);
    // A link or code with nothing left in it, and a box, which has no text to lose.
    expect(offered('see <!--fmt m2bd +link-->[](https://x.example/)<!--/m2bd--> now')).toBe(false);
    expect(offered('see <!--fmt m2bd +code-->``<!--/m2bd--> now')).toBe(false);
    expect(offered('see <!--fmt m2bd +bold-->**`**<!--/m2bd--> now')).toBe(true);
    expect(offered('- [x] Buy milk<!--fmt m2bd +check-->')).toBe(true);
    // A change in it may bring the text back: rejecting says what to decide first.
    expect(
      offered(
        'Some <!--fmt m2bd +bold--><!--sub k3x9 **alpha**-->****<!--/k3x9--><!--/m2bd--> here.',
        {
          m2bd: 'ada',
          k3x9: 'bo',
        },
      ),
    ).toBe(true);
  });

  it('removes the markers of a mark with no text', () => {
    const text = file('Plain <!--fmt m2bd +bold--><!--/m2bd-->here.', { m2bd: 'ada' });
    expect(body(rejected(text, 'm2bd'))).toBe('Plain here.\n');
  });

  it('leaves what it does not decide yet pending: +mark, +html', () => {
    const forged = ['-bold=hello', '-italic=__', '-code=a', '+bold=__', '-strike=~~~'];
    for (const payload of [
      '+mark',
      'was=p -bold',
      'was=x',
      '+html=<u>',
      '@width=10',
      'align=x',
      ...forged,
    ]) {
      const text = file(`a <!--fmt m2bd ${payload}-->b<!--/m2bd--> c`, { m2bd: 'ada' });
      expect(
        codeOf(() => accept(text, 'm2bd')),
        payload,
      ).toBe('not-supported');
      expect(
        codeOf(() => reject(text, 'm2bd')),
        payload,
      ).toBe('not-supported');
      expect(applyChanges(text, acceptAll(text)), payload).toBe(text);
      expect(applyChanges(text, rejectAll(text)), payload).toBe(text);
    }
  });

  it('reads the operations of each segment of a mark', () => {
    const text = '**a** and __b__.\n';
    const after = format(text, { from: 0, to: text.length }, bold(false));
    expect(parse(after).marks[0]?.segments.map((segment) => segment.payload)).toEqual([
      '-bold',
      '-bold=__',
    ]);
    expect(parse(after).marks[0]?.payload).toBe('-bold');
    expect(rejected(after, 'm2bd')).toBe(text);
  });
});

describe('parseFormatOps', () => {
  it('gives each operation and its inverse', () => {
    expect(
      parseFormatOps('+bold -italic=_ link=https://old.example -link=a\\x20"b" +link'),
    ).toEqual([
      {
        source: '+bold',
        sign: '+',
        name: 'bold',
        inverse: { kind: 'inline', format: 'bold', on: false },
      },
      {
        source: '-italic=_',
        sign: '-',
        name: 'italic',
        value: '_',
        inverse: { kind: 'inline', format: 'italic', on: true },
      },
      {
        source: 'link=https://old.example',
        sign: '',
        name: 'link',
        value: 'https://old.example',
        inverse: { kind: 'link', url: 'https://old.example' },
      },
      {
        source: '-link=a\\x20"b"',
        sign: '-',
        name: 'link',
        value: 'a "b"',
        inverse: { kind: 'link', url: 'a "b"' },
      },
      { source: '+link', sign: '+', name: 'link', inverse: { kind: 'link', url: null } },
    ]);
  });

  it('knows the block operations, and leaves those it cannot undo without an inverse', () => {
    expect(parseFormatOps('was=h2')[0]?.inverse).toEqual({ kind: 'block', to: 'h2' });
    expect(parseFormatOps('+check')[0]?.inverse).toEqual({ kind: 'check', checked: false });
    expect(parseFormatOps('-check')[0]?.inverse).toEqual({ kind: 'check', checked: true });
    for (const op of ['+mark', 'was=callout-note', '@width=10', 'align=x', '+html=<u>']) {
      expect(parseFormatOps(op)[0]?.inverse, op).toBeUndefined();
    }
    expect(parseFormatOps('')).toEqual([]);
  });

  it('round-trips awkward values through the file', () => {
    for (const url of ['a--b-', 'a|b', '{{x}}', 'c\\ d', 'x\\x20y', 'f g  h', '`i`']) {
      const source = `A [b](<${url}>) c.\n`;
      const removed = format(source, rangeOf(source, 'b'), link(null));
      const written = parse(removed).marks[0]?.payload ?? '';
      expect(written, url).not.toMatch(/--|`|\{\{|[^\\]\|| /);
      expect(parseFormatOps(written)[0]?.value, url).toBe(`<${url}>`);
      expect(rejected(removed, 'm2bd'), url).toBe(source);
    }
  });
});

describe('untrackedFormat', () => {
  const text = 'Plain text here.\n';
  const range = { from: 6, to: 10 };
  const direct = (source: string, selected: Range, op: FormatOp) =>
    applyChanges(source, untrackedFormat(source, selected, op));

  it('writes the syntax and no mark', () => {
    expect(direct(text, range, bold(true))).toBe('Plain **text** here.\n');
    expect(direct(text, range, italic(true))).toBe('Plain *text* here.\n');
    expect(direct(text, range, inline('strike', true))).toBe('Plain ~~text~~ here.\n');
    expect(direct(text, range, inline('code', true))).toBe('Plain `text` here.\n');
    expect(direct(text, range, link('https://x.example'))).toBe(
      'Plain [text](https://x.example) here.\n',
    );
  });

  it('gives changes that keep the text between them', () => {
    expect(untrackedFormat(text, range, bold(true))).toEqual([
      { from: 6, to: 6, insert: '**' },
      { from: 10, to: 10, insert: '**' },
    ]);
  });

  it('takes syntax away', () => {
    const source = 'Plain ***text*** [a](b) here.\n';
    expect(direct(source, rangeOf(source, 'text'), bold(false))).toBe(
      'Plain *text* [a](b) here.\n',
    );
    expect(direct(source, rangeOf(source, 'text'), clear)).toBe('Plain text [a](b) here.\n');
    expect(direct(source, rangeOf(source, '[a]'), link('c'))).toBe(
      'Plain ***text*** [a](c) here.\n',
    );
    expect(direct(source, rangeOf(source, '[a]'), link(null))).toBe('Plain ***text*** a here.\n');
  });

  it('types the syntax outside a pending insertion, as typed text goes (format §3.10)', () => {
    const pending = file('Hello<!--ins k3x9-->, big<!--/k3x9--> world here.', { k3x9: 'ada' });
    const whole = { from: 0, to: rangeOf(pending, 'world').to };
    const after = applyChanges(
      pending,
      untrackedFormat(pending, whole, bold(true), { author: ada }),
    );
    expect(body(after)).toBe('**Hello<!--ins k3x9-->, big<!--/k3x9--> world** here.\n');
    expect(parse(after).ledger.marks['k3x9']?.by).toBe('ada');
    expect(body(rejected(after, 'k3x9'))).toBe('**Hello world** here.\n');
    // Whose the insertion is goes by who edits; nobody's is anybody's.
    expect(() => untrackedFormat(pending, whole, bold(true))).toThrow(IN_PARAGRAPH);
  });

  it('refuses syntax that would hold nothing but a pending insertion', () => {
    // Rejecting the insertion would leave `****` where the text before read nothing.
    const pending = file('Plain <!--ins k3x9-->new<!--/k3x9--> here.', { k3x9: 'ada' });
    expect(() =>
      untrackedFormat(pending, rangeOf(pending, 'new'), bold(true), { author: ada }),
    ).toThrow(/pending changes/);
    const edge = file('<!--ins k3x9-->\n\nnew<!--/k3x9--> here.', { k3x9: 'ada' });
    const selected = { from: rangeOf(edge, 'new').from, to: rangeOf(edge, 'here').to };
    expect(codeOf(() => untrackedFormat(edge, selected, bold(true), { author: ada }))).toBe(
      'no-legal-placement',
    );
  });

  it('refuses syntax in the middle of an insertion, which it would split', () => {
    const own = { author: ada };
    const pending = file('Plain <!--ins k3x9-->new words<!--/k3x9--> here.', { k3x9: 'ada' });
    expect(() => untrackedFormat(pending, rangeOf(pending, 'words'), bold(true), own)).toThrow(
      /Track Changes off/,
    );
    const linked = file('Plain <!--ins k3x9-->new [words](a) x<!--/k3x9--> here.', {
      k3x9: 'ada',
    });
    expect(codeOf(() => untrackedFormat(linked, rangeOf(linked, 'words'), link('b'), own))).toBe(
      'no-legal-placement',
    );
    // Syntax can be taken out of it: that is no split.
    const bolded = file('Plain <!--ins k3x9-->**new** words<!--/k3x9--> here.', { k3x9: 'ada' });
    const off = applyChanges(
      bolded,
      untrackedFormat(bolded, rangeOf(bolded, 'new'), bold(false), own),
    );
    expect(body(off)).toBe('Plain <!--ins k3x9-->new words<!--/k3x9--> here.\n');
  });

  it('refuses what tracked formatting refuses', () => {
    const pending = file('Plain <!--fmt m2bd +bold-->**text**<!--/m2bd--> here.', { m2bd: 'bo' });
    expect(codeOf(() => untrackedFormat(pending, rangeOf(pending, 'text'), bold(false)))).toBe(
      'no-legal-placement',
    );
    const next = '**one**two\n';
    expect(codeOf(() => untrackedFormat(next, rangeOf(next, 'two'), bold(true)))).toBe(
      'no-legal-placement',
    );
    expect(
      codeOf(() => untrackedFormat('---\na: b\n---\n\nc\n', { from: 4, to: 5 }, bold(true))),
    ).toBe('front-matter');
  });

  it('leaves a selection across blocks formatted in each block', () => {
    const across = 'One.\n\nTwo.\r\n';
    expect(direct(across, { from: 0, to: 10 }, bold(true))).toBe('**One.**\n\n**Two.**\r\n');
  });
});

describe('on random documents', { timeout: 3_600_000 }, () => {
  const OPS: readonly FormatOp[] = [
    bold(true),
    bold(true),
    italic(true),
    inline('strike', true),
    inline('code', true),
    bold(false),
    italic(false),
    inline('code', false),
    clear,
    link('https://new.example/a'),
    link(null),
    { kind: 'block', to: 'h2' },
    { kind: 'block', to: 'p' },
    { kind: 'block', to: 'ul' },
    { kind: 'block', to: 'ol' },
    { kind: 'block', to: 'task' },
    { kind: 'block', to: 'quote' },
    { kind: 'check', checked: true },
    { kind: 'check', checked: false },
    { kind: 'indent', by: 1 },
    { kind: 'indent', by: -1 },
  ];
  const cy: Person = { handle: 'cy', name: 'Cy Young' };

  /** Text with formats in it, as people write it, and pending changes of `editors`. */
  function formattedDocument(random: () => number, editors: readonly Person[]): string {
    const below = (n: number) => Math.floor(random() * n);
    const pick = <T>(items: readonly T[]) => items[below(items.length)] as T;
    const WORDS = [
      'alpha',
      'beta',
      'x',
      '(b)',
      '**c d**',
      '*e*',
      '_f_',
      '`g`',
      '[h i](u.md)',
      'k,',
      '[r]',
      'm*n',
    ];
    const words = () => Array.from({ length: 2 + below(4) }, () => pick(WORDS)).join(' ');
    // Blocks whose lines read as they do only with the rest of the block: nested items indented
    // by four, the paragraphs of an item, rows under their header.
    const blocks = Array.from({ length: 1 + below(3) }, () => {
      const kind = below(20);
      // Task items, and tight lists of several items, numbered and bulleted.
      if (kind === 16) return `- [ ] ${words()}\n- [x] ${words()}`;
      if (kind === 17) return `1. ${words()}\n2. ${words()}\n3. ${words()}`;
      if (kind === 18) return `- ${words()}\n- ${words()}\n- ${words()}`;
      if (kind === 19) return `* ${words()}\n* ${words()}`;
      if (kind < 5) return words();
      if (kind < 7) return `${words()}\n${words()}`;
      if (kind < 8) return `- ${words()}`;
      if (kind < 9) return `> ${words()}`;
      if (kind < 10) return `## ${words()}`;
      if (kind < 11) return `- ${words()}\n    - ${words()}`;
      if (kind < 12) return `1. ${words()}\n\n    ${words()}`;
      if (kind < 13) return `| a | b |\n| - | - |\n| ${words()} | ${words()} |`;
      if (kind < 14) return `> - ${words()}\n>   ${words()}`;
      if (kind < 15) return `${words()}\n===`;
      return `- ${words()}\n\n- ${words()}`;
    });
    const definition = below(4) === 0 ? '\n[r]: https://r.example\n' : '';
    let text = `${blocks.join('\n\n')}\n${definition}`;
    for (let edit = below(3); edit > 0; edit--) {
      const stop = parse(text).ledgerRange?.from ?? text.length;
      const view = text.slice(0, stop).replace(/\n+$/, '');
      const at = below(view.length + 1);
      const typed = pick(['new ', ' new', ', ', 'z', '!', '*', '_']);
      const change = [
        { from: at, to: at, insert: typed },
        { from: at, to: Math.min(view.length, at + 1 + below(3)), insert: '' },
        { from: at, to: Math.min(view.length, at + 1 + below(3)), insert: typed },
      ][below(3)] as { from: number; to: number; insert: string };
      try {
        const bytes = (n: number) => Uint8Array.from({ length: n }, () => below(256));
        const author = pick(editors);
        text = applyChanges(text, trackedEdit(text, change, { author, time: TIME, random: bytes }));
      } catch (error) {
        if (!(error instanceof EditError)) throw error;
      }
    }
    return text;
  }

  /** A document as a test sees it: formats and the pending changes of the person who formats, or
   * of someone else too, or marks of every kind; even seeds in CRLF. */
  const documentFor = (seed: number): string => {
    const random = seeded(seed);
    const kind = seed % 6;
    const text =
      kind === 0
        ? editedDocument(seed)
        : kind === 1
          ? randomDocument(random)
          : formattedDocument(random, kind === 2 ? [ada, cy] : [ada]);
    return seed % 2 === 0 ? text.replace(/\r?\n/g, '\r\n') : text;
  };

  const bytes = (seed: number, step: number) => {
    const random = seeded(seed * 15485863 + step);
    return (n: number) => Uint8Array.from({ length: n }, () => Math.floor(random() * 256));
  };

  /** A range in the file: from a view offset to another, the ends on the text. */
  function randomRange(below: (n: number) => number, text: string): Range {
    const view = newestView(text);
    const offsets = naturalOffsets(view.text);
    const first = offsets[below(offsets.length)] ?? 0;
    const later = offsets.filter((offset) => offset > first && offset <= first + 40);
    const last = later[below(later.length)] ?? first;
    const stop = parse(text).ledgerRange?.from ?? text.length;
    const one = Math.min(view.map.toSource(first, below(2) === 0 ? -1 : 1), stop);
    const two = Math.min(view.map.toSource(last, below(2) === 0 ? -1 : 1), stop);
    return { from: Math.min(one, two), to: Math.max(one, two) };
  }

  /** The words of the newest view, which a format change does not change. */
  /** The words of the newest view, which a format change does not change, without the syntax that
   * starts a line: a list's numbers and boxes are a block's type, not its words. */
  const letters = (text: string) =>
    newestView(text)
      .text.replace(/^[ \t>]*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+(?:\[[ xX]\][ \t]+)?)?/gm, '')
      .replace(/[^\p{L}\p{N}]+/gu, '');

  it('never starts a line with a marker, and every decision of every mark comes out right', () => {
    const documents = fuzzCount(60);
    let done = 0;
    let refused = 0;
    let decidedStates = 0;
    const codes = new Map<string, number>();
    for (let seed = 1; seed <= documents; seed++) {
      const random = seeded(seed * 2741);
      const below = (n: number) => Math.floor(random() * n);
      const text = documentFor(seed);
      const before = parse(text);
      let current = text;
      // Set when a change also changed a mark in place: its bytes don't come back by rejecting.
      let inPlace = false;
      // Formats on top of formats, by Ada, whose own changes don't keep her from formatting.
      for (let step = 0; step < 3; step++) {
        const range = randomRange(below, current);
        const op = OPS[below(OPS.length)] as FormatOp;
        const label = `seed ${seed}, step ${step}: ${JSON.stringify(op)} on ${JSON.stringify(range)} in ${JSON.stringify(bodyOf(current))}`;
        const c = { author: ada, time: TIME, random: bytes(seed, step) };
        let result;
        try {
          result = trackedFormat(current, range, op, c);
        } catch (error) {
          if (error instanceof EditError && REFUSALS.includes(error.code ?? '')) {
            refused++;
            codes.set(error.message, (codes.get(error.message) ?? 0) + 1);
            continue;
          }
          throw new Error(`${label}: ${String(error)}`, { cause: error });
        }
        if (result.changes.length === 0) continue;
        const after = applyChanges(current, result.changes);
        const parsedBefore = parse(current);
        const parsedAfter = parse(after);
        // The placement rules: no marker starts a line, and marks and ledger are in order.
        expect(problemsOf(parsedAfter), `${label}\n=> ${JSON.stringify(bodyOf(after))}`).toEqual(
          [],
        );
        expectNoNewLineStarts(label, parsedBefore, parsedAfter);
        // The words stay. The address of a link is in the newest view, until it renders.
        if (op.kind !== 'link') {
          expect(letters(after), `${label}\n=> ${JSON.stringify(bodyOf(after))}`).toBe(
            letters(current),
          );
        }
        // Marks of other people are all still there.
        const kept = new Set(parsedAfter.marks.map((mark) => mark.id));
        for (const mark of parsedBefore.marks) {
          if (kept.has(mark.id)) continue;
          expect(mark.kind, `${label}: ${mark.id} was lost`).toBe('fmt');
          expect(mark.entry.by, `${label}: ${mark.id} was lost`).toBe('ada');
        }
        inPlace ||=
          result.extendedIds.length > 0 ||
          parsedBefore.marks.some(
            (mark) =>
              parsedAfter.marks.find((other) => other.id === mark.id)?.segments.length !==
              mark.segments.length,
          );
        // The block structure, in every order of this step's decisions, as CommonMark reads it:
        // the blocks it changes as it asks, every other block as it was.
        if (result.markIds.length > 0) {
          // Marks of Ada's own that the change took away or changed in place.
          const reshaped = parsedBefore.marks.filter(
            (mark) =>
              parsedAfter.marks.find((other) => other.id === mark.id)?.segments.length !==
              mark.segments.length,
          ).length;
          expectEveryDecision(label, current, after, result.markIds, {
            structure: op,
            inPlace: result.extendedIds.length > 0 || reshaped > 0,
            alsoChanged: result.extendedIds.length + reshaped,
          });
        }
        current = after;
        done++;
      }
      if (current === text) continue;
      // Every mark of the file, the new ones and those that were there, decided every way.
      const fresh = parse(current)
        .marks.filter((mark) => !before.marks.some((old) => old.id === mark.id))
        .map((mark) => mark.id);
      decidedStates += expectEveryDecision(`seed ${seed}`, text, current, fresh, { inPlace });
    }
    // Most changes go through, and most files get every decision tried.
    expect(done, `${refused} refused: ${JSON.stringify([...codes])}`).toBeGreaterThan(
      documents / 3,
    );
    expect(decidedStates).toBeGreaterThan(documents * 3);
  });

  it('changes nothing but the syntax with Track Changes off, decided every way', () => {
    const documents = fuzzCount(30);
    let done = 0;
    for (let seed = 1; seed <= documents; seed++) {
      const random = seeded(seed * 3119);
      const below = (n: number) => Math.floor(random() * n);
      const text = documentFor(seed);
      const range = randomRange(below, text);
      const op = OPS[below(OPS.length)] as FormatOp;
      const label = `seed ${seed}: ${JSON.stringify(op)} on ${JSON.stringify(range)} in ${JSON.stringify(bodyOf(text))}`;
      let changes;
      try {
        changes = untrackedFormat(text, range, op, { author: ada, random: bytes(seed, 0) });
      } catch (error) {
        if (error instanceof EditError && REFUSALS.includes(error.code ?? '')) continue;
        throw new Error(`${label}: ${String(error)}`, { cause: error });
      }
      const after = applyChanges(text, changes);
      expect(problemsOf(parse(after)), label).toEqual([]);
      expectNoNewLineStarts(label, parse(text), parse(after));
      if (op.kind !== 'link') {
        expect(letters(after), `${label}\n=> ${JSON.stringify(bodyOf(after))}`).toBe(letters(text));
      }
      expectEveryDecision(label, text, after, [], { inPlace: true });
      expectBlocksAs(label, after, text, op, Infinity);
      done++;
    }
    expect(done).toBeGreaterThan(documents / 3);
  });
});

describe(
  'marks apart from the change, on random lists, tables and quotes',
  { timeout: 3_600_000 },
  () => {
    const WORDS = [
      'alpha',
      'beta',
      'x',
      '42',
      'k,',
      '(b)',
      'a-b',
      '*e*',
      '_f_',
      '**c d**',
      '`g`',
      '[h i](u.md)',
      '[r]',
      'm*n',
    ];
    /** What co-authors type: words mostly, and now and then what reaches past a paragraph. */
    const TYPED = [
      'new ',
      ' new',
      'z',
      ', ',
      'so ',
      'word ',
      '*',
      '_',
      '`',
      '[r]',
      '|',
      '<b>',
      '\\',
      '\n- ',
      '\n',
      '\n\n',
    ];
    const INLINE: readonly FormatOp[] = [
      bold(true),
      bold(true),
      italic(true),
      inline('strike', true),
      inline('code', true),
      bold(false),
      italic(false),
      inline('code', false),
      clear,
      link('https://new.example/a'),
      link(null),
    ];

    /** A list, a table or a block quote of a few items, one of them with the word `target`, with
     * highlights, a comment and a definition now and then, Bo's pending changes in the other items,
     * mostly words, and Ada's in that one. */
    function regionDocument(random: () => number): string {
      const below = (n: number) => Math.floor(random() * n);
      const pick = <T>(items: readonly T[]) => items[below(items.length)] as T;
      const words = () => Array.from({ length: 2 + below(4) }, () => pick(WORDS)).join(' ');
      const marks: Record<string, string> = {};
      const threads: string[] = [];
      const count = 3 + below(4);
      const target = below(count);
      // A highlight or a comment around the last word of some items.
      const item = (i: number) => {
        const text = `${pick(['one', 'two', 'six'])} ${words()} ${i === target ? 'target ' : ''}${pick(['alpha', 'beta', 'gamma'])}`;
        const around = below(7);
        const id = ['h4kz', 'h5kz', 'h6kz', 'h7kz', 'h8kz', 'h9kz', 'hbkz', 'hckz'][i] ?? 'hdkz';
        if (around === 0) {
          marks[id] = 'bo';
          return text.replace(/(\S+)$/, `<!--hl ${id}-->$1<!--/${id}-->`);
        }
        if (around === 1 && threads.length === 0) {
          threads.push(
            '  c8d2:',
            '    by: bo',
            '    at: 2026-10-13T22:40Z',
            '    text: |-',
            '      A note.',
          );
          return text.replace(/(\S+)$/, '<!--cmt c8d2-->$1<!--/c8d2-->');
        }
        return text;
      };
      const items = Array.from({ length: count }, (_, i) => item(i));
      const kind = below(6);
      const body =
        kind === 0
          ? items.map((text) => `- ${text}`).join('\n')
          : kind === 1
            ? items.map((text, i) => `${i + 1}. ${text}`).join('\n')
            : kind === 2
              ? [
                  '| a | b |',
                  '| - | - |',
                  ...items.map((text) => `| ${text} | ${pick(WORDS)} |`),
                ].join('\n')
              : kind === 3
                ? items.map((text) => `> ${text}`).join('\n>\n')
                : kind === 4
                  ? items.map((text, i) => (i % 2 === 1 ? `    - ${text}` : `- ${text}`)).join('\n')
                  : items.map((text) => `- ${text}`).join('\n\n');
      const definition = below(3) === 0 ? '\n\n[r]: https://r.example' : '';
      let text = file(`${body}${definition}`, marks, threads);
      for (let edit = 2 + below(6); edit > 0; edit--) {
        const stop = parse(text).ledgerRange?.from ?? text.length;
        const lines: Range[] = [];
        for (let at = 0; at < stop; at = text.indexOf('\n', at) + 1 || stop) {
          lines.push({
            from: at,
            to: Math.min(stop, text.indexOf('\n', at) === -1 ? stop : text.indexOf('\n', at)),
          });
        }
        const mine = text.indexOf('target');
        const own = lines.find((line) => line.from <= mine && mine <= line.to);
        // Mostly Bo's words in another item, past its first word; now and then anything anywhere,
        // or Ada's in her item.
        const way = below(6);
        const others = lines.filter((line) => line !== own && line.to - line.from > 4);
        const line = way === 5 ? own : pick(others.length > 0 ? others : lines);
        if (!line) continue;
        const first = line.from + Math.min(line.to - line.from, 4);
        const at = way === 4 ? below(stop) : first + below(Math.max(1, line.to - first));
        const typed = way === 4 ? pick(TYPED) : pick(TYPED.slice(0, 11));
        const change = [
          { from: at, to: at, insert: typed },
          { from: at, to: Math.min(stop, at + 1 + below(4)), insert: '' },
          { from: at, to: Math.min(stop, at + 1 + below(4)), insert: typed },
        ][below(3)] as TextChange;
        const author = way === 5 ? ada : bo;
        try {
          const bytes = (n: number) => Uint8Array.from({ length: n }, () => below(256));
          text = applyChanges(
            text,
            trackedEdit(text, change, { author, time: TIME, random: bytes }),
          );
        } catch (error) {
          if (!(error instanceof EditError)) throw error;
        }
      }
      return text;
    }

    /** A range around the word `target`, or from a view offset to another a few words on. */
    function randomRange(below: (n: number) => number, text: string): Range {
      const at = text.indexOf('target');
      if (at !== -1 && below(3) > 0) {
        const from = Math.max(0, at - below(12));
        return { from, to: Math.min(text.length, at + 6 + below(12)) };
      }
      const view = newestView(text);
      const offsets = naturalOffsets(view.text);
      const first = offsets[below(offsets.length)] ?? 0;
      const later = offsets.filter((offset) => offset > first && offset <= first + 20);
      const last = later[below(later.length)] ?? first;
      const stop = parse(text).ledgerRange?.from ?? text.length;
      const one = Math.min(view.map.toSource(first, below(2) === 0 ? -1 : 1), stop);
      const two = Math.min(view.map.toSource(last, below(2) === 0 ? -1 : 1), stop);
      return { from: Math.min(one, two), to: Math.max(one, two) };
    }

    const outcome = <T>(run: () => T): { result?: T; error?: EditError } => {
      try {
        return { result: run() };
      } catch (error) {
        if (error instanceof EditError) return { error };
        throw error;
      }
    };
    /** Whether a refusal is the budget's: every mark could not be tried. */
    const tooMany = (error: EditError | undefined) => error?.message.includes('too many') === true;

    it('allows what trying every mark allows, and nothing else that reads otherwise', () => {
      const documents = fuzzCount(60);
      let alike = 0;
      let more = 0;
      let checked = 0;
      for (let seed = 1; seed <= documents; seed++) {
        const random = seeded(seed * 7919);
        const below = (n: number) => Math.floor(random() * n);
        const plain = regionDocument(random);
        const text = seed % 2 === 0 ? plain.replace(/\r?\n/g, '\r\n') : plain;
        const range = randomRange(below, text);
        const op = INLINE[below(INLINE.length)] as FormatOp;
        const label = `seed ${seed}: ${JSON.stringify(op)} on ${JSON.stringify(range)} in ${JSON.stringify(bodyOf(text))}`;
        const c = () => ({
          author: ada,
          time: TIME,
          random: randomIds('m2bd', 'n8fz', 'p7qz', 'q2hz', 'r3sz', 's4tz'),
        });
        const every = outcome(() => tryingEveryMark.trackedFormat(text, range, op, c()));
        const apart = outcome(() => trackedFormat(text, range, op, c()));
        if (every.result) {
          // What trying every mark allows, leaving some pending allows too, the same way.
          expect(apart.error?.message, label).toBeUndefined();
          expect(apart.result, label).toEqual(every.result);
          alike++;
        } else if (!tooMany(every.error)) {
          // And what it refuses, leaving some pending refuses too.
          expect(apart.result, `${label}\n${every.error?.message ?? ''}`).toBeUndefined();
        } else if (apart.result && apart.result.changes.length > 0) {
          // More than every mark can be tried for: every order of them, exactly.
          const result: TrackedEdits = apart.result;
          const after = applyChanges(text, result.changes);
          const reshaped = parse(text).marks.filter(
            (mark) =>
              parse(after).marks.find((other) => other.id === mark.id)?.segments.length !==
              mark.segments.length,
          ).length;
          const states = expectEveryDecision(label, text, after, result.markIds, {
            structure: op,
            inPlace: result.extendedIds.length > 0 || reshaped > 0,
            alsoChanged: result.extendedIds.length + reshaped,
            limit: 7,
          });
          if (states > 0) expectEveryOrderAlike(label, after, exactly);
          if (states > 0) checked++;
          more++;
        }
        // With Track Changes off too.
        const everyOff = outcome(() =>
          tryingEveryMark.untrackedFormat(text, range, op, { author: ada }),
        );
        const apartOff = outcome(() => untrackedFormat(text, range, op, { author: ada }));
        if (everyOff.result) {
          expect(apartOff.error?.message, `off: ${label}`).toBeUndefined();
          expect(apartOff.result, `off: ${label}`).toEqual(everyOff.result);
        } else if (!tooMany(everyOff.error)) {
          expect(
            apartOff.result,
            `off: ${label}\n${everyOff.error?.message ?? ''}`,
          ).toBeUndefined();
        } else if (apartOff.result && apartOff.result.length > 0) {
          const after = applyChanges(text, apartOff.result);
          expectEveryDecision(`off: ${label}`, text, after, [], { inPlace: true, limit: 7 });
          expectBlocksAs(`off: ${label}`, after, text, op, Infinity);
        }
      }
      // Most documents can be tried both ways, and some are allowed only with marks left pending.
      expect(alike, `${more} more`).toBeGreaterThan(documents / 4);
      if (documents >= 100) expect(checked, JSON.stringify({ alike, more })).toBeGreaterThan(0);
    });
  },
);
