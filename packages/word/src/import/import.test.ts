import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { strFromU8, strToU8 } from 'fflate';
import { parse } from '@redlines/format';
import { describe, expect, it } from 'vitest';
import { exportDocx } from '../export/build.ts';
import { readParts, writeParts } from '../shared/zip.ts';
import { importDocx } from './import.ts';
import { warningsOf } from './map.ts';

const SOURCE = `# A  title

Some __strong__ and *it*  words,
wrapped here.

* star item
* second \\*item\\*

> quoted _text_

Last paragraph.
`;

describe('importDocx', () => {
  it('brings back what Word left alone exactly as it was written', async () => {
    const result = importDocx(await exportDocx(SOURCE));
    expect(result.markdown).toBe(SOURCE);
    expect(result.report.entries).toEqual([]);
  });

  it('writes again only the block that Word changed', async () => {
    const parts = readParts(await exportDocx(SOURCE));
    const xml = strFromU8(parts['word/document.xml'] as Uint8Array);
    expect(xml).toContain('Last paragraph.');
    parts['word/document.xml'] = strToU8(xml.replace('Last paragraph.', 'A new last one.'));
    const result = importDocx(writeParts(parts));
    expect(result.markdown).toBe(SOURCE.replace('Last paragraph.', 'A new last one.'));
  });

  it('keeps the handles of the people the source knew', async () => {
    const text = `One <!--ins k3x9-->two<!--/k3x9-->.\n\n<!-- redlines\nversion: 1\npeople:\n  ada: {name: Ada Lovelace, email: ada@example.org}\nmarks:\n  k3x9: {by: ada, at: 2026-10-13T22:30Z}\n-->\n`;
    const result = importDocx(await exportDocx(text));
    expect(warningsOf(result.markdown)).toEqual([]);
    const people = parse(result.markdown).ledger.people;
    expect(people).toEqual([{ handle: 'ada', name: 'Ada Lovelace', email: 'ada@example.org' }]);
  });
});

describe('importDocx on a file Google Docs wrote', () => {
  const bytes = () =>
    new Uint8Array(
      readFileSync(
        fileURLToPath(new URL('../../fixtures/docs-suggestions-and-comment.docx', import.meta.url)),
      ),
    );

  it('converts the whole file, and says that it has no source to come back from', () => {
    const result = importDocx(bytes());
    expect(warningsOf(result.markdown)).toEqual([]);
    const kinds = result.report.entries.map((entry) => entry.kind);
    expect(kinds).toContain('docs-source');
    expect(kinds).toContain('docs-comments');
    expect(parse(result.markdown).marks.length).toBeGreaterThan(0);
  });
});
