// Alt text (issue #553): the Image menu's Alt Text… opens a small bubble by the image with a field
// for the description, Save and Cancel, and, where an agent can see pictures, "Describe with <agent>".
// What the agent writes goes into the field and nowhere else: it is read, and changed, before Save, and
// the file is not touched until Save, which writes it as any edit (`setImageAlt`: tracked with Track
// Changes on, untracked off; Undo takes it back). It is a note's look (the Ask bubble's classes).
//
// The bubble's states: the field, ready; "waiting" while the agent writes (the field and Save are held,
// Cancel and Esc stop it); "written", with "Written by <agent>. Read it and change it before saving.";
// and "failed", with why, the field as it was.

import { EditorView } from '@codemirror/view';
import {
  type Editor,
  imageAt,
  imageInSelection,
  setImageAlt,
  viewModeField,
} from '@redlines/editor';
import { placeBubble } from '../ask/place.ts';
import { addStyle } from '../ask/styles.ts';

/** The image the bubble is about, as the agent is asked about it. */
export interface AltImage {
  /** The image's source as the document writes it. */
  src: string;
  /** The alt text it has now (may be empty). */
  alt: string;
}

/** Who would write a description, found when the bubble opens. */
export interface AltWriter {
  /** The agent's display name, as the picker shows it. */
  name: string;
  /** Why it can't write one (the button is grayed, and says so); absent when it can. */
  unavailable?: string;
}

/** The agent behind "Describe with <agent>". */
export interface AltDescriber {
  /** Who would write it: the default agent, or the one Ask's picker has. Null where there is none. */
  who(): Promise<AltWriter | null>;
  /** Writes a description of the image. Rejects with a message, said as it is, for a failure. */
  describe(image: AltImage, signal: AbortSignal): Promise<string>;
}

export interface AltTextOptions {
  /** Shows a one-line message that doesn't interrupt, for what can't be done. */
  notice(message: string): void;
  /** Bumped whenever another document replaces this one; the bubble goes when it changes. */
  generation?: () => number;
  /** Without it the bubble has no Describe button. */
  describer?: AltDescriber;
}

export interface AltText {
  /** Opens the bubble for the image under the caret, or in the selection. False where there is none. */
  start(): boolean;
  close(): void;
  isOpen(): boolean;
  destroy(): void;
}

export const NO_IMAGE = 'Select an image to describe it.';
export const WRITTEN_BY = (agent: string) =>
  `Written by ${agent}. Read it and change it before saving.`;
const RAW = 'Alt text works on the text as it reads. Show Clean or Redlines first.';
const STYLE_ID = 'rl-alt-style';

const px = (n: number) => `calc(${n}px * var(--rl-note-scale, 1))`;
const ALT_STYLE = `
.rl-qa-alt-status { margin: ${px(4)} 0 0; color: var(--rl-ink-2); font-size: var(--rl-size-ui-small-scaled); overflow-wrap: anywhere; }
.rl-qa-alt-status[hidden] { display: none; }
.rl-qa-alt textarea[disabled] { opacity: 0.6; }
.rl-qa-alt .rl-note-button[aria-disabled='true'] { opacity: 0.5; }
`;

function addAltStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = ALT_STYLE;
  document.head.append(style);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string) {
  const made = document.createElement(tag);
  if (className) made.className = className;
  return made;
}

let count = 0;

/** One open bubble. */
interface Open {
  root: HTMLElement;
  /** Where the image starts, followed through the edits that happen meanwhile. */
  from: number;
  abort: AbortController | null;
  generation: number | undefined;
  teardown: () => void;
}

/**
 * Adds Alt Text to an editor: the command `image.altText` (Edit Image Alt Text…), which the Image
 * menu shows when it is registered, and the bubble it opens.
 */
export function createAltText(editor: Editor, options: AltTextOptions): AltText {
  const { view } = editor;
  const doc = view.dom.ownerDocument;
  const win = doc.defaultView ?? window;
  let open: Open | null = null;

  function close(refocus = false): void {
    if (!open) return;
    const closing = open;
    open = null;
    closing.abort?.abort();
    closing.teardown();
    closing.root.remove();
    if (refocus) view.focus();
  }

  const start = (): boolean => {
    if (view.state.field(viewModeField) === 'raw') {
      options.notice(RAW);
      return false;
    }
    const image = imageInSelection(view.state);
    if (!image) {
      options.notice(NO_IMAGE);
      return false;
    }
    close();
    addStyle();
    addAltStyle();
    const root = el('div', 'rl-qa rl-qa-alt');
    root.id = `rl-qa-alt-${++count}`;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'Alt Text');
    const composer = el('div', 'rl-note-box');
    const field = el('textarea');
    field.rows = 2;
    field.value = image.alt;
    field.placeholder = 'Describe the image for people who can’t see it';
    field.setAttribute('aria-label', 'Alt text');
    const status = el('div', 'rl-qa-alt-status');
    status.setAttribute('role', 'status');
    status.hidden = true;
    const row = el('div', 'rl-note-box-row');
    const button = (label: string, run: () => void) => {
      const made = el('button', 'rl-note-button');
      made.type = 'button';
      made.textContent = label;
      made.addEventListener('mousedown', (event) => event.preventDefault());
      made.addEventListener('click', () => {
        if (made.getAttribute('aria-disabled') !== 'true') run();
      });
      return made;
    };
    const cancel = button('Cancel', () => close(true));
    const save = button('Save', () => commit());
    const describe = button('', () => describing());
    describe.hidden = true;
    row.append(cancel, describe, save);
    composer.append(field, status, row);
    root.append(composer);
    view.scrollDOM.append(root);

    const mine: Open = {
      root,
      from: image.from,
      abort: null,
      generation: options.generation?.(),
      teardown: () => {},
    };
    open = mine;

    const size = () => {
      field.style.height = 'auto';
      field.style.height = `${field.scrollHeight + field.offsetHeight - field.clientHeight}px`;
      place();
    };
    const place = () => {
      if (open !== mine) return;
      const now = imageInSelectionAt(mine.from);
      if (!now) return close();
      placeBubble(view, root, now);
    };
    const imageInSelectionAt = (from: number) => {
      const found = imageAt(view.state, Math.min(from + 1, view.state.doc.length));
      return found && found.from === from ? found : null;
    };

    const waiting = (on: boolean) => {
      field.disabled = on;
      save.setAttribute('aria-disabled', String(on));
      describe.setAttribute('aria-disabled', String(on));
    };
    const say = (text: string) => {
      status.textContent = text;
      status.hidden = text === '';
      size();
    };

    function commit(): void {
      if (mine.abort) return;
      const now = imageInSelectionAt(mine.from);
      if (now) setImageAlt(view, field.value, now.from);
      close(true);
    }

    function describing(): void {
      const { describer } = options;
      const now = imageInSelectionAt(mine.from);
      if (!describer || !now || mine.abort) return;
      const name = describe.dataset['agent'] ?? 'the agent';
      const abort = new AbortController();
      mine.abort = abort;
      waiting(true);
      say(`${name} is looking at the image…`);
      describer.describe({ src: now.src, alt: field.value }, abort.signal).then(
        (text) => {
          if (open !== mine || abort.signal.aborted) return;
          mine.abort = null;
          waiting(false);
          field.value = text.replace(/\s+/g, ' ').trim();
          say(WRITTEN_BY(name));
          field.focus({ preventScroll: true });
          field.select();
        },
        (error: unknown) => {
          if (open !== mine || abort.signal.aborted) return;
          mine.abort = null;
          waiting(false);
          say(error instanceof Error ? error.message : String(error));
        },
      );
    }

    field.addEventListener('input', size);
    field.addEventListener('keydown', (event) => {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === 'Enter' && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        commit();
      }
    });
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
      event.preventDefault();
      close(true);
    };
    const onPress = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.contains(event.target)) close();
    };
    doc.addEventListener('keydown', onKey);
    doc.addEventListener('pointerdown', onPress, true);
    win.addEventListener('resize', place);
    const remove = editor.addExtension(
      EditorView.updateListener.of((update) => {
        if (open !== mine) return;
        if (options.generation && options.generation() !== mine.generation) return close();
        if (update.docChanged) mine.from = update.changes.mapPos(mine.from, 1);
        if (update.docChanged || update.geometryChanged || update.viewportChanged) place();
      }),
    );
    mine.teardown = () => {
      doc.removeEventListener('keydown', onKey);
      doc.removeEventListener('pointerdown', onPress, true);
      win.removeEventListener('resize', place);
      remove();
    };

    // Who would write it is found while the person starts to read the field.
    const { describer } = options;
    if (describer) {
      void describer.who().then(
        (who) => {
          if (open !== mine || !who) return;
          describe.dataset['agent'] = who.name;
          describe.textContent = `Describe with ${who.name}`;
          describe.hidden = false;
          if (who.unavailable !== undefined) {
            describe.setAttribute('aria-disabled', 'true');
            describe.title = who.unavailable;
          }
          size();
        },
        () => {},
      );
    }
    size();
    field.focus({ preventScroll: true });
    field.select();
    root.scrollIntoView?.({ block: 'nearest' });
    return true;
  };

  const removeCommand = editor.commands.register([
    {
      id: 'image.altText',
      title: 'Edit Image Alt Text…',
      // Alt text is written in a field of its own, so the key may come from another field.
      runsInFields: true,
      disabledReason: (state) => (imageInSelection(state) === null ? NO_IMAGE : undefined),
      run: start,
    },
  ]);

  return {
    start,
    close: () => close(),
    isOpen: () => open !== null,
    destroy() {
      close();
      removeCommand();
    },
  };
}
