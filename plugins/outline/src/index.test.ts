// @vitest-environment happy-dom
import { createEditor } from '@redlines/editor';
import { afterEach, describe, expect, it } from 'vitest';
import { plugin } from './index.ts';

afterEach(() => document.body.replaceChildren());

describe('the outline plugin', () => {
  it('declares the command it registers, and takes it out again with the outline', () => {
    const parent = document.createElement('div');
    document.body.append(parent);
    const editor = createEditor(parent, {
      doc: '# One\n\n## Two\n',
      author: { handle: 'ada', name: 'Ada Lovelace' },
    });
    const declared = plugin.manifest.contributes?.commands?.map(({ id }) => id);
    expect(declared).toEqual(['outline.focus']);
    const remove = plugin.activate({
      editor,
      host: {},
      author: { handle: 'ada', name: 'Ada Lovelace' },
      notice: () => {},
    });
    expect(editor.commands.list().map(({ id }) => id)).toEqual(declared);
    expect(editor.commands.list()[0]).toMatchObject({ shortcut: 'Mod-Ctrl-o', menu: 'view' });
    remove();
    expect(editor.commands.list()).toEqual([]);
    editor.destroy();
  });
});
