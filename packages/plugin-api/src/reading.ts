// One rule for how long something is shown for reading (#1185, #1194): a base time, which the caller
// chooses for what it is (the eye finding a notification, the writer's focus leaving an answer),
// and its words at a reading speed of about 200 a minute. A notification's time on screen and the
// Ask bubble's both come from here, so that they can't drift.

/** The time for each word, at a reading speed of 200 words a minute. */
export const WORD_MS = 300;

/** How many words `text` has. */
export function wordsIn(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** `baseMs`, and the time to read `text`. */
export function readingMs(text: string, baseMs: number): number {
  return baseMs + wordsIn(text) * WORD_MS;
}
