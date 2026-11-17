import { newestView, originalView, parse } from '@redlines/format';
import { describe, expect, it } from 'vitest';
import { exportDocx } from './export/build.ts';
import { importDocx } from './import/import.ts';

// The whole loop (#1026): a Redlines file written to .docx and read back keeps every change and
// comment, and what Word or Markdown can't hold is reported, not dropped.

const LEDGER = `<!-- redlines
version: 1
tracking: everyone
people:
  ada: {name: Ada Lovelace}
  bo: {name: Bo Chen}
marks:
  k3x9: {by: ada, at: 2026-10-13T22:30Z}
  w2rf: {by: bo, at: 2026-10-13T22:31Z}
  p7qd: {by: ada, at: 2026-10-13T22:32Z}
  m2bd: {by: bo, at: 2026-10-13T22:33Z}
  g5nb: {by: ada, at: 2026-10-13T22:34Z, group: g7nb}
  g6nb: {by: ada, at: 2026-10-13T22:34Z, group: g7nb}
comments:
  c8d2:
    by: bo
    at: 2026-10-13T22:40Z
    text: Who signs off?
    replies:
      - id: r4fz
        by: ada
        at: 2026-10-13T22:45Z
        text: Legal does.
  c5x4:
    by: ada
    at: 2026-10-13T22:46Z
    resolved: bo 2026-10-13T22:50Z
    text: Done.
-->
`;

const BODY = [
  '# Plan',
  '',
  'We will ship the <!--ins k3x9-->new <!--/k3x9-->importer, after the <!--cmt c8d2-->review<!--/c8d2-->.',
  '',
  'Remove <!--del w2rf this phrase-->here and <!--sub p7qd in every editor-->anywhere<!--/p7qd-->.',
  '',
  'Plain text, then <!--fmt m2bd +bold-->**newly bold**<!--/m2bd--> text and a <!--cmt c5x4-->closed thread<!--/c5x4-->.',
  '',
  'One.',
  '',
  '<!--del g5nb Two.\\n\\n-->Three.',
  '',
  '<!--ins g6nb-->Two.',
  '',
  '<!--/g6nb-->Four.',
  '',
].join('\n');

const SOURCE = `${BODY}${LEDGER}`;

/**
 * The comments as a reader sees them, with no id (Word has none to keep). Who resolved a thread and
 * when come back from the source part, as Word marks a thread done and says no more (#1040).
 */
const commentsOf = (text: string) =>
  Object.values(parse(text).ledger.comments).map((c) => ({
    by: c.by,
    at: c.at,
    text: c.text,
    resolved: c.resolved,
    replies: (c.replies ?? []).map((r) => ({ by: r.by, at: r.at, text: r.text })),
  }));

const marksOf = (text: string) =>
  parse(text)
    .marks.map((mark) => `${mark.kind} ${mark.entry.by} ${mark.entry.at}`)
    .sort();

describe('the round trip, .md to .docx to .md', () => {
  it('keeps every change, with its author and time, and every comment', async () => {
    const back = importDocx(await exportDocx(SOURCE));
    expect(parse(back.markdown).warnings).toEqual([]);
    const before = marksOf(SOURCE);
    const after = marksOf(back.markdown);
    // Word has no ids, so the file that comes back names every change anew. A move comes back as
    // the deletion and the insertion it is made of, with the split that ends its inserted block.
    for (const mark of before) expect(after).toContain(mark);
    expect(after.filter((m) => m.startsWith('fmt '))).toEqual(
      before.filter((m) => m.startsWith('fmt ')),
    );
    expect(commentsOf(back.markdown)).toEqual(commentsOf(SOURCE));
  });

  it('reads the same text in the newest view and the original view', async () => {
    const back = importDocx(await exportDocx(SOURCE));
    expect(newestView(back.markdown).text).toBe(newestView(SOURCE).text);
    expect(originalView(back.markdown).text).toBe(originalView(SOURCE).text);
  });

  it('says what it cannot keep instead of dropping it', async () => {
    const withPicture = `${BODY}![Gone](media/none.png)\n\n${LEDGER}`;
    const notes: { kind: string; message: string }[] = [];
    await exportDocx(withPicture, { report: notes });
    expect(notes.map((entry) => entry.kind)).toEqual(['image']);
    expect(notes[0]?.message).toContain('media/none.png');
    // A picture the export could not embed is written as its description, and comes back as the
    // link it was (#1041).
    expect(importDocx(await exportDocx(withPicture)).markdown).toContain('![Gone](media/none.png)');
  });
});
