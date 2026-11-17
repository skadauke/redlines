import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { exportDocx } from '../export/build.ts';
import { strToU8 } from 'fflate';
import { writeParts } from '../shared/zip.ts';
import type { Block, DocxModel, Inline, Paragraph, Run, Table } from './model.ts';
import { readDocx } from './read.ts';
import { parseXml } from './xml.ts';

function fixture(relative: string): Uint8Array {
  return new Uint8Array(readFileSync(fileURLToPath(new URL(relative, import.meta.url))));
}

const SAMPLES = () =>
  readDocx(fixture('../../../../docs/word-export/samples/track-changes-samples.docx'));
const DOCS = () => readDocx(fixture('../../fixtures/docs-suggestions-and-comment.docx'));

function paragraphs(blocks: Block[]): Paragraph[] {
  return blocks.filter((block): block is Paragraph => block.type === 'paragraph');
}

function tables(blocks: Block[]): Table[] {
  return blocks.filter((block): block is Table => block.type === 'table');
}

function runs(inlines: Inline[]): Run[] {
  return inlines.flatMap((inline) =>
    inline.type === 'run' ? [inline] : inline.type === 'link' ? runs(inline.children) : [],
  );
}

function textOfParagraph(p: Paragraph): string {
  return runs(p.children)
    .map((run) => run.text)
    .join('');
}

function find(model: DocxModel, text: string): Paragraph {
  const found = paragraphs(model.blocks).find((p) => textOfParagraph(p).includes(text));
  if (!found) throw new Error(`no paragraph with ${text}`);
  return found;
}

describe('parseXml', () => {
  it('resolves prefixes to the reader names, whatever the file chose', () => {
    const root = parseXml(
      '<x:p xmlns:x="http://schemas.openxmlformats.org/wordprocessingml/2006/main" x:val="1"><x:t>a &amp; b &#65;</x:t></x:p>',
    );
    expect(root.name).toBe('w:p');
    expect(root.attrs['w:val']).toBe('1');
    expect((root.children[0] as { name: string }).name).toBe('w:t');
  });

  it('keeps spaces and decodes entities', () => {
    const root = parseXml('<a> x &lt;y&gt; </a>');
    expect(root.children).toEqual([' x <y> ']);
  });

  it('throws on a tag that is not closed', () => {
    expect(() => parseXml('<a><b></a>')).toThrow();
  });
});

describe('readDocx: the track-changes samples', () => {
  const model = SAMPLES();

  it('reads headings', () => {
    const first = paragraphs(model.blocks)[0] as Paragraph;
    expect(first.headingLevel).toBe(1);
    expect(textOfParagraph(first)).toBe('Word track-changes samples');
  });

  it('reads a substitution in a cell as a deletion and an insertion by the same author', () => {
    const table = tables(model.blocks)[0] as Table;
    const cell = table.rows[1]?.cells[1];
    const [p] = paragraphs(cell?.blocks ?? []);
    const [del, ins] = runs(p?.children ?? []);
    expect(del?.text).toBe('300 ms');
    expect(del?.deleted).toMatchObject({ author: 'Alice', at: '2026-10-13T12:00Z' });
    expect(ins?.text).toBe('200 ms');
    expect(ins?.inserted?.author).toBe('Alice');
  });

  it('reads inserted and deleted rows', () => {
    const table = tables(model.blocks)[0] as Table;
    expect(table.rows[2]?.inserted?.author).toBe('Bob');
    expect(table.rows[3]?.deleted?.author).toBe('Carol');
    expect(table.rows[1]?.inserted).toBeUndefined();
    expect(table.grid).toEqual([2400, 2400]);
  });

  it('reads inserted cells of a column', () => {
    const table = tables(model.blocks)[1] as Table;
    expect(table.rows.map((row) => row.cells.map((cell) => cell.inserted?.author))).toEqual([
      [undefined, undefined, 'Bob'],
      [undefined, undefined, 'Bob'],
    ]);
  });

  it('reads an inserted and a deleted image', () => {
    const inserted = paragraphs(model.blocks).find((p) =>
      p.children.some((c) => c.type === 'image' && c.inserted),
    );
    const deleted = paragraphs(model.blocks).find((p) =>
      p.children.some((c) => c.type === 'image' && c.deleted),
    );
    const image = inserted?.children.find((c) => c.type === 'image');
    expect(image).toMatchObject({ type: 'image', inserted: { author: 'Carol' }, width: 1524000 });
    expect(image?.type === 'image' && model.media[image.path]).toBeInstanceOf(Uint8Array);
    expect(deleted).toBeDefined();
  });

  it('reads the two ends of a move, linked by name', () => {
    const to = find(model, 'moved up');
    const from = paragraphs(model.blocks).filter((p) => textOfParagraph(p).includes('moved up'))[1];
    expect(to.mark.moved).toMatchObject({ direction: 'to', revision: { author: 'Alice' } });
    expect(runs(to.children)[0]?.moved).toMatchObject({ direction: 'to', name: 'move1' });
    expect(from?.mark.moved?.direction).toBe('from');
    expect(runs(from?.children ?? [])[0]?.moved).toMatchObject({
      direction: 'from',
      name: 'move1',
    });
  });

  it('reads a run format change with the old formatting', () => {
    const p = find(model, 'newly bold');
    const run = runs(p.children).find((r) => r.text === 'newly bold');
    expect(run?.format.bold).toBe(true);
    expect(run?.formatChange?.old.bold).toBe(false);
    expect(run?.formatChange?.revision.author).toBe('Bob');
  });

  it('reads a paragraph property change with the old style', () => {
    const p = find(model, 'promoted to a heading');
    expect(p.headingLevel).toBe(3);
    expect(p.propsChange?.revision.author).toBe('Alice');
    expect(p.propsChange?.old.headingLevel).toBeUndefined();
  });

  it('reads paragraph marks: inserted, deleted and merged', () => {
    expect(find(model, 'An inserted paragraph').mark.inserted?.author).toBe('Bob');
    expect(find(model, 'A deleted paragraph').mark.deleted?.author).toBe('Carol');
    const merged = find(model, 'These two paragraphs are merged');
    expect(merged.mark.deleted?.author).toBe('Alice');
    expect(runs(merged.children)[0]?.deleted).toBeUndefined();
  });

  it('reads the comments, their threads and the resolved state', () => {
    expect(model.comments).toHaveLength(6);
    expect(model.threads.map((t) => [t.root.id, t.replies.map((r) => r.id), t.resolved])).toEqual([
      [0, [1, 2], false],
      [3, [], true],
      [4, [], false],
      [5, [], false],
    ]);
    const root = model.comments[0];
    expect(root).toMatchObject({
      author: 'Alice',
      initials: 'A',
      text: 'Should we commit to 99.9%?',
      at: '2026-10-13T12:00Z',
      utc: false,
    });
    expect(model.comments[1]?.text).toBe("I'd rather say 99.5% for v1.");
  });

  it('knows what the body holds for each comment', () => {
    for (const comment of model.comments) {
      expect(comment.anchor).toEqual({ start: true, end: true, reference: true });
    }
  });

  it('reads a comment on an insertion, and a comment in a table cell', () => {
    const p = find(model, 'with exponential backoff');
    const kinds = p.children.map((c) => c.type);
    expect(kinds.indexOf('commentStart')).toBeLessThan(kinds.indexOf('run', 1));
    expect(runs(p.children).find((r) => r.inserted)?.text).toBe('with exponential backoff');
    const table = tables(model.blocks)[0] as Table;
    const cell = table.rows[4]?.cells[0];
    expect(paragraphs(cell?.blocks ?? [])[0]?.children.map((c) => c.type)).toContain(
      'commentStart',
    );
  });

  it('reads no report entries for a plain file', () => {
    expect(model.report).toEqual([]);
  });
});

describe("readDocx: Google Docs' file", () => {
  const model = DOCS();

  it('reads an insertion, and drops its empty format change', () => {
    const run = runs(find(model, 'P1').children).find((r) => r.inserted);
    expect(run?.text).toBe(' Inserted zebra-study words.');
    expect(run?.inserted).toMatchObject({ author: 'Ada', at: '2026-11-17T03:34Z' });
    expect(run?.formatChange).toBeUndefined();
  });

  it('reads a deletion', () => {
    const run = runs(find(model, 'P2').children).find((r) => r.deleted);
    expect(run?.text).toBe('extra ');
  });

  it('keeps a real format change that has an empty old format', () => {
    const run = runs(find(model, 'P4').children).find((r) => r.text === 'format');
    expect(run?.format.bold).toBe(true);
    expect(run?.formatChange?.old.bold).toBe(false);
  });

  it('reads the comment, with no thread links', () => {
    expect(model.threads).toHaveLength(1);
    expect(model.threads[0]?.root).toMatchObject({
      author: 'Ada',
      text: 'Comment one zebra-study',
      done: false,
    });
    expect(model.threads[0]?.replies).toEqual([]);
  });

  it('reads the headings from styles it has no name for', () => {
    expect(paragraphs(model.blocks)[0]?.headingLevel).toBe(1);
  });
});

describe('readDocx: what exportDocx writes', () => {
  const LEDGER = `<!-- redlines
version: 1
tracking: everyone
people:
  ada: {name: Ada Lovelace, email: ada@example.org}
  bo: {name: Bo Chen}
marks:
  k3x9: {by: ada, at: 2026-10-13T22:30Z}
  p7qd: {by: bo, at: 2026-10-13T22:31Z}
  w2rf: {by: bo, at: 2026-10-13T22:35Z}
comments:
  c8d2:
    by: bo
    at: 2026-10-13T22:40Z
    text: |-
      Who signs off on the security review?
    resolved: ada 2026-10-13T23:00Z
    replies:
      - id: r4fz
        by: ada
        at: 2026-10-13T22:45Z
        text: Legal does.
-->
`;
  const SAMPLE = `# Launch plan

We will ship the <!--ins k3x9-->new <!--/k3x9-->importer in <!--sub p7qd March-->April<!--/p7qd-->, after the <!--cmt c8d2-->security review<!--/c8d2-->.<!--del w2rf  The old exporter stays as it is.-->

${LEDGER}`;

  it('reads back the revisions, the thread and the resolved state', async () => {
    const model = readDocx(await exportDocx(SAMPLE));
    expect(model.trackRevisions).toBe(true);
    expect(paragraphs(model.blocks)[0]).toMatchObject({ headingLevel: 1 });
    const p = find(model, 'We will ship');
    const all = runs(p.children);
    const ins = all.find((r) => r.inserted);
    expect(ins).toMatchObject({ text: 'new ' });
    expect(ins?.inserted).toMatchObject({ author: 'Ada Lovelace', at: '2026-10-13T22:30Z' });
    const march = all.find((r) => r.deleted && r.text === 'March');
    const april = all.find((r) => r.inserted && r.text === 'April');
    expect(march?.deleted?.author).toBe('Bo Chen');
    expect(april?.inserted?.author).toBe('Bo Chen');
    expect(march?.deleted?.at).toBe(april?.inserted?.at);
    const old = all.filter((r) => r.deleted?.author === 'Bo Chen' && r.text !== 'March');
    expect(old.map((r) => r.text).join('')).toBe(' The old exporter stays as it is.');
    expect(model.threads).toHaveLength(1);
    const [thread] = model.threads;
    expect(thread?.root).toMatchObject({
      author: 'Bo Chen',
      text: 'Who signs off on the security review?',
      at: '2026-10-13T22:40Z',
    });
    expect(thread?.replies.map((r) => [r.author, r.text])).toEqual([
      ['Ada Lovelace', 'Legal does.'],
    ]);
    expect(thread?.resolved).toBe(true);
    expect(thread?.root.anchor).toEqual({ start: true, end: true, reference: true });
    expect(thread?.replies[0]?.anchor).toEqual({ start: true, end: true, reference: true });
  });

  it('reads the Markdown of a file with no revisions as plain blocks', async () => {
    const model = readDocx(await exportDocx('# Title\n\nSome **bold** and *italic* text.\n'));
    expect(paragraphs(model.blocks).map(textOfParagraph)).toEqual([
      'Title',
      'Some bold and italic text.',
    ]);
    const bold = runs(find(model, 'Some').children).find((r) => r.text === 'bold');
    expect(bold?.format.bold).toBe(true);
    expect(runs(find(model, 'Some').children).find((r) => r.text === 'italic')?.format.italic).toBe(
      true,
    );
  });
});

describe('readDocx: files it must refuse or cope with', () => {
  it('says so when the bytes are not a zip', () => {
    expect(() => readDocx(strToU8('hello'))).toThrow(/not a Word/);
  });

  it('says so when the zip has no main document', () => {
    expect(() => readDocx(writeParts({ 'a.txt': strToU8('x') }))).toThrow(/word\/document\.xml/);
  });

  it('reads a bare document with no other parts, and flattens a text box with a report entry', () => {
    const xml = `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><w:body><w:p><w:r><w:t>a</w:t></w:r><w:r><mc:AlternateContent><mc:Choice><w:drawing><wps:wsp><wps:txbx><w:txbxContent><w:p><w:r><w:t>boxed</w:t></w:r></w:p></w:txbxContent></wps:txbx></wps:wsp></w:drawing></mc:Choice><mc:Fallback><w:pict/></mc:Fallback></mc:AlternateContent></w:r></w:p></w:body></w:document>`;
    const model = readDocx(writeParts({ 'word/document.xml': strToU8(xml) }));
    expect(textOfParagraph(paragraphs(model.blocks)[0] as Paragraph)).toBe('aboxed');
    expect(model.report.map((entry) => entry.kind)).toEqual(['text box']);
  });

  it('reads a hyperlink field and a nested insert inside a delete', () => {
    const xml = `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> HYPERLINK "https://example.org/" </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>site</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r><w:ins w:id="1" w:author="A" w:date="2026-01-01T10:00:00Z"><w:del w:id="2" w:author="B" w:date="2026-01-02T10:00:00Z"><w:r><w:delText>gone</w:delText></w:r></w:del></w:ins></w:p></w:body></w:document>`;
    const model = readDocx(writeParts({ 'word/document.xml': strToU8(xml) }));
    const [p] = paragraphs(model.blocks);
    expect(p?.children[0]).toMatchObject({ type: 'link', href: 'https://example.org/' });
    const gone = runs(p?.children ?? []).find((r) => r.text === 'gone');
    expect(gone?.inserted?.author).toBe('A');
    expect(gone?.deleted?.author).toBe('B');
  });

  it('prefers dateUtc to the local date', () => {
    const xml = `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w16du="http://schemas.microsoft.com/office/word/2023/wordml/word16du"><w:body><w:p><w:ins w:id="1" w:author="A" w:date="2026-01-01T10:00:00Z" w16du:dateUtc="2026-01-01T15:00:00Z"><w:r><w:t>x</w:t></w:r></w:ins></w:p></w:body></w:document>`;
    const model = readDocx(writeParts({ 'word/document.xml': strToU8(xml) }));
    const run = runs((paragraphs(model.blocks)[0] as Paragraph).children)[0];
    expect(run?.inserted).toMatchObject({ at: '2026-01-01T15:00Z', utc: true });
  });

  it('reads comment times from commentsExtensible, people and durable ids', () => {
    const w = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
    const parts = {
      'word/document.xml': strToU8(
        `<w:document ${w}><w:body><w:p><w:r><w:t>x</w:t></w:r></w:p></w:body></w:document>`,
      ),
      'word/comments.xml': strToU8(
        `<w:comments ${w} xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"><w:comment w:id="0" w:author="A" w:date="2026-01-01T10:00:00Z"><w:p w14:paraId="0000000A"><w:r><w:t>hi</w:t></w:r></w:p></w:comment></w:comments>`,
      ),
      'word/commentsIds.xml': strToU8(
        `<w16cid:commentsIds xmlns:w16cid="http://schemas.microsoft.com/office/word/2016/wordml/cid"><w16cid:commentId w16cid:paraId="0000000A" w16cid:durableId="0000ABCD"/></w16cid:commentsIds>`,
      ),
      'word/commentsExtensible.xml': strToU8(
        `<w16cex:commentsExtensible xmlns:w16cex="http://schemas.microsoft.com/office/word/2018/wordml/cex"><w16cex:commentExtensible w16cex:durableId="0000ABCD" w16cex:dateUtc="2026-01-01T15:00:00Z"/></w16cex:commentsExtensible>`,
      ),
      'word/people.xml': strToU8(
        `<w15:people xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml"><w15:person w15:author="A"><w15:presenceInfo w15:providerId="AD" w15:userId="S::a@example.org::1"/></w15:person></w15:people>`,
      ),
    };
    const model = readDocx(writeParts(parts));
    expect(model.comments[0]).toMatchObject({
      durableId: '0000ABCD',
      dateUtc: '2026-01-01T15:00:00Z',
      at: '2026-01-01T15:00Z',
      utc: true,
      anchor: { start: false, end: false, reference: false },
    });
    expect(model.people).toEqual([{ name: 'A', providerId: 'AD', userId: 'S::a@example.org::1' }]);
  });
});
