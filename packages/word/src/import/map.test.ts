import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { acceptAll, applyChanges, parse, rejectAll } from '@redlines/format';
import { describe, expect, it } from 'vitest';
import { exportDocx } from '../export/build.ts';
import { mapDocx, warningsOf } from './map.ts';
import type { ImportResult, RestoreSource } from './map.ts';
import { readDocx } from './read.ts';

function fixture(relative: string): Uint8Array {
  return new Uint8Array(readFileSync(fileURLToPath(new URL(relative, import.meta.url))));
}

const LEDGER = `<!-- redlines
version: 1
people:
  ada: {name: Ada Lovelace}
  bo: {name: Bo Chen}
  claude-ada: {name: Claude, agent: true, for: ada}
marks:
  k3x9: {by: ada, at: 2026-10-13T22:30Z}
  p7qd: {by: claude-ada, at: 2026-10-13T22:31Z}
  w2rf: {by: bo, at: 2026-10-13T22:35Z}
  m4bd: {by: bo, at: 2026-10-13T22:36Z}
  n8fx: {by: ada, at: 2026-10-13T22:37Z}
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

/** The body of a file, without its ledger, with no difference that the views don't make. */
function plain(text: string): string {
  return text
    .split(/\n*<!-- redlines/)[0]!
    .replace(/<!--(?:cmt \w+|\/\w+)-->/g, '')
    .replace(/\\([^\w\s])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function views(markdown: string): { accepted: string; rejected: string } {
  return {
    accepted: plain(applyChanges(markdown, acceptAll(markdown))),
    rejected: plain(applyChanges(markdown, rejectAll(markdown))),
  };
}

/** The result opens cleanly: the parser has nothing to say about it. */
function clean(result: ImportResult): void {
  expect(warningsOf(result.markdown)).toEqual([]);
}

async function roundTrip(markdown: string): Promise<ImportResult> {
  return mapDocx(readDocx(await exportDocx(markdown)));
}

describe('mapDocx on the exporter’s own files', () => {
  it('brings back the text in both views, the people, the marks and the thread', async () => {
    const result = await roundTrip(SAMPLE);
    clean(result);
    expect(views(result.markdown)).toEqual(views(SAMPLE));
    const parsed = parse(result.markdown);
    expect(parsed.ledger.people.map((person) => person.name).toSorted()).toEqual([
      'Ada Lovelace',
      'Bo Chen',
      'Claude',
    ]);
    const kinds = parsed.marks.map((mark) => mark.kind).toSorted();
    expect(kinds).toEqual(['cmt', 'del', 'ins', 'sub']);
    const thread = parsed.ledger.comments[0]!;
    expect(thread.text).toBe('Who signs off on the security review?');
    expect(thread.replies.map((reply) => reply.text)).toEqual(['Legal does.']);
    expect(thread.by).toBe('bo-chen');
    expect(Object.values(parsed.ledger.marks).map((entry) => entry.at)).toContain(
      '2026-10-13T22:31Z',
    );
  });

  it('makes new ids and takes handles from names', async () => {
    const result = await roundTrip(SAMPLE);
    for (const old of ['k3x9', 'p7qd', 'w2rf', 'c8d2', 'r4fz']) {
      expect(result.markdown).not.toContain(old);
    }
    expect(
      parse(result.markdown)
        .ledger.people.map((person) => person.handle)
        .toSorted(),
    ).toEqual(['ada-lovelace', 'bo-chen', 'claude']);
  });

  it('writes a deletion next to an insertion by one author as a substitution', async () => {
    const result = await roundTrip(
      `He said <!--sub p7qd March-->April<!--/p7qd--> twice.\n\n${LEDGER}`,
    );
    clean(result);
    expect(result.markdown).toMatch(/<!--sub \w{4} March-->April<!--\/\w{4}-->/);
  });

  it('keeps a deletion and an insertion by two people apart', async () => {
    const markdown = `One <!--del w2rf two--><!--ins k3x9-->three<!--/k3x9--> four.\n\n${LEDGER}`;
    const result = await roundTrip(markdown);
    clean(result);
    expect(result.markdown).not.toContain('<!--sub');
    expect(views(result.markdown)).toEqual(views(markdown));
  });

  it('keeps a resolved thread resolved', async () => {
    const markdown = SAMPLE.replace(
      '    replies:',
      '    resolved: ada 2026-10-13T23:00Z\n    replies:',
    );
    const result = await roundTrip(markdown);
    clean(result);
    expect(parse(result.markdown).ledger.comments[0]?.resolved).toBeDefined();
  });

  it('keeps inserted, deleted and joined paragraphs', async () => {
    const markdown = `One.

<!--ins k3x9-->

Two inserted.<!--/k3x9-->

Three<!--del w2rf \\n\\n-->Four joined.

${LEDGER}`;
    const result = await roundTrip(markdown);
    clean(result);
    expect(views(result.markdown)).toEqual(views(markdown));
  });

  it('keeps a deleted paragraph', async () => {
    const markdown = `One.<!--del w2rf \\n\\nTwo deleted.-->

Three.

${LEDGER}`;
    const result = await roundTrip(markdown);
    clean(result);
    expect(views(result.markdown)).toEqual(views(markdown));
  });

  it('keeps headings, lists, emphasis, links and code', async () => {
    const markdown = `# Title

Some *emphasis*, **strong** and \`code\` and a [link](https://example.org/a).

- one
- two
  - nested

1. first
2. second
`;
    const result = await roundTrip(markdown);
    clean(result);
    expect(result.markdown).toBe(markdown.replace('[link]', '[linkhttps://example.org/a]'));
  });

  it('keeps a table, and changes in its cells', async () => {
    const markdown = `| a | b |
| --- | --- |
| 1 | <!--ins k3x9-->2<!--/k3x9--> |

${LEDGER.split('comments:')[0]}-->
`;
    const result = await roundTrip(markdown);
    clean(result);
    expect(views(result.markdown)).toEqual(views(markdown));
  });

  it('keeps a comment on a point', async () => {
    const markdown = `Look here<!--cmt c8d2--> now.\n\n${LEDGER}`;
    const result = await roundTrip(markdown);
    clean(result);
    expect(parse(result.markdown).ledger.comments).toHaveLength(1);
  });

  it('keeps a comment that spans paragraphs', async () => {
    const markdown = `One <!--cmt c8d2-->two.\n\nThree<!--/c8d2--> four.\n\n${LEDGER}`;
    const result = await roundTrip(markdown);
    clean(result);
    expect(parse(result.markdown).ledger.comments).toHaveLength(1);
    expect(views(result.markdown)).toEqual(views(markdown));
  });
});

describe('mapDocx on the Word sample', () => {
  const samples = () =>
    mapDocx(readDocx(fixture('../../../../docs/word-export/samples/track-changes-samples.docx')));

  it('opens cleanly, and lists nothing it cannot keep that it can', () => {
    const result = samples();
    clean(result);
    expect(
      parse(result.markdown)
        .ledger.people.map((p) => p.name)
        .toSorted(),
    ).toEqual(['Alice', 'Bob', 'Carol']);
  });

  it('decides every change without an error, in both directions', () => {
    const { markdown } = samples();
    const { accepted, rejected } = views(markdown);
    expect(accepted).toContain('An inserted paragraph.');
    expect(accepted).toContain('## 5. Formatting changes');
    expect(accepted).not.toContain('A deleted paragraph.');
    expect(rejected).toContain('A deleted paragraph.');
    expect(rejected).not.toContain('An inserted paragraph.');
    expect(rejected).toContain('Latency | 300 ms');
    expect(accepted).toContain('Latency | 200 ms');
  });

  it('links the two ends of a move', () => {
    const result = samples();
    const marks = Object.values(parse(result.markdown).ledger.marks);
    expect(marks.filter((entry) => entry.move).length).toBe(2);
  });

  it('writes a changed format as a format change', () => {
    const { markdown } = samples();
    expect(markdown).toMatch(/<!--fmt \w{4} \+bold-->\*\*newly bold\*\*<!--\/\w{4}-->/);
    expect(markdown).toMatch(/<!--fmt \w{4} was=p-->/);
  });

  it('writes a change to a table that Word made in its structure as a substitution of the table', () => {
    const { markdown } = samples();
    expect(markdown).toMatch(/<!--sub \w{4} \\\| Metric/);
  });

  it('keeps the thread with its replies and the resolved state', () => {
    const comments = parse(samples().markdown).ledger.comments;
    expect(comments.map((c) => c.replies.length).toSorted()).toEqual([0, 0, 0, 2]);
    expect(comments.filter((c) => c.resolved)).toHaveLength(1);
  });

  it('keeps the pictures, by the path the Markdown names', () => {
    const result = samples();
    const paths = Object.keys(result.media);
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) expect(result.markdown).toContain(`](${path})`);
  });
});

describe('mapDocx on a file Google Docs wrote', () => {
  it('opens cleanly, with the suggestions as marks and the comment as a thread', () => {
    const result = mapDocx(readDocx(fixture('../../fixtures/docs-suggestions-and-comment.docx')));
    clean(result);
    const parsed = parse(result.markdown);
    expect(parsed.marks.length).toBeGreaterThan(0);
    expect(parsed.ledger.comments.length).toBeGreaterThan(0);
    expect(() => applyChanges(result.markdown, acceptAll(result.markdown))).not.toThrow();
    expect(() => applyChanges(result.markdown, rejectAll(result.markdown))).not.toThrow();
  });
});

describe('the restore of blocks Word left alone', () => {
  const source = (markdown: string): RestoreSource => ({
    markdown,
    blocks: [{ id: 'b1', type: 'paragraph', from: 0, to: markdown.length }],
  });

  it('is skipped when the file has no source', async () => {
    const result = await roundTrip('A *b* c.\n');
    expect(result.markdown).toBe('A *b* c.\n');
  });

  it('writes a block as it was, byte for byte, when its text is the same', async () => {
    const original = 'A _b_  c.';
    const docx = readDocx(await exportDocx('A *b* c.\n'));
    const first = docx.blocks[0];
    if (first?.type !== 'paragraph') throw new Error('no paragraph');
    first.children.unshift({ type: 'bookmarkStart', name: '_rl_b1', id: 1 });
    const result = mapDocx(docx, { source: source(original) });
    expect(result.markdown).toBe(`${original}\n`);
  });

  it('does not restore a block whose words Word changed', async () => {
    const docx = readDocx(await exportDocx('A *b* c.\n'));
    const first = docx.blocks[0];
    if (first?.type !== 'paragraph') throw new Error('no paragraph');
    first.children.unshift({ type: 'bookmarkStart', name: '_rl_b1', id: 1 });
    const result = mapDocx(docx, { source: source('Something else.') });
    expect(result.markdown).toBe('A *b* c.\n');
  });
});
