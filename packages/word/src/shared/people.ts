// How a person is named in a Word file: their display name, with the organization appended when
// two people in the file share a name (format §10), and the initials Word shows on a comment.

import type { Ledger, Person } from '@redlines/format';

export interface Author {
  /** What Word writes in `w:author`. */
  name: string;
  initials: string;
}

/** The initials of a name: the first letters of its first two words, in capitals. */
export function initialsOf(name: string): string {
  const words = name.split(/[\s.,_-]+/).filter((word) => word !== '');
  const letters = words.slice(0, 2).map((word) => Array.from(word)[0] ?? '');
  return letters.join('').toUpperCase() || '?';
}

/** The names of the people in a ledger, by handle. A handle with no entry is named as it is. */
export function authorsOf(ledger: Ledger): (handle: string) => Author {
  const count = new Map<string, number>();
  for (const person of ledger.people) {
    count.set(person.name, (count.get(person.name) ?? 0) + 1);
  }
  const byHandle = new Map<string, Person>(ledger.people.map((person) => [person.handle, person]));
  const cache = new Map<string, Author>();
  return (handle) => {
    const known = cache.get(handle);
    if (known) return known;
    const person = byHandle.get(handle);
    let name = person?.name ?? (handle === 'unknown' || handle === '' ? 'Unknown' : handle);
    if (person?.org && (count.get(person.name) ?? 0) > 1) name = `${name} (${person.org})`;
    const author = { name, initials: initialsOf(person?.name ?? name) };
    cache.set(handle, author);
    return author;
  };
}
