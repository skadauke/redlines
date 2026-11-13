// The spelling suggestions of a right-click, from the system's checker (src-tauri/src/spelling.rs):
// the formatting palette shows them in place of WebKit's menu, which a right-click no longer opens.

import type { PaletteSpelling } from '@redlines/palette';
import { invoke } from '@tauri-apps/api/core';

export interface SystemSpellingOptions {
  /** Whether Preferences have spell check on: when they don't, nothing is underlined or offered. */
  enabled(): boolean;
  /**
   * Called after a word was added to the dictionary: WebKit underlines misspellings as it checks,
   * and checks again where it is asked to, so the page is asked.
   */
  learned(): void;
}

export function systemSpelling(options: SystemSpellingOptions): PaletteSpelling {
  return {
    enabled: () => options.enabled(),
    // Nothing for a word that is spelled right, or when the checker can't be asked.
    suggest: (word, before) =>
      invoke<string[] | null>('spelling_suggestions', { word, before }).catch(() => null),
    learn: async (word) => {
      await invoke('spelling_learn', { word });
      options.learned();
    },
  };
}

/**
 * Makes WebKit check the text again, so that a word the person just learned loses its underline:
 * setting the `spellcheck` attribute again makes it drop its marks and look anew. The attribute ends
 * as it was.
 */
export function checkSpellingAgain(content: HTMLElement): void {
  const was = content.spellcheck;
  content.spellcheck = !was;
  content.spellcheck = was;
}
