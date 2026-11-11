// A word ended with Return or Shift-Return gets the Mac's correction too (design §5.1). WebKit
// corrects a word only around text it types itself, and the editor handles these keys on its own
// (blocks/keys.ts), so WebKit never sees the word end. Here the editor asks the host for the
// correction of the word before the break, and makes it as it makes WebKit's: corrections.ts.
//
// The break goes in at once; the answer is awaited by no one. When it comes, the correction is made
// only if the word is still exactly where it was, its position mapped through the changes since,
// and the editor isn't in Raw. A key that ends no word asks nothing: Tab changes the block, not the
// words, and moving away, with the arrows or a click, never corrects, nor does any ⌘ key. Only a
// word asks (letters, with an apostrophe inside), so a Return after a number or a closing
// parenthesis costs nothing, and where the Mac corrects nothing on its own, in code, a URL, front
// matter or an HTML comment, no one is asked.

import { ChangeSet, type EditorState, type Extension } from '@codemirror/state';
import { type EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import type { Range } from '@redlines/format';
import { correctText, pointAt, shownRuns, shownText } from './corrections.ts';
import { autocorrects } from './smart-typing.ts';

/** What the host is asked: the correction of `word`, or null. `before` is the block up to it. */
export type CorrectWord = (word: string, before: string) => Promise<string | null>;

/** A word, with an apostrophe inside, at the end of the text. */
const WORD_AT_END = /\p{L}+(?:['’]\p{L}+)*$/u;
/** What the caret may not touch before the word. */
const BEFORE_WORD = /[\p{L}\p{N}'’]$/u;
/** What would make the word at the caret only the start of a longer one. */
const AFTER_WORD = /^(?:[\p{L}\p{N}]|['’]\p{L})/u;
/** How far back the block is read for the host, in characters and in lines. */
const CONTEXT_CHARS = 300;
const CONTEXT_LINES = 10;

/** A question sent, whose answer is awaited: the word, mapped through the changes since. */
interface Ask extends Range {
  /** The text the page shows there. */
  word: string;
  /**
   * What the break wrote, mapped through the changes since. Empty once the break is gone: undone
   * with Undo or Backspace, deleted or replaced. The answer then comes too late.
   */
  broke: Range;
}

/** The last `CONTEXT_CHARS` units of `text`, without half of a surrogate pair at the cut. */
function lastChars(text: string): string {
  const cut = text.slice(-CONTEXT_CHARS);
  const first = cut.charCodeAt(0);
  return text.length > CONTEXT_CHARS && first >= 0xdc00 && first < 0xe000 ? cut.slice(1) : cut;
}

/** The word before the caret and the block's text before it, or null where nobody is asked. */
function wordBeforeCaret(
  view: EditorView,
  state: ViewUpdate['startState'],
): { ask: Omit<Ask, 'broke'>; before: string } | null {
  if (state.selection.ranges.length !== 1 || !state.selection.main.empty) return null;
  const { head } = state.selection.main;
  const line = state.doc.lineAt(head);
  const runs = shownRuns(state, line.from, head);
  const text = shownText(state, runs);
  const found = WORD_AT_END.exec(text);
  if (!found) return null;
  if (BEFORE_WORD.test(text.slice(0, found.index))) return null;
  const after = shownText(state, shownRuns(state, head, line.to));
  if (AFTER_WORD.test(after)) return null;
  const from = pointAt(runs, found.index, 1);
  const to = pointAt(runs, found.index + found[0].length, -1);
  if (!autocorrects(state, from, to) || view.composing) return null;
  // The block up to the word: its lines back to a blank one.
  let first = line.number;
  while (first > 1 && line.number - first < CONTEXT_LINES && state.doc.line(first - 1).length > 0) {
    first--;
  }
  const before = shownText(state, shownRuns(state, state.doc.line(first).from, from));
  return { ask: { from, to, word: found[0] }, before: lastChars(before) };
}

/**
 * Whether the word is still a word of its own: no letter, digit or apostrophe joins it on either
 * side, on its line, once the markers of tracked changes are left out.
 */
function standsAlone(state: EditorState, word: Range): boolean {
  const line = state.doc.lineAt(word.from);
  const before = shownText(state, shownRuns(state, line.from, word.from));
  if (BEFORE_WORD.test(before)) return false;
  const lineEnd = state.doc.lineAt(word.to).to;
  return !AFTER_WORD.test(shownText(state, shownRuns(state, word.to, lineEnd)));
}

/**
 * Asks `correctWord` about the word a Return or Shift-Return ends, while `enabled`, and makes the
 * answer as a correction of its own.
 */
export function breakCorrection(
  correctWord: CorrectWord | undefined,
  enabled: () => boolean,
): Extension {
  if (!correctWord) return [];
  return ViewPlugin.fromClass(
    class {
      /** Whether the key being pressed is Return or Shift-Return, with no ⌘ or Control. */
      keyed = false;
      readonly asks = new Set<Ask>();
      destroyed = false;

      readonly view: EditorView;

      constructor(view: EditorView) {
        this.view = view;
      }

      update(update: ViewUpdate): void {
        if (!update.docChanged) return;
        for (const ask of this.asks) {
          // Text added at either end of the word makes it another word.
          ask.from = update.changes.mapPos(ask.from, -1);
          ask.to = Math.max(ask.from, update.changes.mapPos(ask.to, 1));
          // Inside out, so that a break replaced or deleted whole leaves nothing.
          ask.broke = {
            from: update.changes.mapPos(ask.broke.from, 1),
            to: update.changes.mapPos(ask.broke.to, -1),
          };
        }
        if (!this.keyed || !enabled()) return;
        for (const [i, tr] of update.transactions.entries()) {
          if (!tr.docChanged || !tr.isUserEvent('input.break')) continue;
          this.keyed = false;
          const found = wordBeforeCaret(this.view, tr.startState);
          if (!found) return;
          // What the break wrote: the first text written at the caret or after it (Track Changes
          // writes it after the marker that closes your insertion).
          const { head } = tr.startState.selection.main;
          const wrote: Range[] = [];
          tr.changes.iterChanges((fromA, toA, fromB, toB) => {
            if (fromA >= head && toB > fromB) wrote.push({ from: fromB, to: toB });
          });
          const broke = wrote[0];
          if (!broke) return;
          // Where the word and the break are, with whatever came in the same update after it.
          let changes = tr.changes;
          for (const later of update.transactions.slice(i + 1))
            changes = changes.compose(later.changes);
          const { before } = found;
          // The break goes in at the word's end, after it.
          const from = changes.mapPos(found.ask.from, -1);
          const to = Math.max(from, changes.mapPos(found.ask.to, -1));
          const rest = update.transactions
            .slice(i + 1)
            .reduce((set, later) => set.compose(later.changes), ChangeSet.empty(tr.newDoc.length));
          this.ask(
            {
              from,
              to,
              word: found.ask.word,
              broke: { from: rest.mapPos(broke.from, 1), to: rest.mapPos(broke.to, -1) },
            },
            before,
          );
          return;
        }
      }

      private ask(ask: Ask, before: string): void {
        let answer: Promise<string | null>;
        try {
          answer = correctWord(ask.word, before);
        } catch {
          return;
        }
        this.asks.add(ask);
        answer.then(
          (text) => this.answered(ask, text),
          () => this.asks.delete(ask),
        );
      }

      private answered(ask: Ask, text: string | null): void {
        if (this.destroyed || !this.asks.delete(ask)) return;
        if (!text || text === ask.word || /[\r\n]/.test(text) || !enabled()) return;
        // The Return was taken back: nothing is made that would cut the redo of it off.
        if (ask.broke.to <= ask.broke.from) return;
        if (!standsAlone(this.view.state, ask)) return;
        // Made only where the word is still exactly as it was, and where the Mac corrects.
        correctText(this.view, ask, ask.word, text, false);
      }

      destroy(): void {
        this.destroyed = true;
        this.asks.clear();
      }
    },
    {
      eventObservers: {
        keydown(event) {
          this.keyed =
            event.key === 'Enter' && !event.metaKey && !event.ctrlKey && !event.isComposing;
        },
        keyup() {
          this.keyed = false;
        },
        mousedown() {
          this.keyed = false;
        },
      },
    },
  );
}
