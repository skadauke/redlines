// The original of a picture copied in Word (#1182). Word puts the picture on the pasteboard at the
// size it has on the page (the kinds a web page can read), and in its own drawing format, an Office
// package whose `clipboard/media/` holds the image file as it was inserted. The app reads that kind
// natively (`read_office_picture`, src-tauri/src/office_picture.rs) and this opens it: only the
// files under `clipboard/media/`, only the picture kinds, none that would inflate to more than the
// limit. What the page pasted stays what it pasted when there is no package, it can't be read, or
// its picture is not the one that was pasted.

import { unzipSync } from 'fflate';

/** The most a package, or the picture in it, may inflate to, in bytes. */
export const MAX_PACKAGE_BYTES = 50 * 1024 * 1024;

/** A picture taken from a package, with its own format. */
interface OriginalPicture {
  bytes: Uint8Array;
  type: string;
  extension: string;
  width: number;
  height: number;
}

const KINDS: Record<string, { type: string; extension: string }> = {
  png: { type: 'image/png', extension: 'png' },
  jpg: { type: 'image/jpeg', extension: 'jpg' },
  jpeg: { type: 'image/jpeg', extension: 'jpg' },
  gif: { type: 'image/gif', extension: 'gif' },
};

/** The size in pixels of a PNG, JPEG or GIF, read from its header; null for any other bytes. */
export function pictureSize(bytes: Uint8Array): { width: number; height: number } | null {
  const be16 = (i: number) => ((bytes[i] ?? 0) << 8) | (bytes[i + 1] ?? 0);
  const be32 = (i: number) => be16(i) * 65536 + be16(i + 2);
  const le16 = (i: number) => (bytes[i] ?? 0) | ((bytes[i + 1] ?? 0) << 8);
  const ascii = (i: number, n: number) => String.fromCharCode(...bytes.subarray(i, i + n));
  if (bytes[0] === 0x89 && ascii(1, 3) === 'PNG') return { width: be32(16), height: be32(20) };
  if (ascii(0, 3) === 'GIF') return { width: le16(6), height: le16(8) };
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    for (let i = 2; i + 9 < bytes.length;) {
      if (bytes[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = bytes[i + 1] ?? 0;
      if (marker === 0xff) {
        i++;
        continue;
      }
      if (marker === 0 || marker === 1 || (marker >= 0xd0 && marker <= 0xd8)) {
        i += 2;
        continue;
      }
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { height: be16(i + 5), width: be16(i + 7) };
      }
      i += 2 + be16(i + 2);
    }
  }
  return null;
}

/**
 * The largest picture under `clipboard/media/` of an Office package, or null when there is none, the
 * bytes are no package, or a file in it would inflate to more than the limit. "Largest" is by pixels.
 */
export function largestPicture(pack: Uint8Array): OriginalPicture | null {
  if (pack.length === 0 || pack.length > MAX_PACKAGE_BYTES) return null;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(pack, {
      filter: (file) =>
        file.name.startsWith('clipboard/media/') &&
        !file.name.slice('clipboard/media/'.length).includes('/') &&
        file.originalSize <= MAX_PACKAGE_BYTES &&
        KINDS[file.name.split('.').pop()?.toLowerCase() ?? ''] !== undefined,
    });
  } catch {
    return null;
  }
  let best: OriginalPicture | null = null;
  for (const [name, bytes] of Object.entries(files)) {
    const kind = KINDS[name.split('.').pop()?.toLowerCase() ?? ''];
    const size = pictureSize(bytes);
    if (!kind || !size || size.width <= 0 || size.height <= 0) continue;
    if (!best || size.width * size.height > best.width * best.height) {
      best = { bytes, ...kind, ...size };
    }
  }
  return best;
}

/** Whether a picture of `pasted`'s size is the same picture as `original` at its full size. */
export function sameShape(
  pasted: { width: number; height: number },
  original: { width: number; height: number },
): boolean {
  if (original.width * original.height <= pasted.width * pasted.height) return false;
  const a = pasted.width / pasted.height;
  const b = original.width / original.height;
  return Math.abs(a - b) / b < 0.03;
}

/** The file to paste in place of `pasted`: its original from Word's package, or null. */
export async function originalFile(
  pasted: File,
  readPackage: () => Promise<Uint8Array | null>,
): Promise<File | null> {
  let pack: Uint8Array | null;
  try {
    pack = await readPackage();
  } catch {
    return null;
  }
  if (!pack || pack.length === 0) return null;
  const original = largestPicture(pack);
  if (!original) return null;
  const size = pictureSize(new Uint8Array(await pasted.arrayBuffer()));
  if (!size || !sameShape(size, original)) return null;
  return new File([original.bytes as Uint8Array<ArrayBuffer>], `image.${original.extension}`, {
    type: original.type,
  });
}
