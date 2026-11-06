// The review interface (design §5.5–§5.7): margin notes, change cards and the review bar.

import type { Extension } from '@codemirror/state';
import { ViewPlugin } from '@codemirror/view';
import type { Author, Editor } from '@redlines/editor';
import { closeBar, isBarOpen, move, openBar, reviewBar } from './bar.ts';
import { cards } from './cards.ts';
import { rail, type RailOptions } from './rail.ts';
import type { ReviewContext } from './shared.ts';
import { reviewTheme } from './styles.ts';

export type { FieldAttachment, PostedComment } from './comment-box.ts';
export { icon, type IconName } from './icons.ts';
export type { ThreadExtras } from './rail.ts';

export interface ReviewController {
  /** Opens the review bar, which is hidden until asked for. */
  openBar(): void;
  closeBar(): void;
  isBarOpen(): boolean;
  /** Selects the next change and opens the bar (⌥⌘]). */
  next(): void;
  /** Selects the previous change and opens the bar (⌥⌘[). */
  previous(): void;
  /**
   * Opens a box for a new comment (⌥⌘M), level with what it is on: the selection, or else the word
   * under the caret, or else the caret. A document shown Clean switches to Redlines, and what Escape
   * set aside on that anchor comes back. Returns false when it did nothing: Raw takes no comments,
   * and says so through the editor's `onNotice`.
   */
  startComment(): boolean;
  /**
   * Whether a comment or a reply that isn't posted has text, which opening another document
   * (`Editor.setDoc`) would drop: in a box that shows, in a reply's box that was closed, or in a
   * comment set aside with Escape.
   */
  hasDraft(): boolean;
  /**
   * Whether resolved comments show in the rail, as settled notes that can be reopened. Off at the
   * start unless `ReviewOptions.showResolved` says otherwise; the choice stays when the editor
   * opens another document.
   */
  showsResolved(): boolean;
  setShowResolved(show: boolean): void;
  /** Draws a thread's note again, with its text and its footer, and lays the rail out. */
  refreshThread(thread: string): void;
  /** Takes the review interface out of the editor. */
  destroy(): void;
}

export interface ReviewOptions extends RailOptions {
  author: Author;
  /**
   * Called when the review bar opens or closes, also when opening another document closes it.
   * It may come while the editor is updating, so it must not change the editor itself.
   */
  onOpenChange?: (open: boolean) => void;
}

/**
 * Adds the review interface to an editor: notes in the right margin, cards on changes, and the
 * review bar. The host routes its menu commands and shortcuts to the controller, and draws Add
 * Comment (`comment.add`) from the editor's commands. The interface stays when the editor opens
 * another document (`Editor.setDoc`), with the bar closed.
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

  const notes = rail(ctx, options);
  const extension: Extension = [
    notes.extension,
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
  // Comes last in the Format menu, which lists commands in the order they are registered.
  const removeCommands = editor.commands.register([
    {
      id: 'comment.add',
      title: 'Add Comment',
      shortcut: 'Mod-Alt-m',
      menu: 'format',
      group: 'comment',
      run: () => notes.startComment(),
    },
  ]);

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
    startComment: () => notes.startComment(),
    hasDraft: () => notes.hasDraft(),
    showsResolved: () => notes.showsResolved(),
    setShowResolved: (show) => notes.setShowResolved(show),
    refreshThread: (thread) => notes.refreshThread(thread),
    destroy() {
      if (destroyed) return;
      destroyed = true;
      removeCommands();
      remove();
      report();
    },
  };
}
