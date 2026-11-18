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

## The five properties

What the format and the editor are built to hold, in one sentence each. They are what the tests try
to break, not a promise that nothing breaks: where a gap has been found it is listed under *What
isn't held*, and a gap is a bug.

1. **Every edit Redlines writes is meant to read the same in every order its pending changes can be
   decided in.** Each pending change can be accepted or rejected, some only once a neighbour is
   decided (a decision that would hide another change is refused, and says which to decide first:
   §2.1, §3.4); the words the file reads as must not depend on the order, and are judged by micromark
   4.0.2 with GFM tables and strikethrough, the oracle of the suites ([format.md](format.md) §12), and
   not by eye.
2. **Redlines is meant to widen rather than refuse, and ask before an untracked edit.** An edit that
   no fine form can write soundly is written as a replacement of the smallest unit that holds it,
   with other people's pending changes in its old text, or, where no unit can be written, made
   without tracking after the person is asked ([format.md](format.md) §3.12, §3.13). A refusal is
   kept only where every write would leave the file wrong (an unreadable ledger, forged markup, an
   agent's quote that is not there), in words that name the cause; one more is kept for now, where
   another person's mark ends at the unit's edge (the guard of #808 and #107, below). A key that
   does nothing and says nothing is a bug. `refusals.node.test.ts` holds it: every place in the sources that refuses an
   edit has a tier in `refusals.ts`, and a new one is a red test.
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
5. **Every state a session confirms is meant to be a file that reads as its newest view, with what
   each person wrote in it once, in their name, and the same in every copy.** Several people edit one
   file at once, through an authority or, in a simulation, with none. The check is the session
   oracle of `packages/collab-sim`, run over the editor's own writers (`real.ts`): at every confirmed
   state the markup and the ledger are valid and the body reads as the newest view does; no word is
   lost, swallowed, duplicated or misattributed; no edit is left untracked and nothing decided or
   deleted comes back; a decision moves only its own mark; every comment and reply is in the ledger
   once; every copy has the authority's text at every version. Nothing in it is a promise: the
   numbers are in [research/collaboration.md](research/collaboration.md#the-sessions-over-the-editors-own-writers),
   and the gaps under *What isn't held*.

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
payload), §3.1's rule 9 for pandoc's `~x~` and `^x^` (atoms in `.qmd` and `.Rmd` files, #370), and
§3.7's agreement with micromark on what a table is.

### The random suites: `packages/format/src`

`random-docs.ts` has the seeded generators: `randomDocument` (blocks with other people's insertions,
deletions, substitutions, comments and highlights, a ledger, front matter), `listDocument` and
`adjacentListsDocument` (plain words in the shapes lists take, with no marks), and `seeded` and
`fuzzCount`. `randomDocument` takes `dialect: 'pandoc'` for Quarto documents (divs and callouts, includes, code chunks, citations, cross-references, shortcodes, `~x~` and `^x^`); `pandoc-random.test.ts` edits, comments, highlights and decides over them and holds every construct pandoc reads by its own grammar whole (#220). The `*-random.test.ts` suites, and others, draw documents or tables from them or from
generators of their own, and each says in its header what it holds: usually that every order of
decisions reads alike, that all accepted is the newest view and all rejected the original; the table
suites and `first-prefix-random` also judge what is written by micromark's reading, and
`join-random`, which holds the join of an agent's edit to what the word form writes, does not. A
failure repeats from its seed. To try more:

```sh
REDLINES_FUZZ=300 pnpm exec vitest run packages/format/src/<suite>.test.ts   # more documents
REDLINES_SEED=<n> pnpm exec vitest run packages/format/src/table-cols-random.test.ts   # from one seed
```

A shared Mac can't hold a deep draw. `gh workflow run deep.yml --ref <branch>` (`-f fuzz=300`, and
`-f suites='<files>'` for some) runs every suite that reads `REDLINES_FUZZ` at that count, one job per
suite, on GitHub's runners (#586); nothing else runs it.

`REDLINES_SEED` starts `table-cols-random`, `table-format-random`, `table-rows-random` and
`format-apart` at one seed.

The tables have a **pair model** besides: every pair of operations on rows and columns by two
people is decided in every order (`table-pairs.test.ts`, [format.md](format.md) §3.7). A tracked
alignment change, one mark at the end of the header row, is among the operations (#281), and
`table-cols-random`, `table-format-random` and `table-rows-random` draw it with other people's
marks, rows and columns around it: every order of deciding it reads alike, and the pair model,
`table-cols-random` and `table-rows-random` fail on a decision of it that is refused.

### The session harness: `packages/collab-sim`

Seeded live sessions over the real format library, with an oracle that runs on every confirmed
state (the fifth property). `real.ts` derives each person's intent with the editor's own writers:
typing, deleting and replacing go through a headless editor's tracking filter, and formats,
comments, replies and decisions through `writeFormat`, `writeReview` and `guardDecision`.
`real.test.ts` holds, in CI, that on the text an intent was made on the editor writes what the
format library writes (byte for byte, but for ids when it widens an edit), and that sessions with an
authority and with none settle and converge. A deep run is off CI:

```sh
REDLINES_REAL=60 REDLINES_REAL_OUT=real.json pnpm exec vitest run packages/collab-sim/src/real.test.ts
```

### Differential runs against main

`packages/format/src/differential.node.test.ts` is the run kept in the repository for a change that
adds a writer and calls it nowhere: a digest of what the existing writers, decisions and views write
over a fixed corpus of random documents, which a branch must give as main does. R1's engine did
(150 documents, one digest).

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
a line start than before, the order of decisions, Undo, the caret in an open empty paragraph, the
history, and the file's text (`getDoc()` is the document with the open line taken back, each line
and the ledger once: #439; a file with a CR is left out of that one, since its line endings come
back as the file has them). A refusal is allowed in a walk, and a break of one of those is not, except in one
form of Return that has a row of its own (no seed of the Stage 2 walks is skipped by name now:
`KNOWN_STAGE_1`, which held seeds 46 and 130 of #258, is empty). `walk-248.test.ts` also skips 'list-reads' for a step that takes a character out of a list marker
with the caret inside the marker and Track Changes off (`editedMarker`, seed 1140 of #292, `3.‸ ship`
and Backspace): that is the person editing the syntax, the next numbered item reads as text of the
line as Markdown reads it, and the tracked key is refused. A key that takes a marker away from the
caret at an item's text, or an outdent, is held to it. A script row (`scriptRows`, for the findings in `walk-seeds.test.ts` and the suites of keys) is
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
took. `hidden.test.ts` holds the hidden lines' pass to a linear cost (4,000 lines of markers may
take at most eight times what 1,000 take: linear is four, quadratic sixteen), and
`preview/long-document.test.ts` holds the drawing, and a keystroke, in long documents with deleted
blocks and tables to bounds that are a multiple of the markdown parse of the document alone.
`held()` retries a timing over its bound twice, with its yardstick timed again beside it, so that a
busy machine fails a bound only when it keeps failing. Where a timing has a yardstick of the same
kind (the hidden lines' pass at two sizes; a key in code and a key in a paragraph of the same
document), the two take turns, so that a runner slowed for a few seconds slows both alike. A
yardstick of another kind tracks the timing less well on CI: a key in code varied by 19 % from run
to run against the markdown parse and by 11 % against a key in a paragraph. These run only with
`REDLINES_COST=check` (AGENTS.md says when CI sets it).

### The system WKWebView checks: `apps/desktop/src/*-check.ts`

happy-dom lays out nothing, and the app's page is drawn by WKWebView. The block keys, the tables,
deleted and replaced blocks, the Simple view, printing, zoom, the toolbar and Ask, and one document in
two windows each have a check that runs in the page (`block-check.ts`, `table-check.ts`,
`struck-check.ts`, `simple-check.ts`, `print-check.ts`, `zoom-check.ts`, `palette-check.ts`,
`sync-check.ts`). `VITE_BLOCK_CHECK=1 pnpm dev` in `apps/desktop` serves one in a browser, and
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
4. **Widen where no form reads alike.** The edit is a replacement of the unit that holds it
   (`widen.ts`), not a refusal, and a form that reads alike in most orders only is not a form. Don't
   add a refusal: `refusals.node.test.ts` fails on one with no tier.
5. **If it is a key, keep it cheap,** and add a row to the cost gate.
6. **If it is drawn or measured, add a check for WKWebView.**
7. **Have it reviewed** by someone who will try to break it.

## What isn't held

**Silent wrong writes, and changes that can't be decided, found so far.** Each is an open issue with
its case; each is a bug. The list is what has been found, not a count of what is there.

- A raw line break typed at the start of a bullet item's text under a line of text is written as a
  replacement of its unit where that reads alike in the file and the view, and is otherwise an alert
  (#443, #1098). Left: typing before a deletion that empties a bullet.
- The editor's parse reads a numbered line (other than 1) or an empty marker right under a list item
  as a lazy line of the item's paragraph, where CommonMark reads a list. Backspace at the first
  item of a list now reads the line below it as the file does (`ownLines` in `blocks/joins.ts`) and
  writes the blank line that keeps it apart (#446); the keys of Return, Tab and Shift-Tab read such
  a line as the text it is since #600 (format §3.2). Left: at the first line of the file with Track
  Changes on the key still refuses, since the format has no place for the blank line next to the
  marker's deletion (#291).
- The last check (`selfCheck`) compares letters and digits, and where the edit takes no line break
  away, where the line breaks fall among them: a line break that an edit lost between lines of
  digits or markers is seen (#418). A deletion inside a blank line of a break, and a replacement
  inside the blank line of the break of the author's own pending split, are written as a
  substitution that keeps the break, so that every order of decisions reads as typed (#447, #419).
- A highlight that runs from the text above a table into its header row can make another person's
  pending column change impossible to decide (#396).
- The backslash and emphasis fixes leave five cases in one shape wrong, as on main, and refuse
  keys next to chains of another person's marks that main wrote (#276).
- Return at the start of a nested first item, tracked, fails in four more shapes, and the walks over
  lists side by side fail at 13 more seeds past 200 (#395).
- The walks of Stage 1's keys skip no seed by name now, and some shapes of them are still not drawn
  by the walks as they are (#258).
- `pre` and `title` inside a quote or a list item are not read as raw text, so markers can go in them
  ([format.md](format.md) §3.5).

**The guard: the refusal that widening keeps (#808, #107).** The engine that replaces refusals
(`widen.ts`, format §3.12) is called by the writers for tables (#657, #863), lists (#797), blocks
(#813) and code (#810), and an edit that no unit can hold, or that is in front matter or in Plain, is
asked about before it is made untracked (#714, #730, format §3.13). A replacement's old text may hold
another person's pending marks: they stay in the payload, and every order of accepting and rejecting
them and the replacement reads alike (the random suites hold it: `widen-random.test.ts`,
`block-widen.test.ts`, `typing-order.test.ts`, the walks, and `agent-probe.test.ts`, which counts the
edits that stay refused). The first guard of #808 refused every such replacement; the failures it
was made for (typing-order seeds 12 and 27, the block move of `walk.test.ts`) were in the harness,
which decided only the marks that were in the file at the start, not the marks that a decision frees
(`sampleDecisions` of `blocks/script.ts`); with that fixed, no order of decisions fails.
One refusal is kept on purpose. When another person's mark ends at the unit's edge without being in
it (a split's break right in front of the unit, an insertion right after it), `widen` reports it
(`touchingOthers`) and the writers (`edits-widen.ts`, `table-widen.ts`) keep the refusal the fine writer had: that
mark is decided with the block next to it, and a heading typed after another person's split, in an
insertion of its own, would read `## xbeta` in one order and `xbeta` in another (#107). Before that
refusal applies, the block beside the unit is tried, which holds the split in the old text of one
substitution (across a quote's blank `>` line too, and as the whole quote in an item), and that is
what typing and a block change after a split write. What is left is a cost, not a hole: the edit is
not written, so nothing is silently wrong. In the probe of random edits that the fine writer
refuses (`agent-probe.test.ts`), about 146 of 285 were held by the first guard and 58 are by this one. The tests that pin it say `(#107)` in
their comments (`issues.test.ts`, `code-substitution.test.ts`). Also not held:

- A unit of more than eight top-level blocks (`WIDEN_MOST_BLOCKS`) is not written; the edit is asked
  about and made untracked, and in an embed with no asker a table operation that no tracked write
  holds is made untracked without a question, where typing refuses (#863).
- With `REDLINES_FUZZ=400`, a whole-table deletion beside a pending move or comment can still end
  with "a marker would be left alone on its line" (the random table test names it; #863).
- A join onto a setext heading inside a list or quote is still refused (`SETEXT_JOIN`, tiered `widen` in `refusals.ts`, so it is a gap, not a policy): the block's
  replacement does not read right there yet (#813). The caret after a widened join onto a setext
  heading is one character off in rare numbered joins.
- A widened table cell format leaves the selection in the old text (`hidden-caret`, skipped in
  `cells-marks.test.ts` with the reason; #657).

`refusals.ts` says which of the refusals in the sources is widened, asked about, disabled or kept,
and the test that holds it fails on a new one. What is not held of the engine itself: a replacement
is found by a reader of lines that knows quotes, items, fences, indented code, raw text and tables,
and not every Markdown form (a table that interrupts a paragraph, display math with a blank line in
it, setext headings in a container; HTML blocks of types 1 to 5 in `widen-units.ts`); where its gate
(the views, the shape of the lists, the two decisions of the replacement) does not catch what
micromark reads otherwise, the random suites are what does (`widen-random.test.ts`,
`widen-pairs.test.ts`, `payload-marks.test.ts`, and `list-widen.test.ts`, `block-widen.test.ts` and
the table suites through `expectWidened` in `oracle.ts`: every edit that the fine form refuses is
written, reads alike in every order, and rejects back).

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
