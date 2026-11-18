// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { createEditor, type Editor, type UntrackedAnswer, type UntrackedWords } from '../index.ts';

const open: Editor[] = [];
afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

// Bo's insertion has no entry in the ledger, so text can't be typed in it with Track Changes off
// (who made it isn't recorded, so it can't be split): the refusal that §3.4 turns into a question.
const DOC = 'First <!--ins k3x9-->new words<!--/k3x9--> here.\n\nSecond paragraph.\n';
const AT = 'First <!--ins k3x9-->new'.length;

function load(doc: string, answers: UntrackedAnswer[], asking = true, skip = false) {
  const asked: { reason: string; words: UntrackedWords | undefined }[] = [];
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, {
    doc,
    author: { handle: 'ada', name: 'Ada' },
    tracking: false,
    view: 'redlines',
    ...(asking
      ? {
          askUntracked: {
            ask: (reason, words) => {
              asked.push({ reason, words });
              return Promise.resolve(answers.shift() ?? 'cancel');
            },
            skip: () => skip,
          },
        }
      : {}),
  });
  open.push(editor);
  return { editor, asked };
}

const type = (editor: Editor, text: string) =>
  editor.view.dispatch(editor.view.state.replaceSelection(text), { userEvent: 'input.type' });

describe('the untracked path accepts pending changes after an alert (design §3.4)', () => {
  it('holds the edit, names the changes, and on Make Edit accepts them and types', async () => {
    const { editor, asked } = load(DOC, ['make']);
    editor.view.dispatch({ selection: { anchor: AT } });
    type(editor, 'X');
    // Held: nothing is decided while the sheet is up.
    expect(editor.getDoc()).toBe(DOC);
    await tick();
    expect(asked).toHaveLength(1);
    expect(asked[0]!.reason).toBe('accept-pending');
    expect(asked[0]!.words?.title).toMatch(/accepting .* 1 pending change in this paragraph\./);
    expect(editor.getDoc()).toContain('First newX words here.');
    expect(editor.getParsed().marks).toEqual([]);
    // One step: Undo gives back the file as it was.
    editor.undo();
    expect(editor.getDoc()).toBe(DOC);
  });

  it('leaves everything as it was on Cancel', async () => {
    const { editor, asked } = load(DOC, ['cancel']);
    editor.view.dispatch({ selection: { anchor: AT } });
    type(editor, 'X');
    await tick();
    expect(asked).toHaveLength(1);
    expect(editor.getDoc()).toBe(DOC);
  });

  it('is asked every time: Don’t ask again doesn’t cover it', async () => {
    const { editor, asked } = load(DOC, ['cancel'], true, true);
    editor.view.dispatch({ selection: { anchor: AT } });
    type(editor, 'X');
    await tick();
    // The document's "Don't ask again" (for the alert) and a run of answers don't cover it.
    expect(asked.map((a) => a.reason)).toEqual(['accept-pending']);
    expect(editor.getDoc()).toBe(DOC);
  });

  it('refuses as before where there is no sheet', async () => {
    const { editor } = load(DOC, [], false);
    editor.view.dispatch({ selection: { anchor: AT } });
    type(editor, 'X');
    await tick();
    expect(editor.getDoc()).toBe(DOC);
  });
});

// Bo's pending bold, `**1**` after a `1`: taking one `*` out would leave `*1**` between the marks,
// which a reader of the file reads other than the newest view (#265). The format throws, and the
// editor asks (design §3.4).
const BOLD = [
  'See 1<!--fmt k3x9 +bold-->**1**<!--/k3x9--> here.',
  '',
  '<!-- redlines',
  'version: 1',
  'people:',
  '  ada: {name: Ada Lovelace}',
  '  bo: {name: Bo Chen}',
  'marks:',
  '  k3x9: {by: bo, at: 2026-10-13T22:30Z}',
  '-->',
  '',
].join('\n');
const STAR = BOLD.indexOf('**1') + 1;

const deleteStar = (editor: Editor) =>
  editor.view.dispatch({
    changes: { from: STAR, to: STAR + 1, insert: '' },
    userEvent: 'delete.backward',
  });

describe("a delimiter of another person's pending bold, with Track Changes off (#265)", () => {
  it('asks with Bo’s name and count, and on Make Edit accepts the bold and makes the edit', async () => {
    const { editor, asked } = load(BOLD, ['make']);
    deleteStar(editor);
    expect(editor.getDoc()).toBe(BOLD);
    await tick();
    expect(asked).toHaveLength(1);
    expect(asked[0]!.reason).toBe('accept-pending');
    expect(asked[0]!.words?.title).toBe(
      "This edit can't be made without accepting Bo Chen's 1 pending change in this paragraph. Make the edit?",
    );
    expect(editor.getDoc()).toContain('See 1*1** here.');
    expect(editor.getParsed().marks).toEqual([]);
    editor.undo();
    expect(editor.getDoc()).toBe(BOLD);
  });

  it('leaves the text as it was on Cancel', async () => {
    const { editor, asked } = load(BOLD, ['cancel']);
    deleteStar(editor);
    await tick();
    expect(asked).toHaveLength(1);
    expect(editor.getDoc()).toBe(BOLD);
  });
});
