// Helpers shared by the review interface's tests, which run under happy-dom. They are not part of
// the package.

import { createEditor, type Author, type Editor } from '@redlines/editor';
import { accept, reject } from '@redlines/format';
import { createReview, type ReviewController } from './index.ts';

/** The person using the editor in the tests. */
export const me: Author = { handle: 'mira', name: 'Mira Ek' };

/** The people of a test file's ledger, as YAML lines. */
export const PEOPLE = [
  'people:',
  '  ada: {name: Ada Lovelace}',
  '  bo: {name: Bo Chen}',
  '  claude-ada: {name: Claude, agent: true, for: ada}',
];

/** A file: `body`, then a ledger of these YAML lines. */
export function file(body: string, ledger: string[]): string {
  return `${body}\n\n<!-- redlines\nversion: 1\n${ledger.join('\n')}\n-->\n`;
}

/** A comment thread in a ledger's `comments`, as YAML lines. */
export function thread(
  id: string,
  by: string,
  text: string,
  replies: { id: string; by: string; text: string }[] = [],
): string[] {
  return [
    `  ${id}:`,
    `    by: ${by}`,
    '    at: 2026-10-31T09:41Z',
    ...(replies.length ? ['    replies:'] : []),
    ...replies.flatMap((reply) => [
      `      - id: ${reply.id}`,
      `        by: ${reply.by}`,
      '        at: 2026-10-31T09:43Z',
      '        text: |-',
      `          ${reply.text}`,
    ]),
    '    text: |-',
    `      ${text}`,
  ];
}

export interface Mounted {
  editor: Editor;
  review: ReviewController;
  /** The decisions asked of the editor, in order. */
  decided: { id: string; how: 'accept' | 'reject' }[];
  /** Each time the review bar opened or closed. */
  opened: boolean[];
}

const mounted: Mounted[] = [];

/**
 * An editor showing `doc`, in a page, with the review interface. Until tracked editing is written
 * (plan Task E2), the editor's own accept and reject do nothing; here they apply
 * @redlines/format's, as the editor will, and record each call.
 */
export function mount(doc: string): Mounted {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, { doc, author: me });
  // happy-dom fires `selectionchange` while CodeMirror is still writing a focused editor's
  // selection, which makes CodeMirror read it back inside its own update; a browser fires it
  // later. The tests keep the editor unfocused.
  editor.view.focus = () => {};
  const decided: Mounted['decided'] = [];
  const decide = (how: 'accept' | 'reject') => (id: string) => {
    decided.push({ id, how });
    const text = editor.view.state.doc.toString();
    editor.view.dispatch({ changes: how === 'accept' ? accept(text, id) : reject(text, id) });
  };
  editor.accept = decide('accept');
  editor.reject = decide('reject');
  const opened: boolean[] = [];
  const review = createReview(editor, { author: me, onOpenChange: (open) => opened.push(open) });
  const result = { editor, review, decided, opened };
  mounted.push(result);
  return result;
}

/** Takes down every editor from `mount`. */
export function unmountAll(): void {
  for (const { editor, review } of mounted.splice(0)) {
    review.destroy();
    editor.destroy();
  }
  document.body.replaceChildren();
}

/** Waits for the editor's next measure, which happens in an animation frame. */
export function frame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/**
 * Gives elements with `className` this height, as a layout would. happy-dom lays nothing out, so
 * every element is 0 pixels high. Returns a function that undoes it.
 */
export function stubHeight(className: string, height: number): () => void {
  const proto = HTMLElement.prototype;
  const original = Object.getOwnPropertyDescriptor(proto, 'offsetHeight');
  Object.defineProperty(proto, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList.contains(className) ? height : 0;
    },
  });
  return () => {
    if (original) Object.defineProperty(proto, 'offsetHeight', original);
  };
}

/** The button in `root` with this text or label. */
export function button(root: ParentNode, name: string): HTMLButtonElement {
  const found = [...root.querySelectorAll('button')].find(
    (candidate) =>
      candidate.textContent?.trim() === name || candidate.getAttribute('aria-label') === name,
  );
  if (!found) throw new Error(`No button "${name}"`);
  return found;
}

/** A press of `key`, with modifiers, sent to `target`. */
export function press(target: EventTarget, key: string, init: KeyboardEventInit = {}): void {
  target.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }),
  );
}
