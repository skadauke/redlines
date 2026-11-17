# Quarto documents in Redlines

Status: study and plan, November 17, 2026. Written for Epic #930.

Redlines already opens, saves and reviews `.qmd` files as pandoc-dialect Markdown (format §9.1). This
note asks what that is worth today, where it breaks, and what it would take to make a Quarto document
as good in Redlines as a plain one. It reads Quarto's documentation (quarto.org, November 17, 2026),
probes the format library with a sample `.qmd`, and plans the work.

**Not run:** neither `quarto` nor a runnable `pandoc` is installed on the machine of this study (the
only `pandoc` on it is an Intel binary that doesn't start), and nothing was installed. Everything
below about what Quarto or pandoc *does* with a mark comes from their documentation or from the
earlier notes that did run pandoc ([syntax](syntax.md), [renderers](renderers.md),
[tools](tools.md)), and is marked "untested" where it is a guess. The first step of the plan is a
script that tests it on any machine that has Quarto.

## Summary

- **Most of a Quarto file is ordinary Markdown to Redlines, and that part works.** Text inside a
  callout, a column or a tabset, headings, spans, citations, tables and footnotes take insertions,
  deletions, comments and decisions, and read the same in every order of decisions (probe, below).
- **Three kinds of Quarto syntax are handled as the spec says:** fenced chunks and their `#|`
  options (a change replaces the whole chunk, with its backticks and `#|` escaped in the payload),
  shortcodes `{{< … >}}` (a change replaces the shortcode, with `{\{<` in the payload) and attribute
  blocks `{#id .class}` (a change replaces the block).
- **Three are not, though format §3.1 rule 9 says they are:** a mark on a `:::` fence line, a mark
  inside `@fig-plot` or `[@smith2020]`, and a mark between the colons of a closing fence. The library
  reads a `.qmd` as GitHub Markdown plus whatever it already knew, and has no scanner for divs or
  cross-references. Each of these can change what Quarto renders (from the earlier pandoc tests and
  pandoc's grammar; untested on Quarto). They are bugs against the spec, and the first PRs.
- **Includes work as separate files today.** Each `_part.qmd` is a Redlines file of its own, with its
  own ledger. They meet in one file only when something joins them (`quarto render --keep-md`,
  knitr child documents, a person pasting); that is #144, which #915 is building. What Quarto's
  include syntax asks of marks, that the shortcode stay alone on its line, is new (below).
- **The editor draws none of it.** A callout is `::: {.callout-note}` text in a paragraph; Quick Look
  draws callout boxes (#821) and nothing else does. This is the largest gap for the people who would
  use Redlines for `.qmd`, and it is mostly drawing, on the editor's existing alert box.
- **Rendering and Word:** the marks are HTML comments, which pandoc drops, so `quarto render` shows
  the newest text in every format (the claim of [tools](tools.md), run for pandoc and knitr, not for
  Quarto). For Word there are two routes, Quarto's docx from the source and Redlines' own export.
  Plan: keep Redlines' export for review, since it keeps comments and threads, and offer the pandoc
  filter (format §11) for people who want Quarto's docx with tracked changes.
- **The plan is 17 PRs in six phases, about nine hours of lane time.** The first four PRs make the
  library obey its own spec; the next four draw the constructs; the rest are includes, Word and
  Quarto's own render. Six questions for Stephan are at the end.

## What Quarto adds to pandoc's Markdown

From Quarto's authoring documentation:

- **Fenced divs.** `::: {#id .class key="value"}` opens, a line of three or more colons closes (no
  attributes, and the count needn't match). Divs nest. They make callouts (`.callout-note`, `-tip`,
  `-warning`, `-important`, `-caution`, with `title=`, `collapse=`, `appearance=`, `icon=`, or the
  first heading as the title), columns (`.columns`, `.column width=`), tabsets (`.panel-tabset`),
  figures and tables with a label (`::: {#fig-x}`), theorems and `.hidden`.
- **Spans and attributes.** `[text]{.class key="val"}`, in the order id, classes, pairs.
  Headings, images, tables' captions, display math and code blocks take `{#sec-… .unnumbered}`,
  `{#fig-…  width=60%}`, `{#tbl-…}`, `{#eq-…}`, `{#lst-…}` after them.
- **Cross-references.** A label starts with its type (`fig-`, `tbl-`, `lst-`, `eq-`, `sec-`,
  `thm-` and its kin, `nte-`/`tip-`/… for callouts); `@fig-x` is a reference, `[-@fig-x]` the number
  only, `[Fig @fig-x]` a custom prefix, `[@fig-a; @fig-b]` a group. The same `@` marks a citation
  (`[@smith2020, p. 4]`), so the two share a grammar; a key may hold `-`, `_`, `:`, `.` and more.
- **Code cells.** A fence with a braced engine (`{r}`, `{python}`, `{ojs}`, `{mermaid}`), whose first
  lines starting `#|` (`//|` for some languages) are YAML options: `label: fig-plot`,
  `fig-cap:`, `echo: false`, `output:`. A plain `{.python}` fence isn't run.
- **Shortcodes.** `{{< name args >}}`: `include`, `embed`, `meta`, `var`, `env`, `video`, `kbd`,
  `pagebreak`, `lipsum`, `contents`, and an author's own.
- **Includes.** `{{< include file.qmd >}}` pastes another file's text "as if you had pasted it
  there". It must be alone on its line with blank lines around, and can't sit inside a list item. A
  relative path is read from the *main* file's directory, so nested includes use project-root paths;
  an included file with front matter "will cause unexpected behavior"; a name starting `_` is not
  rendered alone. Computational includes share one engine.
- **Front matter and projects.** YAML between `---` lines at the first line, `format:`, `bibliography:`,
  `execute:`, `editor: source`. A project's `_quarto.yml` and a folder's `_metadata.yml` supply
  defaults the document overrides; objects merge key by key.
- **Raw and attribute-free forms.** ```` ```{=html} ```` raw blocks, inline `` `x`{=html} ``, `$…$`
  and `$$…$$ {#eq-x}` math, footnotes `[^1]` and `^[inline]`.

## What Redlines does with a `.qmd` file today

How it reads one: the extension picks the pandoc dialect (`apps/desktop/src/file-names.ts`), which
changes what Redlines *writes* (`[x]{.mark}`, `{width=}` after an image) and nothing it reads. The
parser is micromark with GFM, so `:::` lines are paragraph text, and `{{<` is text. The one pandoc
feature the library knows is the attribute block, and the front matter.

### The probe

A 45-line `.qmd` (front matter, a heading with `{#sec-intro .unnumbered}`, a callout with a title, a
columns div with two columns, a chunk with `#|` options, an include and a `video` shortcode, a span)
was edited at about 20 places with `trackedEdits` and again with `fineEdits` (the throwaway test was
deleted afterwards). Each result was judged by whether the newest view, the original view, accept-all
and reject-all give back what the edit and the file say:

| Place of the edit | What Redlines wrote | Reads right | Quarto reads it right |
| --- | --- | --- | --- |
| a word in a callout or column | `Car<!--ins-->X<!--/-->eful` | yes | yes |
| delete a word in a callout | `<!--sub … -->` of the words | yes | yes |
| text of a heading | an insertion in the title | yes | yes |
| `{#sec-intro}` in a heading | the whole heading as a substitution | yes | yes (payload in a comment) |
| a chunk's code, a `#|` line, its fence | the whole chunk as a substitution; payload has `\x60` for backticks and `#\|` | yes | yes (verified for knitr in [tools](tools.md); Quarto untested) |
| `{{< include >}}`, `{{< video >}}` | the shortcode as a substitution; payload has `{\{<` | yes | yes (untested: whether Quarto expands an include inside a comment) |
| a whole shortcode deleted | the block, with its blank line, as a deletion | yes | yes |
| `[a span]{.mark}` text, its attributes | an insertion; a substitution of `{…}` | yes | yes |
| **the attributes on a `:::` line** (`{.callout-note title=…}`) | `::: <!--sub … -->{X.callout…}<!--/-->`: **a marker on the fence line** | yes | **no** (rule 9; pandoc takes a fence only when nothing else is on the line) |
| **the closing `:::`** | `:<!--ins-->X<!--/-->::`: **a marker between the colons** | yes | **no** (the div isn't closed) |
| **`@fig-plot`, `[@smith2020]`** | `@fig-<!--ins-->X<!--/-->plot`: **a marker inside the key** | yes | **no** (the key becomes `fig-` and a stray `Xplot`) |
| a whole `@fig-plot` deleted | `<!--del … -->` | yes | yes |
| a new callout typed | `::: {.callout-tip}<!--split … -->` and `:::<!--/…-->`: **markers on both fence lines** | yes | **no** |
| a whole callout deleted | the div, fences included, in the payload | yes | yes |
| front matter | refused with `front-matter` by the library; the editor asks first (§3.13) | n/a | n/a |

"Reads right" is Redlines' own reading, which held everywhere. The last column is the point: the
four bold rows read right in Redlines and would change what Quarto renders. [syntax](syntax.md)
found the fence-line hazard with pandoc, and §3.1 rule 9 forbids all three, so these are the library
falling short of its spec, found because nothing tested `.qmd` constructs until now. The probe did
not test text typed *after* `}` of an attribute block, or a mark between a callout's title heading
and its body.

## The constructs, and what to do with each

Policy, as the brief states it: a correct write, else widen to the unit that holds it, else alert,
else disable with a reason. Never add a refusal.

| Construct | Library today | Editor today | Quick Look | Needed | Policy |
| --- | --- | --- | --- | --- | --- |
| Front matter | edit asks first; ledger records keys (§5.4) | source text | dimmed, plain | a form is "could" (design §5) | alert, as now; never a marker in it |
| `_quarto.yml`, `_metadata.yml` | Plain-only file (YAML) | opens in Plain | n/a | open from a link in the project | disable review; text is untracked |
| Fenced div, any class | text; fence lines unguarded (bug) | `:::` lines as text | text only | a scanner that knows fences, nesting and code | edits in the body write; an edit that touches a fence **widens to the whole div**; a closing fence, its count, or a new fence is the div's edit |
| Callout (`.callout-*`) | as a div | text | quiet labelled box | the editor's alert box with the kind and `title=`; type menu | type or title change is a block format change: substitution of the attribute block, with the markers on their own lines outside the fences |
| Columns, tabsets, `.hidden` | as a div | text | its text | a quiet bracket in the margin, tab titles from headings | as a div; moving content between columns is delete plus insert |
| Heading `{#sec-x}`, `{.unnumbered}` | attributes atomic; edit widens to the heading | outline hides them | text | dimmed attribute, label as a chip | widen (works) |
| Image or table caption `{#fig-x}`, `{#tbl-x}` | `{…}` atomic; pandoc figure paragraph guarded (§3.1 rule 8) | image size works for `{width=}` | alt text | caption box with the number | widen; marks in a caption only inline |
| `$$ … $$ {#eq-x}` | display math atomic; label after it atomic | text | text | label chip | widen |
| Cross-reference `@fig-x`, `@sec-x`, `[-@x]`, `[@a; @b]` | **no guard (bug)** | text | text | a chip with the target's number and a jump | a change that touches the token **widens to the whole token**; a deletion of it is fine; typing next to it writes outside it |
| Citation `[@smith2020, p. 4]` | no guard (bug) | text | text | the bibliography's entry on hover (design "Should") | as a cross-reference, over the whole bracket |
| Span `[x]{.class}` | text inside takes marks; `{…}` atomic | text | text | draw the class where it is known (`.mark`, `.underline`) | write inside, widen the attributes |
| Chunk and `#|` options | whole-chunk substitution, escaped payload | code block, options plain | options dimmed over the code | options as a header line, a "run" never | widen (works); a chunk is never split by a mark (rule 9); the escapes keep knitr and Quarto from running the old code |
| Inline code `` `r x` `` | atomic | code | code | none | widen (works) |
| Shortcode `{{< … >}}` | atomic, substitution, `{\{<` in the payload | text | text | a chip: name and first argument | widen (works); never a mark inside |
| `{{< include f >}}` | as a shortcode, but see below | text | text | a block that names the file, opens it, shows its marks count | the shortcode **stays alone on its line**: block markers on their own lines; any mark that would span it is widened to the whole include or ended before it |
| Raw ```` ```{=html} ````, mermaid, `{ojs}` | fenced code | code | code | preview for mermaid (design "Should") | widen (works) |
| Footnotes, tables, lists, math | as GFM | drawn | drawn | none | as `.md` |
| `~x~`, `^x^` (pandoc's) | read as GFM; no guard (format §9.1, rule 9) | text | text | keep as written | the spec's guard, shared with this work: widen to the whole span |

## Includes and several ledgers

Facts from the documentation that matter:

1. An include is expanded as text, before the file is parsed, from the main file's directory.
2. An included file may hold its own front matter and chunks, and "all cells use one engine".
3. The shortcode is alone on a line with blank lines around, outside lists.

What follows for Redlines:

- **Each file is its own Redlines file.** The editor opens `_part.qmd` as a document; its comments and
  changes and ledger live in it. This is the normal case, needs no work, and is what the decision
  on #144 assumed ("the editor always writes one ledger").
- **A joined text has several ledgers, and each marker reads the first ledger after it.** Where one
  appears: `quarto render --keep-md` and `keep-qmd` leave the expanded file next to the output;
  knitr child documents and `{{< embed >}}` expand likewise; a person may paste a file into another.
  A review of that joined file, read-only, is the case #915 serves (the Quick Look and the CLI read
  it); writing it back to the parts is #915's `setLedger`, which keeps each entry in its ledger.
- **A mark across an include.** If a mark opens before the shortcode and closes after it, Quarto's
  expansion puts the included file, with its ledger comment and its own marks, inside the first
  mark's text. After the expansion the first ledger would sit inside the mark. Rule: **no mark ever
  holds an include line.** An edit whose range crosses one is widened to end before it, or, if it
  starts at it, to hold the whole shortcode as a substitution. A comment on the line is a block
  mark, with the opener on the line before and the closer on the line after.
- **Marks inside the included part, seen from the main file.** The editor may show the include's
  text inline, read-only, with the counts of its changes ("3 changes in `_part.qmd`"), and open it
  on click. It must not write to it from the including file: two files, two ledgers, one author.
- **Two files, one id.** Ids are random per file ([ids-and-ledger](ids-and-ledger.md)); a joined text
  from two parts can hold the same id twice only if two parts were copied from one. The duplicate-id
  warning already covers it, and #915's rule (the first ledger after) gives each its own entry.
- **Paths and the project.** The include's path is read from the *main* file's directory, and the
  nested include from the project root. To open the included file the editor has to know the main
  file; where it is opened first from the shortcode, it knows it. A file opened alone has no main
  file, and the "open" link is only a hint.

## Rendering: what each tool draws

- **Quick Look** (#821, merged): the Clean view of the newest text; `.callout-*` as a quiet box with
  a label, any other div as its text, chunk options dimmed, front matter plainly. No chips, no
  cross-reference numbers, an include shown as the shortcode text.
- **The editor** should draw, in this order of value: callouts (the editor's alert box, with the
  kind in the title menu; the same tint and the author's color for a pending type change); the
  options of a chunk as a header line; `:::` fence lines folded away when the caret isn't there (as
  the alert's syntax is, §5.2: "the source shows while the caret is in the title line"); shortcodes,
  cross-references and citations as chips (design "Could", and the numbers need a table of labels,
  which the editor can build from `{#fig-…}` and `#| label:` itself, without running anything);
  columns as a quiet bracket, not as columns (a margin of notes beside three columns would not fit).
  The tabset's tabs are headings and need no drawing.
- **Quarto itself**, from Redlines' marks: the marks are HTML comments and a ledger comment. Pandoc
  drops them from every output, so a `.qmd` that holds changes renders its newest text. What must be
  tested, with Quarto, because it pre-processes the text before pandoc:
  1. include and shortcode expansion in the payload of a deletion (the payload has `{\{<`; does
     Quarto expand `{{<` inside an HTML comment anyway?);
  2. the jupyter engine's cell scan, which is not knitr's: does a `{python}` fence in a payload
     start a cell? (the payload writes backticks as `\x60`, so it should not);
  3. `#|` options in a payload (written `#\|`);
  4. the new-callout and cross-reference hazards above, once fixed, in a render that counts the
     figures and callouts;
  5. `quarto render --to docx`, `html` and `typst` with changes pending, against the same file with
     every change accepted: the output should be identical.
  A script, `scripts/quarto-check` (not in CI, which has no Quarto), runs them, for any machine
  that has Quarto. Nothing in this note claims they pass.
- **The visual editor** of Positron and RStudio rewrites the file and shows markers as code
  ([ecosystem](ecosystem.md)); `editor: source` in `_quarto.yml` is the advice, and nothing more is
  needed here.

## Word round trips

Three ways to get a `.qmd` into Word and back:

| Route | Tracked changes | Comments | Code and figures | Back to the source |
| --- | --- | --- | --- | --- |
| **Redlines' export** (`packages/word`) from the source | real, with authors | with threads | chunks as code paragraphs; no output (nothing runs); cross-references as the text typed, since the number is Quarto's to make | Redlines' importer (`importDocx`): changes become marks, a changed paragraph is matched by text |
| **Quarto docx** from the source (`format: docx`) | none by default; with the pandoc filter (§11), `.insertion` and `.deletion` spans become real ones | dropped; with the filter, comments that have a range, without threads | figures, tables and numbers as rendered; the real review document | none: the rendered text no longer is the source, and a Word edit of "Figure 1" can't be mapped to `@fig-x` |
| **Quarto docx with the filter**, as a view of the markup | yes | partly | as rendered | none |

Quarto's docx page documents `reference-doc` and no option for tracked changes or comments (the
docx *input* side has pandoc's `--track-changes`; Quarto's output has no equivalent that this study
found). So the choice is not really between the two writers, but about what comes back:

- A review of **prose** returns well by Redlines' route: export from the source, review in Word,
  import the result as marks. The reviewer sees code as code and no figures.
- A review of **the rendered report** (figures, tables, numbers) can't come back to the source as
  edits. It can be read, and its comments could be matched to source paragraphs by text, as the
  importer does for plain documents; the numbers and the figures are then the reviewer's read-only
  context. That needs a Quarto-aware importer rule: a paragraph that holds a cross-reference or an
  inline code result is matched on its words around it, and a reviewer's change inside the number is
  turned into a comment, not an edit (widen, then alert).

## Plan

Estimates are lane minutes for one PR, from the lane experience (10–40 minutes). PRs depend on the
one above them only where stated.

**Phase 0: the library obeys its spec (needs no design).**

| PR | What | Min |
| --- | --- | --- |
| Q1 | A `pandoc-syntax` scanner in `packages/format`: the line ranges of fenced divs and their fences (knowing code and comments), the ranges of `@label` and `[@cite; @cite]` tokens, `{{< >}}` and `#|` lines, for the pandoc dialect only (it reads the file name's dialect, which the library doesn't have today: a parameter on the edit context). With tests on a `.qmd` fixture, taken from this study's probe | 35 |
| Q2 | Fences and tokens as atoms: an edit that touches a `:::` line, a closing fence, or a reference token widens to the div, the fence line's attribute block, or the token (§3.12), and never writes a marker in front of, inside or after on that line. Tests of every order of decisions on the probe's rows | 40 |
| Q3 | New and deleted divs: a typed callout or column is written with block openers on lines of their own, never on a fence line (and splits only between the body's paragraphs); spec §3.1 rule 9 and §9.4 say what is built. Includes the `~x~` and `^x^` guard it shares | 35 |
| Q4 | A `.qmd` fixture file in `docs/research/fixtures`, and a conformance test that every probe row reads alike in every order, for the later pandoc filter and the Quarto check to run | 20 |

**Phase 1: Quarto's own render (parallel with 0).**

| PR | What | Min |
| --- | --- | --- |
| Q5 | `scripts/quarto-check` and a doc of what it ran: marks pending vs accepted, html and docx and typst, knitr and jupyter engines, the include and shortcode probes. Run by a person with Quarto; its results go in this note | 40 |

**Phase 2: draw it in the editor.**

| PR | What | Min |
| --- | --- | --- |
| Q6 | Callouts in the editor on the alert's box: the kind from `.callout-*`, the title from `title=` or the first heading, fences folded while the caret is away; GitHub alerts' tint, the author's color for a pending type change; no per-kind colors (the labels are grays, as in Quick Look) | 40 |
| Q7 | Type and title menu of a Quarto callout: a block format change as a substitution of the fence's attribute block, markers outside the fences (needs Q2); `Paragraph › Callout` | 30 |
| Q8 | Chunk options as a header line over the code, and the fence's engine as a label, dimmed; the same text as in Quick Look | 25 |
| Q9 | Chips for shortcodes (`{{< name arg >}}`), cross-references and citations, from the scanner of Q1; a table of the file's labels from `{#…}` and `#| label:`; jump and hover | 40 |
| Q10 | Heading, caption and equation attributes dimmed; the other divs (columns, tabsets) as a margin bracket | 25 |

**Phase 3: includes.**

| PR | What | Min |
| --- | --- | --- |
| Q11 | After #915 merges: an include is a block that holds a shortcode alone on its line; no mark holds it (§3 rule, with tests of widening); a comment on it is a block mark | 35 |
| Q12 | The include block shows the file's name and the count of its pending changes (read from the file, read-only), opens it; a joined file (`--keep-md`) opens read-only with all its ledgers read as #915 reads them | 40 |

**Phase 4: Word.**

| PR | What | Min |
| --- | --- | --- |
| Q13 | `packages/word`: a `.qmd` exports chunks as code paragraphs with their options, a cross-reference as its typed text, a `{{< include >}}` as the included file's text (so the reviewer sees the whole), and divs as callout paragraphs with a style | 40 |
| Q14 | `importDocx`: a change that touches a code paragraph or a cross-reference is turned to a comment (widen, then alert); includes return to the part file they came from | 40 |

**Phase 5: Quarto and pandoc output (after the Quarto check has run).**

| PR | What | Min |
| --- | --- | --- |
| Q15 | The filter of §11 as a Quarto extension, finished (items 1 to 6 of §11), with the `redlines` option and tests on the fixture of Q4 | 40 |
| Q16 | Docs and the website: a page for Quarto users (`editor: source`, the extension, what Word gets) | 15 |
| Q17 | `redlines` CLI and the agent skill: how an agent edits a `.qmd` (the newest view; never inside a chunk's fence line; no reference token), with the skill's text rebuilt | 20 |

Lanes: Q1 first and alone; Q2, Q3 and Q5 in parallel after it; Phase 2 in parallel with Phase 3
once Q2 is in; Phase 4 and 5 last. About 9 hours of lane time, 3 to 4 elapsed.

## Open questions for Stephan

1. **Is `.qmd` a first-class file type for v1, or a "works, no drawing" one?** Phase 0 is needed
   either way (bugs against the spec); Phases 2 to 5 are the work of making it first-class.
2. **Callouts in the editor:** draw `.callout-*` with the same box as GitHub alerts (one design, the
   kinds' names the same five), or leave Quarto's the look of a plain block? The brief for Q6 assumes
   the first.
3. **Cross-references as chips:** chips look like links, and a number needs a table of labels. Is
   that worth Q9, or should the `@fig-x` text stay as typed and be dimmed only?
4. **Includes:** read-only inline preview of the included file in the including document, or only a
   block with a name, count and "Open"? The first is nicer to read and needs a second text in the
   editor.
5. **Word for a `.qmd`:** Redlines' export (code as code, no figures, importable) as the one
   route, with the pandoc filter as the extra for people who want Quarto's own document? Or should
   the rendered Quarto docx be the review copy, and its comments matched back by text?
6. **Quarto in CI:** a macOS or Linux job with Quarto installed would run Q5 on every PR to the
   format; the cost is its install time (a few hundred MB). Allow it, or keep the check manual?
