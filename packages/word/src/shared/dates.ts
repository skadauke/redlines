// Times. The ledger keeps minutes, `2026-10-13T22:30Z`; Word's `w:date` is an `xsd:dateTime`, which
// wants seconds, so `:00` is written (README, mapping rule 6). Word has no date for a change
// nobody timed, and neither has the file: those get the epoch rather than a made-up time.

/** The epoch, for a mark whose time the ledger doesn't have. */
export const NO_TIME = '1970-01-01T00:00:00Z';

/** A ledger time as Word's `w:date`. */
export function wordDate(at: string): string {
  const found = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::(\d{2}))?(?:\.\d+)?Z$/.exec(at);
  if (!found || Number.isNaN(Date.parse(`${found[1]}:${found[2] ?? '00'}Z`))) return NO_TIME;
  return `${found[1]}:${found[2] ?? '00'}Z`;
}

/** A Word date as the ledger's time, to the minute (import). Anything else is the empty time. */
export function ledgerTime(date: string): string {
  const found = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?Z$/.exec(date);
  return found?.[1] ? `${found[1]}Z` : '';
}
