// Keystroke scripts: the block editing suite's harness (design: block editing, Tests). A script is
// a document with the caret, the keys pressed, Track Changes on or off, and what the file, the
// caret, the two views and any refusal should be after them. `runScript` plays it on a real editor
// with the formatting plugin, keys through the editor's keymaps as a keyboard sends them, and
// `checkInvariants` holds every script to what no key may break: a hidden caret, an empty
// paragraph in the file, a marker at a line's start, a refusal no one expected, a file whose
// decisions read differently in different orders, a Return that Backspace can't take back, and a
// step that Undo can't take back. Not part of the package.

import { isolateHistory } from '@codemirror/commands';
import { forceParsing } from '@codemirror/language';
import { EditorView, runScopeHandlers } from '@codemirror/view';
import {
  EditError,
  accept,
  acceptAll,
  applyChanges,
  decodePayload,
  plainPayload,
  encodePayload,
  frontMatterEnd,
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
import { plainPastes } from '../tracked/clipboard.ts';
import { isWidenedNotice } from '../tracked/intent.ts';
import { editSourceFacet } from '../tracked/typing.ts';
import { openBlock, textWithoutOpen } from './open.ts';

/**
 * Lets the event loop turn, which a loop of scripts must do now and then (`await settle()`, once a
 * script or once a seed). A script's editors are destroyed, but happy-dom's `requestAnimationFrame`
 * answers with an object, so CodeMirror's `destroy()` does not take it for a pending frame and
 * never cancels the frame it asked for: each editor stays reachable from a timer until a macrotask
 * turn. A loop that never yields held them all, about 18 MB a seed, and ran out of memory at
 * `REDLINES_FUZZ=200` (#286). A turn that is only a microtask does not release them.
 */
export const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** A key as CodeMirror names it, with its modifiers. `Mod` is Cmd on a Mac and Ctrl elsewhere. */
export type KeyName =
  | 'Enter'
  | 'Escape'
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
  | 'Home'
  | 'End'
  | 'Alt-Backspace'
  | 'Alt-Delete'
  | `${'Mod' | 'Shift' | 'Alt' | 'Ctrl' | 'Mod-Shift' | 'Mod-Alt' | 'Ctrl-Shift'}-${string}`;

/**
 * A step of a script: a key, text typed over the selection as the keyboard types it, an agent's
 * edit (a paragraph of its own at the top of the document), a command of the registry run by its
 * id (the image size's, #526), a decision on the first pending
 * change (accepted or rejected, where the format decides it), or Track Changes switched on or off
 * for this editor.
 */
export type Step =
  | KeyName
  | { type: string }
  | { paste: string; plain?: boolean }
  | { agent: string }
  | { command: string }
  | { decide: 'accept' | 'reject' }
  | { tracking: boolean };

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
  /** After every step, the file's list items are the ones Markdown reads: no more marker lines
   * that micromark doesn't read as an item than the starting file had (an empty item right under
   * a line of text is a setext underline or text: it must be open, not in the file). */
  | 'list-reads'
  /** After every step, an open empty paragraph holds the caret, or the block Return was pressed
   * in does. */
  | 'open-caret'
  /** After the keys, and after leaving an empty paragraph still open, Undo all the way back gives
   * only texts the document had, and ends at the starting file: no step whose text a take-back
   * removed is left to replay. */
  | 'history'
  /** After every step, the file the editor gives (`getDoc`, what is saved) is its document with
   * the open empty paragraph taken back, as it stands: no text twice or lost (a file of LF line
   * breaks, whose line breaks the editor gives back as they are). */
  | 'file-text';

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
  /** Whether line break marks (¶) are shown (Preferences › Editor, #161). Default: hidden. */
  lineBreakMarks?: boolean;
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
  /** The line the caret was on before the step, and its column in it. */
  caretLine: { text: string; col: number };
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
  /** The steps after which the file read as more marker lines than items (`'list-reads'`). */
  listReadFailures: string[];
  /** What Undo all the way back gave that the document never had, or where it ended. */
  historyFailures: string[];
  /** The steps after which `getDoc` was not the document with the open block taken back. */
  fileTextFailures: string[];
  /** Whether an empty item is open after the keys (out of the file, the caret in it). */
  openItem: boolean;
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
  // A document with a ledger of its own is a file as it is written, which no shortened marker is
  // in: the tags `<sub>` and `</sub>` of subscript, in a file that a generator of random documents
  // made, are no markers of a substitution.
  const asFile = script.doc.includes('<!-- redlines');
  let text = characters(script.doc).replace(
    asFile
      ? /(?!)/g
      : /<split>|<ins>|<\/ins>|<del ([^>]*)>|<sub ([^>]*)>|<\/sub>|<fmt ([^>]*)>|<\/fmt>/g,
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
      if (kind === 'del') return `<del ${plainPayload(decodePayload(payload ?? ''))}>`;
      kinds.set(id, kind);
      if (kind === 'ins') return '<ins>';
      if (kind === 'sub') return `<sub ${plainPayload(decodePayload(payload ?? ''))}>`;
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
  // The whole document parsed first: a busy machine stops a parse early, and a key reads its block
  // from the tree.
  forceParsing(view, view.state.doc.length, 5000);
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
function mount(script: Script, expanded: Expanded, seen?: Set<string>): Mounted {
  const parent = document.createElement('div');
  document.body.append(parent);
  const refusals: string[] = [];
  const ids = [...(script.ids ?? DEFAULT_IDS)].filter((id) => !expanded.used.includes(id));
  const editor = createEditor(parent, {
    doc: expanded.text,
    author: ada,
    tracking: script.tc,
    showLineBreakMarks: script.lineBreakMarks ?? false,
    // The notice of a widened edit says what was written; a refusal is what a row is held to.
    onNotice: (message) => {
      if (!isWidenedNotice(message)) refusals.push(message);
    },
    // A host with an Image menu, whose commands a script may run (#526).
    openImage: () => {},
    extensions: [
      editSourceFacet.of({ now: () => NOW, random: randomIds(ids) }),
      // Every text the document has, for the history invariant.
      ...(seen ? [EditorView.updateListener.of((u) => void seen.add(u.state.doc.toString()))] : []),
    ],
  });
  const remove = createFormatting(editor, {
    author: ada,
    notice: (message) => refusals.push(message),
  });
  // The caret is an offset of the file's text, where a CRLF is two characters; the document has one
  // LF there (#1233: a CRLF script put the caret a character per line break too far).
  const inDocument = (at: number) => at - (expanded.text.slice(0, at).match(/\r\n/g)?.length ?? 0);
  editor.view.dispatch({
    selection: { anchor: inDocument(expanded.anchor), head: inDocument(expanded.head) },
  });
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
function play(editor: Editor, step: Step): boolean {
  const { view } = editor;
  if (typeof step === 'string') return press(view, step);
  if ('type' in step) {
    view.dispatch(view.state.replaceSelection(step.type), { userEvent: 'input.type' });
  } else if ('paste' in step) {
    // The whole document parsed first, as for a key: the paste reads its place from the tree.
    forceParsing(view, view.state.doc.length, 5000);
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', step.paste);
    const event = new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true });
    // Paste as Plain Text: the text goes in as text, whatever it is.
    if (step.plain) plainPastes.add(event);
    view.contentDOM.dispatchEvent(event);
  } else if ('agent' in step) {
    editor.applyAgentEdit(`${step.agent}\n\n${editor.getDoc()}`, {
      group: 'walk',
      agent: 'Claude',
    });
  } else if ('command' in step) {
    // The whole document parsed first: a command reads its place from the tree.
    forceParsing(view, view.state.doc.length, 5000);
    return editor.commands.run(step.command);
  } else if ('tracking' in step) {
    editor.setTracking(step.tracking, { inFile: false });
  } else {
    const mark = parse(editor.getDoc()).marks.find((m) => m.kind !== 'split' && m.kind !== 'cmt');
    if (mark) {
      try {
        if (step.decide === 'accept') editor.accept(mark.id);
        else editor.reject(mark.id);
      } catch (error) {
        // The format may not decide it (a part of a move, a block change another's mark holds).
        if (!(error instanceof EditError)) throw error;
      }
    }
  }
  return true;
}

/** Whether a step is Undo or Redo: it is no step of its own to take back. */
const inHistory = (step: Step) => step === 'Mod-z' || step === 'Mod-Shift-z' || step === 'Mod-y';

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

/** The lines of a body that start a list item, outside fenced code. */
function itemLines(body: string): number {
  let fence: string | null = null;
  let where = { indent: 0, quotes: 0 };
  let count = 0;
  const shape = (line: string) => ({
    indent: /^[ \t>]*/.exec(line.replace(/^(?:[ \t]*>)+/, ''))?.[0].length ?? 0,
    quotes: (/^(?:[ \t]*>)*/.exec(line)?.[0].match(/>/g) ?? []).length,
  });
  for (const line of body.split('\n')) {
    const opens = FENCE.exec(line)?.[1];
    if (fence) {
      // A fence that is never closed ends where its container does: a line of text with fewer
      // quote markers, or indented less than the fence is, which leaves its list item.
      const now = shape(line);
      const ends =
        line.trim() !== '' &&
        (now.quotes < where.quotes || (now.quotes === where.quotes && now.indent < where.indent));
      if (opens && opens.startsWith(fence[0]!) && opens.length >= fence.length) {
        fence = null;
        continue;
      }
      if (!ends) continue;
      fence = null;
    }
    // A line of three or more `-` or `*` (`- ---`, `* * *`) is a thematic break, not an item.
    const thematic = /^(?:[ \t]*>)*[ \t]*([-*_])(?:[ \t]*\1){2,}[ \t]*$/.test(line);
    if (!thematic && /^(?:[ \t]*>)*[ \t]*(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/.test(line)) count++;
    if (opens) {
      fence = opens;
      where = shape(line);
    }
  }
  return count;
}

/** How many more marker lines a file has than micromark reads items in it. */
export function unreadItems(file: string): number {
  // The front matter is YAML, whose `- ` lines no Markdown reader reads as items.
  const whole = bodyOf(file);
  const body = whole.slice(Math.max(0, frontMatterEnd(whole)));
  const html = micromark(body, { allowDangerousHtml: true });
  return itemLines(body) - (html.match(/<li[ >]/g)?.length ?? 0);
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
    if (inHistory(step)) return;
    const mounted = mount(script, expanded);
    const { view } = mounted.editor;
    try {
      for (const earlier of script.keys.slice(0, i)) play(mounted.editor, earlier);
      const before = docOf(mounted.editor);
      const selection = selectionOf(mounted.editor);
      view.dispatch({ annotations: isolateHistory.of('full') });
      const opened = openBlock(view.state) ? textWithoutOpen(view.state, true) : null;
      play(mounted.editor, step);
      const after = docOf(mounted.editor);
      if (after === before) return;
      // A step that only left the empty paragraph took its Returns out of the history with it:
      // Undo then undoes what came before them, which the history invariant checks.
      if (opened !== null && !openBlock(view.state) && after === opened) return;
      undo(view);
      const label = `step ${i + 1} (${JSON.stringify(step)})`;
      if (docOf(mounted.editor) !== before) {
        failures.push(
          `${label}: Undo gave ${notation(docOf(mounted.editor))}, not ${notation(before)}`,
        );
        return;
      }
      // An agent's edit isn't the person's, and leaves their selection where the text puts it.
      if (typeof step === 'object' && 'agent' in step) {
        // nothing to compare
      } else if (selectionOf(mounted.editor) !== selection) {
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

/**
 * Undo all the way back on `view`, after leaving an empty paragraph still open: what it gave that
 * the document never had (`seen`), and whether it ended at `start`.
 */
function undoAllTheWay(view: EditorView, seen: Set<string>, start: string): string[] {
  const failures: string[] = [];
  if (openBlock(view.state)) view.dispatch({ selection: { anchor: 0 }, userEvent: 'select' });
  for (let n = 0; n < 500 && undo(view); n++) {
    const text = view.state.doc.toString();
    if (!seen.has(text)) failures.push(`Undo gave ${notation(text)}, which the document never had`);
  }
  const text = view.state.doc.toString();
  if (text !== start) failures.push(`Undo all the way back gave ${notation(text)}`);
  return failures;
}

/** Plays a script on a real editor and reports what it did; `checkInvariants` judges it. */
export function runScript(
  script: Script,
  options: {
    /** Without the replays (Undo after each step, Undo all the way back, the take-back), which
     * cost most of a script's time: for suites that play many scripts and check other things. */
    light?: boolean;
    /** Called with the editor after each step, for a suite that reads the editor itself. */
    onStep?: (editor: Editor, index: number) => void;
  } = {},
): ScriptResult {
  const expanded = expandDoc(script);
  const seen = new Set<string>([expanded.text.replaceAll('\r\n', '\n')]);
  const mounted = mount(script, expanded, seen);
  const { editor } = mounted;
  try {
    const start = editor.getDoc();
    const openCaretFailures: string[] = [];
    const listReadFailures: string[] = [];
    const fileTextFailures: string[] = [];
    const unread = unreadItems(start);
    const steps: StepResult[] = script.keys.map((step, i) => {
      const before = editor.getDoc();
      const { head } = editor.view.state.selection.main;
      const caretOn = editor.view.state.doc.lineAt(head);
      const caretLine = { text: caretOn.text, col: head - caretOn.from };
      const handled = play(editor, step);
      options.onStep?.(editor, i);
      const open = openWithoutCaret(editor.view);
      if (open) openCaretFailures.push(`step ${i + 1} (${JSON.stringify(step)}): ${open}`);
      if (!start.includes('\r')) {
        const given = editor.getDoc();
        const held = textWithoutOpen(editor.view.state);
        if (given !== held) {
          fileTextFailures.push(
            `step ${i + 1} (${JSON.stringify(step)}): the file is ${notation(given)}, not ${notation(held)}`,
          );
        }
      }
      const more = unreadItems(editor.getDoc()) - unread;
      if (more > 0) {
        listReadFailures.push(
          `step ${i + 1} (${JSON.stringify(step)}): ${more} more lines start an item than micromark reads in ${notation(bodyOf(editor.getDoc()))}`,
        );
      }
      return { step, handled, before, after: editor.getDoc(), caretLine };
    });
    const result: ScriptResult = {
      script,
      start,
      file: editor.getDoc(),
      caret: caretText(editor),
      steps,
      refusals: [...mounted.refusals],
      hiddenCaret: hiddenAt(editor),
      undoFailures: options.light ? [] : undoEach(script, expanded),
      openCaretFailures,
      listReadFailures,
      historyFailures: [],
      fileTextFailures,
      openItem: openBlock(editor.view.state)?.item === true,
    };
    if (!options.light)
      result.historyFailures = undoAllTheWay(
        editor.view,
        seen,
        expanded.text.replaceAll('\r\n', '\n'),
      );
    if (!options.light && script.keys.length === 1 && script.keys[0] === 'Enter') {
      const again = mount(script, expanded);
      try {
        play(again.editor, 'Enter');
        // A Return the key refused made no line break to take back: Backspace then is Backspace.
        if (!again.refusals.length) {
          play(again.editor, 'Backspace');
          result.takenBack = again.editor.getDoc();
        }
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

/** A line of indented code: four spaces or a tab, then text that is no list item or quote. */
const CODE_LINE = /^(?: {4,}|\t)(?![-*+][ \t]|\d{1,9}[.)][ \t]|>)\S/;

/**
 * Whether the blank lines before line `next` (the first line that is not blank) are in indented
 * code, where blank lines are content, no paragraph break: the lines on both sides are code, or the
 * line above closes a fence and the one below is code.
 */
function inIndentedCode(lines: string[], next: number): boolean {
  if (!CODE_LINE.test(lines[next] ?? '')) return false;
  let above = next - 1;
  while (above >= 0 && BLANK.test(lines[above] ?? '')) above--;
  if (above < 0) return false;
  return CODE_LINE.test(lines[above] ?? '') || FENCE.test(lines[above] ?? '');
}

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
  const endRun = (atEnd: boolean, next = -1) => {
    const atStart = runStart === 0;
    if (next >= 0 && inIndentedCode(lines, next)) run = 0;
    if (run >= 3 || (run >= 2 && (atStart || atEnd))) {
      found.push(`an empty paragraph at line ${runStart + 1} (${run} blank lines)`);
    }
    run = 0;
  };
  // Front matter's lines are its content: its blank lines are no empty paragraphs.
  const matter =
    lines[0] === '---' ? lines.findIndex((l, i) => i > 0 && /^(?:---|\.\.\.)$/.test(l)) : -1;
  lines.forEach((line, i) => {
    if (i <= matter) return;
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
    endRun(false, i);
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
  // Front matter's lines are its content, and a blank line in indented code is code.
  const matter =
    lines[0] === '---' ? lines.findIndex((l, i) => i > 0 && /^(?:---|\.\.\.)$/.test(l)) : -1;
  const end = (i: number) => {
    if (run === 2 && i - run > 0 && i > matter && !inIndentedCode(lines, i)) {
      found.push(`a stray blank line at line ${i}`);
    }
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

/** The ids of the marks of a file that are decided (not comments and highlights), once each. */
function marksOf(text: string): string[] {
  return [
    ...new Set(
      parse(text)
        .marks.filter((mark) => mark.kind !== 'cmt' && mark.kind !== 'hl')
        .map((mark) => mark.id),
    ),
  ];
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
  // The halves of a move of a row are one decision: either half decides both (format §3.7), so a
  // set that accepts one and rejects the other has no reading, and the first one decided wins.
  const partner = new Map<string, string>();
  for (const mark of parse(file).marks) {
    if (mark.entry.move !== undefined) partner.set(mark.id, mark.entry.move);
  }
  const canon = (id: string) => {
    const other = partner.get(id);
    return other !== undefined && other < id ? other : id;
  };
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
    // The marks that a decision frees (those in the old text of a replacement that is decided) are
    // decided too, after the ones that were there, with the same choice: an order of decisions
    // ends only when no mark is left (#808).
    const known = new Set(order);
    const freed = () => {
      const found = marksOf(text).filter((id) => !known.has(id));
      for (const id of found) known.add(id);
      return found;
    };
    let pending = order.filter(present);
    for (let progress = true; pending.length > 0 && progress;) {
      progress = false;
      const later: string[] = [];
      for (const id of pending) {
        if (!present(id)) continue;
        const next = decideOne(text, id, how(canon(id)));
        if (next === undefined) later.push(id);
        else {
          text = next;
          progress = true;
          later.push(...freed());
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
export function decisionProblems(
  file: string,
  decideOne: (text: string, id: string, how: 'a' | 'r') => string | undefined = decided,
): string[] {
  const all = marksOf(file);
  if (all.length === 0) return [];
  // A long file with many marks (a widened replacement holds the marks in its old text) is sampled:
  // the full walk parses it at every step.
  if (all.length > DECISION_LIMIT || file.length > 800) {
    return sampleDecisions(file, all, decideOne);
  }
  const outcomes = new Map<string, Set<string>>();
  const problems: string[] = [];
  const seen = new Set<string>();
  // A decision that is refused in every state of the walk is one a person can't make (#591).
  const worked = new Set<string>();
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
        const next = decideOne(text, id, how);
        if (next === undefined) continue;
        any = true;
        worked.add(`${how}${id}`);
        walk(next, [...path, `${how}${id}`]);
      }
    }
    if (!any) problems.push(`no decision can be made on ${notation(bodyOf(text))}`);
  };
  walk(file, []);
  for (const id of all) {
    for (const how of ['a', 'r'] as const) {
      if (!worked.has(`${how}${id}`)) {
        problems.push(
          `${how === 'a' ? 'accepting' : 'rejecting'} ${id} is refused in every state, in ${notation(bodyOf(file))}`,
        );
      }
    }
  }
  for (const [set, results] of outcomes) {
    if (results.size > 1) {
      problems.push(`${set || 'no decisions'} reads ${[...results].map(notation).join(' or ')}`);
    }
  }
  // The outcomes where every decision was made the one way. A decision may remove marks that were
  // not decided (those inside a replacement's old text), so the set need not name every mark.
  const allWays = (how: 'a' | 'r') => {
    const found: string[] = [];
    for (const [set, results] of outcomes) {
      const tokens = set.split(' ').filter(Boolean);
      if (tokens.every((token) => token.startsWith(how))) found.push(...results);
    }
    return found;
  };
  // acceptAll and rejectAll, over every mark, comments and highlights too.
  const everything = (changes: () => ReturnType<typeof acceptAll>) => {
    try {
      return newestView(applyChanges(file, changes())).text;
    } catch (error) {
      if (error instanceof EditError) return undefined;
      throw error;
    }
  };
  if (everything(() => acceptAll(file)) !== newestView(file).text) {
    problems.push('acceptAll does not give the newest view');
  }
  if (everything(() => rejectAll(file)) !== originalView(file).text) {
    problems.push('rejectAll does not give the original view');
  }
  const accepted = allWays('a');
  const rejected = allWays('r');
  const newest = newestView(file).text;
  const original = originalView(file).text;
  if (accepted.length === 0) problems.push('no order of decisions accepts every mark');
  if (rejected.length === 0) problems.push('no order of decisions rejects every mark');
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
  const problems = invariantProblems(result);
  for (const invariant of Object.keys(problems) as Invariant[]) {
    const found = problems[invariant];
    if (holds(invariant)) expect(found, `${name}: ${invariant}`).toEqual([]);
    else if (invariant !== 'take-back' || result.takenBack !== undefined) {
      expect(found, `${name}: the skip of ${invariant} is no longer needed`).not.toEqual([]);
    }
  }
}

/** What each invariant finds wrong with a played script: nothing, where it holds. */
export function invariantProblems(result: ScriptResult): Record<Invariant, string[]> {
  const { file } = result;
  const body = bodyOf(file);
  return {
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
    'list-reads': result.listReadFailures,
    'open-caret': result.openCaretFailures,
    history: result.historyFailures,
    'file-text': result.fileTextFailures,
  };
}

/** Registers one test for each script: played, then checked. */
export function scriptRows(rows: Script[], timeout?: number): void {
  for (const row of rows) {
    it(row.name, () => checkInvariants(runScript(row)), timeout);
  }
}
