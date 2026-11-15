// The widened replacement (format §3.12): an edit that no fine form writes soundly is the
// substitution of the smallest unit that holds it, with other people's pending changes in its old
// text. Each case reads alike in every order of decisions (micromark 4.0.2 with GFM), rejecting the
// replacement gives the file before the edit byte for byte, and accepting it the intended text.

import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { accept, reject } from './decide.ts';
import { readsAsNewest, expectSound } from './oracle.ts';
import { parse } from './parse.ts';
import { ada, bo, bodyOf, context, file } from './test-helpers.ts';
import { newestView, originalView } from './views.ts';
import { Untrackable, WIDEN_MOST_BLOCKS, widen } from './widen.ts';
import type { TextChange } from './types.ts';

/** The edit that replaces `find`, as the newest view reads, with `insert`. */
function replacing(text: string, find: string, insert: string): TextChange[] {
  const view = newestView(text).text;
  const from = view.indexOf(find);
  if (from < 0) throw new Error(`"${find}" is not in the newest text`);
  return [{ from, to: from + find.length, insert }];
}

/** Widens the edit, and holds the result to what the format says of every replacement. */
function check(label: string, text: string, find: string, insert: string, kind: string) {
  const edits = replacing(text, find, insert);
  const wanted = applyChanges(newestView(text).text, edits);
  const done = widen(text, edits, context(ada, ['r2zd']));
  expect(done.unit.kind, label).toBe(kind);
  const after = done.text;
  expect(applyChanges(text, done.changes), label).toBe(after);
  expect(parse(after).warnings, label).toEqual([]);
  expect(newestView(after).text.replace(/\n+$/, ''), label).toBe(wanted.replace(/\n+$/, ''));
  expect(originalView(after).text, label).toBe(originalView(text).text);
  expect(readsAsNewest(after), `${label}: reads as the newest text`).toBe(true);
  expectSound(label, after);
  // Rejecting it gives the file before the edit, byte for byte.
  const rejected = applyChanges(after, reject(after, done.id));
  // A ledger that holds no mark, comment or setting is not kept, so a file with none comes back
  // without it.
  if (parse(text).marks.length > 0) expect(rejected, label).toBe(text);
  else expect(rejected, label).toBe(`${bodyOf(text).replace(/\n+$/, '')}\n`);
  // Accepting it gives the new text, whatever was decided inside.
  const accepted = applyChanges(after, accept(after, done.id));
  // The marks in the unit go with it; the others stay pending.
  expect(
    parse(accepted).marks.map((mark) => mark.id),
    label,
  ).toEqual(
    parse(text)
      .marks.map((mark) => mark.id)
      .filter((mark) => !done.held.includes(mark)),
  );
  expect(newestView(accepted).text.replace(/\n+$/, ''), label).toBe(wanted.replace(/\n+$/, ''));
  return done;
}

describe('widening an edit to the unit that holds it', () => {
  it('a paragraph that another person changed, made a heading', () => {
    const body =
      'Intro.\n\n<!--ins k3x9-->\n\nFast <!--/k3x9-->importer ships <!--del w2rf very -->April.\n\nOutro.';
    const text = file(body, { k3x9: 'bo', w2rf: 'bo' });
    const done = check(
      'heading',
      text,
      'Fast importer ships April.',
      '## Fast importer ships April.',
      'block',
    );
    expect(done.held).toEqual(['k3x9', 'w2rf']);
  });

  it('a paragraph with no other marks', () => {
    const text = file('Intro.\n\nThe importer ships in April.\n\nOutro.');
    check('plain', text, 'ships in April', 'ships in May, after the review', 'block');
  });
});

describe('every kind of unit', () => {
  it('a table that another person changed, rewritten', () => {
    const table = [
      '| Fruit | Count |',
      '| ----- | ----- |',
      '| Apples | <!--ins k3x9-->3<!--/k3x9--> |',
      '| Pears | 5 |',
    ];
    const text = file(`Intro.\n\n${table.join('\n')}\n\nOutro.`, { k3x9: 'bo' });
    const done = check('table', text, 'Pears | 5', 'Pears | 6', 'table');
    expect(done.held).toEqual(['k3x9']);
  });

  it('a quote paragraph', () => {
    const text = file('Intro.\n\n> Quoted <!--ins k3x9-->text<!--/k3x9--> here.\n\nOutro.', {
      k3x9: 'bo',
    });
    check('quote', text, 'Quoted text here', '# Quoted text here', 'block');
  });

  it('an item of a loose list, with its bullet outside', () => {
    const text = file('- one <!--ins k3x9-->two<!--/k3x9-->\n\n- three\n\nOutro.', { k3x9: 'bo' });
    check('loose item', text, 'one two', '## one two', 'block');
  });

  it('an item of a tight list, with its bullet outside', () => {
    const text = file('Intro.\n\n- one <!--ins k3x9-->two<!--/k3x9-->\n- three\n\nOutro.', {
      k3x9: 'bo',
    });
    check('tight item', text, 'one two', '## one two', 'block');
  });

  it('code that starts an item of a tight list goes up to the list (format 12.3)', () => {
    const text = file(
      'Intro.\n\n- ```js\n  let a = 1;\n  ```\n- two <!--ins k3x9-->more<!--/k3x9-->\n\nOutro.',
      { k3x9: 'bo' },
    );
    const done = check('tight code', text, 'let a = 1;', 'let a = 2;', 'list');
    expect(done.unit.rung).toBeGreaterThan(0);
  });

  it('a fenced block of code', () => {
    const text = file(
      'Intro.\n\n```js\nlet a = 1;\n```\n\nOutro. <!--ins k3x9-->More.<!--/k3x9-->',
      { k3x9: 'bo' },
    );
    check('code', text, 'let a = 1;', 'let a = 2;', 'code');
  });
});

describe('CRLF files', () => {
  const crlf = (text: string) => text.replaceAll('\n', '\r\n');

  it('a paragraph, a table and a list item come back byte for byte, in the file’s line breaks', () => {
    const table = [
      '| Fruit | Count |',
      '| ----- | ----- |',
      '| Apples | <!--ins k3x9-->3<!--/k3x9--> |',
      '| Pears | 5 |',
    ];
    const cases: [string, string, string, string][] = [
      [
        'Intro.\n\n<!--ins k3x9-->\n\nFast <!--/k3x9-->importer ships.\n\nOutro.',
        'Fast importer',
        '## Fast importer',
        'block',
      ],
      [`Intro.\n\n${table.join('\n')}\n\nOutro.`, 'Pears | 5', 'Pears | 6', 'table'],
      [
        'Intro.\n\n- one <!--ins k3x9-->two<!--/k3x9-->\n- three\n\nOutro.',
        'one two',
        '## one two',
        'block',
      ],
      [
        'Intro.\n\n```js\nlet a = 1;\n```\n\nOutro <!--ins k3x9-->more<!--/k3x9-->.',
        'let a = 1;',
        'let a = 2;\nlet b;',
        'code',
      ],
    ];
    for (const [body, find, insert, kind] of cases) {
      const text = crlf(file(body, { k3x9: 'bo' }));
      const done = widen(text, replacing(text, find, crlf(insert)), context(ada, ['r2zd']));
      expect(done.unit.kind).toBe(kind);
      expect(applyChanges(applyChanges(text, done.changes), reject(done.text, done.id))).toBe(text);
      expect(done.text.replace(/\r\n/g, '').includes('\n')).toBe(false);
    }
  });
});

describe('stacked replacements (format §3.12, Editing it)', () => {
  it('another person’s edit in the new text is written inside the first replacement', () => {
    const text = file('Intro.\n\nThe importer ships in April.\n\nOutro.');
    const first = widen(
      text,
      replacing(text, 'ships in April', 'ships in May'),
      context(ada, ['r2zd']),
    );
    const second = widen(
      first.text,
      replacing(first.text, 'May', 'June, after the review'),
      context(bo, ['s3vb']),
    );
    expect(parse(second.text).marks.map((mark) => mark.id)).toEqual(['r2zd', 's3vb']);
    expect(second.text).toContain('<!--/s3vb--><!--/r2zd-->');
    expect(applyChanges(first.text, second.changes)).toBe(second.text);
    expect(parse(second.text).warnings).toEqual([]);
    expect(readsAsNewest(second.text)).toBe(true);
    expectSound('stacked', second.text);
    // Rejecting the second gives the first back, byte for byte; rejecting the first takes both.
    expect(applyChanges(second.text, reject(second.text, 's3vb'))).toBe(first.text);
    expect(applyChanges(second.text, reject(second.text, 'r2zd')).trimEnd()).toBe(
      bodyOf(text).trimEnd(),
    );
    // Accepting the first leaves the second pending, with the first's new text as its old text.
    const left = applyChanges(second.text, accept(second.text, 'r2zd'));
    expect(parse(left).marks.map((mark) => [mark.id, mark.payload])).toEqual([
      ['s3vb', 'The importer ships in May.'],
    ]);
  });
});

describe('what the review found', () => {
  /** What widen writes reads as its newest view, or it says it is untrackable. */
  function soundOrUntrackable(label: string, text: string, find: string, insert: string) {
    let done;
    try {
      done = widen(text, replacing(text, find, insert), context(ada, ['r2zd']));
    } catch (error) {
      expect(error, label).toBeInstanceOf(Untrackable);
      return;
    }
    expect(parse(done.text).warnings, label).toEqual([]);
    expect(readsAsNewest(done.text), `${label}: reads as the newest text`).toBe(true);
    expectSound(label, done.text);
  }

  it('a deleted unclosed comment opener does not take the ledger into the views', () => {
    const text = file('Hello <!--del k3x9 <!-\\- -->world, see the note.', { k3x9: 'ada' });
    expect(originalView(text).text).toBe('Hello <!-- world, see the note.\n');
    expect(applyChanges(text, reject(text, 'k3x9'))).toContain('Hello <!-- world');
    expect(parse(text).payloads).toEqual([]);
  });

  it('widening ends, where closure brings the unit back down', () => {
    const body = '<!--sub v5jj a-b <sup>-->\n\n- **p><!--/v5jj-->*alpha*</sup>';
    const text = file(body, { v5jj: 'bo' });
    const view = newestView(text).text;
    const run = () =>
      widen(
        text,
        [{ from: 3, to: Math.min(15, view.length), insert: '<!--' }],
        context(ada, ['r2zd']),
      );
    try {
      run();
    } catch (error) {
      expect(error).toBeInstanceOf(Untrackable);
    }
  });

  it.each([
    ['indented code', '\t'],
    ['indented code of spaces', '    beta'],
    ['a setext underline', 'x\n==='],
    ['a heading with closing #s', '# H #'],
    ['a link reference definition', '[x]: http://a.b "t"'],
    ['a table with no body rows', '| a | b |\n| - | - |'],
    ['an HTML line', '<br>'],
    ['a thematic break', '---'],
  ])('new text that is %s is written as it reads, or is untrackable', (name, insert) => {
    const top = file('Intro.\n\nbeta <!--ins k3x9-->big<!--/k3x9--> x.\n\nOutro.', { k3x9: 'bo' });
    soundOrUntrackable(`${name} (top)`, top, 'beta big x.', insert);
    const plain = file('Intro.\n\nbeta x.\n\nOutro.');
    soundOrUntrackable(`${name} (plain)`, plain, 'beta x.', insert);
    const item = file('- one\n- two <!--ins k3x9-->big<!--/k3x9-->', { k3x9: 'bo' });
    soundOrUntrackable(`${name} (last item)`, item, 'two big', insert);
    const quote = file('> a <!--ins k3x9-->big<!--/k3x9--> b\n\nOutro.', { k3x9: 'bo' });
    soundOrUntrackable(`${name} (quote)`, quote, 'a big b', insert);
  });

  it('a mark decided in the old text of a unit in a quote keeps the quote’s prefix', () => {
    const text = file('> <!--sub k8s3 text del-->\n> zz<!--/k8s3-->ta\n> more\n', { k8s3: 'bo' });
    const done = widen(text, replacing(text, 'more', '# MORE'), context(ada, ['r2zd']));
    const through = applyChanges(
      applyChanges(done.text, accept(done.text, 'k8s3')),
      reject(applyChanges(done.text, accept(done.text, 'k8s3')), done.id),
    );
    const rejected = applyChanges(done.text, reject(done.text, done.id));
    expect(through).toBe(applyChanges(rejected, accept(rejected, 'k8s3')));
  });
});

describe('what the second review found', () => {
  it('a closer is not written after indented code that a tag leads into', () => {
    const text = file('<!--sub vhb2 beta-->\n\né H<sub>a-b</sub>O<!--/vhb2--> tail\n', {
      vhb2: 'bo',
    });
    let done;
    try {
      done = widen(text, replacing(text, 'é H<sub', '    '), context(ada, ['r2zd']));
    } catch (error) {
      expect(error).toBeInstanceOf(Untrackable);
      return;
    }
    expect(readsAsNewest(done.text)).toBe(true);
  });
});

describe('what no unit can hold', () => {
  it('is untrackable in front matter', () => {
    const text = file('---\ntitle: One\n---\n\nBody.');
    expect(() => widen(text, replacing(text, 'One', 'Two'), context(ada, ['r2zd']))).toThrow(
      Untrackable,
    );
  });

  it('is untrackable past the cap', () => {
    const paragraphs = Array.from({ length: WIDEN_MOST_BLOCKS + 1 }, (_, i) => `Paragraph ${i}.`);
    const text = file(paragraphs.join('\n\n'));
    const view = newestView(text).text;
    const edits = [{ from: 0, to: view.indexOf('\n\nParagraph 8.') + 14, insert: 'Everything.' }];
    expect(() => widen(text, edits, context(bo, ['r2zd']))).toThrow(/replace 9 blocks/);
  });
});
