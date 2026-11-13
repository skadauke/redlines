// Spelling suggestions in the palette, in place of WebKit's menu, which a right-click on a
// misspelled word showed and which the palette now covers. The host's spell checker (the system's,
// on the Mac) says whether the word is misspelled and what it suggests; the editor finds the word
// under the pointer (`Editor.wordAt`) and makes the correction the person picks (`pickCorrection`).

/** What the palette asks of the host's spell checker. */
export interface PaletteSpelling {
  /** Whether Preferences have spell check on: when they don't, no word is offered suggestions. */
  enabled(): boolean;
  /**
   * The suggestions for `word`, best first, or null when it is spelled right, or the checker can't
   * say. `before` is the block's text up to the word, for its language. A misspelled word that has
   * no suggestion is an empty list.
   */
  suggest(word: string, before: string): Promise<readonly string[] | null>;
  /** Adds `word` to the person's dictionary. Without it, Learn Spelling is not offered. */
  learn?(word: string): Promise<void> | void;
}

/** How long the palette waits for the suggestions before it opens without them. */
export const SPELLING_WAIT_MS = 120;

/** `promise`'s answer, or `late` once `ms` have passed: the palette doesn't wait longer. */
export function within<T, L>(promise: Promise<T>, ms: number, late: L): Promise<T | L> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(late), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}
