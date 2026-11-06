// The box a comment or a reply is written in, in a note in the rail.

import { EditError, type EditErrorCode } from '@redlines/format';
import { button, element, errorLine } from './shared.ts';

/** A comment or a reply, just posted from one of the rail's boxes. */
export interface PostedComment {
  thread: string;
  text: string;
}

export interface FieldAttachment {
  /** Called with each comment box as it opens; returns a function that detaches. */
  (field: HTMLTextAreaElement): () => void;
}

/** What a host adds to the boxes. */
export interface BoxOptions {
  /**
   * Called when a comment or a reply is posted from a box in the rail, once it is in the document
   * and the box has closed. Nothing else calls it: not a reload, an undo, a paste or `setDoc`.
   */
  onPosted?(comment: PostedComment): void;
  attachToField?: FieldAttachment;
}

export interface BoxActions {
  /** Posts the text, and returns its thread. Throws an `EditError` when it can't. */
  post(text: string): string;
  /** Called after the box closes, with what Escape left in it; empty after Cancel or a post. */
  close(kept: string): void;
  /** Called when the box changes size. */
  resize(): void;
  /** Called with a part of the box that should show. */
  reveal(el: HTMLElement): void;
}

/** Why a comment or a reply wasn't posted, in a line of a note. Others go in the format's words. */
const REFUSALS: Partial<Record<EditErrorCode, string>> = {
  'inside-code': 'To comment on code, select all of it.',
  'front-matter': "Comments can't go in front matter yet.",
  'no-legal-placement': 'Select other text to comment on.',
  'would-hide-marks': 'Decide the changes here first.',
  'unreadable-ledger': "This file's ledger can't be read.",
  'unclosed-end': 'Close the code block that ends the file.',
};

/**
 * The box a comment or a reply is written in. What is written in it is private until it is posted.
 * A reply's box stays with its note, and keeps its text when closed. A new comment's goes with its
 * note: Cancel discards its text, and Escape sets it aside for the next start on that anchor.
 */
export class CommentBox {
  readonly dom: HTMLElement;
  private readonly field: HTMLTextAreaElement;
  private readonly postButton: HTMLButtonElement;
  private readonly error: HTMLElement;
  private readonly notice: HTMLElement;
  private readonly row: HTMLElement;
  private readonly options: BoxOptions;
  private readonly actions: BoxActions;
  private detachField: (() => void) | null = null;
  /** Whether the last post was refused. */
  refused = false;

  constructor(label: string, options: BoxOptions, actions: BoxActions) {
    this.options = options;
    this.actions = actions;
    this.dom = element('div', 'rl-note-box');
    this.field = element('textarea', '');
    this.field.rows = 2;
    this.field.placeholder = label;
    this.field.setAttribute('aria-label', label);
    this.error = errorLine('rl-note-error');
    this.notice = errorLine('rl-note-notice');
    this.postButton = button('rl-note-button', 'Post', () => this.post());
    this.postButton.title = 'Post (⌘↩)';
    this.postButton.disabled = true;
    this.row = element('div', 'rl-note-box-row');
    this.row.append(
      button('rl-note-button', 'Cancel', () => this.close()),
      this.postButton,
    );
    this.dom.append(this.field, this.notice, this.error, this.row);

    this.field.addEventListener('input', () => this.changed());
    this.field.addEventListener('keydown', (event) => {
      // A key during composition belongs to the input method: Escape there drops the composition.
      if (event.isComposing) return;
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        this.post();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        this.close(this.field.value);
      }
    });
  }

  private changed(): void {
    const { field } = this;
    this.postButton.disabled = !this.written;
    this.error.hidden = true;
    // As high as the text, with the borders that `scrollHeight` leaves out.
    field.style.height = 'auto';
    field.style.height = `${field.scrollHeight + field.offsetHeight - field.clientHeight}px`;
    this.actions.resize();
  }

  /** Whether there is a draft in the box. */
  get written(): boolean {
    return !!this.field.value.trim();
  }

  open(focus?: FocusOptions): void {
    this.dom.hidden = false;
    this.detachField ??= this.options.attachToField?.(this.field) ?? null;
    this.field.focus(focus);
    this.actions.resize();
  }

  /** Puts a draft in the box. */
  setDraft(text: string): void {
    this.field.value = text;
    this.changed();
  }

  /** Says something about the draft under it, such as that its anchor changed, or says nothing. */
  setNotice(text: string | null): void {
    this.notice.textContent = text ?? '';
    this.notice.hidden = text === null;
  }

  /** Puts away why the last post was refused. */
  clearRefusal(): void {
    this.refused = false;
    this.error.hidden = true;
  }

  /** Lets go of what a host attached to the field. */
  detach(): void {
    this.detachField?.();
    this.detachField = null;
  }

  private close(kept = ''): void {
    this.dom.hidden = true;
    this.detach();
    this.actions.close(kept);
  }

  private post(): void {
    const text = this.field.value.trim();
    if (!text) return;
    let thread: string;
    try {
      thread = this.actions.post(text);
    } catch (error) {
      // Such as an anchor inside code, or a ledger that can't be read: the draft stays.
      if (!(error instanceof EditError)) throw error;
      this.refused = true;
      this.error.textContent = (error.code && REFUSALS[error.code]) ?? error.message;
      this.error.hidden = false;
      // The row is under the message, which can come to be past the foot of the window.
      this.actions.reveal(this.row);
      return;
    }
    this.field.value = '';
    this.field.style.height = '';
    this.postButton.disabled = true;
    this.close();
    this.options.onPosted?.({ thread, text });
  }
}
