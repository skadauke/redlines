import { isolateHistory } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { syntaxTree } from '@codemirror/language';
import {
  Compartment,
  EditorSelection,
  EditorState,
  type Extension,
  Transaction,
} from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { GFM } from '@lezer/markdown';
import { accept as acceptChange, reject as rejectChange, type TextChange } from '@redlines/format';
import type {
  Author,
  Editor,
  EditorOptions,
  EditorTyping,
  EditorUiState,
  ViewMode,
} from './api.ts';
import { activeCommands, createCommandRegistry, enabledCommands } from './commands.ts';
import { lineChanges } from './diff.ts';
import { refusedStep, startOver, undoHistory, undoKeymap } from './history.ts';
import { fileText, type LoadedFile, loadFile } from './line-breaks.ts';
import { markdownPreview } from './preview/decorations.ts';
import { imageResolver, refreshImagesEffect } from './preview/image.ts';
import { baseTheme } from './preview/theme.ts';
import { caretKeys } from './tracked/caret.ts';
import { clipboard } from './tracked/clipboard.ts';
import { trackedChanges, visibleSelection } from './tracked/decorations.ts';
import { typingExtensions } from './tracked/smart-typing.ts';
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
  editingKeymap,
  refusedEditEffect,
  setTrackingEffect,
  trackedTyping,
  trackingField,
} from './tracked/typing.ts';

export type * from './api.ts';
export { assignColors } from './tracked/colors.ts';
export { pastHidden } from './tracked/decorations.ts';
export { isChange, parsedField, setViewModeEffect, viewModeField } from './tracked/field.ts';
export { refusedEditEffect, setTrackingEffect, trackingField } from './tracked/typing.ts';

const sameIds = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id, i) => id === b[i]);

/** Whether the host has been told everything in `b` already. */
const sameUi = (a: EditorUiState, b: EditorUiState) =>
  a.view === b.view &&
  a.tracking === b.tracking &&
  a.hasRedlines === b.hasRedlines &&
  a.changes.length === b.changes.length &&
  a.changes.every((mark, i) => mark.id === b.changes[i]?.id) &&
  sameIds(a.activeCommands, b.activeCommands) &&
  sameIds(a.enabledCommands, b.enabledCommands);

/**
 * Mounts a Markdown editor in `parent`: the live preview, with tracked changes and comments shown
 * in the Clean, Redlines and Raw views, Track Changes, copy and paste of the text as it reads, and
 * undo.
 */
export function createEditor(parent: HTMLElement, options: EditorOptions): Editor {
  let file = loadFile(options.doc);
  /** Who edits, and how typing helps: both change while the editor lives, and survive `setDoc`. */
  const authorCompartment = new Compartment();
  const typingCompartment = new Compartment();
  let author = options.author;
  let typing = options.typing;
  const typingNow = () => (typing ? typingExtensions(typing) : []);
  const extensions = [
    markdown({ extensions: GFM, codeLanguages: options.codeLanguages }),
    trackedChanges(),
    trackedTyping(),
    clipboard(),
    caretKeys,
    markdownPreview(),
    options.resolveImage ? imageResolver.of(options.resolveImage) : [],
    undoHistory(),
    keymap.of([...editingKeymap, ...undoKeymap]),
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
      // A command's state may read the syntax tree, which a background parse brings further along
      // in a transaction that changes nothing else.
      const parsedFurther = syntaxTree(startState) !== syntaxTree(state);
      if (
        update.docChanged ||
        update.selectionSet ||
        viewChanged ||
        trackingChanged ||
        parsedFurther
      )
        report();
    }),
    options.extensions ?? [],
  ];
  /** Extensions added after the editor was made (`addExtension`), each once, in order. */
  const addedCompartment = new Compartment();
  let added: { extension: Extension }[] = [];
  const addedExtensions = () => added.map((entry) => entry.extension);
  /** A state for a loaded file, shown and tracked as given, or by default as its document asks. */
  const stateFor = (loaded: LoadedFile, view?: ViewMode, tracking?: boolean) => {
    const state = EditorState.create({
      doc: loaded.doc,
      extensions: [
        loaded.extension,
        view ? viewModeField.init(() => view) : [],
        tracking === undefined ? [] : trackingField.init(() => tracking),
        extensions,
        addedCompartment.of(addedExtensions()),
        authorCompartment.of(authorFacet.of(author)),
        typingCompartment.of(typingNow()),
      ],
    });
    const selection = visibleSelection(state);
    return selection === state.selection ? state : state.update({ selection }).state;
  };
  const initial = stateFor(file, options.view, options.tracking);
  const commands = createCommandRegistry(() => editor, report);
  const uiFor = (state: EditorState): EditorUiState => {
    const parsed = state.field(parsedField);
    return {
      view: state.field(viewModeField),
      tracking: state.field(trackingField),
      hasRedlines: hasRedlines(parsed),
      changes: parsed.marks.filter(isChange),
      activeCommands: activeCommands(commands.list(), state),
      enabledCommands: enabledCommands(commands.list(), state),
    };
  };
  let reported = uiFor(initial);
  const view = new EditorView({
    parent,
    state: initial,
    // An undo or redo that would break the file doesn't happen, and says why (see history.ts).
    dispatchTransactions: (transactions, view) => {
      const refused = transactions.map(refusedStep).find((reason) => reason !== null);
      if (!refused) view.update(transactions);
      else view.update([view.state.update({ effects: refusedEditEffect.of(refused) })]);
    },
  });
  /** Tells the host when the view, tracking, the pending changes or a command's state changed. */
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

  const editor: Editor = {
    view,
    commands,
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
        // The steps to undo and redo were made to the old version: the history starts over.
        effects: changes.empty ? [next.reset] : [next.reset, ...startOver(state)],
        // Not an edit to undo, and not typing: Track Changes leaves it alone.
        annotations: [Transaction.addToHistory.of(false), Transaction.remote.of(true)],
        userEvent: 'reload',
      });
    },
    getParsed: () => view.state.field(parsedField),
    getUiState: () => uiFor(view.state),
    setViewMode: (mode) => view.dispatch({ effects: setViewModeEffect.of(mode) }),
    setTracking: (on) => view.dispatch({ effects: setTrackingEffect.of(on) }),
    setTyping: (next: EditorTyping) => {
      typing = next;
      view.dispatch({ effects: typingCompartment.reconfigure(typingNow()) });
    },
    setAuthor: (next: Author) => {
      author = next;
      view.dispatch({ effects: authorCompartment.reconfigure(authorFacet.of(author)) });
    },
    accept: (id) => decide(acceptChange(view.state.doc.toString(), id), 'accept'),
    reject: (id) => decide(rejectChange(view.state.doc.toString(), id), 'reject'),
    addExtension: (extension) => {
      const entry = { extension };
      added = [...added, entry];
      view.dispatch({ effects: addedCompartment.reconfigure(addedExtensions()) });
      return () => {
        if (!added.includes(entry)) return;
        added = added.filter((other) => other !== entry);
        view.dispatch({ effects: addedCompartment.reconfigure(addedExtensions()) });
      };
    },
    scrollToLine(line) {
      const { doc } = view.state;
      const { from } = doc.line(Math.min(Math.max(line, 1), doc.lines));
      // The line after the last line break is empty, and is the end of the document.
      view.dispatch({
        selection: { anchor: from },
        effects: EditorView.scrollIntoView(from, { y: 'start' }),
      });
    },
    pastePlain: (text) => {
      if (!text) return;
      // A paste event of its own, so that the text takes the way a paste takes (clipboard.ts).
      const clipboardData = new DataTransfer();
      clipboardData.setData('text/plain', text);
      view.focus();
      view.contentDOM.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }),
      );
    },
    refreshImages: () => view.dispatch({ effects: refreshImagesEffect.of(null) }),
    focus: () => view.focus(),
    destroy: () => view.destroy(),
  };
  return editor;
}
