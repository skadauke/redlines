// Typed text that goes where the editor's own caret is, even when the DOM's selection is stale (#508).
//
// A key that changes a block (Tab, Shift-Tab, Return, a paste, an agent's edit) redraws the block's
// lines, and CodeMirror writes the new caret into the DOM at the end of that update. Keys typed
// right behind it, in a burst, can still arrive while WebKit's own selection points at the nodes
// the redraw replaced, or at the start of the block after: it inserts the text there, and
// CodeMirror reads the change where it happened. So for a moment after such an edit this guard
// remembers where the caret was put, and a typed character whose DOM selection isn't that place
// is inserted there by the editor itself, with the browser's insertion cancelled. When the DOM and
// the editor agree, nothing is done: the browser types as it always does.
//
// The moment ends at the first sign that the person moved the caret on their own (a press, a
// touch, an arrow or any key with a modifier, a composition starting, the editor losing focus), or
// after `STALE_WINDOW_MS`. A composition, an autocorrection and a spelling replacement are never
// taken over: only an `insertText` outside a composition is.

import { EditorSelection, type Extension, type SelectionRange } from '@codemirror/state';
import { type EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { agentStep } from '../history/history.ts';

/** How long after a block's edit a stale DOM selection is looked for. */
export const STALE_WINDOW_MS = 1000;

/** The edits that redraw a block's lines (an agent's edit is told by its annotation). */
const REDRAWS = ['indent', 'input.break', 'input.paste', 'delete.backward.block', 'delete.block'];

/** Keys that go on in the same moment: they act where the caret was put, or type there. */
const CONTINUES = new Set(['Tab', 'Enter', 'Backspace', 'Delete']);

/** The DOM's selection as document positions, or null where it is outside the text or on nodes the
 * redraw took out of it. */
function domSelection(view: EditorView): { from: number; to: number } | null {
  const selection = view.dom.ownerDocument.getSelection();
  const { anchorNode, focusNode } = selection ?? {};
  if (!selection || !anchorNode || !focusNode) return null;
  if (!view.contentDOM.contains(anchorNode) || !view.contentDOM.contains(focusNode)) return null;
  try {
    const a = view.posAtDOM(anchorNode, selection.anchorOffset);
    const h = view.posAtDOM(focusNode, selection.focusOffset);
    return { from: Math.min(a, h), to: Math.max(a, h) };
  } catch {
    return null;
  }
}

class StaleInput {
  /** Where the last block edit put the caret, kept up to date by the text typed after it. */
  sel: SelectionRange | null = null;
  until = 0;
  readonly view: EditorView;

  constructor(view: EditorView) {
    this.view = view;
  }

  get active(): boolean {
    return this.sel !== null && Date.now() < this.until;
  }

  update(update: ViewUpdate): void {
    if (!update.docChanged) return;
    const typed = update.transactions.every((tr) => tr.isUserEvent('input.type'));
    const redrawn = update.transactions.some(
      (tr) => REDRAWS.some((event) => tr.isUserEvent(event)) || tr.annotation(agentStep),
    );
    if (!redrawn && !(typed && this.active)) return;
    this.sel = update.state.selection.main;
    if (redrawn) this.until = Date.now() + STALE_WINDOW_MS;
  }

  end(): void {
    this.sel = null;
  }

  /** The caret goes back where the edit put it, when the editor has drifted from it: a key acts
   * on the editor's selection, which the DOM's selection may have overwritten. */
  restore(): void {
    const { view, sel } = this;
    if (!sel) return;
    const here = view.state.selection.main;
    if (here.from === sel.from && here.to === sel.to) return;
    view.dispatch({ selection: EditorSelection.create([sel]) });
  }

  keydown(event: KeyboardEvent): void {
    if (!this.active) return;
    if (event.key === 'Shift') return;
    const plain = !event.metaKey && !event.ctrlKey && !event.altKey;
    if (plain && (event.key.length === 1 || CONTINUES.has(event.key))) this.restore();
    else this.end();
  }

  beforeinput(event: InputEvent): boolean {
    const { view, sel } = this;
    if (!sel || !this.active) return false;
    if (event.inputType !== 'insertText' || !event.data || event.isComposing || view.composing) {
      return false;
    }
    const dom = domSelection(view);
    if (dom && dom.from === sel.from && dom.to === sel.to) return false;
    event.preventDefault();
    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert: event.data },
      selection: EditorSelection.cursor(sel.from + event.data.length),
      userEvent: 'input.type',
    });
    return true;
  }
}

/** See the top of the file. */
export function staleInput(): Extension {
  return ViewPlugin.fromClass(StaleInput, {
    eventHandlers: {
      keydown(event) {
        this.keydown(event);
        return false;
      },
      beforeinput(event) {
        return this.beforeinput(event);
      },
      pointerdown() {
        this.end();
        return false;
      },
      mousedown() {
        this.end();
        return false;
      },
      touchstart() {
        this.end();
        return false;
      },
      compositionstart() {
        this.end();
        return false;
      },
      blur() {
        this.end();
        return false;
      },
    },
  });
}
