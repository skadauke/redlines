// Keystroke scripts: the block editing suite's harness (design: block editing, Tests). A script is
// a document with the caret, the keys pressed, Track Changes on or off, and what the file, the
// caret, the two views and any refusal should be after them. `runScript` plays it on a real editor
// with the formatting plugin, keys through the editor's keymaps as a keyboard sends them, and
// `checkInvariants` holds every script to what no key may break: a hidden caret, an empty
// paragraph in the file, a marker at a line's start, a refusal no one expected, a file whose
// decisions read differently in different orders, a Return that Backspace can't take back, and a
// step that Undo can't take back. Not part of the package.

import { isolateHistory } from '@codemirror/commands';
import { EditorView, runScopeHandlers } from '@codemirror/view';
import {
  EditError,
  accept,
  acceptAll,
  applyChanges,
  decodePayload,
  encodePayload,
  newestView,
  originalView,
  parse,
  reject,
  rejectAll,
} from '@redlines/format';
import { micromark } from 'micromark';
import { expect, it } from 'vitest';
import { createFormatting } from '../../../../plugins/formatting/src/index.ts';
import { redo, undo } from '../history/index.ts';
import { createEditor, type Editor } from '../index.ts';
import { editSourceFacet } from '../tracked/typing.ts';
import { openBlock } from './open.ts';

/** A key as CodeMirror names it, with its modifiers. `Mod` is Cmd on a Mac and Ctrl elsewhere. */
export type KeyName =
  | 'Enter'
  | 'Shift-Enter'
  | 'Alt-Enter'
  | 'Backspace'
  | 'Delete'
  | 'Tab'
  | 'Shift-Tab'
  | 'ArrowLeft'
  | 'ArrowRight'
  | 'ArrowUp'
  | 'ArrowDown'
  | 'Alt-Backspace'
  | 'Alt-Delete'
  | `${'Mod' | 'Shift' | 'Alt' | 'Ctrl' | 'Mod-Shift' | 'Mod-Alt' | 'Ctrl-Shift'}-${string}`;

/** A step of a script: a key, or text typed over the selection as the keyboard types it. */
export type Step = KeyName | { type: string };

/** What `checkInvariants` holds every script to, by name, for a script to skip with a reason. */
export type Invariant =
  /** The caret, or either end of the selection, is in no range the caret steps over. */
  | 'hidden-caret'
  /** The file has no empty paragraph (an empty line between blank lines) and no line of a `·`. */
  | 'empty-paragraph'
  /** The file has no stray blank line: no two blank lines in a row between blocks. */
  | 'stray-blank-line'
  /** micromark reads the file, markers kept as HTML comments, as it reads the newest view. */
  | 'render'
  /** The file parses with no structural warning. */
  | 'format'
  /** No more markers start a line than in the starting file. */
  | 'line-start'
  /** Every order of decisions reads the same, and all accepted or rejected reads as the views. */
  | 'decisions'
  /** A script whose keys are a single Enter: Enter then Backspace gives the file back exactly. */
  | 'take-back'
  /** Undo after each step gives back the text and selection before it, and Redo the text after
   * it. (Redo selects what it puts back, as CodeMirror's does, so its selection isn't compared.) */
  | 'undo'
  /** After every step, an open empty paragraph holds the caret, or the block Return was pressed
   * in does. */
  | 'open-caret';

export interface Script {
  name: string;
  /**
   * The document, in the design's notation: `‸` the caret (or `[` and `]` around a selection, the
   * first `[` and the last `]`, where there is no `‸`; `⟦` `⟧` where the document has brackets of
   * its own), `⏎` a line break, `·` a no-break space, and the shortened markers `<split>`,
   * `<ins>x</ins>`, `<del x>`, `<sub x>y</sub>` and `<fmt was=…>` (`</fmt>` closes an inline one),
   * which take the ids of `ids` in order and are `others`' marks. Markers written out in full keep
   * their ids. A document with its own ledger (`<!-- redlines`) gets no other.
   */
  doc: string;
  keys: Step[];
  /** Whether Track Changes is on. */
  tc: boolean;
  /** The ids, in order, of the document's shortened markers and then of the marks the keys make. */
  ids?: string[];
  /** Whose the document's shortened markers are: a handle. Default: the editing author's, Ada's. */
  others?: string;
  /**
   * What the script ends with, in the same notation. Markers are compared shortened, so no id is
   * written: `file` is the body without its ledger; `caret` the body with the caret (or the
   * selection) in it; `newest` and `original` the two views; `refusal` the words of the one
   * refusal the keys meet, where any is meant.
   */
  expect: { file?: string; newest?: string; original?: string; caret?: string; refusal?: string };
  /**
   * The invariants this script doesn't hold, each with why. Only for a cause outside the script,
   * such as a key that the block editing work hasn't reached yet, and gone when that work lands:
   * a skipped invariant that holds fails the script, so that its skip is taken away.
   */
  skip?: Partial<Record<Invariant, string>>;
}

/** What one step did. */
export interface StepResult {
  step: Step;
  /** Whether a key binding took the key. Typed text is always taken. */
  handled: boolean;
  /** The file before and after the step. */
  before: string;
  after: string;
}

export interface ScriptResult {
  script: Script;
  /** The file the script starts from, as the editor was given it. */
  start: string;
  /** The file after the keys: what `getDoc` returns. */
  file: string;
  /** The body with the caret, in the notation, shortened. */
  caret: string;
  steps: StepResult[];
  /** The words of every refusal the keys met, in order. */
  refusals: string[];
  /** The ranges the caret steps over that the caret or the selection ends inside, if any. */
  hiddenCaret: string | null;
  /** For a single Enter: the file after Enter then Backspace, from a fresh editor. */
  takenBack?: string;
  /** For each step, what Undo then Redo gave, where it differs from the states around the step. */
  undoFailures: string[];
  /** The steps after which an empty paragraph was open without the caret in it or its block. */
  openCaretFailures: string[];
}

const ada = { handle: 'ada', name: 'Ada Lovelace' };
/** The time of every tracked edit of a script, and of the document's own marks. */
const NOW = new Date('2026-11-01T10:00:30Z');
const AT = '2026-11-01T10:00Z';

const FIRST = 'bcdfghjkmnpqrstvwxz';
const REST = 'bcdfghjkmnpqrstvwxz23456789';
/** Ids for the marks of scripts that give none: valid, and far from any a script writes. */
const DEFAULT_IDS = Array.from({ length: 60 }, (_, i) => {
  const a = REST[i % REST.length] ?? '2';
  const b = REST[Math.floor(i / REST.length) % REST.length] ?? '2';
  return `z${a}${b}9`;
});

/** Random bytes that spell out the given ids, one after the other, for new marks. */
function randomIds(ids: readonly string[]): (n: number) => Uint8Array {
  const bytes = ids.flatMap((id) => [...id].map((c, i) => (i === 0 ? FIRST : REST).indexOf(c)));
  let at = 0;
  return (n) => {
    if (at + n > bytes.length) throw new Error('The script ran out of ids for new marks');
    const chunk = Uint8Array.from(bytes.slice(at, at + n));
    at += n;
    return chunk;
  };
}

// The notation.

const SELECT_FROM = '⟦';
const SELECT_TO = '⟧';

/** `⏎` and `·` as the characters they stand for. */
const characters = (text: string) => text.replaceAll('⏎', '\n').replaceAll('·', ' ');

/** A file's text in the notation: line breaks as `⏎`, no-break spaces as `·`, CRs as `␍`. */
export const notation = (text: string) =>
  text.replaceAll('\r', '␍').replaceAll('\n', '⏎').replaceAll(' ', '·');

interface Expanded {
  text: string;
  anchor: number;
  head: number;
  /** The ids the shortened markers took. */
  used: string[];
}

/** A script's document as a file: markers written out, a ledger for them, the caret found. */
function expandDoc(script: Script): Expanded {
  const ids = [...(script.ids ?? DEFAULT_IDS)];
  const used: string[] = [];
  const open: string[] = [];
  const take = () => {
    const id = ids.shift();
    if (!id) throw new Error(`${script.name}: the document has more markers than ids`);
    used.push(id);
    return id;
  };
  const close = (tag: string) => {
    const id = open.pop();
    if (!id) throw new Error(`${script.name}: ${tag} closes nothing`);
    return `<!--/${id}-->`;
  };
  let text = characters(script.doc).replace(
    /<split>|<ins>|<\/ins>|<del ([^>]*)>|<sub ([^>]*)>|<\/sub>|<fmt ([^>]*)>|<\/fmt>/g,
    (tag, del?: string, sub?: string, fmt?: string) => {
      if (tag === '<split>') return `<!--split ${take()}-->`;
      if (tag === '<ins>') {
        const id = take();
        open.push(id);
        return `<!--ins ${id}-->`;
      }
      if (del !== undefined) return `<!--del ${take()} ${encodePayload(del)}-->`;
      if (sub !== undefined) {
        const id = take();
        open.push(id);
        return `<!--sub ${id} ${encodePayload(sub)}-->`;
      }
      if (fmt !== undefined) {
        const id = take();
        // An inline format change has a closer; a block one (`was=`, a box) doesn't.
        if (!/(?:^| )(?:was=|[+-]check)/.test(fmt)) open.push(id);
        return `<!--fmt ${id} ${fmt}-->`;
      }
      return close(tag);
    },
  );
  // A block `fmt` left open has no closer: that is its form.
  const { anchor, head, text: bare } = findCaret(text, script.name);
  text = bare;
  if (used.length > 0 && !text.includes('<!-- redlines')) {
    const by = script.others ?? ada.handle;
    const entries = used.map((id) => `  ${id}: {by: ${by}, at: ${AT}}\n`).join('');
    // The ledger ends the file with the line break the document ended with, as the format writes it.
    const end = text.endsWith('\n') ? '\n' : '';
    text = `${text.replace(/\n*$/, '')}\n\n<!-- redlines\nversion: 1\nmarks:\n${entries}-->${end}`;
  }
  return { text, anchor, head, used };
}

/** The caret (`‸`) or the selection in a text, taken out of it. */
function findCaret(text: string, name: string): { text: string; anchor: number; head: number } {
  const caret = text.indexOf('‸');
  if (caret >= 0) {
    if (text.indexOf('‸', caret + 1) >= 0) throw new Error(`${name}: two carets`);
    return { text: text.slice(0, caret) + text.slice(caret + 1), anchor: caret, head: caret };
  }
  let from = text.indexOf(SELECT_FROM);
  let to = text.indexOf(SELECT_TO);
  if (from < 0 || to < from) {
    from = text.indexOf('[');
    to = text.lastIndexOf(']');
  }
  if (from < 0 || to < from) throw new Error(`${name}: no caret (‸) and no selection ([ ])`);
  const bare = text.slice(0, from) + text.slice(from + 1, to) + text.slice(to + 1);
  return { text: bare, anchor: from, head: to - 1 };
}

/** The markers of a file shortened to the notation's, with the ids left out. */
export function shorten(text: string): string {
  const kinds = new Map<string, string>();
  return text.replace(
    /<!--(?:\/([a-z0-9]+)|(split|ins|del|sub|fmt) ([a-z0-9]+)(?: ([^]*?))?)-->/g,
    (all, closer?: string, kind?: string, id?: string, payload?: string) => {
      if (closer !== undefined) {
        const of = kinds.get(closer);
        return of ? `</${of}>` : all;
      }
      if (!kind || !id) return all;
      if (kind === 'split') return '<split>';
      if (kind === 'del') return `<del ${decodePayload(payload ?? '')}>`;
      kinds.set(id, kind);
      if (kind === 'ins') return '<ins>';
      if (kind === 'sub') return `<sub ${decodePayload(payload ?? '')}>`;
      return `<fmt ${payload ?? ''}>`;
    },
  );
}

/** A file's body: the text before its ledger and the blank line in front of it. */
function bodyOf(file: string): string {
  const range = parse(file).ledgerRange;
  return range ? file.slice(0, range.from) : file;
}

// Playing a script.

const mac = /Mac/.test(navigator.platform);

/** Presses a key through the editor's keymaps, as a keyboard would. */
function press(view: EditorView, key: string): boolean {
  const parts = key.split('-');
  // `Alt--` and the like: the key itself may be a `-`.
  const name = key.endsWith('--') ? '-' : (parts.pop() ?? key);
  const has = (modifier: string) => parts.includes(modifier);
  const event = new KeyboardEvent('keydown', {
    key: name,
    shiftKey: has('Shift'),
    altKey: has('Alt'),
    ctrlKey: has('Ctrl') || (has('Mod') && !mac),
    metaKey: has('Mod') && mac,
    bubbles: true,
    cancelable: true,
  });
  return runScopeHandlers(view, event, 'editor');
}

interface Mounted {
  editor: Editor;
  refusals: string[];
  destroy(): void;
}

/** A real editor on the script's document, with the formatting plugin, and the caret placed. */
function mount(script: Script, expanded: Expanded): Mounted {
  const parent = document.createElement('div');
  document.body.append(parent);
  const refusals: string[] = [];
  const ids = [...(script.ids ?? DEFAULT_IDS)].filter((id) => !expanded.used.includes(id));
  const editor = createEditor(parent, {
    doc: expanded.text,
    author: ada,
    tracking: script.tc,
    onNotice: (message) => refusals.push(message),
    extensions: [editSourceFacet.of({ now: () => NOW, random: randomIds(ids) })],
  });
  const remove = createFormatting(editor, {
    author: ada,
    notice: (message) => refusals.push(message),
  });
  editor.view.dispatch({ selection: { anchor: expanded.anchor, head: expanded.head } });
  return {
    editor,
    refusals,
    destroy() {
      remove();
      editor.destroy();
      parent.remove();
    },
  };
}

/** Plays one step. */
function play(view: EditorView, step: Step): boolean {
  if (typeof step !== 'string') {
    view.dispatch(view.state.replaceSelection(step.type), { userEvent: 'input.type' });
    return true;
  }
  return press(view, step);
}

/** The body with the caret or the selection in it, in the notation. */
function caretText(editor: Editor): string {
  const { anchor, head } = editor.view.state.selection.main;
  const doc = editor.view.state.doc.toString();
  const body = bodyOf(doc);
  const mark = (text: string, at: number, sign: string) =>
    at <= body.length ? text.slice(0, at) + sign + text.slice(at) : text;
  const from = Math.min(anchor, head);
  const to = Math.max(anchor, head);
  const text = from === to ? mark(body, from, '‸') : mark(mark(body, to, ']'), from, '[');
  return notation(shorten(text));
}

/** The atomic ranges the caret or an end of the selection is strictly inside. */
function hiddenAt(editor: Editor): string | null {
  const { view } = editor;
  const { anchor, head } = view.state.selection.main;
  const inside: string[] = [];
  for (const source of view.state.facet(EditorView.atomicRanges)) {
    for (let it = source(view).iter(); it.value; it.next()) {
      for (const at of new Set([anchor, head])) {
        if (it.from < at && at < it.to) {
          const doc = view.state.doc.sliceString(it.from, it.to);
          inside.push(`${at} in ${it.from}-${it.to} ${JSON.stringify(doc)}`);
        }
      }
    }
  }
  return inside.length ? inside.join('; ') : null;
}

const docOf = (editor: Editor) => editor.view.state.doc.toString();
const selectionOf = (editor: Editor) => {
  const { anchor, head } = editor.view.state.selection.main;
  return `${anchor}-${head}`;
};

/**
 * For each step, on a fresh editor that has played the steps before it: Undo right after the step
 * gives back the text and selection before it, and Redo the text after it. The step is isolated in
 * the history first, so that two Backspaces in a row, which CodeMirror joins into one Undo, are
 * each checked.
 */
function undoEach(script: Script, expanded: Expanded): string[] {
  const failures: string[] = [];
  script.keys.forEach((step, i) => {
    const mounted = mount(script, expanded);
    const { view } = mounted.editor;
    try {
      for (const earlier of script.keys.slice(0, i)) play(view, earlier);
      const before = docOf(mounted.editor);
      const selection = selectionOf(mounted.editor);
      view.dispatch({ annotations: isolateHistory.of('full') });
      play(view, step);
      const after = docOf(mounted.editor);
      if (after === before) return;
      undo(view);
      const label = `step ${i + 1} (${JSON.stringify(step)})`;
      if (docOf(mounted.editor) !== before) {
        failures.push(
          `${label}: Undo gave ${notation(docOf(mounted.editor))}, not ${notation(before)}`,
        );
        return;
      }
      if (selectionOf(mounted.editor) !== selection) {
        failures.push(`${label}: Undo put the selection at ${selectionOf(mounted.editor)}`);
      }
      redo(view);
      if (docOf(mounted.editor) !== after) {
        failures.push(
          `${label}: Redo gave ${notation(docOf(mounted.editor))}, not ${notation(after)}`,
        );
      }
    } finally {
      mounted.destroy();
    }
  });
  return failures;
}

/** Where an open empty paragraph is without the caret in it or in its block, if it is. */
function openWithoutCaret(view: EditorView): string | null {
  const open = openBlock(view.state);
  if (!open) return null;
  const { head, anchor } = view.state.selection.main;
  const inside = (span: { from: number; to: number } | null) =>
    span !== null && [head, anchor].every((at) => at >= span.from && at <= span.to);
  if (inside(open.empty) || inside(open.pressedIn)) return null;
  return `open at ${open.empty.from}-${open.empty.to}, the caret at ${anchor}-${head}`;
}

/** Plays a script on a real editor and reports what it did; `checkInvariants` judges it. */
export function runScript(script: Script): ScriptResult {
  const expanded = expandDoc(script);
  const mounted = mount(script, expanded);
  const { editor } = mounted;
  try {
    const start = editor.getDoc();
    const openCaretFailures: string[] = [];
    const steps: StepResult[] = script.keys.map((step, i) => {
      const before = editor.getDoc();
      const handled = play(editor.view, step);
      const open = openWithoutCaret(editor.view);
      if (open) openCaretFailures.push(`step ${i + 1} (${JSON.stringify(step)}): ${open}`);
      return { step, handled, before, after: editor.getDoc() };
    });
    const result: ScriptResult = {
      script,
      start,
      file: editor.getDoc(),
      caret: caretText(editor),
      steps,
      refusals: [...mounted.refusals],
      hiddenCaret: hiddenAt(editor),
      undoFailures: undoEach(script, expanded),
      openCaretFailures,
    };
    if (script.keys.length === 1 && script.keys[0] === 'Enter') {
      const again = mount(script, expanded);
      try {
        play(again.editor.view, 'Enter');
        play(again.editor.view, 'Backspace');
        result.takenBack = again.editor.getDoc();
      } finally {
        again.destroy();
      }
    }
    return result;
  } finally {
    mounted.destroy();
  }
}

// The invariants.

/** Warnings that mean marks and ledger don't match: what no edit may leave behind. */
const STRUCTURAL = new Set([
  'unclosed-mark',
  'unopened-close',
  'kind-mismatch',
  'duplicate-id',
  'missing-entry',
  'orphan-entry',
  'orphan-thread',
  'bad-ledger',
]);

const lineStarts = (file: string) => {
  const parsed = parse(file);
  const end = parsed.ledgerRange?.from ?? Infinity;
  return parsed.warnings.filter((w) => w.code === 'line-start-marker' && (w.range?.from ?? 0) < end)
    .length;
};

/** A line with nothing but container syntax (quote markers, indentation): blank for a reader. */
const BLANK = /^[ \t>]*$/;
const FENCE = /^[ \t>]*(?:[-*+] |\d{1,9}[.)] )?[ \t]*(`{3,}|~{3,})/;

/**
 * The empty paragraphs of a body, outside fenced code: an empty line between blank lines (three
 * blank lines in a row), or with a blank line beside it at the start or the end; and the lines
 * that hold nothing but a no-break space, which an empty line opened by Shift-Return holds.
 */
export function emptyParagraphs(body: string): string[] {
  // A line that holds a marker alone, as a deletion at a block's start does (format §3.3), is not
  // blank; the markers of a line are left out only to find a no-break space alone on it.
  const lines = (body.endsWith('\n') ? body.slice(0, -1) : body).split(/\r?\n/);
  const found: string[] = [];
  let fence: string | null = null;
  /** The blank lines in a row before the current line, and where they start. */
  let run = 0;
  let runStart = 0;
  const endRun = (atEnd: boolean) => {
    const atStart = runStart === 0;
    if (run >= 3 || (run >= 2 && (atStart || atEnd))) {
      found.push(`an empty paragraph at line ${runStart + 1} (${run} blank lines)`);
    }
    run = 0;
  };
  lines.forEach((line, i) => {
    const opens = FENCE.exec(line)?.[1];
    if (fence) {
      if (opens && opens[0] === fence[0] && opens.length >= fence.length) fence = null;
      return;
    }
    const text = line.replace(/<!--[^]*?-->/g, '');
    if (/^[ \t>]*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+)?\u00a0[ \t]*$/.test(text)) {
      found.push(`a line of a no-break space at line ${i + 1}`);
    }
    if (BLANK.test(line)) {
      if (run === 0) runStart = i;
      run++;
      return;
    }
    endRun(false);
    if (opens) fence = opens;
  });
  if (run > 0 && !fence) endRun(true);
  return found;
}

/**
 * The stray blank lines of a body, outside fenced code: two blank lines in a row, where a single
 * one parts two blocks (three or more are an empty paragraph, above).
 */
export function strayBlankLines(body: string): string[] {
  const lines = (body.endsWith('\n') ? body.slice(0, -1) : body).split(/\r?\n/);
  const found: string[] = [];
  let fence: string | null = null;
  let run = 0;
  const end = (i: number) => {
    if (run === 2 && i - run > 0) found.push(`a stray blank line at line ${i}`);
    run = 0;
  };
  lines.forEach((line, i) => {
    const opens = FENCE.exec(line)?.[1];
    if (fence) {
      if (opens && opens[0] === fence[0] && opens.length >= fence.length) fence = null;
      return;
    }
    if (BLANK.test(line)) {
      run++;
      return;
    }
    end(i);
    if (opens) fence = opens;
  });
  return found;
}

/** HTML as a reader sees it: comments left out, and white space next to tags. */
const readable = (html: string) =>
  html
    .replace(/<!--[^]*?-->/g, '')
    .replace(/\s+/g, ' ')
    .replace(/ ?(<[^>]*>) ?/g, '$1')
    .trim();

/**
 * Where micromark reads the file, its markers kept as HTML comments, otherwise than the newest
 * view: a marker shown as text (after a backslash, in code, at a line's start), or a construct
 * the markers part.
 */
export function renderProblems(file: string): string[] {
  const tracked = readable(micromark(bodyOf(file), { allowDangerousHtml: true }));
  const newest = readable(micromark(newestView(file).text, { allowDangerousHtml: true }));
  return tracked === newest ? [] : [`micromark reads ${tracked}, and the newest view ${newest}`];
}

/** The file with one decision made, or undefined where the format refuses it. */
function decided(text: string, id: string, how: 'a' | 'r'): string | undefined {
  try {
    return applyChanges(text, how === 'a' ? accept(text, id) : reject(text, id));
  } catch (error) {
    if (error instanceof EditError) return undefined;
    throw error;
  }
}

/** The most marks whose every order of decisions is walked. */
const DECISION_LIMIT = 6;

/** A small seeded generator (mulberry32), so that a sample of orders is the same every run. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** How many random sets of decisions `sampledDecisions` tries, each in two orders. */
const SAMPLES = 4;

/**
 * For a file with more marks than every order can be walked for: accepting every mark (with
 * `acceptAll`, and one at a time in a random order) reads as the newest view, rejecting every mark
 * as the original view, and each mark decided against all the others, and a few random sets of
 * decisions, read the same in two random orders.
 */
function sampleDecisions(
  file: string,
  ids: readonly string[],
  decideOne: (text: string, id: string, how: 'a' | 'r') => string | undefined = decided,
): string[] {
  const problems: string[] = [];
  const random = seeded(ids.length * 7919 + file.length);
  const shuffled = () => {
    const order = [...ids];
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [order[i], order[j]] = [order[j] ?? '', order[i] ?? ''];
    }
    return order;
  };
  /**
   * The newest view once the decisions are made in `order`. A decision that is refused waits for
   * the others, as another order would make it; where some are refused still, the order says
   * nothing (undefined), and where no decision at all can be made on the marks left, that is a
   * problem, as the full walk finds it.
   */
  const decide = (order: readonly string[], how: (id: string) => 'a' | 'r'): string | undefined => {
    let text = file;
    const present = (id: string) => parse(text).marks.some((mark) => mark.id === id);
    let pending = order.filter(present);
    for (let progress = true; pending.length > 0 && progress;) {
      progress = false;
      const later: string[] = [];
      for (const id of pending) {
        if (!present(id)) continue;
        const next = decideOne(text, id, how(id));
        if (next === undefined) later.push(id);
        else {
          text = next;
          progress = true;
        }
      }
      pending = later.filter(present);
    }
    if (pending.length === 0) return newestView(text).text;
    const stuck = pending.every(
      (id) => decideOne(text, id, 'a') === undefined && decideOne(text, id, 'r') === undefined,
    );
    if (stuck) problems.push(`no decision can be made on ${notation(bodyOf(text))}`);
    return undefined;
  };
  const newest = newestView(file).text;
  const original = originalView(file).text;
  const all = (changes: () => ReturnType<typeof acceptAll>) => {
    try {
      return newestView(applyChanges(file, changes())).text;
    } catch (error) {
      if (error instanceof EditError) return undefined;
      throw error;
    }
  };
  if (all(() => acceptAll(file)) !== newest)
    problems.push('acceptAll does not give the newest view');
  if (all(() => rejectAll(file)) !== original) {
    problems.push('rejectAll does not give the original view');
  }
  const accepted = decide(shuffled(), () => 'a');
  if (accepted !== undefined && accepted !== newest) {
    problems.push(`accepting every mark in a random order gives ${notation(accepted)}`);
  }
  const rejected = decide(shuffled(), () => 'r');
  if (rejected !== undefined && rejected !== original) {
    problems.push(`rejecting every mark in a random order gives ${notation(rejected)}`);
  }
  // Each mark decided against all the others, both ways, and a few random sets: each in two orders.
  const sets: ((id: string) => 'a' | 'r')[] = ids.flatMap((one) => [
    (id: string) => (id === one ? 'r' : 'a'),
    (id: string) => (id === one ? 'a' : 'r'),
  ]);
  for (let sample = 0; sample < SAMPLES; sample++) {
    const choice = new Map(ids.map((id) => [id, random() < 0.5 ? ('a' as const) : ('r' as const)]));
    sets.push((id: string) => choice.get(id) ?? 'a');
  }
  for (const how of sets) {
    const one = decide(shuffled(), how);
    const two = decide(shuffled(), how);
    if (one !== undefined && two !== undefined && one !== two) {
      problems.push(`one set of decisions reads ${notation(one)} or ${notation(two)}`);
    }
  }
  return problems;
}

/** `sampleDecisions`, and the one decision it makes by default, for tests to stand in for. */
export const sampledDecisions = Object.assign(sampleDecisions, { decide: decided });

/**
 * Every order of accepting and rejecting the marks of a file: what each set of decisions reads as
 * (exactly, the text), where any order reads otherwise, and any file left with marks no decision
 * can be made on.
 */
export function decisionProblems(file: string): string[] {
  const marksOf = (text: string) => [
    ...new Set(
      parse(text)
        .marks.filter((mark) => mark.kind !== 'cmt' && mark.kind !== 'hl')
        .map((mark) => mark.id),
    ),
  ];
  const all = marksOf(file);
  if (all.length === 0) return [];
  if (all.length > DECISION_LIMIT) return sampleDecisions(file, all);
  const outcomes = new Map<string, Set<string>>();
  const problems: string[] = [];
  const seen = new Set<string>();
  const walk = (text: string, path: string[]) => {
    const key = `${text}\u0000${path.toSorted().join(' ')}`;
    if (seen.has(key)) return;
    seen.add(key);
    const left = marksOf(text);
    if (left.length === 0) {
      const set = path.toSorted().join(' ');
      const results = outcomes.get(set) ?? new Set<string>();
      results.add(newestView(text).text);
      outcomes.set(set, results);
      return;
    }
    let any = false;
    for (const id of left) {
      for (const how of ['a', 'r'] as const) {
        const next = decided(text, id, how);
        if (next === undefined) continue;
        any = true;
        walk(next, [...path, `${how}${id}`]);
      }
    }
    if (!any) problems.push(`no decision can be made on ${notation(bodyOf(text))}`);
  };
  walk(file, []);
  for (const [set, results] of outcomes) {
    if (results.size > 1) {
      problems.push(`${set || 'no decisions'} reads ${[...results].map(notation).join(' or ')}`);
    }
  }
  const allOf = (how: string) =>
    all
      .map((id) => `${how}${id}`)
      .toSorted()
      .join(' ');
  const accepted = [...(outcomes.get(allOf('a')) ?? [])];
  const rejected = [...(outcomes.get(allOf('r')) ?? [])];
  const newest = newestView(file).text;
  const original = originalView(file).text;
  if (accepted.length && accepted[0] !== newest) {
    problems.push(`accepting every mark gives ${notation(accepted[0] ?? '')}, not the newest view`);
  }
  if (rejected.length && rejected[0] !== original) {
    problems.push(
      `rejecting every mark gives ${notation(rejected[0] ?? '')}, not the original view`,
    );
  }
  return problems;
}

/**
 * Holds a played script to its expectations and to every invariant it doesn't skip. Strings are
 * compared in the notation, so a failure shows `⏎` and the shortened markers.
 */
export function checkInvariants(result: ScriptResult): void {
  const { script, file } = result;
  const name = script.name;
  const skip = script.skip ?? {};
  const holds = (invariant: Invariant) => skip[invariant] === undefined;
  const body = bodyOf(file);
  const { expect: want } = script;

  if (want.file !== undefined) {
    expect(notation(shorten(body)), `${name}: the file`).toBe(want.file);
  }
  if (want.caret !== undefined) expect(result.caret, `${name}: the caret`).toBe(want.caret);
  if (want.newest !== undefined) {
    expect(notation(newestView(file).text), `${name}: the newest view`).toBe(want.newest);
  }
  if (want.original !== undefined) {
    expect(notation(originalView(file).text), `${name}: the original view`).toBe(want.original);
  }
  expect(result.refusals, `${name}: refusals`).toEqual(
    want.refusal === undefined ? [] : [want.refusal],
  );

  // Every invariant, held or skipped: a skipped one that holds is a skip to take away.
  const problems: Record<Invariant, string[]> = {
    'hidden-caret': result.hiddenCaret === null ? [] : [result.hiddenCaret],
    'empty-paragraph': emptyParagraphs(body),
    'stray-blank-line': strayBlankLines(body),
    render: renderProblems(file),
    format: parse(file)
      .warnings.filter((w) => STRUCTURAL.has(w.code))
      .map((w) => `${w.code} ${w.id ?? ''}`.trim()),
    'line-start':
      lineStarts(file) > lineStarts(result.start)
        ? [`${lineStarts(file) - lineStarts(result.start)} more markers start a line`]
        : [],
    decisions: decisionProblems(file),
    'take-back':
      result.takenBack === undefined || result.takenBack === result.start
        ? []
        : [`Return then Backspace gives ${notation(result.takenBack)}`],
    undo: result.undoFailures,
    'open-caret': result.openCaretFailures,
  };
  for (const invariant of Object.keys(problems) as Invariant[]) {
    const found = problems[invariant];
    if (holds(invariant)) expect(found, `${name}: ${invariant}`).toEqual([]);
    else if (invariant !== 'take-back' || result.takenBack !== undefined) {
      expect(found, `${name}: the skip of ${invariant} is no longer needed`).not.toEqual([]);
    }
  }
}

/** Registers one test for each script: played, then checked. */
export function scriptRows(rows: Script[]): void {
  for (const row of rows) {
    it(row.name, () => checkInvariants(runScript(row)));
  }
}
