// @vitest-environment happy-dom
import { forceParsing } from '@codemirror/language';
import { createEditor, type Editor, type EditorCommand } from '@redlines/editor';
import { afterEach, describe, expect, it } from 'vitest';
import { shownBar } from './items.ts';

const DOC = 'Before.\n\n![A red square](red.png)\n\nAfter.\n';
const editors: Editor[] = [];

function mount(doc = DOC): Editor {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, {
    doc,
    author: { handle: 'ada', name: 'Ada' },
    // A host that can open files has an Image menu: the commands come with it.
    openImage: () => {},
  });
  forceParsing(editor.view, editor.view.state.doc.length, 5000);
  editors.push(editor);
  return editor;
}
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

const at = (editor: Editor, text: string) =>
  editor.view.dispatch({
    selection: { anchor: editor.view.state.doc.toString().indexOf(text) + 1 },
  });
const image = (editor: Editor, extra: readonly EditorCommand[] = []) =>
  shownBar([...editor.commands.list(), ...extra], editor.view.state).menus.find(
    (menu) => menu.id === 'image',
  );

describe('the Image menu', () => {
  it('is in the bar only where an image is picked', () => {
    const editor = mount();
    at(editor, 'Before');
    expect(image(editor)).toBeUndefined();
    at(editor, 'A red');
    expect(image(editor)?.label).toBe('Image');
  });

  it('holds Align and Size in lines of their own, Original Size and Edit in Preview', () => {
    const editor = mount();
    at(editor, 'A red');
    const rows = image(editor)?.rows.map((row) => row.map((item) => item.label));
    expect(rows).toEqual([
      ['Left', 'Center', 'Right'],
      ['Small', 'Medium', 'Large'],
      ['Original Size'],
      ['Edit in Preview'],
    ]);
    expect(image(editor)?.rows[0]?.[0]?.caption).toBe('Align');
    expect(image(editor)?.rows[1]?.[0]?.caption).toBe('Size');
  });

  it('checks the alignment the image has, centered by default', () => {
    const editor = mount();
    at(editor, 'A red');
    const active = () =>
      image(editor)
        ?.rows[0]?.filter((item) => item.active)
        .map((item) => item.label);
    expect(active()).toEqual(['Center']);
    editor.commands.run('image.align.right');
    at(editor, 'red.png');
    expect(active()).toEqual(['Right']);
  });

  it('says why Original Size is grayed on an image at its own size', () => {
    const editor = mount();
    at(editor, 'A red');
    const original = image(editor)?.rows[2]?.[0];
    expect(original?.enabled).toBe(false);
    expect(original?.reason).toMatch(/original size already/);
    editor.commands.run('image.size.small');
    at(editor, 'red.png');
    expect(image(editor)?.rows[2]?.[0]?.enabled).toBe(true);
  });

  it('has Edit in Preview, and a place for Alt Text… until an agent’s command is registered', () => {
    const editor = mount();
    at(editor, 'A red');
    const alt: EditorCommand = { id: 'image.altText', title: 'Alt Text…', run: () => true };
    const ids = (extra: readonly EditorCommand[] = []) =>
      image(editor, extra)
        ?.rows.flat()
        .map((item) => item.id);
    expect(ids()?.at(-1)).toBe('image.edit');
    expect(ids([alt])?.slice(-2)).toEqual(['image.edit', 'image.altText']);
  });

  it('grays Edit in Preview on an image that is not a file, and says why', () => {
    const editor = mount('![far](https://example.com/a.png)\n');
    at(editor, 'far');
    const edit = image(editor)
      ?.rows.flat()
      .find((item) => item.id === 'image.edit');
    expect(edit?.enabled).toBe(false);
    expect(edit?.reason).toBeTruthy();
  });
});
