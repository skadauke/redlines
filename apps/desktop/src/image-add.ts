// Adding images to a document (#308): where they are saved, what they are called, and the steps
// from an image dropped, pasted or chosen to its link in the text. The editor finds the images
// and holds the place for their links (`ImageSpot`); the app saves the files (src-tauri/src/
// image_files.rs, through the host); this is what happens between them.

import type { ImageSpot } from '@redlines/editor';
import { extension } from './file-names.ts';
import type { AddedImages, ImageSource } from './host.ts';
import type { ImagePlace } from './settings.ts';

/**
 * The folder for the images of the document called `documentName`, as the settings say, relative
 * to the document: the folder named in the settings, one named for the document (`plan.assets` for
 * `plan.md`), or '' for the document's own folder. Never a hidden one, which the preview wouldn't
 * load images from.
 */
export function imageFolderFor(
  place: ImagePlace,
  folderName: string,
  documentName: string,
): string {
  if (place === 'same') return '';
  if (place === 'folder') return folderName;
  const dot = documentName.lastIndexOf('.');
  const stem = (dot > 0 ? documentName.slice(0, dot) : documentName).replace(/^\.+/, '');
  return `${stem || 'assets'}.assets`;
}

const pad = (value: number, length = 2) => String(value).padStart(length, '0');

/** The name of a pasted image, made of the time in the person's own zone: `image-2026-11-12-153012.png`. */
export function generatedImageName(now: Date, extension: string): string {
  const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `image-${day}-${time}.${extension}`;
}

/** The extensions a file's type is saved with. */
const TYPE_EXTENSIONS: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/apng': 'apng',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/jxl': 'jxl',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/bmp': 'bmp',
  'image/tiff': 'tiff',
  'image/svg+xml': 'svg',
  'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico',
};

/** The extensions of the images the preview shows (src-tauri/src/images.rs). */
const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set([
  ...Object.values(TYPE_EXTENSIONS),
  'jpeg',
  'tif',
]);

/**
 * The extension an image file is saved with: by its type, which a pasted image always has, and else
 * by its name; none for a file that isn't an image the preview shows.
 */
export function imageExtension(file: { name: string; type: string }): string | null {
  const byType = TYPE_EXTENSIONS[file.type];
  if (byType) return byType;
  const byName = extension(file.name);
  return IMAGE_EXTENSIONS.has(byName) ? byName : null;
}

/**
 * The name an image file is saved under: its own, as a dropped file or one copied in Finder keeps
 * it, given the extension of its type when it has none; and for the data of a paste, which has no
 * name worth keeping (WebKit calls it `image.png`), one made of the time. None for a file that isn't
 * an image the preview shows.
 */
export function savedImageName(file: File, pasted: boolean, now: Date): string | null {
  const kind = imageExtension(file);
  if (kind === null) return null;
  const own = file.name.trim();
  if (own === '' || (pasted && /^image\.[a-z0-9]+$/i.test(own)))
    return generatedImageName(now, kind);
  return extension(own) === '' ? `${own}.${kind}` : own;
}

/** What the steps of adding images need of the window. */
export interface ImageAdding {
  /** The document: the path of its file, null while it has none, and its name. */
  document(): { path: string | null; name: string };
  /** Where the settings say images go. */
  place(): { place: ImagePlace; name: string };
  /** Asks whether to save the document first, and saves it as Save As does; whether it is saved. */
  saveFirst(): Promise<boolean>;
  /** Saves the images of `source` in `folder` beside the document at `path` (the host's). */
  addImages(path: string, folder: string, source: ImageSource): Promise<AddedImages>;
  /** Says something to the person, in a notice. */
  notice(message: string): void;
}

/**
 * Adds the images of `source` to the document, and writes their links at `spot`. A document with no
 * file has no folder to save them beside, so it is saved first, after asking; when the person says
 * no there is nothing to add. The links go in once the files are there, so the preview finds them,
 * for those that could be added; why the others couldn't is said in a notice, and the spot is let
 * go when none could. The spot follows the text meanwhile, so the person may go on writing.
 */
export async function addImages(
  adding: ImageAdding,
  spot: ImageSpot,
  source: ImageSource,
): Promise<void> {
  try {
    let document = adding.document();
    if (document.path === null) {
      if (!(await adding.saveFirst())) return spot.release();
      document = adding.document();
    }
    if (document.path === null) return spot.release();
    const { place, name } = adding.place();
    const folder = imageFolderFor(place, name, document.name);
    const added = await adding.addImages(document.path, folder, source);
    if (added.paths.length) spot.insert(added.paths);
    else spot.release();
    const [first, ...more] = added.refused;
    if (first === undefined) return;
    const rest = more.length;
    adding.notice(
      rest ? `${first} ${rest} more ${rest === 1 ? 'wasn’t' : 'weren’t'} added either.` : first,
    );
  } catch (error) {
    spot.release();
    adding.notice(error instanceof Error ? error.message : String(error));
  }
}
