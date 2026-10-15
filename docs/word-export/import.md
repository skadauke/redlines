# Importing Word (.docx) into Redlines

Status: scope and plan, 2026-10-14. Nothing is implemented yet. The importer
is planned together with the [exporter](README.md).

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

Write the importer in TypeScript, in the same `packages/docx` package as the
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

So the importer reads the OOXML itself with JSZip and an XML parser:

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
| `w:author` + `people.xml` presence info           | Author, with a stable id when Word has one                                         |

Authors: Word's `w:author` is only a display name. Where `people.xml` has a
`w15:presenceInfo` (provider and user id, present for signed-in Microsoft 365
users), the importer uses it as the stable author id. Otherwise it falls back
to the name, so two different people with the same name and no account merge
into one author. The format has to allow for this (see
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

Both behaviors are standard Word practice. Word for Mac keeps both through a
tracked edit and a save, and after Accept All only the bookmark of a deleted
paragraph is gone
([Word lab](../research/word.md#export-and-round-trip-checks)). Word for the
web is still untested.

On import, every block whose bookmark survives and that has no revisions is
copied from the original Markdown byte for byte. Only blocks with revisions or
new content are regenerated from Word. If the custom part is missing (a
foreign document, or one saved by a tool that drops it), the importer converts
everything, which is case 2.

## Things Markdown can't hold

Reported in an import report rather than failing:

- Formatting with no Markdown form: fonts, sizes, colors, alignment,
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
   provider ids (Word's `presenceInfo`, Syrus users, git identities).
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

## Plan

1. Reader: unzip and parse into the block/run model with revisions and
   comments. Test against the exporter's own output and the sample in
   [`samples/`](samples/).
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
