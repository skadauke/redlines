# The Quarto check

`apps/desktop/scripts/quarto-check.ts` is phase 1 of [the Quarto plan](quarto.md): it runs Quarto on
a `.qmd` that holds tracked changes, and tests what that note could only guess, because the machine
of the study had no Quarto. It is for a person (or the optional CI job) that has Quarto installed.

```sh
cd apps/desktop
node scripts/quarto-check.ts              # html, docx and typst; the engines that are installed
node scripts/quarto-check.ts --to html    # some formats
node scripts/quarto-check.ts --markdown   # the results as a table, for the note
node scripts/quarto-check.ts --keep       # leaves the files it made, and says where
```

Node 24 or later, which runs the TypeScript as it is. The exit code is 1 when a check failed, 0 when
all that ran passed (a skipped engine is no failure), and 2 when Quarto is not on the PATH.

## What it runs

The probe is a small `.qmd`: front matter, a heading with `{#sec-intro}`, a callout with a title, a
cross-reference, a chunk with a `#| label:` and a shortcode. The format library, in the pandoc dialect
(format §9.1), marks it up as an author would: an insertion and a substitution in the callout, a word
in the closing paragraph, a change inside the reference (which widens to the whole token), a change of
the callout's `title=` (which widens to the div), a change of the chunk's code (which replaces the
chunk whole), and a comment on the heading. Three files come out of it: the one with the changes
pending, the one with every change accepted, and the one with every change rejected. Each is rendered
to HTML, Word and Typst, with each engine that is there:

| Engine | Needs | A chunk |
| --- | --- | --- |
| markdown | nothing | a `text` block, not run |
| knitr | R with `knitr` | an `{r}` chunk, run |
| jupyter | Python with `jupyter_core`, `nbformat` and `yaml` | a `{python}` chunk, run |

The checks, for every format and engine:

1. **Pending renders as accepted.** The text of the file with the changes pending equals the text of
   the file with them accepted. The marks are HTML comments, which pandoc drops, so this is the claim
   that a marked-up file renders the newest version.
2. **Accepted differs from rejected.** A guard that the probe's changes show in the output at all.
3. **No marker or ledger text shows.** The output never says `redlines`.
4. **A changed chunk never runs its old code** (knitr and jupyter). The old code is in a payload
   with its backticks and `#|` escaped; if Quarto ran it, "old code" would be in the output.
5. **An include with pending changes** (markdown engine): a `{{< include _part.qmd >}}` of a file
   with a change pending renders as the same file with the change accepted: the included file's
   marks are comments to Quarto too. (Whether Quarto expands an include that stands inside a mark
   is not tested: no mark holds an include, which stands alone on its line.)

`src/quarto-check.node.test.ts` holds the part that needs no Quarto: the probe is marked at those
places, no marker stands on a fence line or inside the reference, and accept and reject give files
that differ.

## In CI

`.github/workflows/quarto.yml` installs a pinned Quarto and runs the check. It is optional, as decided
in #930: it runs on the open Epic branch's schedule and on pull requests that touch Quarto code
(`packages/format`, the check, the research fixtures), not on every pull request. It runs the markdown
engine only, since the runner has no R or Jupyter set up for it.

## Results

Not run yet: the machine where this was written has no Quarto. A person who runs
`node scripts/quarto-check.ts --markdown` puts the table here, with the version it printed.
