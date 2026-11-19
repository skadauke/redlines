import { zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  largestPicture,
  MAX_PACKAGE_BYTES,
  originalFile,
  pictureSize,
  sameShape,
} from './office-picture.ts';

// Word's drawing package, built here: an Office package whose `clipboard/media/` holds the picture
// as it was inserted (#1182). The pictures are headers, which is all the size is read from.

function png(width: number, height: number, extra = 0): Uint8Array {
  const bytes = new Uint8Array(24 + extra);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

function jpeg(width: number, height: number): Uint8Array {
  // SOI, an APP0 of 16 bytes, SOF0 with the size, EOI.
  const bytes = new Uint8Array(2 + 18 + 19 + 2);
  bytes.set([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0], 0);
  const sof = 20;
  bytes.set([0xff, 0xc0, 0, 17, 8, height >> 8, height & 255, width >> 8, width & 255, 3], sof);
  return bytes;
}

const text = (s: string) => new TextEncoder().encode(s);

function pack(files: Record<string, Uint8Array>): Uint8Array {
  return zipSync(files);
}

const WORD = pack({
  'clipboard/drawings/drawing1.xml': text('<xml/>'),
  'clipboard/media/image1.png': png(1102, 1502, 900),
  'clipboard/theme/theme1.xml': text('<theme/>'),
  '[Content_Types].xml': text('<Types/>'),
});

const file = (bytes: Uint8Array, name = 'image.png', type = 'image/png') =>
  new File([bytes as Uint8Array<ArrayBuffer>], name, { type });

describe('the picture in Word’s drawing package', () => {
  it('reads the size of a PNG and a JPEG from its header', () => {
    expect(pictureSize(png(1102, 1502))).toEqual({ width: 1102, height: 1502 });
    expect(pictureSize(jpeg(640, 480))).toEqual({ width: 640, height: 480 });
    expect(pictureSize(text('not a picture'))).toBeNull();
  });

  it('takes the picture under clipboard/media, at its own size and in its own format', () => {
    const found = largestPicture(WORD);
    expect(found).toMatchObject({ type: 'image/png', extension: 'png', width: 1102, height: 1502 });
    expect(found?.bytes.length).toBe(24 + 900);
    const photo = largestPicture(pack({ 'clipboard/media/image1.jpeg': jpeg(4032, 3024) }));
    expect(photo).toMatchObject({ type: 'image/jpeg', extension: 'jpg', width: 4032 });
  });

  it('takes the largest of several pictures, by pixels', () => {
    const found = largestPicture(
      pack({
        'clipboard/media/image1.png': png(100, 100),
        'clipboard/media/image2.png': png(1000, 800),
        'clipboard/media/image3.jpg': jpeg(640, 480),
      }),
    );
    expect(found).toMatchObject({ width: 1000, height: 800 });
  });

  it('reads nothing outside clipboard/media, nothing that is no picture, and nothing nested', () => {
    expect(
      largestPicture(
        pack({
          'word/media/image1.png': png(5000, 5000),
          'clipboard/media/notes.txt': png(5000, 5000),
          'clipboard/media/deeper/image2.png': png(5000, 5000),
          'clipboard/media/broken.png': text('not a picture at all, just text bytes'),
        }),
      ),
    ).toBeNull();
  });

  it('gives nothing for bytes that are no package, or an empty one', () => {
    expect(largestPicture(text('this is not a zip file'))).toBeNull();
    expect(largestPicture(new Uint8Array(0))).toBeNull();
  });

  it('keeps to the size limit: a package or a picture that would inflate past it is not read', () => {
    expect(largestPicture(new Uint8Array(MAX_PACKAGE_BYTES + 1))).toBeNull();
    // A picture that is 51 MB once inflated is a few KB in the package: it is refused by its size.
    const big = pack({ 'clipboard/media/image1.png': png(4000, 3000, MAX_PACKAGE_BYTES + 1000) });
    expect(big.length).toBeLessThan(MAX_PACKAGE_BYTES);
    expect(largestPicture(big)).toBeNull();
  });
});

describe('the picture pasted in place of the one the page has', () => {
  it('is the original, when it is that picture at its full size', async () => {
    const pasted = file(png(266, 362));
    const original = await originalFile(pasted, () => Promise.resolve(WORD));
    expect(original?.type).toBe('image/png');
    expect(original?.name).toBe('image.png');
    expect(original?.size).toBe(24 + 900);
  });

  it('is nothing, so the paste stays, with no package, one that fails, or garbage', async () => {
    const pasted = file(png(266, 362));
    expect(await originalFile(pasted, () => Promise.resolve(null))).toBeNull();
    expect(await originalFile(pasted, () => Promise.resolve(new Uint8Array(0)))).toBeNull();
    expect(await originalFile(pasted, () => Promise.reject(new Error('no')))).toBeNull();
    expect(await originalFile(pasted, () => Promise.resolve(text('garbage')))).toBeNull();
  });

  it('is nothing for another picture: a different shape, or one already as large', async () => {
    expect(await originalFile(file(png(400, 400)), () => Promise.resolve(WORD))).toBeNull();
    expect(await originalFile(file(png(1102, 1502)), () => Promise.resolve(WORD))).toBeNull();
    expect(await originalFile(file(text('not a picture')), () => Promise.resolve(WORD))).toBeNull();
  });

  it('judges a shape to within three percent', () => {
    expect(sameShape({ width: 266, height: 362 }, { width: 1102, height: 1502 })).toBe(true);
    expect(sameShape({ width: 300, height: 362 }, { width: 1102, height: 1502 })).toBe(false);
  });
});
