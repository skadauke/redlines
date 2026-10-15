/* global URL, process */
import fs from 'node:fs';
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  InsertedTextRun,
  DeletedTextRun,
  CommentRangeStart,
  CommentRangeEnd,
  CommentReference,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
  ImageRun,
} from 'docx';
const A = 'Alice',
  B = 'Bob',
  C = 'Carol';
const d = '2026-10-13T12:00:00Z',
  dt = new Date(d);
let id = 100;
const ch = (author) => ({ id: id++, author, date: d });
const H = (t) => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(t)] });
const P = (...c) =>
  new Paragraph({ children: c.map((x) => (typeof x === 'string' ? new TextRun(x) : x)) });
const ref = (n) => new TextRun({ children: [new CommentReference(n)] });
const cell = (...c) =>
  new TableCell({ width: { size: 2400, type: WidthType.DXA }, children: [P(...c)] });
const img = fs.readFileSync(new URL('img.png', import.meta.url));
const image = () =>
  new ImageRun({ type: 'png', data: img, transformation: { width: 160, height: 80 } });
const cm = (cid, author, text, extra = {}) => ({
  id: cid,
  author,
  initials: author[0],
  date: dt,
  children: [new Paragraph(text)],
  ...extra,
});

const doc = new Document({
  features: { trackRevisions: true },
  comments: {
    children: [
      cm(0, A, 'Should we commit to 99.9%?'),
      cm(1, B, "I'd rather say 99.5% for v1.", { parentId: 0 }),
      cm(2, C, 'Agreed, 99.5%.', { parentId: 0 }),
      cm(3, B, 'Typo fixed.', { resolved: true }),
      cm(4, C, 'Why was this added?'),
      cm(5, A, 'Cell-level comment inside a table.'),
    ],
  },
  sections: [
    {
      children: [
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          children: [new TextRun('Word track-changes samples')],
        }),

        H('1. Table: text replaced in a cell, row inserted, row deleted'),
        new Table({
          rows: [
            new TableRow({ children: [cell('Metric'), cell('Target')] }),
            new TableRow({
              children: [
                cell('Latency'),
                cell(
                  new DeletedTextRun({ ...ch(A), text: '300 ms' }),
                  new InsertedTextRun({ ...ch(A), text: '200 ms' }),
                ),
              ],
            }),
            new TableRow({
              insertion: ch(B),
              children: [
                cell(new InsertedTextRun({ ...ch(B), text: 'Error rate' })),
                cell(new InsertedTextRun({ ...ch(B), text: '< 0.1%' })),
              ],
            }),
            new TableRow({
              deletion: ch(C),
              children: [
                cell(new DeletedTextRun({ ...ch(C), text: 'Throughput' })),
                cell(new DeletedTextRun({ ...ch(C), text: '1k rps' })),
              ],
            }),
            new TableRow({
              children: [
                cell(
                  new CommentRangeStart(5),
                  new TextRun('Uptime'),
                  new CommentRangeEnd(5),
                  ref(5),
                ),
                cell('99.9%'),
              ],
            }),
          ],
        }),

        H('2. Table: column inserted (cell insertions)'),
        new Table({
          rows: [
            new TableRow({ children: [cell('Metric'), cell('Target'), cell('CELLINS Owner')] }),
            new TableRow({ children: [cell('Latency'), cell('200 ms'), cell('CELLINS Infra')] }),
          ],
        }),

        H('3. Image inserted and image deleted'),
        P('IMGINS ', image()),
        P('IMGDEL ', image()),

        H('4. Moved paragraph'),
        P('MOVETO This sentence was moved up.'),
        P('First paragraph that stays.'),
        P('MOVEFROM This sentence was moved up.'),

        H('5. Formatting changes'),
        P(
          'Plain text, then ',
          new TextRun({ text: 'newly bold', bold: true, revision: { ...ch(B), bold: false } }),
          ' text.',
        ),
        new Paragraph({
          heading: HeadingLevel.HEADING_3,
          revision: { ...ch(A) },
          children: [new TextRun('This paragraph was promoted to a heading')],
        }),

        H('6. Comments: thread with replies, resolved thread, comment on an insertion'),
        P(
          'Availability target is ',
          new CommentRangeStart(0),
          new CommentRangeStart(1),
          new CommentRangeStart(2),
          new TextRun('99.9%'),
          new CommentRangeEnd(0),
          new CommentRangeEnd(1),
          new CommentRangeEnd(2),
          ref(0),
          ref(1),
          ref(2),
          '.',
        ),
        P(
          'The ',
          new CommentRangeStart(3),
          new TextRun('recieve'),
          new CommentRangeEnd(3),
          ref(3),
          ' path is idempotent.',
        ),
        P(
          'Retries ',
          new CommentRangeStart(4),
          new InsertedTextRun({ ...ch(B), text: 'with exponential backoff' }),
          new CommentRangeEnd(4),
          ref(4),
          ' are capped at three.',
        ),

        H('7. Paragraphs inserted, deleted and merged'),
        new Paragraph({
          run: { insertion: ch(B) },
          children: [new InsertedTextRun({ ...ch(B), text: 'An inserted paragraph.' })],
        }),
        new Paragraph({
          run: { deletion: ch(C) },
          children: [new DeletedTextRun({ ...ch(C), text: 'A deleted paragraph.' })],
        }),
        new Paragraph({
          run: { deletion: ch(A) },
          children: [new TextRun('These two paragraphs are merged')],
        }),
        P('into one when the deleted paragraph mark is accepted.'),
      ],
    },
  ],
});
fs.writeFileSync(process.argv[2] ?? 'samples-raw.docx', await Packer.toBuffer(doc));
