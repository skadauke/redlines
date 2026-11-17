// Opening a .docx as a Redlines file: from the bytes of the file to Markdown, with the pieces in
// their order. A file Google Docs wrote goes through its normalizer first. A file Redlines made
// has its source part, and a block Word left alone comes back as it was written.

import { readSource } from '../carriers/index.ts';
import { isGoogleDocx, normalizeGoogleBytes } from '../google/normalize.ts';
import { readParts } from '../shared/zip.ts';
import { mapDocx } from './map.ts';
import type { ImportResult } from './map.ts';
import { readDocx } from './read.ts';

/** What Docs' own files lack, which makes the import start from the document. */
const NO_SOURCE = {
  kind: 'docs-source',
  message:
    'Google Docs keeps no copy of the Markdown a file was made from, so the whole document was converted, and no block came back as it was written.',
};

/** The Markdown, ledger and report of a .docx file's bytes. */
export function importDocx(bytes: Uint8Array): ImportResult {
  const google = isGoogleDocx(readParts(bytes));
  const normalized = google ? normalizeGoogleBytes(bytes) : { bytes, notes: [] };
  const model = readDocx(normalized.bytes);
  // Docs replaces the custom XML of a file, so a file it saved has no source part to look for.
  const source = google ? undefined : readSource(readParts(normalized.bytes));
  const result = mapDocx(model, source ? { source } : {});
  if (google) result.report.entries.unshift(...normalized.notes, NO_SOURCE);
  return result;
}
