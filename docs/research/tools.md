# Redlines files in other tools

Status: research notes, October 2026.

This study checks what happens to a Redlines file in the renderers, formatters and build tools
people already run on Markdown. The test files followed an earlier draft of the format.

## Tools tested

- **Renderers:**
  - GitHub's live pipeline (40 calls, synthetic text only)
  - cmark-gfm
  - markdown-it, configured like VS Code
  - micromark and remark
  - pandoc's markdown reader (R Markdown, Quarto) and its gfm reader
  - kramdown (Jekyll and GitHub Pages)
  - goldmark (Hugo)
  - MDX and Docusaurus
- **Formatters:** Prettier (default and `proseWrap: always`), markdownlint-cli2 `--fix`,
  remark-stringify, mdformat, pandoc `md→md`.
- **Other:** knitr and R Markdown, the prototype pandoc filter
  ([`redlines.lua`](../pandoc-filter/redlines.lua)), Liquid, and three YAML parsers.
- **Obsidian:** from its documentation and forum, not automated.

The code and data are in the project's lab, outside this repository.

## What holds

On files that follow that draft, these show exactly the newest version with nothing visible:

- GitHub, in `.md` files and in comments. GitHub also strips the comments from its HTML output.
- VS Code's preview.
- cmark-gfm, micromark and remark.
- pandoc's markdown reader, and so R Markdown and Quarto.
- goldmark (Hugo).
- Docusaurus 3 with its default settings.

This held for every construct: insertions, deletions, substitutions, format changes, highlights,
comments, split/join, whole-block changes, marks in headings, lists, quotes, table cells and
`<details>`, ordinary comments, and the ledger. Heading anchors come from the newest text.
`markdownlint-cli2 --fix` never touches a marker, and every formatter kept the ledger byte for
byte.

## What breaks

Problems found with files written to the earlier draft, and their fixes:

| #   | Problem                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Class                                | Fix                                                                                       |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------- |
| 1   | **Deleted inline R code makes the knit fail.** The earlier draft's escape `` `r x\` `` still matches knitr's inline-code pattern, so `rmarkdown::render` fails for HTML, Word and `github_document`                                                                                                                                                                                                                                                                                                              | Render fails                         | No backtick characters in payloads: write `\x60`                                          |
| 2   | **R code in review comments runs at every knit.** The ledger isn't escaped at all; a comment containing `` `r file.create('x')` `` executes, and the knitted ledger is rewritten                                                                                                                                                                                                                                                                                                                                 | Security; render changes             | Escape the ledger the same way                                                            |
| 3   | **A payload ending in `-` shows as text** on GitHub and in VS Code (deleting the hyphen of "e-mail"). mdformat then escapes it, so it's visible everywhere                                                                                                                                                                                                                                                                                                                                                       | Visible leak; corruption on save     | Write the final `-` as `\x2d` ([ecosystem](ecosystem.md))                                 |
| 4   | **Deleted table rows on the line right after the table, where the earlier draft put them, are fragile.** Prettier (even with default settings), remark, mdformat and pandoc insert a blank line there, and the draft then reads the deletion as one at the start of the next paragraph. Without the blank line, pandoc's GFM reader, kramdown and Typora show it as a table row                                                                                                                                  | Corruption on save; visible row      | Require a blank line between table and deletion; anchor such deletions to the table above |
| 5   | **The YAML ledger isn't portable** (details in [ids and ledger](ids-and-ledger.md)): `on:` and `no` become booleans; ids like `0x1f` become numbers; unquoted text is cut at `, ` or ` #`                                                                                                                                                                                                                                                                                                                        | Data misread and rewritten           | Letter-first ids, rename `on`, literal blocks for text                                    |
| 6   | **Re-wrapping prose pushes markers to line starts.** Prettier `proseWrap: always`, `mdformat --wrap`, and pandoc's default 72-column wrap (used by `github_document`) all do it, and GitHub then shows broken paragraphs                                                                                                                                                                                                                                                                                         | Visible break; line rule violated    | Never re-wrap. Document it, and use `--wrap=preserve`                                     |
| 7   | **pandoc's Markdown writer** (`pandoc -t markdown`) rewrites every inline marker as `` `<!--ins k3x9-->`{=html} ``, which shows as code. The Quarto and RStudio visual editor does not do this: it keeps comments unchanged, but shows them as gray code-styled text, rewrites the file in pandoc's style on opening, and loosens some lists ([ecosystem](ecosystem.md))                                                                                                                                         | Corruption on save (plain pandoc)    | Edit Redlines files in source mode; never round-trip them through `pandoc -t markdown`    |
| 8   | **Prettier strips trailing spaces** inside a deletion payload, which loses a deleted hard break                                                                                                                                                                                                                                                                                                                                                                                                                  | Minor corruption                     | One-line payloads (the problem disappears)                                                |
| 9   | **Prettier rewrites `*` emphasis as `_`** next to a marker. After the change is accepted, `re_built_` renders literally                                                                                                                                                                                                                                                                                                                                                                                          | Visible break after accept           | The serializer rewrites `_` to `*` when accepting would attach it to a word               |
| 10  | **kramdown treats any line with an unescaped `\|` as a table row**, even outside tables                                                                                                                                                                                                                                                                                                                                                                                                                          | Visible break (Jekyll, GitHub Pages) | Escape `\|` in every payload                                                              |
| 11  | **Liquid** (every `.md` on GitHub Pages) runs `{{ … }}` and `{% … %}` inside payloads; an unclosed `{% if %}` fails the build                                                                                                                                                                                                                                                                                                                                                                                    | Build fails                          | Escape `{{` and `{%` in payloads                                                          |
| 12  | **Plain MDX 3** (Next.js `.mdx`, Docusaurus with its v4 flag) can't compile HTML comments at all                                                                                                                                                                                                                                                                                                                                                                                                                 | Build fails                          | Document. Docusaurus 3 defaults and Next.js `.md` files are fine                          |
| 13  | **Obsidian** hides comments in Reading view but shows every marker and the ledger in Live Preview, its default editing mode                                                                                                                                                                                                                                                                                                                                                                                      | Cosmetic                             | Document                                                                                  |
| 14  | **Hidden is not removed.** Renderers that pass HTML through (VS Code, pandoc HTML, Hugo with `unsafe`) put deleted text, comment threads, names and emails in the page source. GitHub, remark and Docusaurus strip them                                                                                                                                                                                                                                                                                          | Privacy                              | Document. Publish the accepted view when that matters                                     |
| 15  | **Prettier re-pads a whole table** when one cell changes (1 changed line becomes 6), against the format's aim of keeping "markers on the lines they change"                                                                                                                                                                                                                                                                                                                                                      | Diff noise                           | The serializer keeps a table's existing style; recommend compact tables                   |
| 16  | **The prototype pandoc filter** reads each mark's author and date from a ledger key `changes`. The format stores them under `marks`, so every Word revision is by "Unknown" with an empty date. Its own `sample.md` still says `changes:`, which hid the bug. It also loses marks at block starts, whole-block changes, table deletions and deletions nested in insertions; doesn't decode escapes; and shows deleted text in HTML output | Wrong output                         | Fixes listed below                                                                        |

## Claims in the earlier draft, checked

Each claim below comes from the earlier draft of the format spec.

| Claim                                                                                | Verdict                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GitHub hides every mark and shows the newest version                                 | **Confirmed**, except payloads ending in `-`                                                                                                                                                         |
| Marks inside a line are invisible in paragraphs, headings, lists, cells, `<details>` | **Confirmed** (at text boundaries; see [renderers](renderers.md))                                                                                                                                    |
| A marker must not start a line                                                       | **Confirmed.** Only pandoc's markdown reader copes                                                                                                                                                   |
| An unescaped `\|` in a cell's payload splits the cell                                | **Confirmed.** kramdown splits ordinary paragraphs too                                                                                                                                               |
| Markers in alt text leak                                                             | **Confirmed**                                                                                                                                                                                        |
| knitr leaves HTML comments alone; escaped backticks protect deleted code             | **Refuted.** knitr runs code in comments; the escape protects chunks but makes inline code fail the knit; the ledger isn't covered                                                                   |
| Prettier inserts blank lines that the format tolerates                               | **True for line-rule markers, false for table row/column deletions**                                                                                                                                 |
| Visual editors "may move or drop markers"                                            | **Partly true.** The Quarto/RStudio visual editor keeps markers but rewrites the file and loosens some lists; plain `pandoc -t markdown` turns markers into visible code ([ecosystem](ecosystem.md)) |
| Pandoc spans give real Word tracked changes; comments only `comments.xml`            | **Confirmed**                                                                                                                                                                                        |
| The pandoc filter gives the right authors and dates                                  | **Refuted** for spec-conformant files (`changes` vs `marks`)                                                                                                                                         |
| R, Python and JS read the ledger after one decoding step                             | **Refuted** (booleans, numbers, cut text)                                                                                                                                                            |
| Obsidian shows the newest version with no visible marks                              | **Reading view yes, Live Preview no**                                                                                                                                                                |

## Recommendations for the docs

The study recommended these additions to the [format spec](../format.md):

- A formatter section:
  - Prettier with `proseWrap: "preserve"` (its default), remark-stringify, mdformat without
    `--wrap`, and `markdownlint-cli2 --fix` keep Redlines files valid.
  - Never re-wrap prose.
  - Prettier has no parser for `.Rmd` or `.qmd` and skips them.
  - Use pandoc only with `--wrap=preserve`, and `-t markdown-raw_attribute`.
- New rows in the table of how other tools show a Redlines file:
  - Obsidian: Reading view versus Live Preview.
  - Jekyll and GitHub Pages: escape `|`, `{{` and `{%`; blank line before row deletions.
  - MDX: compile error.
  - Renderers with raw HTML off: every marker shows as text.
- A privacy note where the spec explains why it uses HTML comments: hidden is not removed.
- **Pandoc filter fixes:**
  1. Read `meta.marks`, falling back to `meta.changes`. Omit `date` when it's missing.
  2. Decode the escapes, and parse payloads as Markdown.
  3. Handle markers that pandoc parses as `RawBlock`: openers at block starts, whole-block
     changes, row and column deletions.
  4. Recurse into insertions, so nested deletions survive.
  5. Strip all marks in the default `edited` view; emit tracked-change spans only for Word, or
     in a `markup` view.

  Fix 1 still applies: the format keeps authors and times in the ledger, under `marks`
  ([authors and times](../format.md#24-authors-and-times)).

The encoding fixes (escapes, blank line, ids, ledger keys) are part of the
[format spec](../format.md). They were checked together on one sample with every construct. The
sample renders cleanly on GitHub and in every renderer that accepts HTML comments, and passes
Prettier (default), markdownlint, remark and mdformat with all marks intact.

That sample wrote backticks as the entity `&#96;`. The renderer tests verified the alternative
`\x60` in knitr and in every renderer ([renderers](renderers.md)). Both remove the backtick
character entirely; the format uses `\x60`, so that all escapes are backslash escapes.
