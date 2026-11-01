// The review interface (design §5.5–§5.7): margin notes, change cards and the review bar.

import { Compartment, type Extension, StateEffect } from '@codemirror/state';
import { ViewPlugin } from '@codemirror/view';
import type { Author, Editor } from '@redlines/editor';
import { cards } from './cards.ts';
import { rail } from './rail.ts';
import type { ReviewContext } from './shared.ts';
import { reviewTheme } from './styles.ts';

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
  const { view } = editor;
  const ctx: ReviewContext = { editor, author: options.author };
  const compartment = new Compartment();
  let destroyed = false;

  /** Adds the interface to the editor's state, unless it is there. */
  const attach = () => {
    if (destroyed || compartment.get(view.state) !== undefined) return;
    view.dispatch({ effects: StateEffect.appendConfig.of(compartment.of(extension)) });
  };
  const extension: Extension = [
    rail(ctx),
    cards(ctx),
    reviewTheme,
    // Opening a document (`Editor.setDoc`) replaces the editor's state, and with it what was added
    // after the editor was made. The interface comes back once the new state is in.
    ViewPlugin.define(() => ({ destroy: () => queueMicrotask(attach) })),
  ];
  attach();

  const notYet = () => {
    throw new Error('The review bar is not written yet');
  };
  return {
    openBar: notYet,
    closeBar: notYet,
    isBarOpen: () => false,
    next: notYet,
    previous: notYet,
    destroy() {
      destroyed = true;
      if (compartment.get(view.state) !== undefined) {
        view.dispatch({ effects: compartment.reconfigure([]) });
      }
    },
  };
}
