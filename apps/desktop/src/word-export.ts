// File › Export to Word…: the document as a .docx, through a save panel (the host writes it), and a
// notification that says what Word can't hold, never a dialog. `@redlines/word` is loaded when this
// runs, so the window that never exports never loads it (and the editor never imports it).
// Import comes here too, as "Open .docx…" into a new unsaved document, once the reader lands.

import type { Host } from './host.ts';
import { basename, dirname } from './host.ts';
import { PASSING_MS } from './ui/notifications.ts';
import type { NotificationOptions } from './ui/notifications.ts';

interface WordExportParts {
  host: Pick<Host, 'exportWord' | 'reveal'>;
  /** The document's text, with its marks. */
  text: string;
  /** The document's name, without an extension. */
  name: string;
  /** The document's file, if it has one. */
  path: string | null;
  show(options: NotificationOptions): void;
  /**
   * The bytes of the picture the document links at `src`, or undefined when the app may not read it
   * (the host's rules: only a file inside the document's folder for pictures) or it isn't there.
   */
  images?: (src: string) => Promise<Uint8Array | undefined>;
  /** Whether Finder is there to show the file in (the app, not a tab). */
  canReveal: boolean;
}

/** The name the save panel starts with: the document's, with `.docx`. */
export function wordName(name: string): string {
  return `${name.replace(/\.(md|markdown|mdx|txt)$/i, '')}.docx`;
}

/** Exports the document; resolves to the saved file's name, or null when the person cancelled. */
export async function exportToWord(parts: WordExportParts): Promise<string | null> {
  const { exportDocx } = await import('@redlines/word');
  // What the export leaves out is what it says it left out: a picture it read is no longer missing.
  const report: { kind: string; message: string }[] = [];
  const bytes = await exportDocx(parts.text, {
    report,
    ...(parts.images ? { images: parts.images } : {}),
  });
  const saved = await parts.host.exportWord(
    bytes,
    wordName(parts.name),
    parts.path ? dirname(parts.path) : null,
  );
  if (saved === null) return null;
  const left = report.map((entry) => entry.message);
  parts.show({
    key: 'word-export',
    text: [`Exported to “${basename(saved)}”.`, ...left].join(' '),
    ...(parts.canReveal
      ? {
          action: {
            label: 'Show in Finder',
            run: (card) => {
              void parts.host.reveal(saved);
              card.close();
            },
          },
        }
      : {}),
    // What Word can't hold stays until it is read; a plain success passes by.
    ...(left.length === 0 ? { timeout: PASSING_MS } : {}),
  });
  return saved;
}
