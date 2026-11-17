// Word's ids. Revision, bookmark and comment ids are integers that are unique in a document, and
// Word renumbers them on every save (word.md, "Identity, ids and time"), so Redlines' ids aren't
// kept in them. Comments carry a durable id that Word does keep, and it is derived from the
// Redlines id so that an import can match a thread back up.

/** Hands out Word ids, one after another. */
export class WordIds {
  private next = 1;

  /** A new id. */
  fresh(): number {
    return this.next++;
  }
}

/** FNV-1a over a string, 32 bits. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * The `w16cid:durableId` of a comment: eight hex digits, as Word writes, derived from a Redlines
 * id (`salt` tells a reply from the thread it is in). Word needs it to be below 0x7FFFFFFF.
 */
export function durableId(redlinesId: string, salt = ''): string {
  const value = (hash(`redlines:${redlinesId}:${salt}`) & 0x7ffffffe) + 1;
  return value.toString(16).toUpperCase().padStart(8, '0');
}
