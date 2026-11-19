// @vitest-environment happy-dom
// A callout typed in a list item with Track Changes on (#1234): written as one insertion with no
// marker on a fence line (after a blank line, the closer in the item; otherwise the closer outside
// the list), and only where no form holds it, asked about before it is made without tracking.
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

  it('first in an empty item: written tracked, the closer outside the list, no sheet', async () => {
    const { editor, asked } = load('- \n\nAfter.\n', 2, 'cancel');
    type(editor, DIV);
    await tick();
    expect(asked).toEqual([]);
    const file = editor.getDoc();
    expect(fenceMarkers(file)).toEqual([]);
    expect(file.split('<!-- redlines')[0]).toMatch(
      /^- <!--ins [a-z0-9]{4}-->\n {2}::: \{\.callout-tip\}\n {2}A\.\n {2}:::\n<!--\/[a-z0-9]{4}-->\n\nAfter\.\n/,
    );
  });

  it('after a blank line in the item: one insertion, no sheet, no split', async () => {
    const { editor, asked } = load('- one\n\nAfter.\n', 5, 'cancel');
    type(editor, `\n\n  ${DIV}`);
    await tick();
    expect(asked).toEqual([]);
    const file = editor.getDoc();
    expect(fenceMarkers(file)).toEqual([]);
    expect(file).toContain('<!--ins');
    expect(file).not.toContain('<!--split');
  });

  // A line of the div that leaves the item has no form that reads alike, and no list holds it: the
  // person is asked before it is made without tracking (design §3.1), with a title that says why.
  const LAZY = '\n  ::: {.callout-tip}\nA.\n  :::';

  it('a div with a line that leaves the item: asked; Cancel leaves the file, Make Edit writes it plain', async () => {
    const cancelled = load('- one\n\nAfter.\n', 5, 'cancel');
    type(cancelled.editor, LAZY);
    await tick();
    expect(cancelled.asked).toEqual(['accept-pending']);
    expect(cancelled.editor.getDoc()).toBe('- one\n\nAfter.\n');
    const made = load('- one\n\nAfter.\n', 5, 'make');
    type(made.editor, LAZY);
    await tick();
    expect(made.asked).toEqual(['accept-pending']);
    const file = made.editor.getDoc();
    expect(file).toContain('::: {.callout-tip}');
    expect(file).not.toContain('<!--ins');
    expect(fenceMarkers(file)).toEqual([]);
  });
});
