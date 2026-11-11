// @vitest-environment happy-dom
// Copy and cut of cells (design: tables, "Copy and paste", Out; test 11): tab-separated text and an
// HTML table, never markers; cut is copy and the clearing of the cells, tracked or not.
import { forceParsing } from '@codemirror/language';
import { afterEach, describe, expect, it } from 'vitest';
import { undo } from '../history/index.ts';
import { createEditor, type Editor } from '../index.ts';
import { rectToTsv } from './clipboard.ts';

const open: Editor[] = [];
afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
  document.getSelection()?.removeAllRanges();
});

const ada = { handle: 'ada', name: 'Ada Lovelace' };
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function load(doc: string, tracking = false): Editor {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, { doc, author: ada, tracking });
  open.push(editor);
  forceParsing(editor.view, editor.view.state.doc.length, 10_000);
  return editor;
}

/** Copies or cuts what is selected, as ⌘C or ⌘X does, and returns the clipboard. */
async function copyData(editor: Editor, from: number, to: number, type = 'copy') {
  editor.view.dispatch({ selection: { anchor: from, head: to } });
  document.getSelection()?.selectAllChildren(editor.view.contentDOM);
  await tick();
  const clipboardData = new DataTransfer();
  const event = new ClipboardEvent(type, { clipboardData, bubbles: true, cancelable: true });
  editor.view.contentDOM.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  return clipboardData;
}

const TABLE = [
  '| Fruit | Count | Note |',
  '| ----- | ----- | ---- |',
  '| Apples | 3 | **sweet** [see](https://example.com/a) |',
  '| Plums | 4 | a\\|b<br>second |',
  '| Pears | 5 | says "hi"\ttab |',
].join('\n');
const DOC = `Intro.\n\n${TABLE}\n\nAfter.`;
const at = (find: string, offset = 0) => DOC.indexOf(find) + offset;

describe('rectToTsv', () => {
  it('parts cells by tabs and rows by line breaks', () => {
    expect(
      rectToTsv([
        ['a', 'b'],
        ['c', 'd'],
      ]),
    ).toBe('a\tb\nc\td');
  });

  it('quotes a cell that holds a tab, a line break or a quote, doubling its quotes', () => {
    expect(rectToTsv([['a\tb', 'x<br>y', 'say "hi"', 'plain']])).toBe(
      '"a\tb"\t"x\ny"\t"say ""hi"""\tplain',
    );
  });

  it('unescapes a pipe', () => {
    expect(rectToTsv([['a\\|b']])).toBe('a|b');
  });
});

describe('copying a rectangle of cells', () => {
  it('puts tab-separated text and an HTML table with the inline formatting', async () => {
    const editor = load(DOC);
    const data = await copyData(editor, at('Apples'), at('says') + 4);
    expect(data.getData('text/plain')).toBe(
      [
        'Apples\t3\t**sweet** [see](https://example.com/a)',
        'Plums\t4\t"a|b\nsecond"',
        'Pears\t5\t"says ""hi""\ttab"',
      ].join('\n'),
    );
    const html = data.getData('text/html');
    expect(html).toContain('<table>');
    expect(html).toContain('<strong>sweet</strong>');
    expect(html).toContain('<a href="https://example.com/a">see</a>');
    expect(html).toContain('a|b<br>second');
    // The selection starts in the body: no header row.
    expect(html).not.toContain('<th');
    expect(html).not.toContain('<thead');
    expect(html.match(/<tr>/g)).toHaveLength(3);
  });

  it('makes the header row th when the rectangle has the table’s', async () => {
    const editor = load(DOC);
    const data = await copyData(
      editor,
      at('Fruit'),
      at('Plums') + 'Plums | 4 | a\\|b<br>second'.length,
    );
    expect(data.getData('text/plain')).toBe(
      'Fruit\tCount\tNote\nApples\t3\t**sweet** [see](https://example.com/a)\nPlums\t4\t"a|b\nsecond"',
    );
    const html = data.getData('text/html');
    expect(html).toContain('<thead><tr><th>Fruit</th><th>Count</th><th>Note</th></tr></thead>');
  });

  it('copies a column, with the header as th', async () => {
    const editor = load(DOC);
    const data = await copyData(editor, at('Count'), at('5 |') + 1);
    expect(data.getData('text/plain')).toBe('Count\n3\n4\n5');
    expect(data.getData('text/html')).toContain('<th>Count</th>');
  });

  it('puts the newest text, never markers, for cells with pending changes', async () => {
    const doc = [
      '| a | b |',
      '| - | - |',
      '| one<!--ins k3x9--> two<!--/k3x9--> | kept<!--del m2bd  gone--> |',
      '| 3 | 4 |',
      '',
      '<!-- redlines',
      'version: 1',
      'marks:',
      '  k3x9: {by: bo, at: 2026-11-01T10:00Z}',
      '  m2bd: {by: bo, at: 2026-11-01T10:00Z}',
      '-->',
      '',
    ].join('\n');
    const editor = load(doc);
    const data = await copyData(editor, doc.indexOf('one'), doc.indexOf('4 |') + 1);
    expect(data.getData('text/plain')).toBe('one two\tkept\n3\t4');
    expect(data.getData('text/html')).not.toContain('<!--');
    expect(data.getData('text/html')).not.toContain('gone');
  });

  it('copies text inside one cell as before', async () => {
    const editor = load(DOC);
    const data = await copyData(editor, at('Apples'), at('Apples') + 3);
    expect(data.getData('text/plain')).toBe('App');
    expect(data.getData('text/html')).not.toContain('<table>');
  });
});

describe('cutting a rectangle of cells', () => {
  for (const tracking of [false, true]) {
    it(`copies, and clears the cells, Track Changes ${tracking ? 'on' : 'off'}`, async () => {
      const doc = '| a | b |\n| - | - |\n| 11 | 12 |\n| 21 | 22 |\n';
      const editor = load(doc, tracking);
      const data = await copyData(editor, doc.indexOf('11'), doc.indexOf('22') + 2, 'cut');
      expect(data.getData('text/plain')).toBe('11\t12\n21\t22');
      expect(data.getData('text/html')).toContain('<td>12</td>');
      const text = editor.getDoc();
      if (tracking) expect(text.match(/<!--del /g)).toHaveLength(4);
      else expect(text).toBe('| a | b |\n| - | - |\n|  |  |\n|  |  |\n');
      expect(undo(editor.view)).toBe(true);
      expect(editor.getDoc()).toBe(doc);
    });
  }
});

describe('copying a selection that reaches into a table', () => {
  it('puts the outside text and the cells of the rows it reaches', async () => {
    const editor = load(DOC);
    const data = await copyData(editor, at('ro.'), at('Plums') + 2);
    expect(data.getData('text/plain')).toBe(
      'ro.\nFruit\tCount\tNote\nApples\t3\t**sweet** [see](https://example.com/a)\nPlums\t4\t"a|b\nsecond"',
    );
    const html = data.getData('text/html');
    expect(html).toContain('<p>ro.</p>');
    expect(html).toContain('<th>Fruit</th>');
    expect(html).toContain('<td>Plums</td>');
  });
});
