// The review interface (design §5.5–§5.7): margin notes, change cards and the review bar. A stub
// until plan Track G.

import type { Author, Editor } from '@redlines/editor';

export interface ReviewController {
  openBar(): void;
  closeBar(): void;
  isBarOpen(): boolean;
  next(): void;
  previous(): void;
  destroy(): void;
}

export interface ReviewOptions {
  author: Author;
  /** Called when the review bar opens or closes. */
  onOpenChange?: (open: boolean) => void;
}

/** Adds the review interface to an editor. */
export function createReview(editor: Editor, options: ReviewOptions): ReviewController {
  void editor;
  void options;
  throw new Error('The review interface is not written yet');
}
