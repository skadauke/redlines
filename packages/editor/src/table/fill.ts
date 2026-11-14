// Writing a cell its row lacks (design: tables, "Edge cases": "typing into a missing cell writes its pipes
// first, plain, as rule 7 does"; format §3.7, "A cell a row lacks"). The caret can be in such a cell
// (`missing.ts`), and nothing is written until the person types there. Then the pipes it needs are
// written first, plain, in both versions, and the text after them, in one change and one step to undo:
// a filter turns the typing, the paste or the drop at the caret into the format's `fillCells` (which
// the format would otherwise refuse as a text after a row's last pipe, a cell GFM doesn't show).
//
// An input method that starts to compose there writes the pipes first (a step of its own, when the
// composition starts), so that the composed text is in a real cell, an empty one as any other, while
// the input method works on it; and a press on a cell that a row lacks puts the caret in it.

import { isolateHistory } from '@codemirror/commands';
import {
  ChangeSet,
  EditorSelection,
  EditorState,
  Prec,
  StateEffect,
  Transaction,
} from '@codemirror/state';
import { EditorView, ViewPlugin } from '@codemirror/view';
import type { TextChange } from '@redlines/format';
import {
  markupViewFacet,
  setViewModeEffect,
  trackedEditAnnotation,
  viewModeField,
} from '../tracked/field.ts';
import { refusedEditEffect, trackingField } from '../tracked/typing.ts';
import { annotationsOf, cellText } from './escape.ts';
import { cellAt } from './model.ts';
import { missingCaret, missingSpec, virtualCell } from './missing.ts';
import { plannedIn } from './ops.ts';

/** What a person does that puts text in at the caret: typing, pasting, dropping, a key's own input. */
const isTyped = (tr: Transaction) =>
  tr.isUserEvent('input') &&
  !tr.isUserEvent('input.type.compose') &&
  !tr.annotation(trackedEditAnnotation) &&
  !tr.annotation(Transaction.remote);

/**
 * Typing at the caret, in a cell its row lacks: the format's `fillCells`, tracked as Track Changes says,
 * in the one transaction. It runs before the table's guard (which would refuse text after a row's last
 * pipe) and before the tracked layer, which sees a change it has nothing to do with.
 */
const fillOnTyping = Prec.lowest(
  EditorState.transactionFilter.of((tr) => {
    if (!tr.docChanged || !isTyped(tr)) return tr;
    const start = tr.startState;
    const lacking = missingCaret(start);
    if (!lacking) return tr;
    // One insertion at the caret: what typing, pasting and dropping make.
    const { head } = start.selection.main;
    const edits: { from: number; to: number; text: string }[] = [];
    tr.changes.iterChanges((from, to, _fromB, _toB, inserted) => {
      edits.push({ from, to, text: inserted.toString() });
    });
    const [change] = edits;
    if (
      edits.length !== 1 ||
      !change ||
      change.from !== head ||
      change.to !== head ||
      !change.text
    ) {
      return tr;
    }
    // The text as a cell holds it: a pipe escaped, a line break a `<br>`, a tab a space.
    const typed = change.text.replaceAll('\t', ' ');
    const text = cellText('', typed);
    const done = plannedIn(start, {
      kind: 'fillCells',
      table: lacking.table.from,
      row: lacking.row.index,
      col: lacking.cell.col,
      text,
    });
    if ('refusal' in done) return { effects: refusedEditEffect.of(done.refusal) };
    const changes = ChangeSet.of(done.changes, start.doc.length);
    const mapping = tr.changes.invertedDesc.composeDesc(changes.desc);
    const tracked = start.field(trackingField);
    // The caret stands where the typing put it in what was typed, as in a pair of brackets that a help
    // while typing wrote (the text, escaped as it is written, is the same length in front of it).
    const inside = tr.newSelection.main.head - head;
    const back =
      inside >= 0 && inside < typed.length
        ? text.length - cellText('', typed.slice(0, inside)).length
        : 0;
    return {
      changes,
      selection: EditorSelection.cursor(done.caret - back),
      effects: [
        ...StateEffect.mapEffects(tr.effects, mapping),
        // A tracked change made in Clean shows in the markup view, as typing's do.
        ...(tracked && start.field(viewModeField) === 'clean'
          ? [setViewModeEffect.of(start.facet(markupViewFacet))]
          : []),
      ],
      annotations: [...annotationsOf(tr), trackedEditAnnotation.of(true)],
      scrollIntoView: tr.scrollIntoView,
    };
  }),
);

/**
 * An input method that starts to compose with the caret in a cell its row lacks: the pipes are written
 * first, plain, as a step of their own, and the caret goes to the cell now there, so that the input
 * method composes in an empty cell as in any other. The listener is in the capture phase, as
 * `compose.ts`'s is, before the editor's own handler.
 */
const fillOnCompose = ViewPlugin.fromClass(
  class {
    readonly view: EditorView;

    constructor(view: EditorView) {
      this.view = view;
      view.dom.addEventListener('compositionstart', this.start, true);
    }

    readonly start = () => this.begin();

    begin(): void {
      const { view } = this;
      const lacking = missingCaret(view.state);
      if (!lacking) return;
      const done = plannedIn(view.state, {
        kind: 'fillCells',
        table: lacking.table.from,
        row: lacking.row.index,
        col: lacking.cell.col,
      });
      if ('refusal' in done) {
        view.dispatch({ effects: refusedEditEffect.of(done.refusal) });
        return;
      }
      view.dispatch({
        changes: done.changes.map(({ from, to, insert }: TextChange) => ({ from, to, insert })),
        selection: EditorSelection.cursor(done.caret),
        // No mark and no ledger entry, whatever Track Changes says: the pipes are no change.
        annotations: [trackedEditAnnotation.of(true), isolateHistory.of('full')],
        userEvent: 'table.fill',
        scrollIntoView: true,
      });
    }

    destroy(): void {
      this.view.dom.removeEventListener('compositionstart', this.start, true);
    }
  },
);

/** A press on a cell a row lacks: the caret goes to the end of the row, in that cell. */
const pressOnMissing = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (event.button !== 0 || event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) {
      return false;
    }
    if (view.state.field(viewModeField, false) === 'raw') return false;
    const element = event.target instanceof Element ? event.target.closest('.rl-tc-missing') : null;
    const line = element?.closest<HTMLElement>('.cm-line');
    if (!element || !line) return false;
    const found = cellAt(view.state, view.posAtDOM(line, 0));
    const col = Number((element as HTMLElement).dataset['col']);
    if (
      !found ||
      found.row.header ||
      !(col >= found.row.cells.length && col < found.table.columns)
    ) {
      return false;
    }
    event.preventDefault();
    view.focus();
    view.dispatch(missingSpec(virtualCell(found.row, col), 'select.pointer'));
    return true;
  },
});

/** Typing into the cells a row lacks, an input method composing there, and a press on one. */
export function tableFill() {
  return [fillOnTyping, fillOnCompose, pressOnMissing];
}
