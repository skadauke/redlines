// @vitest-environment happy-dom
import { EditorView } from '@codemirror/view';
import { createEditor, type Editor, type EditorOptions, undo } from '@redlines/editor';
import { newestView } from '@redlines/format';
import { afterEach, describe, expect, it } from 'vitest';
import { createFind, plugin } from './index.ts';

const mac = /Mac/.test(navigator.platform);

interface Mounted {
  editor: Editor;
  notices: string[];
  remove: () => void;
}

const mounted: Mounted[] = [];

function mount(doc: string, options: Partial<EditorOptions> = {}): Mounted {
  const parent = document.createElement('div');
  document.body.append(parent);
  const notices: string[] = [];
  const editor = createEditor(parent, {
    doc,
    author: { handle: 'ada', name: 'Ada Lovelace' },
    onNotice: (message) => notices.push(message),
    ...options,
  });
  const result = { editor, notices, remove: createFind(editor) };
  mounted.push(result);
  return result;
}

afterEach(() => {
  for (const { editor, remove } of mounted.splice(0)) {
    remove();
    editor.destroy();
  }
  document.body.replaceChildren();
});

/** A file: `body`, then a ledger with these lines. */
const file = (body: string, ledger = ''): string =>
  `${body}\n\n<!-- redlines\nversion: 1\n${ledger}-->\n`;

const AT = 'at: 2026-10-31T09:30Z';
const WITH_MARKS =
  'people:\n  bo: {name: Bo Chen}\nmarks:\n  b2b2: {by: bo, ' +
  AT +
  '}\n  c3c3: {by: bo, ' +
  AT +
  '}\n';

/** The find bar's parts. */
function bar(editor: Editor) {
  const root = editor.view.dom.querySelector<HTMLElement>('.rl-find-bar');
  const query = root?.querySelector<HTMLInputElement>('.rl-find-query') ?? null;
  const replacement = root?.querySelector<HTMLInputElement>('.rl-find-replacement') ?? null;
  const press = (label: string) =>
    [...(root?.querySelectorAll('button') ?? [])]
      .find((button) => button.getAttribute('aria-label') === label)
      ?.click();
  return { root, query, replacement, press, count: root?.querySelector('.rl-find-count') };
}

/** Types into the bar's find box. */
function search(editor: Editor, text: string): void {
  editor.commands.run('find.open');
  const { query } = bar(editor);
  if (!query) throw new Error('The find bar is not open');
  query.value = text;
  query.dispatchEvent(new Event('input', { bubbles: true }));
}

/** The text the highlights cover, from the decorations the editor draws. */
function highlighted(editor: Editor): string[] {
  const { view } = editor;
  const found: string[] = [];
  for (const source of view.state.facet(EditorView.decorations)) {
    const set = typeof source === 'function' ? source(view) : source;
    set.between(0, view.state.doc.length, (from, to, value) => {
      if (String((value.spec as { class?: string }).class).includes('rl-find-match'))
        found.push(view.state.sliceDoc(from, to));
    });
  }
  return found;
}

/** The source text the editor's selection covers. */
const selected = (editor: Editor): string => {
  const { from, to } = editor.view.state.selection.main;
  return editor.view.state.sliceDoc(from, to);
};

/** A key press in the bar's find box, as a browser sends it. */
function pressIn(target: HTMLElement, init: KeyboardInit): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}
type KeyboardInit = { key: string; code?: string; shiftKey?: boolean; altKey?: boolean } & {
  metaKey?: boolean;
  ctrlKey?: boolean;
};
const withMod = (init: KeyboardInit): KeyboardInit => ({ ...init, metaKey: mac, ctrlKey: !mac });

describe('what is found', () => {
  it('finds only text a reader can see', () => {
    const doc = file(
      'A zebra and a <!--ins b2b2-->kiwi<!--/b2b2--> here, ' +
        'with <!--del c3c3 an ibex--> gone and a <!--cmt d4d4-->note<!--/d4d4-->.',
      WITH_MARKS +
        'comments:\n  d4d4:\n    by: bo\n    at: 2026-10-31T09:41Z\n    text: |-\n      ledgerword zebra\n',
    );
    const { editor } = mount(doc);
    // Marker names, the deleted text and the ledger's own words are not in what a reader sees.
    for (const hidden of ['ins', 'ibex', 'ledgerword', 'redlines', 'b2b2', 'version']) {
      search(editor, hidden);
      expect(bar(editor).count?.textContent, hidden).toBe('No matches');
    }
    search(editor, 'zebra');
    expect(bar(editor).count?.textContent).toBe('1 match');
    search(editor, 'kiwi');
    expect(bar(editor).count?.textContent).toBe('1 match');
    expect(highlighted(editor)).toEqual(['kiwi']);
  });

  it('finds across a hidden marker', () => {
    const { editor } = mount(file('The <!--ins b2b2-->new<!--/b2b2-->er one.', WITH_MARKS));
    search(editor, 'newer');
    expect(bar(editor).count?.textContent).toBe('1 match');
    bar(editor).press('Next match');
    expect(selected(editor)).toBe('new<!--/b2b2-->er');
  });

  it('ignores case', () => {
    const { editor } = mount('Zebra, ZEBRA, zebra.\n');
    search(editor, 'zebra');
    expect(bar(editor).count?.textContent).toBe('3 matches');
  });
});

describe('moving', () => {
  it('moves and wraps with next and previous', () => {
    const { editor } = mount('one cat, two cat, three cat.\n');
    const sel = () => editor.view.state.selection.main.from;
    search(editor, 'cat');
    expect(editor.commands.run('find.next')).toBe(true);
    expect(sel()).toBe(4);
    expect(bar(editor).count?.textContent).toBe('1 of 3');
    editor.commands.run('find.next');
    editor.commands.run('find.next');
    expect(sel()).toBe(24);
    expect(bar(editor).count?.textContent).toBe('3 of 3');
    editor.commands.run('find.next');
    expect(sel()).toBe(4);
    editor.commands.run('find.previous');
    expect(sel()).toBe(24);
    editor.commands.run('find.previous');
    expect(sel()).toBe(13);
  });

  it('uses the selection for find', () => {
    const { editor } = mount('red fox, red hen.\n');
    editor.view.dispatch({ selection: { anchor: 9, head: 12 } });
    expect(editor.commands.run('find.useSelection')).toBe(true);
    expect(bar(editor).query?.value).toBe('red');
    expect(bar(editor).count?.textContent).toBe('2 of 2');
  });

  it('opens with Find and closes with Escape', () => {
    const { editor } = mount('one\n');
    expect(bar(editor).root).toBeNull();
    editor.commands.run('find.open');
    expect(document.activeElement).toBe(bar(editor).query);
    expect(bar(editor).replacement).toBeNull();
    pressIn(bar(editor).query!, { key: 'Escape' });
    expect(bar(editor).root).toBeNull();
    editor.commands.run('find.replace');
    expect(bar(editor).replacement).not.toBeNull();
  });
});

describe('the replace row', () => {
  it('is shown and hidden by a disclosure control that keeps the find text', () => {
    const { editor } = mount('cat, cat, cat.\n');
    search(editor, 'cat');
    editor.commands.run('find.next');
    editor.commands.run('find.next');
    const toggle = () => bar(editor).root!.querySelector<HTMLButtonElement>('.rl-find-disclosure')!;
    expect(bar(editor).root!.querySelector('.rl-find-row')!.firstElementChild).toBe(toggle());
    expect(toggle().getAttribute('aria-label')).toBe('Show Replace');
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    const at = editor.view.state.selection.main.from;
    toggle().click();
    expect(bar(editor).replacement).not.toBeNull();
    expect(toggle().getAttribute('aria-label')).toBe('Hide Replace');
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(bar(editor).query!.value).toBe('cat');
    expect(bar(editor).count?.textContent).toBe('2 of 3');
    expect(editor.view.state.selection.main.from).toBe(at);
    toggle().click();
    expect(bar(editor).replacement).toBeNull();
    expect(bar(editor).query!.value).toBe('cat');
    expect(bar(editor).count?.textContent).toBe('2 of 3');
  });

  it('is shown by Find and Replace with the bar open, which focuses the replace box', () => {
    const { editor } = mount('cat, cat.\n');
    search(editor, 'cat');
    expect(bar(editor).replacement).toBeNull();
    editor.commands.run('find.replace');
    expect(bar(editor).replacement).not.toBeNull();
    expect(bar(editor).query!.value).toBe('cat');
    expect(document.activeElement).toBe(bar(editor).replacement);
  });

  it('returns focus to the find box when hidden with focus in the replace box', () => {
    const { editor } = mount('cat, cat.\n');
    search(editor, 'cat');
    editor.commands.run('find.replace');
    expect(document.activeElement).toBe(bar(editor).replacement);
    const hide = bar(editor).root!.querySelector<HTMLButtonElement>(
      'button[aria-label="Hide Replace"]',
    );
    expect(hide).not.toBeNull();
    hide!.click();
    expect(bar(editor).replacement).toBeNull();
    expect(document.activeElement).toBe(bar(editor).query);
  });
});

describe('with focus in the bar', () => {
  it('runs Find Next and Find Previous from the menu', () => {
    const { editor } = mount('cat, cat, cat.\n');
    search(editor, 'cat');
    expect(document.activeElement).toBe(bar(editor).query);
    expect(editor.commands.run('find.next')).toBe(true);
    expect(editor.view.state.selection.main.from).toBe(0);
    expect(editor.commands.run('find.next')).toBe(true);
    expect(editor.view.state.selection.main.from).toBe(5);
    expect(editor.commands.run('find.previous')).toBe(true);
    expect(editor.view.state.selection.main.from).toBe(0);
    expect(document.activeElement).toBe(bar(editor).query);
  });

  it('runs on the keys the bar handles itself', () => {
    const { editor } = mount('cat, cat, cat.\n');
    search(editor, 'cat');
    const box = bar(editor).query!;
    const sel = () => editor.view.state.selection.main.from;
    const g = pressIn(box, withMod({ key: 'g', code: 'KeyG' }));
    expect(g.defaultPrevented).toBe(true);
    expect(sel()).toBe(0);
    pressIn(box, withMod({ key: 'G', code: 'KeyG', shiftKey: true }));
    expect(sel()).toBe(10);
    pressIn(box, { key: 'Enter' });
    expect(sel()).toBe(0);
    pressIn(box, { key: 'Enter', shiftKey: true });
    expect(sel()).toBe(10);
    pressIn(box, withMod({ key: 'ƒ', code: 'KeyF', altKey: true }));
    expect(bar(editor).replacement).not.toBeNull();
  });
});

describe('replacing', () => {
  it('replacing is a tracked change with tracking on and a plain edit with it off', () => {
    const doc = 'One cat sat.\n';
    const tracked = mount(doc, { tracking: true });
    search(tracked.editor, 'cat');
    tracked.editor.commands.run('find.replace');
    bar(tracked.editor).replacement!.value = 'dog';
    bar(tracked.editor).press('Next match');
    bar(tracked.editor).press('Replace');
    const after = tracked.editor.getDoc();
    expect(after).toContain('<!--sub');
    expect(after).toContain('cat');
    expect(newestView(after).text).toContain('One dog sat.');
    expect(tracked.editor.getUiState().changes).toHaveLength(1);

    const plain = mount(doc, { tracking: false });
    search(plain.editor, 'cat');
    plain.editor.commands.run('find.replace');
    bar(plain.editor).replacement!.value = 'dog';
    bar(plain.editor).press('Next match');
    bar(plain.editor).press('Replace');
    expect(plain.editor.getDoc()).toBe('One dog sat.\n');
  });

  it('replaces the match it is on, then selects the next', () => {
    const { editor } = mount('cat one, cat two.\n', { tracking: false });
    search(editor, 'cat');
    editor.commands.run('find.replace');
    bar(editor).replacement!.value = 'dog';
    bar(editor).press('Replace');
    expect(selected(editor)).toBe('cat');
    expect(editor.getDoc()).toBe('cat one, cat two.\n');
    bar(editor).press('Replace');
    expect(editor.getDoc()).toBe('dog one, cat two.\n');
    expect(selected(editor)).toBe('cat');
    expect(bar(editor).count?.textContent).toBe('1 of 1');
  });

  it('Replace All is one step to undo', () => {
    const doc = 'cat, cat, cat.\n';
    for (const tracking of [false, true]) {
      const { editor } = mount(doc, { tracking });
      search(editor, 'cat');
      editor.commands.run('find.replace');
      bar(editor).replacement!.value = 'dog';
      bar(editor).press('Replace All');
      expect(newestView(editor.getDoc()).text).toBe('dog, dog, dog.\n');
      if (tracking) expect(editor.getUiState().changes).toHaveLength(3);
      expect(undo(editor.view)).toBe(true);
      expect(editor.getDoc()).toBe(doc);
    }
  });

  it('refuses a replacement inside code with tracking on and goes on to the next', () => {
    const doc = 'Run `cat` now, cat.\n';
    const { editor, notices } = mount(doc, { tracking: true });
    search(editor, 'cat');
    editor.commands.run('find.replace');
    bar(editor).replacement!.value = 'dog';
    bar(editor).press('Next match');
    expect(selected(editor)).toBe('cat');
    expect(editor.view.state.selection.main.from).toBe(5);
    bar(editor).press('Replace');
    expect(editor.getDoc()).toBe(doc);
    expect(notices).toEqual([expect.stringContaining('code')]);
    expect(editor.view.state.selection.main.from).toBe(15);
    bar(editor).press('Replace');
    expect(newestView(editor.getDoc()).text).toBe('Run `cat` now, dog.\n');
  });

  it('Replace All skips what is in code with tracking on, and says so', () => {
    const { editor, notices } = mount('Run `cat` now, cat.\n', { tracking: true });
    search(editor, 'cat');
    editor.commands.run('find.replace');
    bar(editor).replacement!.value = 'dog';
    bar(editor).press('Replace All');
    expect(notices).toEqual([expect.stringContaining('code')]);
    expect(newestView(editor.getDoc()).text).toBe('Run `cat` now, dog.\n');
    expect(bar(editor).root?.querySelector('.rl-find-error')?.textContent).toBe(
      'Couldn’t change 1 match here.',
    );
  });

  it('replaces text a marker runs through', () => {
    const doc = file('The <!--ins b2b2-->new<!--/b2b2-->er one.', WITH_MARKS);
    const { editor } = mount(doc, { tracking: false });
    search(editor, 'newer');
    editor.commands.run('find.replace');
    bar(editor).replacement!.value = 'old';
    bar(editor).press('Replace All');
    expect(newestView(editor.getDoc()).text).toContain('The old one.');
  });
});

describe('while the bar is open', () => {
  it('survives the document changing while the bar is open', () => {
    const { editor } = mount('cat, cat.\n', { tracking: false });
    search(editor, 'cat');
    expect(bar(editor).count?.textContent).toBe('2 matches');
    editor.view.dispatch({ changes: { from: 0, insert: 'cat, ' } });
    expect(bar(editor).count?.textContent).toBe('3 matches');
    expect(highlighted(editor)).toHaveLength(3);
    editor.commands.run('find.next');
    editor.view.dispatch({ changes: { from: 0, to: editor.view.state.doc.length } });
    expect(bar(editor).count?.textContent).toBe('No matches');
    expect(highlighted(editor)).toEqual([]);
    editor.setDoc('a cat\n');
    expect(bar(editor).root).toBeNull();
  });

  it('is taken out with the function createFind returns', () => {
    const { editor, remove } = mount('cat\n');
    expect(editor.commands.list().map(({ id }) => id)).toEqual([
      'find.open',
      'find.next',
      'find.previous',
      'find.replace',
      'find.useSelection',
    ]);
    search(editor, 'cat');
    remove();
    expect(editor.commands.list()).toEqual([]);
    expect(bar(editor).root).toBeNull();
  });
});

describe('the plugin', () => {
  it('registers its commands in the Edit menu, in order', () => {
    const { editor, remove } = mount('cat\n');
    remove();
    const stop = plugin.activate({
      editor,
      host: {},
      author: { handle: 'ada', name: 'Ada' },
      notice: () => {},
    });
    expect(
      editor.commands.list().map(({ title, shortcut, menu }) => [title, shortcut, menu]),
    ).toEqual([
      ['Find', 'Mod-f', 'edit'],
      ['Find Next', 'Mod-g', 'edit'],
      ['Find Previous', 'Mod-Shift-g', 'edit'],
      ['Find and Replace', 'Mod-Alt-f', 'edit'],
      ['Use Selection for Find', 'Mod-e', 'edit'],
    ]);
    stop();
    expect(editor.commands.list()).toEqual([]);
    expect(plugin.manifest.id).toBe('redlines.find');
  });
});
