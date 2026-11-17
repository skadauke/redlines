import { describe, expect, it } from 'vitest';
import { exportDocx } from '../export/build.ts';
import { partText, readParts, writeParts } from '../shared/zip.ts';
import { durableId } from '../shared/ids.ts';
import { readSource, readSourceXml, sourceXml, survivingBlocks } from './index.ts';
import { elementsOf, escapeXml, unescapeXml } from './xml.ts';

const LEDGER = `<!-- redlines
version: 1
tracking: everyone
people:
  ada: {name: Ada Lovelace}
  bo: {name: Bo Chen}
marks:
  k3x9: {by: ada, at: 2026-10-13T22:30Z}
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

const SAMPLE = `# Plan & more

We will ship the <!--ins k3x9-->new <!--/k3x9-->importer, after the <!--cmt c8d2-->review<!--/c8d2-->.

| a | b |
| - | - |
| <!--cmt c5x4-->1<!--/c5x4--> | 2 |

${LEDGER}`;

async function exported(text: string) {
  const bytes = await exportDocx(text);
  const parts = readParts(bytes);
  return { bytes, parts, text: (name: string) => partText(parts, name) ?? '' };
}

/** Every start tag has its end tag, in order: the XML a reader needs. */
function balanced(xml: string): boolean {
  const stack: string[] = [];
  for (const tag of xml
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '')
    .matchAll(/<(\/?)([\w:.-]+)[^>]*?(\/?)>/g)) {
    if (tag[3]) continue;
    if (tag[1]) {
      if (stack.pop() !== tag[2]) return false;
    } else stack.push(tag[2] as string);
  }
  return stack.length === 0;
}

describe('the source part', () => {
  it('carries the Markdown and the ledger, and reads back exactly', async () => {
    const { parts } = await exported(SAMPLE);
    const source = readSource(parts);
    expect(source?.markdown).toBe(SAMPLE);
    expect(source?.ledger.comments.map((thread) => thread.id)).toEqual(['c8d2', 'c5x4']);
    expect(source?.ledger.people.map((person) => person.name)).toEqual(['Ada Lovelace', 'Bo Chen']);
  });

  it('is linked from the document and has properties, so that Word keeps it', async () => {
    const { text, parts } = await exported(SAMPLE);
    expect(Object.keys(parts)).toContain('customXml/redlines-source.xml');
    expect(text('word/_rels/document.xml.rels')).toMatch(
      /Type="[^"]*\/relationships\/customXml" Target="\.\.\/customXml\/redlines-source\.xml"/,
    );
    expect(text('[Content_Types].xml')).toContain('customXmlProperties+xml');
    expect(text('customXml/itemProps-redlines-source.xml')).toMatch(
      /ds:itemID="\{[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-8[0-9A-F]{3}-[0-9A-F]{12}\}"/,
    );
    expect(balanced(text('customXml/redlines-source.xml'))).toBe(true);
  });

  it('is found by its content when an app renames it', async () => {
    const { parts } = await exported(SAMPLE);
    const renamed = { ...parts };
    renamed['customXml/item1.xml'] = renamed['customXml/redlines-source.xml'] as Uint8Array;
    delete renamed['customXml/redlines-source.xml'];
    expect(readSource(readParts(writeParts(renamed)))?.markdown).toBe(SAMPLE);
  });

  it('keeps carriage returns, markup characters, astral characters and CDATA ends', () => {
    const markdown = 'a\r\nb <c> & "d" ]]> 😀 \t\n\n';
    const found = readSourceXml(sourceXml({ markdown, ledger: emptyLedger(), blocks: [] }));
    expect(found?.markdown).toBe(markdown);
  });

  it('keeps characters that XML cannot hold, as base64', () => {
    const markdown = 'bell \u0007 and a lone \ud800 and more';
    const xml = sourceXml({ markdown, ledger: emptyLedger(), blocks: [] });
    expect(xml).toContain('encoding="base64"');
    expect(readSourceXml(xml)?.markdown).toBe('bell \u0007 and a lone \ufffd and more');
  });

  it('keeps the ledger well-formed when a comment holds U+FFFE', () => {
    const ledger = { version: 1, note: 'x\ufffey' } as never;
    const xml = sourceXml({ markdown: 'a', ledger, blocks: [] });
    expect(xml).not.toContain('\ufffe');
    expect((readSourceXml(xml)?.ledger as unknown as { note: string }).note).toBe('x\ufffey');
  });

  it('is not found in a part that is not ours', () => {
    expect(readSourceXml('<root><markdown>x</markdown><ledger>{}</ledger></root>')).toBeUndefined();
  });

  it('is absent when the file is written without carriers', async () => {
    const parts = readParts(await exportDocx(SAMPLE, { carriers: false }));
    expect(readSource(parts)).toBeUndefined();
    expect(Object.keys(parts).some((name) => name.startsWith('customXml'))).toBe(false);
  });
});

function emptyLedger() {
  return { version: 1 } as never;
}

describe('the block bookmarks', () => {
  it('wraps each block in a hidden bookmark that the source part lists', async () => {
    const { parts, text } = await exported(SAMPLE);
    const document = text('word/document.xml');
    const source = readSource(parts);
    const ids = survivingBlocks(document);
    expect(ids).toEqual(source?.blocks.map((block) => block.id));
    expect(ids.length).toBe(3);
    expect(source?.blocks.map((block) => block.type)).toEqual(['heading', 'paragraph', 'table']);
    for (const block of source?.blocks ?? []) {
      expect(SAMPLE.slice(block.from, block.to).length).toBeGreaterThan(0);
    }
  });

  it('pairs every start with an end, with ids that no other bookmark has', async () => {
    const { text } = await exported(SAMPLE);
    const document = text('word/document.xml');
    const starts = elementsOf(document, 'bookmarkStart');
    const ends = elementsOf(document, 'bookmarkEnd');
    expect(starts.map((start) => start['id']).sort()).toEqual(ends.map((end) => end['id']).sort());
    expect(new Set(starts.map((start) => start['id'])).size).toBe(starts.length);
    for (const start of starts) expect(start['name']).toMatch(/^_rl_b\d+$/);
  });

  it('puts a table block in its first and last cells', async () => {
    const { text } = await exported(SAMPLE);
    const document = text('word/document.xml');
    const table = /<w:tbl>[\s\S]*<\/w:tbl>/.exec(document)?.[0] ?? '';
    expect(table.indexOf('bookmarkStart')).toBeGreaterThan(0);
    expect(table.indexOf('bookmarkEnd')).toBeGreaterThan(table.indexOf('bookmarkStart'));
    expect(balanced(document)).toBe(true);
  });

  it('is left out without carriers', async () => {
    const parts = readParts(await exportDocx(SAMPLE, { carriers: false }));
    expect(partText(parts, 'word/document.xml')).not.toContain('bookmarkStart');
  });
});

describe('the comment parts', () => {
  it('threads replies and marks a lone resolved thread done', async () => {
    const { text } = await exported(SAMPLE);
    const extended = elementsOf(text('word/commentsExtended.xml'), 'commentEx');
    expect(extended.length).toBe(3);
    const [root, reply, resolved] = extended;
    expect(root?.['done']).toBe('0');
    expect(reply?.['paraIdParent']).toBe(root?.['paraId']);
    expect(resolved?.['done']).toBe('1');
    expect(resolved?.['paraIdParent']).toBeUndefined();
  });

  it('gives each comment the durable id derived from its Redlines id, in both parts', async () => {
    const { text } = await exported(SAMPLE);
    const expected = [durableId('c8d2'), durableId('c8d2', 'r4fz'), durableId('c5x4')];
    const ids = elementsOf(text('word/commentsIds.xml'), 'commentId');
    expect(ids.map((id) => id['durableId'])).toEqual(expected);
    const extensible = elementsOf(text('word/commentsExtensible.xml'), 'commentExtensible');
    expect(extensible.map((item) => item['durableId'])).toEqual(expected);
    expect(extensible.map((item) => item['dateUtc'])).toEqual([
      '2026-10-13T22:40:00Z',
      '2026-10-13T22:45:00Z',
      '2026-10-13T22:46:00Z',
    ]);
  });

  it('uses the paragraph ids that comments.xml has, and registers each part once', async () => {
    const { text } = await exported(SAMPLE);
    const comments = text('word/comments.xml');
    for (const item of elementsOf(text('word/commentsExtended.xml'), 'commentEx')) {
      expect(comments).toContain(`w14:paraId="${item['paraId']}"`);
    }
    const rels = text('word/_rels/document.xml.rels');
    const types = text('[Content_Types].xml');
    for (const name of ['commentsExtended', 'commentsIds', 'commentsExtensible']) {
      expect(rels.split(`Target="${name}.xml"`).length).toBe(2);
      expect(types.split(`PartName="/word/${name}.xml"`).length).toBe(2);
    }
    for (const name of ['commentsExtended', 'commentsIds', 'commentsExtensible']) {
      expect(balanced(text(`word/${name}.xml`))).toBe(true);
    }
  });

  it('writes no comment parts for a file with no comments', async () => {
    const { parts } = await exported('Just text.\n');
    expect(Object.keys(parts)).not.toContain('word/commentsExtensible.xml');
  });
});

describe('the revisions', () => {
  it('carry their UTC time, and the document says to ignore the attribute', async () => {
    const { text } = await exported(SAMPLE);
    const document = text('word/document.xml');
    expect(document).toMatch(
      /<w:ins w:id="\d+" w:author="Ada Lovelace" w:date="2026-10-13T22:30:00Z" w16du:dateUtc="2026-10-13T22:30:00Z">/,
    );
    expect(document).toMatch(
      /xmlns:w16du="http:\/\/schemas\.microsoft\.com\/office\/word\/2023\/wordml\/word16du"/,
    );
    expect(/mc:Ignorable="([^"]*)"/.exec(document)?.[1]?.split(' ')).toContain('w16du');
    expect(balanced(document)).toBe(true);
  });
});

describe('xml text', () => {
  it('escapes and reads back', () => {
    const text = 'a & b < c > "d" \r e';
    expect(unescapeXml(escapeXml(text))).toBe(text);
    expect(unescapeXml('&#x1F600;&#128512;&amp;lt;')).toBe('😀😀&lt;');
  });
});
