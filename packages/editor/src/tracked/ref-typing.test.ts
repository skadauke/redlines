// @vitest-environment happy-dom
// A reference typed in front of another person's insertion in a .qmd (#1204): with Track Changes
// off the key would be cut in two by the marker, so the edit can't be made as it is. The person is
// asked whether to accept the other change first (design §3.4: an alert comes before a refusal,
// #497), and only where nothing can ask does the edit say so. With Track Changes on it is written,
// the change taking the rest of the key in so that no marker stands inside it.
import { newestView } from '@redlines/format';
import { afterEach, describe, expect, it } from 'vitest';
import { createEditor, type Editor, type UntrackedAnswer } from '../index.ts';

const open: Editor[] = [];
afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

const DOC = [
  'The count is <!--ins n97r-->42 <!--/n97r-->17 here.',
  '',
  '<!-- redlines',
  'version: 1',
  'people:',
  '  ada: {name: Ada}',
  '  bo: {name: Bo}',
  'marks:',
  '  n97r: {by: ada, at: 2026-11-18T02:59Z}',
  '-->',
  '',
].join('\n');
const AT = 'The count is '.length;

function load(answers: UntrackedAnswer[], options: { asking: boolean; tracking: boolean }) {
  const asked: string[] = [];
  const notices: string[] = [];
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, {
    doc: DOC,
    dialect: 'pandoc',
    author: { handle: 'bo', name: 'Bo' },
    tracking: options.tracking,
    view: 'redlines',
    onNotice: (words: string) => notices.push(words),
    ...(options.asking
      ? {
          askUntracked: {
            ask: (reason) => {
              asked.push(reason);
              return Promise.resolve(answers.shift() ?? 'cancel');
            },
            skip: () => false,
          },
        }
      : {}),
  });
  open.push(editor);
  editor.view.dispatch({ selection: { anchor: AT } });
  return { editor, asked, notices };
}

const type = (editor: Editor, text: string) =>
  editor.view.dispatch(editor.view.state.replaceSelection(text), { userEvent: 'input.type' });

describe('a reference typed in front of another person’s insertion, in a .qmd', () => {
  it('Track Changes off: asks to accept their change, and types after Make Edit', async () => {
    const { editor, asked } = load(['make'], { asking: true, tracking: false });
    type(editor, '@fig-sketch');
    expect(editor.getDoc()).toBe(DOC);
    await tick();
    expect(asked).toEqual(['accept-pending']);
    expect(editor.getDoc()).toContain('The count is @fig-sketch42 17 here.');
    expect(editor.getParsed().marks).toEqual([]);
  });

  it('Track Changes off: Cancel leaves the file as it was', async () => {
    const { editor, asked } = load(['cancel'], { asking: true, tracking: false });
    type(editor, '@fig-sketch');
    await tick();
    expect(asked).toEqual(['accept-pending']);
    expect(editor.getDoc()).toBe(DOC);
  });

  it('Track Changes off, nothing to ask: refused in words that say what to do', async () => {
    const { editor, notices } = load([], { asking: false, tracking: false });
    type(editor, '@fig-sketch');
    await tick();
    expect(editor.getDoc()).toBe(DOC);
    expect(notices.join(' ')).toMatch(/inside its key/);
    expect(notices.join(' ')).toMatch(/Accept or reject/);
  });

  it('Track Changes on: written, with no marker inside the key', () => {
    const { editor } = load([], { asking: true, tracking: true });
    type(editor, '@fig-sketch');
    const file = editor.getDoc();
    expect(file).not.toMatch(/@fig-sketch<!--/);
    expect(newestView(file).text).toContain('The count is @fig-sketch42 17 here.');
  });
});
