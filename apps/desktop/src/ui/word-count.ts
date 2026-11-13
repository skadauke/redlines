// The word count in the window's lower right corner (design §5.1): a small gray label that stays
// there while the person writes, "1,204 words", and with a selection "120 of 1,204 words". It
// counts what a reader sees, as the file name's hover facts do (the newest text, never the markers
// or the ledger), and on idle, a moment after the last change, so that typing never waits for it and
// a long document stays fast. It sits on a fade of the page's color, as the title bar does at the
// top, so that text and notes that scroll under it never meet it. Preferences can hide it.

import { newestView } from '@redlines/format';
import { wordCount } from './titlebar.ts';

/** How long after the last change the words are counted. */
export const IDLE_MS = 400;

/** What the label counts. */
export interface Words {
  total: number;
  /** The words a selection covers, or null when nothing with a word in it is selected. */
  selected: number | null;
}

/**
 * The words of `source`, a document with its markers and ledger, as a reader sees them, and of the
 * selection `from` to `to` in it, which is mapped to the same text.
 */
export function wordsIn(source: string, selection: { from: number; to: number }): Words {
  const view = newestView(source);
  const total = wordCount(view.text);
  if (selection.from === selection.to) return { total, selected: null };
  const from = view.map.fromSource(selection.from);
  const to = view.map.fromSource(selection.to);
  const selected = wordCount(view.text.slice(from, to));
  return { total, selected: selected > 0 ? selected : null };
}

/** "1,204 words", or "120 of 1,204 words" with a selection. */
export function wordCountLabel(total: number, selected: number | null): string {
  const all = `${total.toLocaleString()} ${total === 1 ? 'word' : 'words'}`;
  return selected === null ? all : `${selected.toLocaleString()} of ${all}`;
}

export interface WordCount {
  /** The document or the selection changed: counts once the changes stop. */
  schedule(): void;
  /** Shows the label and counts at once, or hides it and counts nothing. */
  setVisible(visible: boolean): void;
  destroy(): void;
}

/**
 * Adds the label to `parent`, which the page's lower right corner is in. `source.count` is asked
 * only while the label is shown, and after the changes have stopped for `IDLE_MS`.
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
  let timer: ReturnType<typeof setTimeout> | undefined;

  const show = () => {
    const { total, selected } = source.count();
    label.textContent = wordCountLabel(total, selected);
  };

  return {
    schedule() {
      clearTimeout(timer);
      if (visible) timer = setTimeout(show, IDLE_MS);
    },
    setVisible(next) {
      if (next === visible) return;
      visible = next;
      footer.hidden = !next;
      clearTimeout(timer);
      if (next) show();
    },
    destroy() {
      clearTimeout(timer);
      footer.remove();
    },
  };
}
