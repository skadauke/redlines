// Google Docs' own .docx, made to look like a Word file that the import reader already reads.
//
// What the study found in Docs' export (fixtures/docs-suggestions-and-comment.docx):
// - A suggestion is `w:ins` or `w:del`, as in Word, by the person's name, with a `w:date` in real
//   UTC (Word writes local time with a false `Z`). Docs has no `w16du:dateUtc`, and needs none.
// - Every inserted run carries an `rPrChange` whose old properties are empty: noise. A suggested
//   formatting change carries the same `rPrChange` outside an insertion: that one is real, and is
//   kept, since the old formatting it names (none) is what the change undid.
// - Every run and paragraph carries `rsid*` attributes that are all zeros, `w:rtl w:val="0"`, fonts
//   and sizes; every heading's runs repeat the heading's bold and size; empty runs trail paragraphs.
// - Comments are in `comments.xml`, their ids in a space of their own (an insertion and a comment
//   can both be 0). Resolved comments and every reply are missing from the file.

import { partText, readParts, setPartText, writeParts } from '../shared/zip.ts';
import type { Parts } from '../shared/zip.ts';
import type { ReportEntry } from '../shared/report.ts';

/** Docs writes every revision-save id as zeros; Word never does. */
export function isGoogleDocx(parts: Parts): boolean {
  const document = partText(parts, 'word/document.xml');
  return document !== undefined && /\bw:rsidR="00000000"/.test(document);
}

const EMPTY_RPR_CHANGE = /<w:rPrChange\b[^>]*>\s*<w:rPr\s*\/>\s*<\/w:rPrChange>/g;
const RSID_ATTRIBUTE = /\s+w:rsid\w*="[0-9A-Fa-f]+"/g;
const RTL_OFF = /<w:rtl w:val="0"\/>/g;
const FONT_NOISE = /<w:(?:rFonts|sz|szCs)\b[^>]*\/>/g;
const HEADING_NOISE = /<w:(?:b|bCs)(?: w:val="(?:1|true)")?\/>/g;
const NORMAL_STYLE = /<w:pStyle w:val="Normal"\/>/g;
// Not the `rPr` inside an `rPrChange`: empty there it means the old formatting was none.
const EMPTY_PROPS = /(?<!<w:rPrChange\b[^>]*>)(?:<w:rPr><\/w:rPr>|<w:rPr\/>)/g;
// A run with nothing in it: no text, break or reference, only (now empty) properties.
const EMPTY_RUN = /<w:r><\/w:r>/g;

function cleanParagraph(paragraph: string, heading: boolean): string {
  let out = paragraph
    .replace(/<w:ins\b[^>]*[^/>]>[\s\S]*?<\/w:ins>/g, (ins) => ins.replace(EMPTY_RPR_CHANGE, ''))
    .replace(RSID_ATTRIBUTE, '')
    .replace(RTL_OFF, '')
    .replace(FONT_NOISE, '')
    .replace(NORMAL_STYLE, '');
  if (heading) {
    // The heading's own bold, on its runs and on its paragraph mark; a change of bold stays.
    out = out.replace(/<w:rPr>[\s\S]*?<\/w:rPr>/g, (props) =>
      /<w:rPrChange\b/.test(props) ? props : props.replace(HEADING_NOISE, ''),
    );
  }
  return out.replace(EMPTY_PROPS, '').replace(EMPTY_RUN, '');
}

function cleanXml(xml: string): string {
  return xml.replace(/<w:p\b[\s\S]*?<\/w:p>/g, (paragraph) =>
    cleanParagraph(paragraph, /<w:pStyle w:val="Heading\d"\/>/.test(paragraph)),
  );
}

/** What a reader of Docs' file should tell the person. */
export const DOCS_FILE_NOTES: ReportEntry[] = [
  {
    kind: 'docs-comments',
    message:
      'This file came from Google Docs, which leaves resolved comments and all replies out of a .docx; any made there are not here.',
  },
];

/** Docs' .docx as Word-shaped parts, and what to tell the person; other files come back unchanged. */
export function normalizeGoogleDocx(parts: Parts): { parts: Parts; notes: ReportEntry[] } {
  if (!isGoogleDocx(parts)) return { parts, notes: [] };
  const out: Parts = { ...parts };
  for (const name of ['word/document.xml', 'word/comments.xml']) {
    const xml = partText(parts, name);
    if (xml !== undefined) setPartText(out, name, cleanXml(xml));
  }
  return { parts: out, notes: DOCS_FILE_NOTES };
}

/** The same, from the bytes of a file to bytes, for a caller that reads bytes (`readDocx`). */
export function normalizeGoogleBytes(bytes: Uint8Array): {
  bytes: Uint8Array;
  notes: ReportEntry[];
} {
  const found = normalizeGoogleDocx(readParts(bytes));
  return found.notes.length === 0
    ? { bytes, notes: [] }
    : { bytes: writeParts(found.parts), notes: found.notes };
}
