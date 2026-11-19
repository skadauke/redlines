// Debug only: what the Playwright journeys (apps/desktop/journeys) reach in the plain page. They
// start a document, switch Track Changes and the view, and read the text and the caret through
// this, the way the check pages (`block-check.ts` and the others) hold the editor. It is set only
// in development and only in a plain browser tab, never in the app.

import { type Editor, parsedAt } from '@redlines/editor';
import type { DocumentController } from './document.ts';

interface JourneyHook {
  editor: Editor;
  controller: DocumentController;
  /** A row of the menu bar by its text, or null: whether it is enabled, and a way to choose it. */
  menuRow(text: string): { enabled: boolean; run(): boolean } | null;
  /** Docks the toolbar at the bottom of the window, or takes it down (the preference's effect). */
  dockToolbar(docked: boolean): void;
  /** Saves `text` as the file `path` in the page's own folder, and opens it, as the sidebar would. */
  openFile(path: string, text: string): Promise<void>;
  /** Whether the parse covers the middle of the viewport: the text there is styled, not plain. */
  parsedAtViewport(): boolean;
}

declare global {
  interface Window {
    __redlines?: JourneyHook;
  }
}

export function exposeForJourneys(
  editor: Editor,
  controller: DocumentController,
  menu: Pick<JourneyHook, 'menuRow' | 'openFile' | 'dockToolbar'>,
): void {
  const parsedAtViewport = () => {
    const { state, viewport } = editor.view;
    const middle = Math.floor((viewport.from + viewport.to) / 2);
    return parsedAt(state, middle);
  };
  window.__redlines = { editor, controller, parsedAtViewport, ...menu };
}
