// Blocks and marks that the exporter's files don't have: the model is built by hand, and each
// result is held to the format's own decisions: what accepting every change and rejecting every
// change give, byte for byte.

import { acceptAll, applyChanges, parse, rejectAll } from '@redlines/format';
import { describe, expect, it } from 'vitest';
import { mapDocx, warningsOf } from './map.ts';
import type {
  Block,
  DocxModel,
  Inline,
  Paragraph,
  Revision,
  Run,
  RunFormat,
  Table,
} from './model.ts';

const FORMAT: RunFormat = {
  bold: false,
  italic: false,
  strike: false,
  underline: false,
  superscript: false,
  subscript: false,
  code: false,
  other: [],
};

function rev(author: string, at = '2026-10-13T10:00Z'): Revision {
  return { id: 1, author, date: at, at, utc: true };
}

type RunOptions = Partial<Omit<Run, 'type' | 'text' | 'format'>> & { format?: Partial<RunFormat> };

function run(text: string, options: RunOptions = {}): Run {
  const { format, ...rest } = options;
  return { type: 'run', text, format: { ...FORMAT, ...format }, ...rest };
}

const ins = (text: string, by = 'Ada', format?: Partial<RunFormat>) =>
  run(text, { inserted: rev(by), ...(format ? { format } : {}) });
const del = (text: string, by = 'Ada') => run(text, { deleted: rev(by) });

function para(children: Inline[], extra: Partial<Paragraph> = {}): Paragraph {
  return { type: 'paragraph', other: [], mark: {}, children, ...extra };
}

const item = (children: Inline[], extra: Partial<Paragraph> = {}): Paragraph =>
  para(children, {
    list: { numId: 1, level: 0, format: 'bullet', ordered: false },
    ...extra,
  });

function model(blocks: Block[], extra: Partial<DocxModel> = {}): DocxModel {
  return {
    blocks,
    comments: [],
    threads: [],
    people: [],
    footnotes: [],
    endnotes: [],
    styles: {},
    trackRevisions: true,
    media: {},
    report: [],
    trackRevisions_: undefined,
    ...extra,
  } as unknown as DocxModel;
}

function body(markdown: string): string {
  return `${(markdown.split(/\n*<!-- redlines/)[0] ?? '').replace(/\n+$/, '')}\n`;
}

/** The file, and what every decision gives. */
function map(blocks: Block[], extra: Partial<DocxModel> = {}) {
  const result = mapDocx(model(blocks, extra));
  const text = result.markdown;
  expect(warningsOf(text), text).toEqual([]);
  return {
    file: body(text),
    accepted: body(applyChanges(text, acceptAll(text))),
    rejected: body(applyChanges(text, rejectAll(text))),
    result,
  };
}

describe('marks that start a block', () => {
  it('puts the opener of a substitution at the start of a paragraph on a line of its own', () => {
    const { file, accepted, rejected } = map([
      para([del('Old'), ins('New'), run(' words.')]),
      para([run('Next.')]),
    ]);
    expect(file).toMatch(/^<!--sub \w{4} Old-->\n\nNew<!--\/\w{4}--> words\.\n\nNext\./);
    expect(accepted).toBe('New words.\n\nNext.\n');
    expect(rejected).toBe('Old words.\n\nNext.\n');
  });

  it('does the same in a list item, and keeps the list', () => {
    const { file, accepted, rejected } = map([
      item([run('one')]),
      item([ins('two '), run('three')]),
      item([run('four')]),
    ]);
    expect(file).toMatch(/^- one\n- <!--ins \w{4}-->\n {2}two <!--\/\w{4}-->three\n- four/);
    expect(accepted).toBe('- one\n- two three\n- four\n');
    expect(rejected).toBe('- one\n- three\n- four\n');
  });

  it('writes a mark in a heading after its hashes', () => {
    const { file, accepted, rejected } = map([
      para([ins('Added'), run(' heading')], { headingLevel: 2 }),
    ]);
    expect(file).toMatch(/^## <!--ins \w{4}-->Added<!--\/\w{4}--> heading/);
    expect(accepted).toBe('## Added heading\n');
    expect(rejected).toBe('##  heading\n');
  });

  it('puts the openers of several marks in a row, each on its own line', () => {
    const { accepted, rejected } = map([para([ins('a'), run(' b ', {}), del('c', 'Bo')])]);
    expect(accepted).toBe('a b \n');
    expect(rejected).toBe(' b c\n');
  });
});

describe('paragraph marks', () => {
  it('writes an inserted paragraph as one insertion of the break and the text', () => {
    const { file, accepted, rejected } = map([
      para([run('One.')], { mark: { inserted: rev('Ada') } }),
      para([ins('Two.')], { mark: { inserted: rev('Ada') } }),
      para([run('Three.')]),
    ]);
    expect(file).toMatch(
      /^One\.<!--ins \w{4}-->\n\nTwo\.<!--\/\w{4}--><!--split \w{4}-->\n\nThree\.\n/,
    );
    expect(accepted).toBe('One.\n\nTwo.\n\nThree.\n');
    expect(rejected).toBe('One.Three.\n');
  });

  it('writes a deleted paragraph after the paragraph before it, whole', () => {
    const { file, accepted, rejected } = map([
      para([run('One.')]),
      para([del('Two.')], { mark: { deleted: rev('Ada') } }),
      para([run('Three.')]),
    ]);
    expect(file).toMatch(/^One\.<!--del \w{4} \\n\\nTwo\.-->\n\nThree\./);
    expect(accepted).toBe('One.\n\nThree.\n');
    expect(rejected).toBe('One.\n\nTwo.\n\nThree.\n');
  });

  it('writes a deleted first paragraph on a line of its own', () => {
    const { accepted, rejected } = map([
      para([del('Gone.')], { mark: { deleted: rev('Ada') } }),
      para([run('Stays.')]),
    ]);
    expect(accepted).toBe('Stays.\n');
    expect(rejected).toBe('Gone.\n\nStays.\n');
  });

  it('keeps the type of the paragraph that stays when a deleted paragraph goes before a heading', () => {
    const { accepted } = map([
      para([run('One.')]),
      para([del('Two.')], { mark: { deleted: rev('Ada') } }),
      para([run('Head')], { headingLevel: 2 }),
    ]);
    expect(accepted).toBe('One.\n\n## Head\n');
  });

  it('writes a deleted mark inside a paragraph as the join of the two', () => {
    const { accepted, rejected } = map([
      para([run('One')], { mark: { deleted: rev('Ada') } }),
      para([run('Two')]),
    ]);
    expect(accepted).toBe('OneTwo\n');
    expect(rejected).toBe('One\n\nTwo\n');
  });

  it('joins two by different people without a substitution', () => {
    const { rejected } = map([
      para([run('One')], { mark: { deleted: rev('Bo') } }),
      para([del('Two', 'Ada')]),
    ]);
    expect(rejected).toBe('One\n\nTwo\n');
  });
});

describe('lists', () => {
  it('writes an inserted item, a deleted item and a nested item', () => {
    const { file, accepted, rejected } = map([
      item([run('one')], { mark: { inserted: rev('Ada') } }),
      item([ins('two')]),
      item([del('three')], { mark: { deleted: rev('Bo') } }),
      item([run('four')], { list: { numId: 1, level: 1, format: 'bullet', ordered: false } }),
    ]);
    expect(file).toContain('  - four');
    expect(accepted).toBe('- one\n- two\n  - four\n');
    expect(rejected).toBe('- one\n- three\n  - four\n');
  });

  it('numbers an ordered list from one and starts another list afresh', () => {
    const ordered = (n: number, text: string) =>
      item([run(text)], { list: { numId: n, level: 0, format: 'decimal', ordered: true } });
    const { file } = map([ordered(1, 'a'), ordered(1, 'b'), ordered(2, 'c')]);
    expect(file).toBe('1. a\n2. b\n\n1. c\n');
  });
});

describe('formatting', () => {
  it('nests emphasis, and leaves white space at the edges outside it', () => {
    const { file } = map([
      para([
        run('a ', { format: { bold: true } }),
        run('b', { format: { bold: true, italic: true } }),
        run(' c', { format: { bold: true } }),
        run(' d'),
        run('code', { format: { code: true } }),
      ]),
    ]);
    expect(file).toBe('**a *b* c** d`code`\n');
  });

  it('escapes what Markdown would read as syntax', () => {
    const { file } = map([
      para([run('1 * 2 < 3, a_b, [x], `y`, <!-- c --> and &amp;')]),
      para([run('# not a heading')]),
      para([run('- not a list')]),
      para([run('1. not a list')]),
    ]);
    expect(file).toBe(
      '1 \\* 2 \\< 3, a\\_b, \\[x\\], \\`y\\`, \\<!-- c --\\> and \\&amp;\n\n\\# not a heading\n\n\\- not a list\n\n1\\. not a list\n',
    );
  });

  it('writes a changed format as a format change, round-tripping in both directions', () => {
    const was = { ...FORMAT };
    const { file, accepted, rejected } = map([
      para([
        run('Plain '),
        run('bold', {
          format: { bold: true },
          formatChange: { revision: rev('Ada'), old: was },
        }),
        run(' text.'),
      ]),
    ]);
    expect(file).toMatch(/Plain <!--fmt \w{4} \+bold-->\*\*bold\*\*<!--\/\w{4}--> text\./);
    expect(accepted).toBe('Plain **bold** text.\n');
    expect(rejected).toBe('Plain bold text.\n');
  });

  it('keeps a hard break and puts no marker at the start of the line after it', () => {
    const { file, accepted } = map([para([run('one\n'), ins('two'), run(' three')])]);
    expect(file).not.toMatch(/\n<!--/);
    expect(accepted).toBe('one\\\ntwo three\n');
  });

  it('writes a fenced block for paragraphs that are code', () => {
    const { file } = map([
      para([run('let a = 1;', { format: { code: true } })]),
      para([run('let b = 2;', { format: { code: true } })]),
    ]);
    expect(file).toBe('```\nlet a = 1;\nlet b = 2;\n```\n');
  });

  it('writes a quote, and the report says what it dropped', () => {
    const { file, result } = map([
      para([run('Said.')], { styleName: 'Quote', other: ['shd'] }),
      para([run('More.')], { styleName: 'Quote' }),
    ]);
    expect(file).toBe('> Said.\n>\n> More.\n');
    expect(result.report.entries.map((entry) => entry.message)).toContain(
      'Formatting with no Markdown form was dropped: shd.',
    );
  });
});

describe('links, images and notes', () => {
  it('writes a link around its text, and a link inside the document as its text', () => {
    const { file } = map([
      para([
        { type: 'link', href: 'https://example.org/a b', children: [run('here')] },
        run(' and '),
        { type: 'link', anchor: 'top', children: [run('there')] },
      ]),
    ]);
    expect(file).toBe('[here](https://example.org/a%20b) and there\n');
  });

  it('writes a footnote with its text', () => {
    const { file } = map([para([run('Claim.'), { type: 'note', kind: 'footnote', id: 2 }])], {
      footnotes: [{ id: 2, blocks: [para([run('The source.')])] }],
    });
    expect(file).toBe('Claim.[^1]\n\n[^1]: The source.\n');
  });
});

describe('comments', () => {
  const comment = (id: number, extra = {}) => ({
    id,
    author: 'Bo',
    initials: 'B',
    date: '',
    at: '2026-10-13T10:00Z',
    utc: true,
    blocks: [para([run(`Comment ${id}`)])],
    text: `Comment ${id}`,
    done: false,
    anchor: { start: true, end: true, reference: true },
    ...extra,
  });

  it('anchors a thread to its range, with the replies in the ledger', () => {
    const root = comment(1);
    const reply = comment(2, { parentId: 1 });
    const { file, result } = map(
      [
        para([
          run('See '),
          { type: 'commentStart', id: 1 },
          { type: 'commentStart', id: 2 },
          run('this'),
          { type: 'commentEnd', id: 1 },
          { type: 'commentEnd', id: 2 },
          { type: 'commentReference', id: 1 },
          { type: 'commentReference', id: 2 },
          run('.'),
        ]),
      ],
      {
        comments: [root, reply] as never,
        threads: [{ root, replies: [reply], resolved: false }] as never,
      },
    );
    expect(file).toMatch(/^See <!--cmt \w{4}-->this<!--\/\w{4}-->\.\n/);
    const thread = parse(result.markdown).ledger.comments[0];
    expect(thread?.text).toBe('Comment 1');
    expect(thread?.replies.map((r) => r.text)).toEqual(['Comment 2']);
  });

  it('keeps a comment that Word anchored nowhere, as a point at the end', () => {
    const root = comment(1, { anchor: { start: false, end: false, reference: false } });
    const { result } = map([para([run('Text.')])], {
      comments: [root] as never,
      threads: [{ root, replies: [], resolved: false }] as never,
    });
    expect(parse(result.markdown).ledger.comments).toHaveLength(1);
  });
});

describe('tables', () => {
  const cell = (blocks: Block[], extra = {}) => ({ blocks, span: 1, ...extra });
  const row = (cells: ReturnType<typeof cell>[], extra = {}) => ({
    cells,
    header: false,
    ...extra,
  });

  it('writes a table, with marks in its cells', () => {
    const table: Table = {
      type: 'table',
      grid: [100, 100],
      rows: [
        row([cell([para([run('a')])]), cell([para([run('b|c')])])]),
        row([cell([para([run('1')])]), cell([para([ins('2')])])]),
      ],
    };
    const { file, accepted, rejected } = map([table]);
    expect(file).toMatch(
      /^\| a \| b\\\|c \|\n\| --- \| --- \|\n\| 1 \| <!--ins \w{4}-->2<!--\/\w{4}--> \|\n/,
    );
    expect(accepted).toBe('| a | b\\|c |\n| --- | --- |\n| 1 | 2 |\n');
    expect(rejected).toBe('| a | b\\|c |\n| --- | --- |\n| 1 |  |\n');
  });

  it('writes a table that has an inserted row as a substitution of the table', () => {
    const table: Table = {
      type: 'table',
      grid: [100],
      rows: [
        row([cell([para([run('a')])])]),
        row([cell([para([ins('new')])])], { inserted: rev('Ada') }),
      ],
    };
    const { file, accepted, rejected } = map([para([run('Before.')]), table]);
    expect(file).toMatch(/<!--sub \w{4} \\\| a \\\|\\n\\\| -\\-\\- \\\|-->/);
    expect(accepted).toBe('Before.\n\n| a |\n| --- |\n| new |\n');
    expect(rejected).toBe('Before.\n\n| a |\n| --- |\n');
  });

  it('says that it split merged cells', () => {
    const table: Table = {
      type: 'table',
      grid: [100, 100],
      rows: [row([cell([para([run('wide')])], { span: 2 })])],
    };
    const { result } = map([table]);
    expect(result.report.entries.some((entry) => entry.kind === 'table')).toBe(true);
  });
});

describe('the report', () => {
  it('says once what it dropped, and how often it came up', () => {
    const { result } = map([
      para([run('a', { format: { underline: true, other: ['color'] } })]),
      para([run('b', { format: { underline: true, other: ['color'] } })], { align: 'center' }),
    ]);
    const messages = result.report.entries.map((entry) => entry.message);
    expect(messages).toContain('Underlining was dropped: Markdown has no underline. (2 places)');
    expect(messages).toContain('Formatting with no Markdown form was dropped: color. (2 places)');
    expect(messages).toContain('Formatting with no Markdown form was dropped: alignment.');
  });

  it('carries over what the reader could not keep', () => {
    const { result } = map([para([run('a')])], {
      report: [{ kind: 'text box', message: 'A text box was flattened.' }],
    });
    expect(result.report.entries).toContainEqual({
      kind: 'text box',
      message: 'A text box was flattened.',
    });
  });
});
