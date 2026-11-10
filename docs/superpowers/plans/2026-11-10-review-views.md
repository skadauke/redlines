# Reading a Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An agent's rewrite is one change; a Simple view reads a review as accepted, with change bars that switch to Redlines on a click; a deleted or rewritten block reads as a block, old above new.

**Architecture:** The joining rule is a pure module in `@redlines/format` that turns the word comparison of a `str_replace` into fewer, longer hunks, written only when the result reads exactly as asked, else as today. Simple is a fourth `ViewMode` drawn by the tracked layer as Redlines with every change's look off; a core plugin turns a click on a change bar into a view switch; the review plugin decides nothing in Simple. Struck blocks and old-above-new substitutions are drawn by the tracked layer's block widgets and the table widget.

**Tech Stack:** TypeScript (strict), CodeMirror 6, `@redlines/format` (micromark 4.0.2 as the oracle), vitest with happy-dom, Tauri v2 menus (muda), Rust only for the `redlines` program's bundle. pnpm is `npx -y pnpm@10.28.0`, git is `/usr/bin/git`.

**Spec:** [docs/superpowers/specs/2026-11-10-review-views-design.md](../specs/2026-11-10-review-views-design.md) ("the design" below; read it first, every "Call:" in it is decided), with [docs/format.md](../../format.md) as the source of truth for `packages/format`. The builder check that fed it is not in the repo; its three questions are answered under "Rulings" below. Paths and line numbers are main's at `68e93aa`.

## Sequencing: read this before any task

1. **Block editing's Stage 1 lands first** ([2026-11-10-block-editing.md](2026-11-10-block-editing.md), on main). It changes `packages/editor/src/tracked/decorations.ts`, `packages/editor/src/preview/decorations.ts`, `packages/editor/src/preview/table.ts`, `packages/editor/src/preview/theme.ts` and `plugins/themes/src/tokens.css`: blank lines between blocks become hidden lines, and spacing is drawn by block kind (its Tasks 1.9 and 1.10). **This plan is written against main as it is today.** A task marked **[block-editing files]** touches one of those files: its implementer reads the file as it is when the task starts, re-reads the task's line pointers against it, and keeps the task's tests and interfaces, not its line numbers. Stage 3 depends on it most: struck blocks are drawn "where the blank lines were", and their spacing is the block kind's own.
2. **The agents-undo plan runs beside this one** ([2026-11-10-agents-undo-and-allow.md](2026-11-10-agents-undo-and-allow.md), on main). It makes each agent edit a history step: the tool computes the whole new text with `suggestReplace`, and `Editor.applyAgentEdit(next, step)` brings it in as one diffed step whose ⌘Z gives back the text before, byte for byte. **The joining rule meets it at one point and needs nothing from it:** the join, the check and the fallback all happen inside `suggestReplace` (Task 1.5), before `next` exists, so a step holds either the joined form or the word form, never both, and one `str_replace` is one step whichever form it took. Undo and Redo of a rewritten paragraph give the bytes of the file before and after, because both are texts the format wrote. The joined form changes the step's size, not its meaning: one substitution where there were many marks, so the step's caret (the start of its first change in the body, moved out of hidden text) lands at the start of the paragraph, which Redlines draws as the old text and Clean and Simple do not. Nothing in either plan has to wait for the other. Task 3.3 carries one test that needs both; if the agents-undo Stage 2 has not merged when it is reached, add the test to that plan's `agent-edit.test.ts` when it does, and say so in the PR.
3. Stages 1 and 2 touch different packages and may be built side by side; Stage 3 needs Stage 1 merged (its whole-text substitutions), and Stage 2's bar switch for the click on a struck block's bar.

## Rulings (the "Call:"s that this plan adds to the design)

- **Call: the joining rule is the prototype's, exactly.** The prototype (`consolidate.ts`, kept outside the repo; the dispatch gives its folder) is the form that was checked on 1,660 random edits and that produced the Examples table. Its three open readings are settled by its code: (a) **"no more words than either change has"** is `words(unchanged) <= min(size(left), size(right))`, where a change's size is `max(words of its old text, words of its new text)`, a tie joins, a change made by an earlier join counts the words it took in, and the scan restarts from the first change after every join; (b) **text pulled into a join counts as changed**, not unchanged, for the "fewer than half" test, because the whole-block test runs on the runs rule 1 left; (c) **"alike"** means both sides: `2 * kept < oldWords` and `2 * kept < newWords`, strictly, with at least one word on each side. Reason: it is the form that was measured. The Examples table's counts (28 to 1, 6 to 2, 9 to 4, and 3 to 2) are tests (Tasks 1.2, 1.3).
- **Call: the prototype's guards stand where the design's prose differed.** Markers are looked for in the unchanged text that would be taken in, not in text the agent asked to change; `+` is in the list of characters plain text lacks; a line prefix anywhere in the edit's old text keeps it from being replaced whole (so an old text that quotes a bullet or a wrapped item's indentation joins but is not replaced whole). The design is amended to say so. Reason: measured, and the exact check backs the rest.
- **Call: the prototype treats an edit's old text as one block; the plan judges it block by block** (design: "Several blocks in one edit"), by cutting the runs at unchanged text that holds a block break, and treating a change that holds a break as a barrier (Task 1.4). Reason: the design requires it, and the prototype's random test could not exercise it, so Task 1.6 adds multi-block edits to the random test.
- **Call: a rewritten table cell, in Redlines, is drawn as a rewritten paragraph is:** the old text struck above the new, inside the same cell (Task 3.4). `packages/editor/src/preview/table.ts` joins the design's module table. Reason: a cell is a block; one rule for what a rewrite looks like.
- **Call: no decision is made in Simple.** A note's Accept or Reject, in Simple, switches to Redlines and shows the change, selected and in view, without deciding it. While the review bar is open the view stays Redlines, and a click on a change bar opens that change's card instead of switching; choosing Simple from the menu or by key closes the review bar. One function (`decideSuggestion` in `plugins/review/src/shared.ts`) holds the rule, so the review bar's own buttons obey it too (Task 2.5). Reason: the design's anti-goal "deciding blind".
- **Call: the core gets a facet of bar-click handlers** (`barClickHandlers`), because the core owns the click and must not know the review bar; the review plugin adds a handler. Reason: embedded editors have the click with no plugin, and the review bar is the plugin's.
- **Call: the first task of Stage 1 re-runs the prototype on current main** (Task 1.1), because main gained refusals for markers in indented code (#153) since the design's baseline `4de60b1`. Re-run for this plan at `68e93aa`: the same counts, 1,660 edits, 1,351 written today, 1,432 with the rule, 0 new refusals, 0 wrong, 329 with fewer marks, 2,148 marks today against 1,673. The task re-checks them on the tree the implementer has.

## Global Constraints

- Node >=22 and pnpm 10.28.0: run pnpm as `npx -y pnpm@10.28.0`, git as `/usr/bin/git`; prefix cargo and tauri commands with `PATH=/opt/homebrew/opt/rustup/bin:$PATH`. The shell is zsh: quote globs.
- In a new worktree: `npx -y pnpm@10.28.0 install`, then `scripts/build-redlines` in `apps/desktop` before any cargo (AGENTS.md). Rebuild it after any change to `packages/format` or `packages/cli` before the Rust tests.
- TypeScript as `tsconfig.base.json` sets it (strict, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `erasableSyntaxOnly`: no enums, namespaces or parameter properties); `import type` for types. Prettier: width 100, single quotes. Tests are `src/**/*.test.ts` beside the code; `// @vitest-environment happy-dom` for a DOM; a desktop test that needs Node's types is `*.node.test.ts`.
- Every task ends green: `npx -y pnpm@10.28.0 typecheck && npx -y pnpm@10.28.0 lint && npx -y pnpm@10.28.0 test && npx -y pnpm@10.28.0 format:check` (the "gate"; `npx -y pnpm@10.28.0 format` fixes formatting).
- `docs/format.md` is the source of truth for `packages/format`. The file format does not change: a joined change is a substitution, a deletion or an insertion at the places format §3 gives them.
- **An agent's edit that works today is never refused or written differently**, and a keystroke costs what it costs on main: the joining rule runs only on an agent's edit; Simple adds a condition or two per mark to `analyze` and nothing per keystroke elsewhere.
- A person's typing is never joined. Another person's pending words are never credited to an agent. Simple hides how a line changed, never that it did. A click on a change bar never moves the text under the pointer, the caret or the selection. Nothing is decided where its old text is not shown.
- Color means a person (design §6.6): bars keep their author's color, gray (`--rl-mixed`) for several. Struck text keeps its full contrast. No new chrome: no toolbar, mode switch, badge or second margin.
- Interface text takes `var(--rl-size-ui-scaled)` or `var(--rl-size-ui-small-scaled)`, never a size in em or % and never under 13 px or 12 px (`apps/desktop/src/interface-text.node.test.ts` checks every style source). Interface words use the typographic apostrophe.
- Never mention any other Markdown editor as a model or reference, in code, comments, docs, commits, PRs or issues.
- Commit messages are "Area: what changed" and end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; PR bodies end with the generated-with line. Merge a PR when no critical issue is open; file what is out of scope as issues.

## Review Focus

Failure modes the design implies and no table row exercises, most likely first; each has its test in the named task.

1. **A paragraph an agent rewrites that holds another person's pending insertion, deletion or a comment on part of it.** The rewrite never takes in their words: their marks keep ids, kinds, authors and text, and the thread stays where it was. Test: Task 1.5, and the random test of Task 1.6.
2. **A wrapped paragraph in a CRLF file, rewritten.** The joined change spans the line breaks, the new text's line breaks are the file's (`\r\n`), and rejecting gives every byte back. Test: Task 1.5.
3. **A click on a change bar that is also on the edge of a selection, with the editor unfocused, or on a bar beside a wrapped line.** Nothing moves: selection, caret, focus and the line's height on screen stay (to the pixel in the measure), and a press that moves or carries a modifier does what a press in the margin did. Test: Task 2.3.
4. **Accept or Reject of a one-change rewrite while the view is Simple, from the note and from the review bar's buttons.** Nothing is decided; the view is Redlines, the change selected and in view. Test: Task 2.5.
5. **A deleted paragraph at the very end of a document, one between two list items, and one beside a hidden blank line** (after block editing's Stage 1). It is a struck block of its own in the right place, the caret never lands in it, and its bar and card work. Test: Tasks 3.2, 3.5.

---

# Stage 1: One change for a rewrite (#184)

All in `packages/format`, plus the tool's description, the skill, and the docs. The PR is worth having alone: an agent's rewrite is one entry in the ledger, one Accept in the app, one `w:del` and `w:ins` in Word export. Branch `v0.3/review-views-join`.

### Task 1.1: Re-run the prototype on current main

**Files:**
- Read: the prototype's folder, outside the repo at the path the dispatch gives (`consolidate.ts`, `real.ts`, `count.ts`, `fuzz2.ts`; their imports point at `packages/format/src`; reference, not code to ship)

**Interfaces:** Produces: the baseline numbers the PR description quotes and Tasks 1.2 to 1.6 compare against. No code.

- [ ] **Step 1: Install and build.** `npx -y pnpm@10.28.0 install --frozen-lockfile` in the worktree. Node runs the `.ts` files as they are.
- [ ] **Step 2: Run the real paragraphs.** From the prototype folder: `node real.ts` and `node count.ts`. Expected, on `68e93aa`: `copy edit (light)` today 3, joined 2; `tighten` 6, 2; `rewrite` 28, 1; `bullet` 9, 4; `two fixes far apart` 2, 2; `sentence added` 1, 1; and `count.ts` prints `today 28 { sub: 25, ins: 2, del: 1 }` then `rule 1 [ 'sub' ]`.
- [ ] **Step 3: Run the random test.** `node fuzz2.ts 4000`. Expected on `68e93aa`: `tried: 1660, today: 1351, rule: 1432, newRefusals: 0, wrong: 0, orderMismatch: 0, ordersChecked: 1419, marksToday: 2148, marksRule: 1673`, `fellBack 0`, `fewer 329`.
- [ ] **Step 4: Compare.** If a number differs on the tree you have (main moved again: `/usr/bin/git log --oneline 68e93aa..HEAD -- packages/format`), work out why before going on: a `newRefusals` above 0 or a `wrong` above 0 means a guard is missing for something main now refuses or reads otherwise, and the rule of Task 1.2 to 1.4 must grow it; fewer written edits than today is the same failure. Put the numbers in the PR description.
- [ ] **Step 5: Commit** nothing if the numbers match; else a one-line note in the PR description. (The prototype folder is committed with this plan.)

### Task 1.2: Rule 1, changes close together are one

**Files:**
- Create: `packages/format/src/join.ts`
- Test: `packages/format/src/join.test.ts`
- Modify: `packages/format/src/track.ts` (export `LINE_PREFIX` at about line 2967; it is the prototype's pattern byte for byte)

**Interfaces:**
- Consumes: `wordHunks`-style tokens: the `TOKEN` pattern in `agent.ts` (move it, with `tokens`, `compare` and `Hunk`, into `join.ts` or export them from `agent.ts`; `agent.ts` keeps `wordHunks`, `uniqueMatch` and `suggestReplace*`, and its public behavior does not change).
- Produces, in `join.ts`:

```ts
/** What the join needs to know about the file around the old text, as offsets of the old text. */
export interface JoinGuards {
  /** Whether a marker stands in the source behind old-text offsets [from, to) (unchanged text only). */
  plain(from: number, to: number): boolean;
}
/** A run of tokens: unchanged (old equals new) or one change. */
export interface Run { equal: boolean; old: string[]; new: string[] }
export function runsOf(before: string, after: string): Run[];
export function wordsIn(tokens: readonly string[]): number;       // tokens of letters, digits, marks, `_`
export function joinable(unchanged: string): boolean;             // "plain" text, below
export function prefixSpans(before: string): [number, number][];  // per line of `before`, via LINE_PREFIX
export function joinRuns(runs: Run[], before: string, guards: JoinGuards): Run[];
```

- [ ] **Step 1: Write the failing tests** in `join.test.ts` (the paragraphs are the prototype's `real.ts` strings, copied into the test; hunks are counted from `runsOf` and `joinRuns` with `guards.plain` always true):
  - `it('joins the middle of "quick brown -> fast red, fox, jumps -> leaps"')`: the unchanged "fox" (1 word) between a 2-word change and a 1-word change joins (1 <= min(2, 1)): one change.
  - `it('keeps two one-word fixes with two words between them apart')`: 2 > min(1, 1), two changes.
  - `it('joins on a tie')`: one unchanged word between two one-word changes joins.
  - `it('counts a change by the larger of its sides')`: a 3-word to 1-word change and a 1-word change around 2 unchanged words: 2 <= min(3, 1) fails, not joined; around 1 word, joined. (This pins "the smaller of the two", with a change's own size the larger of its sides.)
  - `it('counts the words a join took in when it looks at the next join')`: three changes in a row joined left to right where the second join is allowed only because the first one grew the left change.
  - `it('does not join over syntax, a blank line, a line that starts a block or a prefix')`: unchanged text `` `x` ``, `**b**`, `[a](b)`, `a + b`, `\n\n`, `\n- `, `\n1. ` is not joinable; a change that overlaps a prefix span of the old text (a bullet, `> `, `## `, indentation) is never joined, either side.
  - `it('does not join over a marker')`: `guards.plain` false for the unchanged text keeps the two changes apart.
  - `it('makes 3 marks of the light copy edit 2, 6 of the tightened sentence 2 and 9 of the bullet 4')`: with the strings of `real.ts` (`copy edit (light)`, `tighten`, `bullet`): the counts of changed runs after `joinRuns` are 2, 2 and 4, and before it 3, 6 and 9.
- [ ] **Step 2: Run them.** `npx -y pnpm@10.28.0 vitest run packages/format/src/join.test.ts`. Expected: FAIL, `join.ts` has no such exports.
- [ ] **Step 3: Implement** the functions above as the prototype's `runs`, `words`, `joinable`, `prefixSpans` and `joinRuns` do (`consolidate.ts`): `joinable` is false when the unchanged text holds one of `` * _ ` ~ [ ] ( ) < > # | \ ! = + ^ { } $ & @ ``, a blank line (`\n[ \t]*\n`), or a line that starts a block (`\n[ \t]*(?:[-*+>#|]|\d+[.)])`); `joinRuns` scans for an unchanged run between two changes, joins when `joinable`, neither neighbor touches a prefix span (a span `[a, b)` touches a change at old-text offset `start` with length `len` when `start < b && a < start + max(len, 1)`), `guards.plain` holds for the unchanged text, and `words(unchanged) <= min(size(left), size(right))`; the merged change's old and new tokens include the unchanged tokens; it restarts from the first change after each join until nothing joins.
- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Commit.** `Format: changes close together in an agent's edit are one (#184)`

### Task 1.3: Rule 2, a block rewritten is replaced whole

**Files:**
- Modify: `packages/format/src/join.ts`
- Test: `packages/format/src/join.test.ts`

**Interfaces:**
- Consumes: Task 1.2's `Run`, `joinRuns`, `wordsIn`, `joinable`, `prefixSpans`, `JoinGuards`.
- Produces: `export function joinedHunks(before: string, after: string, guards: JoinGuards): Hunk[]` — `runsOf`, then `joinRuns`, then `wholeBlock`, then hunks (`from`/`to` are offsets in `before`, `insert` is the new text); with no unchanged run it is one hunk, as `wordHunks` gives today.

- [ ] **Step 1: Write the failing tests.**
  - `it('replaces the rewritten design §8.6 paragraph whole: 28 hunks become 1')` (strings of `count.ts`; also `wordHunks(...)` of the same pair has 28 hunks, so the test pins both numbers): one hunk `{ from: 0, to: before.length, insert: after }`.
  - `it('replaces the importer sentence whole: 3 of 18 words survive')` (the design's example: "The importer reads every file in the folder and writes one record for each line it finds there." to "The importer reads each file once and writes a record per line."): one hunk over the whole text.
  - `it('counts text a join took in as changed')`: a pair that keeps 2 of 10 words when joins are ignored but whose kept words are taken into a join: replaced whole, while a pair keeping exactly half (`2 * kept < old` false) is not.
  - `it('needs fewer than half on both sides')`: a sentence deleted from a paragraph (the new text keeps all its words, old has more) and a sentence added are not replaced whole (`two fixes`, `sentence deleted`, `sentence added` of `real.ts` and `try.ts`'s `del-sentence` keep their hunks); a pair with no word on one side is not replaced whole.
  - `it('does not replace whole over syntax or a prefix')`: kept words inside `**bold**` or a link; an old text that starts with `- ` or `## ` or has an indented second line: joins at most, never one hunk over everything.
  - `it('does not replace whole over a marker in text it would take in')`: `guards.plain` false for a kept stretch.
  - `it('leaves a light edit with a hunk per phrase')`: `in March` to `in April`, one hunk of the word.
- [ ] **Step 2: Run them.** Expected: FAIL, `joinedHunks` is not exported.
- [ ] **Step 3: Implement** `wholeBlock` and `joinedHunks` as the prototype's: `oldWords` and `newWords` count all words of the runs left by rule 1, `kept` the words of its unchanged runs; whole when both counts are above 0, `kept * 2 < oldWords`, `kept * 2 < newWords`, every remaining unchanged run `joinable` and `guards.plain`, and `prefixSpans(before)` touches nothing (`touchesPrefix(0, before.length)` is false).
- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Commit.** `Format: a block that keeps fewer than half of its words is replaced whole (#184)`

### Task 1.4: Block by block, and a break is a barrier

**Files:**
- Modify: `packages/format/src/join.ts`
- Test: `packages/format/src/join.test.ts`

**Interfaces:**
- Consumes: `Run`, `joinRuns`, `wholeBlock` (Task 1.3).
- Produces: `joinedHunks` judges blocks: `blocksOf(runs: Run[]): Run[][]` (internal; exported for the test) cuts the run list at each unchanged run that holds a block break (a blank line, or a line that starts a block per `joinable`'s patterns, or a `|` of a line that starts with `|`): the part of that run before its first break joins the block before, the part after its last break the block after, and the middle belongs to no block and stays unchanged. A **barrier**: a change whose old or new text holds a block break (a paragraph split or two joined) is in no join and ends both blocks beside it; the blocks on either side are compared as today (their changes stay as `runsOf` made them, joined by rule 1 only away from the barrier).

- [ ] **Step 1: Write the failing tests.**
  - `it('judges two paragraphs of one edit separately')`: paragraph one rewritten (replaced whole), paragraph two untouched, a blank line between: one hunk over paragraph one only; the reverse; both rewritten: two hunks, never one across the blank line.
  - `it('does the same for two list items, a heading and its paragraph, two table cells')`: the cut at `\n- `, `\n\n`, `|`.
  - `it('keeps a split paragraph apart')`: a change that adds `\n\n` is not joined with the changes beside it, and the blocks beside it are not replaced whole.
  - `it('leaves an unchanged separator run unchanged')`: the blank line between the two blocks is in no hunk.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement** `blocksOf`, the barrier, and `joinedHunks` applying rule 2 per block, concatenating each block's runs back in order before the hunks are taken. A one-block edit behaves exactly as Task 1.3 (the tests of 1.3 still pass).
- [ ] **Step 4: Run them.** Expected: PASS, with Task 1.2 and 1.3's tests.
- [ ] **Step 5: Commit.** `Format: an agent's edit is joined block by block (#184)`

### Task 1.5: `suggestReplace` writes the joined form, or as today

**Files:**
- Modify: `packages/format/src/agent.ts` (`suggestReplace` at about line 182), `packages/format/src/edit-support.ts` (export `paragraphBreaks`, at about line 567)
- Test: `packages/format/src/agent.test.ts`

**Interfaces:**
- Consumes: `joinedHunks`, `JoinGuards` (Tasks 1.2 to 1.4); `trackedEdits`, `newestView`, `originalView`, `applyChanges`, `parse`; `paragraphBreaks(view: string): string` (now exported).
- Produces: `suggestReplace(text, oldStr, newStr, ctx): TrackedEdits` with the same signature. It builds the `JoinGuards` from the newest view and the parse (`plain(from, to)` is true when the source behind `view.map.toSource(start + from, -1)` to `toSource(start + to, 1)` holds no `<!--`, as the prototype's `setPlain` does; also false when any segment of `parsed.marks` has an opener, carrier or closer inside), writes `trackedEdits` for the joined hunks, applies the result, and **keeps it only when** `paragraphBreaks(newestView(out).text) === paragraphBreaks(intended)` (the newest text with `oldStr` replaced by `newStr` at the match) and `originalView(out).text === originalView(text).text` byte for byte. On an `EditError`, or when the check fails, it writes `wordHunks` as today, and when that is refused the error is the agent's, as today. `suggestReplaceAsOne` does not change.

- [ ] **Step 1: Write the failing tests** (`agent.test.ts`; each file is checked with `expectInOrder` and `expectEveryDecision` against the file before the edit; accepting gives the asked text, rejecting the original bytes):
  - `it('writes a rewritten paragraph as one substitution')`: the importer sentence in a one-line document: `markIds.length === 1`, a `sub` mark; the file is `<!--sub k3x9 …old…-->\n\nnew<!--/k3x9-->` in the form of format §3.3 (the design's second code block); `suggestReplaceAsOne` gives it no `group`.
  - `it('keeps a light edit as marks per phrase')`: `in March`/`in April` is 1 mark; the light copy edit is 2; two far fixes are 2; a sentence deleted, a sentence added are 1 each.
  - `it('replaces a heading, an item, a quote and a cell whole, in the forms of format §3.3')`: opener after the `#`s, after the bullet with the text on the next line, after the `> `, inside the pipes. (Old text quoted without the prefix, as an agent quotes a paragraph's text.)
  - `it('never joins across blocks')`: two items, two paragraphs, a heading and its paragraph, two cells: a mark per block.
  - `it('never joins over a prefix')`: a list number changed is written as today.
  - `it('never joins or replaces over another person's pending words')` (Review Focus 1): their insertion and their deletion in the stretch keep their ids, kinds, authors and text; the agent's own pending change in the stretch is not joined over, and an edit inside it changes it in place as today; a comment on part of the paragraph stops joins at its markers; a comment on the whole paragraph (opener on its own line before it, closer after it) gets one substitution inside its range and the thread still on it.
  - `it('never joins over syntax')`: bold, a link, code.
  - `it('joins across the line breaks of a wrapped paragraph, in the file's line breaks')` (Review Focus 2): LF and CRLF files; rejecting gives the bytes back.
  - `it('falls back to the word marks when the joined form is refused or reads otherwise')`: an edit whose joined form `trackedEdits` refuses (a case found by Task 1.6 if none is known; write it with a stub guard that lies about `plain`), and one that today's form refuses and the rule writes (a prototype case; Task 1.1 names one if the random run finds it).
  - In `agent.test.ts`, the tests that pin word marks today ("marks each changed word, so that a reviewer can accept part of a rewrite", "keeps punctuation, line breaks and words apart") keep their purpose with edits whose changes stand far apart (more than a changed word's worth of words between them).
- [ ] **Step 2: Run them.** `npx -y pnpm@10.28.0 vitest run packages/format/src/agent.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** as the Interfaces say. The check costs two views; a refused joined form costs one more `trackedEdits`.
- [ ] **Step 4: Run the whole package.** `npx -y pnpm@10.28.0 vitest run packages/format` then the gate. Expected: PASS (if the indented-code tests of #153 fail, the join is crossing a code line: tighten `plain`, do not weaken the test).
- [ ] **Step 5: Commit.** `Format: an agent's rewrite is written as one change when it reads as asked (#184)`

### Task 1.6: The random test

**Files:**
- Create: `packages/format/src/join-random.test.ts`
- Read: the prototype's `fuzz2.ts` (the edit generator), `packages/format/src/random-docs.ts` (`randomDocument`, `seeded`, `fuzzCount`), `test-helpers.ts` (`expectEveryDecision`, `expectEveryOrderAlike`, `expectInOrder`)

**Interfaces:**
- Consumes: `suggestReplace` (Task 1.5), `wordHunks` (`agent.ts`).

- [ ] **Step 1: Write the test** `it('writes every edit that today's form writes, as asked, and gives back every byte')` with `fuzzCount(…)` seeds: for each seeded `randomDocument`, a random stretch of one line of its newest text rewritten at a random density (as `fuzz2.ts` does); and `it('does the same for edits of several blocks')`: the stretch spans a blank line, a list item break or a table row, and the new text rewrites a random subset of its blocks, adds a block break or takes one away. For each: when `wordHunks`' form is written (`trackedEdits` on its edits does not throw), so is `suggestReplace`'s; the newest view reads as asked by `paragraphBreaks`; the original view is the original's bytes; `rejectAll` gives the original back; `expectEveryDecision` against the document before the edit, with the edit's marks as the fresh ones; `expectEveryOrderAlike` where the file has few enough marks to walk (their `limit`); every mark another person had keeps its id, kind, author and text; and the marks of the rule are never more than today's.
- [ ] **Step 2: Run it.** `npx -y pnpm@10.28.0 vitest run packages/format/src/join-random.test.ts`. Expected: PASS at the default count; run it once with `REDLINES_FUZZ=4000` (the 4,000 documents of Task 1.1) and expect the Task 1.1 numbers for the single-block part. A failure is a missing guard: fix the rule, not the test, and keep the failing seed as a named case in `agent.test.ts`.
- [ ] **Step 3: Commit.** `Format: a random test for the joining of an agent's edit (#184)`

### Task 1.7: The tool, the skill, the program, the docs

**Files:**
- Modify: `packages/agent-tools/src/tools.ts` (the `str_replace` description), `integrations/claude-code/SKILL.md` (the `str-replace` sentence), `docs/format.md` (new §3.11 after §3.10; one sentence in §3.6 pointing at it), `docs/design.md` (§8.3: the `str_replace` row and the bullet "Marks are word by word…"; the rest of the design's "Changes to design.md" for Stage 1 only)
- Test: `packages/agent-tools/src/tools.test.ts`, `apps/desktop/redlines/tests/commands.rs`

**Interfaces:** Consumes: Task 1.5. Produces: the description string, exactly: "Replace text in this document with a tracked change in your name. old_str must match the newest text exactly once. Only the words that differ are recorded; changes close together are one, and a paragraph mostly rewritten is replaced whole." and §3.11 as the design's "Changes to design.md and format.md" gives it, with the rule written as the Rulings above settle it (the smaller of the two changes; text taken into a join counts as changed; both sides under half; `+` in the list of plain characters).

- [ ] **Step 1: Write the failing tests.** `tools.test.ts`: `it('reports a rewritten paragraph as one change')`: the tool's result is "Suggested 1 change: …" for the importer sentence; the description test checks the string. `commands.rs`: `str_replace_of_a_rewritten_paragraph_prints_one_change` runs the real `redlines str-replace` on a file with the importer sentence and checks one id on the output line and one mark in `redlines marks` (or the program's own listing).
- [ ] **Step 2: Run them.** `npx -y pnpm@10.28.0 vitest run packages/agent-tools`; in `apps/desktop`, `scripts/build-redlines` then in `apps/desktop/redlines` `PATH=/opt/homebrew/opt/rustup/bin:$PATH cargo test`. Expected: FAIL.
- [ ] **Step 3: Implement** the description, the SKILL sentence, and the docs. `docs/format.md` §3.11 includes the three sentences the design quotes ("The marks of one such edit share a `group`…").
- [ ] **Step 4: Run** the gate, the Rust commands (`cargo clippy --all-targets -- -D warnings`, `cargo test` in `apps/desktop/redlines`). Expected: PASS.
- [ ] **Step 5: Commit.** `Agents: the tool, the skill and the docs say a rewrite is one change (#184)`

**STAGE 1 ENDS HERE. Open the PR (closes #184, refs #181), with Task 1.1's numbers in its description; review; merge before Stage 3.**

---

# Stage 2: Simple (#182)

The view, its drawing, the click in the margin, the markup view kept, the rail, the menus and keys, print. Branch `v0.3/review-views-simple`. Worth having alone: a reading view for any review, whoever made the changes.

### Task 2.1: The view and the markup view in the editor core

**Files:**
- Modify: `packages/editor/src/api.ts` (`ViewMode` at line 10; `EditorOptions`; `EditorUiState`), `packages/editor/src/tracked/field.ts` (`viewModeField` at about line 100), `packages/editor/src/index.ts`
- Test: `packages/editor/src/tracked/tracked.test.ts` (or `field.test.ts` beside `field.ts` if the tracked tests grow past reading)

**Interfaces:**
- Produces, in `api.ts`: `type ViewMode = 'clean' | 'simple' | 'redlines' | 'raw'`; `type MarkupView = 'simple' | 'redlines'`; `EditorOptions.markupView?: MarkupView` (default `'redlines'`); `EditorUiState.markupView: MarkupView`. In `field.ts`: `export const markupViewFacet: Facet<MarkupView, MarkupView>`. In `index.ts`: a `markupViewCompartment` beside `lineBreakMarksCompartment`; `setViewMode(mode)` documents that choosing Simple or Redlines makes it the markup view; `uiFor` reports `markupView`, and reporting follows a change of view.
- Behavior: `viewModeField.create` starts a document with redlines in the markup view; a document shown Clean that gains redlines switches to the markup view; `setDoc` keeps the markup view; an automatic switch uses `state.facet(markupViewFacet)` where `'redlines'` is written today (Task 2.4 changes the callers).

- [ ] **Step 1: Write the failing tests:** `it('opens a document with redlines in the markup view')` for both values of `markupView`; `it('switches a Clean document that gains redlines to the markup view')`; `it('keeps the markup view across setDoc')`; `it('makes Simple or Redlines, when chosen, the markup view and reports it')` (`getUiState().markupView`, and `onUiChange` fires); `it('does not change the markup view when Clean or Raw is chosen')`.
- [ ] **Step 2: Run them.** `npx -y pnpm@10.28.0 vitest run packages/editor/src/tracked`. Expected: FAIL.
- [ ] **Step 3: Implement** as the Interfaces say; exhaustive `switch`es on `ViewMode` across the repo get a `'simple'` arm that typecheck points at (Task 2.2 draws it; here it may fall through to Redlines' arm).
- [ ] **Step 4: Run** the gate. Expected: PASS.
- [ ] **Step 5: Commit.** `Editor: Simple is a fourth view, and the markup view you chose last is kept (#182)`

### Task 2.2: Simple's drawing **[block-editing files]**

**Files:**
- Modify: `packages/editor/src/tracked/decorations.ts` (`analyze` from about line 148; the `rl-bar` styles at about line 883), the preview layer's per-view classes (`packages/editor/src/preview/decorations.ts`, `theme.ts`) only as far as `rl-view-simple` needs them
- Test: `packages/editor/src/tracked/tracked.test.ts`, `packages/editor/src/preview/long-document.test.ts`

**Interfaces:**
- Consumes: `ViewMode` with `'simple'` (Task 2.1). Produces: in Simple the editor's content has the class `rl-view-simple`; `analyze` draws Simple as Redlines with every change's look off: deleted text and splits are parts with `className: ''` and `change: true` (a bar and no drawing, the kind the layer has for a break while marks are hidden); insertions and format changes are layers that count for bars and add no mark decoration; comments, highlights and pins as in Redlines; ordinary HTML comments hidden as in Clean; the caret's atoms are Clean's; `bars()` does not change.

> The implementer reads `decorations.ts`, `preview/decorations.ts`, `theme.ts` and `tokens.css` as they are after block editing's Stage 1 (hidden blank lines, spacing by kind) before editing, and keeps the tests, not the line numbers.

- [ ] **Step 1: Write the failing tests** (`tracked.test.ts`): `it('draws no .rl-ins, .rl-del, .rl-fmt, .rl-split or .rl-comment in Simple')`; `it('draws comment tints and pins in Simple, as in Redlines')` (`.rl-cmt`, `.rl-cmt-point`); `it('puts the same bar classes on the same lines in Simple as in Redlines, for every kind of change')` (an insertion, a deletion alone on a line, a substitution, a split, a move, a format change, a block change, a checked box; the table rows too); `it('shows the text Clean shows, and has Clean's atoms')` (visible text equal, `atomicRanges` equal); `it('hides ordinary HTML comments and line break marks in Simple')`. In `long-document.test.ts`: the 16 KB and 150 KB documents in Simple hold the bound they hold in Redlines.
- [ ] **Step 2: Run them.** `npx -y pnpm@10.28.0 vitest run packages/editor`. Expected: FAIL.
- [ ] **Step 3: Implement** as the Interfaces say; one added condition or two per mark in `analyze`, nothing new per keystroke.
- [ ] **Step 4: Run** the gate. Expected: PASS.
- [ ] **Step 5: Commit.** `Editor: Simple reads as accepted, with change bars and comments (#182)`

### Task 2.3: The click in the margin **[block-editing files]** (its styles join `decorations.ts`' base theme)

**Files:**
- Create: `packages/editor/src/tracked/bar-switch.ts`
- Modify: `packages/editor/src/index.ts` (the extension joins the core), `packages/editor/src/tracked/decorations.ts` (`.rl-bar-hot` style: the bar 3 px wide, a hand cursor)
- Test: `packages/editor/src/tracked/bar-switch.test.ts`

**Interfaces:**
- Consumes: `setViewModeEffect`, the `markupViewFacet` (Task 2.1), `viewModeField`.
- Produces, in `bar-switch.ts`:

```ts
/** Handlers asked, in order, when a bar is clicked; the first to return true has handled it. */
export const barClickHandlers: Facet<(view: EditorView, pos: number) => boolean>;
export function barSwitch(): Extension;  // a ViewPlugin: mousedown, mousemove, mouseleave on view.scrollDOM
```

  A target is 24 px wide, centered on the bar, the full height of the line (wrapped lines included), found by `view.posAtCoords` at the content's left edge and a check for the `rl-bar` class (a struck block of Stage 3 carries it too). A press and release that moves less than 4 px with no ⌘, ⌥, ⇧ or ⌃ asks the handlers, and when none handles it switches Simple to Redlines and Redlines to Simple (`setViewModeEffect`, and the markup view), noting the line's distance from the scroller's top and putting it back in a `requestMeasure` (read the new distance, write `scrollTop`; a line the new view doesn't draw gives its place to the line after it). The press doesn't start a selection (`preventDefault` on the press only when it lands on a target) and the release doesn't move the caret, the selection or the focus. The second click of a double-click does nothing. The hovered line gets `rl-bar-hot` through a decoration from the plugin; the hint is a CodeMirror tooltip at the line styled as the review bar's hints: "Show Redlines ⌥⌘3" in Simple, "Show Simple ⌥⌘2" in Redlines. In Clean and Raw nothing is attached.

- [ ] **Step 1: Write the failing tests** (`bar-switch.test.ts`, happy-dom, with a stub layout since happy-dom lays out nothing: pass `view.posAtCoords` and the line's rectangle through the plugin's injected measure functions):
  - `it('switches Simple to Redlines and back on a click on a bar's target')`.
  - `it('keeps the line under the pointer where it was')`: the measure's `scrollTop` write restores the distance after the switch, within 1 px, for a line below ones that grew; and a deleted-only line in Simple gives its place to the next.
  - `it('moves no selection, caret or focus')` (Review Focus 3): selection, `view.hasFocus`, `document.activeElement` identical after, with the editor focused and unfocused, and with a selection edge at the bar's line.
  - `it('does nothing for a press that moves 5 px, a press with a modifier, a press beside a line with no bar, a press in Clean or Raw')` — the modified press and the beside press do what a press in the margin did (a selection starts), asserted by the lack of `preventDefault`.
  - `it('switches once on a double-click')`.
  - `it('asks the handlers first, and switches only when none handles it')`.
  - `it('puts rl-bar-hot and the hint on the hovered bar and takes them away on leave')`; the hint's text per view.
- [ ] **Step 2: Run them.** `npx -y pnpm@10.28.0 vitest run packages/editor/src/tracked/bar-switch.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `barSwitch` and the style; the hint's delay is the title bar's (read it from the title bar's hint code in `apps/desktop`, or pass it in as an option with that default).
- [ ] **Step 4: Run** the gate. Expected: PASS.
- [ ] **Step 5: Commit.** `Editor: a click on a change bar switches Simple and Redlines (#182)`

### Task 2.4: Automatic switches take the markup view

**Files:**
- Modify: `packages/editor/src/tracked/typing.ts` (about lines 536 and 703), `plugins/formatting/src/index.ts` (about line 213), `plugins/review/src/rail.ts` (about lines 548 `startComment` and 814 `giveBack`)
- Test: `packages/editor/src/tracked/typing.test.ts`, `plugins/formatting/src/index.test.ts`, `plugins/review/src/rail.test.ts`, `plugins/review/src/drafts.test.ts`

**Interfaces:** Consumes: `markupViewFacet`. The review bar's `opening` in `plugins/review/src/bar.ts` keeps `'redlines'` and is not touched here.

- [ ] **Step 1: Write the failing tests:** a tracked edit in Clean, a format change in Clean, a comment added in Clean, and drafts coming back to a document shown Clean switch to the markup view (both values); a tracked edit in Simple stays in Simple; in `rail.ts`, `startComment` and `giveBack` switch Clean only (they switch any view but Redlines today, which would pull Simple back); the review bar opened from Simple switches to Redlines (`bar.test.ts`, existing behavior pinned).
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement:** `setViewModeEffect.of(state.facet(markupViewFacet))` where `'redlines'` is written; `startComment` and `giveBack` test for `'clean'` only; the first-change path in `typing.ts` (`trackedSpec`, composition) the same.
- [ ] **Step 4: Run** the gate. Expected: PASS.
- [ ] **Step 5: Commit.** `Editor: tracked changes made in Clean show in the markup view (#182)`

### Task 2.5: The rail, the cards and the review bar in Simple, and no decision there

**Files:**
- Modify: `plugins/review/src/rail.ts` (`sync` and `shown`, about line 605), `plugins/review/src/shared.ts` (`decideSuggestion` at about line 58), `plugins/review/src/bar.ts` (`opening`, `decide`, the view-mode listener), `plugins/review/src/cards.ts` (`pin`, about line 248; an export for the bar-click handler), `plugins/review/src/index.ts` (adds the bar-click handler to the core's facet)
- Test: `plugins/review/src/rail.test.ts`, `plugins/review/src/cards.test.ts`, `plugins/review/src/bar.test.ts`, `plugins/review/src/suggestion.test.ts`

**Interfaces:**
- Consumes: `barClickHandlers` (Task 2.3), `markupViewFacet`.
- Produces: `decideSuggestion(ctx: ReviewContext, how: 'accept' | 'reject', id: string): boolean` — returns `false` and decides nothing when the view is Simple: it dispatches a switch to Redlines with the suggestion's marks selected (`EditorSelection.range(spanOf(first).from, spanOf(last).to)`) and `EditorView.scrollIntoView(range, { y: 'center' })`, as the review bar's `select` does but without opening the bar; otherwise decides and returns `true`. A new `pinCard(view: EditorView, id: string): void` in `cards.ts`. The review plugin's bar-click handler: when the review bar is open (`isBarOpen`), pins the card of the change under the pointer and returns `true`; else `false`. A listener that closes the review bar when the view becomes Simple (`closeBar`).

- [ ] **Step 1: Write the failing tests:** `rail.test.ts`: `it('shows the rail in Simple, notes of noted suggestions included, and dots when narrow')`; `it('selects a suggestion's note in Simple and tints its changed text')`; `it('does not decide in Simple: Accept and Reject on a note show the change in Redlines, selected and in view')` (Review Focus 4: for a one-change rewrite, the document text is unchanged, the view is `'redlines'`, the selection spans the mark, the effect list holds `scrollIntoView`; the same for Reject); `suggestion.test.ts`: `decideSuggestion` returns false in Simple and true in Redlines. `cards.test.ts`: `it('shows no card on hover and pins none on a click in Simple')`. `bar.test.ts`: `it('opens in Redlines from Simple and stays Redlines while open')`; `it('opens the card of the change instead of switching, when a bar is clicked with the review bar open')` (through the facet); `it('closes the review bar when Simple is chosen')`; `it('leaves the view as it is when it closes')` (existing).
- [ ] **Step 2: Run them.** `npx -y pnpm@10.28.0 vitest run plugins/review`. Expected: FAIL.
- [ ] **Step 3: Implement** as the Interfaces say. The rail's `act(() => decideSuggestion(...))` callers (about lines 1020 and 1025) need no change; a `false` return skips their post-decision work.
- [ ] **Step 4: Run** the gate. Expected: PASS.
- [ ] **Step 5: Commit.** `Review: the rail shows in Simple, and Accept and Reject there show the change instead of deciding it (#182)`

### Task 2.6: The menus, the keys, the setting, print

**Files:**
- Modify: `apps/desktop/src/menu-model.ts` (the view rows, about line 325), `apps/desktop/src/ui/titlebar.ts` (about line 194), `apps/desktop/src/ui/icons.ts`, `apps/desktop/src/settings.ts`, `apps/desktop/src/main.ts`, `apps/desktop/src/styles.css` (print rules); the Rust menu side only if the model is mirrored there (`grep -n "redlines" apps/desktop/src-tauri/src`)
- Test: `apps/desktop/src/menu-model.test.ts`, `apps/desktop/src/ui/titlebar.test.ts`, `apps/desktop/src/settings.test.ts`, `apps/desktop/src/styles.node.test.ts`

**Interfaces:**
- Produces: four view rows, Clean ⌥⌘1, Simple ⌥⌘2, Redlines ⌥⌘3, Raw ⌥⌘4, as radio items with a check mark, in the View menu and the title bar's eye; icons `simple` (today's `redlines` line icon) and a new `redlines` (Simple's with one mark of markup on it, a line icon on the 16 x 16 grid that reads at 16 px); `settings.markupView: MarkupView` default `'redlines'`, kept like `showResolved`, passed to each editor as `EditorOptions.markupView` and saved when `EditorUiState.markupView` changes, reaching every window for the documents each opens next but never changing the view a window shows; in the print rules `.rl-bar::before` drawn as a 2 px left border in its color (`--rl-mixed` for several people).

- [ ] **Step 1: Write the failing tests:** the View menu and the eye list four views in order with their keys; the key table has no duplicate; `settings`: the default, the way it is kept and read back, and that a change in one window reaches a settings change event for the others but sets no view; `styles.node.test.ts`: the print rules draw `.rl-bar::before` as a border (and `--rl-mixed` for `.rl-bar-mixed`).
- [ ] **Step 2: Run them.** `npx -y pnpm@10.28.0 vitest run apps/desktop`. Expected: FAIL.
- [ ] **Step 3: Implement,** and draw the icon.
- [ ] **Step 4: Run** the gate, and `PATH=/opt/homebrew/opt/rustup/bin:$PATH cargo clippy --all-targets -- -D warnings` and `cargo test` in `apps/desktop/src-tauri` if Rust changed.
- [ ] **Step 5: Commit.** `Desktop: four views on ⌥⌘1 to ⌥⌘4, the markup view kept, bars that print (#182)`

### Task 2.7: Design notes for Simple, and the hand check

**Files:**
- Modify: `docs/design.md` (§5.1, §5.3 renamed "Views: Clean, Simple, Redlines, Raw", §5.5 change bars sentence, §5.6, §5.7, §5.9, §5.10, §6.3, §6.4, §14 question 6), as the design's "Changes to design.md and format.md" lists them, plus one sentence in §5.6 and §5.7: "Accept and Reject on a note in Simple show the change in Redlines; nothing is decided where its old text is hidden."

- [ ] **Step 1: Make the edits** (the design's wording).
- [ ] **Step 2: Build the app** (`pnpm tauri build --bundles app` in `apps/desktop`) and try by hand, writing what you saw in the PR: the click on a bar with a trackpad and a mouse, near and away from the text; a long agent rewrite read in Simple, then Redlines; printing in Simple; Accept on a note in Simple.
- [ ] **Step 3: Run** the gate.
- [ ] **Step 4: Commit.** `Docs: Simple in the design (#182)`

**STAGE 2 ENDS HERE. Open the PR (closes #182, refs #181); review; merge.**

---

# Stage 3: Deleted and replaced blocks (#183)

Needs Stage 1 merged and block editing's Stage 1 merged. Branch `v0.3/review-views-blocks`. Worth having alone: a deleted paragraph reads as one, and a rewritten paragraph or cell as the old above the new.

### Task 3.1: `deletedBlocks` in the format library

**Files:**
- Create: `packages/format/src/deleted-blocks.ts` (or add to `blocks.ts`; the builder's call, design "Left to the builder")
- Modify: `packages/format/src/index.ts` (export)
- Test: `packages/format/src/deleted-blocks.test.ts`

**Interfaces:**
- Consumes: `Segment`, `Parsed`, `blockEdges`, `prefixLength` (`blocks.ts`), format §3.4's forms.
- Produces:

```ts
export type DeletedBlockKind =
  | { kind: 'paragraph' } | { kind: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6 }
  | { kind: 'item'; marker: string } | { kind: 'quote' } | { kind: 'other' };
export interface DeletedBlock { kind: DeletedBlockKind; text: string }
/** The blocks a whole-block deletion's payload holds, or null when it isn't whole blocks: a payload that ends with the break at the start of the block after it, or starts with one at the end of the text. */
export function deletedBlocks(segment: Segment): DeletedBlock[] | null;
```

- [ ] **Step 1: Write the failing tests:** a deleted paragraph, a heading (`## `, level 2), an item (`- `, `1. `), a quote, code, a table, a rule each give their kind and text with the prefix in the kind; several blocks give several; a payload ending with the break at the start of the block after it, and one starting with one at the end of the text, are whole; a deletion that runs from the middle of one block into another is `null`; a deletion of part of a paragraph is `null`; someone else's change inside a deleted block (format §3.4) leaves the blocks as they are.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement** `deletedBlocks`.
- [ ] **Step 4: Run** the gate. Expected: PASS.
- [ ] **Step 5: Commit.** `Format: deletedBlocks reads the blocks a whole-block deletion holds (#183)`

### Task 3.2: A deleted block is drawn as a block **[block-editing files]**

**Files:**
- Modify: `packages/editor/src/tracked/decorations.ts` (`hideMarkerLines`; the widget class), `packages/editor/src/preview/theme.ts` and `plugins/themes/src/tokens.css` only to reuse the block kinds' classes and spacing (`rl-h2`, `rl-quote`, an item's indentation), `packages/editor/src/tracked/field.ts` if block decorations need the `StateField` route
- Test: `packages/editor/src/tracked/tracked.test.ts`

**Interfaces:**
- Consumes: `deletedBlocks` (Task 3.1). Produces: in Redlines, `hideMarkerLines` replaces the hidden lines of a whole-block deletion with `Decoration.replace({ block: true, widget })` drawing its blocks, each carrying `data-mark` (the mark's id), the bar's classes (`rl-bar` and the author's color) and the line classes the preview gives that kind of block; at the end of the text, `Decoration.widget({ block: true, side: 1 })` after the line above. Text is drawn as deleted text is: Markdown characters, line breaks inside as spaces, a struck ¶ at the end of each block when line break marks are shown; the space around it is the block's own.

> The implementer reads `decorations.ts`, `preview/decorations.ts` and `preview/theme.ts` as they are after block editing's Tasks 1.9 and 1.10 (hidden blank lines; spacing by kind) first: a struck block takes the spacing its kind takes, and the hidden blank lines around it stay hidden.

- [ ] **Step 1: Write the failing tests** (`tracked.test.ts`; the existing "keeps a deleted paragraph apart from the one beside it" is rewritten): a deleted paragraph is a block of its own, struck, and the next paragraph's line holds only its own text (Review Focus 5); at the end of the document it is after the block above; a deleted heading has its level's class, a deleted item its bullet, a deleted quote its bar; several blocks deleted are several; a deletion across blocks stays inline with a space (a ¶ with the marks on); a deleted list item between `- one` and `  three` is a struck item "two" with its bullet between them; the last block deleted; a comment on a deleted block keeps its note level with the block; someone else's change inside a deleted block is part of the struck block in its author's color; a deleted table is a block of its source, struck; Simple and Clean draw no struck block; hidden blank lines near it stay hidden (a case with `\n\n` before and after).
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement,** with the widget's `eq`, `estimatedHeight` and `ignoreEvent` so CodeMirror's measuring stays right.
- [ ] **Step 4: Run** the gate. Expected: PASS.
- [ ] **Step 5: Commit.** `Editor: a deleted block is drawn as a block, where it was (#183)`

### Task 3.3: A block's replaced text is drawn above its new text **[block-editing files]**

**Files:**
- Modify: `packages/editor/src/tracked/decorations.ts` (`MarkupWidget`; the analysis that marks a substitution `whole`)
- Test: `packages/editor/src/tracked/tracked.test.ts`

**Interfaces:**
- Consumes: Stage 1's substitution of a block's whole text. Produces: a substitution whose segment runs from the start of its block's text to its end marks its deleted part `whole`, and `MarkupWidget` draws it followed by a line break element so the new text, underlined, starts on the line below in the same block; the builder picks the element (a `<br>` or an inline block as wide as the line) by what keeps CodeMirror's measuring right in a list item's hanging line. The widget carries `data-mark`, the bar's classes and the kind's line classes. A heading's old text is at the heading's size; an item's old text is beside the one bullet.

- [ ] **Step 1: Write the failing tests:** a rewritten paragraph (the importer sentence through `suggestReplace`) draws its old text ending a line and its new text on the next, in the same line element; a heading, an item, a quote the same, at their sizes and indentation; a substitution of part of a block stays inline; a typed-over whole paragraph (a person's substitution) is drawn the same; with line break marks shown the struck text is not given a stray ¶; Simple and Clean draw the new text only; the test of agents-undo's ⌘Z (`applyAgentEdit`, if its Stage 2 has merged): a rewritten paragraph taken back and brought back in Redlines and in Clean gives the bytes and a caret in visible text — if not merged, add it to that plan's `agent-edit.test.ts` when it does.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the gate. Expected: PASS.
- [ ] **Step 5: Commit.** `Editor: the old text of a rewritten block is above its new text (#183)`

### Task 3.4: A rewritten table cell **[block-editing files]**

**Files:**
- Modify: `packages/editor/src/preview/table.ts` (the cell's content through `trackedText`), `packages/editor/src/preview/theme.ts` for the cell's styles
- Test: `packages/editor/src/preview/preview.test.ts` (or a `table.test.ts` beside `table.ts`)

**Interfaces:** Consumes: Stage 1's substitution inside a cell's pipes. Produces: a cell whose tracked text is a substitution of all of it draws the old text struck, a line break, and the new text underlined, in the cell's own element, in the author's color; the cell grows in height; the row's bar and the cell's `data-mark` are as for any change in a cell. A cell with a smaller change draws as today. Simple and Clean draw the new text in the cell.

> The implementer reads `table.ts` as it is after block editing's Task 1.9, which keys the table's widget in place of any block decoration.

- [ ] **Step 1: Write the failing tests:** a cell replaced whole through `suggestReplace` on a table row shows old above new inside that cell, not as a second row; the other cells are unchanged; the row has its bar; hover finds the change by `data-mark`; Simple and Clean show the new text only.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the gate. Expected: PASS.
- [ ] **Step 5: Commit.** `Editor: a rewritten table cell shows its old text above the new (#183)`

### Task 3.5: The caret and the keys over a struck block

**Files:**
- Modify: `packages/editor/src/tracked/decorations.ts` (atomic ranges for struck blocks), `packages/editor/src/tracked/caret.ts` if the caret rules live there
- Test: `packages/editor/src/tracked/caret.test.ts`

**Interfaces:** Consumes: Task 3.2's widgets. Produces: ← and → never enter a struck block; ↑ and ↓ go past it; Backspace at the start of the block below acts on that block as it does today; a click never puts the caret inside it; `visibleSelection` treats it as hidden text.

- [ ] **Step 1: Write the failing tests:** the arrows over a struck block between two paragraphs, at the end of the document, between list items (Review Focus 5); Backspace and Delete at the edges; with Track Changes off, deleting around it follows format §3.10 as today; select-all and a drag across it keep the struck text out of the selection's visible endpoints.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the gate. Expected: PASS.
- [ ] **Step 5: Commit.** `Editor: the caret steps over a struck block (#183)`

### Task 3.6: Cards and the bar on struck blocks

**Files:**
- Modify: `plugins/review/src/cards.ts` (`pointedAt`: find a change by a widget's `data-mark`; place the card against the widget's box)
- Test: `plugins/review/src/cards.test.ts`, `packages/editor/src/tracked/bar-switch.test.ts`

**Interfaces:** Consumes: `data-mark` (Tasks 3.2, 3.3, 3.4), the bar switch (Task 2.3). Produces: hovering over struck text opens its change's card after the usual delay, above or below the block so it covers neither the struck text nor the new; a click pins it; a struck block's bar is a target like any (Stage 2): a click switches to Simple, where the block isn't drawn, and the block below keeps the place.

- [ ] **Step 1: Write the failing tests:** hover on a struck block and on struck-above-new text opens the card of the right change, found by `data-mark` and not by matching text (two blocks with the same text); a click pins; the card sits clear of the block; the bar of a struck block switches to Simple and the next line keeps its top within a pixel.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the gate. Expected: PASS.
- [ ] **Step 5: Commit.** `Review: cards find struck blocks by their mark (#183)`

### Task 3.7: Design notes, the long document, the hand check

**Files:**
- Modify: `docs/design.md` (§5.5: the "Deleted blocks show as blocks" bullet, with a rewritten cell added: "a rewritten table cell shows its old text struck above the new inside the cell")
- Test: `packages/editor/src/preview/long-document.test.ts`

- [ ] **Step 1: Add** the long-document case: 150 KB with 200 marks including 50 deleted blocks; the bound is Redlines' without them.
- [ ] **Step 2: Edit** `docs/design.md`.
- [ ] **Step 3: Build the app and try by hand,** writing what you saw in the PR: a deleted paragraph, heading, item and quote; a rewritten paragraph and cell; the caret across them; hover and click; the bar on a struck block.
- [ ] **Step 4: Run** the gate and commit. `Docs: deleted and replaced blocks in the design (#183)`

**STAGE 3 ENDS HERE. Open the PR (closes #183, closes #181 with Stages 1 and 2); review; merge.**
