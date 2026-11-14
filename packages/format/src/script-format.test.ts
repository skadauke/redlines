// Subscript and superscript (#310, format §2.6): `<sub>` and `<sup>` are inline formats, read and
// written in every file type, and applying or removing one is a format change (`+sub`, `-sup`).

import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { accept, reject } from './decide.ts';
import { EditError } from './errors.ts';
import type { FormatOp, InlineFormat } from './format-ops.ts';
import { parseFormatOps } from './format-ops.ts';
import { trackedFormat, untrackedFormat } from './formatting.ts';
import { parse } from './parse.ts';
import { ada, bodyOf, context, file } from './test-helpers.ts';
import type { Range } from './types.ts';

const inline = (format: InlineFormat, on: boolean): FormatOp => ({ kind: 'inline', format, on });
const clear: FormatOp = { kind: 'clear' };
const ctx = (id = 'm2bd') => context(ada, [id]);

/** The range of `word` in `text`. */
function rangeOf(text: string, word: string, after = 0): Range {
  const from = text.indexOf(word, after);
  if (from === -1) throw new Error(`${word} is not in the text`);
  return { from, to: from + word.length };
}

/** A tracked format change, as the new file. */
const format = (text: string, range: Range, op: FormatOp, c = ctx()): string =>
  applyChanges(text, trackedFormat(text, range, op, c).changes);

/** The body of a file, ending in one line break: a ledger leaves a blank line in front of it. */
const body = (text: string) => `${bodyOf(text).replace(/[\r\n]+$/, '')}\n`;

const rejected = (text: string, id: string) => applyChanges(text, reject(text, id));
const accepted = (text: string, id: string) => applyChanges(text, accept(text, id));

const codeOf = (run: () => unknown): string => {
  try {
    run();
  } catch (error) {
    if (error instanceof EditError) return error.code ?? 'no code';
    throw error;
  }
  return 'no error';
};

const TAGS = [
  ['sub', '<sub>', '</sub>'],
  ['sup', '<sup>', '</sup>'],
] as const;

describe('subscript and superscript as format changes (#310)', () => {
  const text = 'Plain text here.\n';
  const range = { from: 6, to: 10 };

  it('adds each as a format change, written with its tags', () => {
    for (const [name, open, close] of TAGS) {
      const after = format(text, range, inline(name, true));
      expect(body(after), name).toBe(
        `Plain <!--fmt m2bd +${name}-->${open}text${close}<!--/m2bd--> here.\n`,
      );
      expect(parse(after).ledger.marks['m2bd'], name).toEqual({
        by: 'ada',
        at: '2026-10-31T09:00Z',
      });
    }
  });

  it('rejecting gives back the exact bytes, and accepting leaves the tags', () => {
    for (const [name, open, close] of TAGS) {
      const after = format(text, range, inline(name, true));
      expect(rejected(after, 'm2bd'), name).toBe(text);
      expect(accepted(after, 'm2bd'), name).toBe(`Plain ${open}text${close} here.\n`);
    }
  });

  it('removes each as -sub and -sup, and rejecting brings the tags back', () => {
    for (const [name, open, close] of TAGS) {
      const source = `Plain ${open}text${close} here.\n`;
      // The text, part of it, or the tags and all.
      for (const selected of [
        rangeOf(source, 'text'),
        rangeOf(source, 'te'),
        rangeOf(source, `${open}text${close}`),
      ]) {
        const after = format(source, selected, inline(name, false));
        expect(body(after), name).toBe(`Plain <!--fmt m2bd -${name}-->text<!--/m2bd--> here.\n`);
        expect(rejected(after, 'm2bd'), name).toBe(source);
        expect(accepted(after, 'm2bd'), name).toBe(text);
      }
    }
  });

  it('turning off your own pending +sub takes the mark away, and so does turning it on again', () => {
    const on = format(text, range, inline('sub', true));
    const off = trackedFormat(on, rangeOf(on, 'text'), inline('sub', false), ctx('z9z9'));
    expect(applyChanges(on, off.changes)).toBe(text);
    expect(off.markIds).toEqual([]);

    const source = 'Plain <sup>text</sup> here.\n';
    const removed = format(source, rangeOf(source, 'text'), inline('sup', false));
    expect(format(removed, rangeOf(removed, 'text'), inline('sup', true), ctx('z9z9'))).toBe(
      source,
    );
  });

  it('asks nothing when the text already is as asked', () => {
    const source = 'Plain <sub>text</sub> here.\n';
    expect(
      trackedFormat(source, rangeOf(source, 'text'), inline('sub', true), ctx()).changes,
    ).toEqual([]);
    expect(trackedFormat(text, range, inline('sub', false), ctx()).changes).toEqual([]);
  });

  it('reads only the tags in lowercase with no attributes', () => {
    // Any other tag shows as written, and is no format that these commands know.
    for (const source of [
      'Plain <SUB>text</SUB> here.\n',
      'Plain <sub class="x">text</sub> here.\n',
      'Plain <sub >text</sub> here.\n',
      'Plain <sub>text</SUB> here.\n',
    ]) {
      const changes = trackedFormat(source, rangeOf(source, 'text'), inline('sub', false), ctx());
      expect(changes.changes, source).toEqual([]);
    }
  });

  it('reads no pair that is in code or a comment, an image, an address, or is escaped', () => {
    for (const source of [
      'Plain \\<sub>text</sub> here.\n',
      'Plain `<sub>text</sub>` here.\n',
      'Plain <!-- <sub>text</sub> --> here.\n',
      'Plain ![a <sub>b</sub>](x.png) here.\n',
      'Plain [a](x<sub>y</sub>) here.\n',
      // The tags of a pair stand on both sides of the edge of a link, or of a cell.
      'Plain [a <sub>b](u) c</sub> here.\n',
      'Plain <sub>[a</sub> b](u) here.\n',
      '| a <sub>b | c</sub> |\n| - | - |\n| d | e |\n',
      // Or cross the syntax of another format.
      'Plain *a <sub>b* c</sub> here.\n',
      'Plain <sub>a *b</sub> c* here.\n',
    ]) {
      const all = { from: 0, to: source.length - 1 };
      const changes = trackedFormat(source, all, inline('sub', false), ctx());
      expect(changes.changes, source).toEqual([]);
    }
  });

  it('reads a pair in the text of a link, in emphasis, and in a cell of a table', () => {
    for (const source of [
      'Plain [a <sub>b</sub> c](u) here.\n',
      'Plain *a <sub>b</sub> c* here.\n',
      '| a <sub>b</sub> | c |\n| - | - |\n| d | e |\n',
    ]) {
      const at = source.indexOf('>b<') + 1;
      const after = format(source, { from: at, to: at + 1 }, inline('sub', false));
      expect(body(after), source).toBe(
        source.replace('<sub>b</sub>', '<!--fmt m2bd -sub-->b<!--/m2bd-->'),
      );
      expect(rejected(after, 'm2bd'), source).toBe(source);
    }
  });

  it('reads tags that are not paired as text, and pairs them as HTML does', () => {
    const open = 'Plain <sub>text here.\n';
    expect(trackedFormat(open, rangeOf(open, 'text'), inline('sub', false), ctx()).changes).toEqual(
      [],
    );
    // The nearest closer closes the nearest opener, and turning the format off takes the whole run,
    // each layer in a mark of its own.
    const nested = 'a <sub>b <sub>c</sub> d</sub> e\n';
    const after = format(
      nested,
      rangeOf(nested, 'c'),
      inline('sub', false),
      context(ada, ['m2bd', 'n3cf', 'p4dg', 'q5fh']),
    );
    expect(parse(after).marks).toHaveLength(2);
    expect(body(after).replace(/<!--[^]*?-->/g, '')).toBe('a b c d e\n');
    expect(rejected(rejected(after, 'm2bd'), 'n3cf')).toBe(nested);
  });

  it('puts a format around all of another outside its syntax', () => {
    const source = 'Plain <sub>text</sub> here.\n';
    const sup = format(source, rangeOf(source, 'text'), inline('sup', true));
    expect(body(sup)).toBe(
      'Plain <!--fmt m2bd +sup--><sup><sub>text</sub></sup><!--/m2bd--> here.\n',
    );
    expect(rejected(sup, 'm2bd')).toBe(source);

    const bold = format(source, rangeOf(source, 'text'), {
      kind: 'inline',
      format: 'bold',
      on: true,
    });
    expect(body(bold)).toBe('Plain <!--fmt m2bd +bold-->**<sub>text</sub>**<!--/m2bd--> here.\n');
    expect(rejected(bold, 'm2bd')).toBe(source);

    const emphasized = 'Plain *text* here.\n';
    const sub = format(emphasized, rangeOf(emphasized, 'text'), inline('sub', true));
    expect(body(sub)).toBe('Plain <!--fmt m2bd +sub--><sub>*text*</sub><!--/m2bd--> here.\n');
    expect(rejected(sub, 'm2bd')).toBe(emphasized);
  });

  it('cuts the tags at the edge of another format, as any format is', () => {
    const source = 'one **two three** four\n';
    const after = format(source, { from: 0, to: source.length - 1 }, inline('sub', true));
    expect(rejected(after, 'm2bd')).toBe(source);
    expect(accepted(after, 'm2bd')).toBe('<sub>one **two three** four</sub>\n');
  });

  it('is cleared by Clear Formatting, with the other formats', () => {
    const source = 'Plain <sub>**text**</sub> here.\n';
    const after = format(source, rangeOf(source, 'text'), clear);
    expect(body(after)).toBe('Plain <!--fmt m2bd -sub -bold-->text<!--/m2bd--> here.\n');
    expect(rejected(after, 'm2bd')).toBe(source);
  });

  it('is refused inside code, as every format but code is', () => {
    const source = 'Plain `code text` here.\n';
    expect(
      codeOf(() => trackedFormat(source, rangeOf(source, 'code'), inline('sub', true), ctx())),
    ).toBe('inside-code');
  });

  it('keeps the text of a tag whole: a selection that starts or ends inside one reaches over it', () => {
    const source = 'Plain <sub>text</sub> here.\n';
    // Starting inside `<sub>`, and ending in `here`.
    const starts = format(source, { from: 9, to: rangeOf(source, 'here').to }, inline('sup', true));
    expect(body(starts)).toBe(
      'Plain <!--fmt m2bd +sup--><sup><sub>text</sub> here</sup><!--/m2bd-->.\n',
    );
    expect(rejected(starts, 'm2bd')).toBe(source);
    expect(accepted(starts, 'm2bd')).toBe('Plain <sup><sub>text</sub> here</sup>.\n');
    // Ending inside `</sub>`.
    const ends = format(source, { from: 0, to: source.indexOf('</sub>') + 3 }, inline('sup', true));
    expect(body(ends)).toBe(
      '<!--fmt m2bd +sup-->\n\n<sup>Plain <sub>text</sub></sup><!--/m2bd--> here.\n',
    );
    expect(rejected(ends, 'm2bd')).toBe(source);
    // Starting in one tag and ending in another.
    const both = format(source, { from: 9, to: source.indexOf('</sub>') + 3 }, inline('sup', true));
    expect(body(both)).toBe(
      'Plain <!--fmt m2bd +sup--><sup><sub>text</sub></sup><!--/m2bd--> here.\n',
    );
    expect(rejected(both, 'm2bd')).toBe(source);
  });

  it('writes the tags with Track Changes off, and takes them off', () => {
    for (const [name, open, close] of TAGS) {
      const changes = untrackedFormat(text, range, inline(name, true), { author: ada });
      const written = applyChanges(text, changes);
      expect(written, name).toBe(`Plain ${open}text${close} here.\n`);
      const back = untrackedFormat(written, rangeOf(written, 'text'), inline(name, false), {
        author: ada,
      });
      expect(applyChanges(written, back), name).toBe(text);
    }
  });

  it('holds across a line break inside the text', () => {
    const source = 'one two\nthree four\n';
    const after = format(source, { from: 4, to: 13 }, inline('sub', true));
    expect(body(after)).toBe('one <!--fmt m2bd +sub--><sub>two\nthree</sub><!--/m2bd--> four\n');
    expect(rejected(after, 'm2bd')).toBe(source);
  });

  it('is read as an operation with an inverse, for views and decisions', () => {
    for (const name of ['sub', 'sup'] as const) {
      const [added] = parseFormatOps(`+${name}`);
      expect(added?.inverse, name).toEqual({ kind: 'inline', format: name, on: false });
      const [removed] = parseFormatOps(`-${name}`);
      expect(removed?.inverse, name).toEqual({ kind: 'inline', format: name, on: true });
    }
  });

  it('is decided inside a pending insertion of someone else only after that is decided', () => {
    const source = file('Plain <!--ins k3x9-->new text<!--/k3x9--> here.', { k3x9: 'bo' });
    expect(
      codeOf(() => trackedFormat(source, rangeOf(source, 'new'), inline('sub', true), ctx())),
    ).toBe('no-legal-placement');
  });
});

describe('a pair that is written must read as a pair (#310 review)', () => {
  const refusedBy = (run: () => unknown): string => {
    try {
      run();
    } catch (error) {
      if (error instanceof EditError) return `${error.code ?? 'no code'}: ${error.message}`;
      throw error;
    }
    return 'written';
  };
  const plain = (source: string, selected: string | Range, op: FormatOp) =>
    refusedBy(() =>
      untrackedFormat(
        source,
        typeof selected === 'string' ? rangeOf(source, selected) : selected,
        op,
        {
          author: ada,
        },
      ),
    );
  const tracked = (source: string, selected: string | Range, op: FormatOp) =>
    refusedBy(() =>
      trackedFormat(
        source,
        typeof selected === 'string' ? rangeOf(source, selected) : selected,
        op,
        ctx(),
      ),
    );

  it('is refused where the text ends in a backslash, which would escape the closing tag', () => {
    const source = 'a b\\ c\n';
    expect(plain(source, 'b\\', inline('sub', true))).toMatch(/^no-legal-placement/);
    expect(tracked(source, 'b\\', inline('sub', true))).toMatch(/^no-legal-placement/);
    // The same in the text of your own insertion, which takes the syntax as typed.
    const own = file('Plain <!--ins k3x9-->new b\\ text<!--/k3x9--> here.', { k3x9: 'ada' });
    expect(tracked(own, 'b\\', inline('sup', true))).toMatch(/^no-legal-placement/);
  });

  it('takes a backslash in front of the text into the pair, so that it escapes nothing', () => {
    const source = 'a \\b c\n';
    const written = applyChanges(
      source,
      untrackedFormat(source, rangeOf(source, 'b'), inline('sub', true), { author: ada }),
    );
    expect(written).toBe('a <sub>\\b</sub> c\n');
    const after = format(source, rangeOf(source, 'b'), inline('sup', true));
    expect(body(after)).toBe('a <!--fmt m2bd +sup--><sup>\\b</sup><!--/m2bd--> c\n');
    expect(rejected(after, 'm2bd')).toBe(source);
  });

  it('is refused with words about the tag where the text holds a tag with no pair', () => {
    for (const [source, selected] of [
      ['a </sub> b\n', 'a </sub> b'],
      ['x y <sub>\n', 'y <sub>'],
      ['x </sub> y\n', '</sub> y'],
      ['<sub>a b\n', '<sub>a b'],
      ['a <sup> b </sup> c </sup> d\n', 'a <sup> b </sup> c </sup>'],
    ] as const) {
      const name = source.includes('<sup>') ? 'sup' : 'sub';
      for (const run of [plain, tracked]) {
        expect(run(source, selected, inline(name, true)), source).toMatch(
          /^no-legal-placement: .*tag without its pair/,
        );
      }
    }
    const own = file('Plain <!--ins k3x9-->new </sub> text<!--/k3x9--> here.', { k3x9: 'ada' });
    expect(tracked(own, 'new </sub> text', inline('sub', true))).toMatch(/tag without its pair/);
  });

  it('writes a pair around a text that holds whole pairs of another tag, and leaves a stray one outside', () => {
    const source = 'a <sup>b</sup> c </sub> d\n';
    const after = format(source, rangeOf(source, 'a <sup>b</sup> c'), inline('sub', true));
    expect(body(after)).toBe(
      '<!--fmt m2bd +sub-->\n\n<sub>a <sup>b</sup> c</sub><!--/m2bd--> </sub> d\n',
    );
    expect(rejected(after, 'm2bd')).toBe(source);
  });

  it('reads an escaped tag as text: no pair, no format, and no atom', () => {
    const source = 'a \\<sub>b</sub> c\n';
    expect(
      trackedFormat(source, rangeOf(source, 'b'), inline('sub', false), ctx()).changes,
    ).toEqual([]);
  });
});
