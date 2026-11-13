import { isolateHistory } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { syntaxTree } from '@codemirror/language';
import {
  type ChangeSet,
  Compartment,
  EditorSelection,
  EditorState,
  type Extension,
  type StateEffect,
  type Text,
  Transaction,
} from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { GFM } from '@lezer/markdown';
import {
  accept as acceptChange,
  acceptMarks,
  EditError,
  reject as rejectChange,
  rejectMarks,
  setTracking as trackingInFile,
  setView as viewInFile,
  type TextChange,
} from '@redlines/format';
import type {
  Author,
  Editor,
  EditorOptions,
  MetPerson,
  EditorTyping,
  EditorUiState,
  MarkupView,
  ViewMode,
} from './api.ts';
import {
  activeCommands,
  commandTitles,
  createCommandRegistry,
  enabledCommands,
} from './commands.ts';
import { followText } from './anchor.ts';
import { frontMatter } from './blocks/front-matter.ts';
import { blockKeys } from './blocks/keys.ts';
import { openBlocks, throughOpen } from './blocks/open.ts';
import { emptyLineTyping } from './blocks/shift-line.ts';
import { typedSyntax } from './blocks/typed.ts';
import { lineChanges } from './diff.ts';
import {
  agentStep,
  joinsNewestStep,
  redoDepth,
  redoHasSomething,
  redoName,
  redoSayingWhy,
  refusedStep,
  startOver,
  undoDepth,
  undoHistory,
  undoHasSomething,
  undoKeys,
  undoName,
  undoSayingWhy,
} from './history/index.ts';
import { fileText, type LoadedFile, loadFile } from './line-breaks.ts';
import { markdownPreview } from './preview/decorations.ts';
import { tableKeymap } from './table/keys.ts';
import { tableMouse } from './table/mouse.ts';
import { tableReach } from './table/reach.ts';
import { tableWidths } from './table/widths.ts';
import { tableGhosts } from './table/ghosts.ts';
import { tableLayout } from './table/layout.ts';
import { tableStops } from './table/stops.ts';
import { imageResolver, refreshImagesEffect } from './preview/image.ts';
import { baseTheme } from './preview/theme.ts';
import { barSwitch } from './tracked/bar-switch.ts';
import { caretKeys } from './tracked/caret.ts';
import { clipboard, plainPastes } from './tracked/clipboard.ts';
import { unmetIn } from './tracked/colors.ts';
import { trackedChanges, visibleSelection } from './tracked/decorations.ts';
import { breakCorrection } from './tracked/break-correction.ts';
import { typingExtensions } from './tracked/smart-typing.ts';
import {
  authorFacet,
  chooseViewEffects,
  hasRedlines,
  isChange,
  lineBreakMarksFacet,
  markupViewCompartment,
  markupViewFacet,
  parsedField,
  peopleFacet,
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
export { followText } from './anchor.ts';
export { agentOf, followsText, redo, redoDepth, undo, undoDepth } from './history/index.ts';
export { lineChanges } from './diff.ts';
export { assignColors, colorsOf, meetPeople } from './tracked/colors.ts';
export { checkBoxEffect, type CheckBoxRequest } from './preview/task.ts';
export { indentItems } from './blocks/keys.ts';
export { barClickHandlers } from './tracked/bar-switch.ts';
export { pastHidden } from './tracked/decorations.ts';
export {
  alignCols,
  caretAlign,
  colCount,
  colTitles,
  deleteCols,
  deleteRows,
  insertColsAt,
  insertCols,
  insertRowBelow,
  insertRows,
  insertRowsAt,
  moveCols,
  moveColsTo,
  moveRows,
  moveRowsTo,
  rowCount,
  rowTitles,
  touchedCols,
  touchedRows,
} from './table/ops.ts';
export { tablesOf } from './table/model.ts';
export { clearCells, rectSelection } from './table/cells.ts';
export type { Cell as TableCell, Row as TableRow, Table } from './table/model.ts';
export { headInTable, selectionInTable } from './table/stops.ts';
export {
  type Rect as TableRect,
  type Scope as TableScope,
  commentRangeOfRect,
  rectOf,
  selectRect,
  selectedCells,
  whole as wholeRect,
} from './table/cells.ts';
export {
  boxChange,
  chooseViewEffects,
  isChange,
  markupViewFacet,
  parsedField,
  setViewModeEffect,
  trackedEditAnnotation,
  viewModeField,
} from './tracked/field.ts';
export { baseTitle } from './commands.ts';
export { refusedEditEffect, setTrackingEffect, trackingField } from './tracked/typing.ts';

const sameIds = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id, i) => id === b[i]);

const sameTitles = (a: Readonly<Record<string, string>>, b: Readonly<Record<string, string>>) => {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
};

/** Whether the host has been told everything in `b` already. */
const sameUi = (a: EditorUiState, b: EditorUiState) =>
  a.view === b.view &&
  a.markupView === b.markupView &&
  a.tracking === b.tracking &&
  a.hasRedlines === b.hasRedlines &&
  a.changes.length === b.changes.length &&
  a.changes.every((mark, i) => mark.id === b.changes[i]?.id) &&
  sameIds(a.activeCommands, b.activeCommands) &&
  sameIds(a.enabledCommands, b.enabledCommands) &&
  sameTitles(a.commandTitles, b.commandTitles) &&
  a.undo === b.undo &&
  a.redo === b.redo &&
  a.canUndo === b.canUndo &&
  a.canRedo === b.canRedo;

/**
 * Mounts a Markdown editor in `parent`: the live preview, with tracked changes and comments shown
 * in the Clean, Redlines and Raw views, Track Changes, copy and paste of the text as it reads, and
 * undo.
 */
export function createEditor(parent: HTMLElement, options: EditorOptions): Editor {
  /**
   * Who edits, how typing helps and whether line breaks show their marks: they change while the
   * editor lives, and survive `setDoc`.
   */
  const authorCompartment = new Compartment();
  const peopleCompartment = new Compartment();
  const typingCompartment = new Compartment();
  const lineBreakMarksCompartment = new Compartment();
  let author = options.author;
  let people = options.people;
  let lineBreakMarks = options.showLineBreakMarks ?? false;
  const saveTracking = options.saveTracking ?? false;
  /** The markup view chosen last, kept across `setDoc` (a choice reaches it through the state). */
  let markupView: MarkupView = options.markupView ?? 'redlines';
  let destroyed = false;
  /** The file's text the host was last told of, through `onChange`. */
  let told: string | null = null;
  /** Whom the host was asked about, so that it is asked once, and a record it ignores is no loop. */
  const asked = new Set<string>();
  let typing = options.typing;
  const typingNow = () => (typing ? typingExtensions(typing) : []);
  const extensions = [
    markdown({ extensions: [GFM, frontMatter], codeLanguages: options.codeLanguages }),
    trackedChanges(),
    barSwitch({ ...(options.viewKeys ? { keys: options.viewKeys } : {}) }),
    trackedTyping(),
    openBlocks(),
    emptyLineTyping,
    typedSyntax,
    tableKeymap(),
    blockKeys(),
    // After the keys, which it watches the break of, as an update listener.
    breakCorrection(options.correctWord, () => typing?.spellCheck === true),
    clipboard(),
    caretKeys,
    markdownPreview(),
    tableLayout(),
    tableGhosts(),
    tableStops(),
    tableMouse(),
    tableReach(),
    tableWidths(),
    options.resolveImage ? imageResolver.of(options.resolveImage) : [],
    undoHistory(),
    keymap.of([...editingKeymap, ...undoKeys(options.onNothingToUndo)]),
    baseTheme,
    EditorView.lineWrapping,
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        // A Return alone, which opens an empty paragraph the file never gets, changes nothing the
        // host keeps.
        const text = fileText(update.state);
        if (text !== told) {
          told = text;
          options.onChange?.(text);
        }
        tellNewPeople();
      }
      for (const tr of update.transactions) {
        for (const effect of tr.effects) {
          if (effect.is(refusedEditEffect)) options.onNotice?.(effect.value);
        }
      }
      const { startState, state } = update;
      markupView = state.facet(markupViewFacet);
      const viewChanged =
        startState.field(viewModeField) !== state.field(viewModeField) ||
        startState.facet(markupViewFacet) !== markupView;
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
        markupViewCompartment.of(markupViewFacet.of(markupView)),
        view ? viewModeField.init(() => view) : [],
        tracking === undefined ? [] : trackingField.init(() => tracking),
        extensions,
        addedCompartment.of(addedExtensions()),
        authorCompartment.of(authorFacet.of(author)),
        peopleCompartment.of(people ? peopleFacet.of(people) : []),
        typingCompartment.of(typingNow()),
        lineBreakMarksCompartment.of(lineBreakMarksFacet.of(lineBreakMarks)),
      ],
    });
    const selection = visibleSelection(state);
    return selection === state.selection ? state : state.update({ selection }).state;
  };
  const initial = stateFor(loadFile(options.doc), options.view, options.tracking);
  told = fileText(initial);
  const commands = createCommandRegistry(() => editor, report);
  const uiFor = (state: EditorState): EditorUiState => {
    const parsed = state.field(parsedField);
    return {
      view: state.field(viewModeField),
      markupView: state.facet(markupViewFacet),
      tracking: state.field(trackingField),
      hasRedlines: hasRedlines(parsed),
      changes: parsed.marks.filter(isChange),
      activeCommands: activeCommands(commands.list(), state),
      enabledCommands: enabledCommands(commands.list(), state),
      commandTitles: commandTitles(commands.list(), state),
      undo: undoName(state),
      redo: redoName(state),
      canUndo: undoHasSomething(state),
      canRedo: redoHasSomething(state),
    };
  };
  let reported = uiFor(initial);
  const view = new EditorView({
    parent,
    state: initial,
    // An undo or redo that would break the file doesn't happen, and says why (see history/guard.ts).
    dispatchTransactions: (transactions, view) => {
      const refused = transactions.map(refusedStep).find((reason) => reason !== null);
      if (!refused) view.update(transactions);
      else view.update([view.state.update({ effects: refusedEditEffect.of(refused) })]);
    },
  });
  /** Asks the host to record the people of the document that its record lacks. */
  function tellNewPeople(): void {
    if (destroyed || !people || !options.onNewPeople) return;
    const handles = unmetIn(view.state.field(parsedField), author.handle, people).filter(
      (handle) => !asked.has(handle),
    );
    if (!handles.length) return;
    for (const handle of handles) asked.add(handle);
    options.onNewPeople(handles);
  }
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
    getDoc: () => fileText(view.state),
    setDoc: (doc) => {
      view.setState(stateFor(loadFile(doc)));
      told = fileText(view.state);
      report();
      tellNewPeople();
    },
    reloadDoc: (doc) => {
      const next = loadFile(doc);
      const { state } = view;
      const { changes, selection, effects } = newVersion(state, next.doc);
      // A change to the line breaks alone leaves the document's text as it was, but not the file's.
      const changed = !changes.empty || next.text !== fileText(state);
      view.dispatch({
        changes,
        selection,
        // The steps to undo and redo were made to the old version, its line breaks included: the
        // history starts over.
        effects: changed ? [...next.effects, ...effects, ...startOver(state)] : next.effects,
        // Not an edit to undo, and not typing: Track Changes leaves it alone.
        annotations: [Transaction.addToHistory.of(false), Transaction.remote.of(true)],
        userEvent: 'reload',
      });
    },
    applyAgentEdit: (doc, step) => {
      if (doc === fileText(view.state)) return;
      const next = loadFile(doc);
      const { state } = view;
      const { changes, selection, effects } = newVersion(state, next.doc);
      view.dispatch({
        changes,
        selection,
        // The file and its line breaks, which the history gives back with the step.
        effects: [...next.effects, ...effects],
        // A step of the agent's, which Track Changes leaves as the agent wrote it.
        annotations: [agentStep.of(step), trackedEditAnnotation.of(true)],
      });
    },
    getParsed: () => view.state.field(parsedField),
    getUiState: () => uiFor(view.state),
    setViewMode: (mode) => view.dispatch({ effects: chooseViewEffects(mode) }),
    setMarkupView: (mode) => {
      if (mode === view.state.facet(markupViewFacet)) return;
      view.dispatch({ effects: markupViewCompartment.reconfigure(markupViewFacet.of(mode)) });
    },
    setTracking: (on) => {
      if (!saveTracking) {
        view.dispatch({ effects: setTrackingEffect.of(on) });
        return true;
      }
      let changes: TextChange[];
      try {
        changes = trackingInFile(view.state.doc.toString(), on);
      } catch (error) {
        if (!(error instanceof EditError)) throw error;
        // The file can't take the setting: Track Changes stays as it was, and says why.
        options.onNotice?.(error.message);
        return false;
      }
      view.dispatch({
        changes,
        effects: setTrackingEffect.of(on),
        // A step of its own, apart from the typing around it, that Undo takes back with Track
        // Changes itself (`trackingInverse`); not typing, which Track Changes would rewrite.
        annotations: [trackedEditAnnotation.of(true), isolateHistory.of('full')],
        userEvent: 'track.switch',
      });
      return true;
    },
    recordView: () => {
      const shown = view.state.field(viewModeField);
      // Raw is never saved: the file keeps the view it had. Simple is a markup view, as Redlines is.
      if (shown === 'raw') return;
      const changes = viewInFile(
        view.state.doc.toString(),
        shown === 'clean' ? 'clean' : 'redlines',
      );
      if (!changes.length) return;
      const { state } = view;
      // With steps to redo, a change would drop them, and made outside the history it would put
      // the ledger out of step with theirs: the next save records the view.
      if (redoDepth(state) > 0) return;
      view.dispatch({
        changes,
        // Joined to the newest step, so that Undo gives it back with the step, and no step is
        // left that undoes nothing a person can see; with none, outside the history, which has no
        // step to put out of step. What comes after is a step of its own.
        annotations: [
          trackedEditAnnotation.of(true),
          ...(undoDepth(state) > 0
            ? [joinsNewestStep.of(true), isolateHistory.of('after')]
            : [Transaction.addToHistory.of(false)]),
        ],
      });
    },
    setTyping: (next: EditorTyping) => {
      typing = next;
      view.dispatch({ effects: typingCompartment.reconfigure(typingNow()) });
    },
    setShowLineBreakMarks: (show) => {
      // As when another setting changed: nothing to redraw.
      if (show === lineBreakMarks) return;
      lineBreakMarks = show;
      view.dispatch({
        effects: lineBreakMarksCompartment.reconfigure(lineBreakMarksFacet.of(show)),
      });
    },
    setAuthor: (next: Author) => {
      author = next;
      view.dispatch({ effects: authorCompartment.reconfigure(authorFacet.of(author)) });
    },
    setPeople: (next) => {
      // The same people again, as when another setting changed: nothing to redraw.
      const same = (a: MetPerson, i: number) =>
        a.handle === people?.[i]?.handle && a.color === people[i]?.color;
      if (people && people.length === next.length && next.every(same)) return;
      people = next;
      // A person the host still lacks (another window's write won a race) is asked about again.
      const known = new Set(next.map(({ handle }) => handle));
      for (const handle of asked) if (!known.has(handle)) asked.delete(handle);
      view.dispatch({ effects: peopleCompartment.reconfigure(peopleFacet.of(next)) });
      tellNewPeople();
    },
    accept: (id) => {
      const text = view.state.doc.toString();
      decide(typeof id === 'string' ? acceptChange(text, id) : acceptMarks(text, id), 'accept');
    },
    reject: (id) => {
      const text = view.state.doc.toString();
      decide(typeof id === 'string' ? rejectChange(text, id) : rejectMarks(text, id), 'reject');
    },
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
    undo: () => {
      const done = undoSayingWhy(view);
      if (!done) options.onNothingToUndo?.(false);
      return done;
    },
    redo: () => {
      const done = redoSayingWhy(view);
      if (!done) options.onNothingToUndo?.(true);
      return done;
    },
    pastePlain: (text) => {
      if (!text) return;
      // With focus in a box of another part of the page, a comment, the find field, a popover, the
      // text goes there; it is only the document's when the document has the focus or nothing does.
      if (pasteIntoField(view, text)) return;
      // A paste event of its own, so that the text takes the way a paste takes (clipboard.ts).
      const clipboardData = new DataTransfer();
      clipboardData.setData('text/plain', text);
      view.focus();
      const event = new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true });
      plainPastes.add(event);
      view.contentDOM.dispatchEvent(event);
    },
    refreshImages: () => view.dispatch({ effects: refreshImagesEffect.of(null) }),
    focus: () => view.focus(),
    destroy: () => {
      destroyed = true;
      view.destroy();
    },
  };
  // After `createEditor` returns, so that a host may hand the record back with `editor.setPeople`.
  queueMicrotask(tellNewPeople);
  return editor;
}

/**
 * What a new version of the file does to the document (a reload, an agent's edit): its changes,
 * diffed by line, and where the selection goes. While an empty paragraph is open, the diff is
 * against the text without it, which the file had, and the open block is kept where it was when it
 * can be (`throughOpen`).
 */
function newVersion(
  state: EditorState,
  next: Text,
): { changes: ChangeSet; selection: EditorSelection; effects: StateEffect<unknown>[] } {
  const open = throughOpen(state, next);
  if (!open) {
    const changes = state.changes(lineChanges(state.doc.toString(), next.toString()));
    return { changes, selection: keptSelection(state, changes, next), effects: [] };
  }
  const after = open.changes.apply(state.doc);
  const selection = open.selection ?? keptSelection(state, open.changes, after);
  return { changes: open.changes, selection, effects: open.effects };
}

/**
 * The selection through a change of the whole text (a reload, an agent's edit): where the text
 * stayed. Both ends of each range map the same way, so no range turns over, and a caret right
 * where text was inserted, as at the start of a line an agent added above, stays after it.
 */
function keptSelection(state: EditorState, changes: ChangeSet, next: Text): EditorSelection {
  return EditorSelection.create(
    state.selection.ranges.map((range) => {
      // A selection whose text the change left alone keeps that text, whatever changed around it
      // in its line.
      const kept = followText(changes, state.doc, next, range);
      if (kept) {
        return range.anchor <= range.head
          ? EditorSelection.range(kept.from, kept.to)
          : EditorSelection.range(kept.to, kept.from);
      }
      return EditorSelection.range(changes.mapPos(range.anchor, 1), changes.mapPos(range.head, 1));
    }),
    state.selection.mainIndex,
  );
}

/**
 * Puts `text` in the text box that has the focus, when it is not the editor's own: at its
 * selection, as typing would, with an `input` event so that the box's own handlers see it.
 */
function pasteIntoField(view: EditorView, text: string): boolean {
  const active = view.dom.ownerDocument.activeElement;
  if (!active || view.contentDOM.contains(active)) return false;
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
    if (active.readOnly || active.disabled) return true;
    const start = active.selectionStart ?? active.value.length;
    const end = active.selectionEnd ?? start;
    try {
      active.setRangeText(text, start, end, 'end');
    } catch {
      // An input of a kind that has no selection (a number, say): nothing to insert into.
      return true;
    }
    active.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }
  if (active instanceof HTMLElement && active.isContentEditable) {
    active.ownerDocument.execCommand('insertText', false, text);
    return true;
  }
  return false;
}
