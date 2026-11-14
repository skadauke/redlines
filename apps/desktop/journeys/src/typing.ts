// Typing, at the speed a person types or in a burst. Both send real key events through the
// browser, one key after another.

import type { Page } from '@playwright/test';

/**
 * 'human' is a key every 70 ms, a steady typist; 'fast' is every 25 ms; 'burst' waits for nothing,
 * and sends the next key as soon as the page has taken the last (each is still a round trip to the
 * browser, so it is a rush of keys, not keys inside one turn of the page's event loop).
 * A number is a delay in milliseconds.
 */
export type TypingSpeed = 'human' | 'fast' | 'burst' | number;

export function delayOf(speed: TypingSpeed): number {
  if (typeof speed === 'number') return speed;
  return speed === 'human' ? 70 : speed === 'fast' ? 25 : 0;
}

/** Types `text` key by key: a newline is Enter and a tab is Tab, as they are on a keyboard. */
export async function humanType(page: Page, text: string, speed: TypingSpeed): Promise<void> {
  const delay = delayOf(speed);
  let run = '';
  const flush = async () => {
    if (run) await page.keyboard.type(run, { delay });
    run = '';
  };
  for (const char of text) {
    if (char === '\n' || char === '\t') {
      await flush();
      await page.keyboard.press(char === '\n' ? 'Enter' : 'Tab');
      if (delay) await page.waitForTimeout(delay);
    } else run += char;
  }
  await flush();
}
