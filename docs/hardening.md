# How the format is kept sound

For contributors. It says what a Redlines file is built to hold, what holds each property, what is
known not to hold, and how to add a rule without loosening one. A draft of the page for readers and
adopters is [website-hardening-draft.md](website-hardening-draft.md).

A Redlines file is a Markdown file first. Its changes and comments are HTML comments in the text; a
ledger, one more HTML comment at the end, lists the people, each mark's author and time, the
comment threads and the settings; and a file that keeps its full history has a comment for each
save between the two ([format.md](format.md) §1.3). Anything that edits it, a keystroke, an agent, a
merge, has to leave a file that every Markdown reader still reads as the document it shows. That is
easy to promise and easy to break by a character: a marker in front of a line turns it into an HTML
block, a blank line turns a tight list loose, and a pending change that is decided in another order
reads another way.

## The four properties

What the format and the editor are built to hold, in one sentence each. They are what the tests try
to break, not a promise that nothing breaks: where a gap has been found it is listed under *What
isn't held*, and a gap is a bug.

1. **Every edit Redlines writes is meant to read the same in every order its pending changes can be
   decided in.** Each pending change can be accepted or rejected, some only once a neighbour is
   decided (a decision that would hide another change is refused, and says which to decide first:
   §2.1, §3.4); the words the file reads as must not depend on the order, and are judged by micromark
   4.0.2 with GFM tables and strikethrough, the oracle of the suites ([format.md](format.md) §12), and
   not by eye.
2. **Redlines is meant to refuse rather than repair, and a refusal says why.** An edit that no form
   can write soundly is refused, in words that name the cause and the way out ("This would change
   how Bo Chen's insertion reads. Decide it first, or turn off Track Changes."). A key that does
   nothing and says nothing is a bug.
3. **No line of a paragraph, heading, list item, quote, footnote or table row begins with a
   marker.** In CommonMark a line that starts with `<!--` starts an HTML block, which changes how
   the rest of the line reads, so a marker stays at the end of the previous line
   ([format.md](format.md) §3.2). Some markers stand alone on a line by design, each an HTML block
   that ends on that line: the opener of a mark that starts at a block's first character, on the
   line before the block, with the closers of the marks that end there in front of it (§3.3), and a
   closer after a closing fence (§3.2). And inside an HTML block's own content a marker may start a
   line (§3.5).
4. **A keystroke is meant to stay within twice what it cost before the block keys were written.**
   Typing, Return and Backspace, in a long document with many pending changes, may take at most
   twice what the same key took in the build that the numbers were recorded from (main at
   `4ca53fc`, where the keys were CodeMirror's own, inside Redlines' tracked layer), plus a
   millisecond for noise, on test documents of 16 KB and 150 KB with 200 changes, scaled to the
   machine by a calibration (`cost.test.ts`, below).

## What holds them

### The written rules, and the proofs that exist

`docs/format.md` holds every rule that places a marker, and the spec decides where code and spec
disagree. *Proved* is said only where it has a written argument, and there are two places. They are
arguments in prose, checked by review and by the suites below, not by a machine, and the spec
records one earlier shortcut in them that was "wrong on both counts" (§2.6):

- **§2.6, marks apart.** A format change is tried, before it is written, on the block it is in:
  every order of accepting and rejecting every mark there, the new marks and the others but those
  *apart* from it. A mark is apart when no decision can make it anything but words of its own
  paragraph: an insertion, deletion, substitution or highlight of text with no line break,
  backtick, `<`, `>`, backslash or `|`, on lines that start with a letter or a digit that no
  marker holds, and so on (the section has the whole condition). Marks apart stay pending and are
  neither tried nor counted; more than five marks to try (fewer in a long block) is refused, in
  words that go by the marks tried. The section has one argument for inline changes and a second for
  block changes in a list under review, and *what the proof doesn't give*: five shapes (three of
  numbered items, the open empty item, and a line the editor reads as an item that Markdown reads as
  more of the paragraph above, #139) keep their marks tried, and the change is refused for their
  count past five.
- **§3.7, cells apart.** A format change inside one table cell is checked against that cell's marks
  only.

The other rules are rules, and where they are built they are held by tests; the word for that here
is *tested*: §3.2 (line starts), §3.4 (block breaks, splits and joins), §3.5's rule 9 (content that
can't hold a marker, such as code, is changed whole, as a substitution with the old block as its
payload), and §3.7's agreement with micromark on what a table is. Not every rule is built: §3.1's
rule 9, no marker inside pandoc's `~x~` and `^x^`, is not (#370).

### The random suites: `packages/format/src`

`random-docs.ts` has the seeded generators: `randomDocument` (blocks with other people's insertions,
deletions, substitutions, comments and highlights, a ledger, front matter), `listDocument` and
`adjacentListsDocument` (plain words in the shapes lists take, with no marks), and `seeded` and
`fuzzCount`. The `*-random.test.ts` suites, and others, draw documents or tables from them or from
generators of their own, and each says in its header what it holds: usually that every order of
decisions reads alike, that all accepted is the newest view and all rejected the original; the table
suites and `first-prefix-random` also judge what is written by micromark's reading, and
`join-random`, which holds the join of an agent's edit to what the word form writes, does not. A
failure repeats from its seed. To try more:

```sh
REDLINES_FUZZ=300 pnpm exec vitest run packages/format/src/<suite>.test.ts   # more documents
REDLINES_SEED=<n> pnpm exec vitest run packages/format/src/table-cols-random.test.ts   # from one seed
```

`REDLINES_SEED` starts `table-cols-random`, `table-format-random`, `table-rows-random` and
`format-apart` at one seed.

The tables have a **pair model** besides: every pair of operations on rows and columns by two
people is decided in every order (`table-pairs.test.ts`, [format.md](format.md) §3.7).

### Differential runs against main

A change to how an edit is written is run by its reviewer against main on the same random documents,
and every decision where the two disagree is looked at. Those scripts are the reviewer's own, kept in
the reviewer's scratch folder and not in the repository (#276 says so of the probes it reports), and
CI runs the suites at their default counts only: the numbers are in the pull request, and are not
re-run. For the change that made a bold change, a row move and a typed edit read alike in every order
(#297), the review's differential covered 10,451 random documents with pending row moves, 571,930
single decisions: the branch refused 42 decisions that main wrote, and in every one of them main's
result read otherwise in some order, or reached a dead end.

### The block walks: `packages/editor/src/blocks`

`walk.test.ts` plays seeded walks of keys (Return, Backspace, Tab, typing, ⌘Z, an agent's edit, a
decision) from random places in the random documents, with Track Changes on and off. `script.ts` is
the harness: `runScript` plays a script on a real editor, through its keymaps, and
`invariantProblems` reads what no key may break from the result. A walk is held to the invariants
that its starting document holds: a hidden caret, an empty paragraph in the file, a stray blank
line, micromark's reading of the file against the newest view, structural warnings, more markers at
a line start than before, the order of decisions, Undo, the caret in an open empty paragraph, and
the history. A refusal is allowed in a walk, and a break of one of those is not, except in the seeds
that are skipped by name for known failures (46, 130 and 146 of the Tab walks: 46 and 130 are #258,
and 146 is named in the comment of `KNOWN_STAGE_1`) and in one form of Return that has a row of its
own. A script row (`scriptRows`, for the findings in `walk-seeds.test.ts` and the suites of keys) is
held further: to no refusal that it does not name, and to the rule that a skipped invariant that now
holds fails; and a script of a single Return must be taken back by Backspace. `REDLINES_FUZZ=200`
plays 200 walks of each kind; they run in Node's default heap since #286 was fixed (they had run out
of memory at that count), and take a few minutes. A walk that finds something becomes the smallest
script that shows it, in `walk-seeds.test.ts`, with the fix.

### The cost gates

`cost.test.ts` measures what the keys cost on a 16 KB and a 150 KB document with 200 marks, against
numbers recorded from main at `4ca53fc`, before `blocks/` existed, when the keys were CodeMirror's
own. The file's header says how: the same file runs in a checkout whose keys are CodeMirror's own,
with `REDLINES_COST=record`, which prints the numbers; on today's main it would measure the block
keys against themselves, and the file's imports are newer than that commit, so recording them again
means carrying the file back to a build like it. A key may take at most twice what that build's
took. `hidden.test.ts` holds the hidden lines' pass to a linear cost, and
`preview/long-document.test.ts` holds the drawing, and a keystroke, in long documents with deleted
blocks and tables to bounds that are a multiple of the markdown parse of the document alone.
`held()` retries a timing over its bound twice, with its yardstick timed again beside it, so that a
busy machine fails a bound only when it keeps failing. These run only with `REDLINES_COST=check`,
which CI's check job sets.

### The system WKWebView checks: `apps/desktop/src/*-check.ts`

happy-dom lays out nothing, and the app's page is drawn by WKWebView. The block keys, the tables,
deleted and replaced blocks, the Simple view, printing and zoom each have a check that runs in the
page (`block-check.ts`, `table-check.ts`, `struck-check.ts`, `simple-check.ts`, `print-check.ts`,
`zoom-check.ts`). `VITE_BLOCK_CHECK=1 pnpm dev` in `apps/desktop` serves one in a browser, and
`pnpm tauri dev` runs it in WKWebView; the block, table and struck checks end with a
`... done <n> passed, <n> failed` line. They are no part of CI and no step of
[releasing.md](releasing.md): they are run by hand, and the pull request says when. A layout,
selection or input-method problem is only found by running them, or by using the app.

### How changes have been reviewed

There is no written review policy; this is what the pull requests show. A change to how an edit is
written is reviewed by someone who did not write it, whose job is to break it: write probes against
main, mutate the code, run the suites at more draws. The findings are fixed in rounds, and each round
is re-reviewed on what it changed, and the pull request says what each round found. In #277, which
made keys next to backslashes and emphasis closers written where they had been refused, a review
found a window that read short of a far opener; its re-review found a widening into another person's
text and a Return case; two fix rounds and two re-reviews followed. The re-review's own probe of the
branch against main, judged by micromark in every order of decisions, ran 66,587 cases: none newly
wrong, 5,081 newly sound, 812 newly refused, and over 23,000 of main's wrong writes refused now. In
#288 (Tab in numbered lists under review, among other things), the new list-layout test of
`format-apart.test.ts` held every line that the reading of list items is sure is an item to
micromark 4.0.2's reading; it draws 4,000 layouts by default, and its checks ran it over 40,000.

## How to add a rule

1. **Write it in `docs/format.md`, with its argument.** Say where the marker goes, what each order of
   decisions reads, and what is refused and in what words. Where you can write a proof, write it;
   where you can't, say "tested" and name the suite. If the code and the spec disagree, the spec
   decides: change it deliberately.
2. **Make a random suite draw it.** Add the shape to a generator, or write a suite of its own, so that
   every order of decisions of what the new rule writes is tried, with other people's marks around
   it. A shape that no random document draws is a shape nothing has tested.
3. **Hold it to micromark.** The judge is micromark 4.0.2 with GFM, on the file and on every decision
   of it (`newestView`, `originalView`, `accept`, `reject`), and not your reading of the spec.
4. **Refuse where no form reads alike, and say why.** A refusal names the cause and the way out, and a
   test holds its words. Don't repair: a form that reads alike in most orders only is not a form.
5. **If it is a key, keep it cheap,** and add a row to the cost gate.
6. **If it is drawn or measured, add a check for WKWebView.**
7. **Have it reviewed** by someone who will try to break it.

## What isn't held

**Silent wrong writes, and changes that can't be decided, found so far.** Each is an open issue with
its case; each is a bug. The list is what has been found, not a count of what is there.

- Numbered lists: Backspace on `1. a⏎   - ‸plan⏎   2. ship`, and with Track Changes off Backspace at
  a first item above an item that a pending deletion empties; the walks of `walk-248.test.ts` fail
  four seeds at `REDLINES_FUZZ=2000` (#292).
- A prefix edit of a blank quote line between two paragraphs, flanked by other people's pending
  changes, is written without its line breaks (#358).
- Typing over one `*` of a pending bold's `**` reads otherwise than the views; the cells-apart suite
  skips micromark's reading for that shape (#299).
- A bold change on a line that rejecting a pending deletion makes a link definition reads otherwise in
  some orders (#335); typing at the end of a link reference definition with Track Changes on reads
  wrongly (#262).
- Rejecting a row move with a comment in the moved row puts the comment point in the wrong place
  (#371, found in a table with no pipe at its row starts).
- A highlight that runs from the text above a table into its header row can make another person's
  pending column change impossible to decide (#396).
- The format's checks read an indented numbered item or bullet under an item as a new item where
  CommonMark continues the paragraph, so a format change can be allowed that reads differently in some
  order (#139).
- The backslash and emphasis fixes leave five cases in one shape wrong, as on main, and refuse
  keys next to chains of another person's marks that main wrote (#276).
- Return at the start of a nested first item, tracked, fails in four more shapes, and the walks over
  lists side by side fail at 13 more seeds past 200 (#395).
- Failures of Stage 1's keys that the walks found are skipped by name (seeds 46, 130 and 146 of the
  Tab walks), and more are not drawn by the walks as they are (#258).
- Pandoc's `~x~` and `^x^` in `.qmd` and `.Rmd` files are not protected from markers: the reader has
  no file type yet (#370). `pre` and `title` inside a quote or a list item are not read as raw text,
  so markers can go in them (#284, [format.md](format.md) §3.5).
- Return at the end of a block, in two rare layouts, used to write a plain blank line that changes
  what renders (#136). It writes the break as two line breaks that read as one now, a stray blank
  line in the file that no reader sees, and the issue is still open.

**Refusals that are planned to go away.** Code that starts a list item, and indented code in an item
or a quote, are refused with Track Changes on (#284). Typing in code that holds another person's
pending code change is refused (#285): the issue asks for a form that reads alike in every order, or
a proof that none exists, with the refusal kept. Aligning a column with Track Changes on is refused
("Aligning a column with Track Changes on isn't ready yet. Turn off Track Changes to align it.",
#281). Bold over more than five cells of a table was one of them, and is not any more (#267).

**What the spec names.** [format.md](format.md) §13 lists what is not yet tested, among it Word
import into full history and live sessions with several authors in full history. §7 says what
merging gives: a conflict in the ledger is resolved by keeping both sides, with a stale entry that
is ignored and a duplicate handle that is renamed as the exceptions, and with plain git, parallel
work often conflicts there. §9 says what other tools do to the file: formatters that re-wrap prose
push markers to line starts, editors that rewrite the whole file when they open it push them there
too and loosen some tight lists, converting a file into a Google Doc drops every marker and the
ledger (every change is accepted and every comment lost), MDX can't compile the comments, and a
renderer that passes HTML through publishes the hidden text.

**What only the app can show.** Layout, the system's selection and input methods, and the animation
of a card are not in happy-dom; the WKWebView checks cover some of them, by hand.

**Timings on a loaded machine.** The cost gates compare with recorded numbers scaled by a calibration,
and a machine that is busy for a moment can still fail one. A failure that passes alone is noise,
and is reported as such, not skipped.
