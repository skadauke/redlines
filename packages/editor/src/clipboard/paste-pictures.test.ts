// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { newestView, parse } from '@redlines/format';
import { afterEach, describe, expect, it } from 'vitest';
import { createEditor, type Editor, type EditorOptions, type ImageSpot } from '../index.ts';
import { htmlToMarkdown, type PictureSink } from './paste-html.ts';

// Pictures in pasted HTML: Word's come with their bytes (a real capture of Word for Mac, scrubbed,
// fixtures/word-picture.html), Google Docs' as addresses of its own.

const WORD = readFileSync('packages/editor/src/clipboard/fixtures/word-picture.html', 'utf8');
const ALT = 'Title: Shelter - Description: The sensor shelter';

const sink = (): PictureSink => ({ pictures: [], unreadable: 0, linked: 0, read: new Map() });

describe('htmlToMarkdown, pictures with their bytes (Word)', () => {
  it('keeps the data picture inside Word’s downlevel-revealed block, by its sniffed type', () => {
    const found = sink();
    const md = htmlToMarkdown(WORD, found);
    expect(md).toBe(
      `# Pictures from Word\n\nThe sensor shelter before the storm:\n\n![${ALT}](redlines-picture:0)\n\nThe shelter after the repairs, with **bold** text.`,
    );
    expect(found.pictures).toHaveLength(1);
    // Word labels the data `image/png`; the bytes are a JPEG.
    expect(WORD).toContain('data:image/png;base64,/9j/');
    expect(found.pictures[0]).toMatchObject({ type: 'image/jpeg', extension: 'jpg' });
    expect(Array.from(found.pictures[0]!.bytes.slice(0, 3))).toEqual([0xff, 0xd8, 0xff]);
  });

  it('never reads the file: reference to Word’s temporary folder', () => {
    expect(htmlToMarkdown(WORD, sink())).not.toMatch(/file:|Users|msowordhtmlclip/);
  });

  it('leaves the picture out when the paste asks for none, as before', () => {
    expect(htmlToMarkdown(WORD)).not.toContain('![');
  });

  it('never takes a page’s own address for a picture placeholder', () => {
    expect(htmlToMarkdown('<p>a <img src="redlines-picture:0" alt="x"> b</p>', sink())).toBe('a b');
  });

  it('counts data that is no image as unreadable, and leaves it out', () => {
    const found = sink();
    const md = htmlToMarkdown('<p>a <img src="data:image/png;base64,AAAA"> b</p>', found);
    expect(md).toBe('a b');
    expect(found).toMatchObject({ pictures: [], unreadable: 1 });
  });

  it('counts the pictures that stay linked to a web address (Google Docs)', () => {
    const found = sink();
    const md = htmlToMarkdown(
      '<p><img src="https://lh7-rt.googleusercontent.com/docsz/AD_4nXe?key=abc" alt="Chart"></p>',
      found,
    );
    expect(md).toBe('![Chart](https://lh7-rt.googleusercontent.com/docsz/AD_4nXe?key=abc)');
    expect(found.linked).toBe(1);
  });
});

const ada = { handle: 'ada', name: 'Ada Lovelace' };
const open: Editor[] = [];

afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** An editor whose host saves each picture under `images/` as the app does, or says no. */
function load(doc: string, options: Partial<EditorOptions> = {}, saves = true) {
  const saved: File[] = [];
  const notices: string[] = [];
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, {
    doc,
    author: ada,
    onImageFiles: saves
      ? (files: File[], spot: ImageSpot) => {
          saved.push(...files);
          const name = `images/image-2026-11-17-${saved.length}.${files[0]!.name.split('.').pop()}`;
          queueMicrotask(() => spot.insert([name]));
        }
      : (_files: File[], spot: ImageSpot) => spot.release(),
    onNotice: (message) => notices.push(message),
    ...options,
  });
  open.push(editor);
  return { editor, saved, notices };
}

function pasteHtml(editor: Editor, at: number, html: string, text = ''): void {
  editor.view.dispatch({ selection: { anchor: at } });
  const clipboardData = new DataTransfer();
  clipboardData.setData('text/plain', text);
  clipboardData.setData('text/html', html);
  editor.view.contentDOM.dispatchEvent(
    new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }),
  );
}

describe('pasting Word’s picture', () => {
  it('saves it through the host and links it, Track Changes off', async () => {
    const { editor, saved, notices } = load('Start\n\n');
    pasteHtml(editor, 'Start\n\n'.length, WORD);
    await tick();
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ name: 'image.jpg', type: 'image/jpeg' });
    expect(editor.getDoc()).toContain(`![${ALT}](images/image-2026-11-17-1.jpg)`);
    expect(editor.getDoc()).not.toContain('redlines-picture');
    expect(notices).toEqual([]);
  });

  it('is the paster’s own insertion with Track Changes on', async () => {
    const { editor } = load('Start\n\n', { tracking: true });
    pasteHtml(editor, 'Start\n\n'.length, WORD);
    await tick();
    const doc = editor.getDoc();
    expect(doc).toContain('<!--ins');
    expect(newestView(doc).text).toContain(`![${ALT}](images/image-2026-11-17-1.jpg)`);
    expect(parse(doc).warnings).toEqual([]);
    // One insertion, and the splits of its paragraphs.
    expect(new Set(parse(doc).marks.map((mark) => mark.kind))).toEqual(new Set(['ins', 'split']));
  });

  it('says so, and pastes the text, when the host adds none', async () => {
    const { editor, notices } = load('Start\n\n', {}, false);
    pasteHtml(editor, 'Start\n\n'.length, WORD);
    await tick();
    expect(editor.getDoc()).toContain('The sensor shelter before the storm:');
    expect(editor.getDoc()).not.toContain('![');
    expect(notices).toEqual(['A picture couldn’t be added from the paste.']);
  });

  it('says so when the window has no host to save pictures', async () => {
    const { editor, notices } = load('Start\n\n', { onImageFiles: undefined });
    pasteHtml(editor, 'Start\n\n'.length, WORD);
    await tick();
    expect(editor.getDoc()).not.toContain('![');
    expect(notices[0]).toMatch(/can’t save pictures/);
  });
});

describe('pasting Google Docs’ picture', () => {
  it('links its address and says it is not saved', () => {
    const { editor, notices } = load('Start\n\n');
    pasteHtml(
      editor,
      'Start\n\n'.length,
      '<b id="docs-internal-guid-1"><p><img src="https://lh7-rt.googleusercontent.com/docsz/AD_4nXe" alt="Chart"></p></b>',
    );
    expect(editor.getDoc()).toContain(
      '![Chart](https://lh7-rt.googleusercontent.com/docsz/AD_4nXe)',
    );
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatch(/linked to its web address/);
  });
});
