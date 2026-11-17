// Cropping a picture for the editor's Crop… (#624): the copy's name, and the part of the picture
// that is kept, drawn to a canvas and encoded as a file. The host saves the file beside the others
// in the project's folder for images; the original stays where it is.

import type { CropRect } from '@redlines/editor';
import { extension } from './file-names.ts';

/** The types a canvas writes; any other picture (a GIF, say) is cropped to a PNG. */
const WRITABLE: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

/**
 * The name of the cropped copy of the file `original` (its own name, without a folder): the name
 * with `-crop` before the extension, `photo.png` to `photo-crop.png`. A copy of a copy keeps the one
 * suffix, `photo-crop.png` to `photo-crop.png` again (the folder numbers a name that is taken, so
 * the second is `photo-crop-2.png`). A type a canvas can't write gives a PNG.
 */
export function cropName(original: string, type: string): string {
  const extra = extension(original);
  const dot = extra === '' ? -1 : original.lastIndexOf('.');
  const stem = (dot < 0 ? original : original.slice(0, dot)).replace(/-crop(?:-\d+)?$/, '');
  const kind = WRITABLE[type] ?? 'png';
  return `${stem === '' ? 'image' : stem}-crop.${kind}`;
}

/** The pixels of `crop` in a picture `width` by `height`, whole and at least one. */
export function cropPixels(
  crop: CropRect,
  width: number,
  height: number,
): { x: number; y: number; width: number; height: number } {
  const x = Math.min(Math.max(0, Math.round(crop.x * width)), width - 1);
  const y = Math.min(Math.max(0, Math.round(crop.y * height)), height - 1);
  return {
    x,
    y,
    width: Math.max(1, Math.min(width - x, Math.round(crop.width * width))),
    height: Math.max(1, Math.min(height - y, Math.round(crop.height * height))),
  };
}

/** The last part of a path, whichever way its folders are divided. */
export function baseName(path: string): string {
  return path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
}

/** Draws the part `crop` of `image` and writes it as a file named after `original`. */
export async function croppedFile(image: Blob, original: string, crop: CropRect): Promise<File> {
  const bitmap = await createImageBitmap(image);
  try {
    const part = cropPixels(crop, bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = part.width;
    canvas.height = part.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Couldn’t crop the image.');
    context.drawImage(
      bitmap,
      part.x,
      part.y,
      part.width,
      part.height,
      0,
      0,
      part.width,
      part.height,
    );
    const type = image.type in WRITABLE ? image.type : 'image/png';
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.92));
    if (!blob) throw new Error('Couldn’t crop the image.');
    return new File([blob], cropName(baseName(original), image.type), { type: blob.type });
  } finally {
    bitmap.close();
  }
}
