// Debug only: what the Playwright journeys (apps/desktop/journeys) reach in the plain page. They
// start a document, switch Track Changes and the view, and read the text and the caret through
// this, the way the check pages (`block-check.ts` and the others) hold the editor. It is set only
// in development and only in a plain browser tab, never in the app.

import type { Editor } from '@redlines/editor';
import type { DocumentController } from './document.ts';

export interface JourneyHook {
  editor: Editor;
  controller: DocumentController;
  /** A row of the menu bar by its text, or null: whether it is enabled, and a way to choose it. */
  menuRow(text: string): { enabled: boolean; run(): boolean } | null;
}

declare global {
  interface Window {
    __redlines?: JourneyHook;
  }
}

export function exposeForJourneys(
  editor: Editor,
  controller: DocumentController,
  menu: Pick<JourneyHook, 'menuRow'>,
): void {
  window.__redlines = { editor, controller, ...menu };
}
