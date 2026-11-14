// @vitest-environment happy-dom
import { StateField } from '@codemirror/state';
import { EditorView, runScopeHandlers, ViewPlugin } from '@codemirror/view';
import type { MarkRange } from '@redlines/format';
import { describe, expect, it } from 'vitest';
import { createEditor, isChange } from './index.ts';

const author = { handle: 'ada', name: 'Ada Lovelace' };

function mount(doc = 'One.\n') {
  const parent = document.createElement('div');
  document.body.append(parent);
  return createEditor(parent, { doc, author });
}

/** A plugin's extension: a field that counts transactions, and a view plugin that counts mounts. */
function counter() {
  const field = StateField.define<number>({ create: () => 0, update: (n) => n + 1 });
  let mounted = 0;
  const plugin = ViewPlugin.define(() => {
    mounted++;
    return { destroy: () => mounted-- };
  });
  return { field, extension: [field, plugin], mounted: () => mounted };
}

describe('createEditor', () => {
  it('mounts CodeMirror and reads the document back', () => {
    const parent = document.createElement('div');
    document.body.append(parent);
    const doc = '# Launch plan\n\nWe will ship the importer in April.\n';

    const editor = createEditor(parent, { doc, author: { handle: 'ada', name: 'Ada Lovelace' } });
    expect(editor.view.state.doc.toString()).toBe(doc);
    expect(parent.querySelector('.cm-content')?.textContent).toContain('ship the importer');

    editor.view.dispatch({
      changes: { from: doc.indexOf('April'), to: doc.indexOf('.\n'), insert: 'May' },
    });
    expect(editor.view.state.doc.toString()).toBe(doc.replace('April', 'May'));

    editor.destroy();
    expect(parent.querySelector('.cm-editor')).toBeNull();
  });
});

describe('scrollToLine', () => {
  const lines = 'One\nTwo\nThree\n';

  it('puts the caret at the start of the line, counting from 1', () => {
    const editor = mount(lines);
    editor.scrollToLine(2);
    expect(editor.view.state.selection.main.head).toBe(lines.indexOf('Two'));
    editor.destroy();
  });

  it('takes a line outside the document as its nearest end', () => {
    const editor = mount(lines);
    editor.scrollToLine(400);
    expect(editor.view.state.selection.main.head).toBe(lines.length);
    editor.scrollToLine(0);
    expect(editor.view.state.selection.main.head).toBe(0);
    editor.destroy();
  });

  it('changes nothing in the file', () => {
    const editor = mount(lines);
    editor.scrollToLine(3);
    expect(editor.getDoc()).toBe(lines);
    editor.destroy();
  });
});

describe('extensions', () => {
  it('keeps the extensions it was given when another document is opened', () => {
    const given = counter();
    const parent = document.createElement('div');
    document.body.append(parent);
    const editor = createEditor(parent, { doc: 'One.\n', author, extensions: [given.extension] });
    editor.setDoc('Two.\n');
    expect(editor.view.state.field(given.field, false)).toBe(0);
    expect(given.mounted()).toBe(1);
    editor.destroy();
  });

  it('keeps an added extension across setDoc, until it is removed', () => {
    const editor = mount();
    const added = counter();
    const remove = editor.addExtension(added.extension);
    expect(editor.view.state.field(added.field, false)).toBeDefined();
    expect(added.mounted()).toBe(1);

    editor.setDoc('Two.\n');
    expect(editor.view.state.field(added.field, false)).toBe(0);
    expect(added.mounted()).toBe(1);

    remove();
    expect(editor.view.state.field(added.field, false)).toBeUndefined();
    expect(added.mounted()).toBe(0);
    editor.setDoc('Three.\n');
    expect(editor.view.state.field(added.field, false)).toBeUndefined();
    expect(added.mounted()).toBe(0);
    // Removing it again does nothing.
    remove();
    editor.destroy();
  });

  it('keeps each added extension once through repeated setDoc', () => {
    const editor = mount();
    const first = counter();
    const second = counter();
    editor.addExtension(first.extension);
    editor.addExtension(second.extension);
    for (const doc of ['Two.\n', 'Three.\n', 'Four.\n']) editor.setDoc(doc);
    expect(first.mounted()).toBe(1);
    expect(second.mounted()).toBe(1);
    expect(editor.getDoc()).toBe('Four.\n');
    editor.destroy();
  });

  it('adding a second extension keeps the state of the first', () => {
    const editor = mount();
    const first = counter();
    editor.addExtension(first.extension);
    editor.view.dispatch({ changes: { from: 0, insert: 'A' } });
    const before = editor.view.state.field(first.field);
    editor.addExtension(counter().extension);
    expect(editor.view.state.field(first.field)).toBe(before + 1);
    expect(first.mounted()).toBe(1);
    editor.destroy();
  });

  it('an added extension applies to the next document too', () => {
    const editor = mount();
    editor.addExtension(EditorView.editorAttributes.of({ class: 'rl-test-added' }));
    editor.setDoc('Two.\n');
    expect(editor.view.dom.classList).toContain('rl-test-added');
    editor.destroy();
  });
});

describe('isChange', () => {
  it('is exported for plugins, and agrees with the editor’s list of changes', () => {
    const doc = [
      'We <!--ins k3x9-->now <!--/k3x9-->ship <!--hl h1h1-->it<!--/h1h1-->.',
      '',
      '<!-- redlines',
      'version: 1',
      'marks:',
      '  k3x9: {by: ada, at: 2026-10-31T09:30Z}',
      '  h1h1: {by: ada, at: 2026-10-31T09:31Z}',
      '-->',
      '',
    ].join('\n');
    const editor = mount(doc);
    expect(
      editor
        .getParsed()
        .marks.filter(isChange)
        .map(({ id }) => id),
    ).toEqual(['k3x9']);
    expect(editor.getUiState().changes.map(({ id }) => id)).toEqual(['k3x9']);
    editor.destroy();
  });

  it('leaves out the halves of a move, which v0.1 draws but does not decide', () => {
    const doc = [
      'Ship <!--ins k3x9-->it <!--/k3x9-->now.<!--del m4vf  The old text.-->',
      '',
      'Later: <!--ins n5vt-->The old text.<!--/n5vt-->',
      '',
      '<!-- redlines',
      'version: 1',
      'marks:',
      '  k3x9: {by: ada, at: 2026-10-31T09:30Z}',
      '  m4vf: {by: bo, at: 2026-10-31T09:31Z, move: n5vt}',
      '  n5vt: {by: bo, at: 2026-10-31T09:31Z, move: m4vf}',
      '-->',
      '',
    ].join('\n');
    const editor = mount(doc);
    const listed = (marks: readonly MarkRange[]) => marks.map(({ id }) => id);
    expect(listed(editor.getUiState().changes)).toEqual(['k3x9']);
    expect(listed(editor.getParsed().marks.filter(isChange))).toEqual(['k3x9']);
    // Both halves are still drawn.
    const drawn = (selector: string) =>
      [...editor.view.contentDOM.querySelectorAll(selector)].map((el) => el.textContent);
    expect(drawn('.rl-del')).toEqual([' The old text.']);
    expect(drawn('.rl-ins')).toEqual(['it ', 'The old text.']);
    editor.destroy();
  });

  describe('reloadDoc', () => {
    const select = (editor: ReturnType<typeof mount>, word: string) => {
      const from = editor.view.state.doc.toString().indexOf(word);
      editor.view.dispatch({ selection: { anchor: from, head: from + word.length } });
    };
    const selected = (editor: ReturnType<typeof mount>) => {
      const { from, to } = editor.view.state.selection.main;
      return editor.view.state.sliceDoc(from, to);
    };

    it('keeps a selection whose text is unchanged when both sides of it changed', () => {
      const editor = mount('Alpha beta importer gamma delta.\n');
      select(editor, 'importer');
      editor.reloadDoc('Alpha BETA importer gamma DELTA.\n');
      expect(selected(editor)).toBe('importer');
    });

    describe('Track Changes and a file that asks everyone to track (#364)', () => {
      const ledger = (...settings: string[]) =>
        `<!-- redlines\nversion: 1\n${settings.map((line) => `${line}\n`).join('')}-->\n`;
      const plain = `One.\n\n${ledger()}`;
      const asking = `One.\n\n${ledger('tracking: everyone')}`;
      const tracking = (editor: ReturnType<typeof mount>) => editor.getUiState().tracking;

      it('turns Track Changes on when the reloaded file newly asks everyone to track', () => {
        const editor = mount(plain);
        expect(tracking(editor)).toBe(false);
        editor.reloadDoc(asking);
        expect(tracking(editor)).toBe(true);
        // The file asks already: the switch writes nothing, and the text is the file's.
        expect(editor.getDoc()).toBe(asking);
        expect(editor.getUiState()).toMatchObject({ canUndo: false });
      });

      it('does so for a file that gained a ledger, and for a window that was tracking before', () => {
        const editor = mount('One.\n');
        editor.reloadDoc(asking);
        expect(tracking(editor)).toBe(true);
        // On already: it stays on.
        const on = mount(plain);
        on.setTracking(true, { inFile: false });
        on.reloadDoc(asking);
        expect(tracking(on)).toBe(true);
      });

      it('leaves Track Changes as it is when the file asked already: a person who turned it off keeps it off', () => {
        const editor = mount(asking);
        expect(tracking(editor)).toBe(true);
        editor.setTracking(false, { inFile: false });
        editor.reloadDoc(asking.replace('One.', 'One, two.'));
        expect(tracking(editor)).toBe(false);
      });

      it('leaves Track Changes on when the reloaded file stops asking, and off when it never asked', () => {
        const editor = mount(asking);
        expect(tracking(editor)).toBe(true);
        editor.reloadDoc(plain);
        expect(tracking(editor)).toBe(true);
        const never = mount(plain);
        never.reloadDoc(plain.replace('One.', 'One, two.'));
        expect(tracking(never)).toBe(false);
      });
    });

    it('keeps a backwards selection backwards', () => {
      const editor = mount('Alpha beta importer gamma delta.\n');
      const from = editor.view.state.doc.toString().indexOf('importer');
      editor.view.dispatch({ selection: { anchor: from + 8, head: from } });
      editor.reloadDoc('Alpha BETA importer gamma DELTA.\n');
      const { anchor, head } = editor.view.state.selection.main;
      expect(anchor).toBeGreaterThan(head);
      expect(selected(editor)).toBe('importer');
    });
  });
});

describe('undo and redo for the host', () => {
  it('says whether there is a step to undo or redo, and does them', () => {
    const editor = mount('One.\n');
    expect(editor.getUiState()).toMatchObject({ canUndo: false, canRedo: false });
    editor.view.dispatch({
      changes: { from: 3, insert: '!' },
      userEvent: 'input.type',
    });
    expect(editor.getUiState()).toMatchObject({ canUndo: true, canRedo: false, undo: 'Typing' });
    expect(editor.undo()).toBe(true);
    expect(editor.view.state.doc.toString()).toBe('One.\n');
    expect(editor.getUiState()).toMatchObject({ canUndo: false, canRedo: true, redo: 'Typing' });
    expect(editor.redo()).toBe(true);
    expect(editor.view.state.doc.toString()).toBe('One!.\n');
    expect(editor.undo()).toBe(true);
    expect(editor.undo()).toBe(false);
  });

  it('reports the change of what can be undone to the host', () => {
    const seen: boolean[] = [];
    const parent = document.createElement('div');
    document.body.append(parent);
    const editor = createEditor(parent, {
      doc: 'One.\n',
      author,
      onUiState: (state) => seen.push(state.canUndo),
    });
    editor.view.dispatch({ changes: { from: 3, insert: '!' }, userEvent: 'input.type' });
    editor.undo();
    expect(seen).toContain(true);
    expect(seen.at(-1)).toBe(false);
  });
});

describe('Undo and Redo that have nothing to take back', () => {
  const mac = /Mac/.test(navigator.platform);
  const press = (editor: ReturnType<typeof mount>, key: string, shiftKey = false) => {
    const event = new KeyboardEvent('keydown', {
      key: shiftKey ? key.toUpperCase() : key,
      shiftKey,
      ctrlKey: !mac,
      metaKey: mac,
      bubbles: true,
      cancelable: true,
    });
    return runScopeHandlers(editor.view, event, 'editor');
  };

  it("are taken by the editor's keys all the same, and say there was nothing", () => {
    const parent = document.createElement('div');
    document.body.append(parent);
    let nothing = 0;
    const editor = createEditor(parent, {
      doc: 'One.\n',
      author,
      onNothingToUndo: () => nothing++,
    });
    expect(press(editor, 'z')).toBe(true);
    expect(mac ? press(editor, 'z', true) : press(editor, 'y')).toBe(true);
    expect(nothing).toBe(2);
    expect(editor.undo()).toBe(false);
    expect(nothing).toBe(3);
  });

  it('are enabled for the menu when they would say why, and the menu says it too', () => {
    const parent = document.createElement('div');
    document.body.append(parent);
    const notices: string[] = [];
    const editor = createEditor(parent, {
      doc: 'One.\n',
      author,
      onNotice: (message) => notices.push(message),
    });
    editor.view.dispatch({ changes: { from: 3, insert: '!' }, userEvent: 'input.type' });
    editor.reloadDoc('Two.\n');
    expect(editor.getUiState()).toMatchObject({ canUndo: true, canRedo: true });
    expect(editor.undo()).toBe(true);
    expect(notices).toHaveLength(1);
  });
});
