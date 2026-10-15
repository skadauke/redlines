# Markdown syntax coverage

Status: research notes, October 2026.

This study checks how the editor can support every element of the Markdown Guide's
[basic syntax](https://www.markdownguide.org/basic-syntax/) and
[extended syntax](https://www.markdownguide.org/extended-syntax/), plus the useful
[hacks](https://www.markdownguide.org/hacks/), with tracked changes. Five of the hacks are in
scope:

- admonitions;
- image size, tracked;
- image captions, for scientific writing;
- symbols, as HTML;
- line breaks and lists inside table cells.

## Method

- **Inventory:** every element on the three pages, 18 basic, 15 extended and 14 hacks.
- **Storage syntax:** defined for `.md`, where GitHub's dialect rules, and for `.qmd` and `.Rmd`,
  where pandoc's does.
- **Rendering:** checked on GitHub (live API), in VS Code's preview, in pandoc 3.5 and 3.9, and in
  Typora and Obsidian from their documentation. Quarto from its documentation only.
- **Marker safety:** 172 marker placements, run through 9 local renderers and GitHub with the
  [renderer harness](renderers.md):
  - 135 forms the rules would write;
  - 8 alternatives;
  - 29 positions the rules forbid.

## One dialect per file type

The serializer writes GitHub's syntax in `.md` files and pandoc's in `.qmd` and `.Rmd` files. It
reads all the common variants and never rewrites syntax it didn't change.

| Element                     | `.md` (GitHub) writes                                    | `.qmd`, `.Rmd` (pandoc) writes | Watch out for                                                                  |
| --------------------------- | -------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------ |
| Subscript, superscript      | `<sub>`, `<sup>`                                         | `~x~`, `^x^`                   | **A single `~x~` is strikethrough on GitHub and subscript in pandoc** (tested) |
| Highlight                   | `<mark>`                                                 | `[x]{.mark}`                   | `==x==` shows literally on GitHub; pandoc needs `+mark`                        |
| Underline                   | `<ins>`                                                  | `[x]{.underline}`              | **GitHub strips `<u>`** (tested), though some editors write it for underline   |
| Heading IDs                 | none (GitHub makes its own); `{#id}` kept if present     | `{#id}`                        | `{#id}` shows as text on GitHub, in VS Code, Typora and Obsidian               |
| Definition lists            | `<dl>`                                                   | `Term` / `: definition`        | GitHub shows `: definition` as text                                            |
| Emoji                       | the character; `:tent:` kept if present                  | the character                  | Shortcodes don't render in pandoc, Quarto or VS Code                           |
| Center, color, link targets | `<p align="center">`; color and targets not offered      | not offered                    | GitHub strips `<center>`, `<font>`, `style` and `target` (tested)              |
| Table of contents           | a list of links, kept current by a command; `[TOC]` read | `toc: true`                    | `[TOC]` shows literally on GitHub and in pandoc                                |
| Videos                      | a thumbnail link; `<video>` for files                    | Quarto's `{{< video >}}`       | GitHub shows `<iframe>` as visible text (tested)                               |

Everything else in basic and extended syntax is written the same way in both dialects, and
renders as expected everywhere.

- pandoc's Word output drops every HTML hack: `<br>`, `<sub>`, `<ins>`, `<img>` and the rest. This
  affects R Markdown and Quarto users who render to Word. Redlines' own Word export does not drop
  them.
- GitHub doesn't render `.qmd` or `.Rmd` as Markdown at all. It shows them as source.

## The five hacks

### Admonitions

- **Syntax:**
  - `.md`: GitHub alerts (`> [!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]`).
  - `.qmd` and `.Rmd`: Quarto callouts (`::: {.callout-note}`) with the same five types.
- **Display:** the editor renders all three syntaxes, Obsidian's callouts included, as a box with
  an icon and title. The type is a dropdown in the title.
- **Other types:** Obsidian-only types are offered only where the file already uses them, because
  GitHub shows them as a plain quote with `[!tip]` in it (tested).
- **Tracking:** changing the type is a block format change. Marks inside the body are safe, with
  one placement rule (see [Marker safety](#marker-safety)).

### Image size

- **Syntax:** `<img src="…" alt="…" width="480">` in `.md` (GitHub keeps `width` and `height`,
  tested), and `![alt](src){width=60%}` in pandoc files. Never `style`, which GitHub strips.
- **Other syntaxes:** Typora's `zoom` and Obsidian's `|300` are read, and converted on the first
  resize.
- **Editing:** corner handles that keep the aspect ratio, a size tooltip, snapping to 25, 50, 75
  and 100% of the text width, and an "Original size" command.
- **Tracking:** a resize is a format change that records the old width (`fmt @width=480`). It
  shows as a "Formatted: width 300 → 480 px" card, the way Word shows formatting changes.
- **Word export:** whether Word tracks picture resizing is unconfirmed. If it doesn't, the export
  writes a deleted copy at the old size and an inserted copy at the new size, so Accept and Reject
  still work.

### Image captions

- **Background:** pandoc makes a figure from an image that stands alone in its paragraph, and uses
  the alt text as the caption. Quarto adds numbering and cross-references.
- **`.qmd`:** `![Caption.](km.png){#fig-km width=60%}` and `@fig-km`.
- **`.Rmd`:** bookdown's `(\#fig:km)` and `\@ref(fig:km)`.
- **`.md`:** `<figure>` with Markdown inside: the image, then `<figcaption>` with `**Figure 1.** …`.
  GitHub strips `<figure>` and `<figcaption>` (tested). It still shows the image and the caption
  as a paragraph below it, so the result reads fine, and marks in the caption are safe.
- **Numbering:**
  - `.md` stores the number as text, and a Renumber command keeps it current.
  - Word export writes real caption fields (`SEQ Figure`) and cross-reference fields.
- **Editing:** an "Insert caption" command, as in Word, adds a caption field under the image.
  Quarto files also get `@fig-` autocomplete.
- **Placement:** a marker anywhere in the paragraph of an image that stands alone destroys
  pandoc's figure and its caption (tested). Marks around such an image go on their own lines, with
  blank lines.

### Symbols

- **Storage:** HTML entities (`&copy;`) in both dialects; existing Unicode characters are never
  rewritten.
- **Editing:** the editor shows the glyph and treats the entity as one character for the arrow
  keys and Backspace.
- **Inserting:** an Insert Symbol palette with search, categories (common, arrows, math, Greek,
  currency) and recent symbols, plus `&` autocomplete.
- **Tracking:** a whole entity at a time.

### Line breaks and lists in table cells

- **`.md`:** Shift+Return in a cell writes `<br>`; lists are `<ul>` or `<ol>`. Both render on
  GitHub (tested), and every tracked form passed there.
- **pandoc files:**
  - `<br>` works in HTML output only, so Redlines' pandoc filter turns it into a real line break.
  - pandoc deletes an HTML list in a pipe-table cell from every output (tested on 3.5 and 3.9).
    The editor warns and offers a grid table instead.

## Tracked changes for each element

| Edit                                                                      | How it is tracked                                                                                                             |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Text anywhere: paragraphs, alerts, footnotes, captions, cells, list items | Inline insertions, deletions and substitutions                                                                                |
| Image size, a heading ID, a link's URL                                    | A format change that records the old attribute (`@width=480`, `@id=meth`, `link=URL`)                                         |
| Admonition type                                                           | A block format change (`was=callout-note`)                                                                                    |
| Footnote inserted or deleted                                              | One insertion or deletion with two segments: the reference and its definition                                                 |
| Checkbox ticked or unticked                                               | A point format change (`+check`, `-check`). Tracked when tracking is on, because it changes what readers see ("[x] Approved") |
| Highlight, subscript, superscript, underline added                        | A format change (`+mark`, `+sub`, `+sup`, `+underline`); the serializer picks the dialect's syntax                            |
| Emoji, symbol entity                                                      | The whole character or entity                                                                                                 |
| Line break inserted                                                       | A `split` point marker before the break                                                                                       |
| List item in a cell                                                       | An insertion or deletion of the whole `<li>`                                                                                  |

A content highlight is not a review highlight. `==x==`, `<mark>` and `[x]{.mark}` are part of the
document, and every reader sees them. Redlines' `hl` is a reviewer's annotation stored as a mark.
They render differently: yellow for content, the reviewer's color for `hl`. "Make permanent" turns
an `hl` into a tracked highlight.

## Marker safety

- **Rule forms:** 124 of the 135 render exactly like the unmarked text in every renderer that
  applies to their file type. The 11 exceptions are narrow and documented:
  - a mark at the start of an alert's body loses the alert in two renderers, with a blank `>`
    line as the workaround;
  - pandoc's table column widths change;
  - footnote continuation paragraphs, in two renderers.
- **Probes:** 28 of the 29 found real hazards. These positions are now forbidden:
  - anywhere in the paragraph of an image that stands alone (pandoc's figure);
  - after `{#id}`; on `:::` fence lines; inside `~x~` or `^x^`;
  - on a link-reference definition line;
  - between definition-list items;
  - right after `[^n]: `; before or inside `[!NOTE]`; before a task checkbox;
  - between a letter and an emoji shortcode;
  - around a backslash line break;
  - inside alt text.

## Effect on the format

The study added these rules to the [format spec](../format.md):

- one dialect per file type;
- attribute ops (`@name=old`) on [format changes](../format.md#26-format-changes);
- new format ops (`±mark`, `±sub`, `±sup`, `±underline`, `±check`, `callout-TYPE`);
- the new [forbidden positions](../format.md#3-where-markers-go);
- rules for markers inside raw HTML blocks;
- `split` for inserted line breaks;
- caption marks allowed in pandoc files.

## Not yet checked

- In desktop Markdown editors: what they write when an image is resized; how they handle `<br>`,
  lists and `\|` in table cells, `<figure>` and `<mark>`; and whether a marker on the `[!NOTE]`
  line breaks their alerts.
- In Word: whether it tracks picture resizing, checkbox toggles and link edits.

The code and data are in the project's lab, outside this repository. They include the harness, the
172 fixture cases with a verdict per renderer, and the full report.
