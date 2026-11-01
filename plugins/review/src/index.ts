// The review interface (design §5.5–§5.7): margin notes, change cards and the review bar.

import { Compartment, type Extension, StateEffect } from '@codemirror/state';
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
  /** Called when the review bar opens or closes. */
  onOpenChange?: (open: boolean) => void;
}

/**
 * Adds the review interface to an editor: notes in the right margin, cards on changes, and the
 * review bar. The host routes its menu commands and shortcuts to the controller.
 */
export function createReview(editor: Editor, options: ReviewOptions): ReviewController {
  const { view } = editor;
  const ctx: ReviewContext = { editor, author: options.author };
  const compartment = new Compartment();
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

  /** Adds the interface to the editor's state, unless it is there. */
  const attach = () => {
    if (destroyed || compartment.get(view.state) !== undefined) return;
    view.dispatch({ effects: StateEffect.appendConfig.of(compartment.of(extension)) });
    report();
  };
  const extension: Extension = [
    rail(ctx),
    cards(ctx),
    reviewBar(ctx, report),
    reviewTheme,
    // Opening a document (`Editor.setDoc`) replaces the editor's state, and with it what was added
    // after the editor was made, the open bar included. The interface comes back once the new
    // state is in.
    ViewPlugin.define(() => ({ destroy: () => queueMicrotask(attach) })),
  ];
  attach();

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
      destroyed = true;
      if (compartment.get(view.state) !== undefined) {
        view.dispatch({ effects: compartment.reconfigure([]) });
      }
      report();
    },
  };
}
