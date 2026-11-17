import { exportDocx } from '@redlines/word';
import { describe, expect, it, vi } from 'vitest';
import type { NotificationOptions } from './ui/notifications.ts';
import { importMessage, openWord, relink } from './word-import.ts';

const noFiles = {
  saveAs: () => Promise.reject(new Error('not saved here')),
  write: () => Promise.reject(new Error('not written here')),
  addImages: () => Promise.reject(new Error('not added here')),
};

/** A .docx with one picture, made by hand: the exporter writes none. */
async function withPicture(): Promise<Uint8Array> {
  const { Document, ImageRun, Packer, Paragraph } = await import('docx');
  const png = Uint8Array.from(
    atob(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    ),
    (c) => c.charCodeAt(0),
  );
  const document = new Document({
    sections: [
      {
        children: [
          new Paragraph({
            children: [
              new ImageRun({
                type: 'png',
                data: png,
                transformation: { width: 10, height: 10 },
                altText: { name: 'dot', description: 'A dot', title: 'dot' },
              }),
            ],
          }),
        ],
      },
    ],
  });
  return new Uint8Array(await Packer.toArrayBuffer(document));
}

describe('Open .docx', () => {
  it('saves a document with pictures first, puts the pictures in the images folder and opens it', async () => {
    const bytes = await withPicture();
    const written: Record<string, string> = {};
    const added: { folder: string; name: string; size: number }[] = [];
    const opened: string[] = [];
    const shown: NotificationOptions[] = [];
    const done = await openWord({
      host: {
        openDocx: () => Promise.resolve({ name: 'plan.docx', bytes }),
        saveAs: (text, name) => {
          expect(name).toBe('plan.md');
          written['/notes/plan.md'] = text;
          return Promise.resolve('/notes/plan.md');
        },
        write: (path, text) => {
          written[path] = text;
          return Promise.resolve();
        },
        addImages: (_document, folder, source) => {
          const file = source.kind === 'files' ? source.files[0] : undefined;
          added.push({ folder, name: file?.name ?? '', size: file?.size ?? 0 });
          return Promise.resolve({ paths: [`${folder}/${file?.name ?? ''}`], refused: [] });
        },
      },
      folderName: () => 'images',
      open: () => Promise.reject(new Error('should be saved')),
      openFile: (path) => void opened.push(path) as unknown as Promise<void>,
      show: (options) => void shown.push(options),
    });
    expect(done).toBe(true);
    expect(added).toHaveLength(1);
    expect(added[0]?.folder).toBe('images');
    expect(written['/notes/plan.md']).toMatch(/!\[A dot\]\(images\/image1\.png\)/);
    expect(opened).toEqual(['/notes/plan.md']);
    expect(shown[0]?.text).toBe('Opened “plan.docx” as a new document.');
  });

  it('opens unsaved, without its pictures, when the panel is cancelled, and says so', async () => {
    const bytes = await withPicture();
    const opened: string[] = [];
    const shown: NotificationOptions[] = [];
    await openWord({
      host: {
        ...noFiles,
        openDocx: () => Promise.resolve({ name: 'plan.docx', bytes }),
        saveAs: () => Promise.resolve(null),
      },
      folderName: () => 'images',
      open: (markdown) => void opened.push(markdown) as unknown as Promise<void>,
      openFile: () => Promise.resolve(),
      show: (options) => void shown.push(options),
    });
    expect(opened).toHaveLength(1);
    expect(shown[0]?.text).toContain('The pictures were not added');
    expect(shown[0]?.timeout).toBeUndefined();
  });

  it('opens the file as the text of a new document, and passes by when nothing was lost', async () => {
    const bytes = await exportDocx('Hello **world**.\n');
    const opened: string[] = [];
    const shown: NotificationOptions[] = [];
    const done = await openWord({
      host: { ...noFiles, openDocx: () => Promise.resolve({ name: 'plan.docx', bytes }) },
      folderName: () => 'images',
      openFile: () => Promise.resolve(),
      open: (markdown) => {
        opened.push(markdown);
        return Promise.resolve();
      },
      show: (options) => void shown.push(options),
    });
    expect(done).toBe(true);
    expect(opened[0]).toContain('Hello **world**.');
    expect(shown[0]?.text).toBe('Opened “plan.docx” as a new document.');
    expect(shown[0]?.timeout).toBeDefined();
  });

  it('does nothing when the panel is cancelled', async () => {
    const open = vi.fn(() => Promise.resolve());
    const show = vi.fn();
    const done = await openWord({
      host: { ...noFiles, openDocx: () => Promise.resolve(null) },
      folderName: () => 'images',
      openFile: () => Promise.resolve(),
      open,
      show,
    });
    expect(done).toBe(false);
    expect(open).not.toHaveBeenCalled();
    expect(show).not.toHaveBeenCalled();
  });

  it('keeps the card, shortened, when the report has lines', () => {
    const { text, kept } = importMessage('a.docx', ['One.', 'Two.', 'Three.', 'Four.'], 1);
    expect(kept).toBe(true);
    expect(text).toBe('Opened “a.docx” as a new document. One. Two. Three. And 2 more.');
  });
});

describe('relink', () => {
  it('rewrites every picture link in one pass, so a renamed file is not matched again', () => {
    const links = new Map<string, string | null>([
      ['media/image1.png', 'media/image2.png'],
      ['media/image2.png', 'media/image3.png'],
      ['media/gone.png', null],
    ]);
    expect(
      relink('![a](media/image1.png) ![b](media/image2.png) x![c](media/gone.png)y', links),
    ).toBe('![a](media/image2.png) ![b](media/image3.png) xy');
  });
});
