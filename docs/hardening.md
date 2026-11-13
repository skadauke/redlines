# How the format is kept sound

For contributors. It says what a Redlines file promises, what holds each promise, and how to add a
rule without loosening one. The page for readers and adopters has its own draft
([website-hardening-draft.md](website-hardening-draft.md)).

A Redlines file is a Markdown file first. Its changes and comments are HTML comments in the text,
and its people and history are a block at the end ([format.md](format.md) §1). Anything that edits
it, a keystroke, an agent, a merge, has to leave a file that every Markdown reader still reads as
the document it shows. That is easy to promise and easy to break by a character: a marker in front
of a line turns it into an HTML block, a blank line turns a tight list loose, and a pending change
that is decided in another order reads another way.

## The guarantees

One sentence each. A change that breaks one is a bug, whether or not a test says so.

1. **Every edit Redlines allows reads the same in every order the pending changes could be decided
   in.** Each change can be accepted or rejected, in any order; every order gives the same text,
   and the text is judged exactly, by micromark 4.0.2 with GFM tables and strikethrough, the oracle
   of the suites ([format.md](format.md) §12). "Close" is not a pass, and a reading by eye is not
   a judge.
2. **Redlines refuses rather than repairs, and a refusal always says why.** An edit that no form
   can write soundly is refused, in words that name the cause and the way out ("This would change
   how Bo Chen's insertion reads. Decide it first, or turn off Track Changes."). A key that does
   nothing and says nothing is a bug.
3. **No marker starts a line.** In CommonMark a line that starts with `<!--` starts an HTML block,
   which changes how the rest of the line reads. A marker stays at the end of the previous line
   ([format.md](format.md) §3.2).
4. **A keystroke costs what it does on main.** Typing, Return and Backspace, in a long document
   with many pending changes, may take at most twice what the same key takes in main's own build,
   plus a millisecond for noise, on the machine that runs the test (`cost.test.ts`, below).

## What holds them

### The rules and their proofs: `docs/format.md`

Every rule that places a marker is written in `docs/format.md` with its argument, and the spec
decides where code and spec disagree. The places to read first:

- **§2.6, format changes.** The rule of *marks apart* (an inline change is tried against the marks
  that can't change how its line reads, and not against every pending mark) comes with a written
  proof, a second one for block changes in a list under review, and a section called *What the
  proof doesn't give*: the shapes that are still tried one mark at a time, and the ones that are
  refused, with the count and the reason.
- **§3.2, line starts.** The rule behind guarantee 3.
- **§3.4, block breaks, splits and joins.** A block break is text, and a deletion may contain it.
- **§3.5, atomic content, rule 9.** Content that can't hold a marker (code, display math,
  raw-text HTML) is changed whole, as a substitution with the old block as its payload.
- **§3.7, tables.** The reader agrees with micromark 4.0.2 with GFM tables on what a table is, and
  every allowed edit to a table's text is judged by how its cells read.

*Proved* means that one of those sections has the argument. Everywhere else the word is *tested*,
and the next sections say by what.

### The random suites: `packages/format/src`

`random-docs.ts` makes seeded documents that hold every kind of mark by other people
(`randomDocument`, `listDocument`, `adjacentListsDocument`). The `*-random.test.ts` suites (code
substitutions, first prefixes, joins, table columns, table format changes, table rows) and most of
the other suites of the package draw from it and hold what they write to guarantee 1. A failure
repeats from its seed. To try more:

```sh
REDLINES_FUZZ=5000 pnpm exec vitest run packages/format/src/<suite>.test.ts   # more documents
REDLINES_SEED=2027 pnpm exec vitest run packages/format/src/table-cols-random.test.ts   # from one seed
```

The tables have a **pair model** besides: every pair of operations on rows and columns by two
people is decided in every order (`table-pairs.test.ts`, [format.md](format.md) §3.7).

### Differential runs against main

A change to how an edit is written is run against main on the same random documents, and every
decision where the two disagree is looked at. This is done by the reviewer, in the review, and its
numbers are in the pull request. For the one that made a bold change, a row move and a typed edit
read alike in every order (#297), the review's differential covered 10,451 random documents with
pending row moves, 571,930 single decisions: the branch refused 42 decisions that main wrote, and in
every one of them main's result read otherwise in some order, or reached a dead end.

### The block walks: `packages/editor/src/blocks`

`walk.test.ts` plays seeded walks of keys (Return, Backspace, Tab, typing, ⌘Z, an agent's edit, a
decision) from random places in the random documents, with Track Changes on and off. `script.ts` is
the harness: `runScript` plays a script on a real editor, through its keymaps, and
`invariantProblems` holds the result to what no key may break: a hidden caret, an empty paragraph
in the file, a marker at a line's start, a refusal no one expected, a file whose decisions read
differently in different orders, a Return that Backspace can't take back, a step that Undo can't
take back. A refusal is allowed; nothing else is. `REDLINES_FUZZ=200` plays 200 walks of each kind
in the default heap (about 200 s). A walk that finds something becomes the smallest script that
shows it, in `walk-seeds.test.ts`, with the fix.

### The cost gates

`cost.test.ts` measures what the keys cost on a 16 KB and a 150 KB document with 200 marks, against
numbers recorded from main's own build (the same file runs in a checkout of main with
`REDLINES_COST=record`). A key may take at most twice what main's takes. `hidden.test.ts` holds the
hidden lines' pass to a linear cost, and `preview/long-document.test.ts` the long document's.
`held()` retries a timing over its bound twice, with its yardstick timed again beside it, so that a
busy machine fails a bound only when it keeps failing. These run only with `REDLINES_COST=check`,
which CI's check job sets.

### The system WKWebView checks: `apps/desktop/src/*-check.ts`

happy-dom lays out nothing, and the app's page is drawn by WKWebView. The block keys, the tables,
deleted and replaced blocks, the Simple view, printing and zoom each have a check that runs in the
page (`block-check.ts`, `table-check.ts`, `struck-check.ts`, `simple-check.ts`, `print-check.ts`,
`zoom-check.ts`). `VITE_BLOCK_CHECK=1 pnpm dev` in `apps/desktop` serves one in a browser, and
`pnpm tauri dev` runs it in WKWebView; each ends with a `done <n> passed, <n> failed` line. They are
no part of CI: they are run by hand, in the sweep before a release, and a layout, selection or
input-method problem is only found there.

### How a change is reviewed

A change to how an edit is written is reviewed by someone who did not write it, whose job is to
break it: write probes against main, mutate the code, run the suites at more draws. The findings
are fixed in rounds, and each round is re-reviewed on what it changed. The pull request says what
each round found. In #277, which made keys next to backslashes and emphasis closers written where
they had been refused, a review found a window that read short of a far opener; its re-review found
a widening into another person's text and a Return case; two fix rounds and two re-reviews
followed. The re-review's own probe of the branch against main, judged by micromark in every order
of decisions, ran 66,587 cases: none newly wrong, 5,081 newly sound, 812 newly refused, and over
23,000 of main's wrong writes refused now. In #288, which made list layouts sound, a new test held
every line that the reading calls an item to micromark's reading over 40,000 layouts.

## How to add a rule

1. **Write it in `docs/format.md`, with its argument.** Say where the marker goes, what each
   order of decisions reads, and what is refused and in what words. Where you can prove it, write
   the proof; where you can't, say "tested" and name the suite. If the code and the spec
   disagree, the spec decides: change it deliberately.
2. **Make a random suite draw it.** Add the shape to the generator, or a suite of its own, so
   that every order of decisions of what the new rule writes is tried, with other people's marks
   around it. A shape that no random document draws is a shape nothing has tested.
3. **Hold it to micromark.** The judge is micromark 4.0.2 with GFM, on the file and on every
   decision of it (`newestView`, `originalView`, `accept`, `reject`), and not your reading of the
   spec.
4. **Refuse where no form reads alike, and say why.** A refusal names the cause and the way out,
   and a test holds its words. Don't repair: a form that reads alike only in most orders is not a
   form.
5. **If it is a key, keep it cheap**, and add a row to the cost gate.
6. **If it is drawn or measured, add a check for WKWebView.**
7. **Have it reviewed** by someone who will try to break it.

## What isn't held

- **The gaps the spec names.** [format.md](format.md) §13 lists what is not yet tested (among them
  Word import into full history, and live sessions with several authors in full history), and §2.6's
  *What the proof doesn't give* lists the numbered-list shapes that are tried or refused. A block
  change in a list under review with more than five changes pending is refused for their count.
- **Refusals that are planned to go away.** Aligning a column with Track Changes on (#281); code
  that starts a list item, and indented code in an item or a quote (#284); typing in code that holds
  another person's pending code change (#285). Each is refused today, in words that say so.
- **What only the app can show.** Layout, the system's selection and input methods, and the
  animation of a card are not in happy-dom; the WKWebView checks cover some and the sweep the rest.
- **Timings on a loaded machine.** The cost gates compare with main's numbers scaled by a
  calibration, and a machine that is busy for a moment can still fail one. A failure that passes
  alone is noise, and is reported as such, not skipped.
