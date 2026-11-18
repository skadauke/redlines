import { parse } from '@redlines/format';
import { strFromU8, strToU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { exportDocx } from './export/build.ts';
import { importDocx } from './import/import.ts';
import { readParts, writeParts } from './shared/zip.ts';

// What the real-Word round trip found: a column's alignment (#1080), a change's note (#1081) and
// Word's account ids, which are not written into the file.

const ledger = (marks: string) =>
  `<!-- redlines\nversion: 1\ntracking: everyone\npeople:\n  ada: {name: Ada Lovelace}\nmarks:\n${marks}\n-->\n`;

describe('a table column keeps its alignment (#1080)', () => {
  it('reads right, center and none from the cells', async () => {
    const md = '| a | b | c |\n| --- | ---: | :---: |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |\n';
    const back = importDocx(await exportDocx(md));
    expect(back.markdown).toContain('| --- | ---: | :---: |');
    expect(back.report.entries).toEqual([]);
  });

  it('keeps the report where the cells of a column differ', async () => {
    const md = '| a | b |\n| ---: | --- |\n| 1 | 2 |\n';
    const parts = readParts(await exportDocx(md));
    const xml = strFromU8(parts['word/document.xml'] as Uint8Array);
    let n = 0;
    parts['word/document.xml'] = strToU8(
      xml.replace(/<w:jc w:val="right"\/>/g, (all) => (n++ === 0 ? '<w:jc w:val="center"/>' : all)),
    );
    const back = importDocx(writeParts(parts));
    expect(back.markdown).toContain('| --- | --- |');
    expect(back.report.entries.map((e) => e.message)).toContain(
      'Formatting with no Markdown form was dropped: alignment.',
    );
  });
});

describe('a change note comes back (#1081)', () => {
  const md = `One <!--ins k3x9-->new <!--/k3x9-->word, <!--sub w2rf old-->fresh<!--/w2rf-->.\n\n${ledger(
    '  k3x9: {by: ada, at: 2026-10-13T22:30Z, note: More precise.}\n  w2rf: {by: ada, at: 2026-10-13T22:31Z, note: Clearer.}',
  )}`;

  it('gives each change its note', async () => {
    const back = importDocx(await exportDocx(md));
    const notes = parse(back.markdown)
      .marks.map((m) => `${m.kind} ${m.entry.note}`)
      .sort();
    expect(notes).toEqual(['ins More precise.', 'sub Clearer.']);
    expect(back.report.entries).toEqual([]);
  });

  it('reports the notes when the export carries nothing', async () => {
    const report: { kind: string; message: string }[] = [];
    await exportDocx(md, { carriers: false, report });
    expect(report).toEqual([{ kind: 'note', message: '2 change notes are not in the Word file.' }]);
  });
});

describe("Word's account ids are not written", () => {
  it('keeps the name and handle, drops presenceInfo, and says so', async () => {
    const md = `One <!--ins k3x9-->new <!--/k3x9-->word.\n\n${ledger('  k3x9: {by: ada, at: 2026-10-13T22:30Z}')}`;
    const parts = readParts(await exportDocx(md));
    for (const name of Object.keys(parts)) if (name.startsWith('customXml/')) delete parts[name];
    parts['word/people.xml'] = strToU8(
      `<w15:people xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml"><w15:person w15:author="Ada Lovelace"><w15:presenceInfo w15:providerId="Windows Live" w15:userId="0123456789abcdef"/></w15:person></w15:people>`,
    );
    const back = importDocx(writeParts(parts));
    expect(back.markdown).not.toContain('0123456789abcdef');
    expect(back.markdown).not.toContain('accounts');
    expect(Object.values(parse(back.markdown).ledger.people).map((p) => p.name)).toContain(
      'Ada Lovelace',
    );
    expect(back.report.entries.map((e) => e.message)).toContain(
      "Word's account ids for the people in this file were not kept.",
    );
  });
});
