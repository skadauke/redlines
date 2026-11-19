// @vitest-environment happy-dom
// A callout typed first in a list item with Track Changes on (#1234): no fine write has a place for
// its insertion's closer (a tight item would read a line break the view lacks), and no list holds it,
// so the person is asked before it is made untracked; never a marker on a fence line. After a blank
// line in the item it is written, as one insertion.
import { afterEach, describe, expect, it } from 'vitest';
import { createEditor, type Editor, type UntrackedAnswer } from '../index.ts';

const open: Editor[] = [];
afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
});
const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

function load(doc: string, at: number, answer: UntrackedAnswer) {
  const parent = document.createElement('div');
  document.body.append(parent);
  const asked: string[] = [];
  const editor = createEditor(parent, {
    doc,
    dialect: 'pandoc',
    author: { handle: 'ada', name: 'Ada' },
    tracking: true,
    view: 'redlines',
    askUntracked: {
      ask: (reason) => {
        asked.push(reason);
        return Promise.resolve(answer);
      },
      skip: () => false,
    },
  });
  open.push(editor);
  editor.view.dispatch({ selection: { anchor: at } });
  return { editor, asked };
}

const type = (editor: Editor, text: string) =>
  editor.view.dispatch(editor.view.state.replaceSelection(text), { userEvent: 'input.type' });

const fenceMarkers = (file: string) =>
  file
    .split('<!-- redlines')[0]!
    .split('\n')
    .filter((line) => /^[ \t>]*:{3,}/.test(line) && line.includes('<!--'));

describe('a callout typed in a list item, Track Changes on', () => {
  const DIV = '::: {.callout-tip}\n  A.\n  :::';

  it('first in an empty item: asked; Cancel leaves the file, Make Edit writes it untracked', async () => {
    const cancelled = load('- \n\nAfter.\n', 2, 'cancel');
    type(cancelled.editor, DIV);
    await tick();
    expect(cancelled.asked).toEqual(['accept-pending']);
    expect(cancelled.editor.getDoc()).toBe('- \n\nAfter.\n');
    const made = load('- \n\nAfter.\n', 2, 'make');
    type(made.editor, DIV);
    await tick();
    expect(made.asked).toEqual(['accept-pending']);
    const file = made.editor.getDoc();
    expect(file).toContain('- ::: {.callout-tip}\n  A.\n  :::');
    expect(file).not.toContain('<!--');
  });

  it('after a blank line in the item: written as one insertion, no marker on a fence line', async () => {
    const { editor, asked } = load('- one\n\nAfter.\n', 5, 'cancel');
    type(editor, `\n\n  ${DIV}`);
    await tick();
    expect(asked).toEqual([]);
    const file = editor.getDoc();
    expect(fenceMarkers(file)).toEqual([]);
    expect(file).toContain('<!--ins');
    expect(file).not.toContain('<!--split');
  });
});
