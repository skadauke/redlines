export { exportDocx } from './export/build.ts';
export type { ExportOptions } from './export/build.ts';
export { ledgerTime, wordDate } from './shared/dates.ts';
export { WordIds, durableId } from './shared/ids.ts';
export { authorsOf, initialsOf } from './shared/people.ts';
export type { Author } from './shared/people.ts';
export type { ImportReport, ReportEntry } from './shared/report.ts';
export { partText, readParts, setPartText, writeParts } from './shared/zip.ts';
export type { Parts } from './shared/zip.ts';
export { docsRoundTripNotes } from './google/notes.ts';
export {
  DOCS_FILE_NOTES,
  isGoogleDocx,
  normalizeGoogleBytes,
  normalizeGoogleDocx,
} from './google/normalize.ts';
