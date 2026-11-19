// How long an Ask's answer stays in the bubble once it is complete (#1194): a base time, and the
// answer's words at a reading speed of about 200 a minute, so that a long answer is not gone before
// it is read. It is the rule a notification's time on screen follows too (#1185).

/** What every answer gets, however short. */
export const BASE_MS = 4000;
/** Reading speed. */
export const WORDS_PER_MINUTE = 200;
/** The longest an answer stays by itself: a longer one is kept by Make Comment, or in the chat. */
export const MOST_MS = 90_000;

/** The time `text` is shown for, in milliseconds. */
export function shownFor(text: string): number {
  const words = text.split(/\s+/).filter((word) => word !== '').length;
  return Math.min(MOST_MS, BASE_MS + Math.round((words * 60_000) / WORDS_PER_MINUTE));
}
