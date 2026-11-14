// The review interface (design §5.5–§5.7): margin notes, change cards and the review bar.

import type { Extension } from '@codemirror/state';
import { ViewPlugin } from '@codemirror/view';
import { type Author, barClickHandlers, type Editor } from '@redlines/editor';
import type { PluginManifest } from '@redlines/plugin-api';
import { barClickHandler, closeBar, isBarOpen, move, openBar, reviewBar } from './bar.ts';
import { cards } from './cards.ts';
import { type PinnedElement, rail, type RailOptions } from './rail.ts';
import type { ReviewContext } from './shared.ts';
import { reviewTheme } from './styles.ts';

export type { FieldAttachment, PostedComment } from './comment-box.ts';
export { icon, type IconName } from './icons.ts';
export type { PinnedElement, ThreadExtras } from './rail.ts';

/**
 * What the review interface is and needs. It reads and changes the document, and keeps the comments
 * being written in its own store of document data (`ReviewOptions.documentData`).
 */
export const manifest: PluginManifest = {
  id: 'redlines.review',
  name: 'Review',
  version: '0.0.0',
  needs: ['document:read', 'document:edit', 'document:data'],
};

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
   * under the caret, or else the caret. A document shown Clean switches to the markup view, and what Escape
   * set aside on that anchor comes back. Returns false when it did nothing: Raw takes no comments,
   * and says so through the editor's `onNotice`. With `initialText`, an empty box opens with it, the
   * caret after it and nothing posted; a draft that Escape set aside, or a box being written in,
   * keeps its own words.
   */
  startComment(initialText?: string): boolean;
  /**
   * Whether a comment or a reply that isn't posted has text, which opening another document
   * (`Editor.setDoc`) would drop: in a box that shows, in a reply's box that was closed, or in a
   * comment set aside with Escape.
   */
  hasDraft(): boolean;
  /**
   * The host put the view at a place of its own in this document, such as a line a window was
   * opened at: drafts that come back for it leave the scroll and the keyboard as they are, where
   * they would otherwise go to the box last typed in.
   */
  keepPlace(): void;
  /** Writes the drafts now rather than in a moment, as before the window closes or the app quits. */
  saveDrafts(): void;
  /**
   * Forgets the drafts of the document, kept and about to be kept: the person discarded them, to
   * open another document. What is typed after this is kept again.
   */
  discardDrafts(): void;
  /**
   * Whether resolved comments show in the rail, as settled notes that can be reopened. Off at the
   * start unless `ReviewOptions.showResolved` says otherwise; the choice stays when the editor
   * opens another document.
   */
  showsResolved(): boolean;
  setShowResolved(show: boolean): void;
  /** Draws a thread's note again, with its text and its footer, and lays the rail out. */
  refreshThread(thread: string): void;
  /**
   * Shows a thread's note, as Show in a notification asks: a document shown Clean or Raw switches
   * to the markup view, the note is selected and scrolled into view, and in a narrow editor it is pinned
   * over the page from its dot. Returns false, changing nothing, when the rail has no note for it:
   * no such thread, or a resolved one that isn't shown.
   */
  showThread(thread: string): boolean;
  /**
   * Puts away a change's card and a note shown from its dot, as a zoom change does: their places
   * were measured for the old layout. A note being written stays open, with its draft and the
   * keyboard.
   */
  closePopovers(): void;
  /**
   * Holds the rail in the state it has, notes or dots, while the host pinches the text: however
   * the editor's width changes, nothing switches under the fingers. `holdRail(false)` lets it go
   * and applies the rule once.
   */
  holdRail(held: boolean): void;
  /**
   * Has the rail lay out `el`, an element of the host's, among its notes, level with the text at
   * `anchor` (a position the host keeps up with edits, which the rail asks for as it lays out): as
   * a new comment's box is, it stays level with its anchor, and the notes around it go up or down
   * to clear it, so that none is covered. Ask's bubble is one. The rail sets the element's `left`
   * and `top`, as for a note, and nothing else: it neither draws the element nor moves it in the
   * page, and the host makes it as wide as a note (the rail's width), fills it, tells the rail when
   * its height changes (`resized`) and takes it out of the page itself.
   *
   * It returns null, and lays out nothing, where the rail doesn't show its notes in full: in a
   * narrow editor (the notes are dots), in Clean and Raw, and when the rail has no note of its own,
   * where the column makes no room for it. The host places the element itself then, as it would
   * without a rail. One that was laid out is let go when the rail stops showing its notes, and
   * `lost` is called, once, after the update that did it, for the host to place the element.
   * Calling `release` takes it out of the layout, and the notes go back to their places.
   */
  pinToRail(el: HTMLElement, anchor: () => number, lost: () => void): PinnedElement | null;
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
  const changeCards = cards(ctx);
  const extension: Extension = [
    notes.extension,
    changeCards.extension,
    reviewBar(ctx, report),
    barClickHandlers.of(barClickHandler(ctx, (view, id) => changeCards.pinChange(view, id))),
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
    startComment: (initialText) => notes.startComment(initialText),
    hasDraft: () => notes.hasDraft(),
    saveDrafts: () => notes.saveDrafts(),
    discardDrafts: () => notes.discardDrafts(),
    keepPlace: () => notes.keepPlace(),
    showsResolved: () => notes.showsResolved(),
    setShowResolved: (show) => notes.setShowResolved(show),
    refreshThread: (thread) => notes.refreshThread(thread),
    showThread: (thread) => notes.showThread(thread),
    closePopovers() {
      changeCards.close(view);
      notes.closePopover();
    },
    holdRail: (held) => notes.hold(held),
    pinToRail: (el, anchor, lost) => notes.pinToRail(el, anchor, lost),
    destroy() {
      if (destroyed) return;
      destroyed = true;
      notes.destroy();
      removeCommands();
      remove();
      report();
    },
  };
}
