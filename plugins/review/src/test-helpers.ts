// Helpers shared by the review interface's tests, which run under happy-dom. They are not part of
// the package.

import { createEditor, type Author, type Editor, type MetPerson } from '@redlines/editor';
import { accept, acceptMarks, EditError, reject, rejectMarks } from '@redlines/format';
import type { HostDocumentData } from '@redlines/plugin-api';
import { createReview, type ReviewController, type ReviewOptions } from './index.ts';

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
  /** Who resolved it and when, as the ledger writes it: `bo 2026-11-01T10:00Z`. */
  resolved?: string,
): string[] {
  return [
    `  ${id}:`,
    `    by: ${by}`,
    '    at: 2026-10-31T09:41Z',
    ...(resolved ? [`    resolved: ${resolved}`] : []),
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
  /** What the editor told the host through `onNotice`, in order. */
  notices: string[];
}

const mounted: Mounted[] = [];

/** The message of a decision that `mount({ refuse: true })` refuses. */
export const REFUSAL = 'This change can’t be decided here.';

/**
 * An editor showing `doc`, in a page, with the review interface. Its accept and reject apply
 * @redlines/format's, as the editor's own do, and record each call. With `refuse`, every decision
 * is refused with an `EditError`, as for a ledger that can't be read, and changes nothing. With
 * `real`, the editor's own `accept` and `reject` are left as they are (one undo step each).
 * `review` adds to the options the review interface gets. A decision of several marks records
 * one entry for each, in order.
 */
export function mount(
  doc: string,
  {
    refuse = false,
    real = false,
    review: options = {},
    people,
  }: {
    refuse?: boolean;
    real?: boolean;
    review?: Partial<ReviewOptions>;
    people?: readonly MetPerson[];
  } = {},
): Mounted {
  const parent = document.createElement('div');
  document.body.append(parent);
  const notices: string[] = [];
  const editor = createEditor(parent, {
    doc,
    author: me,
    ...(people ? { people } : {}),
    onNotice: (message) => notices.push(message),
  });
  // happy-dom fires `selectionchange` while CodeMirror is still writing a focused editor's
  // selection, which makes CodeMirror read it back inside its own update; a browser fires it
  // later. The tests keep the editor unfocused, also when a press would focus it.
  editor.view.focus = () => {};
  editor.view.contentDOM.focus = () => {};
  const decided: Mounted['decided'] = [];
  const decide = (how: 'accept' | 'reject') => (id: string | readonly string[]) => {
    if (refuse) throw new EditError(REFUSAL, 'unreadable-ledger');
    const text = editor.view.state.doc.toString();
    const changes =
      typeof id !== 'string'
        ? how === 'accept'
          ? acceptMarks(text, id)
          : rejectMarks(text, id)
        : how === 'accept'
          ? accept(text, id)
          : reject(text, id);
    for (const each of typeof id === 'string' ? [id] : id) decided.push({ id: each, how });
    editor.view.dispatch({ changes });
  };
  if (!real) {
    editor.accept = decide('accept');
    editor.reject = decide('reject');
  }
  const opened: boolean[] = [];
  const review = createReview(editor, {
    author: me,
    onOpenChange: (open) => opened.push(open),
    ...options,
  });
  const result = { editor, review, decided, opened, notices };
  mounted.push(result);
  return result;
}

/** A host's store for what plugins keep of each document, in memory, which counts its writes. */
export interface MemoryData extends HostDocumentData {
  /** How many times `set` was called. */
  writes: number;
  /** What the review keeps for the document at `path`, as the store holds it. */
  drafts(path: string): unknown;
}

/** A store as a host keeps one: what is put in comes out a copy, as through the page's storage. */
export function memoryData(): MemoryData {
  const kept = new Map<string, string>();
  const data: MemoryData = {
    writes: 0,
    get: (path, key) => {
      const json = kept.get(`${path}\n${key}`);
      return json === undefined ? undefined : (JSON.parse(json) as unknown);
    },
    set: (path, key, value) => {
      data.writes++;
      if (value === undefined) kept.delete(`${path}\n${key}`);
      else kept.set(`${path}\n${key}`, JSON.stringify(value));
    },
    drafts: (path) => data.get(path, 'review.drafts'),
  };
  return data;
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
 * Gives elements with these classes these heights, as a layout would. happy-dom lays nothing out,
 * so every element is 0 pixels high. Returns a function that undoes it.
 */
export function stubHeights(heights: Record<string, number>): () => void {
  const proto = HTMLElement.prototype;
  const original = Object.getOwnPropertyDescriptor(proto, 'offsetHeight');
  Object.defineProperty(proto, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      const name = Object.keys(heights).find((className) => this.classList.contains(className));
      return name ? (heights[name] ?? 0) : 0;
    },
  });
  return () => {
    if (original) Object.defineProperty(proto, 'offsetHeight', original);
  };
}

/** Gives `el` this place on screen, as a layout would. */
export function stubRect(
  el: Element,
  {
    left = 0,
    top = 0,
    right = 0,
    bottom = 0,
  }: Partial<Record<'left' | 'top' | 'right' | 'bottom', number>>,
): void {
  const rect = {
    left,
    top,
    right,
    bottom,
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ ...rect, toJSON: () => rect }),
  });
}

/** Gives `el` this width, as a layout would. */
export function stubWidth(el: Element, width: number): void {
  Object.defineProperty(el, 'offsetWidth', { configurable: true, get: () => width });
}

/** Waits for timers set to run next, such as one that opens a card after a click. */
export function tick(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * A click on `target` as a browser sends it: pressed, released, and then the click itself, unless
 * the press took the pressed element out of the page.
 */
export function click(target: Element, release: Element = target): void {
  const init = { bubbles: true, cancelable: true, button: 0 };
  target.dispatchEvent(new MouseEvent('mousedown', init));
  release.dispatchEvent(new MouseEvent('mouseup', init));
  if (target.isConnected) target.dispatchEvent(new MouseEvent('click', init));
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
