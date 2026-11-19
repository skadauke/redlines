import { describe, expect, it } from 'vitest';
import { partText, readParts } from '../shared/zip.ts';
import { exportDocx } from './build.ts';
import { breakInsertedLiteralNewlines } from './literal-breaks.ts';

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
-->
`;

// The lines of Build 21's list, whose insertions were written with `\n` the two characters (#1178).
const BUILD_21 = `## Ideas

- A word count in the title bar
- Footnotes<!--ins mnsm-->\\n- Tags in the sidebar\\n- Search in comments<!--/mnsm-->

- Import of Google Docs
  - Comments kept as comments<!--ins vq35-->\\n  - Replies kept too<!--/vq35-->

We ship in <!--sub p7qd May-->June\\nor July<!--/p7qd-->.

${LEDGER}`;

describe('an insertion written with \\n', () => {
  it('leaves no backslash and n in any text of the export', async () => {
    const parts = readParts(await exportDocx(BUILD_21, { carriers: false }));
    const document = partText(parts, 'word/document.xml') ?? '';
    const texts = [...document.matchAll(/<w:(?:t|delText)\b[^>]*>([^<]*)</g)].map((m) => m[1]);
    expect(texts.length).toBeGreaterThan(5);
    for (const t of texts) expect(t).not.toContain('\\n');
    // The three lines of the first insertion are three list items, each its own tracked paragraph.
    expect(texts).toContain('Tags in the sidebar');
    expect(texts).toContain('Search in comments');
    expect(texts).toContain('Replies kept too');
  });

  it('reads the line break of a substitution as a paragraph too', async () => {
    const parts = readParts(await exportDocx(BUILD_21, { carriers: false }));
    const document = partText(parts, 'word/document.xml') ?? '';
    expect(document).toMatch(/<w:t[^>]*>or July<\/w:t>/);
  });

  it('keeps a backslash before it, a code span and a fence', () => {
    const marks = (body: string) => `a<!--ins k3x9-->${body}<!--/k3x9-->`;
    expect(breakInsertedLiteralNewlines(marks('x\\\\n y'))).toBe(marks('x\\\\n y'));
    expect(breakInsertedLiteralNewlines(marks('use `\\n` here'))).toBe(marks('use `\\n` here'));
    expect(breakInsertedLiteralNewlines(marks('```\n\\n\n```'))).toBe(marks('```\n\\n\n```'));
    expect(breakInsertedLiteralNewlines(marks('x\\\\\\ny'))).toBe(marks('x\\\\\ny'));
  });

  it('leaves text outside an insertion alone', () => {
    const plain = 'A string "a\\nb" in prose, and <!--del k3x9 x\\ny--> gone.';
    expect(breakInsertedLiteralNewlines(plain)).toBe(plain);
  });
});
