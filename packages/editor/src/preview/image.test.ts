// @vitest-environment happy-dom
import { forceParsing } from '@codemirror/language';
import { EditorView, type WidgetType } from '@codemirror/view';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEditor, type Editor } from '../index.ts';
import { previewDecorations } from './decorations.ts';
import { imagePress } from './image.ts';

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
  imageSize?: (
    src: string,
  ) => { width: number; height: number } | null | Promise<{ width: number; height: number } | null>,
): Editor {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, { doc, author, view: 'redlines', resolveImage, imageSize });
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

describe('an image under the selection (#675)', () => {
  const DOC = 'Before ![A cat](cat.png) after';
  const from = DOC.indexOf('![');
  const to = DOC.indexOf(')') + 1;

  it('is drawn with the caret at either end, and its source stays hidden', () => {
    for (const at of [from, to]) {
      const [image] = drawn(editorWith(DOC, local, at));
      expect(image, `drawn with the caret at ${at}`).toBeDefined();
      expect(image?.classList.contains('rl-image-selected')).toBe(false);
    }
  });

  it('is drawn selected when the selection is exactly the image, with the handles to grab', () => {
    const editor = editorWith(DOC, local, 0);
    editor.view.dispatch({ selection: { anchor: from, head: to } });
    const [image] = drawn(editor);
    expect(image?.classList.contains('rl-image-selected')).toBe(true);
    expect(image?.querySelectorAll('.rl-image-handle')).toHaveLength(2);
  });

  it('is the same drawn picture when selected, with one set of handles, not drawn again (#1195)', () => {
    const editor = editorWith(DOC, local, 0);
    const before = editor.view.contentDOM.querySelector('.rl-image');
    expect(before, 'the picture is drawn').not.toBeNull();
    expect(before?.querySelectorAll('.rl-image-handle')).toHaveLength(2);
    editor.view.dispatch({ selection: { anchor: from, head: to } });
    const all = editor.view.contentDOM.querySelectorAll('.rl-image');
    expect(all, 'one picture, not two').toHaveLength(1);
    expect(all[0], 'the same element, so that its handles stay where they are').toBe(before);
    expect(all[0]?.classList.contains('rl-image-selected')).toBe(true);
    expect(editor.view.contentDOM.querySelectorAll('.rl-image-handle')).toHaveLength(2);
    editor.view.dispatch({ selection: { anchor: 0 } });
    expect(editor.view.contentDOM.querySelector('.rl-image')).toBe(before);
    expect(before?.classList.contains('rl-image-selected')).toBe(false);
    expect(editor.view.contentDOM.querySelectorAll('.rl-image-handle')).toHaveLength(2);
  });

  it('is still drawn again when its alt text, source or width changes, selected or not', () => {
    const editor = editorWith('![A cat](cat.png)', local, 0);
    const first = () => editor.view.contentDOM.querySelector<HTMLElement>('.rl-image');
    const before = first();
    expect(before).not.toBeNull();
    // The alt text.
    editor.view.dispatch({ changes: { from: 4, to: 5, insert: 'dog' } });
    const alt = first();
    expect(alt, 'a new alt text draws a new picture').not.toBe(before);
    expect(alt?.querySelector('img')?.getAttribute('alt')).toBe('A dogat');
    // The source.
    const text = editor.view.state.doc.toString();
    editor.view.dispatch({
      changes: { from: text.indexOf('cat.png'), to: text.indexOf('cat.png') + 3, insert: 'bat' },
    });
    const src = first();
    expect(src, 'a new source draws a new picture').not.toBe(alt);
    expect(src?.querySelector('img')?.getAttribute('src')).toBe('app://bat.png');
    // The width, through the selection that holds the image as well.
    const all = editor.view.state.doc.length;
    editor.view.dispatch({
      changes: { from: 0, to: all, insert: '<img src="bat.png" alt="A dogat" width="120">' },
    });
    editor.view.dispatch({ selection: { anchor: 0, head: editor.view.state.doc.length } });
    const wide = first();
    expect(wide, 'a width draws a new picture').not.toBe(src);
    expect(wide?.querySelector('img')?.style.width).not.toBe('');
  });

  it('shows its source only when the selection has an end inside it', () => {
    expect(drawn(editorWith(DOC, local, from + 4))).toHaveLength(0);
    const editor = editorWith(DOC, local, 0);
    editor.view.dispatch({ selection: { anchor: from + 2, head: to + 3 } });
    expect(drawn(editor)).toHaveLength(0);
    // A selection that runs across the whole image, and past it, still draws it.
    editor.view.dispatch({ selection: { anchor: 0, head: to + 3 } });
    expect(drawn(editor)).toHaveLength(1);
  });

  it('is one unit that the caret steps over', () => {
    const editor = editorWith(DOC, local, from);
    const atomic = editor.view.state.facet(EditorView.atomicRanges);
    const found: [number, number][] = [];
    for (const source of atomic) {
      source(editor.view).between(0, DOC.length, (a, b) => void found.push([a, b]));
    }
    expect(found).toContainEqual([from, to]);
  });
});

describe('images', () => {
  it('holds an image’s room before it loads, from the size the host knows', async () => {
    const asked: string[] = [];
    const editor = editorWith(
      '![cat](img/cat.png)\n\nend',
      (src) => `asset://${src}`,
      undefined,
      (src) => {
        asked.push(src);
        return Promise.resolve({ width: 640, height: 480 });
      },
    );
    const img = drawn(editor)[0]!.querySelector('img')!;
    expect(img.loading).toBe('lazy');
    expect(img.decoding).toBe('async');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(new Set(asked)).toEqual(new Set(['img/cat.png']));
    expect(img.getAttribute('width')).toBe('640');
    expect(img.getAttribute('height')).toBe('480');
    expect(img.style.getPropertyValue('width')).not.toBe('');
  });

  it('draws an image whose size isn’t known as it did', () => {
    const editor = editorWith(
      '![cat](img/cat.png)\n\nend',
      (src) => `asset://${src}`,
      undefined,
      () => null,
    );
    const img = drawn(editor)[0]!.querySelector('img')!;
    expect(img.hasAttribute('width')).toBe(false);
  });

  it('centers an image alone in its paragraph, with its pending change around it or not', () => {
    const alone = (doc: string) => drawn(editorWith(doc, local, 0))[0];
    const plain = 'Before\n\n![A cat](cat.png)\n\nAfter';
    expect(alone(plain)?.classList.contains('rl-image-own')).toBe(true);
    const tracked = `Before\n\n<!--ins k3x9-->\n\n![A cat](cat.png)<!--/k3x9-->\n\nAfter${ledger(['k3x9'])}`;
    expect(alone(tracked)?.classList.contains('rl-image-own')).toBe(true);
    const split = `Before\n\n![A cat](cat.png)<!--split k3x9-->\nAfter${ledger(['k3x9'])}`;
    expect(alone(split)?.classList.contains('rl-image-own')).toBe(true);
    // A marker whose payload holds a `>` is still a marker.
    const payload = `Before\n\n![A cat](cat.png)<!--del k3x9 a > b-->\n\nAfter${ledger(['k3x9'])}`;
    expect(alone(payload)?.classList.contains('rl-image-own')).toBe(true);
    // An item's or a quote's text flows with its marker: not alone.
    expect(alone('- ![A cat](cat.png)\n')?.classList.contains('rl-image-own')).toBe(false);
    expect(alone('> ![A cat](cat.png)\n')?.classList.contains('rl-image-own')).toBe(false);
    // Text beside it keeps it in the line.
    const inline = 'Before ![A cat](cat.png) after';
    expect(alone(inline)?.classList.contains('rl-image-own')).toBe(false);
    const trackedInline = `Before <!--ins k3x9-->![A cat](cat.png)<!--/k3x9-->${ledger(['k3x9'])}`;
    expect(alone(trackedInline)?.classList.contains('rl-image-own')).toBe(false);
  });

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

describe('opening an image', () => {
  const DOC = 'Hello ![A cat](img/a%20cat.png) and ![Web](https://example.com/w.png) end';

  function editorOpening(openImage?: (src: string) => void): Editor {
    const parent = document.createElement('div');
    document.body.append(parent);
    const editor = createEditor(parent, {
      doc: DOC,
      author,
      view: 'redlines',
      resolveImage: local,
      openImage,
    });
    forceParsing(editor.view, editor.view.state.doc.length, 10_000);
    editor.view.dispatch({ selection: { anchor: DOC.length } });
    open.push(editor);
    return editor;
  }

  /** A press, handed to the extension's handler alone: the editor's own handling needs a layout. */
  const pressed = (handler: ReturnType<typeof imagePress>, editor: Editor) => {
    const press = (target: Element, detail: number) => {
      const event = new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        button: 0,
        detail,
      });
      Object.defineProperty(event, 'target', { value: target });
      return handler(event, editor.view);
    };
    return press;
  };

  it('hands the path of a local image, decoded, to the host on a double-click', () => {
    const opened: string[] = [];
    const editor = editorOpening();
    const press = pressed(
      imagePress((src) => opened.push(src)),
      editor,
    );
    const [cat] = editor.view.dom.querySelectorAll('.rl-image');
    expect(press(cat!, 1)).toBe(false);
    // The first click selects the image, and the second lands there: it is taken whole, so that it
    // selects no word.
    expect(press(editor.view.contentDOM, 2)).toBe(true);
    expect(opened).toEqual(['img/a cat.png']);
  });

  it('does nothing for a remote image, and selects no word either', () => {
    const opened: string[] = [];
    const editor = editorOpening();
    const press = pressed(
      imagePress((src) => opened.push(src)),
      editor,
    );
    const web = editor.view.dom.querySelectorAll('.rl-image')[1];
    press(web!, 1);
    expect(press(editor.view.contentDOM, 2)).toBe(true);
    expect(opened).toEqual([]);
  });

  it('does nothing for a double-click that did not start on an image', () => {
    const opened: string[] = [];
    const editor = editorOpening();
    const press = pressed(
      imagePress((src) => opened.push(src)),
      editor,
    );
    press(editor.view.contentDOM, 1);
    expect(press(editor.view.contentDOM, 2)).toBe(false);
    expect(opened).toEqual([]);
  });

  it('does nothing when the second press is late, or the text changed between them', () => {
    const opened: string[] = [];
    const editor = editorOpening();
    const press = pressed(
      imagePress((src) => opened.push(src)),
      editor,
    );
    const [cat] = editor.view.dom.querySelectorAll('.rl-image');
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(1000);
    press(cat!, 1);
    now.mockReturnValue(1000 + 5000);
    expect(press(editor.view.contentDOM, 2)).toBe(false);
    now.mockReturnValue(1000);
    press(cat!, 1);
    editor.view.dispatch({ changes: { from: 0, insert: 'x' } });
    expect(press(editor.view.contentDOM, 2)).toBe(false);
    now.mockRestore();
    expect(opened).toEqual([]);
  });

  it('is part of the editor only with a host hook, which also registers the command', () => {
    const without = editorOpening();
    expect(without.commands.list().some(({ id }) => id === 'image.edit')).toBe(false);
    const withHook = editorOpening(() => {});
    expect(withHook.commands.list().some(({ id }) => id === 'image.edit')).toBe(true);
  });

  it('has a command for the image under the caret or in the selection', () => {
    const opened: string[] = [];
    const editor = editorOpening((src) => opened.push(src));
    const command = () => editor.commands.list().find(({ id }) => id === 'image.edit')!;
    expect(command().title).toBe('Edit Image in Preview');
    // The caret is at the end, off any image: disabled.
    expect(editor.getUiState().enabledCommands).not.toContain('image.edit');
    expect(editor.commands.run('image.edit')).toBe(false);
    // On the local image.
    editor.view.dispatch({ selection: { anchor: DOC.indexOf('cat') } });
    expect(editor.getUiState().enabledCommands).toContain('image.edit');
    expect(editor.commands.run('image.edit')).toBe(true);
    // In a selection that holds it.
    editor.view.dispatch({ selection: { anchor: 0, head: DOC.indexOf(' and') } });
    expect(editor.commands.run('image.edit')).toBe(true);
    // On the remote image: it has no file.
    editor.view.dispatch({ selection: { anchor: DOC.indexOf('example') } });
    expect(editor.commands.run('image.edit')).toBe(false);
    expect(opened).toEqual(['img/a cat.png', 'img/a cat.png']);
  });
});

describe('an image with a size (#526)', () => {
  it('draws an `<img>` tag as an image with its width, and keeps a tag with no src as source', () => {
    const editor = editorWith('Words <img src="cat.png" width="200"> more', local, 0);
    const [image] = drawn(editor);
    expect(image?.querySelector('img')?.style.width).toContain('200px');
    expect(drawn(editorWith('Words <img alt="no source"> more', local, 0))).toHaveLength(0);
    expect(drawn(editorWith('Words <b>bold</b> more', local, 0))).toHaveLength(0);
  });

  it('draws a tag alone on its line, an HTML block, centered', () => {
    const editor = editorWith('Before\n\n<img src="cat.png" width="200">\n\nAfter', local, 0);
    const [image] = drawn(editor);
    expect(image?.classList.contains('rl-image-own')).toBe(true);
    expect(image?.querySelector('img')?.style.width).toContain('200px');
    // A tag with more in its block is HTML, not an image.
    expect(drawn(editorWith('<img src="cat.png">\nmore text', local, 0))).toHaveLength(0);
  });

  it('has no handle on the edge an aligned image is anchored to', () => {
    for (const [align, kept] of [
      ['left', 'right'],
      ['right', 'left'],
    ] as const) {
      const [image] = drawn(editorWith(`<img src="cat.png" align="${align}">`, local, 0));
      const handles = [...image!.querySelectorAll('.rl-image-handle')];
      expect(handles.map((h) => h.className)).toEqual([
        expect.stringContaining(`rl-image-handle-${kept}`),
      ]);
    }
  });

  it('draws a left or right alignment on a line of its own', () => {
    const [image] = drawn(
      editorWith('Before\n\n<img src="cat.png" align="left">\n\nAfter', local, 0),
    );
    expect(image?.classList.contains('rl-image-left')).toBe(true);
  });

  it('has a handle on each edge, and none on an image that is only its alt text', () => {
    const [image] = drawn(editorWith('Before\n\n![A cat](cat.png)', local, 0));
    expect(image?.querySelectorAll('.rl-image-handle')).toHaveLength(2);
    expect(image?.querySelector('.rl-image-handle-left')?.getAttribute('title')).toBe(
      'Drag to resize',
    );
    const [missing] = drawn(editorWith('Before\n\n![A cat](cat.png)', () => null, 0));
    expect(missing?.querySelectorAll('.rl-image-handle')).toHaveLength(0);
  });

  it('puts a handle inside the edge where outside is outside the text column (#676)', () => {
    const [image] = drawn(editorWith('Before\n\n![A cat](cat.png)', local, 0));
    const frame = image!.querySelector<HTMLElement>('.rl-image-frame')!;
    const line = document.createElement('div');
    line.className = 'cm-line';
    image!.replaceWith(line);
    line.append(image!);
    const rect = (left: number, right: number) => ({ left, right, width: right - left }) as DOMRect;
    line.getBoundingClientRect = () => rect(100, 700);
    // As wide as the column: both handles would lie in the margin.
    frame.getBoundingClientRect = () => rect(100, 700);
    frame.dispatchEvent(new Event('pointerenter'));
    expect(frame.classList.contains('rl-handle-in-left')).toBe(true);
    expect(frame.classList.contains('rl-handle-in-right')).toBe(true);
    // Narrower: they stand outside, as before.
    frame.getBoundingClientRect = () => rect(200, 600);
    frame.dispatchEvent(new Event('pointermove'));
    expect(frame.classList.contains('rl-handle-in-left')).toBe(false);
    expect(frame.classList.contains('rl-handle-in-right')).toBe(false);
  });

  /** A drag of the handle on `side` by `dx` px, of an image `width` px wide in a column of 600. */
  function drag(editor: Editor, side: 'left' | 'right', dx: number, width = 200, natural = 400) {
    const [image] = drawn(editor);
    const img = image!.querySelector('img')!;
    img.getBoundingClientRect = () => ({ width }) as DOMRect;
    Object.defineProperty(img, 'naturalWidth', { value: natural });
    const line = document.createElement('div');
    Object.defineProperty(line, 'clientWidth', { value: 600 });
    line.className = 'cm-line';
    line.append(image!);
    document.body.append(line);
    const handle = image!.querySelector<HTMLElement>(`.rl-image-handle-${side}`)!;
    handle.setPointerCapture = () => {};
    handle.releasePointerCapture = () => {};
    const event = (type: string, x: number) => {
      const found = new MouseEvent(type, {
        clientX: x,
        button: 0,
        bubbles: true,
        cancelable: true,
      });
      return Object.assign(found, { pointerId: 1 });
    };
    handle.dispatchEvent(event('pointerdown', 100));
    handle.dispatchEvent(event('pointermove', 100 + dx));
    const live = img.style.width;
    handle.dispatchEvent(event('pointerup', 100 + dx));
    return { live, after: img.style.width };
  }

  it('resizes with a drag: the image follows the pointer, and the width is written at its end', () => {
    // A centered image grows at both edges: the edge is at twice the distance.
    const editor = editorWith('Before\n\n![A cat](cat.png)\n\nAfter', local, 0);
    // Its position: the widget replaces the image at 8.
    editor.view.posAtDOM = () => 8;
    const { live } = drag(editor, 'right', 50);
    expect(live).toBe('300px');
    expect(editor.getDoc()).toBe('Before\n\n<img src="cat.png" alt="A cat" width="300">\n\nAfter');
  });

  it('takes the left handle the other way, and keeps the least width', () => {
    const editor = editorWith('Before\n\n![A cat](cat.png)\n\nAfter', local, 0);
    editor.view.posAtDOM = () => 8;
    const { live } = drag(editor, 'left', 200);
    expect(live).toBe('24px');
    expect(editor.getDoc()).toBe('Before\n\n<img src="cat.png" alt="A cat" width="24">\n\nAfter');
  });

  it('stops at the column', () => {
    const editor = editorWith('Before\n\n![A cat](cat.png)\n\nAfter', local, 0);
    editor.view.posAtDOM = () => 8;
    expect(drag(editor, 'right', 500, 200, 2000).live).toBe('600px');
  });

  it('gives the image its own size again when it is dragged to it', () => {
    const editor = editorWith('Before\n\n<img src="cat.png" width="100">\n\nAfter', local, 0);
    editor.view.posAtDOM = () => 8;
    // 100 px wide, its own size 400, the column 600: 100 + 2 × 150 = 400.
    drag(editor, 'right', 150, 100, 400);
    expect(editor.getDoc()).toBe('Before\n\n![](cat.png)\n\nAfter');
  });
});
