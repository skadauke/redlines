// @vitest-environment happy-dom
import { StateField } from '@codemirror/state';
import { EditorView, ViewPlugin } from '@codemirror/view';
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
});
