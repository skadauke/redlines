// File › Open .docx…: a Word or Google Docs file as a new, unsaved Redlines document, and a
// notification, never a dialog, that says what Markdown couldn't hold. `@redlines/word` is loaded
// when this runs (as in word-export.ts). The pictures of a file are not carried: the Markdown would
// name files nothing wrote, so the report says so.

import type { Host } from './host.ts';
import { PASSING_MS } from './ui/notifications.ts';
import type { NotificationOptions } from './ui/notifications.ts';

export interface WordImportParts {
  host: Pick<Host, 'openDocx'>;
  /** Shows the Markdown as an Untitled document: here while this window is untouched, else anew. */
  open(markdown: string): Promise<void>;
  show(options: NotificationOptions): void;
}

/** How many of the report's lines a card holds before it says there are more. */
export const REPORT_LINES = 3;

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

/** Opens a .docx; resolves to whether a document was opened (false when the person cancelled). */
export async function openWord(parts: WordImportParts): Promise<boolean> {
  const file = await parts.host.openDocx();
  if (file === null) return false;
  const { importDocx } = await import('@redlines/word');
  const result = importDocx(file.bytes);
  await parts.open(result.markdown);
  const { text, kept } = importMessage(
    file.name,
    result.report.entries.map((entry) => entry.message),
    Object.keys(result.media).length,
  );
  parts.show({ key: 'word-import', text, ...(kept ? {} : { timeout: PASSING_MS }) });
  return true;
}
