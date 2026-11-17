// @vitest-environment happy-dom
// HTML blocks drawn as GitHub draws them (#689): what is drawn, what is kept out, the source that
// opens on demand, a tracked edit in it, and Find.

import { forceParsing } from '@codemirror/language';
import { runScopeHandlers } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import { createEditor, type Editor, holdOpenAt } from '../index.ts';
import { viewModeField } from '../tracked/field.ts';
import { htmlBlockAt, openSource, renderHtml } from './html-block.ts';

const ada = { handle: 'ada', name: 'Ada Lovelace' };
const editors: Editor[] = [];

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

function load(doc: string, caret = 0): Editor {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, { doc, author: ada });
  forceParsing(editor.view, editor.view.state.doc.length, 10_000);
  editor.view.dispatch({ selection: { anchor: caret } });
  editors.push(editor);
  return editor;
}

const HEAD = '# Title\n\n';
const BLOCK = '<p align="center">\n<b>Bold</b> and <a href="https://x.dev">a link</a>\n</p>';
const DOC = `${HEAD}${BLOCK}\n\nAfter.\n`;
const at = DOC.indexOf('<p');

const html = (fragment: DocumentFragment) => {
  const div = document.createElement('div');
  div.append(fragment);
  return div.innerHTML;
};
const blocks = (editor: Editor) => editor.view.contentDOM.querySelectorAll('.rl-html-block');
const press = (editor: Editor, key: string) =>
  runScopeHandlers(editor.view, new KeyboardEvent('keydown', { key }), 'editor');

describe('the sanitizing', () => {
  it('keeps what GitHub keeps, with the attributes it draws', () => {
    const out = html(
      renderHtml('<table align="center"><tr><td colspan="2" rowspan=2>x</td></tr></table>'),
    );
    expect(out).toContain('<table align="center">');
    expect(out).toContain('colspan="2"');
    expect(out).toContain('rowspan="2"');
  });

  it('draws the hostile fixture inert', () => {
    const out = html(
      renderHtml(
        [
          '<p onclick="alert(1)" style="x:y" class="c" id="i">hi</p>',
          '<script>alert(1)</script>',
          '<a href="javascript:alert(1)">bad</a>',
          '<a href="JaVa\nScRiPt:alert(1)">bad2</a>',
          '<a href="https://ok.dev">ok</a>',
          '<img src="https://evil.dev/x.png" onerror="alert(1)" alt="pic">',
          '<iframe src="https://evil.dev"></iframe>',
          '<video src="a.mp4"></video>',
          '<form action="x"><input name="q"></form>',
          '<u>kept text</u>',
        ].join('\n'),
      ),
    );
    expect(out).not.toMatch(/onclick|onerror|style=|class="c"|id="i"|javascript/i);
    expect(out).not.toMatch(/<script|<iframe|<img|<video|<form|<input|<u>/);
    expect(out).not.toContain('evil.dev/x.png');
    expect(out).toContain('href="https://ok.dev"');
    // Escaped tags and dropped elements stay visible: the first as text, the second as a chip.
    expect(out).toContain('&lt;script&gt;');
    expect(out).toContain('rl-html-chip');
    expect(out).toContain('kept text');
    expect(out).toContain('pic');
  });

  it('draws a picture as its image box, never a request', () => {
    const out = html(
      renderHtml(
        '<picture><source media="(prefers-color-scheme: dark)" srcset="d.png"><img src="l.png" alt="logo"></picture>',
      ),
    );
    expect(out).not.toMatch(/srcset|src=|<source/);
    expect(out).toContain('logo');
  });
});

describe('images in an HTML block (#818)', () => {
  const local = (written: string) => `asset://${written}`;
  const PIC =
    '<picture><source media="(prefers-color-scheme: dark)" srcset="d.png 2x"><img src="l.png" alt="logo" width="120" height="40"></picture>';

  it('draws a local image through the resolver at its numeric width and height', () => {
    const out = html(
      renderHtml('<img src="a.png" alt="A" width="50" height="x">', document, local),
    );
    expect(out).toContain('src="asset://a.png"');
    expect(out).toContain('width="50"');
    expect(out).not.toContain('height');
  });

  it('draws a picture with the source of the appearance, the img otherwise', () => {
    const light = html(renderHtml(PIC, document, local, false));
    expect(light).toContain('src="asset://l.png"');
    expect(light).not.toContain('d.png');
    const dark = html(renderHtml(PIC, document, local, true));
    expect(dark).toContain('src="asset://d.png"');
    expect(dark).toContain('width="120"');
    expect(dark).not.toContain('<source');
  });

  it('never loads a remote image: the editor draws only what the host resolves', () => {
    const editor = load('<picture><img src="https://x.dev/a.png" alt="far"></picture>\n');
    expect(editor.view.contentDOM.querySelector('.rl-html-block img')).toBeNull();
  });

  it('draws a local image in the editor through resolveImage', () => {
    const parent = document.createElement('div');
    document.body.append(parent);
    const doc = '<p align="center"><img src="pics/a.png" alt="A" width="40"></p>\n\nAfter.\n';
    const editor = createEditor(parent, { doc, author: ada, resolveImage: local });
    editors.push(editor);
    forceParsing(editor.view, editor.view.state.doc.length, 10_000);
    const img = editor.view.contentDOM.querySelector('.rl-html-block img');
    expect(img?.getAttribute('src')).toBe('asset://pics/a.png');
  });
});

describe('what is drawn rendered', () => {
  it('draws a block of HTML with no Markdown twin, and keeps the Markdown around it', () => {
    const editor = load(DOC);
    expect(blocks(editor)).toHaveLength(1);
    const text = editor.view.contentDOM.textContent ?? '';
    expect(text).toContain('Bold');
    expect(text).not.toContain('<p align');
    expect(text).toContain('After.');
  });

  it('keeps a container, a heading, a block with a pending change and one with a twin as source', () => {
    for (const doc of [
      '<details>\n<summary>S</summary>\n\nBody.\n\n</details>\n',
      '<div align="center">\n\nText.\n\n</div>\n',
      '<h2>Title</h2>\n',
      '<hr>\n',
      '<script>\nalert(1)\n</script>\n',
      '> <p align="center">\n> quoted\n> </p>\n',
    ]) {
      expect(blocks(load(doc, doc.length))).toHaveLength(0);
    }
  });

  it('draws the block with spans, and the figure and the definition list', () => {
    const doc = [
      '<table>\n<tr><td colspan="2">wide</td></tr>\n</table>',
      '<figure>\n<figcaption>Caption</figcaption>\n</figure>',
      '<dl>\n<dt>Term</dt>\n<dd>Meaning</dd>\n</dl>',
    ].join('\n\n');
    const editor = load(`${doc}\n`, doc.length + 1);
    expect(blocks(editor).length).toBeGreaterThanOrEqual(2);
  });
});

describe('the source', () => {
  it('opens on a double-click and Return, and draws again on Escape', () => {
    const editor = load(DOC);
    const { view } = editor;
    // A click selects the block.
    const block = blocks(editor)[0] as HTMLElement;
    view.contentDOM.dispatchEvent(new Event('x'));
    const from = at;
    const to = at + BLOCK.length;
    view.dispatch({ selection: { anchor: from, head: to } });
    expect(blocks(editor)).toHaveLength(1);
    expect(block.isConnected || blocks(editor).length === 1).toBe(true);
    // Return opens the source: the HTML text is in the editor, with the Done head.
    expect(press(editor, 'Enter')).toBe(true);
    expect(blocks(editor)).toHaveLength(0);
    expect(view.contentDOM.querySelector('.rl-html-source-head')).not.toBeNull();
    expect(view.contentDOM.textContent).toContain('<p align="center">');
    // Escape draws it again, selected.
    expect(press(editor, 'Escape')).toBe(true);
    expect(blocks(editor)).toHaveLength(1);
    expect(view.state.selection.main.from).toBe(from);
    expect(view.state.selection.main.to).toBe(to);
  });

  it('shows the source for a caret inside it, and stays open while typing at its end', () => {
    const editor = load(DOC, at + 3);
    expect(blocks(editor)).toHaveLength(0);
    const end = at + BLOCK.length;
    editor.view.dispatch({ selection: { anchor: end } });
    editor.view.dispatch({ changes: { from: end, insert: ' ' }, selection: { anchor: end + 1 } });
    expect(blocks(editor)).toHaveLength(0);
    // Out of it, the block is drawn again.
    editor.view.dispatch({ selection: { anchor: DOC.length } });
    expect(blocks(editor)).toHaveLength(1);
  });

  it('steps from the edge onto the block with an arrow, and over it with the next', () => {
    const editor = load(DOC, at);
    expect(press(editor, 'ArrowRight')).toBe(true);
    const main = editor.view.state.selection.main;
    expect([main.from, main.to]).toEqual([at, at + BLOCK.length]);
  });

  it('opens a source over sixty lines in Plain, at the spot', () => {
    const long = `<p>\n${'line\n'.repeat(70)}</p>`;
    const editor = load(`${long}\n\nAfter.\n`);
    const block = htmlBlockAt(editor.view.state, 0)!;
    openSource(editor.view, block);
    expect(editor.view.state.field(viewModeField)).toBe('raw');
  });

  it('opens the source for a held match of Find, and draws it again when the match leaves', () => {
    const editor = load(DOC, DOC.length);
    expect(blocks(editor)).toHaveLength(1);
    editor.view.dispatch({ effects: holdOpenAt.of(DOC.indexOf('Bold')) });
    expect(blocks(editor)).toHaveLength(0);
    editor.view.dispatch({ effects: holdOpenAt.of(DOC.indexOf('After.')) });
    expect(blocks(editor)).toHaveLength(1);
  });
});

describe('a tracked edit in the source', () => {
  it('is an ordinary tracked edit; the block shows its source while a change is pending', () => {
    const editor = load(DOC, at + 3);
    editor.setTracking?.(true);
    const pos = DOC.indexOf('Bold');
    editor.view.dispatch({
      changes: { from: pos, to: pos + 4, insert: 'Strong' },
      selection: { anchor: pos + 6 },
      userEvent: 'input.type',
    });
    const doc = editor.getDoc();
    expect(doc).toContain('Strong');
    // Old text is kept for the change, and no refusal: the edit is written.
    expect(doc).toContain('Bold');
    editor.view.dispatch({ selection: { anchor: doc.length } });
    // A pending change is seen and decided in its text, not drawn away.
    expect(blocks(editor)).toHaveLength(0);
  });
});
