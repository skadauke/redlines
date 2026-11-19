// The word count in the window's lower right corner (design §5.1): a small gray label that stays
// there while the person writes, "1,204 words", and with a selection "120 of 1,204 words". It
// counts what a reader sees, as the file name's hover facts do (the newest text, never the markers
// or the ledger), and on idle, a moment after the last change to the text, or a few frames after a moved selection, so that typing never waits for it and
// a long document stays fast. It sits on a fade of the page's color, as the title bar does at the
// top, so that text and notes that scroll under it never meet it, and what the editor scrolls to
// stops short of the fade. Preferences can hide it.

import type { Text } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { Editor } from '@redlines/editor';
import { newestView } from '@redlines/format';
import { wordCount } from './titlebar.ts';

/** How long after the last change to the text the words are counted. */
export const IDLE_MS = 150;

/** How long after a moved selection its words are counted: a drag is counted in steps of this. */
export const SELECTION_MS = 40;

/** What the label counts. */
interface Words {
  total: number;
  /** The words a selection covers, or null when nothing with a word in it is selected. */
  selected: number | null;
  /** The lines and characters, for the label's hover hint (#682). */
  parts: TextParts;
}

/** The lines and characters of what a reader sees, and of the selection, which is null when empty. */
export interface TextParts {
  lines: number;
  characters: number;
  selectedLines: number | null;
  selectedCharacters: number | null;
}

/** The lines of `text` (none for no text), and its characters, which a line break is not one of. */
function linesAndCharacters(text: string): { lines: number; characters: number } {
  if (text === '') return { lines: 0, characters: 0 };
  let lines = 1;
  let characters = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 10) lines++;
    // The low half of a pair is no character of its own.
    else if (code < 0xdc00 || code > 0xdfff) characters++;
  }
  return { lines, characters };
}

/** What a reader sees of a document: its newest view. */
type Newest = ReturnType<typeof newestView>;

/** What a reading of a document holds, counted. */
const counted = new WeakMap<object, { total: number; lines: number; characters: number }>();

/** The words of a document as a reader sees it, and of the selection `from` to `to` in its source. */
function wordsOf(view: Newest, selection: { from: number; to: number }): Words {
  // The whole text is counted once for each reading of it, not for each place the selection moves to.
  let whole = counted.get(view);
  if (!whole) {
    whole = { total: wordCount(view.text), ...linesAndCharacters(view.text) };
    counted.set(view, whole);
  }
  const { total, lines, characters } = whole;
  const parts: TextParts = { lines, characters, selectedLines: null, selectedCharacters: null };
  if (selection.from === selection.to) return { total, selected: null, parts };
  const from = view.map.fromSource(selection.from);
  const to = view.map.fromSource(selection.to);
  const chosen = view.text.slice(from, to);
  const inside = linesAndCharacters(chosen);
  if (inside.characters > 0) {
    parts.selectedLines = inside.lines;
    parts.selectedCharacters = inside.characters;
  }
  const selected = wordCount(chosen);
  return { total, selected: selected > 0 ? selected : null, parts };
}

/**
 * The words of `source`, a document with its markers and ledger, as a reader sees them, and of the
 * selection `from` to `to` in it, which is mapped to the same text.
 */
export function wordsIn(source: string, selection: { from: number; to: number }): Words {
  return wordsOf(newestView(source), selection);
}

/**
 * What an editor holds, counted: its text is read again only when it has changed, not for each
 * place the selection moves to. The selection is a place in the editor's own text, where every line
 * break is one character; the text `getDoc` gives is the file's, which has two for a CRLF. Counting
 * the file's text from the editor's places would slide each selection one character left for every
 * line break above it.
 */
function editorWords(view: EditorView): () => Words {
  let read: { doc: Text; newest: Newest } | null = null;
  return () => {
    const { doc, selection } = view.state;
    if (read?.doc !== doc) read = { doc, newest: newestView(doc.toString()) };
    return wordsOf(read.newest, selection.main);
  };
}

/** "1,204 words", or "120 of 1,204 words" with a selection. */
export function wordCountLabel(total: number, selected: number | null): string {
  const all = `${total.toLocaleString()} ${total === 1 ? 'word' : 'words'}`;
  return selected === null ? all : `${selected.toLocaleString()} of ${all}`;
}

/**
 * What hovering the label says, a count on each line: "12 lines" and "640 characters", and with a
 * selection "3 of 12 lines" and "120 of 640 characters".
 */
export function textPartsLabel(parts: TextParts): string {
  const n = (count: number, one: string) =>
    `${count.toLocaleString()} ${count === 1 ? one : `${one}s`}`;
  const of = (selected: number | null, total: number, one: string) =>
    selected === null ? n(total, one) : `${selected.toLocaleString()} of ${n(total, one)}`;
  return [
    of(parts.selectedLines, parts.lines, 'line'),
    of(parts.selectedCharacters, parts.characters, 'character'),
  ].join('\n');
}

interface WordCount {
  /**
   * The document changed (the default): counts once the changes stop. Only the selection changed
   * (`textChanged` false): counts after `SELECTION_MS`, since the text is already read, unless a
   * count is waiting, which then covers the selection too.
   */
  schedule(textChanged?: boolean): void;
  /**
   * A document has just opened: counts as soon as the page has drawn it, so that the label never
   * tells of the document before for as long as an idle wait.
   */
  refresh(): void;
  /** Shows the label and counts at once, or hides it and counts nothing. */
  setVisible(visible: boolean): void;
  /** How much of the page's lower edge the label's fade covers, in CSS px: none while it is hidden. */
  room(): number;
}

/**
 * Adds the label to `parent`, which the page's lower right corner is in, after what is there, so
 * that its fade is over the page. `source.count` is asked only while the label is shown, and after
 * the changes to the text have stopped for `IDLE_MS` (a moved selection, after `SELECTION_MS`). While it is shown the parent is marked `rl-has-footer`,
 * which the style sheet keeps what scrolls into view clear of the fade by.
 */
export function createWordCount(
  parent: HTMLElement,
  source: { count(): Words },
  options: { visible: boolean },
): WordCount {
  const footer = document.createElement('div');
  footer.className = 'rl-footer';
  const label = document.createElement('div');
  label.className = 'rl-word-count';
  footer.append(label);
  parent.append(footer);

  let visible = options.visible;
  footer.hidden = !visible;
  parent.classList.toggle('rl-has-footer', visible);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let waiting = false;

  const show = () => {
    const { total, selected, parts } = source.count();
    label.textContent = wordCountLabel(total, selected);
    // The app's hint style draws a title (ui/title-hints.ts, docs/widgets.md), as it does the others'.
    label.title = textPartsLabel(parts);
  };
  const later = (ms: number) => {
    clearTimeout(timer);
    waiting = true;
    timer = setTimeout(() => {
      waiting = false;
      show();
    }, ms);
  };

  return {
    schedule(textChanged = true) {
      if (!visible) return;
      if (textChanged) later(IDLE_MS);
      else if (!waiting) later(SELECTION_MS);
    },
    refresh() {
      clearTimeout(timer);
      waiting = false;
      if (visible) later(0);
    },
    setVisible(next) {
      if (next === visible) return;
      visible = next;
      waiting = false;
      footer.hidden = !next;
      parent.classList.toggle('rl-has-footer', next);
      clearTimeout(timer);
      if (next) show();
    },
    // Measured as drawn: the fade is in the page's px, which the window zoom changes.
    room: () => (visible ? footer.getBoundingClientRect().height : 0),
  };
}

/**
 * The word count of `editor`: the label in `parent`, counting what the editor holds, on idle after
 * its text changes, and a moment after its selection does (a document that opens is `refresh`ed by the host), and what the
 * editor scrolls to kept clear of the label's fade while it is shown.
 */
export function createEditorWordCount(
  parent: HTMLElement,
  editor: Pick<Editor, 'view' | 'addExtension'>,
  options: { visible: boolean },
): WordCount {
  const words = createWordCount(parent, { count: editorWords(editor.view) }, options);
  editor.addExtension([
    EditorView.updateListener.of((update) => {
      if (update.docChanged) words.schedule();
      else if (update.selectionSet) words.schedule(false);
    }),
    // As the title bar's room above, so that a caret scrolled into view from below isn't left in the
    // fade, where the line being typed would be gone.
    EditorView.scrollMargins.of(() => ({ bottom: words.room() })),
  ]);
  return words;
}
