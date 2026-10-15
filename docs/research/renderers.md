# Where markers can go: renderer fuzzing

Status: research notes, October 2026.

The format promises that GitHub and VS Code show the newest text with no trace of the marks. This
study tests where in Markdown an HTML-comment marker can sit without changing how the document
renders.

## Method

- For each case, `render(marked)` was compared with `render(clean)`, where `clean` is the newest
  text without markers. Both outputs went through an HTML5 parser (as a browser or GitHub's
  sanitizer would), comments were dropped, and whitespace was normalized.
- **Renderers:**
  - cmark-gfm 0.29.0.gfm.13, the library GitHub uses
  - GitHub's live pipeline (`gh api markdown`, 92 calls, synthetic text only)
  - markdown-it 14.3, configured like VS Code's preview
  - micromark with GFM
  - commonmark.js 0.31
  - pandoc 3.5 and 3.9 (the `markdown` reader used by R Markdown and Quarto, and `gfm`)
- **Corpus:**
  - 298 targeted cases, 437 multi-line-payload cases and 72 conformance cases
  - 90,264 fuzz cases: a marker at every offset of the CommonMark and GFM spec examples, in four
    shapes
  - 16,712 positions in this repository's own docs
- GitHub agreed with local cmark-gfm on 290 of 298 targeted cases. The 8 differences are
  GitHub-only features such as emoji.
- **Verdicts:**
  - **ok:** identical
  - **LEAK:** marker text visible
  - **TEXT:** visible text differs
  - **STRUCT:** same text, different structure (for example, a list split in two)

## Summary

Markers between ordinary words are safe. In this repository's docs, cmark-gfm and markdown-it
showed no hazard at 9,000 plain-text positions, nor inside words, next to punctuation, in inline
link text or in table cells.

An earlier draft of the format leaked marker text on GitHub and in VS Code in four ways, all
confirmed on GitHub's live pipeline:

| #   | Hazard                                     | Example                                                                           | What breaks                                                                                                                                                                                                                                             |
| --- | ------------------------------------------ | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **An inline payload that spans lines**     | `Alpha one <!--del k3x9 two three.⏎\⏎## Middle heading⏎\⏎Gamma four -->five six.` | Block parsing runs before inline parsing, so `## Middle heading` interrupts the paragraph. The comment never closes, and the deleted heading renders as a real heading. Of 48 payload line types, 33 leak in cmark-gfm, 32 in markdown-it, 30 on GitHub |
| 2   | **A payload that ends in `-`**             | `a <!--del w2rf pre--->b`                                                         | cmark-gfm and markdown-it reject comment text ending in `-`, so the whole marker shows. The draft's own escapes produce this (`\-` still ends in `-`)                                                                                                   |
| 3   | **`--` escaped with a plain find-replace** | `"A ---> B"` becomes `A -\--> B`                                                  | A run of three hyphens keeps a `--` and closes the comment                                                                                                                                                                                              |
| 4   | **A backtick in a payload**                | ``Press ` then <!--del w2rf use \`x\` -->go.``                                    | A stray backtick before the comment pairs with the payload's backtick and makes a code span, because backslashes do nothing inside code spans. knitr also fails ([tools](tools.md))                                                                     |

The fix for all four, tested in every renderer:

- Payloads stay on one line, with line breaks written as `\n`. The same multi-line deletion as
  one line gave 0 of 48 hazards everywhere, including 48/48 ok on GitHub, and survived Prettier
  unchanged.
- Hyphens are escaped one by one.
- A trailing `-` gets a guard.
- Backticks are written `\x60`.

## Own-line markers are not always harmless

An earlier draft of the format said a marker on a line of its own "is invisible and harmless."
That holds before the first line of a top-level block, right after a list bullet or `>` with the
content on the next line, and as a closing line after a block. It fails in these places:

| Own-line marker placed…                                                                          | Effect on GitHub and in VS Code             |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| between two lines of one paragraph (deleting a source line of a wrapped paragraph)               | the paragraph splits in two                 |
| between the lines of a quoted paragraph                                                          | the paragraph splits                        |
| between setext heading text and its underline                                                    | the heading is lost                         |
| at column 0 between list items                                                                   | two lists                                   |
| on a blank line inside a list                                                                    | the list splits, or content leaves the item |
| with an indented code block's 4 spaces (the draft put the marker "with the block's indentation") | the marker becomes code text                |
| before YAML front matter                                                                         | VS Code loses the front matter              |

The draft also allowed blank lines between an own-line marker and its block, and such a blank line
turns a tight list loose: `- one⏎- <!--ins k3x9-->⏎⏎  two` puts a `<p>` in every item.

## Inline positions that must stay off limits

The earlier draft's line rule ("a marker never starts a line inside a paragraph") is right but too
narrow. It must also cover continuation lines, lazy lines, footnote bodies, pipeless table rows,
and text right after `- `, `1. ` or `> `. Inside a line, these positions change rendering:

| Position                                                                                                                    | Effect                                                 |
| --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Right after a backslash, as in `C:\<!--ins…-->`                                                                             | The backslash escapes `<`; the marker shows            |
| After the two trailing spaces of a hard break, or after a backslash break                                                   | The break is lost, or the marker shows                 |
| Inner side of intraword `**`, `*` or `~~` (`a**<!--…-->b**c`)                                                               | The emphasis breaks (the marker counts as punctuation) |
| Either side of an intraword `_`                                                                                             | Emphasis appears from nowhere                          |
| Inside code spans, link destinations, reference labels, autolinks, bare URLs, entities, footnote references, image alt text | Marker visible, or link/image broken                   |
| Directly before `www.`                                                                                                      | The autolink is lost (GitHub)                          |
| On a line that is only syntax: thematic break, setext underline, table delimiter row, fence line                            | The block is lost, or code swallows the rest           |
| Before a task checkbox                                                                                                      | The checkbox is lost                                   |

Verified safe:

- the inner side of non-intraword emphasis (`x **<!--…-->bar** y`)
- the outer side of intraword `**`
- inline link text
- table cell text
- word boundaries
- before or after `https://` URLs
- after a task checkbox

## Tables

- A deleted row kept on the line right after its table, where the earlier draft put it, renders
  correctly on GitHub, cmark-gfm, markdown-it, micromark and pandoc's markdown reader. pandoc's
  `gfm` reader reads it as a table row, as do kramdown and Typora ([tools](tools.md)), and
  Prettier inserts a blank line there anyway. A blank line before the deletion fixes every case.
- An unescaped `|` in a cell payload splits the cell, as the spec says; `\|` works.
- A pipeless row that starts with a marker leaves the table. Write leading pipes for marked rows.

## Other findings

- `--!>` ends a comment in HTML5 (browsers, GitHub's sanitizer), but not in the Markdown
  renderers. Escaping hyphens one by one prevents it.
- CRLF line endings change nothing: 5,145 verdicts are identical to LF.
- Prettier keeps one-line payloads byte for byte (144/144). It strips the indentation of a marker
  line inside a paragraph, and rewrites multi-line payloads written in the earlier draft's form,
  which were already broken.
- pandoc's markdown reader is far more tolerant than the CommonMark renderers: it needs blank
  lines before blocks, so multi-line payloads don't leak there. But `<!--…-->⏎---` becomes an
  empty heading, and markers split pandoc's smart `--` and `...`.
- The examples printed in the docs render as intended, including the launch-plan example with its
  ledger.

## Effect on the format

The serializer rules that came out of this study cover marker placement, payload encoding, tables
and front matter. They are part of the format spec; see
[where markers go](../format.md#3-where-markers-go),
[payload encoding](../format.md#25-payload-encoding) and [tables](../format.md#37-tables). All 72
conformance cases written to these rules render identically on GitHub, cmark-gfm, markdown-it,
micromark, commonmark.js and pandoc.

## Fixtures

- [`fixtures/render-safe.json`](fixtures/render-safe.json) (217 cases) and
  [`fixtures/render-hazards.json`](fixtures/render-hazards.json) (132 cases) record, per case:
  - `clean` and `marked`;
  - the verdict observed in each renderer, GitHub included;
  - for hazards, the rule each one motivates.
- They belong in `packages/format`'s conformance suite.
- A CI check can re-render them and fail when a verdict changes, for example after a renderer
  upgrade.

The code and data are in the project's lab, outside this repository.
