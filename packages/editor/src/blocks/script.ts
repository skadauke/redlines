// Keystroke scripts: the block editing suite's harness (design: block editing, Tests). A script is
// a document with the caret, the keys pressed, Track Changes on or off, and what the file, the
// caret, the two views and any refusal should be after them. `runScript` plays it on a real editor
// with the formatting plugin, keys through the editor's keymaps as a keyboard sends them, and
// `checkInvariants` holds every script to what no key may break: a hidden caret, an empty
// paragraph in the file, a marker at a line's start, a refusal no one expected, a file whose
// decisions read differently in different orders, a Return that Backspace can't take back, and a
// step that Undo can't take back. Not part of the package.

import { isolateHistory, redo, undo } from '@codemirror/commands';
import { EditorView, runScopeHandlers } from '@codemirror/view';
import {
  EditError,
  accept,
  applyChanges,
  decodePayload,
  encodePayload,
  newestView,
  originalView,
  parse,
  reject,
} from '@redlines/format';
import { expect, it } from 'vitest';
import { createFormatting } from '../../../../plugins/formatting/src/index.ts';
import { createEditor, type Editor } from '../index.ts';
import { editSourceFacet } from '../tracked/typing.ts';

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
  /** The file parses with no structural warning. */
  | 'format'
  /** No more markers start a line than in the starting file. */
  | 'line-start'
  /** Every order of decisions reads the same, and all accepted or rejected reads as the views. */
  | 'decisions'
  /** A script whose keys are a single Enter: Enter then Backspace gives the file back exactly. */
  | 'take-back'
  /** Undo after each step gives back the text and selection before it, and Redo the ones after. */
  | 'undo';

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
   * such as a key that the block editing work hasn't reached yet, and gone when that work lands.
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
        // An inline format change has a closer; a block one doesn't. `</fmt>` says which.
        open.push(id);
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

/** Plays a script on a real editor and reports what it did; `checkInvariants` judges it. */
export function runScript(script: Script): ScriptResult {
  const expanded = expandDoc(script);
  const mounted = mount(script, expanded);
  const { editor } = mounted;
  try {
    const start = editor.getDoc();
    const steps: StepResult[] = script.keys.map((step) => {
      const before = editor.getDoc();
      const handled = play(editor.view, step);
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
      undoFailures: script.skip?.undo === undefined ? undoEach(script, expanded) : [],
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

/**
 * Every order of accepting and rejecting the marks of a file: what each set of decisions reads as
 * (exactly, the text), where any order reads otherwise, and any file left with marks no decision
 * can be made on.
 */
function decisionProblems(file: string): string[] {
  const marksOf = (text: string) => [
    ...new Set(
      parse(text)
        .marks.filter((mark) => mark.kind !== 'cmt' && mark.kind !== 'hl')
        .map((mark) => mark.id),
    ),
  ];
  const all = marksOf(file);
  if (all.length === 0 || all.length > DECISION_LIMIT) return [];
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

  if (holds('hidden-caret')) {
    expect(result.hiddenCaret, `${name}: the caret is in a hidden range`).toBeNull();
  }
  if (holds('empty-paragraph')) {
    expect(emptyParagraphs(body), `${name}: the file has an empty paragraph`).toEqual([]);
  }
  if (holds('format')) {
    const warnings = parse(file)
      .warnings.filter((w) => STRUCTURAL.has(w.code))
      .map((w) => `${w.code} ${w.id ?? ''}`.trim());
    expect(warnings, `${name}: the file's marks and ledger`).toEqual([]);
  }
  if (holds('line-start')) {
    expect(lineStarts(file), `${name}: a marker starts a line`).toBeLessThanOrEqual(
      lineStarts(result.start),
    );
  }
  if (holds('decisions')) {
    expect(decisionProblems(file), `${name}: the orders of decisions`).toEqual([]);
  }
  if (holds('take-back') && result.takenBack !== undefined) {
    expect(notation(result.takenBack), `${name}: Return then Backspace`).toBe(
      notation(result.start),
    );
  }
  if (holds('undo')) expect(result.undoFailures, `${name}: Undo`).toEqual([]);
}

/** Registers one test for each script: played, then checked. */
export function scriptRows(rows: Script[]): void {
  for (const row of rows) {
    it(row.name, () => checkInvariants(runScript(row)));
  }
}
