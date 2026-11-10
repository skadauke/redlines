// Helpers for the embed's tests, which run under happy-dom. They are not part of the bundle.

import { EditorView, runScopeHandlers } from '@codemirror/view';
import { afterEach } from 'vitest';
import type { DemoHandle, DemoName, DemoState } from './api.ts';
import { mountDemo } from './demo.ts';

export interface Mounted {
  handle: DemoHandle;
  root: HTMLElement;
  view: EditorView;
  /** Every state the page was told, in order. */
  states: DemoState[];
  /** Every notice the page was told, in order. */
  notices: string[];
}

const mounted: { handle: DemoHandle; parent: HTMLElement }[] = [];

/** A demo mounted on a fresh element of the page. */
export function mountForTest(demo: DemoName): Mounted {
  const parent = document.createElement('div');
  document.body.append(parent);
  const states: DemoState[] = [];
  const notices: string[] = [];
  const handle = mountDemo(parent, {
    demo,
    onState: (state) => states.push(state),
    onNotice: (message) => notices.push(message),
  });
  mounted.push({ handle, parent });
  const root = parent.querySelector<HTMLElement>('.rl-embed')!;
  const view = EditorView.findFromDOM(root.querySelector<HTMLElement>('.cm-editor')!)!;
  // happy-dom fires `selectionchange` while CodeMirror is still writing a focused editor's
  // selection, which a browser does later: the tests keep the editor unfocused.
  view.focus = () => {};
  view.contentDOM.focus = () => {};
  return { handle, root, view, states, notices };
}

afterEach(() => {
  for (const { handle, parent } of mounted.splice(0)) {
    handle.destroy();
    parent.remove();
  }
});

/** Types `text` at `at`, as the keyboard does. */
export function typeAt(view: EditorView, at: number, text: string): void {
  view.dispatch({
    changes: { from: at, insert: text },
    selection: { anchor: at + text.length },
    userEvent: 'input.type',
  });
}

const mac = /Mac|iPhone|iPad/.test(globalThis.navigator?.platform ?? '');

/** Presses a key through the editor's keymaps. `Mod` is Cmd on a Mac and Ctrl elsewhere. */
export function pressMod(view: EditorView, key: string): boolean {
  const event = new KeyboardEvent('keydown', {
    key,
    ctrlKey: !mac,
    metaKey: mac,
    bubbles: true,
    cancelable: true,
  });
  return runScopeHandlers(view, event, 'editor');
}

/** The button whose text or `aria-label` is `name`. */
export function buttonNamed(root: HTMLElement, name: string): HTMLButtonElement {
  const found = [...root.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.getAttribute('aria-label') === name || button.textContent?.trim() === name,
  );
  if (!found) throw new Error(`no button named ${name}`);
  return found;
}

export function click(el: HTMLElement): void {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}

/** The open comment box's field. */
export function field(root: HTMLElement): HTMLTextAreaElement | null {
  return root.querySelector<HTMLTextAreaElement>('textarea');
}

/** Writes `text` in the comment box's field. */
export function write(root: HTMLElement, text: string): void {
  const input = field(root);
  if (!input) throw new Error('no comment box is open');
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

/** Posts the comment: Mod-Enter in its field, which the box takes as Post. */
export function post(root: HTMLElement): void {
  const input = field(root);
  if (!input) throw new Error('no comment box is open');
  input.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'Enter',
      ctrlKey: !mac,
      metaKey: mac,
      bubbles: true,
      cancelable: true,
    }),
  );
}
