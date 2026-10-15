# Pasting web pages and documents

Status: research notes, October 2026. The rules Redlines uses to turn pasted HTML into Markdown,
and how a prototype built to them scored on 54 clipboard captures.

Pasting a web page or a document should give clean Markdown, tables included. No existing
HTML-to-Markdown converter does that well enough as it is, and one requirement is specific to
Redlines: pasted content must never turn into Redlines markup.

## Summary

- On 54 clipboard captures, the best existing converters reach a weighted similarity of 0.77–0.81
  to the expected Markdown and pass 9–17 of 39 targeted checks. A prototype built to the rules
  below passes all 39. On 8 held-out captures written before the prototype existed, it produced 6
  identical outputs on its first run; the other two scored 0.98.
- 7 of 12 converters write visible text such as `<!--ins k3x9-->` back out unescaped, so text on a
  web page would become a comment in the file, or a forged Redlines marker. The best base, unified,
  copies every HTML comment from the clipboard into the Markdown, including forged markers and a
  forged ledger.
- The recommended base is unified (`hast-util-to-mdast` plus `mdast-util-to-markdown`, MIT,
  TypeScript, runs in a worker), with Redlines' own normalization rules in front and
  escape-minimizing behind. The rules matter far more than the converter underneath: the same base
  without them passes 13 of 39 checks.

## How it was tested

- The corpus has 54 fixtures:
  - 41 real Chromium copies: 13 from live Wikipedia, MDN and Python documentation pages, and the
    rest from pages modeled on GitHub, Stack Overflow, code highlighters, KaTeX, MathJax and blogs;
  - 3 Firefox and WebKit copies, one WebKit paste event, and one Windows CF_HTML body;
  - 8 reproductions: Google Docs, Google Sheets, Word for Windows and for Mac, Excel, Notion, and
    forged comments.
- The copies were captured in a Linux container with its own display.
- 12 converters were compared: turndown and a fork of it, unified, node-html-markdown, pandoc,
  mdream, markdownify, a Go and a Rust converter, and the converters of two open-source editors and
  a web clipper.
- Scoring:
  - similarity of the rendered structure to the expected Markdown;
  - 39 pass/fail checks for specific failures;
  - unnecessary escapes;
  - the held-out set.

  The expected files encode this spec, so the held-out set is the independent check.

The code and data are in the project's lab, outside this repository.

## What lands on the clipboard

| Source                      | What the HTML looks like                                                                                                                                                                         |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Chrome and Safari           | Computed inline styles on every element; bold set by CSS arrives as `font-weight` on a span. Chrome also writes the source URL (`org.chromium.source-url` on the Mac)                            |
| Firefox                     | Clean markup without styles; only the page's origin, not its URL                                                                                                                                 |
| Every browser, at copy time | Comments, scripts, styles and hidden content are dropped. Chromium also drops `user-select: none` text (Python's `>>>` prompts, and MathJax 3's text, which leaves those formulas unrecoverable) |
| Google Docs                 | A wrapping `<b id="docs-internal-guid-…">`; formatting as CSS; invalid nested lists                                                                                                              |
| Word                        | Lists as paragraphs with `mso-list` styles; images as temporary `file:` URLs, with the bytes only in RTF                                                                                         |
| Excel                       | The fragment markers sit _inside_ the `<table>`, so cutting between them loses the table                                                                                                         |

What the editor receives, measured in WebKit, Chromium and Firefox webviews:

- Only `text/plain` and `text/html`, with no source URL.
- WebKit re-serializes the HTML on every paste from another origin. This is what Tauri gets on
  macOS and Linux.
- Paste as plain text (⇧⌘V) fires no event in WebKit, so the app needs its own menu command.
- The paste event is the one to use, not the async Clipboard API. The async API sanitizes the HTML,
  and Safari shows a confirmation callout before reading.
- On the desktop, Tauri can read the raw clipboard natively (`public.html`, the source URL)
  through `clipboard-rs`, which recovers what WebKit hides.

## The spec

### Choosing what to paste

1. Redlines' own copy (`application/x-redlines+json`) is used first. It keeps marks and threads.
2. In source mode, a code block or inline code, plain text only.
3. Otherwise HTML, unless it adds nothing over the plain text, or is a single link to its own URL.
   A copy from an IDE becomes a fenced code block in that language.
4. Plain text is inserted as Markdown source, so Markdown copied as plain text keeps its
   formatting. ⇧⌘V always does this.
5. Image files alone are inserted as images.

### Cleaning the HTML

In order:

- Reading and cleanup:
  - parse the whole document, never slices of the string;
  - detect the source (Word, Excel, Google Docs, GitHub, Wikipedia and so on);
  - drop every HTML comment;
  - drop hidden content and controls.
- Office: Word's styled paragraphs become real nested lists, and Office class styles become inline
  formatting.
- Math is recovered as TeX from MediaWiki, KaTeX, MathML and MathJax 2. MathJax 3 can't be
  recovered; a notice says so.
- Formatting:
  - CSS turns into Markdown: weight 600 or more is bold, italic is emphasis, line-through is `~~`,
    superscript and subscript are HTML;
  - a monospace font becomes code.
- Headings and lists:
  - headings lose permalink anchors, `¶` and `[edit]` links;
  - lists are repaired, with task items from checkboxes.
- Footnotes: pasted footnotes become `[^n]` with their definitions at the end. A reference whose
  target wasn't pasted stays a link.
- Callouts: GitHub alerts, Sphinx admonitions and MDN notes become `> [!NOTE]` and its kin.
- `<details>` stays HTML, with Markdown inside.
- Text:
  - soft hyphens, zero-width spaces and control characters are removed;
  - non-breaking spaces become spaces outside code.
- Output: one consistent style (ATX headings, `-` bullets, `*` emphasis, fenced code), escaped
  conservatively and then minimized. The output never contains `<!--` outside code.

### Tables

- Tables of code lines become a code block, and layout tables are unwrapped.
- Tables a pipe table can't hold stay as clean HTML: nested tables, multi-line code, headings,
  quotes or lists in cells. Flattening them into a pipe table would run the text of their blocks
  together.
- Merged cells are expanded into a rectangle, with the content in the top-left cell.
- Captions and title rows become a paragraph before the table.
- The header row comes from `<thead>`, then from rows of `<th>`, then from a bold first row.
  Otherwise the first row becomes the header row, because GFM tables require one, and an empty
  header row would show as a blank bar on GitHub.
- Cell content:
  - blocks are joined with `<br>`;
  - lists become `•` lines;
  - `|` is always escaped.
- Column alignment follows the majority of the column's cells.

### Links, code and images

- Links:
  - relative links are resolved against the source URL when one is known;
  - `javascript:` and `data:` links become plain text;
  - a link whose text is its own URL becomes `<url>`.
- Code languages are recognized from about a dozen class patterns (GitHub, Sphinx, MDN, MediaWiki,
  highlight.js and others) and normalized (`python3` → `python`).
- Images:
  - web images keep their URLs, or are copied into `./assets` (open decision 4);
  - `data:` images are saved on first save;
  - lazy-loaded placeholders are replaced with the real source;
  - undoing the paste deletes the files it created.

### Where the caret is

| Caret position       | What happens to the paste                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| In a code block      | Verbatim text; the fence is lengthened if the paste contains one                                                          |
| In a table cell      | Flattened to one line with `<br>`. A pasted table fills cells from the caret and grows the table ([tables.md](tables.md)) |
| In a list or quote   | Lines get the list indent or the `>` prefix                                                                               |
| In a heading or link | The first paragraph joins the line                                                                                        |

### Tracked changes and marks

- One paste is one tracked insertion, with one id across blocks, or a substitution when it
  replaces a selection.
- A paste can never forge a mark: comments are dropped, and `<!--` can't appear outside code.
- Copying inside Redlines writes a private flavor with the marks and their ledger entries.
  - With tracking off, a paste keeps them and renames clashing ids.
  - With tracking on, marks resolve to their newest text, comments are dropped with a notice, and
    the paste becomes one insertion (open decision 3).
- Plain text copied from a Redlines file resolves its markers to the newest text.
- Undo removes the whole paste in one step.
- A notice lists what was lost: formulas, unreadable images, tables kept as HTML, unresolved links.

## Open decisions

1. A table with no header row: promote the first row (the rule above), or add an empty header row.
2. Tables a pipe table can't hold: keep clean HTML (the default), or flatten them.
3. Pasting tracked text with tracking on: resolve it to the newest text as one insertion (the
   default).
4. Pasted web images: keep the URLs (the default), or download them.

## Still to do

- Real copies on macOS and Windows. The corpus came from Linux builds of the browsers; macOS and
  Windows behavior comes from the engines' source code.
