# Clipboard matrix

Status: November 2026. What copying out of Redlines and pasting into it should do with each app,
and how much of it has been checked. Design: [§5.10](../design.md#510-paste-copy-import-and-export).
The paste rules: [paste.md](paste.md).

Every copy in Clean and Redlines puts two flavors on the clipboard: `text/plain`, the selection's
newest text as Markdown, and `text/html`, the same text as HTML with the theme's font and its
metric-compatible twin inline (for example `Calibri, Carlito, sans-serif`). Raw copies the source
as written, as plain text alone. A paste that has HTML turns it into Markdown unless the plain
text says as much; ⇧⌘V, Edit › Paste as Plain Text, never reads HTML.

"Covered" means a Vitest test with a fixture written to look like the app's clipboard HTML. The
fixtures are reproductions, not captures from the apps. "By hand: not checked yet" means nobody
has pressed the keys in the app yet.

| App                     | Copy out of Clean                                                                                                                    | Copy out of Redlines                                                                   | Paste into Redlines                                                                                                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Google Docs (Chrome)    | Headings, lists, bold, links and tables arrive formatted, in Calibri, Georgia or Courier New. By hand: not checked yet                | Same as Clean, with deleted text and markers absent. By hand: not checked yet          | Docs' wrapper, CSS bold and italic, nested lists, links (its redirect unwrapped) and tables become Markdown. Covered by "pastes Google Docs bold, italic, a heading, a nested list, a link and a table as Markdown" and "does not make the Google Docs wrapper bold". By hand: not checked yet |
| Google Docs (Safari)    | As Chrome. WebKit may rewrite the HTML it hands to the page. By hand: not checked yet                                                | As Chrome. By hand: not checked yet                                                    | As Chrome; WebKit re-serializes the HTML, which the converter reads whole. By hand: not checked yet                                                                                           |
| Mail                    | Rich text in the message body. By hand: not checked yet                                                                              | As Clean. By hand: not checked yet                                                     | Mail's HTML (styled `div`s and `span`s) goes through the same converter. Covered in part by the CSS-bold and nesting tests. By hand: not checked yet                                          |
| Pages                   | Rich text with the fonts named. By hand: not checked yet                                                                             | As Clean. By hand: not checked yet                                                     | Pages' HTML is CSS-styled spans; same rules. By hand: not checked yet                                                                                                                         |
| Word (Mac)              | Rich text, tables with a header. By hand: not checked yet                                                                            | As Clean. By hand: not checked yet                                                     | Word's `mso-list` paragraphs are not turned into lists (the converter keeps them as paragraphs); bold and italic work. By hand: not checked yet. Copy for Word (native HTML) is a separate task |
| Slack                   | Slack reads `text/plain` or its own flavor; the plain text is Markdown. By hand: not checked yet                                     | As Clean. By hand: not checked yet                                                     | Slack's HTML is simple markup. By hand: not checked yet                                                                                                                                       |
| A web page (any)        | HTML as above                                                                                                                        | As Clean                                                                               | Headings, links, lists, code, quotes, images and tables. Covered by "pastes a web page table without a header with its first row as the header" and the converter's other tests                |
| A plain text field      | The Markdown, as before. Covered by "copy the newest text of the selection in Redlines" and "copies the newest text: no markers, no deleted text, no ledger, in both text/plain and text/html" | Same. Covered by the same tests                                                        | n/a. Paste out of a text field is plain text, unchanged. Covered by "pastes markup as its newest text with Track Changes off"                                                                  |
| Redlines (Raw)          | Source as written, plain text only. Covered by "puts only the source on the clipboard in Raw"                                        | n/a                                                                                    | Text as it is, HTML ignored. Covered by "keeps the plain text when the html says nothing more, and in Raw"                                                                                    |
| Redlines to Redlines    | Round trip. Covered by "round-trips: copying a document and pasting it back gives the same Markdown"                                  | Same                                                                                   | Covered by the same test and "round-trips with the normalizations: other markers become the canonical ones"                                                                                   |

Cross-cutting rows, each covered by a test:

| Case                                                    | Expected                                                                                          | Test                                                                                                    |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Raw HTML in the source                                  | Escaped as text in the HTML, never live                                                           | "escapes raw HTML in the source instead of copying it live"                                             |
| Fonts                                                   | Calibri, Carlito, sans-serif; Georgia, Gelasio, serif; "Courier New", Cousine, monospace          | "copies a heading, a list, bold, a link and a table as HTML with the twins in font-family"              |
| Pasted comments, visible markers and a forged ledger    | Never marks: comments dropped, visible `<!--` written as `&lt;!--`                                | "never turns pasted comments or visible markers into Redlines markup" and "never lets pasted html carry Redlines markup into the file" |
| Track Changes on                                        | The paste is the paster's one insertion                                                           | "pastes as the paster’s own insertion with Track Changes on"                                            |
| Paste as Plain Text (⇧⌘V)                               | The text as written, no HTML read                                                                 | "pastes plain text with ⇧⌘V even when HTML is on the clipboard"                                         |
| In a code block                                         | Text as it is                                                                                     | "pastes text as it is into a code block"                                                                |
| Selection cuts through a list or table                  | Well-formed HTML of what is selected                                                              | "copies a selection that cuts through a block as well-formed HTML"                                      |

## What the round trip changes

Copying a document and pasting its HTML back gives the same Markdown for the constructs the tests
use. These normalizations are allowed, and the second test shows them:

- Setext headings become ATX (`#`), `*` and `+` bullets become `-`, and `__strong__` and
  `_emphasis_` become `**` and `*`.
- Pipe tables are rewritten with single spaces and `---` delimiters. Left alignment is not kept
  (a browser writes `text-align: left` on every cell, so it carries no meaning); right and center
  are.
- Loose lists (a blank line between items) become tight.
- Raw HTML in the source comes back as escaped text, and HTML comments in it are dropped.
- Hard breaks written as two trailing spaces come back as a backslash.
- A code block's info string survives only as its first word.
- When the plain text of a paste says as much as the HTML, the plain text goes in as it is, so a
  copy from Redlines pasted into Redlines is not rewritten at all.
