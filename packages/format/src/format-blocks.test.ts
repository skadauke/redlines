import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { accept, acceptAll, reject, rejectAll } from './decide.ts';
import { EditError } from './errors.ts';
import type { BlockType, FormatOp } from './format-ops.ts';
import { formatChange } from './format-blocks.ts';
import { trackedFormat, untrackedFormat } from './formatting.ts';
import { parse } from './parse.ts';
import { trackedEdit } from './track.ts';
import {
  ada,
  bo,
  bodyOf,
  context,
  expectBlocksAs,
  expectEveryDecision,
  expectEveryOrderAlike,
  file,
} from './test-helpers.ts';
import type { EditContext, Range } from './types.ts';
import { newestView, originalView } from './views.ts';

const ctx = (...ids: string[]): EditContext =>
  context(ada, ids.length > 0 ? ids : ['m2bd', 'n8fx', 'p7qd', 'd3x9', 'g3rp']);
const block = (to: BlockType): FormatOp => ({ kind: 'block', to });
const check = (checked: boolean): FormatOp => ({ kind: 'check', checked });
const indent = (by: 1 | -1): FormatOp => ({ kind: 'indent', by });

/** The body of a file, ending in one line break: a ledger leaves a blank line in front of it. */
const body = (text: string) => `${bodyOf(text).replace(/[\r\n]+$/, '')}\n`;

const rejected = (text: string, id: string) => applyChanges(text, reject(text, id));
const accepted = (text: string, id: string) => applyChanges(text, accept(text, id));

/** The range of `word` in `text`, the first place it stands. */
function rangeOf(text: string, word: string): Range {
  const from = text.indexOf(word);
  if (from === -1) throw new Error(`${word} is not in the text`);
  return { from, to: from + word.length };
}

/** All of the body. */
const all = (text: string): Range => ({
  from: 0,
  to: parse(text).ledgerRange?.from ?? text.length,
});

/**
 * A tracked format change, as the new file. Its new marks are decided in every order, with the
 * other marks, and each state must read as the same decisions without it, with the block structure
 * CommonMark reads that the change asks for.
 */
function changed(text: string, range: Range, op: FormatOp, c: EditContext = ctx()): string {
  const { changes, markIds } = trackedFormat(text, range, op, c);
  const after = applyChanges(text, changes);
  if (markIds.length > 0) {
    expectEveryDecision(JSON.stringify(op), text, after, markIds, { structure: op });
  }
  return after;
}

/** The same with Track Changes off, with the block structure the change asks for. */
function typed(text: string, range: Range, op: FormatOp): string {
  const after = applyChanges(text, untrackedFormat(text, range, op, { author: ada }));
  expectBlocksAs(JSON.stringify(op), after, text, op, Infinity);
  return after;
}

const message = (run: () => unknown): string => {
  try {
    run();
  } catch (error) {
    if (error instanceof EditError) return error.message;
    throw error;
  }
  return 'no error';
};

const IN_PARAGRAPH = 'Accept or reject the changes in this paragraph first.';
const BREAK_PENDING = 'A pending change to a line break is in the way. Decide it first.';
const ON_ITS_OWN = 'with a blank line before and after';

/** One block of each type, as the serializer writes it. */
const FORMS: Record<BlockType, string> = {
  p: 'Text here\n',
  h1: '# Text here\n',
  h2: '## Text here\n',
  h3: '### Text here\n',
  h4: '#### Text here\n',
  h5: '##### Text here\n',
  h6: '###### Text here\n',
  ul: '- Text here\n',
  ol: '1. Text here\n',
  task: '- [ ] Text here\n',
  quote: '> Text here\n',
};
const TYPES = Object.keys(FORMS) as BlockType[];

describe('block types (format §2.6)', () => {
  it('turns a paragraph into a heading as in §2.6', () => {
    const text = 'This paragraph\n';
    const after = changed(text, all(text), block('h2'));
    expect(body(after)).toBe('<!--fmt m2bd was=p-->\n\n## This paragraph<!--/m2bd-->\n');
    expect(rejected(after, 'm2bd')).toBe(text);
    expect(accepted(after, 'm2bd')).toBe('## This paragraph\n');
  });

  it('turns every type into every other, and back by rejecting', () => {
    for (const from of TYPES) {
      for (const to of TYPES) {
        if (from === to) continue;
        const text = FORMS[from];
        const label = `${from} to ${to}`;
        const after = changed(text, all(text), block(to));
        expect(
          parse(after).marks.map((mark) => mark.payload),
          label,
        ).toEqual([`was=${from}`]);
        expect(rejected(after, 'm2bd'), label).toBe(text);
        expect(accepted(after, 'm2bd'), label).toBe(FORMS[to]);
      }
    }
  });

  it('puts the mark where a mark that starts the block goes (format §3.3)', () => {
    const cases: [BlockType, BlockType, string][] = [
      ['p', 'ul', '- <!--fmt m2bd was=p-->\n  Text here<!--/m2bd-->\n'],
      ['p', 'ol', '1. <!--fmt m2bd was=p-->\n   Text here<!--/m2bd-->\n'],
      ['p', 'task', '- [ ] <!--fmt m2bd was=p-->\n  Text here<!--/m2bd-->\n'],
      ['p', 'quote', '> <!--fmt m2bd was=p-->\n>\n> Text here<!--/m2bd-->\n'],
      ['ul', 'p', '<!--fmt m2bd was=ul-->\n\nText here<!--/m2bd-->\n'],
      ['quote', 'h3', '<!--fmt m2bd was=quote-->\n\n### Text here<!--/m2bd-->\n'],
      ['h2', 'ol', '1. <!--fmt m2bd was=h2-->\n   Text here<!--/m2bd-->\n'],
    ];
    for (const [from, to, written] of cases) {
      expect(body(changed(FORMS[from], all(FORMS[from]), block(to))), `${from} to ${to}`).toBe(
        written,
      );
    }
  });

  it('writes > on every line of a quote, and takes it from every line', () => {
    const text = 'Line one\nline two\n';
    const quoted = changed(text, all(text), block('quote'));
    expect(body(quoted)).toBe('> <!--fmt m2bd was=p-->\n>\n> Line one\n> line two<!--/m2bd-->\n');
    expect(rejected(quoted, 'm2bd')).toBe(text);
    expect(accepted(quoted, 'm2bd')).toBe('> Line one\n> line two\n');
    const quote = '> Line one\n> line two\n';
    const plain = changed(quote, all(quote), block('p'));
    expect(body(plain)).toBe('<!--fmt m2bd was=quote-->\n\nLine one\nline two<!--/m2bd-->\n');
    expect(rejected(plain, 'm2bd')).toBe(quote);
    // A list item keeps its other lines as they are: they go on from the first.
    const item = changed(text, all(text), block('ul'));
    expect(accepted(item, 'm2bd')).toBe('- Line one\nline two\n');
    expect(rejected(item, 'm2bd')).toBe(text);
  });

  it('keeps old syntax that the serializer would write otherwise, to give back the bytes', () => {
    const cases: [string, BlockType, string][] = [
      ['* Item here\n', 'p', 'was=ul=*\\x20'],
      ['3. Item here\n', 'ul', 'was=ol=3.\\x20'],
      ['1) Item here\n', 'p', 'was=ol=1)\\x20'],
      ['#  Two spaces\n', 'p', 'was=h1=#\\x20\\x20'],
      ['- [x] Done here\n', 'p', 'was=task=-\\x20[x]\\x20'],
      ['-   Wide item\n', 'h2', 'was=ul=-\\x20\\x20\\x20'],
    ];
    for (const [text, to, payload] of cases) {
      const after = changed(text, all(text), block(to));
      expect(parse(after).marks[0]?.payload, text).toBe(payload);
      expect(rejected(after, 'm2bd'), text).toBe(text);
    }
  });

  it('changes each selected block with its own mark, in one group', () => {
    const text = 'One\n\nTwo\n';
    const { changes, markIds } = trackedFormat(text, all(text), block('h2'), ctx());
    expect(markIds).toEqual(['m2bd', 'n8fx']);
    const after = applyChanges(text, changes);
    expect(body(after)).toBe(
      '<!--fmt m2bd was=p-->\n\n## One<!--/m2bd-->\n\n<!--fmt n8fx was=p-->\n\n## Two<!--/n8fx-->\n',
    );
    const { marks } = parse(after).ledger;
    expect(marks['m2bd']?.group).toBe('p7qd');
    expect(marks['n8fx']?.group).toBe('p7qd');
    expect(rejected(rejected(after, 'm2bd'), 'n8fx')).toBe(text);
  });

  it('keeps a CRLF file CRLF', () => {
    const text = 'This paragraph\r\n\r\nLine one\r\nline two\r\n';
    for (const to of ['h2', 'quote', 'ul'] as const) {
      const range = to === 'h2' ? rangeOf(text, 'This') : all(text);
      const after = changed(text, range, block(to));
      expect(after.replace(/\r\n/g, ''), to).not.toContain('\n');
      for (const id of parse(after).marks.map((mark) => mark.id)) {
        expect(rejected(after, id).replace(/\r\n/g, ''), to).not.toContain('\n');
      }
      expect(
        parse(after).marks.reduce((t, mark) => rejected(t, mark.id), after),
        to,
      ).toBe(text);
    }
  });

  it('changes nothing where the block has the type already', () => {
    const text = '## Heading\n';
    expect(trackedFormat(text, all(text), block('h2'), ctx()).changes).toEqual([]);
  });

  it('changes a list item between the types of list where it stands', () => {
    const list = '- a\n- b\n- c\n';
    const numbered = changed(list, rangeOf(list, 'b'), block('ol'));
    expect(body(numbered)).toBe('- a\n1. <!--fmt m2bd was=ul-->\n   b<!--/m2bd-->\n- c\n');
    expect(rejected(numbered, 'm2bd')).toBe(list);
    expect(accepted(numbered, 'm2bd')).toBe('- a\n1. b\n- c\n');
    const tasks = changed(list, all(list), block('task'));
    expect(accepted(tasks, 'm2bd')).toContain('- [ ] a');
    expect(parse(tasks).marks).toHaveLength(3);
    // A nested item stays nested.
    const nested = '- a\n  - b\n';
    expect(accepted(changed(nested, rangeOf(nested, 'b'), block('ol')), 'm2bd')).toBe(
      '- a\n  1. b\n',
    );
    // An item with lines under it keeps them when its bullet gets no wider.
    const parent = '1. a\n   - child\n';
    const bulleted = changed(parent, rangeOf(parent, 'a'), block('ul'));
    expect(accepted(bulleted, 'm2bd')).toBe('- a\n   - child\n');
    expect(rejected(bulleted, 'm2bd')).toBe(parent);
  });

  it('refuses a list type that would read the next item, or the lines under it, otherwise', () => {
    const numbered = '1. a\n2. b\n3. c\n';
    expect(message(() => changed(numbered, rangeOf(numbered, 'b'), block('ul')))).toMatch(
      /numbered item after it/,
    );
    expect(message(() => changed(numbered, rangeOf(numbered, 'b'), block('ul')))).toMatch(
      /Turn off Track Changes to renumber this list/,
    );
    // With Track Changes off, the whole list changes together.
    expect(typed(numbered, all(numbered), block('ul'))).toBe('- a\n- b\n- c\n');
    const parent = '- a\n  - child\n';
    expect(message(() => changed(parent, rangeOf(parent, 'a'), block('ol')))).toMatch(
      /lines under it/,
    );
    // More than five items at a time are too many to check together.
    const six = '- a\n- b\n- c\n- d\n- e\n- f\n';
    const ids = ctx('m2bd', 'n8fx', 'p7qd', 'd3x9', 'g3rp', 'h4kz', 'k3x9', 'b2c3');
    expect(message(() => changed(six, all(six), block('ol'), ids))).toMatch(
      /Change up to five items at a time/,
    );
  });

  it('refuses a block that does not stand on its own, or that is in another block', () => {
    for (const [text, word, to] of [
      ['- a\n- b\n- c\n', 'b', 'p'],
      ['- a\n- b\n', 'b', 'h2'],
      ['Text\n- b\n', 'Text', 'quote'],
      ['## Heading\nText under it.\n', 'Heading', 'p'],
    ] as const) {
      expect(
        message(() => changed(text, rangeOf(text, word), block(to))),
        text,
      ).toContain(ON_ITS_OWN);
    }
    for (const [text, word] of [
      ['- a\n\n  more here\n', 'more'],
      ['> - a\n', 'a'],
      ['> > a\n', 'a'],
    ] as const) {
      expect(
        message(() => changed(text, rangeOf(text, word), block('h2'))),
        text,
      ).toMatch(/inside a list or a quote/);
    }
  });

  it('refuses what it cannot give back the bytes of, or a heading of more than one line', () => {
    expect(
      message(() => changed('Line one\nline two\n', rangeOf('Line one', 'one'), block('h2'))),
    ).toContain('A heading is one line');
    for (const text of ['Title\n===\n', '## Title ##\n', '> a\nb\n', '>a\n']) {
      expect(
        message(() => changed(text, all(text), block('p'))),
        text,
      ).toMatch(/can't change type/);
    }
    expect(
      message(() => changed('| a | b |\n| - | - |\n| c | d |\n', { from: 2, to: 3 }, block('h2'))),
    ).toMatch(/can't change type/);
  });

  it("refuses another person's pending change in the block", () => {
    const text = file('Some <!--ins k3x9-->new <!--/k3x9-->text.', { k3x9: 'bo' });
    expect(message(() => changed(text, rangeOf(text, 'Some'), block('h2')))).toBe(IN_PARAGRAPH);
    expect(message(() => typed(text, rangeOf(text, 'Some'), block('h2')))).toBe(IN_PARAGRAPH);
  });

  it('tries every decision of your own changes in the block with the new mark', () => {
    const text = file('Some <!--ins k3x9-->new <!--/k3x9-->text <!--del n8fx old -->here.', {
      k3x9: 'ada',
      n8fx: 'ada',
    });
    for (const to of ['h2', 'ul', 'quote'] as const) {
      const after = changed(text, rangeOf(text, 'Some'), block(to), ctx('p7qd'));
      expect(expectEveryDecision(to, text, after, ['p7qd'])).toBe(27);
    }
  });

  it('changes your own block change in place', () => {
    const text = 'Text here\n';
    const heading = changed(text, all(text), block('h2'));
    // Back to what it was: the mark goes.
    expect(changed(heading, all(heading), block('p'), ctx('n8fx'))).toBe(text);
    // To a third type: the mark keeps the type it was.
    const smaller = changed(heading, all(heading), block('h3'), ctx('n8fx'));
    expect(parse(smaller).marks.map((mark) => mark.payload)).toEqual(['was=p']);
    expect(accepted(smaller, parse(smaller).marks[0]?.id ?? '')).toBe('### Text here\n');
    expect(rejected(smaller, parse(smaller).marks[0]?.id ?? '')).toBe(text);
    const item = changed(heading, all(heading), block('ul'), ctx('n8fx'));
    expect(parse(item).marks.map((mark) => mark.payload)).toEqual(['was=p']);
    expect(rejected(item, parse(item).marks[0]?.id ?? '')).toBe(text);
    expect(accepted(item, parse(item).marks[0]?.id ?? '')).toBe('- Text here\n');
  });

  it('changes your own quote and list items in place, in a CRLF file too', () => {
    for (const eol of ['\n', '\r\n']) {
      const text = `Line one${eol}line two${eol}`;
      const quoted = changed(text, all(text), block('quote'));
      expect(changed(quoted, all(quoted), block('p'), ctx('n8fx')), eol).toBe(text);
      const item = changed(quoted, all(quoted), block('ul'), ctx('n8fx'));
      const [mark] = parse(item).marks;
      expect(mark?.payload, eol).toBe('was=p');
      expect(rejected(item, mark?.id ?? ''), eol).toBe(text);
      expect(accepted(item, mark?.id ?? ''), eol).toBe(`- Line one${eol}line two${eol}`);
    }
    // Two items of your own, each turned into a task with its mark kept.
    const two = 'One\n\nTwo\n';
    const items = changed(two, all(two), block('ul'));
    const tasks = changed(items, all(items), block('task'), ctx('d3x9'));
    expect(parse(tasks).marks.map((mark) => mark.payload)).toEqual(['was=p', 'was=p']);
    const back = parse(tasks).marks.reduce((t, mark) => rejected(t, mark.id), tasks);
    expect(back).toBe(two);
  });

  it('types the syntax with Track Changes off', () => {
    expect(typed('This paragraph\n', all('This paragraph\n'), block('h2'))).toBe(
      '## This paragraph\n',
    );
    expect(typed('Line one\nline two\n', all('Line one\nline two\n'), block('quote'))).toBe(
      '> Line one\n> line two\n',
    );
    expect(typed('> Line one\n> line two\n', all('> Line one\n'), block('ul'))).toBe(
      '- Line one\nline two\n',
    );
    expect(typed('- a\n- b\n- c\n', rangeOf('- a\n- b\n- c\n', 'b'), block('ol'))).toBe(
      '- a\n1. b\n- c\n',
    );
  });
});

describe('deciding a block change that stands where none can', () => {
  it('accepts it, and refuses to reject it', () => {
    for (const payload of ['was=p', '+check']) {
      const text = file(
        `a <!--fmt m2bd ${payload}-->b${payload === 'was=p' ? '<!--/m2bd-->' : ''} c`,
        {
          m2bd: 'ada',
        },
      );
      expect(accepted(text, 'm2bd'), payload).toBe('a b c\n');
      expect(
        message(() => reject(text, 'm2bd')),
        payload,
      ).toMatch(/no longer has that syntax/);
    }
  });
});

describe('blocks Markdown would read otherwise (format §2.6)', () => {
  it('refuses a line that would start a block of its own in the new block', () => {
    for (const [text, to] of [
      ['Line one\n2. two\n', 'ol'],
      ['Line one\n2. two\n', 'ul'],
      ['Line one\n2. two\n', 'task'],
      ['> a\n> 2. b\n', 'ol'],
      ['# 1. Intro\n', 'p'],
      ['## - x\n', 'p'],
      ['## > x\n', 'p'],
      ['## ---\n', 'p'],
      ['## <div>x</div>\n', 'p'],
      ['[ ] x\n', 'ul'],
      ['## [ ] x\n', 'ol'],
    ] as const) {
      expect(
        message(() => changed(text, all(text), block(to))),
        `${text} to ${to}`,
      ).toMatch(/would start a block of its own/);
    }
    // A lazy line that becomes the next item of a numbered list.
    const lazy = '- a\n2. b\n';
    expect(message(() => changed(lazy, rangeOf(lazy, 'a'), block('ol')))).toMatch(
      /would start a block of its own/,
    );
  });

  it('refuses to make a list item of a block whose indented next block would join it', () => {
    for (const [text, to] of [
      ['Text\n\n  more\n', 'ul'],
      ['Text\n\n   more\n', 'ol'],
      ['Text\n\n    code\n', 'ul'],
      ['## Text\n\n  more\n', 'task'],
    ] as const) {
      expect(
        message(() => changed(text, rangeOf(text, 'Text'), block(to))),
        text,
      ).toMatch(/indented block after it would become part of the item/);
    }
    // Into a quote it stays apart.
    const code = 'Text\n\n    code\n';
    expect(accepted(changed(code, rangeOf(code, 'Text'), block('quote')), 'm2bd')).toBe(
      '> Text\n\n    code\n',
    );
  });

  it('refuses a heading while a pending change adds or takes away a line break', () => {
    for (const edit of [
      { from: 10, to: 11, insert: '' },
      { from: 5, to: 5, insert: '\nnew' },
    ]) {
      const base = 'alpha beta\ngamma\n';
      const text = applyChanges(base, trackedEdit(base, edit, ctx('k3x9', 'g3rp', 'h4kz')));
      expect(
        message(() => changed(text, all(text), block('h2'), ctx('n8fx'))),
        JSON.stringify(edit),
      ).toMatch(/one line|pending change/);
    }
  });

  it('refuses a change of a block while a pending change to a line break stands at its edges', () => {
    // Ada's own deletion of the blank line after the paragraph: with it rejected, the lines after
    // would read as code, or as more of the item.
    for (const [base, to] of [
      ['Text here\n\n    code\n', 'ul'],
      ['Text here\n\n  more text\n', 'ul'],
      ['Text here\n\n   more text\n', 'ol'],
    ] as const) {
      const at = base.indexOf('\n\n');
      const edit = { from: at, to: at + 2, insert: ' ' };
      const text = applyChanges(base, trackedEdit(base, edit, ctx('k3x9')));
      expect(
        message(() => changed(text, { from: 0, to: 4 }, block(to), ctx('n8fx'))),
        base,
      ).toBe(BREAK_PENDING);
    }
    // Ada's own paragraph split after the item before, with blank lines between them.
    const list = '1. a\n2. b\n';
    const split = applyChanges(
      list,
      trackedEdit(list, { from: 4, to: 4, insert: '\n\n' }, ctx('k3x9')),
    );
    expect(bodyOf(split)).toMatch(/^1\. a<!--split k3x9-->\n\n\n2\. b/);
    expect(message(() => changed(split, rangeOf(split, 'b'), indent(1), ctx('n8fx')))).toBe(
      BREAK_PENDING,
    );
    // A break within the block, too.
    const lines = 'one\ntwo\n';
    const joined = applyChanges(
      lines,
      trackedEdit(lines, { from: 3, to: 4, insert: ' ' }, ctx('k3x9')),
    );
    expect(message(() => changed(joined, all(joined), block('quote'), ctx('n8fx')))).toBe(
      BREAK_PENDING,
    );
  });

  it("refuses a line break inside another person's change of a block, and lets them type in a line", () => {
    const base = 'one\ntwo\n\nEnd\n';
    const quote = changed(base, rangeOf(base, 'one'), block('quote'));
    const bos = () => context(bo, ['k3x9', 'h4kz', 'g3rp']);
    const two = quote.indexOf('two');
    for (const edit of [
      // At the start of the second line, which would take the line's `> ` into the change.
      { from: two, to: two, insert: 'x' },
      // A new line, and the break between the two taken away.
      { from: two + 3, to: two + 3, insert: '\nthree' },
      { from: quote.indexOf('one') + 3, to: two, insert: ' ' },
    ]) {
      expect(
        message(() => trackedEdit(quote, edit, bos())),
        JSON.stringify(edit),
      ).toBe("Decide Ada Lovelace's change to this block first.");
    }
    // Within a line it is an edit like any other, decided in any order.
    for (const at of [two + 1, two + 3, quote.indexOf('one') + 3]) {
      const typed = applyChanges(
        quote,
        trackedEdit(quote, { from: at, to: at, insert: 'x' }, bos()),
      );
      expect(applyChanges(typed, rejectAll(typed))).toBe(base);
      for (const quoted of [accepted, rejected]) {
        for (const kept of [accepted, rejected]) {
          const end = kept(quoted(typed, 'm2bd'), 'k3x9');
          expect(quoted(kept(typed, 'k3x9'), 'm2bd'), String(at)).toBe(end);
          expect(body(end).includes('>'), String(at)).toBe(quoted === accepted);
        }
      }
    }
    // Once the change is decided, a line break is fine.
    const done = accepted(quote, 'm2bd');
    const at = done.indexOf('two');
    expect(() => trackedEdit(done, { from: at, to: at, insert: 'x' }, bos())).not.toThrow();
  });

  it("refuses a line break at the edges of another person's change of a block (#87)", () => {
    const DECIDE = "Decide Ada Lovelace's change to this block first.";
    const TAKES_NEXT =
      'A line break at the end of this text would take the start of the block that follows it.';
    const bos = () => context(bo, ['k3x9', 'h4kz', 'g3rp']);
    for (const [base, op] of [
      ['Intro\n\n## Title here\n\nEnd\nmore\n', block('ol')],
      ['Intro\n\n- Title here\n\nEnd\nmore\n', block('p')],
      ['Intro\n\nTitle here\n\nEnd\nmore\n', block('h2')],
      ['Intro\n\nTitle here\n\nEnd\nmore\n', block('quote')],
      ['Intro\n\n- Title here\n\nEnd\nmore\n', block('ol')],
    ] as const) {
      const made = changed(base, rangeOf(base, 'Title here'), op);
      const view = newestView(made);
      const source = (at: number, side: -1 | 1) => view.map.toSource(at, side);
      const line = view.text.lastIndexOf('\n', view.text.indexOf('Title')) + 1;
      const text = view.text.indexOf('Title');
      const end = view.text.indexOf('here') + 4;
      const next = view.text.indexOf('End');
      const label = (what: string) => `${JSON.stringify(base)} ${JSON.stringify(op)} ${what}`;
      for (const [what, edit] of [
        // A line typed after the block's text, on either side of its closer: with the change
        // accepted it can be more of the block, with it rejected a paragraph of its own.
        ['line before closer', { from: source(end, -1), to: source(end, -1), insert: '\nmore' }],
        ['line after closer', { from: source(end, 1), to: source(end, 1), insert: '\nmore' }],
        // Backspace at the start of the next block joins its lines to the block's.
        ['join next', { from: source(next - 1, -1), to: source(next, 1), insert: '' }],
        ['join next whole', { from: source(end, 1), to: source(next, -1), insert: '' }],
        ['join next inside', { from: source(end, -1), to: source(next, -1), insert: '' }],
        // The mirror in front of the opener: the block joined to the one before it.
        ['join before', { from: source(line - 1, -1), to: source(line, -1), insert: '' }],
        ['join before whole', { from: source(line - 2, -1), to: source(line, -1), insert: '' }],
        ['join text before', { from: source(line - 2, -1), to: source(text, -1), insert: '' }],
      ] as const) {
        expect(
          message(() => trackedEdit(made, edit, bos())),
          label(what),
        ).toBe(DECIDE);
      }
      // A line typed in front of the block is refused too, by this rule or by the one for a break
      // that would take the start of the block after it.
      const before = { from: source(line, -1), to: source(line, -1), insert: 'more\n' };
      expect([DECIDE, TAKES_NEXT], label('line in front')).toContain(
        message(() => trackedEdit(made, before, bos())),
      );
      // Words typed at the start of the block's text on the left of its opener go behind it, as
      // they do from its right (format §2.6, and the test below).
      const left = { from: source(text, -1), to: source(text, -1), insert: 'x' };
      const right = { from: source(text, 1), to: source(text, 1), insert: 'x' };
      expect(trackedEdit(made, left, bos()), label('words in front')).toEqual(
        trackedEdit(made, right, bos()),
      );
      // Words typed at the end of the block's text, on either side of its closer, a line added at
      // the end of the block before, and one in front of the next, are edits like any other.
      for (const [what, edit] of [
        ['words before closer', { from: source(end, -1), to: source(end, -1), insert: ' more' }],
        ['words after closer', { from: source(end, 1), to: source(end, 1), insert: ' more' }],
        ['line before block', { from: source(5, -1), to: source(5, -1), insert: '\nmore' }],
        ['line after block', { from: source(next, 1), to: source(next, 1), insert: 'more\n' }],
      ] as const) {
        const typed = applyChanges(made, trackedEdit(made, edit, bos()));
        expect(applyChanges(typed, rejectAll(typed)), label(what)).toBe(base);
        expect(applyChanges(typed, acceptAll(typed)), label(what)).toBe(newestView(typed).text);
        for (const quoted of [accepted, rejected]) {
          for (const kept of [accepted, rejected]) {
            expect(quoted(kept(typed, 'k3x9'), 'm2bd'), label(what)).toBe(
              kept(quoted(typed, 'm2bd'), 'k3x9'),
            );
          }
        }
      }
    }
  });

  it("puts words typed in front of another person's block opener behind it, from either side", () => {
    // The arrow keys and Home leave the caret on the left of the hidden opener at the start of an
    // item's or a quote's text, and an agent's insertion after the words before it lands there too.
    // In front of the opener the words would start the block, and the change could no longer be
    // rejected once they were accepted. They go where the caret on its right puts them.
    const STACKED =
      "This change of a block's type can't be rejected while another change starts the block. Decide that one first.";
    const bos = () => context(bo, ['k3x9', 'h4kz', 'g3rp']);
    for (const [base, op, file, rejectFirst] of [
      [
        'Intro\n\nTitle here\n\nEnd\n',
        block('ul'),
        'Intro\n\n- <!--fmt m2bd was=p-->\n  <!--ins k3x9-->\n  New <!--/k3x9-->Title here<!--/m2bd-->\n\nEnd\n',
        STACKED,
      ],
      [
        'Intro\n\n- Title here\n\nEnd\n',
        block('ol'),
        'Intro\n\n1. <!--fmt m2bd was=ul-->\n   <!--ins k3x9-->\n   New <!--/k3x9-->Title here<!--/m2bd-->\n\nEnd\n',
        STACKED,
      ],
      [
        'Intro\n\n- first\n- Title here\n\nEnd\n',
        block('task'),
        'Intro\n\n- first\n- [ ] <!--fmt m2bd was=ul-->\n  <!--ins k3x9-->\n  New <!--/k3x9-->Title here<!--/m2bd-->\n\nEnd\n',
        STACKED,
      ],
      [
        'Intro\n\nTitle here\n\nEnd\n',
        block('quote'),
        'Intro\n\n> <!--fmt m2bd was=p-->\n>\n> <!--ins k3x9-->\n>\n> New <!--/k3x9-->Title here<!--/m2bd-->\n\nEnd\n',
        STACKED,
      ],
      [
        'Intro\n\n> Title here\n\nEnd\n',
        block('p'),
        'Intro\n\n<!--fmt m2bd was=quote-->\n\n<!--ins k3x9-->\n\nNew <!--/k3x9-->Title here<!--/m2bd-->\n\nEnd\n',
        STACKED,
      ],
      [
        'Intro\n\n## Title here\n\nEnd\n',
        block('p'),
        'Intro\n\n<!--fmt m2bd was=h2-->\n\n<!--ins k3x9-->\n\nNew <!--/k3x9-->Title here<!--/m2bd-->\n\nEnd\n',
        STACKED,
      ],
      [
        '- first\n- Title here\n\nEnd\n',
        indent(1),
        '- first\n  - <!--fmt m2bd was=indent=0-->\n    <!--ins k3x9-->\n    New <!--/k3x9-->Title here<!--/m2bd-->\n\nEnd\n',
        STACKED,
      ],
    ] as const) {
      const label = `${JSON.stringify(base)} ${JSON.stringify(op)}`;
      const made = changed(base, rangeOf(base, 'Title here'), op);
      const view = newestView(made);
      const at = view.text.indexOf('Title here');
      const edit = (side: -1 | 1) => ({
        from: view.map.toSource(at, side),
        to: view.map.toSource(at, side),
        insert: 'New ',
      });
      const typed = applyChanges(made, trackedEdit(made, edit(-1), bos()));
      expect(body(typed), label).toBe(file);
      expect(applyChanges(made, trackedEdit(made, edit(1), bos())), label).toBe(typed);
      // Every order of deciding the two reads as the decisions say. Ada's change is rejected once
      // Bo's insertion is decided, either way; before that, rejecting it is refused and says why.
      const asTyped = base.replace('Title here', 'New Title here');
      const ada = applyChanges(made, acceptAll(made));
      for (const [first, then, end] of [
        [accepted, accepted, newestView(typed).text],
        [accepted, rejected, asTyped],
        [rejected, accepted, ada],
        [rejected, rejected, base],
      ] as const) {
        expect(then(first(typed, 'k3x9'), 'm2bd'), label).toBe(end);
        if (then === accepted) expect(first(accepted(typed, 'm2bd'), 'k3x9'), label).toBe(end);
      }
      expect(
        message(() => reject(typed, 'm2bd')),
        label,
      ).toBe(rejectFirst);
      expect(applyChanges(typed, rejectAll(typed)), label).toBe(base);
      expect(applyChanges(typed, acceptAll(typed)), label).toBe(newestView(typed).text);
    }
  });

  it('reads every order of deciding alike when another person retypes a block under a block change (#87 item 2)', () => {
    // Ada changed a quote into a paragraph, and Bo typed `!` at its end and then retyped it with a
    // paragraph break: a deletion of all its text inside her mark, standing on its own line, and a
    // block of his after her closer. (That edit is refused now, as the break goes into the lines
    // that touched her block; the test of #87 item 3 has it. A file can still hold the form, from
    // before, or from a merge.) Rejecting his insertion and then accepting her change would take
    // away the closer that stood between the deletion's carrier and the paragraph after it, so that
    // rejecting the deletion joined `x gamma` to `End`. That decision is refused, and the others
    // read alike.
    const base = 'Intro\n\n> x gamma\n\nEnd\n';
    const retyped = file(
      'Intro\n\n<!--fmt m2bd was=quote-->\n\n<!--del h4kz x gamma-->\n\n<!--/m2bd--><!--ins k3x9-->\n\nx gamma<!--split g3rp-->\n\ndelta beta<!--/k3x9-->\n\nEnd',
      { m2bd: 'ada', h4kz: 'bo', k3x9: 'bo', g3rp: 'bo' },
    );
    expectEveryOrderAlike('item 2', retyped);
    expect(applyChanges(retyped, acceptAll(retyped))).toBe(
      'Intro\n\nx gamma\n\ndelta beta\n\nEnd\n',
    );
    expect(applyChanges(retyped, rejectAll(retyped))).toBe(base);
    expect(message(() => accepted(rejected(retyped, 'k3x9'), 'm2bd'))).toBe(
      "Decide Bo Chen's deletion next to it first: decided now, this change would join the text of that deletion to the block after it.",
    );
    expect(accepted(rejected(rejected(retyped, 'k3x9'), 'h4kz'), 'm2bd')).toBe(
      'Intro\n\nx gamma\n\nEnd\n',
    );
    // The same with the whole text retyped from the left of her opener (random seed 2476).
    const quote = '> x gamma\n\ndelta beta\n';
    const p = changed(quote, rangeOf(quote, 'x gamma'), block('p'));
    const shown = newestView(p);
    const from = shown.text.indexOf('x gamma');
    const over = {
      from: shown.map.toSource(from, -1),
      to: shown.map.toSource(from + 7, -1),
      insert: 'Other words',
    };
    expectEveryOrderAlike(
      'seed 2476',
      applyChanges(p, trackedEdit(p, over, context(bo, ['h4kz', 'g3rp']))),
    );
  });

  it('refuses a block change where a pending break in a block it touches decides how it reads (#87 item 3)', () => {
    // Bo's split at the start of the item before: accepted, that item is empty and `gamma beta`
    // a paragraph, which `2. delta` can't interrupt; rejected, `2. delta` is the list's second
    // item. Changing it to a bullet would read otherwise as the split is decided.
    const split = file('1. <!--split s3vb-->\ngamma beta\n2. delta', { s3vb: 'bo' });
    expect(message(() => changed(split, rangeOf(split, 'delta'), block('ul'), ctx('n8fx')))).toBe(
      BREAK_PENDING,
    );
    // With a blank line between them, a break in the block before decides nothing about it.
    const apart = file('1. <!--split s3vb-->\ngamma beta\n\nEnd', { s3vb: 'bo' });
    expect(message(() => changed(apart, rangeOf(apart, 'End'), block('h2'), ctx('n8fx')))).toBe(
      'no error',
    );
    // A break in the lines next to her block, not on its own lines, says so.
    const NEXT = "Decide Ada Lovelace's change to the block next to this one first.";
    const bos = () => context(bo, ['k3x9', 'h4kz', 'g3rp', 'd3x9']);
    // Everyday list editing next to Ada's pending change of an item goes through, and reads alike
    // in every order, with her decision changing only her item: Enter (with the list's marker, as
    // the editor types it) in the items around hers, near or far, a soft line break, Backspace
    // joining two items, Enter in the paragraph right above the list, in a nested list, in a task
    // list. What these breaks leave is an item, a line of an item, or a paragraph above the list.
    for (const [base, word, op, edits] of [
      [
        '- alpha one\n- beta two\n- gamma three\n\nEnd\n',
        'beta',
        block('task'),
        [
          ['alpha one', 9, 9, '\n- '],
          ['gamma three', 11, 11, '\n- '],
          ['alpha one', 5, 6, '\n- '],
          ['gamma three', 5, 6, '\n- '],
          ['alpha one', 5, 5, '\n'],
          ['gamma three', 5, 5, '\n'],
        ],
      ],
      [
        '- a1 one\n- a2 two\n- a3 three\n- a4 four\n- beta two\n\nEnd\n',
        'beta',
        indent(1),
        [
          ['a1 one', 2, 3, '\n- '],
          ['a1 one', 6, 9, ''],
        ],
      ],
      [
        'Steps here:\n- one item\n- two item\n\nEnd\n',
        'two',
        block('task'),
        [
          ['Steps here:', 5, 6, '\n'],
          ['Steps here:', 5, 6, '\n\n'],
        ],
      ],
      [
        '- top one\n  - sub a\n  - sub beta\n\nEnd\n',
        'sub beta',
        block('task'),
        [
          ['sub a', 5, 5, '\n  - '],
          ['top one', 7, 7, '\n- '],
        ],
      ],
      [
        '- [ ] alpha one\n- [ ] beta two\n- [ ] gamma\n\nEnd\n',
        'beta',
        block('ul'),
        [['alpha one', 9, 9, '\n- [ ] ']],
      ],
    ] as const) {
      const made = changed(base, rangeOf(base, word), op);
      const view = newestView(made);
      for (const [at, from, to, insert] of edits) {
        const label = `${JSON.stringify(base)} ${JSON.stringify(op)} ${at} ${JSON.stringify(insert)}`;
        const where = view.text.indexOf(at);
        const edit = {
          from: view.map.toSource(where + from, 1),
          to: view.map.toSource(where + to, from === to ? 1 : -1),
          insert,
        };
        const typed = applyChanges(made, trackedEdit(made, edit, bos()));
        expectEveryOrderAlike(label, typed);
        const others = applyChanges(
          typed,
          acceptAll(typed, (mark) => mark.id !== 'm2bd'),
        );
        expectBlocksAs(label, accepted(others, 'm2bd'), rejected(others, 'm2bd'), op, 1);
      }
    }
    // Making the change after such an edit is no different: Ada changes the first item after Bo
    // added one at the end of the list.
    const added = '- alpha one\n- beta two\n';
    const more = applyChanges(
      added,
      trackedEdit(
        added,
        { from: 20, to: 20, insert: '\n- new item' },
        context(bo, ['k3x9', 'h4kz']),
      ),
    );
    expect(message(() => changed(more, rangeOf(more, 'alpha'), block('task'), ctx('n8fx')))).toBe(
      'no error',
    );
    // A paragraph break that leaves a line at the list's column, which ends the list, is refused
    // above an item numbered from 2, now or once the change is rejected: `3.` could not
    // interrupt that paragraph, and would be text (random seed 185). Above a bullet, the item
    // starts a list of its own either way.
    const three = '1. beta alpha gamma\n2. beta gamma\n3. gamma beta\n\nEnd\n';
    const third = changed(three, rangeOf(three, 'gamma beta'), block('ul'));
    let shown = newestView(third);
    const cut = shown.text.indexOf('beta alpha') + 4;
    const paragraph = {
      from: shown.map.toSource(cut, 1),
      to: shown.map.toSource(cut + 1, -1),
      insert: '\n\n',
    };
    expect(message(() => trackedEdit(third, paragraph, bos()))).toBe(NEXT);
    const bullets = '- x beta\n- beta delta delta\n- beta alpha\n\nEnd\n';
    const task = changed(bullets, rangeOf(bullets, 'beta alpha'), block('task'));
    shown = newestView(task);
    const gap = shown.text.indexOf('delta delta') - 1;
    const parts = {
      from: shown.map.toSource(gap, 1),
      to: shown.map.toSource(gap + 1, -1),
      insert: '\n\n',
    };
    expectEveryOrderAlike('bullets', applyChanges(task, trackedEdit(task, parts, bos())));
    // A deletion of a block and the break after it, right before Ada's block, joins the two as the
    // other changes are decided (random seed 1982): refused.
    const base = '1. gamma beta\n2. x alpha alpha\n\n> delta alpha\n> beta gamma\n';
    const ol = changed(base, rangeOf(base, 'delta alpha'), block('ol'));
    shown = newestView(ol);
    const space = shown.text.indexOf('x alpha') + 1;
    const enter = {
      from: shown.map.toSource(space, 1),
      to: shown.map.toSource(space + 1, -1),
      insert: '\n\n',
    };
    const parted = applyChanges(ol, trackedEdit(ol, enter, bos()));
    shown = newestView(parted);
    const from = shown.text.indexOf('alpha alpha');
    const to = shown.text.indexOf('1. delta');
    const join = { from: shown.map.toSource(from, 1), to: shown.map.toSource(to, -1), insert: '' };
    expect(message(() => trackedEdit(parted, join, context(bo, ['d3x9'])))).toBe(NEXT);
    // A paragraph break put into the item before parts it from Ada's item, which touched it: with
    // the break accepted, a paragraph comes between, and `2.` could not start the item there
    // (random seed 6341). The lines that touched her block before the edit count.
    const numbered = '1. gamma gamma\n2. x alpha\n\nEnd\n';
    const box = changed(numbered, rangeOf(numbered, 'x alpha'), block('task'));
    shown = newestView(box);
    const space2 = shown.text.indexOf('gamma gamma') + 5;
    const parting = {
      from: shown.map.toSource(space2, 1),
      to: shown.map.toSource(space2 + 1, -1),
      insert: '\n\n',
    };
    expect(message(() => trackedEdit(box, parting, bos()))).toBe(NEXT);
    // So is a paragraph break put into the text that Bo had typed on the last line of her block,
    // right after her closer, retyping it whole (#87 item 2).
    const quote = 'Intro\n\n> x gamma\n\nEnd\n';
    const p = changed(quote, rangeOf(quote, 'x gamma'), block('p'));
    shown = newestView(p);
    const end = shown.text.indexOf('x gamma') + 7;
    const bang = { from: shown.map.toSource(end, 1), to: shown.map.toSource(end, 1), insert: '!' };
    const typed = applyChanges(p, trackedEdit(p, bang, context(bo, ['k3x9'])));
    shown = newestView(typed);
    const at = shown.text.indexOf('x gamma');
    const retype = {
      from: shown.map.toSource(at, 1),
      to: shown.map.toSource(at + 8, -1),
      insert: 'x gamma\n\ndelta beta',
    };
    expect(message(() => trackedEdit(typed, retype, context(bo, ['h4kz', 'g3rp'])))).toBe(NEXT);
  });

  it("refuses indentation or syntax at a block's start under another person's block change (#87 item 5)", () => {
    const DECIDE = "Decide Ada Lovelace's change to this block first.";
    const bos = () => context(bo, ['k3x9', 'h4kz', 'g3rp']);
    // Four spaces typed at the start of a heading's text: with Ada's change rejected they would
    // make the text code, or go. White space of four columns there is refused, from either side of
    // her opener, as block syntax is; one space, which Markdown reads past, is not (another rule
    // may still refuse it, where a marker would start a line).
    for (const [base, op] of [
      ['Intro\n\nTitle here\n\nEnd\n', block('h2')],
      ['Intro\n\n- Title here\n\nEnd\n', block('ol')],
      ['Intro\n\nTitle here\n\nEnd\n', block('quote')],
    ] as const) {
      const made = changed(base, rangeOf(base, 'Title'), op);
      const view = newestView(made);
      const at = view.text.indexOf('Title');
      for (const side of [-1, 1] as const) {
        for (const [insert, refused] of [
          ['    ', true],
          ['\t', true],
          [' ', false],
        ] as const) {
          const edit = {
            from: view.map.toSource(at, side),
            to: view.map.toSource(at, side),
            insert,
          };
          const label = JSON.stringify([base, op, side, insert]);
          const refusal = message(() => trackedEdit(made, edit, bos()));
          if (refused) expect(refusal, label).toBe(DECIDE);
          else expect(refusal, label).not.toBe(DECIDE);
        }
      }
    }
    // The text of the line is judged as the edit leaves it, not by what is typed: two edits can't
    // come to what one may not. `x    ` typed and then the `x` taken out (his own insertion, so
    // it goes); four spaces typed after `Title` and then `Title` deleted, which some orders of
    // deciding read as code; `1`, `.` and a space typed one at a time.
    const heading2 = 'Intro\n\nTitle here\n\nEnd\n';
    const h2 = changed(heading2, rangeOf(heading2, 'Title'), block('h2'));
    const steps = (text: string, list: readonly [string, number, number, string][]) => {
      let current = text;
      for (const [word, from, to, insert] of list) {
        const view = newestView(current);
        const at = view.text.indexOf(word);
        const edit = {
          from: view.map.toSource(at + from, 1),
          to: view.map.toSource(at + to, from === to ? 1 : -1),
          insert,
        };
        const refusal = message(() =>
          trackedEdit(current, edit, context(bo, ['k3x9', 'h4kz', 'g3rp'])),
        );
        if (refusal !== 'no error') return refusal;
        current = applyChanges(
          current,
          trackedEdit(current, edit, context(bo, ['k3x9', 'h4kz', 'g3rp'])),
        );
      }
      return 'no error';
    };
    expect(
      steps(h2, [
        ['Title', 0, 0, 'x    '],
        ['x    Title', 0, 1, ''],
      ]),
    ).toBe(DECIDE);
    expect(
      steps(h2, [
        ['Title', 5, 5, '    '],
        ['Title', 0, 5, ''],
      ]),
    ).toBe(DECIDE);
    expect(
      steps(h2, [
        ['Title', 0, 0, '1'],
        ['1Title', 1, 1, '.'],
        ['1.Title', 2, 2, ' '],
      ]),
    ).toBe(DECIDE);
    // A deletion at the start of the text that leaves white space there is refused where the text
    // follows a bullet in one reading and not the same way in the other, and a block is under the
    // item: the space would move the item's content, and the block out of the item, once the change
    // is decided one way (random seed 8120). A nested list, right under it or after a blank line, a
    // second paragraph, a quote, a fence, a heading. The word with the space after it can go.
    for (const [base, word, op] of [
      ['- x gamma beta\n  - gamma alpha\n\nEnd\n', 'x', block('task')],
      ['- x gamma beta\n\n  - gamma alpha\n\nEnd\n', 'x', block('task')],
      ['- x gamma beta\n\n  second para\n\nEnd\n', 'x', block('task')],
      ['- Title here\n  > quoted\n\nEnd\n', 'Title', block('task')],
      ['- Title here\n  ```\n  code\n  ```\n\nEnd\n', 'Title', block('task')],
      ['- Title here\n  # Head\n\nEnd\n', 'Title', block('task')],
      ['Intro\n\n- [ ] Title here\n  - sub\n\nEnd\n', 'Title', block('ul')],
    ] as const) {
      const made = changed(base, rangeOf(base, word), op);
      const view = newestView(made);
      const at = view.text.indexOf(`${word} `);
      for (const side of [-1, 1] as const) {
        const edit = {
          from: view.map.toSource(at, side),
          to: view.map.toSource(at + word.length, -1),
          insert: '',
        };
        expect(
          message(() => trackedEdit(made, edit, bos())),
          `${base} ${side}`,
        ).toBe(DECIDE);
      }
      const both = {
        from: view.map.toSource(at, 1),
        to: view.map.toSource(at + word.length + 1, -1),
        insert: '',
      };
      expect(
        message(() => trackedEdit(made, both, bos())),
        base,
      ).toBe('no error');
    }
    // Under an indent change the item keeps its bullet in both readings, so the space moves its
    // content the same way in each: the deletion goes through, and every order reads alike.
    const moved = '- a\n- x gamma beta\n\n  - gamma alpha\n\nEnd\n';
    const indented = changed(moved, rangeOf(moved, 'x gamma'), indent(1));
    let view = newestView(indented);
    let at = view.text.indexOf('x gamma');
    const first = { from: view.map.toSource(at, 1), to: view.map.toSource(at + 1, -1), insert: '' };
    expectEveryOrderAlike('indent', applyChanges(indented, trackedEdit(indented, first, bos())));
    // With nothing under it the space moves nothing, and the word can go; but block syntax typed in
    // front of the space, at the start of the text, is refused (seed 377): the start of a line's
    // text is anywhere in the white space after its prefix.
    const plain = 'alpha beta gamma\n\nEnd\n';
    const item = changed(plain, rangeOf(plain, 'alpha'), block('ul'));
    view = newestView(item);
    at = view.text.indexOf('alpha');
    const word = { from: view.map.toSource(at, 1), to: view.map.toSource(at + 5, -1), insert: '' };
    const gone = applyChanges(item, trackedEdit(item, word, bos()));
    view = newestView(gone);
    expect(view.text.startsWith('-  beta')).toBe(true);
    for (const side of [-1, 1] as const) {
      const hash = {
        from: view.map.toSource(2, side),
        to: view.map.toSource(2, side),
        insert: '# ',
      };
      expect(
        message(() => trackedEdit(gone, hash, context(bo, ['h4kz']))),
        String(side),
      ).toBe(DECIDE);
    }
    // The heading's `#`s taken away (seed 1816). Other rules refuse it as well, with another
    // message: this one pins that the prefix rule speaks first.
    const quote = '> delta x gamma\n\nEnd\n';
    const heading = changed(quote, rangeOf(quote, 'delta'), block('h2'));
    view = newestView(heading);
    const hashes = { from: view.map.toSource(0, 1), to: view.map.toSource(3, -1), insert: '' };
    expect(message(() => trackedEdit(heading, hashes, bos()))).toBe(DECIDE);
    // A word replaced from the left of the opener is replaced behind it, a substitution of the
    // word, and every order of deciding reads alike: as a deletion and an insertion standing at the
    // start of the item's text, a decision left its text with a space in front, which moved the
    // item's content and took the list under it out of the item (random seed 764).
    const under = '- x delta\n  - gamma beta\n\nEnd\n';
    const task = changed(under, rangeOf(under, 'x delta'), block('task'));
    view = newestView(task);
    at = view.text.indexOf('x delta');
    const name = {
      from: view.map.toSource(at, -1),
      to: view.map.toSource(at + 1, -1),
      insert: 'Name',
    };
    const renamed = applyChanges(task, trackedEdit(task, name, bos()));
    expect(body(renamed)).toBe(
      '- [ ] <!--fmt m2bd was=ul-->\n  <!--sub k3x9 x-->\n  Name<!--/k3x9--> delta<!--/m2bd-->\n  - gamma beta\n\nEnd\n',
    );
    expectEveryOrderAlike('seed 764', renamed);
  });

  it("lets another person type at the start of a block's text, or retype it, under a block change", () => {
    const bos = () => context(bo, ['k3x9', 'h4kz', 'g3rp']);
    for (const [base, op] of [
      ['Intro\n\nTitle here\n\nEnd\n', block('ul')],
      ['Intro\n\n- Title here\n\nEnd\n', block('ol')],
      ['Intro\n\n- first\n- Title here\n\nEnd\n', block('task')],
      ['Intro\n\nTitle here\n\nEnd\n', block('quote')],
      ['Intro\n\n> Title here\n\nEnd\n', block('p')],
      ['- first\n- Title here\n\nEnd\n', indent(1)],
    ] as const) {
      const made = changed(base, rangeOf(base, 'Title here'), op);
      const view = newestView(made);
      const at = view.text.indexOf('Title here');
      for (const [to, insert] of [
        [at, 'New '],
        [at + 5, 'Name'],
        [at + 10, 'Other words'],
      ] as const) {
        const label = `${JSON.stringify(base)} ${JSON.stringify(op)} ${insert}`;
        const edit = {
          from: view.map.toSource(at, 1),
          to: to === at ? view.map.toSource(at, 1) : view.map.toSource(to, -1),
          insert,
        };
        const typed = applyChanges(made, trackedEdit(made, edit, bos()));
        expect(applyChanges(typed, rejectAll(typed)), label).toBe(base);
        expect(applyChanges(typed, acceptAll(typed)), label).toBe(newestView(typed).text);
      }
      // A line break typed in the text is still refused.
      const split = {
        from: view.map.toSource(at + 5, 1),
        to: view.map.toSource(at + 6, -1),
        insert: '\n\n',
      };
      expect(
        message(() => trackedEdit(made, split, bos())),
        JSON.stringify(op),
      ).toBe("Decide Ada Lovelace's change to this block first.");
    }
  });

  it("refuses a whole line retyped, or block syntax typed, under another person's block change", () => {
    const DECIDE = "Decide Ada Lovelace's change to this block first.";
    const bos = () => context(bo, ['k3x9', 'h4kz', 'g3rp']);
    // Retyping the whole text of a line of a block of more than one line.
    for (const [base, op] of [
      ['one two\nthree\n\nEnd\n', block('ul')],
      ['one two\nthree\n\nEnd\n', block('quote')],
      ['> one two\n> three\n\nEnd\n', block('ol')],
      ['> one two\n> three\n\nEnd\n', block('ul')],
    ] as const) {
      const made = changed(base, rangeOf(base, 'one'), op);
      const view = newestView(made);
      const from = view.text.indexOf('one');
      const edit = {
        from: view.map.toSource(from, 1),
        to: view.map.toSource(from + 7, -1),
        insert: 'Other words',
      };
      expect(
        message(() => trackedEdit(made, edit, bos())),
        JSON.stringify([base, op]),
      ).toBe(DECIDE);
    }
    // A block of one line can still be retyped.
    const one = changed('> one two\n\nEnd\n', { from: 2, to: 5 }, block('ol'));
    const view = newestView(one);
    const from = view.text.indexOf('one');
    const retyped = {
      from: view.map.toSource(from, 1),
      to: view.map.toSource(from + 7, -1),
      insert: 'Other words',
    };
    expect(() => trackedEdit(one, retyped, bos())).not.toThrow();
    // Block syntax typed at the start of a line's text: rejecting the change would read it as syntax.
    for (const [base, op] of [
      ['Intro\n\n> Title here\n\nEnd\n', block('p')],
      ['Intro\n\n- Title here\n\nEnd\n', block('p')],
      ['Intro\n\n## Title here\n\nEnd\n', block('p')],
      ['Intro\n\n> Title here\n> more words\n\nEnd\n', block('p')],
      ['Intro\n\n## Title here\n\nEnd\n', block('ul')],
    ] as const) {
      const made = changed(base, rangeOf(base, 'Title'), op);
      const shown = newestView(made);
      for (const word of ['Title', 'more']) {
        const at = shown.text.indexOf(word);
        if (at === -1) continue;
        for (const insert of ['# ', '- ', '> ', '1. ', '```', '|']) {
          const edit = { from: shown.map.toSource(at, 1), to: shown.map.toSource(at, 1), insert };
          expect(
            message(() => trackedEdit(made, edit, bos())),
            JSON.stringify([base, op, word, insert]),
          ).toBe(DECIDE);
        }
        // Words typed at the start of the first line are fine. On a later line the change would take
        // the line's break, which is refused as above.
        if (word !== 'Title') continue;
        const words = {
          from: shown.map.toSource(at, 1),
          to: shown.map.toSource(at, 1),
          insert: 'New ',
        };
        expect(
          () => trackedEdit(made, words, bos()),
          JSON.stringify([base, op, word]),
        ).not.toThrow();
      }
    }
  });

  it('lets a change next to a block be, where no break that a view reads comes between them', () => {
    const base = '# Title\n\nFirst para has words.\n\n## Next\n';
    const view = newestView(base).text;
    const first = view.indexOf('First');
    const end = view.indexOf('words.') + 6;
    for (const who of [ada, bo]) {
      for (const [from, to, insert] of [
        [first, first, 'New '],
        [first, first + 5, 'Last'],
        [first, end, 'Other text.'],
        // A new paragraph just before the heading, and a line at the end of the paragraph.
        [end, end, '\n\nNew para.'],
        [end, end, '\nmore line'],
      ] as const) {
        const text = applyChanges(
          base,
          trackedEdit(base, { from, to, insert }, context(who, ['k3x9', 'h4kz', 'g3rp'])),
        );
        const label = `${who.handle} ${JSON.stringify(insert)}`;
        expect(
          message(() => changed(text, rangeOf(text, 'Title'), block('h2'), ctx('n8fx'))),
          label,
        ).toBe('no error');
        expect(
          message(() => changed(text, rangeOf(text, 'Next'), block('h3'), ctx('n8fx'))),
          label,
        ).toBe('no error');
      }
    }
  });

  it('refuses a marker where Markdown would read it otherwise (format §3.1)', () => {
    for (const text of [
      '- [ ] Buy milk\\\n  and bread\n',
      '- [ ] Buy milk  \n  and bread\n',
      '- [ ] Buy [milk](\n  /url) now\n',
      '- [ ] Buy <span\n  class="a">milk</span>\n',
    ]) {
      expect(
        message(() => changed(text, rangeOf(text, 'Buy'), check(true))),
        text,
      ).not.toBe('no error');
    }
    for (const to of ['h2', 'ul', 'quote'] as const) {
      expect(
        message(() => changed('Text\\\n', all('Text\\\n'), block(to))),
        to,
      ).toMatch(/marker can't go/);
    }
  });

  it('refuses a quote that holds other blocks, and an indented paragraph, each in its words', () => {
    for (const text of ['> a\n> - b\n', '> a\n> > b\n']) {
      expect(
        message(() => changed(text, rangeOf(text, 'a'), block('p'))),
        text,
      ).toMatch(/quote that holds a list or another quote/);
    }
    expect(message(() => changed('  Text\n', all('  Text\n'), block('h2')))).toMatch(
      /indented by spaces/,
    );
    expect(message(() => changed('> a\n>\n> b\n', { from: 2, to: 3 }, block('p')))).toBe(
      "A quote of more than one paragraph can't change type.",
    );
  });

  it('refuses to reject a change of type while another change starts the block', () => {
    const item = '- Text here\n';
    const plain = changed(item, all(item), block('p'));
    const at = plain.indexOf('Text');
    const typed = applyChanges(
      plain,
      trackedEdit(plain, { from: at, to: at, insert: 'New ' }, ctx('k3x9')),
    );
    expect(message(() => reject(typed, 'm2bd'))).toMatch(/another change starts the block/);
    // Deciding the insertion first lets it be rejected.
    expect(rejected(rejected(typed, 'k3x9'), 'm2bd')).toBe(item);
    // And formatting the start of that block is refused, as rejecting it could not be done.
    expect(
      message(() =>
        changed(
          plain,
          rangeOf(plain, 'Text'),
          { kind: 'inline', format: 'bold', on: true },
          ctx('n8fx'),
        ),
      ),
    ).not.toBe('no error');
  });

  it('changes only the blocks a range holds text of', () => {
    const list = '- a\n- b\n';
    expect(accepted(changed(list, { from: 0, to: 4 }, block('ol')), 'm2bd')).toBe('1. a\n- b\n');
  });

  it('keeps old syntax that no type could have written, and never throws on it', () => {
    for (const body of [
      '- <!--fmt m2bd was=ul=Hello\\x20world\\x20-->\n  Text<!--/m2bd-->',
      '<!--fmt m2bd was=h2=Oops\\x20-->\n\nText<!--/m2bd-->',
      '<!--fmt m2bd was=p=junk-->\n\n## Text<!--/m2bd-->',
      '<!--fmt m2bd was=h2=#\\x20-->\n\nText<!--/m2bd-->',
      '- a\n  - <!--fmt m2bd was=indent=600000000-->\n    b<!--/m2bd-->',
      '- a\n  - <!--fmt m2bd was=indent=8-->\n    b<!--/m2bd-->',
    ]) {
      const text = file(body, { m2bd: 'ada' });
      expect(
        message(() => reject(text, 'm2bd')),
        body,
      ).not.toBe('no error');
      expect(applyChanges(text, rejectAll(text)), body).toBe(text);
      expect(() => originalView(text), body).not.toThrow();
    }
  });
});

describe('task boxes (format §2.6)', () => {
  it('records a checked box as a point change at the end of the first line', () => {
    const text = '- [ ] Buy milk\n  and bread\n';
    const after = changed(text, rangeOf(text, 'milk'), check(true));
    expect(body(after)).toBe('- [x] Buy milk<!--fmt m2bd +check-->\n  and bread\n');
    expect(rejected(after, 'm2bd')).toBe(text);
    expect(accepted(after, 'm2bd')).toBe('- [x] Buy milk\n  and bread\n');
  });

  it('records an unchecked box, and a box written [X]', () => {
    const done = '- [x] Done\n';
    const open = changed(done, all(done), check(false));
    expect(body(open)).toBe('- [ ] Done<!--fmt m2bd -check-->\n');
    expect(rejected(open, 'm2bd')).toBe(done);
    const capital = '- [X] Done\n';
    const reopened = changed(capital, all(capital), check(false));
    expect(parse(reopened).marks[0]?.payload).toBe('-check=X');
    expect(rejected(reopened, 'm2bd')).toBe(capital);
  });

  it('checks every box in the range, each with its own mark, and leaves the rest', () => {
    const text = '- [ ] One\n- [x] Two\n- Three\n- [ ] Four\n';
    const { markIds, changes } = trackedFormat(text, all(text), check(true), ctx());
    expect(markIds).toEqual(['m2bd', 'n8fx']);
    expect(body(applyChanges(text, changes))).toBe(
      '- [x] One<!--fmt m2bd +check-->\n- [x] Two\n- Three\n- [x] Four<!--fmt n8fx +check-->\n',
    );
    expect(trackedFormat('- Plain\n', all('- Plain\n'), check(true), ctx()).changes).toEqual([]);
    // Another person's change in a block it leaves as it is is not in the way.
    const near = file('Some <!--ins k3x9-->new <!--/k3x9-->text.\n\n- [ ] Box', { k3x9: 'bo' });
    expect(body(changed(near, all(near), check(true)))).toContain(
      '- [x] Box<!--fmt m2bd +check-->',
    );
  });

  it('takes your own box change away when the box goes back', () => {
    const text = '- [ ] Buy milk\n';
    const after = changed(text, all(text), check(true));
    expect(changed(after, all(after), check(false), ctx('n8fx'))).toBe(text);
  });

  it("refuses another person's change in the item, and checks with Track Changes off", () => {
    const text = file('- [ ] Buy <!--ins k3x9-->oat <!--/k3x9-->milk', { k3x9: 'bo' });
    expect(message(() => changed(text, all(text), check(true)))).toBe(IN_PARAGRAPH);
    expect(typed('- [ ] Buy milk\n', all('- [ ] Buy milk\n'), check(true))).toBe(
      '- [x] Buy milk\n',
    );
  });
});

describe('indent (format §2.6)', () => {
  it('records indent as indent=N and restores it', () => {
    const text = '- a\n- b\n';
    const after = changed(text, rangeOf(text, 'b'), indent(1));
    expect(body(after)).toBe('- a\n  - <!--fmt m2bd was=indent=0-->\n    b<!--/m2bd-->\n');
    expect(rejected(after, 'm2bd')).toBe(text);
    expect(accepted(after, 'm2bd')).toBe('- a\n  - b\n');
    const nested = '- a\n  - b\n';
    const out = changed(nested, rangeOf(nested, 'b'), indent(-1));
    expect(body(out)).toBe('- a\n- <!--fmt m2bd was=indent=2-->\n  b<!--/m2bd-->\n');
    expect(rejected(out, 'm2bd')).toBe(nested);
    expect(accepted(out, 'm2bd')).toBe('- a\n- b\n');
  });

  it('moves the lines under an item with it, to the content column of the item before', () => {
    const text = '1. a\n\n2. b\n   - c\n';
    const after = changed(text, rangeOf(text, 'b'), indent(1));
    expect(accepted(after, 'm2bd')).toBe('1. a\n\n   2. b\n      - c\n');
    expect(rejected(after, 'm2bd')).toBe(text);
    const bullets = '- a\n- b\n  - c\n';
    expect(accepted(changed(bullets, rangeOf(bullets, 'b'), indent(1)), 'm2bd')).toBe(
      '- a\n  - b\n    - c\n',
    );
  });

  it('refuses a numbered item that would land right after text, which would read it as text', () => {
    // An ordered item that doesn't start at 1 can't interrupt a paragraph.
    for (const [text, word, by] of [
      ['1. a\n2. b\n', 'b', 1],
      ['1) a\n2) b\n', 'b', 1],
      ['- a\n  1. x\n  2. y\n', 'y', -1],
    ] as const) {
      expect(
        message(() => changed(text, rangeOf(text, word), indent(by))),
        text,
      ).toMatch(/Markdown would read it as part of that text/);
    }
  });

  it('refuses the first item, tabs, and an outdent where there is no room', () => {
    expect(message(() => changed('- a\n- b\n', rangeOf('- a\n', 'a'), indent(1)))).toMatch(
      /first item/,
    );
    expect(
      message(() => changed('- a\n\t- b\n', rangeOf('- a\n\t- b\n', 'b'), indent(-1))),
    ).toMatch(/tab/);
    expect(message(() => changed('- a\n', rangeOf('- a\n', 'a'), indent(-1)))).toMatch(/outdent/);
    expect(message(() => changed('Text\n', all('Text\n'), indent(1)))).toMatch(/list item/);
  });

  it("refuses another person's change in the item it would move", () => {
    const text = file('- a\n- b <!--ins k3x9-->new<!--/k3x9-->', { k3x9: 'bo' });
    expect(message(() => changed(text, rangeOf(text, 'b'), indent(1)))).toBe(IN_PARAGRAPH);
  });

  it('indents with Track Changes off', () => {
    expect(typed('- a\n- b\n', rangeOf('- a\n- b\n', 'b'), indent(1))).toBe('- a\n  - b\n');
  });
});

describe('formatChange', () => {
  it('says what each change did, as what a person would ask for', () => {
    const text = file(
      'a <!--fmt m2bd +bold -italic-->**b**<!--/m2bd--> <!--fmt n8fx -link=u.md-->c<!--/n8fx-->\n\n<!--fmt q2hw was=p-->\n\n## Head<!--/q2hw-->\n\n- [x] Buy<!--fmt p7qd +check-->\n- a\n  - <!--fmt d3x9 was=indent=0-->\n    b<!--/d3x9-->\n\n1. <!--fmt g3rp was=ul-->\n   c<!--/g3rp-->',
      { m2bd: 'ada', n8fx: 'ada', q2hw: 'ada', p7qd: 'ada', d3x9: 'ada', g3rp: 'ada' },
    );
    const parsed = parse(text);
    const done = Object.fromEntries(
      parsed.marks.map((mark) => [mark.id, formatChange(parsed, mark)]),
    );
    expect(done).toEqual({
      m2bd: [
        { kind: 'inline', format: 'bold', on: true },
        { kind: 'inline', format: 'italic', on: false },
      ],
      n8fx: [{ kind: 'link', url: null }],
      q2hw: [{ kind: 'block', to: 'h2' }],
      p7qd: [{ kind: 'check', checked: true }],
      d3x9: [{ kind: 'indent', by: 1 }],
      g3rp: [{ kind: 'block', to: 'ol' }],
    });
  });
});
