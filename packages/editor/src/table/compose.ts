// An input method composing over selected cells (design: tables, "Selecting cells"). Left alone, the
// composition would replace the text from one cell to another, pipes and all. So the selection
// collapses to a caret at the start of the first cell when the composition starts, and the document
// is not touched: the composition goes in beside the first cell's text, as any composition does.
// When it ends, a composition that committed text finishes the job of typing over cells (the text
// that was in the first cell and the other cells' text go, in a step that history joins to the
// composition's, so one Undo gives every cell back); one that committed nothing, Esc or an empty
// commit, leaves every cell exactly as it was and selects the cells again.
//
// The clearing waits for the end because a change made when the composition starts could only be
// taken back, when the composition is cancelled, by a step of its own in the history (and the redo
// branch lost). The editor's own handler deletes a selection that spans lines when a composition
// starts, so the selection is collapsed before it runs (a capturing listener).

import { EditorSelection } from '@codemirror/state';
import { type EditorView, ViewPlugin } from '@codemirror/view';
import { editGroupAnnotation } from '../tracked/typing.ts';
import { type Rect, cellOfRef, cellsOfRect, clearedCells, rectOf, reselect } from './cells.ts';
import { tablesField } from './model.ts';

/** What was selected when the composition started. */
interface Held {
  rect: Rect;
  /** The first cell's text then, which the composed text is in front of. */
  old: string;
}

/** How long after the composition ends the clearing waits: the editor finishes the composed text in
 * a timer of its own, and the clearing comes after it. */
const SETTLE_MS = 30;
const SETTLE_TRIES = 20;

export const composeOverCells = ViewPlugin.fromClass(
  class {
    readonly view: EditorView;
    held: Held | null = null;
    timer: ReturnType<typeof setTimeout> | undefined;

    constructor(view: EditorView) {
      this.view = view;
      // Before the editor's own handler, which on starting a composition over a selection that spans
      // lines deletes the selection: a listener in the capture phase on an ancestor runs first.
      view.dom.addEventListener('compositionstart', this.start, true);
    }

    readonly start = () => this.begin();

    begin(): void {
      const { view } = this;
      const rect = rectOf(view.state);
      if (!rect) return;
      const first = cellsOfRect(rect)[0];
      if (!first) return;
      this.held = { rect, old: view.state.sliceDoc(first.textFrom, first.textTo) };
      view.dispatch({ selection: EditorSelection.cursor(first.textFrom) });
    }

    end(): void {
      if (!this.held) return;
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.settle(0), SETTLE_MS);
    }

    settle(tries: number): void {
      if (!this.held) return;
      if (this.view.composing && tries < SETTLE_TRIES) {
        this.timer = setTimeout(() => this.settle(tries + 1), SETTLE_MS);
        return;
      }
      this.finish();
    }

    finish(): void {
      const { view } = this;
      const held = this.held;
      this.held = null;
      if (!held) return;
      const table = view.state.field(tablesField, false)?.find((t) => t.id === held.rect.table.id);
      if (!table) return;
      const rect: Rect = { ...held.rect, table };
      const first = cellOfRef(table, { row: rect.rows[0], col: rect.cols[0] });
      if (!first) return;
      const now = view.state.sliceDoc(first.textFrom, first.textTo);
      if (now === held.old) {
        // Nothing committed: the cells are as they were, and selected again.
        reselect(view, rect);
        return;
      }
      // Committed: the first cell's old text is after the composed text; the other cells go whole.
      const changes: { from: number; to: number }[] = [];
      for (const cell of cellsOfRect(rect)) {
        const from = cell === first ? cell.textTo - held.old.length : cell.textFrom;
        if (from < cell.textTo) changes.push({ from, to: cell.textTo });
      }
      if (changes.length === 0) return;
      view.dispatch({
        changes,
        // Typing, which history joins to the composition's step (the first cell's old text is
        // beside the composed text). Not a composition's own kind of event: the editor holds
        // those as text being composed, and a change across cells is not one.
        userEvent: 'input.type',
        annotations: [clearedCells.of(true), editGroupAnnotation.of(true)],
      });
    }

    destroy(): void {
      this.view.dom.removeEventListener('compositionstart', this.start, true);
      clearTimeout(this.timer);
    }
  },
  {
    eventHandlers: {
      compositionend() {
        this.end();
      },
    },
  },
);
