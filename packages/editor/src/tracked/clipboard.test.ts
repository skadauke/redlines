// @vitest-environment happy-dom
import { newestView, parse } from '@redlines/format';
import { afterEach, describe, expect, it } from 'vitest';
import { createEditor, type Editor, type EditorOptions } from '../index.ts';
import { plainText } from './clipboard.ts';

const ada = { handle: 'ada', name: 'Ada Lovelace' };
const open: Editor[] = [];

afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

/** Bo's insertion, Claude's substitution and deletion, and Bo's comment, with their ledger. */
const doc = [
  'The changes<!--ins k3x9--> and comments<!--/k3x9--> live in the file, so it opens ' +
    '<!--sub p7qd in every editor-->anywhere<!--/p7qd--> and merges.<!--del w2rf  Nothing to install.-->',
  '',
  'Each <!--cmt c8d2-->agent suggests<!--/c8d2--> in its own name.',
  '',
  '<!-- redlines',
  'version: 1',
  'people:',
  '  bo: {name: Bo Chen}',
  '  claude-ada: {name: Claude, agent: true, for: ada}',
  'marks:',
  '  k3x9: {by: bo, at: 2026-10-31T09:30Z}',
  '  p7qd: {by: claude-ada, at: 2026-10-31T09:31Z}',
  '  w2rf: {by: claude-ada, at: 2026-10-31T09:35Z}',
  'comments:',
  '  c8d2:',
  '    by: bo',
  '    at: 2026-10-31T09:41Z',
  '    text: |-',
  '      Can agents answer too?',
  '-->',
  '',
].join('\n');

function load(text: string, options: Partial<EditorOptions> = {}): Editor {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, { doc: text, author: ada, ...options });
  open.push(editor);
  return editor;
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Copies or cuts the text from `from` to `to`, as ⌘C or ⌘X does, and returns the clipboard's. */
async function copy(editor: Editor, from: number, to: number, type = 'copy'): Promise<string> {
  editor.view.dispatch({ selection: { anchor: from, head: to } });
  // CodeMirror copies its own selection, once the page's is in the editor. The editor isn't
  // focused: happy-dom would report the page's selection while CodeMirror is still writing it.
  document.getSelection()?.selectAllChildren(editor.view.contentDOM);
  await tick();
  const clipboardData = new DataTransfer();
  const event = new ClipboardEvent(type, { clipboardData, bubbles: true, cancelable: true });
  editor.view.contentDOM.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  return clipboardData.getData('text/plain');
}

/** Pastes `text` at `at`, as ⌘V does. */
function paste(editor: Editor, at: number, text: string): void {
  editor.view.dispatch({ selection: { anchor: at } });
  const clipboardData = new DataTransfer();
  clipboardData.setData('text/plain', text);
  editor.view.contentDOM.dispatchEvent(
    new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }),
  );
}

const between = (text: string, start: string, end: string) => [
  text.indexOf(start),
  text.indexOf(end) + end.length,
];

describe('copy and cut', () => {
  it('copy the newest text of the selection in Redlines', async () => {
    const editor = load(doc);
    expect(editor.getUiState().view).toBe('redlines');
    const [from, to] = between(doc, 'The changes', 'merges.<!--del w2rf  Nothing to install.-->');
    expect(await copy(editor, from!, to!)).toBe(
      'The changes and comments live in the file, so it opens anywhere and merges.',
    );
    const [start, end] = between(doc, 'Each', 'own name.');
    expect(await copy(editor, start!, end!)).toBe('Each agent suggests in its own name.');
  });

  it('copy the newest text in Clean, without the deleted text it hides', async () => {
    const editor = load(doc, { view: 'clean' });
    const [from, to] = between(doc, 'anywhere', 'Each');
    expect(await copy(editor, from!, to!)).toBe('anywhere and merges.\n\nEach');
  });

  it('copy the source as written in Raw', async () => {
    const editor = load(doc, { view: 'raw' });
    const [from, to] = between(doc, 'The changes', 'comments<!--/k3x9-->');
    expect(await copy(editor, from!, to!)).toBe(
      'The changes<!--ins k3x9--> and comments<!--/k3x9-->',
    );
  });

  it('cut the newest text, and the cut is tracked', async () => {
    const editor = load(doc, { tracking: true });
    const [from, to] = between(doc, 'anywhere', 'merges.');
    expect(await copy(editor, from!, to!, 'cut')).toBe('anywhere and merges.');
    const deletions = editor.getParsed().marks.filter((mark) => mark.entry.by === 'ada');
    expect(deletions.map((mark) => mark.kind)).not.toEqual([]);
    expect(editor.getDoc()).toContain('in every editor');
  });
});

describe('paste', () => {
  const markup = 'The changes<!--ins k3x9--> and comments<!--/k3x9-->';

  it('pastes markup as its newest text with Track Changes on, as the paster’s insertion', () => {
    const notices: string[] = [];
    const editor = load(doc, { tracking: true, onNotice: (m) => notices.push(m) });
    paste(editor, doc.indexOf('own name'), markup + ' ');
    expect(notices).toEqual([]);
    expect(newestView(editor.getDoc()).text).toContain('in its The changes and comments own name.');
    const pasted = editor.getParsed().marks.filter((mark) => mark.entry.by === 'ada');
    expect(
      pasted.map((mark) => [
        mark.kind,
        editor.getParsed().text.slice(mark.segments[0]!.content.from, mark.segments[0]!.content.to),
      ]),
    ).toEqual([['ins', 'The changes and comments ']]);
    expect(editor.getParsed().marks.find((mark) => mark.id === 'k3x9')?.segments).toHaveLength(1);
  });

  it('pastes markup as its newest text with Track Changes off, which joins no change', () => {
    const editor = load(doc);
    paste(editor, doc.indexOf('Each'), markup + ' ');
    expect(editor.getDoc()).toContain('\n\nThe changes and comments Each');
    expect(editor.getParsed().marks.find((mark) => mark.id === 'k3x9')?.segments).toHaveLength(1);
    // Rejecting the change that was copied leaves the pasted words.
    editor.reject('k3x9');
    expect(editor.getDoc()).toContain('\n\nThe changes and comments Each');
  });

  it('pastes a comment’s anchor as its text, which joins no thread', () => {
    const editor = load(doc);
    paste(editor, doc.indexOf('Each'), '<!--cmt c8d2-->agent suggests<!--/c8d2--> ');
    expect(editor.getDoc()).toContain('\n\nagent suggests Each');
    expect(editor.getParsed().marks.find((mark) => mark.id === 'c8d2')?.segments).toHaveLength(1);
    expect(parse(editor.getDoc()).warnings).toEqual([]);
  });

  it('pastes as written in Raw, where markup is edited by hand', () => {
    const editor = load(doc, { view: 'raw' });
    paste(editor, doc.indexOf('Each'), '<!--hl h6bz-->Each<!--/h6bz--> ');
    expect(editor.getDoc()).toContain('<!--hl h6bz-->Each<!--/h6bz--> Each');
  });
});

describe('plainText', () => {
  it('leaves text without markup as it is', () => {
    expect(plainText('Plain text, with <!-- a note --> and `<!--ins k3x9-->` in code.')).toBe(
      'Plain text, with <!-- a note --> and `<!--ins k3x9-->` in code.',
    );
  });

  it('takes the newest text of marks, and drops a ledger', () => {
    expect(plainText(doc)).toBe(
      'The changes and comments live in the file, so it opens anywhere and merges.\n\n' +
        'Each agent suggests in its own name.\n',
    );
  });

  it('drops markers whose other half was left behind', () => {
    expect(plainText('so it opens <!--sub p7qd in every editor-->anywhere')).toBe(
      'so it opens anywhere',
    );
    expect(plainText('and comments<!--/k3x9--> live')).toBe('and comments live');
    expect(plainText('<!--ins k3x9-->a<!--ins k3x9-->b<!--/k3x9-->')).toBe('ab');
  });

  it('drops a whole block’s opener with the lines that carry it', () => {
    expect(plainText('<!--ins q4gt-->\n\nA new paragraph.<!--/q4gt-->')).toBe('A new paragraph.');
  });
});
