import { defaultKeymap, history, historyKeymap, isolateHistory } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { EditorSelection, EditorState, Transaction } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { GFM } from '@lezer/markdown';
import { accept as acceptChange, reject as rejectChange, type TextChange } from '@redlines/format';
import type { Editor, EditorOptions, EditorUiState, ViewMode } from './api.ts';
import { lineChanges } from './diff.ts';
import { fileText, type LoadedFile, loadFile } from './line-breaks.ts';
import { markdownPreview } from './preview/decorations.ts';
import { baseTheme } from './preview/theme.ts';
import { caretKeys } from './tracked/caret.ts';
import { trackedChanges, visibleSelection } from './tracked/decorations.ts';
import {
  authorFacet,
  hasRedlines,
  isChange,
  parsedField,
  setViewModeEffect,
  trackedEditAnnotation,
  viewModeField,
} from './tracked/field.ts';
import {
  refusedEditEffect,
  setTrackingEffect,
  trackedTyping,
  trackingField,
} from './tracked/typing.ts';

export type * from './api.ts';
export { assignColors } from './tracked/colors.ts';
export { parsedField, setViewModeEffect, viewModeField } from './tracked/field.ts';
export { setTrackingEffect, trackingField } from './tracked/typing.ts';

/** Whether the host has been told everything in `b` already. */
const sameUi = (a: EditorUiState, b: EditorUiState) =>
  a.view === b.view &&
  a.tracking === b.tracking &&
  a.hasRedlines === b.hasRedlines &&
  a.changes.length === b.changes.length &&
  a.changes.every((mark, i) => mark.id === b.changes[i]?.id);

/**
 * Mounts a Markdown editor in `parent`: the live preview, with tracked changes and comments shown
 * in the Clean, Redlines and Raw views, Track Changes, and undo.
 */
export function createEditor(parent: HTMLElement, options: EditorOptions): Editor {
  let file = loadFile(options.doc);
  const extensions = [
    markdown({ extensions: GFM }),
    trackedChanges(),
    trackedTyping(),
    caretKeys,
    markdownPreview(),
    history(),
    keymap.of([...defaultKeymap, ...historyKeymap]),
    authorFacet.of(options.author),
    baseTheme,
    EditorView.lineWrapping,
    EditorView.updateListener.of((update) => {
      if (update.docChanged) options.onChange?.(fileText(file, update.state));
      for (const tr of update.transactions) {
        for (const effect of tr.effects) {
          if (effect.is(refusedEditEffect)) options.onNotice?.(effect.value);
        }
      }
      const { startState, state } = update;
      const viewChanged = startState.field(viewModeField) !== state.field(viewModeField);
      const trackingChanged = startState.field(trackingField) !== state.field(trackingField);
      if (update.docChanged || viewChanged || trackingChanged) report();
    }),
    options.extensions ?? [],
  ];
  /** A state for a loaded file, shown and tracked as given, or by default as its document asks. */
  const stateFor = (loaded: LoadedFile, view?: ViewMode, tracking?: boolean) => {
    const state = EditorState.create({
      doc: loaded.doc,
      extensions: [
        loaded.extension,
        view ? viewModeField.init(() => view) : [],
        tracking === undefined ? [] : trackingField.init(() => tracking),
        extensions,
      ],
    });
    const selection = visibleSelection(state);
    return selection === state.selection ? state : state.update({ selection }).state;
  };
  const initial = stateFor(file, options.view, options.tracking);
  const uiFor = (state: EditorState): EditorUiState => {
    const parsed = state.field(parsedField);
    return {
      view: state.field(viewModeField),
      tracking: state.field(trackingField),
      hasRedlines: hasRedlines(parsed),
      changes: parsed.marks.filter(isChange),
    };
  };
  let reported = uiFor(initial);
  const view = new EditorView({ parent, state: initial });
  /** Tells the host when the view, tracking or the pending changes have changed. */
  function report(): void {
    const ui = uiFor(view.state);
    if (sameUi(ui, reported)) return;
    reported = ui;
    options.onUiState?.(ui);
  }
  /** Applies a decision as one step to undo, apart from the typing around it. */
  const decide = (changes: TextChange[], userEvent: string) => {
    if (!changes.length) return;
    view.dispatch({
      changes,
      annotations: [trackedEditAnnotation.of(true), isolateHistory.of('full')],
      userEvent,
    });
  };

  return {
    view,
    getDoc: () => fileText(file, view.state),
    setDoc: (doc) => {
      file = loadFile(doc);
      view.setState(stateFor(file));
      report();
    },
    reloadDoc: (doc) => {
      const next = loadFile(doc);
      const { state } = view;
      const changes = state.changes(lineChanges(state.doc.toString(), next.doc.toString()));
      // Both ends of each range map the same way, so no range turns over, and a caret right
      // where text was inserted, as at the start of a line an agent added above, stays after it.
      const selection = EditorSelection.create(
        state.selection.ranges.map((range) =>
          EditorSelection.range(changes.mapPos(range.anchor, 1), changes.mapPos(range.head, 1)),
        ),
        state.selection.mainIndex,
      );
      // First, because the change reports the file's text, which is the new file's now.
      file = next;
      view.dispatch({
        changes,
        selection,
        effects: next.reset,
        // Not an edit to undo, and not typing: Track Changes leaves it alone.
        annotations: [Transaction.addToHistory.of(false), Transaction.remote.of(true)],
        userEvent: 'reload',
      });
    },
    getParsed: () => view.state.field(parsedField),
    getUiState: () => uiFor(view.state),
    setViewMode: (mode) => view.dispatch({ effects: setViewModeEffect.of(mode) }),
    setTracking: (on) => view.dispatch({ effects: setTrackingEffect.of(on) }),
    accept: (id) => decide(acceptChange(view.state.doc.toString(), id), 'accept'),
    reject: (id) => decide(rejectChange(view.state.doc.toString(), id), 'reject'),
    focus: () => view.focus(),
    destroy: () => view.destroy(),
  };
}
