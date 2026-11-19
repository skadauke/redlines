# Exporting Redlines to Word (.docx)

Status: research and recommendation, 2026-10-13, and the exporter as built. `packages/word`
(`@redlines/word`) writes a Word file with `exportDocx` (the core, #834; tables, format changes,
splits, joins, moves, images and task lists, #847; the round-trip carriers, #845), reads one back
(`importDocx`, see [the importer plan](import.md)) and normalizes Google Docs' export (#838).
File › Export to Word… and `redlines export-docx` call the writer (#841), and File › Open .docx…
(`redlines import-docx`) the importer (#881, with pictures, #885); Word and Google Docs also reach
the editor through paste (#842). Copying out is built too: the clipboard's HTML is
written for Word and Google Docs (#874), with local pictures embedded as bytes (#882); it has been
checked by pasting into Google Docs, and Word itself not yet.

See also [How Word displays Track Changes in tricky cases](word-display.md),
the [Word importer plan](import.md) and the [Word lab](../research/word.md).

## Recommendation

Build the exporter in TypeScript on [`docx`](https://github.com/dolanmiu/docx)
(MIT, `npm i docx`, version 9.8 or later), as a new workspace package
`packages/word` (`@redlines/word`). It walks the parsed Markdown tree plus the marks from
`@redlines/format` and emits `docx` objects directly. Do not use
python-docx. Use pandoc as a test oracle, not as the exporter.

`docx` is the only TypeScript library found that writes every piece Word's
Track Changes needs, including threaded and resolved comments. None of the
existing Markdown-to-Word converters built on top of it expose those features,
so we write our own Markdown walker rather than extend one.

## What was checked

### `docx` (dolanmiu/docx) — writes everything we need

Verified with `docx@9.11.0` by generating a document and unzipping it (script
below):

| Redlines concept             | `docx` API                                                                                    | OOXML written                             |
| ---------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Insertion (inline)           | `new InsertedTextRun({id, author, date, text, …})`                                            | `<w:ins><w:r><w:t>`                       |
| Deletion (inline)            | `new DeletedTextRun({…})`                                                                     | `<w:del><w:r><w:delText>`                 |
| Substitution                 | adjacent `DeletedTextRun` + `InsertedTextRun`                                                 | `<w:del>` then `<w:ins>`                  |
| Inserted / deleted paragraph | `new Paragraph({run: {insertion \| deletion: {…}}})`                                          | `<w:pPr><w:rPr><w:ins/>` (paragraph mark) |
| Inserted / deleted table row | `InsertedTableRow`, `DeletedTableRow`                                                         | `<w:trPr><w:ins/>`                        |
| Comment                      | `comments: {children: [{id, author, date, …}]}` + `CommentRangeStart/End`, `CommentReference` | `comments.xml`                            |
| Comment reply (conversation) | `parentId` on the reply                                                                       | `commentsExtended.xml` `w15:paraIdParent` |
| Resolved thread              | `resolved: true`                                                                              | `w15:done="1"`                            |
| Stable comment id            | `durableId`                                                                                   | `commentsIds.xml`                         |
| Format change                | `revision` on run/paragraph properties                                                        | `<w:rPrChange>`, `<w:pPrChange>`          |
| Open with Track Changes on   | `features: {trackRevisions: true}`                                                            | `settings.xml` `<w:trackRevisions/>`      |

Reply threading (`parentId`, `resolved`) arrived in the 9.7–9.8 releases
(May–September 2026), so the dependency must be `^9.8`.

The generated file was checked two ways:

- pandoc (`pandoc --track-changes=all out.docx -t markdown`) reads back
  every insertion, deletion, paragraph insertion/deletion and comment, with
  authors and dates.
- LibreOffice renders the revisions per author with change bars:

  ![LibreOffice rendering of the generated .docx](libreoffice-render.png)

This file was not opened in Microsoft Word, but the
[sample document](word-display.md), also written with `docx`, was. Word for
Mac shows its replies as a flat thread and hides its resolved thread from the
comments pane, leaving a check-mark icon in the margin. The
[Word lab](../research/word.md#comment-threads) adds two requirements: each
reply needs its own comment range and reference mark, or Word drops it on
save, and the exporter should write `compatibilityMode` 15, because files
written by `docx` open in compatibility mode.

### Markdown-to-Word converters in TypeScript — none support Track Changes

All of these sit on top of `docx`, and none emit `w:ins`, `w:del` or Word
comments (checked by searching their published code):

| Package                                                                   | License    | Notes                                                                           |
| ------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------- |
| [`remark-docx`](https://github.com/inokawa/remark-docx)                   | MIT        | unified/mdast plugin; pins `docx@9.7.1`; best reference for mapping mdast nodes |
| [`@mohtasham/md-to-docx`](https://github.com/MohtashamMurshid/md-to-docx) | MIT        | plugin API; its "comment" renderer only styles a paragraph                      |
| [`markdown-docx`](https://github.com/vace/markdown-docx)                  | MIT        | built on `marked`                                                               |
| [`mdast2docx` / `@m2d/core`](https://github.com/md2docx/mdast2docx)       | MPL-2.0    | plugin-based; copyleft per file                                                 |
| [`@adobe/helix-md2docx`](https://github.com/adobe/helix-md2docx)          | Apache-2.0 | tied to Adobe's Helix document model                                            |

Extending one of them would not help. Marks cut across Markdown structure (a
deletion that spans bold text and a link, a comment anchored across two
paragraphs, a whole inserted list item), so the exporter has to control how
runs are split and where paragraph marks are tracked. That is the core of the
exporter, and none of these packages offers a hook at that level. We can still
borrow `remark-docx`'s node-to-style mapping (headings, lists, tables, code,
images) as a reference.

### pandoc — works, but not TypeScript and no threads

pandoc's docx writer turns `[text]{.insertion author=… date=…}`,
`{.deletion}` and `{.comment-start}/{.comment-end}` spans into real tracked
changes and comments (verified with pandoc 3.1.3). It is a Haskell binary (a
~50 MB WebAssembly build exists as `pandoc-wasm`), it has no notion of reply
threads or resolved comments, and it only keeps comments that have a range.
That rules it out as the exporter, but it is a good **test oracle**: CI can
export a fixture, read it back with `pandoc --track-changes=all`, and compare.

The [pandoc filter](../format.md#11-the-pandoc-filter) for R Markdown and
Quarto uses the same writer, with the same limits. It serves the render
pipeline; full-fidelity Word files come from `packages/word`.

### python-docx — no Track Changes

python-docx v1.2.0 (and the `skadauke/python-docx` fork, which has no commits
beyond it) supports adding comments (`Document.add_comment`,
`Run.mark_comment_range`) but has no API for replies, resolved state or
tracked insertions/deletions; those would have to be written as raw XML
through lxml. Using it would also put a Python service next to an otherwise
all-TypeScript stack, and the exporter could not run inside the editor or the
desktop app. Not recommended unless we later need to edit existing Word files
server-side in Python.

## Mapping rules for the exporter

These follow from how Word models revisions, not from the details of the
Redlines syntax:

1. **Run splitting.** Split text at every mark boundary and every inline
   formatting boundary, then wrap each run in insertion or deletion as needed.
   Formatting inside a tracked run (bold, italic, code) goes on that run.
2. **Paragraph marks.** An inserted paragraph tracks its paragraph mark as
   inserted. A deletion spanning paragraphs marks every paragraph mark except
   the last one as deleted, which is how Word merges paragraphs on accept.
   Inserted or deleted list items and table rows follow the same rule
   (`InsertedTableRow` / `DeletedTableRow` for rows).
3. **Substitutions** become a deletion immediately followed by an insertion,
   with the same author and date.
4. **Comment threads.** The first comment gets the range; each reply gets
   `parentId` of the first comment and the same range, which is what Word
   writes ([Word lab](../research/word.md#comment-threads)) and what pandoc
   needs to read replies back. A resolved thread sets `resolved` on the first
   comment.
5. **Ids.** Word revision and comment ids are integers unique per document.
   Keep a map from Redlines ids to Word ids, and derive `durableId` from the
   Redlines id so a later Word-to-Redlines import can match threads back up.
6. **Authors and dates.** Use the author's display name (falling back to the
   handle), with the `org` appended when two people share a name
   ([format.md](../format.md#10-word)). Initials come from the name. Use the
   mark's UTC time: the ledger's times have minute precision (`2026-10-13T22:30Z`),
   but `w:date` is an `xsd:dateTime`, which needs seconds, so write
   `2026-10-13T22:30:00Z`.
7. **Open with Track Changes on** (`trackRevisions: true`) so edits made in
   Word come back as revisions too.

### What the exporter writes beyond the core

`packages/word` writes these as well. What has no Word form is said in the second column, and the
export's `report` (an option, a list of `{kind, message}`) names the ones that need a person.

| Redlines                              | Word                                                                 | What does not map                                                                 |
| ------------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Inserted row (`ins … row`)            | `w:ins` in the row's properties, its text as inserted runs           |                                                                                   |
| Deleted row (`del … row=N`)           | A row of deleted text at its place, `w:del` in its properties        |                                                                                   |
| Cell edit                             | `w:ins` and `w:del` runs in the cell                                 |                                                                                   |
| Inserted column (`ins … col`)         | The new cells' text as inserted runs                                 | Word can't track a new column: rejecting the text leaves an empty column. Reported |
| Deleted column (`del … col=N`)        | A cell of deleted text in each row, and a comment on the header's    | Word tracks no deleted column: the column stays after accepting. Reported         |
| Column alignment, alignment change    | `w:jc` on each cell's paragraph; `w:pPrChange` with the old `w:jc`   |                                                                                   |
| Inline format change (`fmt +bold`…)   | `w:rPrChange` with the old properties: bold, italic, strike, code (font), sub, sup | Link changes (`+link`, `link=`) and `+html`, `@attr` have no run property; the text is exported as it now is |
| Block format change (`fmt was=…`)     | `w:pPrChange` with the old style, list or indent                     | Callout types (`was=callout-…`) and the number a list item had                    |
| Split (`<!--split-->`)                | The paragraph mark before it is inserted                             |                                                                                   |
| Join (a deletion of `\n\n` and prefix) | The paragraph mark is deleted, so that accepting joins the two      |                                                                                   |
| Move (a deletion and an insertion of the same text in one `group`, or named by `move`) | `w:moveFrom` and `w:moveTo` with one range name | A move that was widened into one substitution is exported as a substitution; a move whose two texts differ is a deletion and an insertion |
| Image                                 | An inline picture (PNG, JPEG, GIF, BMP) of its own size, at most 6.5 inches wide, with alt text and title; an inserted image is a tracked insertion | Pictures whose bytes are not given (a `data:` address carries them; others through the `images` option), SVG and WebP: the description stands in, `[Image: alt]`. Reported |
| Line break inside an insertion, or in a substitution's new text | A new tracked paragraph (a list item with its marker, a nested item at its indent) for each line | Two characters backslash and `n` are text and stay text in `w:t`; a test holds both (#1178) |
| Comment on deleted text (`about` a deletion) | A comment range around the deleted runs                       | Word drops such a comment when the deletion is accepted                           |
| Opening without a question to save | The settings, font table and properties that Word writes itself (all the compatibility settings of Word 2013, the color scheme mapping, language and separators, the fonts, the application properties), and dates to the second | Not checked in Word by the author of the change (#1180) |
| Task item                             | A box, `☐` or `☒`, and no bullet; a checked or unchecked box is the old box deleted and the new inserted | Word has no tracked checkbox: a task is only text                       |

## Proof of concept

The script used for the checks above (`npm i docx@^9.8`, then `node gen.mjs`):

```js
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
} from 'docx';

const A = 'Alice',
  B = 'Bob',
  d = '2026-10-13T12:00:00Z';
const doc = new Document({
  features: { trackRevisions: true },
  comments: {
    children: [
      {
        id: 0,
        author: A,
        initials: 'A',
        date: new Date(d),
        children: [new Paragraph('Is this the right latency budget?')],
      },
      {
        id: 1,
        author: B,
        initials: 'B',
        date: new Date(d),
        parentId: 0,
        children: [new Paragraph('Yes, agreed with infra.')],
      },
      {
        id: 2,
        author: B,
        initials: 'B',
        date: new Date(d),
        resolved: true,
        children: [new Paragraph('Resolved nit.')],
      },
    ],
  },
  sections: [
    {
      children: [
        new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('Design doc')] }),
        new Paragraph({
          children: [
            new TextRun('The service '),
            new DeletedTextRun({ id: 10, author: A, date: d, text: 'should' }),
            new InsertedTextRun({ id: 11, author: A, date: d, text: 'must' }),
            new TextRun(' respond within '),
            new CommentRangeStart(0),
            new CommentRangeStart(1),
            new TextRun({ text: '200 ms', bold: true }),
            new CommentRangeEnd(0),
            new CommentRangeEnd(1),
            new TextRun({ children: [new CommentReference(0)] }),
            new TextRun({ children: [new CommentReference(1)] }),
            new TextRun('.'),
            new InsertedTextRun({
              id: 12,
              author: B,
              date: d,
              text: ' Retries are capped at three.',
            }),
          ],
        }),
        new Paragraph({
          run: { insertion: { id: 13, author: B, date: d } },
          children: [
            new InsertedTextRun({ id: 14, author: B, date: d, text: 'A whole new paragraph.' }),
          ],
        }),
        new Paragraph({
          run: { deletion: { id: 15, author: A, date: d } },
          children: [
            new DeletedTextRun({ id: 16, author: A, date: d, text: 'A deleted paragraph.' }),
          ],
        }),
        new Paragraph({
          children: [
            new CommentRangeStart(2),
            new TextRun('End.'),
            new CommentRangeEnd(2),
            new TextRun({ children: [new CommentReference(2)] }),
          ],
        }),
      ],
    },
  ],
});
fs.writeFileSync('out.docx', await Packer.toBuffer(doc));
```

## Importing Word back

The importer has its own [plan](import.md), and it shapes the choices above.
mammoth.js and docx-preview ignore or only display revisions, so the importer
reads the OOXML itself (JSZip plus an XML parser): `w:ins`, `w:del`,
paragraph-mark revisions, `comments.xml`, `commentsExtended.xml` for threads
and `commentsIds.xml` for the durable ids written on export.

## In the app and on the command line

- **File › Export to Word…** writes the open document, marks and all, to a `.docx` through a save panel
  that starts at the document's name with `.docx`. The host writes the bytes (the window may use the
  file plugin's text command, which writes the bytes it is given, on the file the save panel gave it; no broader write permission). What Word can't hold comes as a
  notification that stays until it is read; a plain success passes by. Never a dialog.
- **`redlines export-docx <file.md> [-o out.docx]`** is the same, beside the file by default, and never over a `.docx` that is there: only an explicit
  `-o` replaces one. It is
  in the Node command line (`pnpm redlines`); the program in the app, which runs the logic in QuickJS
  without Node, doesn't carry the writer, and says so.
- **File › Open .docx…** opens a Word or Google Docs file as a new, unsaved document (here while the
  window is untouched, else in a new window). The import report is a notification, never a dialog.
  A file with pictures can't be unsaved (they are files beside the document, in the project's folder
  for images), so, as adding an image to an unsaved document does, the save panel comes first: the
  Markdown is saved where the person says, the pictures go into the images folder, each link points at
  its file, and the saved document opens. When the panel is cancelled the document opens unsaved
  without its pictures, and the card says so. Pictures that can't be carried (EMF, WMF) are counted
  in the report. In the development page it is a file picker.
- **`redlines import-docx <file.docx> [-o out.md]`** writes the Markdown beside the file, and never over
  a file that is there. The pictures go beside the Markdown
  as `media/image1.png`, where its links name them, and never over a file that is there.
