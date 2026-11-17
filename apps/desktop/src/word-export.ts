// File › Export to Word…: the document as a .docx, through a save panel (the host writes it), and a
// notification that says what Word can't hold, never a dialog. `@redlines/word` is loaded when this
// runs, so the window that never exports never loads it (and the editor never imports it).
// Import comes here too, as "Open .docx…" into a new unsaved document, once the reader lands.

import type { Host } from './host.ts';
import { basename, dirname } from './host.ts';
import { PASSING_MS } from './ui/notifications.ts';
import type { NotificationOptions } from './ui/notifications.ts';

export interface WordExportParts {
  host: Pick<Host, 'exportWord' | 'reveal'>;
  /** The document's text, with its marks. */
  text: string;
  /** The document's name, without an extension. */
  name: string;
  /** The document's file, if it has one. */
  path: string | null;
  show(options: NotificationOptions): void;
  /** Whether Finder is there to show the file in (the app, not a tab). */
  canReveal: boolean;
}

/** The name the save panel starts with: the document's, with `.docx`. */
export function wordName(name: string): string {
  return `${name.replace(/\.(md|markdown|mdx|txt)$/i, '')}.docx`;
}

/** Exports the document; resolves to the saved file's name, or null when the person cancelled. */
export async function exportToWord(parts: WordExportParts): Promise<string | null> {
  const { exportDocx, exportReport } = await import('@redlines/word');
  const bytes = await exportDocx(parts.text);
  const saved = await parts.host.exportWord(
    bytes,
    wordName(parts.name),
    parts.path ? dirname(parts.path) : null,
  );
  if (saved === null) return null;
  const left = exportReport(parts.text).entries.map((entry) => entry.message);
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
