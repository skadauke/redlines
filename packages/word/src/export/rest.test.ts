import { describe, expect, it } from 'vitest';
import { partText, readParts } from '../shared/zip.ts';
import { exportDocx } from './build.ts';
import { REST_SAMPLE } from './rest-sample.ts';

const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAABgAAAAQCAIAAACDRijCAAACtklEQVR4nA3Moc6uIACA4XM5JpPJvcFkMjATyREMzERyBgMzkRzB4EwkRzCwPxmJXtb5ngt4/n0FX8lX8dV8DV/L1/H1fJJv4Bv5Jj7DN/OtfBuf49v5Dr6LL/DdfA/fH/9yQS7JFbkmN+SW3JF7siQP5JE8kQ15Jq/kjezIO/kgX+RAvskP+Re9BW/JW/HWvA1vy9vx9rySd+AdeSdewzvzrrwbr+PdeQ/eizfw3rwP7y9KBakkVaSa1JBaUkfqSZI0kEbSRDKkmbSSNpIj7aSDdJEC6SY9pF8UC2JJrIg1sSG2xI7YEyVxII7EiWiIM3ElbkRH3IkH8SIG4k18iL8oFISSUBFqQkNoCR2hJ0jCQBgJE8EQZsJK2AiOsBMOwkUIhJvwEH7RWXCWnBVnzdlwtpwdZ88pOQfOkXPiNJwz58q5cTrOnfPgvDgD5835cP4iX+BLfIWv8Q2+xXf4Hi/xA37ET3iDn/ErfsM7/I4/8Bc+4G/8g/9FrsCVuApX4xpci+twPU7iBtyIm3AGN+NW3IZzuB134C5cwN24B/eLbIEtsRW2xjbYFtthe6zEDtgRO2ENdsau2A3rsDv2wF7YgL2xD/YXLQVLyVKx1CwNS8vSsfQskmVgGVkmFsMys6wsG4tj2VkOloslsNwsD8svMgWmxFSYGtNgWkyH6TESM2BGzIQxmBmzYjaMw+yYA3NhAubGPJhfpAt0ia7QNbpBt+gO3aMlekCP6Alt0DN6RW9oh97RB/pCB/SNftC/SBWoElWhalSDalEdqkdJ1IAaURPKoGbUitpQDrWjDtSFCqgb9aB+kSyQJbJC1sgG2SI7ZI+UyAE5IiekQc7IFbkhHXJHHsgLGZA38kH+IlEgSkSFqBENokV0iB4hEQNiREwIg5gRK2JDOMSOOBAXIiBuxIP44z/Du8+Ql+GrDgAAAABJRU5ErkJggg==';

const LEDGER = (marks: string, extra = '') => `<!-- redlines
version: 1
tracking: everyone
people:
  ada: {name: Ada Lovelace}
  bo: {name: Bo Chen}
marks:
${marks}
${extra}-->
`;
const AT = 'at: 2026-10-13T22:30Z';

async function xmlOf(text: string, options: Parameters<typeof exportDocx>[1] = {}) {
  const parts = readParts(await exportDocx(text, options));
  return {
    document: partText(parts, 'word/document.xml') ?? '',
    comments: partText(parts, 'word/comments.xml') ?? '',
    parts,
  };
}

/** A run of this text inside an insertion, with no other element between. */
const insRun = (word: string) =>
  new RegExp(
    `<w:ins [^>]*><w:r>(?:<w:rPr>(?:(?!<\\/w:rPr>)[^])*<\\/w:rPr>)?<w:(?:t|drawing)[^>]*>${word}`,
  );

const count = (xml: string, pattern: RegExp) => xml.match(pattern)?.length ?? 0;

const TABLE = '| Fruit  | Count | Price |\n| ------ | ----: | :---: |';

describe('tables', () => {
  it('writes an inserted row as a tracked row with inserted text', async () => {
    const text = `${TABLE}\n| Apples | 3     | 1.20  |\n| <!--ins k3x9 row--> Pears | 5 | 0.90 |\n\n${LEDGER(`  k3x9: {by: ada, ${AT}}`)}`;
    const { document } = await xmlOf(text);
    expect(document).toMatch(/<w:trPr>[^]*?<w:ins w:id="\d+" w:author="Ada Lovelace"[^>]*\/>/);
    expect(count(document, /<w:trPr>[^]*?<w:ins /g)).toBe(1);
    // The row's own text is inserted text; the first row's is not.
    expect(document).toContain('<w:t xml:space="preserve">Pears</w:t>');
    expect(document).toMatch(insRun('Pears'));
    expect(document).not.toMatch(insRun('Apples'));
  });

  it('writes a deleted row back at its place, as a tracked deleted row', async () => {
    const text = `${TABLE}\n| Apples | 3     | 1.20  |\n| Plums  | 7     | 2.00  |\n\n<!--del k3x9 row=2 \\| Pears  \\| 5     \\| 0.90  \\|-->\n\n${LEDGER(`  k3x9: {by: bo, ${AT}}`)}`;
    const { document } = await xmlOf(text);
    expect(document).toMatch(/<w:trPr>[^]*?<w:del w:id="\d+" w:author="Bo Chen"[^>]*\/>/);
    expect(document).toMatch(/<w:delText[^>]*>Pears<\/w:delText>/);
    // Header, Apples, Pears (deleted), Plums: the deleted row stands between them.
    const order = ['Fruit', 'Apples', 'Pears', 'Plums'].map((word) => document.indexOf(word));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(count(document, /<w:tr[ >]/g)).toBe(4);
    // The paragraph that held the deletion's marker is not text of its own.
    expect(count(document, /<w:p[ >]/g)).toBe(count(document, /<w:tc>/g));
  });

  it('writes a changed cell as tracked text', async () => {
    const text = `${TABLE}\n| Apples | <!--sub p7qd 3-->4<!--/p7qd--> | 1.20  |\n\n${LEDGER(`  p7qd: {by: ada, ${AT}}`)}`;
    const { document } = await xmlOf(text);
    expect(document).toMatch(/<w:delText[^>]*>3<\/w:delText>/);
    expect(document).toMatch(insRun('4'));
  });

  it('aligns the paragraphs of the cells as the delimiter row says', async () => {
    const { document } = await xmlOf(`${TABLE}\n| a | b | c |\n`);
    expect(document).toMatch(/<w:jc w:val="right"\/>[^]*?>b</);
    expect(document).toMatch(/<w:jc w:val="center"\/>[^]*?>c</);
    expect(count(document, /<w:jc /g)).toBe(4);
  });

  it('writes an alignment change as the old alignment of each column that changed', async () => {
    const text = `| Fruit | Count<!--fmt b5bg align=\\|\\x20-\\-\\-\\x20\\|\\x20-\\-\\-\\x20\\|--> |\n| --- | ----: |\n| a | b |\n\n${LEDGER(`  b5bg: {by: ada, ${AT}}`)}`;
    const { document } = await xmlOf(text);
    // Column 2 was not aligned and is right now: its cells have a property change with none.
    expect(count(document, /<w:pPrChange /g)).toBe(2);
    expect(document).toMatch(
      /<w:pPrChange [^>]*w:author="Ada Lovelace"[^>]*><w:pPr\/><\/w:pPrChange>/,
    );
  });

  it('keeps a deleted column as deleted text with a comment, and says so', async () => {
    const text = `| Fruit  | Count |\n| ------ | ----: |\n| Apples | 3     |\n\n<!--del k3x9 col=3  Price \\n :-\\-\\-: \\n 1.20  -->\n\n${LEDGER(`  k3x9: {by: bo, ${AT}}`)}`;
    const report: { kind: string; message: string }[] = [];
    const { document, comments } = await xmlOf(text, { report });
    expect(document).toMatch(/<w:delText[^>]*>Price<\/w:delText>/);
    expect(document).toMatch(/<w:delText[^>]*>1\.20<\/w:delText>/);
    expect(comments).toContain('this column was deleted');
    expect(document).toContain('<w:commentRangeStart');
    expect(report.map((entry) => entry.kind)).toContain('column');
  });

  it('writes an inserted column as inserted cells, and says so', async () => {
    const text = `| Fruit  | <!--ins k3x9 col--> New | Count |\n| ------ | --- | ----: |\n| Apples | x   | 3     |\n\n${LEDGER(`  k3x9: {by: ada, ${AT}}`)}`;
    const report: { kind: string; message: string }[] = [];
    const { document } = await xmlOf(text, { report });
    expect(document).toMatch(insRun('New'));
    expect(document).toMatch(insRun('x'));
    expect(document).not.toMatch(insRun('Count'));
    expect(report.map((entry) => entry.kind)).toContain('column');
  });
});

describe('format changes', () => {
  it('writes bold that was added with the old properties, and bold that was removed', async () => {
    const text = `Plain <!--fmt m2bd +bold-->**newly bold**<!--/m2bd--> and <!--fmt n3bd -italic-->plain now<!--/n3bd-->.\n\n${LEDGER(`  m2bd: {by: ada, ${AT}}\n  n3bd: {by: bo, ${AT}}`)}`;
    const { document } = await xmlOf(text);
    const added =
      /<w:rPr><w:b\/>[^]*?<w:rPrChange [^>]*w:author="Ada Lovelace"[^>]*><w:rPr\/><\/w:rPrChange><\/w:rPr><w:t[^>]*>newly bold/.exec(
        document,
      );
    expect(added).not.toBeNull();
    const removed =
      /<w:rPrChange [^>]*w:author="Bo Chen"[^>]*><w:rPr><w:i\/>[^]*?<\/w:rPr><\/w:rPrChange>/.exec(
        document,
      );
    expect(removed).not.toBeNull();
  });

  it('writes a block that became a heading with the old paragraph properties', async () => {
    const text = `<!--fmt q2hw was=p-->\n\n## This paragraph became a heading<!--/q2hw-->\n\n${LEDGER(`  q2hw: {by: ada, ${AT}}`)}`;
    const { document } = await xmlOf(text);
    expect(document).toMatch(
      /<w:pStyle w:val="Heading2"\/>[^]*?<w:pPrChange [^>]*w:author="Ada Lovelace"/,
    );
    expect(count(document, /<w:pPrChange /g)).toBe(1);
    // The marker's own line is no paragraph.
    expect(count(document, /<w:p[ >]/g)).toBe(1);
  });

  it('writes a heading that became a paragraph with the old style', async () => {
    const text = `<!--fmt q2hw was=h2-->\n\nNow a paragraph<!--/q2hw-->\n\n${LEDGER(`  q2hw: {by: ada, ${AT}}`)}`;
    const { document } = await xmlOf(text);
    expect(document).toMatch(/<w:pPrChange [^>]*><w:pPr><w:pStyle w:val="Heading2"\/>/);
  });

  it('writes subscript and superscript', async () => {
    const { document } = await xmlOf('H<sub>2</sub>O and x<sup>2</sup>\n');
    expect(document).toMatch(/<w:vertAlign w:val="subscript"\/>[^]*?<w:t[^>]*>2/);
    expect(document).toMatch(/<w:vertAlign w:val="superscript"\/>/);
  });
});

describe('splits and joins', () => {
  it('writes a split as an inserted paragraph mark', async () => {
    const text = `One<!--split s3vb-->\n\nTwo\n\n${LEDGER(`  s3vb: {by: ada, ${AT}}`)}`;
    const { document } = await xmlOf(text);
    expect(document).toMatch(
      /<w:rPr><w:ins w:id="\d+" w:author="Ada Lovelace"[^>]*\/><\/w:rPr>[^]*?<w:t[^>]*>One/,
    );
    // Only the first paragraph's mark is inserted.
    expect(count(document, /<w:rPr><w:ins /g)).toBe(1);
  });

  it('writes a join as a deleted paragraph mark', async () => {
    const text = `Para<!--del j7mm \\n\\n## -->Heading text\n\n${LEDGER(`  j7mm: {by: bo, ${AT}}`)}`;
    const { document } = await xmlOf(text);
    expect(document).toMatch(/<w:rPr><w:del w:id="\d+" w:author="Bo Chen"[^>]*\/><\/w:rPr>/);
    expect(count(document, /<w:p[ >]/g)).toBe(2);
  });
});

describe('moves', () => {
  const MOVED = `One.\n\n<!--del g5nb Two.\\n\\n-->Three.\n\n<!--ins g6nb-->Two.\n\n<!--/g6nb-->Four.\n\n`;
  const text = `${MOVED}${LEDGER(`  g5nb: {by: ada, ${AT}, group: g7nb}\n  g6nb: {by: ada, ${AT}, group: g7nb}`)}`;

  it('writes the halves of a move as moveFrom and moveTo of one name', async () => {
    const { document } = await xmlOf(text);
    expect(count(document, /<w:moveFrom /g)).toBeGreaterThan(0);
    expect(count(document, /<w:moveTo /g)).toBeGreaterThan(0);
    expect(document).toMatch(/<w:moveFromRangeStart w:id="\d+" w:name="move1"/);
    expect(document).toMatch(/<w:moveToRangeStart w:id="\d+" w:name="move1"/);
    expect(document).toMatch(/<w:moveFromRangeEnd /);
    expect(document).toMatch(/<w:moveToRangeEnd /);
    // The moved text is plain text in a moveFrom, not deleted text.
    expect(document).not.toContain('<w:delText');
    expect(document).not.toMatch(/<w:del /);
    expect(document).not.toMatch(/<w:ins /);
  });

  it('keeps ids unique', async () => {
    const { document } = await xmlOf(text);
    const ids = [
      ...document.matchAll(
        /<w:(?:moveFrom|moveTo|ins|del|moveFromRangeStart|moveToRangeStart)\b[^>]*\bw:id="(\d+)"/g,
      ),
    ].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('writes a deletion and an insertion of different text as plain revisions', async () => {
    const other = `<!--del g5nb Two.-->One.\n\n<!--ins g6nb-->Elsewhere.<!--/g6nb-->\n\n${LEDGER(`  g5nb: {by: ada, ${AT}, group: g7nb}\n  g6nb: {by: ada, ${AT}, group: g7nb}`)}`;
    const { document } = await xmlOf(other);
    expect(document).not.toMatch(/<w:move/);
    expect(document).toMatch(/<w:del /);
  });
});

describe('images', () => {
  it('embeds an image with a data address, with its size and alt text', async () => {
    const { document, parts } = await xmlOf(
      `Before ![A picture](data:image/png;base64,${PNG}) after\n`,
    );
    expect(document).toContain('<w:drawing>');
    expect(document).toContain('descr="A picture"');
    expect(Object.keys(parts).some((name) => /^word\/media\/.*\.png$/.test(name))).toBe(true);
    // 24 by 16 pixels, in English Metric Units (9525 to the pixel).
    expect(document).toContain('cx="228600"');
    expect(document).toContain('cy="152400"');
  });

  it('asks the caller for the bytes of any other address', async () => {
    const bytes = Uint8Array.from(atob(PNG), (c) => c.charCodeAt(0));
    const asked: string[] = [];
    const { document } = await xmlOf('![x](pictures/a.png)\n', {
      images: (src) => {
        asked.push(src);
        return bytes;
      },
    });
    expect(asked).toEqual(['pictures/a.png']);
    expect(document).toContain('<w:drawing>');
  });

  it('writes the description when the bytes are not known, and says so', async () => {
    const report: { kind: string; message: string }[] = [];
    const { document } = await xmlOf('![Chart of sales](https://example.org/a.png)\n', { report });
    expect(document).not.toContain('<w:drawing>');
    expect(document).toContain('[Image: Chart of sales]');
    expect(report).toHaveLength(1);
    expect(report[0]?.message).toContain('https://example.org/a.png');
  });

  it('tracks an inserted image', async () => {
    const text = `A <!--ins k3x9-->![pic](data:image/png;base64,${PNG})<!--/k3x9--> b\n\n${LEDGER(`  k3x9: {by: ada, ${AT}}`)}`;
    const { document } = await xmlOf(text);
    expect(document).toMatch(insRun(''));
  });
});

describe('comments on deleted text', () => {
  it('puts the range of a comment around the deleted runs', async () => {
    const text = `A <!--del w2rf old words--> b\n\n${LEDGER(`  w2rf: {by: ada, ${AT}}`, `comments:\n  c8d2:\n    by: bo\n    at: 2026-10-13T22:40Z\n    about: w2rf\n    text: Why?\n`)}`;
    const { document, comments } = await xmlOf(text);
    expect(comments).toContain('Why?');
    const start = document.indexOf('<w:commentRangeStart');
    const del = document.indexOf('<w:del ');
    const end = document.indexOf('<w:commentRangeEnd');
    expect(start).toBeGreaterThan(-1);
    expect(start).toBeLessThan(del);
    expect(end).toBeGreaterThan(document.indexOf('old words'));
    expect(document.indexOf('<w:commentReference')).toBeGreaterThan(end);
  });

  it('puts it around a deleted paragraph too', async () => {
    const text = `One\n\n<!--del w2rf Gone\\n\\n-->Two\n\n${LEDGER(`  w2rf: {by: ada, ${AT}}`, `comments:\n  c8d2:\n    by: bo\n    at: 2026-10-13T22:40Z\n    about: w2rf\n    text: Why?\n`)}`;
    const { document } = await xmlOf(text);
    expect(count(document, /<w:commentRangeStart/g)).toBe(1);
    expect(count(document, /<w:commentRangeEnd/g)).toBe(1);
    expect(document.indexOf('<w:commentRangeStart')).toBeLessThan(document.indexOf('Gone'));
    expect(document.indexOf('<w:commentRangeEnd')).toBeGreaterThan(document.indexOf('Gone'));
  });
});

describe('task lists', () => {
  it('writes the boxes, with no bullet', async () => {
    const { document } = await xmlOf('- [ ] open\n- [x] done\n');
    expect(document).toContain('☐');
    expect(document).toContain('☒');
    expect(document).not.toContain('<w:numPr>');
  });

  it('writes a checked box as the old box deleted and the new one inserted', async () => {
    const text = `- [x] two<!--fmt m2bd +check-->\n\n${LEDGER(`  m2bd: {by: ada, ${AT}}`)}`;
    const { document } = await xmlOf(text);
    expect(document).toMatch(/<w:delText[^>]*>☐<\/w:delText>/);
    expect(document).toMatch(insRun('☒'));
  });
});

/** Whether every element is closed by its own name, with attribute values in quotes. */
function wellFormed(xml: string): boolean {
  const stack: string[] = [];
  for (const found of xml
    .replace(/<\?[^]*?\?>/g, '')
    .matchAll(/<(\/?)([\w:.-]+)((?:\s+[\w:.-]+="[^"]*")*)\s*(\/?)>/g)) {
    const [, closing, name, , selfClosing] = found;
    if (selfClosing) continue;
    if (closing) {
      if (stack.pop() !== name) return false;
    } else stack.push(name as string);
  }
  return stack.length === 0;
}

describe('the sample', () => {
  it('is a Word file with every revision kind in it, well formed, with unique ids', async () => {
    const report: { kind: string; message: string }[] = [];
    const { document, comments, parts } = await xmlOf(REST_SAMPLE, { report });
    for (const tag of [
      'w:rPrChange',
      'w:pPrChange',
      'w:moveFrom ',
      'w:moveTo ',
      'w:drawing',
      'w:ins ',
      'w:del ',
    ]) {
      expect(document).toContain(`<${tag}`);
    }
    expect(comments).toContain('Why did this go?');
    expect(wellFormed(document)).toBe(true);
    expect(wellFormed(comments)).toBe(true);
    // Every property change holds the old properties, as Word needs.
    expect(document).not.toMatch(/<w:(?:r|p)PrChange [^>]*\/>/);
    // Revision and range ids are unique in the document.
    const ids = [
      ...document.matchAll(
        /<w:(?:ins|del|moveFrom|moveTo|rPrChange|pPrChange|moveFromRangeStart|moveToRangeStart)\b[^>]*\bw:id="(\d+)"/g,
      ),
    ].map((found) => found[1]);
    expect(new Set(ids).size).toBe(ids.length);
    // Ranges of comments are paired.
    expect(count(document, /<w:commentRangeStart /g)).toBe(count(document, /<w:commentRangeEnd /g));
    expect(report.map((entry) => entry.kind).sort()).toEqual(['column', 'image']);
    // The picture that is not there is its description; the one that is, a media part.
    expect(document).toContain('[Image: Chart of sales]');
    expect(Object.keys(parts).filter((name) => name.startsWith('word/media/'))).toHaveLength(1);
  });

  it('is written to a file when WORD_SAMPLE_OUT names one', async () => {
    const out = process.env.WORD_SAMPLE_OUT;
    if (!out) return;
    const { writeFileSync } = await import('node:fs');
    writeFileSync(out, await exportDocx(REST_SAMPLE));
  });
});
