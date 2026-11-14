import { describe, expect, it, vi } from 'vitest';
import type { ImageSpot } from '@redlines/editor';
import {
  addImages,
  generatedImageName,
  imageExtension,
  imageFolderFor,
  type ImageAdding,
  savedImageName,
} from './image-add.ts';
import type { AddedImages, ImageSource } from './host.ts';

describe('the folder for images', () => {
  it('is the one the settings name, beside the document', () => {
    expect(imageFolderFor('folder', 'images', 'plan.md')).toBe('images');
    expect(imageFolderFor('folder', 'Bilder 2026', 'plan.md')).toBe('Bilder 2026');
  });

  it('is named for the document, without its extension, when the settings say so', () => {
    expect(imageFolderFor('assets', 'images', 'plan.md')).toBe('plan.assets');
    expect(imageFolderFor('assets', 'images', 'my notes.txt')).toBe('my notes.assets');
    expect(imageFolderFor('assets', 'images', 'archive.tar.md')).toBe('archive.tar.assets');
    expect(imageFolderFor('assets', 'images', 'Untitled')).toBe('Untitled.assets');
  });

  it('is never a hidden folder, which the preview wouldn’t load images from', () => {
    expect(imageFolderFor('assets', 'images', '.notes.md')).toBe('notes.assets');
    expect(imageFolderFor('assets', 'images', '..draft.md')).toBe('draft.assets');
  });

  it('is the document’s own folder, written as nothing, when the settings say so', () => {
    expect(imageFolderFor('same', 'images', 'plan.md')).toBe('');
  });
});

describe('the name of a pasted image', () => {
  it('is made of the time, in the person’s own, to the second', () => {
    expect(generatedImageName(new Date(2026, 10, 12, 15, 30, 12), 'png')).toBe(
      'image-2026-11-12-153012.png',
    );
    expect(generatedImageName(new Date(2026, 0, 3, 4, 5, 6), 'jpg')).toBe(
      'image-2026-01-03-040506.jpg',
    );
  });
});

describe('the extension of an image file', () => {
  it('goes by its type, and by its name when the type says nothing', () => {
    const named = (name: string, type = '') => imageExtension({ name, type });
    expect(named('image.png', 'image/png')).toBe('png');
    expect(named('photo', 'image/jpeg')).toBe('jpg');
    expect(named('a', 'image/svg+xml')).toBe('svg');
    expect(named('a', 'image/webp')).toBe('webp');
    expect(named('a', 'image/heic')).toBe('heic');
    expect(named('a', 'image/tiff')).toBe('tiff');
    expect(named('Photo 3.JPEG')).toBe('jpeg');
    expect(named('scan.tif')).toBe('tif');
    // The type decides over a name that says another.
    expect(named('photo.jpg', 'image/png')).toBe('png');
  });

  it('is none for what the preview doesn’t show', () => {
    const named = (name: string, type = '') => imageExtension({ name, type });
    expect(named('paper.pdf', 'application/pdf')).toBeNull();
    expect(named('notes.txt')).toBeNull();
    expect(named('photo.psd', 'image/vnd.adobe.photoshop')).toBeNull();
    expect(named('noextension')).toBeNull();
  });
});

describe('the name an image is saved under', () => {
  const now = new Date(2026, 10, 12, 15, 30, 12);
  const file = (name: string, type: string) => new File(['x'], name, { type });

  it('is made of the time for the data of a paste, which has no name worth keeping', () => {
    expect(savedImageName(file('image.png', 'image/png'), true, now)).toBe(
      'image-2026-11-12-153012.png',
    );
    expect(savedImageName(file('', 'image/jpeg'), true, now)).toBe('image-2026-11-12-153012.jpg');
  });

  it('is its own for a file that has one, pasted from Finder or dropped', () => {
    expect(savedImageName(file('Photo 3.png', 'image/png'), true, now)).toBe('Photo 3.png');
    expect(savedImageName(file('Photo 3.png', 'image/png'), false, now)).toBe('Photo 3.png');
  });

  it('is given the extension of its type when its own name has none', () => {
    expect(savedImageName(file('scan', 'image/png'), false, now)).toBe('scan.png');
  });

  it('is none for a file that isn’t an image the preview shows', () => {
    expect(savedImageName(file('paper.pdf', 'application/pdf'), false, now)).toBeNull();
  });
});

/** The parts of the flow, which a test sets as it needs. */
function setup(
  options: {
    path?: string | null;
    name?: string;
    place?: 'folder' | 'assets' | 'same';
    folderName?: string;
    saves?: boolean | (() => Promise<boolean>);
    added?: AddedImages | Error;
  } = {},
) {
  const document = {
    path: options.path === undefined ? '/docs/plan.md' : options.path,
    name: 'plan.md',
  };
  if (options.name) document.name = options.name;
  const notices: string[] = [];
  const calls: { path: string; folder: string; source: ImageSource }[] = [];
  const events: string[] = [];
  const added = options.added ?? { paths: ['images/shot.png'], refused: [] };
  const adding: ImageAdding = {
    document: () => ({ ...document }),
    place: () => ({ place: options.place ?? 'folder', name: options.folderName ?? 'images' }),
    saveFirst: async () => {
      events.push('asked to save');
      const saved =
        typeof options.saves === 'function' ? await options.saves() : (options.saves ?? true);
      if (saved) {
        document.path = '/docs/Untitled.md';
        document.name = 'Untitled.md';
      }
      return saved;
    },
    addImages: (path, folder, source) => {
      events.push('added');
      calls.push({ path, folder, source });
      return added instanceof Error ? Promise.reject(added) : Promise.resolve(added);
    },
    notice: (message) => notices.push(message),
  };
  const insert = vi.fn((paths: readonly string[]) => {
    events.push(`wrote ${paths.join(',')}`);
    return true;
  });
  const release = vi.fn(() => void events.push('let go'));
  const spot: ImageSpot = { insert, release };
  return { adding, spot, insert, release, notices, calls, events, document };
}

const files: ImageSource = { kind: 'files', files: [], pasted: true };

describe('adding images', () => {
  it('saves them beside the document and writes their links where the spot is', async () => {
    const { adding, spot, calls, notices, events } = setup();
    await addImages(adding, spot, files);
    expect(calls).toEqual([{ path: '/docs/plan.md', folder: 'images', source: files }]);
    expect(events).toEqual(['added', 'wrote images/shot.png']);
    expect(notices).toEqual([]);
  });

  it('saves them where the settings say, for the document’s name', async () => {
    const assets = setup({ place: 'assets', name: 'my notes.md' });
    await addImages(assets.adding, assets.spot, files);
    expect(assets.calls[0]?.folder).toBe('my notes.assets');
    const same = setup({ place: 'same' });
    await addImages(same.adding, same.spot, files);
    expect(same.calls[0]?.folder).toBe('');
    const named = setup({ folderName: 'Bilder' });
    await addImages(named.adding, named.spot, files);
    expect(named.calls[0]?.folder).toBe('Bilder');
  });

  it('asks to save a document with no file first, and adds them to the file it is saved as', async () => {
    const { adding, spot, calls, events } = setup({ path: null });
    await addImages(adding, spot, files);
    expect(events).toEqual(['asked to save', 'added', 'wrote images/shot.png']);
    // Beside the file it was saved as, in the folder named for it.
    expect(calls).toEqual([{ path: '/docs/Untitled.md', folder: 'images', source: files }]);
  });

  it('names the folder for the name the document was saved under', async () => {
    const { adding, spot, calls } = setup({ path: null, place: 'assets' });
    await addImages(adding, spot, files);
    expect(calls[0]?.folder).toBe('Untitled.assets');
  });

  it('adds nothing, and lets the spot go, when the person doesn’t save', async () => {
    const { adding, spot, calls, events, notices } = setup({ path: null, saves: false });
    await addImages(adding, spot, files);
    expect(calls).toEqual([]);
    expect(events).toEqual(['asked to save', 'let go']);
    // Declining is an answer, not a failure to tell of.
    expect(notices).toEqual([]);
  });

  it('keeps the spot while the person decides, which follows the text meanwhile', async () => {
    let answer!: (saved: boolean) => void;
    const { adding, spot, release, events } = setup({
      path: null,
      saves: () => new Promise<boolean>((resolve) => (answer = resolve)),
    });
    const waiting = addImages(adding, spot, files);
    await Promise.resolve();
    expect(events).toEqual(['asked to save']);
    expect(release).not.toHaveBeenCalled();
    answer(true);
    await waiting;
    expect(events).toEqual(['asked to save', 'added', 'wrote images/shot.png']);
  });

  it('writes the links of the images that could be added, and says why for the others', async () => {
    const { adding, spot, insert, notices } = setup({
      added: {
        paths: ['images/a.png'],
        refused: ['“b.txt” isn’t an image Redlines can show.'],
      },
    });
    await addImages(adding, spot, files);
    expect(insert).toHaveBeenCalledWith(['images/a.png']);
    expect(notices).toEqual(['“b.txt” isn’t an image Redlines can show.']);
  });

  it('says how many more could not be added, after the first', async () => {
    const { adding, spot, notices } = setup({
      added: {
        paths: [],
        refused: ['“a.txt” isn’t an image.', '“b.txt” isn’t one.', '“c.txt” isn’t one.'],
      },
    });
    await addImages(adding, spot, files);
    expect(notices).toEqual(['“a.txt” isn’t an image. 2 more weren’t added either.']);
    const one = setup({
      added: { paths: [], refused: ['“a.txt” isn’t an image.', '“b.txt” isn’t one.'] },
    });
    await addImages(one.adding, one.spot, files);
    expect(one.notices).toEqual(['“a.txt” isn’t an image. 1 more wasn’t added either.']);
  });

  it('lets the spot go when no image could be added', async () => {
    const { adding, spot, insert, events } = setup({
      added: { paths: [], refused: ['“a.txt” isn’t an image.'] },
    });
    await addImages(adding, spot, files);
    expect(insert).not.toHaveBeenCalled();
    expect(events).toEqual(['added', 'let go']);
  });

  it('says what went wrong when the app can’t add them, and lets the spot go', async () => {
    const { adding, spot, notices, events } = setup({ added: new Error('not this window’s file') });
    await addImages(adding, spot, files);
    expect(notices).toEqual(['not this window’s file']);
    expect(events).toEqual(['added', 'let go']);
  });

  it('says what went wrong when saving the document fails, too', async () => {
    const { adding, spot, release, notices } = setup({
      path: null,
      saves: () => Promise.reject(new Error('disk full')),
    });
    await addImages(adding, spot, files);
    expect(notices).toEqual(['disk full']);
    expect(release).toHaveBeenCalled();
  });
});
