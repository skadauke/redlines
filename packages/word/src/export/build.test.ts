import { describe, expect, it } from 'vitest';
import { partText, readParts } from '../shared/zip.ts';
import { exportDocx } from './build.ts';

const LEDGER = `<!-- redlines
version: 1
tracking: everyone
people:
  ada: {name: Ada Lovelace, email: ada@example.org}
  bo: {name: Bo Chen}
  claude-ada: {name: Claude, agent: true, for: ada}
marks:
  k3x9: {by: ada, at: 2026-10-13T22:30Z}
  p7qd: {by: claude-ada, at: 2026-10-13T22:31Z}
  w2rf: {by: bo, at: 2026-10-13T22:35Z}
comments:
  c8d2:
    by: bo
    at: 2026-10-13T22:40Z
    text: |-
      Who signs off on the security review?
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

async function partsOf(text: string) {
  const parts = readParts(await exportDocx(text, { carriers: false }));
  const document = partText(parts, 'word/document.xml') ?? '';
  const comments = partText(parts, 'word/comments.xml') ?? '';
  return { parts, document, comments, settings: partText(parts, 'word/settings.xml') ?? '' };
}

/** The `w:id` of every element that has one, by element name. */
function idsOf(xml: string, element: string): string[] {
  return [...xml.matchAll(new RegExp(`<${element}\\b[^>]*\\bw:id="(\\d+)"`, 'g'))].map(
    (found) => found[1] as string,
  );
}

describe('exportDocx', () => {
  it('writes a zip with the parts of a Word file', async () => {
    const { parts } = await partsOf(SAMPLE);
    for (const name of ['[Content_Types].xml', 'word/document.xml', 'word/comments.xml']) {
      expect(Object.keys(parts)).toContain(name);
    }
  });

  it('writes insertions with their author and a date with seconds', async () => {
    const { document } = await partsOf(SAMPLE);
    expect(document).toMatch(
      /<w:ins w:id="\d+" w:author="Ada Lovelace" w:date="2026-10-13T22:30:00Z"><w:r><w:t[^>]*>new <\/w:t>/,
    );
  });

  it('writes a substitution as a deletion and then an insertion, by the same author and time', async () => {
    const { document } = await partsOf(SAMPLE);
    const sub =
      /<w:del w:id="\d+" w:author="Claude" w:date="2026-10-13T22:31:00Z"><w:r><w:delText[^>]*>March<\/w:delText><\/w:r><\/w:del><w:ins w:id="\d+" w:author="Claude" w:date="2026-10-13T22:31:00Z"><w:r><w:t[^>]*>April<\/w:t>/;
    expect(document).toMatch(sub);
  });

  it('keeps the spaces at the ends of the old text of a deletion', async () => {
    const { document } = await partsOf(SAMPLE);
    const text = [...document.matchAll(/w:author="Bo Chen"[^>]*><w:r><w:delText[^>]*>([^<]*)</g)]
      .map((found) => found[1])
      .join('');
    expect(text).toBe(' The old exporter stays as it is.');
  });

  it('turns Track Changes on when the ledger says tracking is for everyone', async () => {
    expect((await partsOf(SAMPLE)).settings).toContain('<w:trackRevisions');
    const without = await partsOf(SAMPLE.replace('tracking: everyone\n', ''));
    expect(without.settings).not.toContain('<w:trackRevisions');
  });

  it('writes compatibility mode 15', async () => {
    expect((await partsOf(SAMPLE)).settings).toMatch(
      /w:name="compatibilityMode"[^>]*w:val="15"|w:val="15"[^>]*w:name="compatibilityMode"/,
    );
  });

  it('gives a reply its own range and reference mark, and links it to its thread', async () => {
    const { document, comments } = await partsOf(SAMPLE);
    const ids = idsOf(comments, 'w:comment');
    expect(ids).toHaveLength(2);
    for (const id of ids) {
      expect(document).toContain(`<w:commentRangeStart w:id="${id}"/>`);
      expect(document).toContain(`<w:commentRangeEnd w:id="${id}"/>`);
      expect(document).toContain(`<w:commentReference w:id="${id}"/>`);
    }
    expect(comments).toContain('w:author="Bo Chen"');
    expect(comments).toContain('Who signs off on the security review?');
    expect(comments).toContain('Legal does.');
  });

  it('writes the thread links, the resolved state and the durable ids', async () => {
    const resolved = SAMPLE.replace(
      '    replies:',
      '    resolved: ada 2026-10-13T23:00Z\n    replies:',
    );
    const { parts } = await partsOf(resolved);
    const extended = partText(parts, 'word/commentsExtended.xml') ?? '';
    expect(extended).toContain('w15:done="1"');
    expect(extended).toContain('w15:paraIdParent=');
    expect(partText(parts, 'word/commentsIds.xml')).toMatch(/w16cid:durableId="[0-9A-F]{8}"/);
  });

  it('gives every revision and comment a different id', async () => {
    const { document, comments } = await partsOf(SAMPLE);
    const revisions = [...idsOf(document, 'w:ins'), ...idsOf(document, 'w:del')];
    const all = [...revisions, ...idsOf(comments, 'w:comment')];
    expect(new Set(all).size).toBe(all.length);
  });

  it('marks the paragraph mark of an insertion that runs on past the paragraph', async () => {
    const text = `One.

<!--ins k3x9-->Two.

Three.<!--/k3x9-->

${LEDGER}`;
    const { document } = await partsOf(text);
    // Both paragraphs are wholly inserted, so each goes with its mark when rejected.
    const marks = document.match(/<w:rPr><w:ins [^>]*\/><\/w:rPr><\/w:pPr>/g) ?? [];
    expect(marks).toHaveLength(2);
  });

  it('does not mark the paragraph of an insertion that ends it in the middle of the text', async () => {
    const { document } = await partsOf(`Ship <!--ins k3x9-->it<!--/k3x9-->\n\n${LEDGER}`);
    expect(document).not.toMatch(/<w:pPr><w:rPr><w:ins/);
  });

  it('writes a deleted paragraph as its own paragraph with its mark deleted', async () => {
    const { document } = await partsOf(`Keep.\n\n<!--del w2rf Gone.-->\n\nAfter.\n\n${LEDGER}`);
    expect(document).toMatch(
      /<w:p><w:pPr><w:rPr><w:del [^>]*\/><\/w:rPr><\/w:pPr><w:del [^>]*><w:r><w:delText[^>]*>Gone\.<\/w:delText>/,
    );
    expect(document).toMatch(/<w:p><w:r><w:t[^>]*>After\.<\/w:t><\/w:r><\/w:p>/);
  });

  it('writes a deletion across blocks as paragraphs whose marks are deleted', async () => {
    const { document } = await partsOf(
      `Alpha <!--del w2rf two.\\n\\n## Middle\\n\\nGamma -->five.\n\n${LEDGER}`,
    );
    expect(document.match(/<w:pPr><w:rPr><w:del /g)).toHaveLength(2);
    expect(document).not.toContain('<w:br/>');
    expect(document).toContain('>Middle<');
    expect(document).toContain('>five.<');
  });

  it('keeps a deletion after a final table, and does not throw on an impossible time', async () => {
    const bad = LEDGER.replace('at: 2026-10-13T22:40Z', 'at: 2026-13-45T22:40Z');
    const { document } = await partsOf(
      `| a | b |\n|---|---|\n| 1 | 2 |\n\n<!--del w2rf tail old-->\n\n${bad}`,
    );
    expect(document).toContain('>tail old<');
    expect(document).toMatch(/<\/w:tbl><w:p>/);
  });

  it('puts a comment on an insertion', async () => {
    const text = `The <!--ins k3x9--><!--cmt c8d2-->new<!--/c8d2--><!--/k3x9--> path.\n\n${LEDGER}`;
    const { document } = await partsOf(text);
    expect(document).toMatch(/<w:commentRangeStart[^>]*\/><w:ins [^>]*><w:r><w:t[^>]*>new</);
  });

  it('keeps emphasis, links, code and lists, and leaves the markers and the ledger out', async () => {
    const text = `## Heading

A **bold**, *italic*, ~~gone~~ and \`code\` [link](https://example.org/).

- one
- two

1. first
2. second

${LEDGER}`;
    const { document } = await partsOf(text);
    expect(document).toContain('<w:pStyle w:val="Heading2"/>');
    expect(document).toContain('<w:b/>');
    expect(document).toContain('<w:i/>');
    expect(document).toContain('<w:strike/>');
    expect(document).toContain('Courier New');
    expect(document).toContain('<w:hyperlink');
    expect(document).toContain('<w:numPr>');
    expect(document).not.toContain('redlines');
    expect(document).not.toContain('<!--');
  });

  it('leaves out the front matter', async () => {
    const { document } = await partsOf('---\ntitle: Plan\n---\n\nBody.\n');
    expect(document).toContain('Body.');
    expect(document).not.toContain('title: Plan');
  });

  it('writes a table with its text in the cells', async () => {
    const { document } = await partsOf('| a | b |\n|---|---|\n| x | y |\n');
    expect(document).toContain('<w:tbl>');
    expect(document.match(/<w:tc>/g)).toHaveLength(4);
  });

  it('writes a file without marks as a plain document', async () => {
    const { document, comments } = await partsOf('Just text.\n');
    expect(document).toContain('Just text.');
    expect(document).not.toContain('<w:ins ');
    expect(comments).not.toContain('<w:comment ');
  });

  it('puts a comment on a point', async () => {
    const text = `Before<!--cmt c8d2--> after.

${LEDGER}`;
    const { document } = await partsOf(text);
    expect(document).toMatch(
      /<w:commentRangeStart w:id="\d+"\/><w:commentRangeStart w:id="\d+"\/>/,
    );
  });

  it('names two people who share a name by their organization', async () => {
    const ledger = `<!-- redlines
version: 1
people:
  a1: {name: Sam Lee, org: Acme}
  a2: {name: Sam Lee, org: Beta}
marks:
  k3x9: {by: a1, at: 2026-10-13T22:30Z}
  p7qd: {by: a2, at: 2026-10-13T22:31Z}
-->
`;
    const { document } = await partsOf(
      `<!--ins k3x9-->one<!--/k3x9--> <!--ins p7qd-->two<!--/p7qd-->\n\n${ledger}`,
    );
    expect(document).toContain('w:author="Sam Lee (Acme)"');
    expect(document).toContain('w:author="Sam Lee (Beta)"');
  });
});
