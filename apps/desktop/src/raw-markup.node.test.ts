// #1207, the exports' half: the Word export's text runs and the Quick Look page of every test document
// hold no raw markup (the journey tests/raw-markup.spec.ts, in apps/desktop/journeys, scans what the
// editor draws in WebKit; the rules and the known cases are in journeys/src/raw-markup.ts).

import { readParts, partText, exportDocx } from '@redlines/word';
import { describe, expect, it } from 'vitest';
import { renderPreview } from '../quicklook/src/render.ts';
import { testDocuments } from '../journeys/src/raw-markup-documents.ts';
import {
  codeOf,
  EXPORT_SURFACES,
  judge,
  scanLines,
  type Found,
} from '../journeys/src/raw-markup.ts';

const ENTITIES: Record<string, string> = {
  lt: '<',
  gt: '>',
  amp: '&',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name.startsWith('#x')) return String.fromCodePoint(parseInt(name.slice(2), 16));
    if (name.startsWith('#')) return String.fromCodePoint(parseInt(name.slice(1), 10));
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

/** The text of each paragraph of a WordprocessingML part: its `w:t` runs and its deleted `w:delText`. */
function paragraphs(xml: string): string[] {
  return xml.split('</w:p>').map((paragraph) => {
    const runs = [...paragraph.matchAll(/<w:(?:t|delText)\b[^>]*>([^<]*)<\/w:(?:t|delText)>/g)];
    return decode(runs.map((run) => run[1]!).join(''));
  });
}

/** The visible text of a Quick Look page, a line to a block. */
function previewLines(html: string): string[] {
  const body = html.slice(html.indexOf('<body'));
  const text = body
    .replace(/<(style|script)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/(p|li|h[1-6]|tr|div|pre|blockquote|figcaption|caption|dt|dd)>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '');
  return decode(text).split('\n');
}

const docs = testDocuments();
const names = docs.map((doc) => doc.name);

let scanned: Promise<Record<'word' | 'quicklook', Found[]>> | undefined;
const scanAll = () => (scanned ??= scan());

async function scan(): Promise<Record<'word' | 'quicklook', Found[]>> {
  const found: Record<'word' | 'quicklook', Found[]> = { word: [], quicklook: [] };
  for (const doc of docs) {
    const code = codeOf(doc.text);
    const parts = readParts(await exportDocx(doc.text));
    const lines = ['word/document.xml', 'word/comments.xml', 'word/footnotes.xml'].flatMap((name) =>
      paragraphs(partText(parts, name) ?? ''),
    );
    for (const hit of scanLines(lines, code)) {
      found.word.push({ doc: doc.name, surface: 'word', hit });
    }
    const ql = previewLines(renderPreview(doc.text, doc.name));
    for (const hit of scanLines(ql, code)) {
      found.quicklook.push({ doc: doc.name, surface: 'quicklook', hit });
    }
  }
  return found;
}

describe('raw markup in the exports (#1207)', () => {
  it('has the Test Drive’s documents among the test documents', () => {
    expect(names).toEqual(
      expect.arrayContaining(['Build 21.md', 'Build 21.qmd', '_method.qmd', 'Bold.md']),
    );
  });

  for (const surface of EXPORT_SURFACES) {
    it(`the ${surface === 'word' ? 'Word export’s text' : 'Quick Look page’s text'} of every test document is free of it`, async () => {
      const found = (await scanAll())[surface as 'word' | 'quicklook'];
      const { unknown, gone } = judge(found, [surface], names);
      expect(unknown, 'raw markup that no open issue knows').toEqual([]);
      expect(gone, 'known cases that were fixed').toEqual([]);
    });
  }
}, 60_000);
