/** Why an edit can't be made, so that the editor can tell the cases apart. */
export type EditErrorCode =
  /** The ledger at the end of the file can't be read, so nothing is written. */
  | 'unreadable-ledger'
  /** The file ends inside code or a comment that is never closed, so no ledger can be added. */
  | 'unclosed-end'
  /** The change would put markers inside code or an HTML comment, where nothing reads them. */
  | 'inside-code'
  /** The edit is in YAML front matter, which v0.1 doesn't track (format §3.8). */
  | 'front-matter'
  /** The edit would turn other changes into plain text (they would be read as code). */
  | 'would-hide-marks'
  /** No place for the markers keeps the file rendering as its newest text (format §3.1–§3.4). */
  | 'no-legal-placement'
  /** The new text holds Redlines markup. */
  | 'markup'
  /** There is no change or thread with that id. */
  | 'unknown-id'
  /** The change is of a kind v0.1 doesn't decide. */
  | 'not-supported'
  /** An agent's text matches nothing in the newest text. */
  | 'no-match'
  /** An agent's text matches the newest text in several places. */
  | 'many-matches';

/** An edit that can't be made. Its message is shown to people and agents as it is. */
export class EditError extends Error {
  override name = 'EditError';
  /** Why, when the editor should tell the cases apart. */
  readonly code: EditErrorCode | undefined;

  constructor(message: string, code?: EditErrorCode) {
    super(message);
    this.code = code;
  }
}
