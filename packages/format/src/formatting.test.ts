import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { accept, acceptAll, reject, rejectAll } from './decide.ts';
import { EditError } from './errors.ts';
import { parseFormatOps, trackedFormat, untrackedFormat } from './formatting.ts';
import type { FormatOp, InlineFormat } from './formatting.ts';
import { parse } from './parse.ts';
import { fuzzCount, randomDocument, seeded } from './random-docs.ts';
import {
  REFUSALS,
  TIME,
  ada,
  bo,
  bodyOf,
  context,
  editedDocument,
  expectNoNewLineStarts,
  file,
  naturalOffsets,
  problemsOf,
} from './test-helpers.ts';
import type { EditContext, Person, Range } from './types.ts';
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
    const second = format(first, rangeOf(first, 'text'), italic(true), context(bo, ['n8fx']));
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
    expect(() => trackedFormat(pending, selected, bold(false), ctx('n8fx'))).toThrow(/Bo Chen's/);
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

  it('refuses a reference link, which has no address of its own to change', () => {
    const source = 'See [guide][g] now.\n\n[g]: https://x.example\n';
    expect(codeOf(() => trackedFormat(source, rangeOf(source, 'guide'), link(null), ctx()))).toBe(
      'no-legal-placement',
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
    const text = file('Alpha <!--del k3x9 two.\\n\\nGamma -->five six.', { k3x9: 'bo' });
    const after = format(text, rangeOf(text, 'five', 0), bold(true));
    expect(body(after)).toContain('<!--fmt m2bd +bold-->**five**<!--/m2bd-->');
    const whole = format(text, { from: 0, to: rangeOf(text, 'six.').to }, bold(true));
    expect(body(whole).split('\n')[2]).toBe(
      '**Alpha**<!--/m2bd--> <!--del k3x9 two.\\n\\nGamma --><!--fmt m2bd +bold-->**five six.**<!--/m2bd-->',
    );
    expect(body(rejected(whole, 'm2bd'))).toBe(body(text));
  });
});

describe('next to other changes', () => {
  const pending = file('Plain <!--ins k3x9-->new <!--/k3x9-->text here.', { k3x9: 'bo' });
  const covered = { from: rangeOf(pending, 'new').from, to: rangeOf(pending, 'text').to };

  it("nests around another author's insertion and restores bytes on reject", () => {
    const after = format(pending, covered, bold(true));
    expect(body(after)).toBe(
      'Plain <!--ins k3x9--><!--fmt m2bd +bold-->**new**<!--/m2bd--> <!--/k3x9--><!--fmt m2bd +bold-->**text**<!--/m2bd--> here.\n',
    );
    expect(body(rejected(after, 'm2bd'))).toBe(body(pending));
  });

  it('leaves no stray ** behind when that insertion is decided, in either order', () => {
    const after = format(pending, covered, bold(true));
    const noIns = rejected(after, 'k3x9');
    expect(body(noIns)).toBe('Plain <!--fmt m2bd +bold-->**text**<!--/m2bd--> here.\n');
    expect(body(accepted(noIns, 'm2bd'))).toBe('Plain **text** here.\n');
    expect(body(rejected(noIns, 'm2bd'))).toBe('Plain text here.\n');
    const kept = accepted(after, 'k3x9');
    expect(body(kept)).toBe(
      'Plain <!--fmt m2bd +bold-->**new**<!--/m2bd--> <!--fmt m2bd +bold-->**text**<!--/m2bd--> here.\n',
    );
    const first = accepted(after, 'm2bd');
    expect(body(first)).toBe('Plain <!--ins k3x9-->**new** <!--/k3x9-->**text** here.\n');
    expect(body(rejected(first, 'k3x9'))).toBe('Plain **text** here.\n');
  });

  it('cuts where a selection goes out of an insertion', () => {
    const text = file('Plain <!--ins k3x9-->new thing<!--/k3x9--> here.', { k3x9: 'bo' });
    const after = format(text, rangeOf(text, 'thing<!--/k3x9--> here'), bold(true));
    expect(body(after)).toBe(
      'Plain <!--ins k3x9-->new <!--fmt m2bd +bold-->**thing**<!--/m2bd--><!--/k3x9--> <!--fmt m2bd +bold-->**here**<!--/m2bd-->.\n',
    );
    expect(body(rejected(after, 'm2bd'))).toBe(body(text));
    expect(body(rejected(after, 'k3x9'))).toBe(
      'Plain  <!--fmt m2bd +bold-->**here**<!--/m2bd-->.\n',
    );
  });

  it('holds a substitution the same way: its old text comes back as it was', () => {
    const text = file('Plain <!--sub p7qd old-->new<!--/p7qd--> here.', { p7qd: 'bo' });
    const after = format(text, rangeOf(text, 'new'), bold(true));
    expect(body(after)).toBe(
      'Plain <!--sub p7qd old--><!--fmt m2bd +bold-->**new**<!--/m2bd--><!--/p7qd--> here.\n',
    );
    expect(body(rejected(after, 'm2bd'))).toBe(body(text));
    expect(body(rejected(after, 'p7qd'))).toBe('Plain old here.\n');
    expect(body(accepted(after, 'p7qd'))).toBe(
      'Plain <!--fmt m2bd +bold-->**new**<!--/m2bd--> here.\n',
    );
  });

  it('writes syntax with no mark in your own insertion, which is pending anyway', () => {
    const text = file('Plain <!--ins k3x9-->new words<!--/k3x9--> here.', { k3x9: 'ada' });
    const { changes, markIds, extendedIds } = trackedFormat(
      text,
      rangeOf(text, 'new'),
      bold(true),
      ctx(),
    );
    expect(body(applyChanges(text, changes))).toBe(
      'Plain <!--ins k3x9-->**new** words<!--/k3x9--> here.\n',
    );
    expect(markIds).toEqual([]);
    expect(extendedIds).toEqual(['k3x9']);
    const off = applyChanges(text, changes);
    expect(body(format(off, rangeOf(off, 'new'), bold(false)))).toBe(body(text));
  });

  it('covers a deletion inside it: rejecting the deletion brings the text back formatted', () => {
    const text = file('Plain one <!--del d3x9 two -->three here.', { d3x9: 'bo' });
    const after = format(text, rangeOf(text, 'one <!--del d3x9 two -->three'), bold(true));
    expect(body(after)).toBe(
      'Plain <!--fmt m2bd +bold-->**one <!--del d3x9 two -->three**<!--/m2bd--> here.\n',
    );
    expect(body(rejected(after, 'd3x9'))).toBe(
      'Plain <!--fmt m2bd +bold-->**one two three**<!--/m2bd--> here.\n',
    );
    expect(body(rejected(after, 'm2bd'))).toBe(body(text));
  });

  it('keeps delimiters on the text next to a deletion at the edge of a selection', () => {
    const text = file('Plain <!--del d3x9 old -->text here.', { d3x9: 'bo' });
    const after = format(text, rangeOf(text, '<!--del d3x9 old -->text'), bold(true));
    expect(body(after)).toBe(
      'Plain <!--del d3x9 old --><!--fmt m2bd +bold-->**text**<!--/m2bd--> here.\n',
    );
    expect(body(rejected(after, 'm2bd'))).toBe(body(text));
  });

  it('keeps comments and highlights where they are, overlapping if they do', () => {
    const threads = [
      '  c8d2:',
      '    by: bo',
      '    at: 2026-10-13T22:40Z',
      '    text: |-',
      '      A note.',
    ];
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
    const text = file('Plain one<!--del d3x9  two--> three here.', { d3x9: 'bo' });
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
    expect(block).toThrow("Text inside code or an HTML comment can't be formatted.");
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

  it('removes the markers of a mark with no text', () => {
    const text = file('Plain <!--fmt m2bd +bold--><!--/m2bd-->here.', { m2bd: 'ada' });
    expect(body(rejected(text, 'm2bd'))).toBe('Plain here.\n');
  });

  it('leaves what it does not decide yet pending: +mark, was=, +check', () => {
    for (const payload of ['+mark', 'was=p', '+check', '+html=<u>', '@width=10', 'align=x']) {
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
    for (const url of ['a--b-', 'a|b', '{{x}}', 'c\\ d', 'e\\', 'x\\x20y', 'f g  h', '`i`']) {
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
    const pending = file('Plain <!--ins k3x9-->new<!--/k3x9--> here.', { k3x9: 'bo' });
    const after = direct(pending, rangeOf(pending, 'new'), bold(true));
    expect(body(after)).toBe('Plain **<!--ins k3x9-->new<!--/k3x9-->** here.\n');
    expect(parse(after).ledger.marks['k3x9']?.by).toBe('bo');
  });

  it('splits an insertion that a format starts in, with a new id', () => {
    const pending = file('Plain <!--ins k3x9-->new words<!--/k3x9--> here.', { k3x9: 'bo' });
    const after = applyChanges(
      pending,
      untrackedFormat(pending, rangeOf(pending, 'words'), bold(true), {
        random: context(ada, ['w8nn']).random!,
      }),
    );
    expect(body(after)).toBe(
      'Plain <!--ins k3x9-->new <!--/k3x9-->**<!--ins w8nn-->words<!--/w8nn-->** here.\n',
    );
    expect(parse(after).ledger.marks['w8nn']?.by).toBe('bo');
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

describe('on random documents', { timeout: 600_000 }, () => {
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
  ];
  const AUTHORS: readonly Person[] = [ada, bo];

  /** A document as a test sees it: `seed` odd or even picks random marks or edited ones. */
  const documentFor = (seed: number): string => {
    const text = seed % 3 === 0 ? editedDocument(seed) : randomDocument(seeded(seed));
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
  const letters = (text: string) => newestView(text).text.replace(/[^\p{L}\p{N}]+/gu, '');

  it('never starts a line with a marker, and restores the bytes, on random documents', () => {
    const documents = fuzzCount(150);
    let done = 0;
    let refused = 0;
    const codes = new Map<string, number>();
    for (let seed = 1; seed <= documents; seed++) {
      const random = seeded(seed * 2741);
      const below = (n: number) => Math.floor(random() * n);
      const text = documentFor(seed);
      const history: { before: string; after: string; ids: string[] }[] = [];
      let current = text;
      // Formats on top of formats, by two people, then taken back one by one.
      for (let step = 0; step < 3; step++) {
        const author = AUTHORS[below(AUTHORS.length)] as Person;
        const range = randomRange(below, current);
        const op = OPS[below(OPS.length)] as FormatOp;
        const label = `seed ${seed}, step ${step}: ${JSON.stringify(op)} on ${JSON.stringify(range)} by ${author.handle} in ${JSON.stringify(bodyOf(current))}`;
        const c = { author, time: TIME, random: bytes(seed, step) };
        let result;
        try {
          result = trackedFormat(current, range, op, c);
        } catch (error) {
          if (error instanceof EditError && REFUSALS.includes(error.code ?? '')) {
            refused++;
            codes.set(error.code ?? '', (codes.get(error.code ?? '') ?? 0) + 1);
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
        for (const id of result.markIds) {
          const mark = parsedAfter.marks.find((candidate) => candidate.id === id);
          expect(mark?.kind, `${label}: ${id}`).toBe('fmt');
          // Each mark's own decision keeps the file as it should be.
          const accepted = applyChanges(after, accept(after, id));
          expect(problemsOf(parse(accepted)), `${label}: accepting ${id}`).toEqual([]);
        }
        // Marks of other people are all still there.
        const kept = new Set(parsedAfter.marks.map((mark) => mark.id));
        for (const mark of parsedBefore.marks) {
          if (kept.has(mark.id)) continue;
          expect(mark.kind, `${label}: ${mark.id} was lost`).toBe('fmt');
          expect(mark.entry.by, `${label}: ${mark.id} was lost`).toBe(author.handle);
        }
        // A step that also changed the author's own marks in place gives back no bytes by itself.
        const inPlace =
          result.extendedIds.length > 0 ||
          parsedBefore.marks.some(
            (mark) =>
              parsedAfter.marks.find((other) => other.id === mark.id)?.segments.length !==
              mark.segments.length,
          );
        if (result.markIds.length > 0 && !inPlace) {
          history.push({ before: current, after, ids: result.markIds });
        }
        current = after;
        done++;
      }
      // Rejecting the marks of the last step gives back the bytes before it.
      const last = history.at(-1);
      if (last) {
        let undone = last.after;
        for (const id of last.ids) undone = applyChanges(undone, reject(undone, id));
        expect(body(undone), `seed ${seed}: ${JSON.stringify(bodyOf(last.after))}`).toBe(
          body(last.before),
        );
      }
      // Rejecting them all together, in every step, does the same.
      for (const entry of history) {
        const { before, after, ids } = entry;
        const wanted = new Set(ids);
        const undone = applyChanges(
          after,
          rejectAll(after, (mark) => wanted.has(mark.id)),
        );
        expect(body(undone), `seed ${seed}: all of ${ids.join(' ')}`).toBe(body(before));
      }
    }
    // Most changes go through.
    expect(done, JSON.stringify([...codes])).toBeGreaterThan(refused);
    expect(done).toBeGreaterThan(documents / 2);
  });

  it('changes nothing but the syntax with Track Changes off', () => {
    const documents = fuzzCount(100);
    let done = 0;
    let refused = 0;
    for (let seed = 1; seed <= documents; seed++) {
      const random = seeded(seed * 3119);
      const below = (n: number) => Math.floor(random() * n);
      const text = documentFor(seed);
      const range = randomRange(below, text);
      const op = OPS[below(OPS.length)] as FormatOp;
      const label = `seed ${seed}: ${JSON.stringify(op)} on ${JSON.stringify(range)} in ${JSON.stringify(bodyOf(text))}`;
      let changes;
      try {
        changes = untrackedFormat(text, range, op, { random: bytes(seed, 0) });
      } catch (error) {
        if (error instanceof EditError && REFUSALS.includes(error.code ?? '')) {
          refused++;
          continue;
        }
        throw new Error(`${label}: ${String(error)}`, { cause: error });
      }
      const after = applyChanges(text, changes);
      expect(problemsOf(parse(after)), label).toEqual([]);
      expectNoNewLineStarts(label, parse(text), parse(after));
      if (op.kind !== 'link') {
        expect(letters(after), `${label}\n=> ${JSON.stringify(bodyOf(after))}`).toBe(letters(text));
      }
      done++;
    }
    expect(done).toBeGreaterThan(refused);
  });
});
