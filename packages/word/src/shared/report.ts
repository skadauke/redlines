// What an import couldn't keep, in words for the person who opened the file (import.md, "Things
// Markdown can't hold"): reported, never an error.

export interface ReportEntry {
  /** A short name for what was lost: `font`, `text box`. */
  kind: string;
  /** In words. */
  message: string;
}

export interface ImportReport {
  entries: ReportEntry[];
}
