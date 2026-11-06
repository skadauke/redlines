// Opening the file a comment cites. A Markdown file opens in a window that may use it only once the
// app has allowed it, as the sidebar does; other text opens in the viewer, which needs no leave.

import { fileKind } from './host.ts';

export interface CitationOpenDeps {
  allowDocument(path: string): Promise<void>;
  openInNewWindow(path: string, line?: number): unknown;
  notice(message: string): void;
}

/** Opens a cited file in a new window, saying why when the app refuses it. */
export async function openCitation(
  deps: CitationOpenDeps,
  path: string,
  line?: number,
): Promise<void> {
  if (fileKind(path) === 'markdown') {
    try {
      await deps.allowDocument(path);
    } catch (error) {
      const name = path.slice(path.lastIndexOf('/') + 1);
      deps.notice(typeof error === 'string' ? error : `Couldn’t open “${name}”.`);
      return;
    }
  }
  await deps.openInNewWindow(path, line);
}
