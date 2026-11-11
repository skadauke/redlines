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

import type { Extension } from '@codemirror/state';
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
}

/** The word before the caret and the block's text before it, or null where nobody is asked. */
function wordBeforeCaret(
  view: EditorView,
  state: ViewUpdate['startState'],
): { ask: Ask; before: string } | null {
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
  return { ask: { from, to, word: found[0] }, before: before.slice(-CONTEXT_CHARS) };
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
        }
        if (!this.keyed || !enabled()) return;
        for (const [i, tr] of update.transactions.entries()) {
          if (!tr.docChanged || !tr.isUserEvent('input.break')) continue;
          this.keyed = false;
          const found = wordBeforeCaret(this.view, tr.startState);
          if (!found) return;
          // Where the word is after the break, and whatever came in the same update after it.
          let changes = tr.changes;
          for (const later of update.transactions.slice(i + 1))
            changes = changes.compose(later.changes);
          const { ask, before } = found;
          // The break goes in at the word's end, after it.
          ask.from = changes.mapPos(ask.from, -1);
          ask.to = Math.max(ask.from, changes.mapPos(ask.to, -1));
          this.ask(ask, before);
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
