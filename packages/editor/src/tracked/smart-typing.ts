// Help while typing, switched on and off in Preferences: curly quotes and real dashes, closing
// brackets and backticks, and spell check. Each is an input handler (or an attribute), so what it
// writes is typing like any other and Track Changes records it as such: a pair closed with
// tracking on is one insertion, and the caret stays inside it, so that what is typed next extends
// it. None of it happens in code, where the characters mean themselves, or in Raw, where the
// source is shown as it is.

import { syntaxTree } from '@codemirror/language';
import { type EditorState, type Extension, type TransactionSpec } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { EditorTyping } from '../api.ts';
import { frontMatterEnd } from '../preview/decorations.ts';
import { bodyEnd, parsedField, viewModeField } from './field.ts';

const CODE = new Set(['InlineCode', 'FencedCode', 'CodeBlock', 'CodeText']);
const MARKER = /<!--[^>]*-->$/;
const LEADING_MARKER = /^<!--[^>]*-->/;
const WORD = /[\p{L}\p{N}]/u;
/** What a pair may close in front of: a space, a line end, or punctuation that ends a phrase. */
const BEFORE_CLOSE = /^$|^[\s)\]}>.,;:!?"'”’]/u;
const CLOSERS: Readonly<Record<string, string>> = { '(': ')', '[': ']', '{': '}', '`': '`' };
const CLOSING = new Set([')', ']', '}', '`']);
const OPENING_CONTEXT = /^$|[\s([{“‘—–/-]$/u;

function inCode(state: EditorState, pos: number): boolean {
  for (let node = syntaxTree(state).resolveInner(pos, -1); node.parent; node = node.parent) {
    if (CODE.has(node.name)) return true;
  }
  return false;
}

/**
 * Where the characters mean themselves: code, the leading YAML front matter, the ledger at the end
 * of the file, and HTML comments, which include the markers of tracked changes.
 */
function leavesAlone(state: EditorState, from: number, to: number): boolean {
  if (inCode(state, from)) return true;
  const front = frontMatterEnd(state.doc);
  if (front !== null && from <= front) return true;
  const ledger = bodyEnd(state.field(parsedField));
  if (ledger !== null && to > ledger) return true;
  // Inside a comment: the last `<!--` before the caret has no `-->` after it yet.
  const before = state.doc.sliceString(0, from);
  return before.lastIndexOf('<!--') > before.lastIndexOf('-->');
}

/** The text before `pos` on its line, without the markers of tracked changes that end it. */
function textBefore(state: EditorState, pos: number): string {
  let text = state.doc.lineAt(pos).text.slice(0, pos - state.doc.lineAt(pos).from);
  while (MARKER.test(text)) text = text.replace(MARKER, '');
  return text;
}

/**
 * The text after `pos` on its line, without the markers of tracked changes that start it, and how
 * many characters those markers take.
 */
function textAfter(state: EditorState, pos: number): { text: string; skipped: number } {
  const line = state.doc.lineAt(pos);
  const all = line.text.slice(pos - line.from);
  let text = all;
  while (LEADING_MARKER.test(text)) text = text.replace(LEADING_MARKER, '');
  return { text, skipped: all.length - text.length };
}

/** What typing does instead of the character: a transaction, and how far back the caret goes. */
export interface TypedAs {
  spec: TransactionSpec;
  /** Characters the caret steps back from the end of what was written, to sit inside a pair. */
  caretBack: number;
}

/** A change, with the caret after what it writes, or `caretBack` characters before that. */
function write(change: { from: number; to: number; insert: string }, caretBack = 0): TypedAs {
  return {
    spec: { changes: change, selection: { anchor: change.from + change.insert.length } },
    caretBack,
  };
}

/** What typing `typed` at `from`–`to` does, or null when it is typed as it is. */
export function typedAs(
  state: EditorState,
  typing: Pick<EditorTyping, 'smartPunctuation' | 'closePairs'>,
  from: number,
  to: number,
  typed: string,
): TypedAs | null {
  if ([...typed].length !== 1) return null;
  if (state.field(viewModeField) === 'raw' || leavesAlone(state, from, to)) return null;
  const before = textBefore(state, from);
  const { text: after, skipped } = textAfter(state, to);
  const previous = [...before].at(-1) ?? '';

  if (typing.smartPunctuation) {
    if (typed === '"' || typed === "'") {
      const opening = OPENING_CONTEXT.test(before);
      const curly = typed === '"' ? (opening ? '“' : '”') : opening ? '‘' : '’';
      return write({ from, to, insert: curly });
    }
    // Two hyphens make an em dash, except where they start a line, which Markdown reads as a rule.
    if (
      typed === '-' &&
      from === to &&
      from > 0 &&
      state.doc.sliceString(from - 1, from) === '-' &&
      /\S/.test(before.slice(0, -1)) &&
      !before.endsWith('--')
    ) {
      return write({ from: from - 1, to, insert: '—' });
    }
  }

  if (typing.closePairs && from === to) {
    const closer = CLOSERS[typed];
    // Typing over the closer that is already there.
    if (CLOSING.has(typed) && after.startsWith(typed) && !(typed === '`' && previous === '`')) {
      // After the closer itself, past any marker between it and the caret.
      return { spec: { selection: { anchor: to + skipped + 1 } }, caretBack: 0 };
    }
    // A third backtick, typed between two, is a fence: no stray one is left behind.
    if (typed === '`' && previous === '`' && after.startsWith('`')) {
      return write({ from, to: to + 1, insert: '`' });
    }
    if (closer !== undefined && BEFORE_CLOSE.test(after)) {
      // A backtick closes only where a code span could start, and never inside a word.
      const symmetric = closer === typed;
      if (symmetric && (WORD.test(previous) || previous === typed)) return null;
      return write({ from, to, insert: typed + closer }, 1);
    }
  }
  return null;
}

/** The input handlers and attributes for the typing the person asked for. */
export function typingExtensions(typing: EditorTyping): Extension {
  return [
    // Autocorrect stays off, as CodeMirror has it: while WebKit checks spelling, it replaces a
    // misspelled word as it is typed unless the element says autocorrect="off", and the replacement
    // would be recorded as the person's typing.
    EditorView.contentAttributes.of({
      spellcheck: typing.spellCheck ? 'true' : 'false',
      autocorrect: 'off',
    }),
    EditorView.inputHandler.of((view, from, to, text) => {
      const typed = typedAs(view.state, typing, from, to, text);
      if (!typed) return false;
      view.dispatch({ ...typed.spec, scrollIntoView: true, userEvent: 'input.type' });
      // With Track Changes on, the caret follows the tracked insertion, which ends where the pair
      // does: a second step puts it inside, and leaves the insertion as one.
      if (typed.caretBack) {
        const { head } = view.state.selection.main;
        view.dispatch({ selection: { anchor: head - typed.caretBack }, userEvent: 'select' });
      }
      return true;
    }),
  ];
}
