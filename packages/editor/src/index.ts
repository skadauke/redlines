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
import {
  accept as acceptChange,
  acceptMarks,
  reject as rejectChange,
  rejectMarks,
  type TextChange,
} from '@redlines/format';
import type {
  Author,
  Editor,
  EditorOptions,
  MetPerson,
  EditorTyping,
  EditorUiState,
  ViewMode,
} from './api.ts';
import { activeCommands, createCommandRegistry, enabledCommands } from './commands.ts';
import { followText } from './anchor.ts';
import { lineChanges } from './diff.ts';
import { refusedStep, startOver, undoHistory, undoKeymap } from './history.ts';
import { fileText, type LoadedFile, loadFile } from './line-breaks.ts';
import { markdownPreview } from './preview/decorations.ts';
import { imageResolver, refreshImagesEffect } from './preview/image.ts';
import { baseTheme } from './preview/theme.ts';
import { caretKeys } from './tracked/caret.ts';
import { clipboard } from './tracked/clipboard.ts';
import { unmetIn } from './tracked/colors.ts';
import { trackedChanges, visibleSelection } from './tracked/decorations.ts';
import { typingExtensions } from './tracked/smart-typing.ts';
import {
  authorFacet,
  hasRedlines,
  isChange,
  parsedField,
  peopleFacet,
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
export { followText } from './anchor.ts';
export { lineChanges } from './diff.ts';
export { assignColors, colorsOf, meetPeople } from './tracked/colors.ts';
export { checkBoxEffect, type CheckBoxRequest } from './preview/task.ts';
export { pastHidden } from './tracked/decorations.ts';
export {
  isChange,
  parsedField,
  setViewModeEffect,
  trackedEditAnnotation,
  viewModeField,
} from './tracked/field.ts';
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
  const peopleCompartment = new Compartment();
  const typingCompartment = new Compartment();
  let author = options.author;
  let people = options.people;
  let destroyed = false;
  /** Whom the host was asked about, so that it is asked once, and a record it ignores is no loop. */
  const asked = new Set<string>();
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
      if (update.docChanged) {
        options.onChange?.(fileText(file, update.state));
        tellNewPeople();
      }
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
        peopleCompartment.of(people ? peopleFacet.of(people) : []),
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
    getDoc: () => fileText(file, view.state),
    setDoc: (doc) => {
      file = loadFile(doc);
      view.setState(stateFor(file));
      report();
      tellNewPeople();
    },
    reloadDoc: (doc, by) => {
      const next = loadFile(doc);
      const { state } = view;
      const changes = state.changes(lineChanges(state.doc.toString(), next.doc.toString()));
      // Both ends of each range map the same way, so no range turns over, and a caret right
      // where text was inserted, as at the start of a line an agent added above, stays after it.
      const selection = EditorSelection.create(
        state.selection.ranges.map((range) => {
          // A selection whose text the reload left alone keeps that text, whatever changed around
          // it in its line.
          const kept = followText(changes, state.doc, next.doc, range);
          if (kept) {
            return range.anchor <= range.head
              ? EditorSelection.range(kept.from, kept.to)
              : EditorSelection.range(kept.to, kept.from);
          }
          return EditorSelection.range(
            changes.mapPos(range.anchor, 1),
            changes.mapPos(range.head, 1),
          );
        }),
        state.selection.mainIndex,
      );
      // First, because the change reports the file's text, which is the new file's now.
      file = next;
      view.dispatch({
        changes,
        selection,
        // The steps to undo and redo were made to the old version: the history starts over.
        effects: changes.empty ? [next.reset] : [next.reset, ...startOver(state, by)],
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
    pastePlain: (text) => {
      if (!text) return;
      // With focus in a box of another part of the page, a comment, the find field, a popover, the
      // text goes there; it is only the document's when the document has the focus or nothing does.
      if (pasteIntoField(view, text)) return;
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
