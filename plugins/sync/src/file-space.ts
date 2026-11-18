// A session's text is the file's: the authority, every replica and every update speak in the
// file's offsets, with each line break as the file has it (a CRLF is two characters). A window's
// document has LF line breaks only, and keeps the kind of each break in a record beside it
// (`line-breaks.ts`). Here the changes are mapped between the two at the boundary, both ways, so
// that neither the editor nor the authority knows of the other's offsets (#1057).

import { ChangeSet, Text } from '@codemirror/state';
import type { EditorState, StateEffect, Transaction } from '@codemirror/state';
import { addLineBreakStyles, docFileText, fileLineBreak, FileView } from '@redlines/editor';
import type { TextChange } from '@redlines/format';

/** The text the session holds for the document in `state`: the file's, line breaks as it has them. */
export function fileOf(state: EditorState): string {
  return docFileText(state) ?? state.doc.toString();
}

/** The way between the window's offsets and the file's, or null when they are the same. */
export function fileViewOf(state: EditorState): FileView | null {
  const text = docFileText(state);
  return text === null ? null : new FileView(text);
}

/** The file's text as a `Text`, the way a replica holds it (its lines split at LF alone). */
export function fileDoc(state: EditorState): Text {
  const text = docFileText(state);
  return text === null ? state.doc : Text.of(text.split('\n'));
}

/** The smallest single change that turns `from` into `to`, or null when they are the same. */
export function between(from: string, to: string): TextChange | null {
  if (from === to) return null;
  let start = 0;
  const limit = Math.min(from.length, to.length);
  while (start < limit && from.charCodeAt(start) === to.charCodeAt(start)) start++;
  let end = 0;
  while (
    end < limit - start &&
    from.charCodeAt(from.length - 1 - end) === to.charCodeAt(to.length - 1 - end)
  ) {
    end++;
  }
  return { from: start, to: from.length - end, insert: to.slice(start, to.length - end) };
}

/**
 * What a transaction did, as changes of the file's text; null when the document is its own file
 * text before and after (an LF file), and its changes are the file's as they are.
 */
export function fileChanges(tr: Transaction): { changes: ChangeSet; start: Text } | null {
  const was = docFileText(tr.startState);
  const now = docFileText(tr.state);
  if (was === null && now === null) return null;
  const before = was ?? tr.startState.doc.toString();
  const changes = fileChangesOf(before, now ?? tr.state.doc.toString(), tr);
  return { changes, start: was === null ? tr.startState.doc : Text.of(before.split('\n')) };
}

function fileChangesOf(before: string, after: string, tr: Transaction): ChangeSet {
  const old = new FileView(before);
  const next = new FileView(after);
  const list: TextChange[] = [];
  tr.changes.iterChanges((fromA, toA, fromB, toB) => {
    list.push({
      from: old.toFile(fromA),
      to: old.toFile(toA),
      insert: after.slice(next.toFile(fromB), next.toFile(toB)),
    });
  });
  try {
    const set = ChangeSet.of(list, before.length, '\n');
    // An edit can change a break beyond its own range (a CR that meets an LF reads as one CRLF,
    // the ledger's breaks follow the body's): then the one change from the text before to the text
    // after is the file's.
    if (set.apply(Text.of(before.split('\n'))).toString() === after) return set;
  } catch {
    // Fall through to the one change.
  }
  const one = between(before, after);
  return one ? ChangeSet.of(one, before.length, '\n') : ChangeSet.empty(before.length);
}

/**
 * Changes of the file's text, as the transaction spec that makes them in the window's document,
 * with the kind of each line break they bring that isn't the file's own.
 */
export function intoDoc(
  state: EditorState,
  changes: ChangeSet | TextChange,
): { changes: ChangeSet | TextChange | TextChange[]; effects: StateEffect<unknown>[] } {
  const list: TextChange[] = [];
  if (changes instanceof ChangeSet) {
    changes.iterChanges((from, to, _fromB, _toB, inserted) => {
      list.push({ from, to, insert: inserted.toString() });
    });
  } else {
    list.push(changes);
  }
  const text = docFileText(state);
  if (text === null && !list.some((change) => change.insert.includes('\r'))) {
    return { changes, effects: [] };
  }
  const before = text ?? state.doc.toString();
  const brought = new FileView(before).changesToDoc(
    list.map((change) => wholeBreaks(before, change)),
    fileLineBreak(state) ?? '\n',
  );
  return {
    changes: brought.changes,
    effects: brought.styles.length ? [addLineBreakStyles.of(brought.styles)] : [],
  };
}

/**
 * A change of the file widened to whole line breaks: one that starts or ends between a CR and its
 * LF takes the whole CRLF in, with the character it takes in written again, so that the document,
 * which has one LF there, can make it.
 */
function wholeBreaks(text: string, change: TextChange): TextChange {
  let { from, to, insert } = change;
  if (from > 0 && text[from - 1] === '\r' && (text[from] === '\n' || insert.startsWith('\n'))) {
    from--;
    insert = `\r${insert}`;
  }
  if (text[to] === '\n' && (insert.endsWith('\r') || (to > 0 && text[to - 1] === '\r'))) {
    to++;
    insert = `${insert}\n`;
  }
  return { from, to, insert };
}
