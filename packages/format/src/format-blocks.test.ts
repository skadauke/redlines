import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { accept, reject } from './decide.ts';
import { EditError } from './errors.ts';
import type { BlockType, FormatOp } from './format-ops.ts';
import { trackedFormat, untrackedFormat } from './formatting.ts';
import { parse } from './parse.ts';
import { ada, bodyOf, context, expectEveryDecision, file } from './test-helpers.ts';
import type { EditContext, Range } from './types.ts';

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

/** A tracked format change, as the new file. */
function changed(text: string, range: Range, op: FormatOp, c: EditContext = ctx()): string {
  return applyChanges(text, trackedFormat(text, range, op, c).changes);
}

/** The same with Track Changes off. */
const typed = (text: string, range: Range, op: FormatOp) =>
  applyChanges(text, untrackedFormat(text, range, op, { author: ada }));

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
    const parent = '- a\n  - child\n';
    expect(message(() => changed(parent, rangeOf(parent, 'a'), block('ol')))).toMatch(
      /lines under it/,
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
    const text = '1. a\n2. b\n   - c\n';
    const after = changed(text, rangeOf(text, 'b'), indent(1));
    expect(accepted(after, 'm2bd')).toBe('1. a\n   2. b\n      - c\n');
    expect(rejected(after, 'm2bd')).toBe(text);
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
