// Text that goes into a cell (design: tables, "The caret and the keys", Typing; "The pointer", Drop
// text on a cell): a pipe is written `\|`, so it starts no cell, and a line break `<br>`. A filter
// that runs before the tracked layer turns what a person types, pastes or drops into a cell into
// the text that belongs in one; the tracked layer then records that as it records any typing.

import {
  type Annotation,
  ChangeSet,
  EditorSelection,
  EditorState,
  Prec,
  type Transaction,
} from '@codemirror/state';
import { trackedEditAnnotation, viewModeField } from '../tracked/field.ts';
import { composedTextFacet } from '../tracked/typing.ts';
import { tablesField } from './model.ts';
import { shownCellAt } from './stops.ts';

/**
 * `text` as it goes into a cell after `before`, the cell's text in front of it: every pipe that
 * would start a cell is escaped (one that a backslash escapes already is left), and a line break
 * is a `<br>`.
 */
export function cellText(before: string, text: string): string {
  let slashes = /\\*$/.exec(before)?.[0].length ?? 0;
  let out = '';
  for (const char of text.replaceAll('\r\n', '\n').replaceAll('\r', '\n')) {
    if (char === '|') {
      out += slashes % 2 === 1 ? '|' : '\\|';
      slashes = 0;
    } else if (char === '\n') {
      out += '<br>';
      slashes = 0;
    } else {
      slashes = char === '\\' ? slashes + 1 : 0;
      out += char;
    }
  }
  return out;
}

/** What a person does that puts text in: typing, pasting, dropping and the keyboard's own input. */
const isInput = (tr: Transaction) =>
  ['input', 'move'].some((event) => tr.isUserEvent(event)) &&
  !tr.isUserEvent('input.type.compose') &&
  !tr.annotation(trackedEditAnnotation);

/** A transaction's annotations, as the typing layer reads them. */
function annotationsOf(tr: Transaction): Annotation<unknown>[] {
  return [
    ...((tr as unknown as { annotations?: readonly Annotation<unknown>[] }).annotations ?? []),
  ];
}

const escapeFilter = Prec.lowest(
  EditorState.transactionFilter.of((tr) => {
    const start = tr.startState;
    if (!tr.docChanged || !isInput(tr) || start.field(viewModeField, false) === 'raw') return tr;
    if (!(start.field(tablesField, false) ?? []).length) return tr;
    const edits: { from: number; to: number; insert: string }[] = [];
    let changed = false;
    tr.changes.iterChanges((from, to, _fromB, _toB, inserted) => {
      let insert = inserted.toString();
      const found = shownCellAt(start, from);
      const within = found && found.cell.textFrom <= from && to <= found.cell.textTo;
      if (within && /[|\r\n]/.test(insert)) {
        const next = cellText(start.sliceDoc(found.cell.textFrom, from), insert);
        if (next !== insert) {
          changed = true;
          insert = next;
        }
      }
      edits.push({ from, to, insert });
    });
    if (!changed) return tr;
    const changes = ChangeSet.of(edits, start.doc.length);
    // The caret that followed what was typed follows what is written instead.
    const mapping = tr.changes.invertedDesc.composeDesc(changes.desc);
    const head = tr.newSelection.main.head;
    let caret: number | null = null;
    tr.changes.iterChanges((_from, to, _fromB, toB) => {
      if (toB === head) caret = changes.mapPos(to, 1);
    });
    return {
      changes,
      selection: caret === null ? tr.newSelection.map(mapping) : EditorSelection.cursor(caret),
      effects: tr.effects,
      annotations: annotationsOf(tr),
      scrollIntoView: tr.scrollIntoView,
    };
  }),
);

/** Text an input method composed in a cell is written as the cell's text when it ends, as typed text
 * is: the composition itself is left alone while the input method works on it. */
const composition = composedTextFacet.of((state, from, text) => {
  if (!/[|\r\n]/.test(text) || state.field(viewModeField, false) === 'raw') return text;
  // The cell of the character before the composition: a composed pipe has split the cell at `from`,
  // and the one that starts there is a cell of the composed text.
  const found = shownCellAt(state, Math.max(0, from - 1));
  if (!found || from < found.cell.textFrom) return text;
  return cellText(state.sliceDoc(found.cell.textFrom, from), text);
});

/** Text that goes into a cell goes in as the cell's text. */
export const cellEscapes = [escapeFilter, composition];
