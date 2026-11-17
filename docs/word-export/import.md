# Importing Word (.docx) into Redlines

Status: scope and plan, 2026-10-14. The reader (step 1 of the plan) is written, in
`packages/word/src/import/`, and so is the mapper to Markdown (`map.ts`, entered through
`importDocx(bytes)` in `import.ts`). The importer is planned together with the [exporter](README.md), which is written too; File › Export
to Word… calls the exporter and File › Open .docx… the importer (#881).

## What it is for

1. **Round trip.** Export a Redlines document to Word, let reviewers
   who only use Word edit and comment with Track Changes on, and bring their
   revisions and comments back into the Markdown file. This is the main case.
2. **Bringing existing Word documents in.** Convert a .docx, including any
   pending tracked changes and comment threads, into a new Redlines
   document.

Case 1 is easier, because Redlines wrote the original file and can recognize
it. Case 2 has to cope with anything Word can express.

## Approach

Write the importer in TypeScript, in the same `packages/word` package as the
exporter, so both run in the editor, the desktop app and the Syrus plugin.

No existing library gives us what we need:

- `docx` (the exporter's library) only writes files.
- mammoth.js converts .docx to HTML or Markdown but doesn't keep revisions or
  comment threads.
- docx-preview renders revisions for display but doesn't produce a model we
  could turn into Markdown.
- pandoc reads tracked changes and comments (`--track-changes=all`), but it is
  Haskell, drops reply threads and resolved state, and loses Word's revision
  ids. It stays a test oracle, as for the exporter.

So the importer reads the OOXML itself, with `fflate` for the zip and a small XML reader of its
own (`xml.ts`, which resolves namespaces, so the code never depends on a file's prefixes):

```text
.docx ──unzip──▶ document.xml, styles.xml, numbering.xml,
                 comments.xml, commentsExtended.xml, commentsIds.xml,
                 commentsExtensible.xml, people.xml, media/*
      ──parse──▶ block/run model with revision info on every run, paragraph
                 mark, row and cell
      ──map────▶ Markdown blocks + Redlines marks + comment threads
      ──write──▶ .md (plus extracted images)
```

## Mapping Word revisions to Redlines marks

| Word                                              | Redlines                                                                           |
| ------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `w:ins` / `w:del` runs                            | Insertion / deletion                                                               |
| `w:del` directly followed by `w:ins`, same author | Substitution                                                                       |
| `w:moveFrom` + `w:moveTo` linked by `w:name`      | Deletion and insertion linked as a move                                            |
| Paragraph mark `w:ins` / `w:del`                  | Inserted paragraph / merged paragraphs                                             |
| `w:trPr/w:ins`, `w:del`                           | Inserted / deleted table row                                                       |
| `w:cellIns`, `w:cellDel`                          | An inserted or deleted column when every row has one; otherwise a substitution of the whole table |
| `w:rPrChange` (bold, italic, strike, code font)   | Format change                                                                      |
| `w:pPrChange` (heading level, list type)          | Format change                                                                      |
| `w:rPrChange` / `w:pPrChange`, anything else      | Dropped, listed in the import report (font, size, color, indent: no Markdown form) |
| `w:tblPrChange` from a column added by hand       | Inferred cell insertions from the table grid if possible, else a report entry      |
| Comment + `commentsExtended` parent               | Comment thread with flat replies                                                   |
| `w15:done="1"`                                    | Resolved thread                                                                    |
| Like in `commentsExtensible.xml`                  | Like reaction                                                                      |
| `w:author` (`people.xml` presence info is read, not kept) | Author: display name and handle; no account id                              |

Authors: Word's `w:author` is only a display name, and the importer makes the
author from it: the name and a handle. Where `people.xml` has a
`w15:presenceInfo` (provider and user id, present for signed-in Microsoft 365
users), the importer does **not** write it: that is a person's account id, and a
Markdown file is committed and shared. The import report says "Word's account
ids for the people in this file were not kept." So two different people with the
same name merge into one author. The format has to allow for this (see
[below](#implications-for-the-format)).

Dates: revisions carry `w:date`, which Word for Mac writes in local time with
a misleading `Z`. The UTC time is in `w16du:dateUtc`, and comment times are
in `commentsExtensible.xml`
([Word lab](../research/word.md#identity-ids-and-time)). The importer uses
`dateUtc` when present. Otherwise it falls back to `w:date`, which can be off by the author's
UTC offset.

## Keeping the Markdown intact on a round trip

Mapping Word back to Markdown loses formatting choices (`*` vs `_`, list
markers, line wrapping, reference links). If an imported file reformatted
every paragraph, every line would show as changed in the git diff. So on
export the exporter embeds what the importer needs to restore the source:

- A **custom XML part** (`customXml/redlines-source.xml`) with the original
  Markdown and the Redlines ledger. Word keeps custom XML parts it doesn't
  understand when it saves.
- A **hidden bookmark** (`_rl_<blockId>`) around each block. Word keeps
  bookmarks whose names start with an underscore and hides them in its UI.

Two things come back from the part beyond untouched blocks. A block that holds
a picture the export could not embed was written as `[Image: alt]`; when that
text is all Word still has, the block is restored with its `![alt](path)` link.
A thread Word shows as done is resolved by the person and at the time the
ledger recorded, when the thread is the same one (author, time and text), since
Word keeps no resolver; otherwise it is resolved by its author at its time.

Both behaviors are standard Word practice. Word for Mac keeps both through a
tracked edit and a save, and after Accept All only the bookmark of a deleted
paragraph is gone
([Word lab](../research/word.md#export-and-round-trip-checks)). Word for the
web is still untested. Google Docs keeps the `_rl_` bookmarks and `commentsExtended` (paragraph ids renumbered, `done` lost) but replaces the custom part with its own, drops `commentsIds`, `commentsExtensible`, `w16du:dateUtc` and resolved threads. So a file saved by Docs has no source to restore from, and the importer converts everything (case 2). Text typed at the end of a block lands after its `bookmarkEnd`.

What the exporter writes (`packages/word/src/carriers/`):

- `customXml/redlines-source.xml`, root `rl:source` in the namespace `urn:redlines:source:1`, with
  `rl:markdown` (the file as it was, every character, with a base64 form for the few characters XML
  cannot hold), `rl:ledger` (the ledger as JSON) and `rl:blocks`: one `rl:block` for each block the
  exporter wrote (`id`, `type`, and `from` and `to`, the block's offsets in the Markdown). Its
  `itemProps` part and relationship are written too, as Word's own custom parts have them. Word may
  rename the part (`item1.xml`), so a reader finds it by its root element, which `readSource` does.
- A bookmark `_rl_b1`, `_rl_b2`, … around each block, in the order of `rl:blocks`. A table's
  bookmark starts in its first cell and ends in its last. `survivingBlocks` lists the ones a file
  still has.
- `commentsExtended.xml` (threads and `done`, for every file with comments: `docx` leaves out a
  lone resolved thread), `commentsIds.xml` and `commentsExtensible.xml`, which carry the same
  durable id (derived from the Redlines id) and, in the last, `w16cex:dateUtc`.
- `w16du:dateUtc` next to every `w:date` in the document, with `w16du` in `mc:Ignorable`.

`exportDocx(text, { carriers: false })` writes none of these.

On import, every block whose bookmark survives and that has no revisions is
copied from the original Markdown byte for byte. Only blocks with revisions or
new content are regenerated from Word. If the custom part is missing (a
foreign document, or one saved by a tool that drops it), the importer converts
everything, which is case 2.

## Things Markdown can't hold

Reported in an import report rather than failing:

- Formatting with no Markdown form: fonts, sizes, colors, alignment outside a table (a table
  column's alignment is read from its cells' justification, `right` and `center`, when every cell
  of the column agrees; where they differ it is dropped and reported),
  indentation, page and section breaks, headers and footers.
- Merged or split table cells: the table is imported as raw HTML, and changes
  inside it become a whole-table substitution.
- Text boxes, shapes, SmartArt, charts: flattened to their text, or dropped
  with an image placeholder.
- Revisions inside any of the above: imported as a substitution of the whole
  enclosing block, author and date taken from the latest revision in it.

That last rule is the general fallback: when a revision can't be expressed
precisely, substitute the smallest enclosing Markdown block. The
[format](../format.md) uses the same whole-block substitution for edits that
are too tangled to express inline.

## Implications for the format

The format has to cover these, so the importer has somewhere to put what Word
gives it:

1. **Stable author identity** separate from the display name, with optional
   provider ids (Syrus users, git identities; never Word's `presenceInfo`, which the import does not write).
2. **Moves** as a linked deletion/insertion pair.
3. **Format changes** with old and new values (bold, italic, strike, code,
   heading level, list type).
4. **Cell-level table changes**, so a column is a set of inserted or deleted
   cells.
5. **Paragraph merges and splits** as changes of their own.
6. **Likes** on comments, with author and time.
7. **Comments whose anchor text was deleted.** In Word, a deletion that covers
   the end of a comment's range also covers its reference mark, so accepting
   the deletion deletes the comment
   ([Word lab](../research/word.md#comments-on-deleted-text)). Redlines keeps
   such a comment as a [point comment](../format.md#4-comments).
8. **Whole-block substitution** as the fallback for tangled edits.

## How the mapper writes it

`mapDocx(model)` writes Markdown, marks and a ledger, and an `ImportReport`; `importDocx(bytes)`
adds the Google Docs normalizer (`normalizeGoogleBytes`) and the source part.

- Ids are new, and a handle comes from the name (`ada-lovelace`, `-2` on a clash). A person the
  source part's ledger knows keeps the handle, email and organization it had there. Word's
  `presenceInfo` is not written (no provider account ids go into the file); the report says so.
  A person's `accounts` already in the source part's ledger stay.
- A change's `note` has no place in Word's revisions. The export keeps the ledger in the source
  part (`customXml/redlines-source.xml`), and the import gives a note back to the change with the
  same author and time, the n-th to the n-th, when the file and the source hold as many changes by
  that author at that time; otherwise it reports the notes not restored. It is not written as a Word
  comment: the export writes no note as a comment, and a comment would be a second thing in the file
  that a reader could change or resolve. A file exported without the carriers reports its notes.
- Text with revisions: `w:ins` is `ins`, `w:del` is `del` with the old text as its payload, a `w:del`
  followed by a `w:ins` by the same person is `sub`. A moved pair is a deletion and an insertion
  with `move:` in the ledger. Text that one person added and another deleted is left out (the
  report says so).
- Paragraph marks follow Word's meaning: an inserted mark is a `split`, or, when the next paragraph
  is all the same person's insertion, one `ins` that holds the break and the paragraph; a deleted
  mark is a join (`del` of `\n\n` and the next block's prefix), and a paragraph deleted whole,
  mark and text, is one `del` at the end of the block before it.
- A mark that would start a block goes on a line of its own (format §3.3).
- A run's changed format is `fmt` with `+bold`, `-italic` and so on; a paragraph that changed
  between body and heading is a block `fmt was=`. Any other property change keeps the new form and
  is listed.
- A table with a changed row, cell or property is a substitution of the whole table (format
  §3.12), the old table in the payload. Merged cells are split, and the report says so.
- A comment thread is one ledger entry, anchored to its range (a range across paragraphs is one
  segment in each); a comment with no anchor is a point at the end. Resolved is kept; likes are not
  read yet.
- Restore: a paragraph whose `_rl_<id>` bookmark survived, with no revision or comment in it, and
  whose words (letters and digits) are those of the source block, is written as the source had it,
  with its list marker or quote mark. A file Google Docs saved has no source part, so it is
  converted whole, and the report says so.

## Plan

1. Reader (done): `readDocx(bytes)` unzips and parses into `DocxModel`
   (`packages/word/src/import/model.ts`): blocks (paragraphs and tables) of inlines (runs, images,
   note references, links, comment and bookmark markers). Revisions sit where Word puts them: on
   runs (`inserted`, `deleted`, `moved`, `formatChange`), on paragraph marks (`mark`,
   `propsChange`), and on rows and cells (`inserted`, `deleted`). Comments come with threads
   (`commentsExtended.xml`), the resolved state, people, durable ids and the best time
   (`dateUtc` first). Tested against the exporter's own output, the sample in
   [`samples/`](samples/) and a file Google Docs wrote. It reads an `rPrChange` or `pPrChange` as a
   change only when it changes something (Google Docs writes an empty one on every suggestion),
   and a `HYPERLINK` field as a link. It drops what it can't hold, and lists a text box, an
   equation or a shape in `report`. It doesn't yet read likes.
2. Mapping for text, headings, lists, emphasis, code, links, images and GFM
   tables, with the import report.
3. Revisions and comment threads as in the table above.
4. Round-trip preservation (custom XML part and bookmarks), written together
   with the exporter.
5. Fixtures edited in real Word: a handful of documents exported by Redlines,
   then edited by hand in Word for Mac and Word for the web (insert/delete
   text, rows and columns, moves, formatting, replies, resolve, like). These
   become the regression suite, checked against pandoc where pandoc can read
   them.

## Google Docs' own .docx

Docs' export reads as a Word file with these differences (`packages/word/src/google/`; fixture
`packages/word/fixtures/docs-suggestions-and-comment.docx`, from the study):

- Suggestions are `w:ins` and `w:del` by the person's name. Docs' `w:date` is real UTC; Word's is
  local time with a false `Z`. Docs has no `w16du:dateUtc`.
- Every inserted run carries an `rPrChange` with empty old properties. It is noise inside a `w:ins`
  and is dropped. Outside one it is a suggested formatting change, and stays.
- Every `rsid*` is zeros; runs carry `w:rtl w:val="0"`, fonts and sizes, a heading's runs repeat its
  bold, and paragraphs end in an empty run. `normalizeGoogleDocx` takes all of it out.
- Comment ids are a space of their own (an insertion and a comment may both be 0).
- Resolved comments and every reply are missing from the file. A file Docs wrote says so in its
  report, and `docsRoundTripNotes(text)` tells a person exporting to Docs how many replies and
  resolved threads will not come back.
