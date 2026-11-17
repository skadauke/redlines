// Images in a Markdown file, as Word wants them: the bytes, the kind and the size. Word has no
// pictures by address in a file that travels, so an image is embedded when its bytes are known: a
// `data:` address carries them, and for any other the caller's `images` option is asked.

export type ImageKind = 'png' | 'jpg' | 'gif' | 'bmp';

export interface LoadedImage {
  type: ImageKind;
  data: Uint8Array;
  /** Pixels. */
  width: number;
  height: number;
}

/** What the caller gives: the bytes of the image at an address, or nothing when it has none. */
export type ImageSource = (src: string) => Uint8Array | undefined | Promise<Uint8Array | undefined>;

/** The widest an image is drawn in a page's text, in pixels (6.5 inches at 96 per inch). */
export const MAX_IMAGE_WIDTH = 624;

/** The bytes of a `data:` address, or undefined when it is not one that holds base64 or plain text. */
export function dataUri(src: string): Uint8Array | undefined {
  const found = /^data:([^,]*),([\s\S]*)$/i.exec(src);
  if (!found) return undefined;
  const base64 = /;base64$/i.test(found[1] ?? '');
  const body = found[2] ?? '';
  try {
    if (base64) return Uint8Array.from(atob(body.replace(/\s/g, '')), (c) => c.charCodeAt(0));
    return new TextEncoder().encode(decodeURIComponent(body));
  } catch {
    return undefined;
  }
}

const u16 = (b: Uint8Array, at: number) => ((b[at] ?? 0) << 8) | (b[at + 1] ?? 0);
const u32 = (b: Uint8Array, at: number) => u16(b, at) * 65536 + u16(b, at + 2);
const le16 = (b: Uint8Array, at: number) => (b[at] ?? 0) | ((b[at + 1] ?? 0) << 8);
const le32 = (b: Uint8Array, at: number) => le16(b, at) + le16(b, at + 2) * 65536;

/** The kind and the size of PNG, JPEG, GIF and BMP bytes; undefined for anything else (SVG and WebP
 * are the ones Word can't draw from a file written here). */
export function imageInfo(data: Uint8Array): Omit<LoadedImage, 'data'> | undefined {
  if (data.length > 24 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e) {
    return { type: 'png', width: u32(data, 16), height: u32(data, 20) };
  }
  if (data.length > 10 && data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46) {
    return { type: 'gif', width: le16(data, 6), height: le16(data, 8) };
  }
  if (data.length > 26 && data[0] === 0x42 && data[1] === 0x4d) {
    return { type: 'bmp', width: le32(data, 18), height: Math.abs(le32(data, 22) | 0) };
  }
  if (data.length > 4 && data[0] === 0xff && data[1] === 0xd8) {
    let at = 2;
    while (at + 9 < data.length) {
      if (data[at] !== 0xff) {
        at++;
        continue;
      }
      const marker = data[at + 1] ?? 0;
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
        at += 2;
        continue;
      }
      // The start-of-frame markers hold the size; the others are skipped by their length.
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { type: 'jpg', height: u16(data, at + 5), width: u16(data, at + 7) };
      }
      at += 2 + u16(data, at + 2);
    }
  }
  return undefined;
}

/** The size to draw an image at: its own, shrunk to the page's width. */
export function drawnSize(image: Pick<LoadedImage, 'width' | 'height'>): {
  width: number;
  height: number;
} {
  const width = Math.max(1, image.width);
  const height = Math.max(1, image.height);
  if (width <= MAX_IMAGE_WIDTH) return { width, height };
  return {
    width: MAX_IMAGE_WIDTH,
    height: Math.max(1, Math.round((height * MAX_IMAGE_WIDTH) / width)),
  };
}

/** An image at an address, loaded, or the reason it is not. */
export async function loadImage(
  src: string,
  source: ImageSource | undefined,
): Promise<LoadedImage | string> {
  const data = src.startsWith('data:') ? dataUri(src) : await source?.(src);
  if (!data)
    return src.startsWith('data:')
      ? 'its data address could not be read'
      : 'its bytes are not known';
  const info = imageInfo(data);
  if (!info) return 'it is not a PNG, JPEG, GIF or BMP picture';
  return { ...info, data };
}
