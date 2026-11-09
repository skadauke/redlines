// Following a link in a comment to a file in the project (`renderCommentText` in @redlines/agents
// draws them). A document opens in a new window, which may use it only once the app has allowed
// it, as the sidebar does; an image or a PDF opens in its default app; any other file opens
// nowhere, and the link says so.

import { isDocument, opensInDefaultApp } from './host.ts';

export interface CitationOpenDeps {
  allowDocument(path: string): Promise<void>;
  openInNewWindow(path: string, line?: number): unknown;
  notice(message: string): void;
}

/** How the file at `path` opens from a link (`CommentTextDeps.opensIn`). */
export function opensFromLink(path: string): 'window' | 'default' | 'none' {
  if (isDocument(path)) return 'window';
  return opensInDefaultApp(path) ? 'default' : 'none';
}

/** Opens a cited document in a new window, saying why when the app refuses it. */
export async function openCitation(
  deps: CitationOpenDeps,
  path: string,
  line?: number,
): Promise<void> {
  try {
    await deps.allowDocument(path);
  } catch (error) {
    const name = path.slice(path.lastIndexOf('/') + 1);
    deps.notice(typeof error === 'string' ? error : `Couldn’t open “${name}”.`);
    return;
  }
  await deps.openInNewWindow(path, line);
}
