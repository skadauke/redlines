// @vitest-environment happy-dom
// Includes of a Quarto file (decision 4 of docs/research/quarto.md): a line that holds an include
// shortcode alone is a collapsed block with the file's name, its pending changes and an Open button,
// which expands to a read-only preview of the file.

import { forceParsing } from '@codemirror/language';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEditor, type Editor, type IncludeHost } from '../index.ts';
import { includeDecorations, includePath, summaryOf } from './quarto-include.ts';

const author = { handle: 'ada', name: 'Ada Lovelace' };
const open: Editor[] = [];

afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

const PART = [
  'The part, with a <!--ins k3x9-->new <!--/k3x9-->word.',
  '',
  '<!-- redlines',
  'version: 1',
  'people:',
  '  ada: {name: Ada Lovelace}',
  'marks:',
  '  k3x9: {by: ada, at: 2026-11-17T10:00Z}',
  '-->',
  '',
].join('\n');

const DOC = '# Host\n\n{{< include _part.qmd >}}\n\nAfter.\n';

function editorAt(
  doc: string,
  cursor: number,
  includes?: IncludeHost,
  dialect: 'gfm' | 'pandoc' = 'pandoc',
): Editor {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, { doc, author, dialect, ...(includes ? { includes } : {}) });
  forceParsing(editor.view, editor.view.state.doc.length, 10_000);
  editor.view.dispatch({ selection: { anchor: cursor } });
  open.push(editor);
  return editor;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('the include line', () => {
  it('is a shortcode alone on its line, in any spacing or quotes', () => {
    expect(includePath('{{< include _part.qmd >}}')).toBe('_part.qmd');
    expect(includePath('{{<  include   "dir/a b.qmd"  >}}')).toBe('dir/a b.qmd');
    expect(includePath("  {{< include 'x.qmd' >}}  ")).toBe('x.qmd');
    expect(includePath('Text {{< include x.qmd >}}')).toBeNull();
    expect(includePath('{{< include x.qmd >}} and more')).toBeNull();
    expect(includePath('{{< video x.mp4 >}}')).toBeNull();
  });

  it('counts the pending changes of a file and gives its newest text', () => {
    const { pending, newest } = summaryOf(PART);
    expect(pending).toBe(1);
    expect(newest).toContain('new word');
    expect(newest).not.toContain('<!--');
  });
});

describe('the include block', () => {
  it('replaces the line while the caret is away, and not while it is on it', () => {
    const away = editorAt(DOC, 0);
    let blocks = 0;
    includeDecorations(away.view.state).between(0, DOC.length, () => void blocks++);
    expect(blocks).toBe(1);
    const at = DOC.indexOf('{{<') + 4;
    const on = editorAt(DOC, at);
    blocks = 0;
    includeDecorations(on.view.state).between(0, DOC.length, () => void blocks++);
    expect(blocks).toBe(0);
  });

  it('is none in a Markdown file or inside code', () => {
    const md = editorAt(DOC, 0, undefined, 'gfm');
    expect(includeDecorations(md.view.state).size).toBe(0);
    const code = editorAt('```\n{{< include _part.qmd >}}\n```\n', 0);
    expect(includeDecorations(code.view.state).size).toBe(0);
  });

  it('names the file, counts its changes, previews it read-only and opens it', async () => {
    const read = vi.fn(() => Promise.resolve(PART));
    const openFile = vi.fn();
    const editor = editorAt(DOC, 0, { read, open: openFile });
    await settle();
    const block = editor.view.contentDOM.querySelector<HTMLElement>('.rl-include');
    expect(block).not.toBeNull();
    expect(read).toHaveBeenCalledWith('_part.qmd');
    expect(block!.querySelector('.rl-include-name')?.textContent).toBe('_part.qmd');
    expect(block!.querySelector('.rl-include-count')?.textContent).toBe('1 change pending');
    // Collapsed first, with the preview in the block and not in the document.
    const preview = block!.querySelector<HTMLElement>('.rl-include-preview')!;
    expect(preview.hidden).toBe(true);
    block!
      .querySelector('.rl-include-toggle')!
      .dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }));
    expect(preview.hidden).toBe(false);
    expect(preview.textContent).toBe('The part, with a new word.');
    block!
      .querySelector('.rl-include-open')!
      .dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }));
    expect(openFile).toHaveBeenCalledWith('_part.qmd');
    // Nothing of the included file went into this document.
    expect(editor.view.state.doc.toString()).toBe(DOC);
  });

  it('says so when the file can’t be read, and has no buttons without a host', async () => {
    const missing = editorAt(DOC, 0, { read: () => Promise.resolve(null), open: vi.fn() });
    await settle();
    expect(missing.view.contentDOM.querySelector('.rl-include-count')?.textContent).toBe(
      'not found',
    );
    const bare = editorAt(DOC, 0);
    expect(bare.view.contentDOM.querySelector('.rl-include-open')).toBeNull();
    expect(bare.view.contentDOM.querySelector('.rl-include-name')?.textContent).toBe('_part.qmd');
  });
});
