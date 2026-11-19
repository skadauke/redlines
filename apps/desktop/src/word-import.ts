// File › Open .docx…: a Word or Google Docs file as a new, unsaved Redlines document, and a
// notification, never a dialog, that says what Markdown couldn't hold. `@redlines/word` is loaded
// when this runs (as in word-export.ts). The pictures of a file are not carried: the Markdown would
// name files nothing wrote, so the report says so.

import type { Host } from './host.ts';
import { PASSING_MS } from './ui/notifications.ts';
import type { NotificationOptions } from './ui/notifications.ts';

interface WordImportParts {
  host: Pick<Host, 'openDocx' | 'saveAs' | 'write' | 'addImages'>;
  /** The name of the project's folder for images, as the settings say. */
  folderName(): string;
  /** Shows the Markdown as an Untitled document: here while this window is untouched, else anew. */
  open(markdown: string): Promise<void>;
  /** Opens a file that is saved: here while this window is untouched, else in a new window. */
  openFile(path: string): Promise<void>;
  show(options: NotificationOptions): void;
}

/** How many of the report's lines a card holds before it says there are more. */
const REPORT_LINES = 3;

/** The card's words: the file opened, then what could not be kept. */
export function importMessage(
  name: string,
  messages: readonly string[],
  media: number,
): { text: string; kept: boolean } {
  const lines = [...messages];
  if (media > 0) {
    lines.push(
      media === 1
        ? 'One picture is not in the document.'
        : `${media} pictures are not in the document.`,
    );
  }
  const shown = lines.slice(0, REPORT_LINES);
  const more = lines.length - shown.length;
  const text = [
    `Opened “${name}” as a new document.`,
    ...shown,
    ...(more > 0 ? [`And ${more} more.`] : []),
  ].join(' ');
  return { text, kept: lines.length > 0 };
}

const IMAGE_TYPES: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  svg: 'image/svg+xml',
};

/** A path as the target of a Markdown link. */
function encodeLink(path: string): string {
  return path.replaceAll(' ', '%20').replaceAll('(', '%28').replaceAll(')', '%29');
}

/** `Plan.docx` as `Plan.md`. */
function markdownName(docx: string): string {
  return `${docx.replace(/\.docx$/i, '') || 'Untitled'}.md`;
}

/** The picture links of the Markdown to the files `names` stand for, in one pass; a picture with
 * no file is dropped from the text, and the rest of the links stay as they are. */
export function relink(markdown: string, links: ReadonlyMap<string, string | null>): string {
  return markdown.replace(
    /!\[((?:[^\]\\]|\\.)*)\]\(([^)\s]+)\)/g,
    (whole, alt: string, target: string) => {
      if (!links.has(target)) return whole;
      const path = links.get(target);
      return path ? `![${alt}](${encodeLink(path)})` : '';
    },
  );
}

/**
 * Opens a .docx; resolves to whether a document was opened (false when the person cancelled).
 *
 * A file without pictures opens as an unsaved Untitled document. One with pictures can't: they are
 * files beside the document, in the project's folder for images (#523), and a document with no file
 * has no folder. As adding an image to an unsaved document does, it asks to save first: the save
 * panel is the question. The Markdown is saved where the person says, the pictures go into the
 * images folder, each link points at its file, and the saved document opens. When the panel is
 * cancelled the document opens unsaved, without its pictures, and the card says so.
 */
export async function openWord(parts: WordImportParts): Promise<boolean> {
  const file = await parts.host.openDocx();
  if (file === null) return false;
  const { importDocx } = await import('@redlines/word');
  const result = importDocx(file.bytes);
  const messages = result.report.entries.map((entry) => entry.message);
  const pictures = Object.entries(result.media);
  // What each link of the Markdown becomes: the picture's file, or null for none.
  const links = new Map<string, string | null>();
  let lost = 0;
  if (pictures.length === 0) {
    await parts.open(result.markdown);
  } else {
    const saved = await parts.host.saveAs(result.markdown, markdownName(file.name), null);
    if (saved === null) {
      for (const [name] of pictures) links.set(encodeLink(name), null);
      await parts.open(relink(result.markdown, links));
      messages.push(
        'The pictures were not added, because the document was not saved: they are files beside it.',
      );
    } else {
      for (const [name, bytes] of pictures) {
        const base = name.slice(name.lastIndexOf('/') + 1);
        const type = IMAGE_TYPES[base.slice(base.lastIndexOf('.') + 1).toLowerCase()] ?? '';
        const picture = new File([bytes as BlobPart], base, { type });
        try {
          const added = await parts.host.addImages(saved, parts.folderName(), {
            kind: 'files',
            files: [picture],
            pasted: false,
          });
          const path = added.paths[0] ?? null;
          links.set(encodeLink(name), path);
          if (path === null) {
            lost++;
            messages.push(...added.refused);
          }
        } catch (error) {
          // The rest are still added; the document is saved and opens with what there is.
          links.set(encodeLink(name), null);
          lost++;
          messages.push(error instanceof Error ? error.message : String(error));
        }
      }
      // Written again with the links where the pictures are; the panel's write holds the first.
      await parts.host.write(saved, relink(result.markdown, links));
      await parts.openFile(saved);
    }
  }
  const { text, kept } = importMessage(file.name, messages, lost);
  parts.show({ key: 'word-import', text, ...(kept ? {} : { timeout: PASSING_MS }) });
  return true;
}
