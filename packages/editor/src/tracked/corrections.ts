// Corrections the Mac makes to the text (design §5.1): autocorrection, text replacements, smart
// quotes and dashes, and a spelling suggestion picked from the context menu. WebKit makes each as
// an editing command of its own: it sends a cancelable beforeinput event of type
// insertReplacementText, whose target range is the text it replaces and whose dataTransfer holds
// the new text, and then, unless the event is canceled, rewrites the page, which CodeMirror reads
// back as typing. That rewrite takes no notice of hidden markers, and would delete one that the
// word reaches across; and as typing, it would be undone with the typing before it.
//
// So the editor cancels the event and makes the correction itself, as an edit of the text the page
// shows. Track Changes takes it as typing: inside your own pending insertion it changes the
// insertion's text, and other text it reaches into becomes a tracked change of that part only. No
// edit reaches across hidden text: the parts on either side are edited apart, and a correction the
// page can't be read for is left out. Each correction is a step of its own, which Undo takes back
// first. One that WebKit makes on its own, as you type, is left out where the characters mean
// themselves (`autocorrects`); one you pick from the context menu is made wherever you can edit.

import { isolateHistory } from '@codemirror/commands';
import {
  ChangeSet,
  EditorSelection,
  type EditorState,
  type Extension,
  Prec,
  Transaction,
} from '@codemirror/state';
import { type EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import type { Range, TextChange } from '@redlines/format';
import { atomsOf } from './decorations.ts';
import { autocorrects } from './smart-typing.ts';

/**
 * The user event of a correction WebKit makes on its own. Track Changes leaves one it can't make
 * out unsaid, as if it had never been offered.
 */
export const AUTOCORRECTION = 'input.correct';
/** The user event of a correction picked from the context menu. */
const PICKED = 'input.replace';

/**
 * How long after a key that the browser types WebKit's own corrections come: in the same task, or
 * a little later where spelling is checked in the background.
 */
const TYPED_MS = 1000;
/**
 * How long the caret a correction left is kept when the page never says where its own caret is: a
 * backstop. The page says so once, right after the key, however long that takes.
 */
const CLAIM_MS = 5000;

/**
 * The stretches of `from`–`to` that the page shows as text, without the text it hides: markers,
 * which may draw deleted text, and the ledger.
 */
function shownRuns(state: EditorState, from: number, to: number): Range[] {
  const runs: Range[] = [];
  let pos = from;
  atomsOf(state).between(from, to, (start, end) => {
    if (start > pos) runs.push({ from: pos, to: Math.min(start, to) });
    pos = Math.max(pos, end);
  });
  if (pos < to) runs.push({ from: pos, to });
  return runs;
}

const shownText = (state: EditorState, runs: readonly Range[]) =>
  runs.map((run) => state.sliceDoc(run.from, run.to)).join('');

/**
 * The position `n` characters into the shown text of `runs`: where one stretch ends and the next
 * starts, the end of the first (`side` -1) or the start of the next (1).
 */
function pointAt(runs: readonly Range[], n: number, side: -1 | 1): number {
  let offset = 0;
  for (const [i, run] of runs.entries()) {
    const length = run.to - run.from;
    if (n < offset + length || (n === offset + length && (side < 0 || i === runs.length - 1))) {
      return run.from + n - offset;
    }
    offset += length;
  }
  return runs.at(-1)?.to ?? 0;
}

const isHighSurrogate = (code: number) => code >= 0xd800 && code < 0xdc00;
const isLowSurrogate = (code: number) => code >= 0xdc00 && code < 0xe000;

/**
 * The edits that turn the text the page shows from `from` to `to`, which must read `replaced`, into
 * `text`: the stretch that differs, or where that reaches across hidden text, its part in each
 * stretch of shown text, the new text in the last one, nearest the caret. Null when the page shows
 * other text there, such as deleted text drawn in the word.
 */
export function correctionEdits(
  state: EditorState,
  from: number,
  to: number,
  replaced: string,
  text: string,
): TextChange[] | null {
  const runs = shownRuns(state, from, to);
  const shown = shownText(state, runs);
  if (!runs.length || shown !== replaced) return null;
  const most = Math.min(shown.length, text.length);
  let start = 0;
  while (start < most && shown.charCodeAt(start) === text.charCodeAt(start)) start++;
  let end = 0;
  while (
    end < most - start &&
    shown.charCodeAt(shown.length - 1 - end) === text.charCodeAt(text.length - 1 - end)
  ) {
    end++;
  }
  // A cut never falls between the two halves of a surrogate pair.
  if (start > 0 && isHighSurrogate(shown.charCodeAt(start - 1))) start--;
  if (end > 0 && isLowSurrogate(shown.charCodeAt(shown.length - end))) end--;
  const insert = text.slice(start, text.length - end);
  const cutTo = shown.length - end;
  if (start === cutTo) {
    // Text added and none taken: it goes in before hidden text there, as typing would.
    if (!insert) return [];
    const at = pointAt(runs, start, -1);
    return [{ from: at, to: at, insert }];
  }
  const pieces: Range[] = [];
  let offset = 0;
  for (const run of runs) {
    const length = run.to - run.from;
    const lo = Math.max(start, offset);
    const hi = Math.min(cutTo, offset + length);
    if (lo < hi) pieces.push({ from: run.from + lo - offset, to: run.from + hi - offset });
    offset += length;
  }
  return pieces.map((piece, i) => ({ ...piece, insert: i === pieces.length - 1 ? insert : '' }));
}

/** A correction WebKit asked for, to be made once CodeMirror has read the page. */
interface Pending {
  /** What it replaces in the text, mapped through the changes since. */
  from: number;
  to: number;
  /** The text the page showed there. */
  replaced: string;
  text: string;
  /** The page's text between it and the caret, when the caret was after it. */
  gap: string | null;
  /**
   * Chosen by the person, as a spelling suggestion from the context menu, rather than made by
   * WebKit as they type.
   */
  picked: boolean;
  /** Made as a key was pressed, before the key's text went in: it waits for the text. */
  waiting: boolean;
}

/**
 * Where a correction's text is now: where it was, or, when WebKit made it at a caret past text
 * CodeMirror had yet to read, `gap` before the caret. Null when the text there is another.
 */
function locate(state: EditorState, pending: Pending): Range | null {
  const { from, to, replaced, gap } = pending;
  const there = shownRuns(state, from, to);
  // From the first shown character to the last, without hidden text at either end.
  if (there.length && shownText(state, there) === replaced) {
    return { from: there[0]!.from, to: there.at(-1)!.to };
  }
  const { main } = state.selection;
  if (gap === null || gap.includes('\n') || !main.empty) return null;
  const runs = shownRuns(state, state.doc.lineAt(main.head).from, main.head);
  const shown = shownText(state, runs);
  const tail = replaced + gap;
  if (!shown.endsWith(tail)) return null;
  const start = shown.length - tail.length;
  return { from: pointAt(runs, start, 1), to: pointAt(runs, start + replaced.length, -1) };
}

/** The page's text from the end of `target` to the caret, or null when the caret isn't after it. */
function gapToCaret(view: EditorView, target: StaticRange): string | null {
  const page = view.dom.ownerDocument;
  const selection = page.getSelection();
  const node = selection?.focusNode;
  if (!selection?.isCollapsed || !node || !view.contentDOM.contains(node)) return null;
  const range = page.createRange();
  range.setStart(target.endContainer, target.endOffset);
  if (range.comparePoint(node, selection.focusOffset) < 0) return null;
  range.setEnd(node, selection.focusOffset);
  return range.toString();
}

class Corrections {
  readonly view: EditorView;
  pending: Pending[] = [];
  /** When a key was last pressed that the browser types. */
  typedAt = 0;
  /** Whether that key's text is still to go in. */
  keyText = false;
  /**
   * The caret a correction left. After a correction made after the key that ends the word, WebKit
   * puts its caret back by counting the paragraph's characters, which the deleted text a tracked
   * change shows throws off, and so does a correction that was left out, whose change in length
   * it counts all the same. Then the page says where its caret is, with the `selectionchange`
   * that the key's typing queued: the caret CodeMirror reads from the page on it is taken for
   * this one, however late it comes. `told`, once that event has come.
   */
  claim: { pos: number; told: boolean } | null = null;
  private scheduled = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private claimTimer: ReturnType<typeof setTimeout> | undefined;
  private destroyed = false;

  constructor(view: EditorView) {
    this.view = view;
    view.dom.ownerDocument.addEventListener('selectionchange', this.pageSelectionChanged);
  }

  update(update: ViewUpdate): void {
    if (update.docChanged) {
      // The only text typed meanwhile is at the caret: after the word, or the start of what WebKit
      // replaces, as a quote just typed.
      for (const pending of this.pending) {
        pending.from = update.changes.mapPos(pending.from, -1);
        pending.to = Math.max(pending.from, update.changes.mapPos(pending.to, -1));
      }
      // The key's text went in: the correction made before it follows it.
      const typed = update.transactions.some(
        (tr) =>
          tr.docChanged &&
          tr.isUserEvent('input') &&
          !tr.isUserEvent(AUTOCORRECTION) &&
          !tr.isUserEvent(PICKED),
      );
      if (typed && this.pending.some((pending) => pending.waiting)) {
        for (const pending of this.pending) pending.waiting = false;
        this.schedule();
      }
    }
    this.keepCaret(update);
  }

  /** WebKit asks to replace `target` in the page with `text`. */
  take(target: StaticRange, text: string): void {
    const { view } = this;
    const { contentDOM } = view;
    if (!contentDOM.contains(target.startContainer) || !contentDOM.contains(target.endContainer)) {
      this.claimCaret();
      return;
    }
    const range = contentDOM.ownerDocument.createRange();
    range.setStart(target.startContainer, target.startOffset);
    range.setEnd(target.endContainer, target.endOffset);
    const replaced = range.toString();
    // In the text as CodeMirror has read it so far. Text WebKit typed after the word that
    // CodeMirror has yet to read, as the space that ends it, doesn't move it: the correction is
    // made once CodeMirror has read that too, mapped through it.
    const from = view.posAtDOM(target.startContainer, target.startOffset);
    const to = view.posAtDOM(target.endContainer, target.endOffset);
    // WebKit makes its own corrections as a key is typed; one made otherwise, or of the selection,
    // the person chose, as from the context menu (WebKit selects the word it is opened on).
    const { main } = view.state.selection;
    const picked =
      this.typedAt < Date.now() - TYPED_MS || (!main.empty && main.from === from && main.to === to);
    const gap = picked ? null : gapToCaret(view, target);
    // With the correction bubble showing, WebKit corrects the word as the key that ends it is
    // pressed, before it types the key's text. The correction waits for that text, so that it
    // comes after it, as it does without the bubble: Undo then takes back the correction alone.
    const waiting = !picked && gap === '' && this.keyText;
    const same = this.pending.find(
      (p) => p.from === from && p.to === to && p.replaced === replaced && p.text === text,
    );
    // A correction canceled before the key's text, WebKit may make again after it: it is one.
    if (same) same.waiting &&= waiting;
    else this.pending.push({ from, to, replaced, text, gap, picked, waiting });
    this.schedule();
    if (waiting) {
      // A key that typed nothing after all.
      clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        for (const pending of this.pending) pending.waiting = false;
        this.settle();
      }, 0);
    }
  }

  /**
   * After the event: CodeMirror reads the page's changes in a microtask queued when they were
   * made, before this one, and WebKit goes on, putting its caret back, once both have run.
   */
  private schedule(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      this.settle();
    });
  }

  private settle(): void {
    let next: Pending | undefined;
    while (!this.destroyed && (next = this.pending.find((p) => !p.waiting))) {
      this.pending.splice(this.pending.indexOf(next), 1);
      this.make(next);
    }
  }

  private make(pending: Pending): void {
    const { view } = this;
    const { state } = view;
    const at = locate(state, pending);
    const edits =
      at && (pending.picked || autocorrects(state, at.from, at.to))
        ? correctionEdits(state, at.from, at.to, pending.replaced, pending.text)
        : null;
    if (edits?.length) {
      const changes = ChangeSet.of(edits, state.doc.length);
      view.dispatch({
        changes,
        // A suggestion you picked leaves the caret after it, as typing over the word would.
        selection: pending.picked
          ? EditorSelection.cursor(changes.mapPos(edits.at(-1)!.to, 1))
          : undefined,
        userEvent: pending.picked ? PICKED : AUTOCORRECTION,
        annotations: isolateHistory.of('full'),
        scrollIntoView: true,
      });
    }
    if (!pending.picked) this.claimCaret();
  }

  private claimCaret(): void {
    clearTimeout(this.claimTimer);
    const claim = { pos: this.view.state.selection.main.head, told: false };
    this.claim = claim;
    this.claimTimer = setTimeout(() => this.letGo(claim), CLAIM_MS);
  }

  /** Lets go of the caret a correction left, if it is `claim`, or any. */
  letGo(claim = this.claim): void {
    if (this.claim === claim) this.claim = null;
  }

  /**
   * The page says where its caret is. CodeMirror reads it on the same event, before this listener
   * or after it, so the claim lasts until the event is over.
   */
  private readonly pageSelectionChanged = (): void => {
    const { claim } = this;
    if (!claim || claim.told) return;
    claim.told = true;
    setTimeout(() => this.letGo(claim), 0);
  };

  private keepCaret(update: ViewUpdate): void {
    const { claim } = this;
    if (!claim) return;
    if (update.docChanged) {
      this.letGo(claim);
      return;
    }
    // CodeMirror read WebKit's caret from the page.
    const read = update.transactions.some(
      (tr) => tr.selection && tr.annotation(Transaction.userEvent) === 'select',
    );
    if (!read) return;
    this.letGo(claim);
    const { doc } = update.state;
    if (update.state.selection.main.head === claim.pos) return;
    queueMicrotask(() => {
      if (this.destroyed || this.view.state.doc !== doc) return;
      this.view.dispatch({ selection: EditorSelection.cursor(claim.pos) });
    });
  }

  destroy(): void {
    this.destroyed = true;
    clearTimeout(this.timer);
    clearTimeout(this.claimTimer);
    this.view.dom.ownerDocument.removeEventListener('selectionchange', this.pageSelectionChanged);
  }
}

const corrections = ViewPlugin.fromClass(Corrections, {
  eventHandlers: {
    beforeinput(event, view) {
      if (event.inputType !== 'insertReplacementText' || view.composing) return false;
      const text = event.dataTransfer?.getData('text/plain') || event.data;
      const [target] = event.getTargetRanges();
      if (!text || !target) return false;
      this.take(target, text);
      // CodeMirror cancels the event, and WebKit leaves the page alone.
      return true;
    },
    // After the key bindings, which handle a key the browser then doesn't type.
    keydown(event, view) {
      if (event.metaKey || event.ctrlKey || view.composing) return false;
      this.typedAt = Date.now();
      this.keyText = true;
      return false;
    },
  },
  eventObservers: {
    beforeinput(event) {
      if (event.inputType !== 'insertReplacementText') this.keyText = false;
    },
    keyup() {
      this.keyText = false;
    },
    keydown() {
      this.letGo();
    },
    mousedown() {
      this.letGo();
    },
    touchstart() {
      this.letGo();
    },
  },
});

/** The Mac's corrections, made as edits of the text the page shows (see above). */
export function systemCorrections(): Extension {
  // Lowest, so that its keydown handler sees only keys that no key binding took.
  return Prec.lowest(corrections);
}
