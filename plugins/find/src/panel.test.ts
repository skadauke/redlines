// @vitest-environment happy-dom
// The panel's options, the scope of a selection, Tab, and replacing with Track Changes on (#554).
import {
  containersOf,
  createEditor,
  type Editor,
  type EditorOptions,
  isSectionOpen,
  undo,
} from '@redlines/editor';
import { newestView } from '@redlines/format';
import { afterEach, describe, expect, it } from 'vitest';
import { createFind, type FindPluginOptions } from './index.ts';
import { setFind } from './search.ts';

const mac = /Mac/.test(navigator.platform);

const mounted: { editor: Editor; remove: () => void }[] = [];

function mount(
  doc: string,
  options: Partial<EditorOptions> = {},
  find: FindPluginOptions = {},
): Editor {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, {
    doc,
    author: { handle: 'ada', name: 'Ada Lovelace' },
    ...options,
  });
  mounted.push({ editor, remove: createFind(editor, find) });
  return editor;
}

afterEach(() => {
  for (const { editor, remove } of mounted.splice(0)) {
    remove();
    editor.destroy();
  }
  document.body.replaceChildren();
});

const file = (body: string, ledger = ''): string =>
  `${body}\n\n<!-- redlines\nversion: 1\n${ledger}-->\n`;
const AT = 'at: 2026-10-31T09:30Z';
const WITH_MARKS = `people:\n  bo: {name: Bo Chen}\nmarks:\n  b2b2: {by: bo, ${AT}}\n`;

function bar(editor: Editor) {
  const root = editor.view.dom.querySelector<HTMLElement>('.rl-find-bar');
  const press = (label: string) =>
    [...(root?.querySelectorAll('button') ?? [])]
      .find((button) => button.getAttribute('aria-label') === label)
      ?.click();
  return {
    root,
    press,
    query: root?.querySelector<HTMLInputElement>('.rl-find-query') ?? null,
    replacement: root?.querySelector<HTMLInputElement>('.rl-find-replacement') ?? null,
    count: root?.querySelector('.rl-find-count')?.textContent,
    pressed: (label: string) =>
      root?.querySelector(`button[aria-label="${label}"]`)?.getAttribute('aria-pressed') === 'true',
  };
}

function search(editor: Editor, text: string): void {
  editor.commands.run('find.open');
  const { query } = bar(editor);
  if (!query) throw new Error('The find bar is not open');
  query.value = text;
  query.dispatchEvent(new Event('input', { bubbles: true }));
}

const selectRange = (editor: Editor, anchor: number, head: number) =>
  editor.view.dispatch({ selection: { anchor, head } });

/** Closes the bar without the focus going back to the page, which happy-dom stumbles on. */
const closeBar = (editor: Editor) => editor.view.dispatch({ effects: setFind.of({ open: false }) });

const selected = (editor: Editor): string => {
  const { from, to } = editor.view.state.selection.main;
  return editor.view.state.sliceDoc(from, to);
};

function pressIn(target: HTMLElement, init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}
const withMod = (init: KeyboardEventInit): KeyboardEventInit => ({
  ...init,
  metaKey: mac,
  ctrlKey: !mac,
});

describe('options', () => {
  it('Match Case and Whole Word narrow the matches', () => {
    const editor = mount('Cat cat CAT concat.\n', { tracking: false });
    search(editor, 'cat');
    expect(bar(editor).count).toBe('1 of 4');
    bar(editor).press('Match Case');
    expect(bar(editor).count).toBe('1 of 2');
    expect(bar(editor).pressed('Match Case')).toBe(true);
    bar(editor).press('Match Case');
    bar(editor).press('Whole Word');
    expect(bar(editor).count).toBe('2 of 3');
  });

  it('a regular expression that does not compile says Invalid, and finds nothing', () => {
    const editor = mount('a (b) c\n', { tracking: false });
    search(editor, '(b');
    expect(bar(editor).count).toBe('1 of 1');
    bar(editor).press('Regular Expression');
    expect(bar(editor).count).toBe('Invalid');
    expect(editor.view.dom.querySelector('.rl-find-match')).toBeNull();
    search(editor, '\\(b\\)');
    expect(bar(editor).count).toBe('1 of 1');
  });

  it('a regular expression fills in $1 in the replacement', () => {
    const editor = mount('ab-12, cd-34.\n', { tracking: false });
    search(editor, '([a-z]+)-(\\d+)');
    bar(editor).press('Regular Expression');
    editor.commands.run('find.replace');
    bar(editor).replacement!.value = '$2:$1';
    bar(editor).press('Replace All');
    expect(editor.getDoc()).toBe('12:ab, 34:cd.\n');
  });

  it('are on ⌥⌘C, ⌥⌘W, ⌥⌘R and ⌥⌘L while the find box has the focus', () => {
    const editor = mount('Cat cat.\n\nMore cat.\n', { tracking: false });
    search(editor, 'cat');
    const box = bar(editor).query!;
    const key = (code: string) => pressIn(box, withMod({ key: 'x', code, altKey: true }));
    expect(key('KeyC').defaultPrevented).toBe(true);
    expect(bar(editor).pressed('Match Case')).toBe(true);
    expect(bar(editor).count).toBe('1 of 2');
    key('KeyW');
    expect(bar(editor).pressed('Whole Word')).toBe(true);
    key('KeyR');
    expect(bar(editor).pressed('Regular Expression')).toBe(true);
    key('KeyC');
    expect(bar(editor).pressed('Match Case')).toBe(false);
    // Nothing is selected, so there is no scope to turn on.
    selectRange(editor, 0, 0);
    key('KeyL');
    expect(bar(editor).pressed('Find in Selection')).toBe(false);
  });

  it('every control has a hint with its name and key', () => {
    const editor = mount('cat\n');
    editor.commands.run('find.replace');
    const hints = [...bar(editor).root!.querySelectorAll('button')].map((b) => b.title);
    expect(hints.every(Boolean)).toBe(true);
    expect(hints.join('\n')).toMatch(/Match Case \(.*C\)/);
    expect(hints.join('\n')).toMatch(/Find in Selection \(.*L\)/);
    expect(hints.join('\n')).toMatch(/Close \(Esc\)/);
  });
});

describe('Find in a selection', () => {
  const para = (n: number) => `Paragraph ${n} has a cat in it.`;
  const DOC = `${para(1)}\n\n${para(2)}\n\n${para(3)}\n`;

  it('a short phrase in a line becomes the search term', () => {
    const editor = mount('The red fox, a red hen.\n', { tracking: false });
    selectRange(editor, 4, 7);
    editor.commands.run('find.open');
    expect(bar(editor).query!.value).toBe('red');
    expect(bar(editor).pressed('Find in Selection')).toBe(false);
  });

  it('more than one block limits Find to it, and Replace All stays inside it', () => {
    const editor = mount(DOC, { tracking: false });
    selectRange(editor, 5, DOC.indexOf('Paragraph 2') + 5);
    editor.commands.run('find.open');
    expect(bar(editor).pressed('Find in Selection')).toBe(true);
    expect(bar(editor).query!.placeholder).toBe('Find in selection');
    expect(bar(editor).query!.value).toBe('');
    search(editor, 'cat');
    expect(bar(editor).count).toBe('1 of 1');
    expect(editor.view.dom.querySelector('.rl-find-scope')).not.toBeNull();
    editor.commands.run('find.replace');
    bar(editor).replacement!.value = 'dog';
    bar(editor).press('Replace All');
    expect(editor.getDoc()).toBe(DOC.replace('cat', 'dog'));
    bar(editor).press('Find in Selection');
    expect(bar(editor).count).toMatch(/of 2$/);
  });

  it('80 characters, a line break or a whole block limit Find; fewer do not', () => {
    const long = `${'x'.repeat(40)} cat ${'y'.repeat(40)}`;
    const editor = mount(`${long}\n\nTail cat.\n`, { tracking: false });
    selectRange(editor, 2, 2 + 80);
    editor.commands.run('find.open');
    expect(bar(editor).pressed('Find in Selection')).toBe(true);
    closeBar(editor);
    selectRange(editor, 2, 2 + 79);
    editor.commands.run('find.open');
    expect(bar(editor).query!.value).toBe(long.slice(2, 2 + 79));
    closeBar(editor);
    // A whole block, however short.
    const tail = long.length + 2;
    selectRange(editor, tail, tail + 'Tail cat.'.length);
    editor.commands.run('find.open');
    expect(bar(editor).pressed('Find in Selection')).toBe(true);
  });

  it('the button turns it on for the selection, and off again', () => {
    const editor = mount(DOC, { tracking: false });
    search(editor, 'cat');
    selectRange(editor, 0, DOC.indexOf('Paragraph 3') + 2);
    bar(editor).press('Find in Selection');
    expect(bar(editor).pressed('Find in Selection')).toBe(true);
    expect(bar(editor).count).toBe('1 of 2');
    bar(editor).press('Find in Selection');
    expect(bar(editor).count).toMatch(/of 3$/);
  });
});

describe('Tab and Escape', () => {
  it('Tab in Find opens Replace and goes to it; Shift-Tab goes back', () => {
    const editor = mount('cat\n');
    editor.commands.run('find.open');
    expect(bar(editor).replacement).toBeNull();
    const tab = pressIn(bar(editor).query!, { key: 'Tab' });
    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(bar(editor).replacement);
    const back = pressIn(bar(editor).replacement!, { key: 'Tab', shiftKey: true });
    expect(back.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(bar(editor).query);
    pressIn(bar(editor).query!, { key: 'Tab' });
    expect(document.activeElement).toBe(bar(editor).replacement);
  });

  it('Escape closes the bar with the current match selected', () => {
    const editor = mount('a cat, a cat.\n');
    search(editor, 'cat');
    editor.commands.run('find.next');
    pressIn(bar(editor).query!, { key: 'Escape' });
    expect(bar(editor).root).toBeNull();
    expect(selected(editor)).toBe('cat');
    expect(editor.view.state.selection.main.from).toBe(9);
  });
});

describe('replacing with Track Changes on', () => {
  const DOC = 'One cat.\n\nTwo cat, cat.\n\nThree cat.\n';

  it('Replace All makes one tracked change per match, and one Undo takes them all back', () => {
    const editor = mount(DOC, { tracking: true });
    search(editor, 'cat');
    editor.commands.run('find.replace');
    bar(editor).replacement!.value = 'dog';
    bar(editor).press('Replace All');
    const { changes } = editor.getUiState();
    expect(changes).toHaveLength(4);
    expect(new Set(changes.map((change) => change.id)).size).toBe(4);
    expect(newestView(editor.getDoc()).text).toBe('One dog.\n\nTwo dog, dog.\n\nThree dog.\n');
    expect(editor.getDoc().match(/<!--sub /g)).toHaveLength(4);
    expect(undo(editor.view)).toBe(true);
    expect(editor.getDoc()).toBe(DOC);
  });

  it('text inside a tracked change is not matched', () => {
    const doc = file('The <!--ins b2b2-->cat<!--/b2b2--> and a cat.', WITH_MARKS);
    const tracked = mount(doc, { tracking: true });
    search(tracked, 'cat');
    expect(bar(tracked).count).toBe('1 of 1');
    const plain = mount(doc, { tracking: false });
    search(plain, 'cat');
    expect(bar(plain).count).toBe('1 of 2');
  });

  it('a red pen in the Replace box says tracking is on', () => {
    const editor = mount('cat\n', { tracking: true });
    editor.commands.run('find.replace');
    const pen = () => bar(editor).root!.querySelector<HTMLElement>('.rl-find-pen')!;
    expect(pen().hidden).toBe(false);
    editor.setTracking(false);
    expect(pen().hidden).toBe(true);
  });

  it('Replace All offers Undo in a toast, which undoes it as one step', () => {
    const toasts: { text: string; action?: { label: string; run: () => void } }[] = [];
    const editor = mount(DOC, { tracking: true }, { toast: (toast) => toasts.push(toast) });
    search(editor, 'cat');
    editor.commands.run('find.replace');
    bar(editor).replacement!.value = 'dog';
    bar(editor).press('Replace All');
    expect(toasts).toHaveLength(1);
    expect(toasts[0]?.text).toBe('Replaced 4 matches.');
    expect(toasts[0]?.action?.label).toBe('Undo');
    toasts[0]?.action?.run();
    expect(editor.getDoc()).toBe(DOC);
  });
});

describe('the current-match hook', () => {
  it('is called whenever a match becomes the current one', () => {
    const seen: [number, number][] = [];
    const editor = mount(
      'cat, cat, cat.\n',
      {},
      { onCurrentMatch: (m) => seen.push([m.from, m.to]) },
    );
    search(editor, 'cat');
    expect(seen).toEqual([[0, 3]]);
    editor.commands.run('find.next');
    expect(seen).toEqual([
      [0, 3],
      [5, 8],
    ]);
  });
});

describe('a closed section', () => {
  const DOC = '<details>\n<summary>More</summary>\n\nA cat inside.\n\n</details>\n\nA cat after.\n';
  const isOpen = (editor: Editor) =>
    isSectionOpen(editor.view.state, containersOf(editor.view.state)[0]!);

  it('opens while its match is the current one, and closes when the match moves out', () => {
    const editor = mount(DOC);
    expect(isOpen(editor)).toBe(false);
    search(editor, 'cat');
    // The first match, inside the section: it shows.
    expect(
      editor.view.state.sliceDoc(
        editor.view.state.selection.main.from,
        editor.view.state.selection.main.to,
      ),
    ).toBe('cat');
    expect(isOpen(editor)).toBe(true);
    editor.commands.run('find.next');
    expect(isOpen(editor)).toBe(false);
    editor.commands.run('find.next');
    expect(isOpen(editor)).toBe(true);
  });
});

describe('review fixes', () => {
  const para = (n: number) => `Paragraph ${n} has a cat in it.`;
  const DOC = `${para(1)}\n\n${para(2)}\n\n${para(3)}\n`;

  it('Find in Selection after a query was typed limits to the block the person selected', () => {
    const editor = mount(DOC, { tracking: false });
    search(editor, 'cat');
    // The match is the selection now; the person selects two paragraphs, then types and steps.
    selectRange(editor, 0, DOC.indexOf('Paragraph 3') - 1);
    editor.commands.run('find.next');
    expect(selected(editor)).toBe('cat');
    bar(editor).press('Find in Selection');
    expect(bar(editor).pressed('Find in Selection')).toBe(true);
    expect(bar(editor).count).toMatch(/of 2$/);
  });

  it('seeding a phrase with Regular Expression on escapes it, and drops an old scope', () => {
    const editor = mount('Use C++ or (foo) here, and C++ again.\n\nMore.\n', { tracking: false });
    search(editor, 'x');
    bar(editor).press('Regular Expression');
    selectRange(editor, 4, 7);
    editor.commands.run('find.open');
    expect(bar(editor).query!.value).toBe('C\\+\\+');
    expect(bar(editor).count).toMatch(/of 2$/);
    expect(bar(editor).pressed('Find in Selection')).toBe(false);
  });

  it('a seeded phrase clears the scope from before', () => {
    const editor = mount(`${DOC}`, { tracking: false });
    selectRange(editor, 0, DOC.indexOf('Paragraph 2') + 3);
    editor.commands.run('find.open');
    expect(bar(editor).pressed('Find in Selection')).toBe(true);
    closeBar(editor);
    selectRange(editor, 0, 0);
    selectRange(editor, DOC.indexOf('cat'), DOC.indexOf('cat') + 3);
    editor.commands.run('find.open');
    expect(bar(editor).query!.value).toBe('cat');
    expect(bar(editor).pressed('Find in Selection')).toBe(false);
    expect(bar(editor).count).toMatch(/of 3$/);
  });

  it('the scope follows edits made inside it', () => {
    const editor = mount(DOC, { tracking: false });
    selectRange(editor, 0, DOC.indexOf('Paragraph 2') + 3);
    editor.commands.run('find.open');
    editor.view.dispatch({ changes: { from: 3, insert: ' cat' } });
    search(editor, 'cat');
    expect(bar(editor).count).toBe('1 of 2');
  });

  it('Undo in the toast does nothing once the document has changed', () => {
    const toasts: { action?: { run: () => void } }[] = [];
    const editor = mount(
      'cat, cat.\n\ncat.\n',
      { tracking: false },
      { toast: (toast) => toasts.push(toast) },
    );
    search(editor, 'cat');
    editor.commands.run('find.replace');
    bar(editor).replacement!.value = 'dog';
    bar(editor).press('Replace All');
    const first = toasts[0]!;
    editor.view.dispatch({ changes: { from: 0, insert: 'x' } });
    first.action?.run();
    expect(editor.getDoc()).toBe('xdog, dog.\n\ndog.\n');
  });

  it('Replace All of adjacent matches under tracking makes the changes replacing by hand makes', () => {
    const doc = 'catcatcat and cat.\n';
    const byHand = mount(doc, { tracking: true });
    search(byHand, 'cat');
    byHand.commands.run('find.replace');
    bar(byHand).replacement!.value = 'dog';
    for (let i = 0; i < 4; i++) bar(byHand).press('Replace');
    const all = mount(doc, { tracking: true });
    search(all, 'cat');
    all.commands.run('find.replace');
    bar(all).replacement!.value = 'dog';
    bar(all).press('Replace All');
    expect(newestView(all.getDoc()).text).toBe('dogdogdog and dog.\n');
    expect(all.getUiState().changes.length).toBe(byHand.getUiState().changes.length);
    // The separate one at the end is a change of its own.
    expect(all.getUiState().changes.length).toBeGreaterThanOrEqual(2);
  });

  it('onCurrentMatch is called when typing selects a match, and closing leaves no DOM', () => {
    const seen: number[] = [];
    const editor = mount('a cat\n', {}, { onCurrentMatch: (m) => seen.push(m.from) });
    search(editor, 'cat');
    expect(seen).toEqual([2]);
    closeBar(editor);
    expect(editor.view.dom.querySelector('.rl-find-bar')).toBeNull();
    expect(editor.view.dom.querySelector('.rl-find-match')).toBeNull();
  });
});
