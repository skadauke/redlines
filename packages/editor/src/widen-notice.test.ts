// @vitest-environment happy-dom
// An edit that is widened to the unit that holds it, so that the file and the document read alike,
// says so once, quietly, through `onNotice` (#1188); an edit written as it was made says nothing.
import { forceParsing } from '@codemirror/language';
import { runScopeHandlers } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import { createFormatting } from '../../../plugins/formatting/src/index.ts';
import { createEditor, type Editor } from './index.ts';
import { widenedNotice } from './tracked/intent.ts';

const LEDGER = (marks: string) =>
  `\n\n<!-- redlines\nversion: 1\npeople:\n  bo: {name: Bo Chen}\nmarks:\n${marks}-->\n`;
const BO = (id: string) => `  ${id}: {by: bo, at: 2026-11-01T10:00Z}\n`;

/** Bo's inserted row crosses the rectangle that ⌘B formats: the format library can't write the bold
 * finely, and the table is replaced. */
const CROSSING = `| a | b | c |
| - | - | - |
| 11 | 12 | 13 |
| <!--ins m2bd row--> 21 | 22 | 23 |
| 31 | 32 | 33 |${LEDGER(BO('m2bd'))}`;

/** Bo's pending bold in a paragraph, and a plain one beside it. */
const PARAGRAPHS = `Plain words here.\n\nBo made <!--fmt k3x9 +bold-->**this**<!--/k3x9--> bold.${LEDGER(BO('k3x9'))}`;

const open: Editor[] = [];
const notices: string[] = [];
afterEach(() => {
  notices.length = 0;
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
  document.getSelection()?.removeAllRanges();
});

function load(doc: string, tracking: boolean): Editor {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, {
    doc,
    author: { handle: 'ada', name: 'Ada Lovelace' },
    tracking,
    onNotice: (message) => notices.push(message),
  });
  open.push(editor);
  createFormatting(editor, {
    author: { handle: 'ada', name: 'Ada Lovelace' },
    notice: (message) => notices.push(message),
  });
  forceParsing(editor.view, editor.view.state.doc.length, 10_000);
  return editor;
}

const boldKey = (editor: Editor) => {
  forceParsing(editor.view, editor.view.state.doc.length, 10_000);
  for (const mod of [{ ctrlKey: true }, { metaKey: true }]) {
    if (
      runScopeHandlers(
        editor.view,
        new KeyboardEvent('keydown', { key: 'b', bubbles: true, cancelable: true, ...mod }),
        'editor',
      )
    ) {
      return;
    }
  }
};

const widened = () => notices.filter((message) => message.startsWith('Tracked as a replacement'));

describe('the notice of a widened edit (#1188)', () => {
  it('says which unit was replaced, in a person’s words', () => {
    expect(widenedNotice(['table'])).toBe(
      'Tracked as a replacement of the whole table, so that the file and the document read alike.',
    );
    expect(widenedNotice(['block', 'item'])).toContain('whole list item');
    expect(widenedNotice(['block'])).toContain('whole paragraph');
    expect(widenedNotice(['code', 'table'])).toContain('whole table');
  });

  it('is shown once when a format over a table is written as a replacement of the table', () => {
    const editor = load(CROSSING, true);
    const from = CROSSING.indexOf('12');
    editor.view.dispatch({ selection: { anchor: from, head: CROSSING.indexOf('33') + 2 } });
    boldKey(editor);
    expect(editor.getDoc()).not.toBe(CROSSING);
    expect(widened()).toEqual([widenedNotice(['table'])]);
  });

  it('is shown once for a delimiter typed in a table cell beside another person’s bold', () => {
    const rest = '  |  *b*  |\n| --- | --- |\n|  alpha  |  x y  |';
    const doc = `|  ca<!--fmt n3pq +bold-->**f**<!--/n3pq-->é${rest}${LEDGER(BO('n3pq'))}`;
    const editor = load(doc, true);
    editor.view.dispatch({ selection: { anchor: 3 } });
    editor.view.dispatch({
      changes: { from: 3, insert: '**' },
      selection: { anchor: 5 },
      userEvent: 'input.type',
    });
    expect(editor.getDoc()).toContain('<!--sub');
    expect(widened()).toEqual([widenedNotice(['table'])]);
  });

  it('is not shown with Track Changes off, where nothing is widened', () => {
    const editor = load(CROSSING, false);
    editor.view.dispatch({
      selection: { anchor: CROSSING.indexOf('12'), head: CROSSING.indexOf('33') + 2 },
    });
    boldKey(editor);
    expect(widened()).toEqual([]);
  });

  it('is not shown for an edit written as it was made', () => {
    const editor = load(PARAGRAPHS, true);
    editor.view.dispatch({ selection: { anchor: 5 } });
    editor.view.dispatch({
      changes: { from: 5, insert: 'x' },
      userEvent: 'input.type',
    });
    expect(editor.getDoc()).not.toBe(PARAGRAPHS);
    expect(widened()).toEqual([]);
  });
});
