// The review interface (design §5.5–§5.7): margin notes, change cards and the review bar.

import type { Extension } from '@codemirror/state';
import { ViewPlugin } from '@codemirror/view';
import type { Author, Editor } from '@redlines/editor';
import { closeBar, isBarOpen, move, openBar, reviewBar } from './bar.ts';
import { cards } from './cards.ts';
import { rail } from './rail.ts';
import type { ReviewContext } from './shared.ts';
import { reviewTheme } from './styles.ts';

export interface ReviewController {
  /** Opens the review bar, which is hidden until asked for. */
  openBar(): void;
  closeBar(): void;
  isBarOpen(): boolean;
  /** Selects the next change and opens the bar (⌥⌘]). */
  next(): void;
  /** Selects the previous change and opens the bar (⌥⌘[). */
  previous(): void;
  /** Takes the review interface out of the editor. */
  destroy(): void;
}

export interface ReviewOptions {
  author: Author;
  /**
   * Called when the review bar opens or closes, also when opening another document closes it.
   * It may come while the editor is updating, so it must not change the editor itself.
   */
  onOpenChange?: (open: boolean) => void;
}

/**
 * Adds the review interface to an editor: notes in the right margin, cards on changes, and the
 * review bar. The host routes its menu commands and shortcuts to the controller. The interface
 * stays when the editor opens another document (`Editor.setDoc`), with the bar closed.
 */
export function createReview(editor: Editor, options: ReviewOptions): ReviewController {
  const { view } = editor;
  const ctx: ReviewContext = { editor, author: options.author };
  let destroyed = false;

  let reported = false;
  const isOpen = () => !destroyed && isBarOpen(view.state);
  /** Tells the host when the bar has opened or closed since it was last told. */
  const report = () => {
    const open = isOpen();
    if (open === reported) return;
    reported = open;
    options.onOpenChange?.(open);
  };

  const extension: Extension = [
    rail(ctx),
    cards(ctx),
    reviewBar(ctx, report),
    reviewTheme,
    // Starts again with each document's state: a new document starts with the bar closed.
    ViewPlugin.define(() => {
      report();
      return {};
    }),
  ];
  const remove = editor.addExtension(extension);

  return {
    openBar() {
      openBar(view, ctx);
      report();
    },
    closeBar() {
      closeBar(view);
      report();
    },
    isBarOpen: isOpen,
    next() {
      move(view, ctx, 1);
      report();
    },
    previous() {
      move(view, ctx, -1);
      report();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      remove();
      report();
    },
  };
}
