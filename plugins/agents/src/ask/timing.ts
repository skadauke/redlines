// How long an Ask's answer stays in the bubble once it is complete (#1194): a base time, and the
// answer's words at a reading speed of about 200 a minute, so that a long answer is not gone before
// it is read. The reading rule is one for the whole app (`readingMs`, shared with a notification's
// time on screen, #1185); the base is the bubble's own.

import { readingMs } from '@redlines/plugin-api';

/** What every answer gets, however short. */
export const BASE_MS = 4000;
/** The longest an answer stays by itself: a longer one is kept by Make Comment, or in the chat. */
export const MOST_MS = 90_000;

/** The time `text` is shown for, in milliseconds. */
export function shownFor(text: string): number {
  return Math.min(MOST_MS, readingMs(text, BASE_MS));
}
