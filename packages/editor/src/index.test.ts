// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { createEditor } from './index.ts';

describe('createEditor', () => {
  it('mounts CodeMirror and reads the document back', () => {
    const parent = document.createElement('div');
    document.body.append(parent);
    const doc = '# Launch plan\n\nWe will ship the importer in April.\n';

    const editor = createEditor(parent, { doc });
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
