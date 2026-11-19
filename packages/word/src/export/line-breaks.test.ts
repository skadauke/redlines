import { describe, expect, it } from 'vitest';
import { partText, readParts } from '../shared/zip.ts';
import { exportDocx } from './build.ts';

const LEDGER = `<!-- redlines
version: 1
tracking: everyone
people:
  bo: {name: Bo}
  ada: {name: Ada}
marks:
  mnsm: {by: bo, at: 2026-11-18T02:58Z}
  vq35: {by: ada, at: 2026-11-18T02:58Z}
  p7qd: {by: ada, at: 2026-11-18T02:58Z}
  s3vb: {by: bo, at: 2026-11-18T02:58Z}
-->
`;

async function documentOf(text: string): Promise<string> {
  const parts = readParts(await exportDocx(text, { carriers: false }));
  return partText(parts, 'word/document.xml') ?? '';
}

const textsOf = (document: string) =>
  [...document.matchAll(/<w:(?:t|delText)\b[^>]*>([^<]*)</g)].map((m) => m[1]);

describe('a line break inside a tracked insertion (#1178)', () => {
  it('is a tracked paragraph or list item for each line', async () => {
    const document = await documentOf(`## Ideas

- Footnotes<!--ins mnsm-->
- Tags in the sidebar
- Search in comments<!--/mnsm-->

- Import of Google Docs
  - Comments kept as comments<!--ins vq35-->
  - Replies kept too<!--/vq35-->

${LEDGER}`);
    const texts = textsOf(document);
    expect(texts).toEqual(
      expect.arrayContaining([
        'Footnotes',
        'Tags in the sidebar',
        'Search in comments',
        'Replies kept too',
      ]),
    );
    // Each new line is a paragraph whose mark is inserted, and its text is inserted.
    expect(document.match(/<w:pPr>(?:(?!<\/w:pPr>).)*<w:ins /g)?.length).toBeGreaterThanOrEqual(3);
    expect(document).toMatch(/<w:ins [^>]*><w:r>(?:(?!<\/w:r>).)*<w:t[^>]*>Replies kept too</);
    for (const t of texts) expect(t).not.toContain('\\n');
  });

  it('is a paragraph in the new text of a substitution', async () => {
    const document = await documentOf(
      `We ship in <!--sub p7qd May-->June

and July<!--/p7qd-->.

${LEDGER}`,
    );
    expect(textsOf(document)).toEqual(expect.arrayContaining(['May', 'June', 'and July']));
    expect(document).toMatch(/<w:ins [^>]*><w:r>(?:(?!<\/w:r>).)*<w:t[^>]*>and July</);
  });
});

describe('a backslash and n inside a tracked insertion (#1178)', () => {
  it('stay the two characters of the text', async () => {
    const document = await documentOf(`Footnotes<!--ins mnsm-->\\n- Tags\\nmore<!--/mnsm-->

${LEDGER}`);
    expect(textsOf(document)).toContain('\\n- Tags\\nmore');
    expect(document).not.toContain('<w:br');
  });

  it('stay the two characters in a substitution too', async () => {
    const document = await documentOf(`In <!--sub p7qd May-->June\\nor July<!--/p7qd-->.

${LEDGER}`);
    expect(textsOf(document)).toContain('June\\nor July');
  });
});
