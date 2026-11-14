# Tracked Alignment Implementation Plan (#281)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align Left, Center, Right and Default Alignment change a column's alignment with Track Changes on as well as off. With it on, the change is a point mark at the end of the table's header row. It is drawn and carded, and it is decided in every order of decisions beside row and column operations, judged exactly against micromark 4.0.2 with GFM. The pair model, the decide-one-at-a-time test and the random suites draw it, with no refusal allowed.

**Architecture:** A tracked alignment change is one `fmt` mark with no closer, `<!--fmt k3x9 align=SPEC-->`, written at the end of the text of the header row's last cell: after any marks that end that text, before the cell's padding and closing pipe, and at the line's end in a header with no trailing pipe. `SPEC` is the old delimiter row as `align=` holds it today (format §2.6); the file's delimiter row holds the new alignment. Accepting removes the mark. Rejecting writes `SPEC` back as the delimiter row and removes the mark. Neither decision changes a byte outside the table's first two lines. Module by module:

- `parse.ts` reads an `align=` opener that no closer follows as a point mark, with no carrier.
- `table.ts` keeps the mark out of its cell's text (`textTo` stops in front of it, as `textFrom` stops after a row's marker) and out of the `padded` test.
- `table-align.ts` finds, writes and decides it (`alignMarkOf`, `alignEdit`, `alignDecision`). The span form that other tools wrote (opener before the table, closer after it) is still read, drawn, carded and decided, never written.
- `table-ops.ts` holds rules 2 and 5 (`pendingOf`, `ruleTwo`), the header restrictions of the row operations, and the plain column operations that keep `SPEC` in step.
- `table-cols.ts` keeps the mark at the end of the header's last cell through every rewrite of the columns (`columnChanges`).
- `table-rules.ts` keeps a header with no trailing pipe a table when all the text of its last cell goes.
- `formatting.ts` does not let the mark block formatting its cell.
- The editor reads the mark in `alignedColumns` and draws what it drew for the span form; `alignCols` stops refusing with Track Changes on.
- Docs and the WebKit check follow.

**Tech Stack:** TypeScript (strict), CodeMirror 6 (view 6.43.14), `@redlines/format`, vitest (Node and happy-dom), micromark 4.0.2 with `micromark-extension-gfm-table` as the oracle (read through `blockLeaves`, `expectEveryOrderAlike` and `expectNoDecisionRefused` in `packages/format/src/test-helpers.ts`), the WebKit check in `apps/desktop/src/table-check.ts`. pnpm is `npx -y pnpm@10.28.0`; git is `/usr/bin/git`.

**Spec:** Issue #281 and its comments. The second ("A design proposal: make the alignment change a point mark in the header row") is binding and is not redesigned here. With it: `docs/format.md` §3.7 (rule 5 "Aligning columns", "Rows and columns don't change together", "Cells apart"), §2.6, §3.9, §3.10, §8; `docs/superpowers/specs/2026-11-10-tables-design.md` (Track Changes, Views); and the format of `docs/superpowers/plans/2026-11-10-tables.md`, whose tasks 3b.3, 3b.5, 3b.6 and 3b.7 this plan replaces for alignment.

## Design problems

Three, found by reading the code and checking the oracle. The plan is written for the design as given, plus the repair named in each. None changes what the issue decided: the mark, its place, its value, what deciding writes.

They and the Calls were checked on a throwaway prototype of the point form (not in the repo): the reader, the writer, `outerPipeWrites`, `othersMark`, the carry in `columnChanges` and `SPEC` kept in step. On it, Align alone, Align beside Bo's inserted or deleted row, edits at the end of the last header cell and over the mark, plain Align beside the pending change, and 22 plain column operations on padded and bare tables, and the same on CRLF, empty-last-cell and small tables, all read alike in every order of decisions, every outcome is one table, and no decision is refused. The original view is the plain operation on the original, byte for byte, except that on a table with one-dash delimiter cells the new column's padding differs (the colons made the marked file's delimiter row unpadded; A.5 compares cells there).

1. **A header with no trailing pipe stops being a table when the mark alone holds its last cell.**
   Input: `a | b` / `--- | ---` / `c | d`. Ada aligns column 2 (tracked), giving `a | b<!--fmt k3x9 align=…-->`; Bo deletes `b` (tracked). `outerPipeWrites` writes no closing pipe, because the cell's content holds a marker, so the file is `a | <!--del c2dd b--><!--fmt k3x9 align=…-->`. Accepting both leaves `a | `, which micromark reads as a paragraph (checked: `<p>a |\n--- | ---\nc | d</p>`).
   Repair (A.2): `outerPipeWrites` takes a trailing alignment mark as outside the cell's text, so deleting all of the text writes the plain closing ` |` after the mark, in both versions, as it does today for a cell with no marker.
2. **The design covers the header changing under a pending alignment change, not the alignment change made while the header is itself pending.**
   Input A: Bo inserts a row above the header (tracked: `ins c2dd row` in the new header's first cell), then Ada aligns column 2 (tracked); the mark stands in the new header's last cell. Rejecting c2dd first removes the row, the mark and its ledger entry together, and the new alignment stays as if accepted; rejecting k3x9 first writes `SPEC` back and then rejecting c2dd removes the row: the old alignment. Today the generic views check in `commitEdit` refuses the write ("This decision would change the original text, because a marker that goes lets the text next to it be read otherwise…"), by accident and in words that don't say what to do; written by hand, the state has a refused decision (`reject k3x9`).
   Input B: Bo deletes the header (tracked), Ada aligns column 2 (tracked; the mark stands in the new header, the old first body row, and every order reads alike), Bo's deletion is rejected (the old header returns, and the mark is now in a body row), and Ada deletes that row (tracked, her own mark folds into the deletion). The mark is gone, the new alignment stays, and rejecting everything no longer gives the original bytes.
   Repair (A.2): a tracked alignment change is refused while the header is a pending row change (a row inserted above it or moved to the top, or the header deleted or moved away) with `Accept or reject the row changes in this table first.` It is the converse of the design's "row operations don't touch the header", and it keeps the mark in the header row for as long as it is pending. Plain alignment writes no mark and stays allowed.
3. **"Column operations keep the mark at the end of the header's last cell" cannot hold for tracked column operations.**
   Input: Ada centers columns 1 and 3 (tracked; `SPEC` has 3 cells), Bo deletes column 3 (tracked; the mark moves to the new last cell and the deletion keeps column 3's delimiter cell, `:---:`). Rejecting Ada first meets `SPEC` of 3 cells in a 2-column table, which the format refuses, a dead end for that order. Writing back only the surviving cells instead would make rejecting Bo then restore column 3 as `:---:`, and the original bytes would not come back. The only way out is one mark changing another mark's payload, which the format has never done.
   Repair: rule 5's refusals stay for tracked column operations (Calls 6 and 7). The keeping is done where it can be proved: plain column operations, with `SPEC` kept in step (A.5), and every rewrite of the header by `columnChanges` (A.4), so that no decision or merge loses the mark.

## Global Constraints

- `docs/format.md` is the source of truth for `packages/format`. §3.7 changes in the same PR (A.9; every task above it adds its sentences to the PR's notes, none merges without it).
- Every allowed edit reads the same in every decision order, judged exactly: micromark 4.0.2 with GFM tables is the oracle. Refuse rather than repair, but with words that say what to do. Ordinary typing refused is a failure.
- No allowed operation leaves a single decision refused. `expectNoDecisionRefused` takes no option in the pair model. In the random suites it takes `unlessWithout`, which excuses only a refusal that the same file has with its alignment changes rejected first; the alignment change's own decisions are never excused. Do not weaken the helper.
- No marker starts a line (format §3.2). The mark never does: it stands after a cell's text.
- A keystroke costs what it does on main: one update on the long document within 16 ms (32 on CI). The rows of `packages/editor/src/blocks/cost.test.ts` hold it (`REDLINES_COST=check`). A tracked Align on the 300-row table is held to what a column move is.
- Tests that read the drawing force the full parse: `forceParsing(editor.view, editor.view.state.doc.length, 10_000)`. A long test gets a 60 s timeout (`, 60_000)`); the existing random suites keep theirs.
- Never mention any other Markdown editor as a model or reference, in code, comments, docs, commits, PRs or issues.
- TypeScript as `tsconfig.base.json` sets it (strict, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `erasableSyntaxOnly`: no enums, namespaces or parameter properties); `import type`; Prettier width 100, single quotes. A test needing a DOM starts with `// @vitest-environment happy-dom`; one needing Node's types is `*.node.test.ts`.
- The gate before every commit: `npx -y pnpm@10.28.0 typecheck && npx -y pnpm@10.28.0 lint && npx -y pnpm@10.28.0 test && npx -y pnpm@10.28.0 format:check` ("the gate"; `format` fixes). The controller may ask for the focused form on a busy machine: the task's tests, then `typecheck`, `lint` and `format:check`, with the full `test` run once before the PR.
- The random suites run at `REDLINES_FUZZ=1500` before the PR and after A.2, A.4, A.5 and A.6: `REDLINES_FUZZ=1500 npx -y pnpm@10.28.0 vitest run packages/format/src/table-cols-random.test.ts packages/format/src/table-format-random.test.ts packages/format/src/table-rows-random.test.ts`.
- No task touches Rust. `apps/desktop/redlines` bundles `packages/format`, so run `scripts/build-redlines` in `apps/desktop` before any `cargo test`.
- Commits are `Area: what changed` and end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. The PR body ends with the generated-with line. Merge when no critical issue is open; file what is out of scope as an issue.

## The form and the words

The form (the Fruit table with Count centered by Ada; `SPEC` is the old delimiter row as a value, §2.6):

```markdown
| Fruit  | Count | Price<!--fmt k3x9 align=\|\x20:-\-\-\-\-\x20\|\x20-\-\-\-\-\x20\|\x20-\-\-\-:\x20\|--> |
| :----- | :---: | ----: |
| Apples | 3     | 1.20  |
| Pears  | 5     | 0.90  |
```

The mark is the table's, not its last column's: it is in the cell of `Price` although `Count` changed. In a header with no trailing pipe it is the line's end (`a | b<!--fmt …-->`, trailing spaces after it); in an empty last cell it stands after the first space (`| a | <!--fmt …--> |`).

The words (one string each; the editor shows them in its notice):

| When | Words |
| --- | --- |
| A column operation while an alignment change is pending (tracked, or plain with columns pending too), and a row operation that touches the header | `Accept or reject the alignment change in this table first.` |
| A tracked alignment change while a column is pending | `Accept or reject the column changes in this table first.` |
| A tracked alignment change while the header is a pending row change | `Accept or reject the row changes in this table first.` |
| Another person's alignment change is pending | `Bo Chen's alignment change is pending. Decide it first.` |
| Nothing would change | `The columns are already aligned that way.` |
| A marker can't follow the header's last cell | `A marker can't go at the end of this table's header, where Markdown would read it otherwise. Change the end of its last cell first, then align.` |
| Rejecting with the columns gone | `This alignment change can't be rejected, because its table no longer has the columns it had. Accept it, or change the text in Raw with Track Changes off.` |

## Review Focus

The inputs the design implies and no row of it exercises, most likely first; each line has its test in the named task.

1. **Other marks in the header's last cell:** a point comment or a range comment ending there, a tracked insertion or deletion at the end of its text (Ada, Bo, plain), a substitution of all of it, bold over it. The mark stands after them, they stand before it, and every order of decisions reads alike. Tasks A.1, A.3, A.6.
2. **A header with no trailing pipe, with spaces after its text, with no leading pipe, and a one-cell header (`| a |`):** the mark is the line's end, the spaces stay after it, and the closing pipe is written when all the text of the last cell goes (Design problem 1). Tasks A.1, A.2, A.6.
3. **An empty last header cell** (`|  |`, `||`), and one emptied by a deletion: the mark alone holds the cell, and accepting or rejecting it leaves a table. Tasks A.1, A.2.
4. **The header is itself pending:** a row inserted above it, a row moved to the top, the header deleted or moved away; and the converse, a row operation on the header while the mark is pending (Design problem 2). Tasks A.2, A.6.
5. **A last header cell that ends where a marker can't follow.** Checked against `inspectPlace` and micromark today: `b\` (a backslash would escape the marker's `<`) and an underscore at the end (`_b_`, `b_`: rule 5's flanking) are refused with the marker words; `b\\`, `*b*`, `b*`, `**b**`, a code span, `[b](c)`, a bare URL, `b~~`, `<b>` and `&amp;` are written, and micromark reads each the same with the mark and without it. Task A.2.
6. **A pipe in a code span in the header** (`` `x|y` `` is two cells to GFM), `\|` before the mark, and the `\|` in `SPEC` that must never split a cell. Tasks A.1, A.2.
7. **CRLF:** the mark is on one line, and deciding it touches no line break. Tasks A.2, A.6.
8. **Two tables a blank line apart,** each with its own mark; and a table with deleted rows and deleted columns pending, whose deletion lines come first and have no closer behind them. Tasks A.1, A.2, A.6.
9. **A column deleted, inserted or moved with Track Changes off while an alignment change is pending:** in every case the mark still ends the header's last cell, `SPEC` has the same columns, and the original view is the plain operation on the original. Tasks A.4, A.5.
10. **An edit that covers the mark** (an agent's `str_replace` over `Price |`, a Raw edit with Track Changes off): refused in words, or the mark kept and every decision possible; never lost without a word. Task A.3.
11. **The old span form from another tool next to the new form** in two tables of one document; the span form's gap guard stays for it. Deciding either leaves the other as it was. Tasks A.1, A.3.
12. **Accept All and Reject All order,** with the mark, a row inserted, a row deleted and typed text in the header all pending; and a merge that leaves a column mark and an alignment mark together (the mark must survive a column that leaves). Tasks A.3, A.4.
13. **Delete Table (Stage 4's `deleteTable`)** with the mark pending: another person's refuses with rule 6's words, your own folds into the deletion. Task A.6, if `deleteTable` is in `TableOp` when the task starts.
14. **Undo:** Align is one step, the caret and selection come back, and typing at the end of the last header cell lands in front of the mark. Task A.8.

## Calls

Where the design is silent and the code forces a choice. Each is decided; the cost is what a wrong choice does.

1. **Where the mark stands in the last header cell.** At `textTo` of that cell: after its text and after any marks that end it (a comment closer, an insertion closer), before the padding and the closing pipe; at the line's end in a header with no trailing pipe, with trailing spaces left after it. Never added space. *Cost if wrong:* a space between text and mark would not come back when the mark is decided, breaking "neither decision changes a byte outside the first two lines".
2. **`textTo` of that cell stops in front of the mark, and the reader finds the mark anywhere in the table's rows.** The two readers (`readTables`, and `readRowCells` that the editor's model calls) agree through `alignPointIn`. Typing, comment points (rule 4 writes at `cell.textTo`), selections and the underline stand in front of the mark, so it stays last unless something is written after it later. A mark found in a body row (a merge can leave one) is read, decided and drawn on the header row all the same. *Cost if wrong:* typed text lands after the mark. Nothing breaks, since the reader is lenient, but the "ends the cell" shape weakens.
3. **A header with no trailing pipe.** The mark is the line's end, as designed. `outerPipeWrites` ignores a trailing alignment mark when it asks whether an edit takes all the text of the last cell (Design problem 1). *Cost if wrong:* a pipe-less table can stop being a table after accept.
4. **Row operations while an alignment change is pending.** Refused, tracked and plain, when they touch the header: `insertRows` with `after < 0`, `deleteRows` that includes row 0, `moveRows` that includes row 0 or has `to === 0`. The words are `Accept or reject the alignment change in this table first.` Every other row operation is allowed. *Cost if wrong:* allowing a header move would leave the mark in a body row.
5. **A tracked alignment change while the header is a pending row change** (`rows[0].insertion` is set, or a deleted row has position 0). Refused with `Accept or reject the row changes in this table first.` All four states are refused, the move and the deletion too (Design problem 2, input B): otherwise rejecting the pending change could leave the mark in a body row, where a row operation folds it away. Plain alignment is allowed. *Cost if wrong:* too wide, one extra refusal where a reject-first order would have worked; too narrow, an alignment change lost without a word.
6. **Tracked column operations while an alignment change is pending stay refused** (`Accept or reject the alignment change in this table first.`). `SPEC` keeps the whole old row, a cell per column the table had, while a deleted or moved column keeps its own delimiter cell in its payload (Design problem 3). *Cost if wrong:* an order of decisions with a dead end or wrong bytes.
7. **A tracked alignment change while a column is pending stays refused** (`Accept or reject the column changes in this table first.`), for the same reason. Plain alignment beside a pending column stays allowed: it edits the delimiter row, the old row of a pending change, and the kept copy of a moved column, as today. *Cost if wrong:* same as 6.
8. **Plain column operations while an alignment change is pending are allowed, and keep `SPEC` and the mark in step** (A.5). `SPEC` goes through the same `columnChanges` as its table's delimiter row, as a one-line grid, so a deleted column's cell goes, a new column's cell is its delimiter cell, a moved column's cell moves; the mark is written at the end of the final last header cell with its payload re-encoded; a change whose old and new alignments are then the same is removed with its ledger entry, as the plain `align` already does. Refused with `Accept or reject the alignment change in this table first.` when a column mark is pending too, or when `SPEC` doesn't have the table's columns. *Cost if wrong:* the fallback is one line of `ruleTwo` (refuse plain column operations as today), at the price of a person with Track Changes off being asked to decide the alignment change first.
9. **A header end a marker can't follow** (an odd run of backslashes, or where `inspectPlace` says `refuse`, `construct` or `flank`) is refused when the change is made, with the words in the table above. The check is `inspectPlace` the way `assertPlace` in `format-blocks.ts` uses it for the box's point mark; today it refuses a last cell ending in `b\` and one ending in `_` (`_b_`, `b_`). *Cost if wrong:* too strict, a header written with underscore emphasis can't be aligned with Track Changes on until its end is changed (the words say so; Track Changes off still works); too loose, a mark that Markdown reads as text, or a header that reads otherwise in some order.
10. **A pending alignment change doesn't block formatting its cell.** `othersMark` in `formatting.ts` skips a point alignment mark: its decisions only remove it and write the delimiter row, so they can't change how the cell's inline syntax reads. The walk that tries every order still includes it and stays the arbiter. Prototyped: without the skip, bold over the last header cell, tracked or plain, is refused with "Bo Chen's format change is in the cell in the header, column 3. Accept or reject it first, then format the cell."; with it, the bold is written in front of the mark and all four states read alike. *Cost if wrong:* bold over the last header cell is refused while someone else's alignment change is pending, in those words.
11. **The span form.** Read, drawn, carded and decided exactly as today; never written; `checkAlignGap` stays for it (a tracked edit under its table is refused, as before). Changing one in place keeps its form. A span opener whose closer is missing becomes a point mark that no table holds: accepting removes it, rejecting is refused with the `LOST` words. *Cost if wrong:* files from other tools with that damage show a change that can only be accepted.
12. **Drawing and card are today's.** A bar on the header row, a dotted underline under the header text of each column changed (the underline stops in front of the mark, because `textTo` does), a card on the header row, nothing of its own for the mark (it is hidden and has no width); Simple draws the bar alone, Clean nothing. Only `alignedColumns` changes: it finds the table that holds the mark. *Cost if wrong:* none to the file.
13. **The review view's note stands where the mark stands**, as a box's does: `| Fruit | Count | Price{>>[k3x9 ada] Formatted: column Count centered (was default)<<} |`. *Cost if wrong:* agents read the note in the header cell and not under the table; nothing is stored in it.
14. **After the command the caret keeps its place in front of the mark.** `alignCols` maps the selection with the default association, so a caret at the end of the last header cell stays in front of the new mark. *Cost if wrong:* the selection filter moves the caret back to the stop, which it does anyway.
15. **`scopeOf` keeps its whole-table path while an alignment change is pending** (as it does today: `lines` is undefined). *Cost if wrong:* none to correctness; a keystroke while one is pending costs what the cost row already holds it to (twice main's).
16. **A refusal of a tracked Align is told in the editor's notice with the format's words,** and `ALIGN_NOT_READY` goes. A request that changes nothing stays a silent no-op (the menu's check mark says so). *Cost if wrong:* none.

# Stage A: Tracked alignment (#281)

Branch `v0.3/tables-align`, cut from main after Stage 4's PR (`v0.3/tables-whole`) is merged. Stage 4 changes the same files on its branch (`table-ops.ts`, `table-rules.ts`, `table-ops.test.ts`, `table-typing.test.ts`: `deleteTable`, rule 6, point comments). Each task reads the files as they are when it starts, and works from the function names here, not line numbers. Tasks are in order; each leaves the build green, so each can be a commit of the PR.

### Task A.1: Reading the point form

**Model:** `sonnet`, working carefully. Every later proof stands on this reader, and the cell text range is read in two places that must agree.

**Files:**
- Modify: `packages/format/src/parse.ts` (`isPoint`, `segmentOf`), `packages/format/src/table.ts` (`alignPointIn`, `cellOf`, `readRowCells`, `isPadded`), `packages/format/src/table-align.ts` (`alignMarkOf`, `tableOfSegment`, `isAlignPoint`), `packages/format/src/index.ts` (export `isAlignPoint`)
- Test: `packages/format/src/parse.test.ts`, `packages/format/src/table.test.ts`, `packages/format/src/table-align.test.ts` (a new `describe`; its tracked-writing tests stay as they are until A.2)

**Interfaces:**
- Produces:

```ts
// table.ts
/** The point mark of an alignment change that ends `text[from, to)`, white space after it aside: one whole
 * `<!--fmt ID align=…-->` (four id characters, an `align=` payload, no line break, its first `-->` its end).
 * Text only, so that `readRowCells` and the editor's model, which have no parse, use it too. Null otherwise. */
export function alignPointIn(text: string, from: number, to: number): Range | null;
// TableCellRead.textTo of a cell whose text ends with such a mark stops in front of it, as textFrom starts after a
// row's marker; a cell that holds only the mark has textFrom === textTo, in front of it. `padded` reads the header
// as it is without the mark, as it does without a column's marker (the pipe offsets of `isPadded`'s `shape` are
// taken from the line with the mark cut out in both of its branches: today the branch for a line with no column
// marker reads the raw text).

// table-align.ts
export function isAlignPoint(mark: MarkRange): boolean; // an `align=` format change, one segment, no closer
export function alignMarkOf(parsed: Parsed, table: TableRead): MarkRange | undefined; // the point form in a row of the table, else the span form as before
```

- Behavior: `parse` makes a `fmt` opener whose payload starts `align=` a point when no closer with its id follows it; the segment has no `close` and no `carrier` (`startsBlocks` is true only for a span). With a closer it is the span form as today; `+bold` and the like with no closer stay unclosed marks with their warning. The point's table is the one whose `[from, to]` holds its opener. `alignChange`, `alignHide`, `alignDecision` and the views need no change: `alignHide` removes the opener alone when there is no closer, and `tableOfSegment` finds the table for a point as above, for a span as today.

- [ ] **Step 1: Write the failing tests.** Fixtures: `FRUIT` and `SPEC` as in `table-align.test.ts`; `POINT = file(\`| Fruit  | Count | Price<!--fmt k3x9 align=${SPEC}--> |\n| :----- | :---: | ----: |\n| Apples | 3     | 1.20  |\n| Pears  | 5     | 0.90  |\`, { k3x9: 'bo' })`.
  - `parse.test.ts`: `it('reads an align= format change with no closer as a point mark')` (one mark, kind `fmt`, `segments[0].close` and `.carrier` undefined, payload starts `align=`, `problemsOf` empty); `it('still reads the span form: a closer makes a range with a carrier')`; `it('leaves an unclosed +bold opener unread, with its warning')`; `it('reads an align= opener alone on its line with no closer as a point, with no carrier')`.
  - `table.test.ts`, with `cellsOf`: `it('stops the text of the header's last cell in front of the alignment mark')` for outer pipes, no trailing pipe with spaces after the mark, no leading pipe, a point comment `<!--cmt c9qf-->` before the mark (the comment stays in the text), and a one-cell header whose first cell also has `<!--ins w8nn row-->` (`textFrom` after the row marker, `textTo` in front of the mark); `it('gives an empty last cell that holds only the mark one stop, in front of it')`; `it('reads a table with the mark in its header as padded')` (and a table with an unpadded row still as not); `it('reads the same cells through readRowCells, which has no parse')`; `it('finds the alignment change of the right one of two tables, in either form')` (`alignMarkOf`); `it('does not take a mark that has text after it for the end')` (`Price<!--fmt …-->x` keeps `textTo` after the `x`).
  - `table-align.test.ts`, `describe('a point alignment change, written by another person')` over `POINT`: `pendingOf(table, parsed).align` is true; `formatChange` names `{ kind: 'align', columns: [{ col: 1, name: 'Count', now: 'center', was: '' }] }`; `accept` gives `POINT` with only the mark removed (byte-exact) and no ledger entry; `reject` gives `FRUIT` byte for byte; `canReject` is true; a fixture whose `SPEC` has three cells under a two-column table can be accepted and its `reject` throws the `LOST` words; `newestView` is the body with the new delimiter row and no mark; `originalView` is `FRUIT`; `reviewView` has `Price{>>[k3x9 bo] Formatted: column Count centered (was default)<<} |` (Call 13); the same in a CRLF file and in the second of two tables (the first untouched); `acceptAll` and `rejectAll` agree with the views.
- [ ] **Step 2: Run** `npx -y pnpm@10.28.0 vitest run packages/format/src/parse.test.ts packages/format/src/table.test.ts packages/format/src/table-align.test.ts` — FAIL.
- [ ] **Step 3: Implement** `alignPointIn` once in `table.ts` and use it in `cellOf` (after the trimmed content is known; a start marker and an end mark can be in one cell, `textFrom <= textTo`), in `isPadded`'s `shape` (cut a trailing mark out of the line in both of its branches, as the column marker is cut out) and in `readRowCells`; `isPoint` and `segmentOf` in `parse.ts`; `alignMarkOf` and `tableOfSegment` for both forms.
- [ ] **Step 4: Run** the three files and the gate, and `npx -y pnpm@10.28.0 vitest run packages/format` (the span fixtures of the older tests must still pass, since the writer still writes the span form until A.2) — PASS.
- [ ] **Step 5: Commit** `Format: read an alignment change written as a point in the header row (#281)`.

### Task A.2: Writing it, and the header restrictions

**Model:** `sonnet`, working carefully. The pair model and the random suites run at once on what this writes, so the pipe repair and the header rules belong to the same commit as the writer.

**Files:**
- Modify: `packages/format/src/table-align.ts` (`alignEdit`: the tracked branch writes the point; delete `closerSlot` and its imports; the placement guard), `packages/format/src/table-ops.ts` (`TablePending.headerChanged`, `pendingOf`, `ruleTwo('align')`, `ALIGN_FIRST`, `headerCheck`, `deleteRows`, `moveRows`), `packages/format/src/table-rules.ts` (`outerPipeWrites`)
- Test: `packages/format/src/table-align.test.ts` (the tracked `describe` rewritten for the point form; the span assertions move to a new `describe('the span form, written by another tool')` over hand-written fixtures), `packages/format/src/table-ops.test.ts`, `packages/format/src/table-cols.test.ts` (their `TablePending` literals gain `headerChanged: false`, and the `reads what is pending` `toEqual` too), `packages/format/src/table-pairs.test.ts` (nothing unless a regex needs adding)

**Interfaces:**
- Produces:

```ts
// table-ops.ts
export interface TablePending { …existing…; /** The header is itself a pending row change: `rows[0].insertion` is set (a row inserted above it, or moved to the top), or a deleted row has position 0 (the header deleted, or moved away). */ headerChanged: boolean }
export const ALIGN_FIRST = 'Accept or reject the alignment change in this table first.';
// ruleTwo('align', pending, tracked): tracked && (colsInserted || colsChanged) -> the column words;
//                                     tracked && headerChanged -> the row words; otherwise null (plain is never refused here).
// insertRows (after < 0), deleteRows (rows include 0), moveRows (rows include 0, or to === 0):
//   refused with ALIGN_FIRST when pendingOf(...).align, tracked or plain.
// table-align.ts: alignEdit(text, parsed, table, op, ctx): AlignEdit  (signature unchanged).
//   ctx !== null, no change of the table pending: the changes are the delimiter cells and ONE insertion of
//   `<!--fmt ${id} align=${encodeValue(delimiter)}-->` at textTo of the header's last cell; created: [id], keeps: 'original'.
//   The caret is `table.rows[0].cells[cols[0]].textFrom` mapped through the changes.
```

- Behavior: the writer refuses, before writing, with the marker words when the last header cell ends in an odd run of backslashes or where `inspectPlace(text, hidden, at)` says `refuse`, `construct` or `flank` (Call 9; `hidden` are the ranges of `markerRanges(parsed)`). The other branches of `alignEdit` (another person's pending change refuses naming them; your own is changed in place, and goes with `SPEC` written back when the old alignments return; plain changes the delimiter row, the old row of a pending change and a moved column's kept copy) are unchanged, and work for the point because `alignHide` removes an opener alone. `outerPipeWrites` strips a trailing alignment mark from the last cell's content (with `alignPointIn`) before it asks whether the edit takes all the text, and writes ` |` at the line's end, after the mark.

- [ ] **Step 1: Write the failing tests** in `table-align.test.ts`, with the file's `align`, `edit`, `said`, `aligns` helpers:
  - Byte-exact: `align(file(FRUIT), [1], 'center').after` has the body of "The form" above, ledger entry `{ by: 'ada' }`, `aligns` `['left','center','right']`, one table to `blockLeaves`, `problemsOf` empty; with `group` and `note` in the context the entry has them.
  - `it('writes the file's own line breaks')` (CRLF: no lone `\n`; reject gives the CRLF file back byte for byte; accept gives it with the new delimiter row).
  - `it('changes no byte outside the table's first two lines, deciding it either way')` over `Before it.\n\n${FRUIT}\n\nAfter it.\n\n${FRUIT.replace('Fruit', 'Veg')}` (compare every other line before and after `align`, `accept` and `reject`; the second table untouched), and a table that starts the file (no line before it).
  - `it('writes no blank line, no opener line and no closer')`.
  - Places: `a | b\n--|--\nc | d` aligned `[1]` right: the mark is the line's end, no pipe added, `reject` gives the table back byte for byte; `a | b   ` (spaces after the text): the mark in front of the spaces; `| a |  |\n| - | - |\n| c | d |` aligned `[0]`: the mark after the first space of the empty cell, `accept` gives the table back byte for byte; a one-cell header `| a |\n| - |\n| b |`; a header cell with `\|` in a code span, written and read as the same table (`blockLeaves` before and after); a header whose last cell ends in `b\` or in an underscore (`_b_`, `b_`) is refused with the marker words, and one ending in `b\\`, `*b*`, `b*`, a code span, `[b](c)`, a bare URL or `b~~` is written and reads as the same table in `blockLeaves` with and without the mark.
  - Rule 2 and 5: `it('is refused while a column is pending, in words, tracked; plain is allowed')` (inserted, moved, deleted column: the column words); `it('is refused while the header is a pending row change')` for a row inserted above (Bo), a row moved to the top, the header deleted and the header moved away (the row words), plain allowed, and a body row inserted, deleted or moved not in the way; `ruleTwo` and `pendingOf.headerChanged` for each of them.
  - `it('refuses a row operation on the header while it is pending, tracked and plain, and allows the others')`: `{ kind: 'insertRows', after: -1 }`, `{ kind: 'deleteRows', rows: [0] }`, `{ kind: 'deleteRows', rows: [0, 2] }`, `{ kind: 'moveRows', rows: [0], to: 3 }`, `{ kind: 'moveRows', rows: [2], to: 0 }` all give `ALIGN_FIRST` for Bo, for Ada and plain; `{ insertRows after: 0 }`, `{ insertRows after: 3 }`, `{ deleteRows [2] }`, `{ moveRows [1] to 3 }`, `{ moveRows [3] to 1 }` are written, each with the header line byte for byte as before, `expectEveryOrderAlike(…, exactly)` and `expectNoDecisionRefused`. An agent's `suggestReplace` over the table that adds a row above the header or takes the header out is refused with `ALIGN_FIRST` too (it reaches `tableEdit` through `diffTables`); one that adds a row below the header is written.
  - `it('still refuses every column operation while it is pending')` (tracked and plain, `ALIGN_FIRST`; A.5 changes the plain half).
  - Carried over, point form: your own pending change is changed in place and goes with its old row back as it was when the alignments are the old ones; another person's refuses naming them; `The columns are already aligned that way.`; plain Align changes the delimiter row alone, the old row of a pending change (and the change goes when old and new are the same), a moved column's kept copy.
  - The pipe repair (Design problem 1): `a | b\n--- | ---\nc | d` with the mark, Bo's tracked deletion of `b` (`{ from: textFrom, to: textTo, insert: '' }`) and Bo's/Ada's plain deletion both write ` |` after the mark (`/--> \|$/` on the header line), and every outcome of `everyOrder(after).outcomes` is one table whose rows all have the header's cells. The same with a trailing pipe (nothing written, still a table).
  - `describe('the span form, written by another tool')`: hand-written span fixtures keep the old assertions: byte-exact accept and reject (opener, closer and the blank lines go), the three gap-guard tests (a tracked edit right under the table refused naming the person, allowed at the end of the last cell, allowed with Track Changes off; every edit refused or every decision possible), the deletion line in front of the closer, `closerRange`'s blank-line cases; `expectEveryOrderAlike` over one.
- [ ] **Step 2: Run** `npx -y pnpm@10.28.0 vitest run packages/format/src/table-align.test.ts packages/format/src/table-ops.test.ts packages/format/src/table-cols.test.ts` — FAIL.
- [ ] **Step 3: Implement** the writer, the guard, `headerChanged`, the header refusals (`headerCheck` gains the align case; `deleteRows` and `moveRows` get the check next to the existing `colsInserted` ones, before rule 3) and the `outerPipeWrites` change; delete `closerSlot`; add a comment to `closerRange`, `checkAlignGap` and the span branches that say they are for the span form that other tools wrote.
- [ ] **Step 4: Run** the three files, `table-pairs.test.ts`, the three table random suites at their default fuzz, and the gate — PASS. Then the suites at `REDLINES_FUZZ=1500`; a failure in a bare table is Design problem 1 or a cell end the guard should have refused: fix it in the format, never in the test.
- [ ] **Step 5: Commit** `Format: write an alignment change as a point mark in the header's last cell (#281)`.

### Task A.3: Deciding it in every order, and edits beside it

**Model:** `sonnet`, working carefully: every-order proofs, and the one change to `formatting.ts`.

**Files:**
- Modify: `packages/format/src/formatting.ts` (`othersMark`), and whatever the tests below find wrong in `decide.ts`, `track.ts`, `untracked.ts` or `edit-support.ts` (fix the format, never the test)
- Test: `packages/format/src/table-align.test.ts` (a `describe('beside other marks and edits')`), `packages/format/src/table-format.test.ts`, `packages/format/src/decide.test.ts`

**Interfaces:**
- Produces: no new export. `othersMark(planning, range)` skips a mark for which `isAlignPoint(mark)` is true (Call 10). Deciding is `accept`/`reject`/`acceptAll`/`rejectAll` as they are.

- [ ] **Step 1: Write the failing tests.** Fixture `POINT` (Bo's mark) and its two-column version.
  - Beside edits in the last header cell (`Price`): Ada types `x` at the end (tracked and plain), deletes `ce` (tracked and plain), deletes all of `Price` (tracked and plain), replaces `Price` (tracked), adds a comment over it (`addComment`), and Bo does the same from a second file. Each result has the new marks in front of the mark (`/Price<!--ins \w{4}-->x<!--\/\w{4}--><!--fmt k3x9/` and the like), the oracle reads one table in the newest and the original view (`blockLeaves`), `expectEveryOrderAlike(label, after, exactly)` and `expectNoDecisionRefused(label, after)` pass, and `acceptAll`/`rejectAll` give the newest and the original view.
  - Formatting: Ada bolds `Price` (`trackedFormat` over `[textFrom, textTo)`), bolds the whole header row (`trackedFormatRanges`, one range per cell), and a plain bold, while Bo's mark is pending: written, not refused, every order alike and no decision refused. A comment's range over the whole header row text likewise.
  - Under the table: the old loop of `refuses every tracked edit right under the table, or leaves every decision possible`, run on the point form: every range from the end of the last row to a little into the paragraph below, typed over or deleted by Bo or Ada, a row deleted or not, a comment on the paragraph or not. **No edit is refused for the alignment's sake** (`refusedEdits` is 0), and `expectNoDecisionRefused` holds for every state built (more than 100). This is the issue's "120 refused states" test.
  - An edit that covers the mark (`{ from: indexOf('ce<!--fmt'), to: end of the marker + 2 }`, tracked by Ada and Bo, plain, and an agent's `suggestReplace` over `Price |`): either an `EditError`, or the mark `k3x9` is still pending in the result and `expectNoDecisionRefused` holds. (If the code drops the mark, make it refuse: `Bo Chen's alignment change is in the text you are changing. Decide it first.`)
  - Other changes pending with it: Bo's inserted row, Ada's deleted row, Bo's typed text in the header, all at once, decided in every order (`expectEveryOrderAlike`), `acceptAll` and `rejectAll` (the mark last, on the text the others leave), including a state where deciding another mark first would have left a closer next to the mark.
  - A document with one table with the span form and another with the point form: deciding either leaves the other byte for byte, `expectEveryOrderAlike` over the document.
  - `decide.test.ts`: `isDecidable`, `canReject` for the point, and `rejectMarks(text, ['k3x9', 'w8nn'])` as one decision.
- [ ] **Step 2: Run** `npx -y pnpm@10.28.0 vitest run packages/format/src/table-align.test.ts packages/format/src/table-format.test.ts packages/format/src/decide.test.ts` — FAIL (the formatting cases, at least).
- [ ] **Step 3: Implement** the `othersMark` change; fix what else fails. If the walk in `formatting.ts` refuses a bold with the mark in the cell, keep that refusal's words (cell and person) and list the input under Review Focus 1 in the PR; do not weaken the walk.
- [ ] **Step 4: Run** the three files, the three table random suites at default fuzz, and the gate — PASS.
- [ ] **Step 5: Commit** `Format: an alignment change is decided in every order beside edits in its cell (#281)`.

### Task A.4: Column rewrites keep the mark at the end of the header

**Model:** `sonnet`, working carefully. The same function writes every column operation, decision and view; the keeping must not double up with the views' own handling of the mark.

**Files:**
- Modify: `packages/format/src/table-cols.ts` (`Grid`, `gridOf`, `columnChanges`, `decideCols`), `packages/format/src/table-ops.ts` (callers pass `parsed`)
- Test: `packages/format/src/table-cols.test.ts`, `packages/format/src/table-align.test.ts`

**Interfaces:**
- Produces:

```ts
// table-cols.ts
export interface Grid { …existing…; /** The point mark of an alignment change that ends the header's last cell: its range, and the text written at the end of the last cell the columns leave (the old marker unless a caller changes it). Null when there is none. */ alignMark: { range: Range; text: string } | null }
export function gridOf(text: string, table: TableRead, parsed?: Parsed): Grid; // with `parsed`, finds the mark through `alignMarkOf`; without it, alignMark is null (the views)
// columnChanges(text, grid, final, skipLone?) is unchanged in signature: with grid.alignMark it removes the mark where it stands (unless the unit of the cell that holds it is taken out anyway), leaves it out of the content of a moved cell, and writes `text` at the end of the text of the final last header cell (after the marks that end it, in front of its padding), in a staying cell by a change, in a written cell inside its content. A mark that stays where it is is replaced in place when `text` is not what stands there (A.5 changes `text`).
```

- Consumes: `alignPointIn`, `alignMarkOf`. `decideCols` passes `parsed` in both modes, `original` too: the original view undoes the mark in its second step and must still find it. The review view and `deletedColsView` call `gridOf(text, table)` with no `parsed` and keep their own handling.

- [ ] **Step 1: Write the failing tests.** Merge-state fixtures written by hand (a column mark and an alignment mark together are what a merge leaves; no operation writes them):
  - `| Fruit | Count | <!--ins c2dd col--> New<!--fmt k3x9 align=${SPEC2}--> |` with `SPEC2` the two-column old row and delimiter `| ----- | :---: | --- |`: `reject` of `c2dd` leaves the mark at the end of `Count`'s text, `SPEC2` untouched, and then `reject` of `k3x9` gives the original two-column table byte for byte; `accept` of `c2dd` leaves the mark where it is. `reject` of `k3x9` first is refused with the `LOST` words (the table has three columns): the one refusal this state may have, asserted by name.
  - A deleted last column (`<!--del m2bd col=3 …-->` below the table) with the mark at the end of the new last cell: `reject` of `m2bd` writes the column back and the mark is at the end of the restored header cell; `accept` removes the line and leaves the mark.
  - A moved column to the end and from the end, a pending column mark in the first column (the mark must not move to the first cell), a bare header (no pipes: the mark is the line's end of the new last cell, the closing pipe `columnChanges` writes stands after it), an empty new last cell, CRLF, a padded table.
  - The views and `originalView`: still hide or undo the mark once (no doubled change, `originalView` has the old delimiter row, `newestView` the new, no `<!--` left).
  - `gridOf(text, table)` with no `parsed` has `alignMark: null` and `columnChanges` behaves as before (the existing column tests pass unchanged).
- [ ] **Step 2: Run** `npx -y pnpm@10.28.0 vitest run packages/format/src/table-cols.test.ts packages/format/src/table-align.test.ts` — FAIL.
- [ ] **Step 3: Implement** the carry as the row marker's is (`rowMarkers`, `carry`): a staying last cell that stays last is left alone; a staying cell that stops being last has the mark removed; a cell that leaves or moves loses it with its unit or its content; the final last cell gets it. Take care that the removal and the write don't overlap changes `joinPoints` joins.
- [ ] **Step 4: Run** the two files, `table-pairs.test.ts`, the column random suite at default fuzz, and the gate — PASS.
- [ ] **Step 5: Commit** `Format: column rewrites keep the alignment mark at the end of the header (#281)`.

### Task A.5: Plain column operations beside a pending alignment change

**Model:** `sonnet`, working carefully. This lifts a refusal; its fallback is one line (Call 8).

**Files:**
- Modify: `packages/format/src/table-ops.ts` (`ruleTwo`, `insertCols`, `deleteCols`, `moveCols`), `packages/format/src/table-align.ts` (`keepAlignInStep`)
- Test: `packages/format/src/table-align.test.ts`, `packages/format/src/table-cols.test.ts`, `packages/format/src/table-ops.test.ts`

**Interfaces:**
- Produces:

```ts
// table-align.ts
/** With Track Changes off and an alignment change pending, what its mark is after the columns `final` are made (format §3.7, §3.10): its opener with `align=` holding the old row with the same columns done to it
 * (a deleted column's cell gone, a new column's cell its delimiter cell, `item.text(1)`, a moved column's cell moved), or `null` when the old and the new alignments are then the same, so that the change goes.
 * Undefined when none is pending or its `SPEC` has not the table's columns. */
export function keepAlignInStep(
  text: string, parsed: Parsed, table: TableRead, final: readonly ColItem[],
): { opener: string | null } | undefined;
// ruleTwo(op, pending, tracked), for insertCols / deleteCols / moveCols: pending.align && (tracked || pending.colsInserted || pending.colsChanged) -> ALIGN_FIRST; the rest as before.
```

- Behavior: the plain operation builds `final` as now, asks `keepAlignInStep`, sets `grid.alignMark.text` to its opener (or removes the mark, deleting its ledger entry and committing with `removes: true`), and the operation writes the mark once through `columnChanges` (A.4). `SPEC` goes through `columnChanges` as a one-line `Grid` (`readLine(spec, 0, spec.length)`; checked on `| :----- | ----- | ----: |` and on `--|--`, delete, insert and move all give valid rows).

- [ ] **Step 1: Write the failing tests.** Fixture: `POINT` with Bo's alignment of column 2 pending (`SPEC` of `| :----- | ----- | ----: |`, delimiter `| :----- | :---: | ----: |`). For each plain operation by Ada — `insertCols` after 0, after 1, after 3; `deleteCols` `[0]`, `[1]`, `[2]`; `moveCols` `[0]` to 3, `[2]` to 0, `[1]` to 3 — assert: the mark ends the header's last cell; `SPEC` has as many cells as the table has columns and the same columns moved or gone; `expectEveryOrderAlike(…, exactly)`; `expectNoDecisionRefused` (no option); and the **original view is the plain operation on the original** (§3.10: both views change as the plain edit says): `originalView(after).text` equals `untrackedTableEdit(originalView(before).text, op)` applied, byte for byte on the Fruit table; on a table whose delimiter cells are one dash wide (`| a | b |\n| - | - |`), where the colons of the new alignment already made the delimiter row unpadded, compare what it reads as (`blockLeaves` rows and `aligns`), because the new column's cells are as wide as the marked file's style says. Then:
  - Deleting column 2, the column the change was about: nothing is left to decide, the mark and its ledger entry are gone, the file has no mark and reads as the plain deletion.
  - A bare header (insert at the end: the line's end), an unpadded table, a CRLF file, a header whose last cell is empty.
  - Refused with `ALIGN_FIRST`: tracked by Ada or Bo; plain with a column mark pending too (hand-written merge state); plain when `SPEC` has not the table's columns.
  - `ruleTwo` matrix: the three column operations with `align` and `tracked` true or false, with and without `colsInserted`/`colsChanged`; the row operations unchanged.
  - Update `still refuses every column operation while it is pending` (A.2) to its tracked half.
- [ ] **Step 2: Run** `npx -y pnpm@10.28.0 vitest run packages/format/src/table-align.test.ts packages/format/src/table-cols.test.ts packages/format/src/table-ops.test.ts` — FAIL.
- [ ] **Step 3: Implement** `keepAlignInStep` and the three call sites. If a case of the column random suite at `REDLINES_FUZZ=1500` or the original-view equality can't be made to hold, revert only the `ruleTwo` change (the fallback), keep the rest, and say so in the PR and in `Not in this plan`.
- [ ] **Step 4: Run** the three files, `table-pairs.test.ts`, the column random suite at default fuzz, and the gate — PASS.
- [ ] **Step 5: Commit** `Format: a plain column operation keeps a pending alignment change in step (#281)`.

### Task A.6: The pair model and the random suites draw it

**Model:** `sonnet`, working carefully. Tests only unless they find a fault; every fault found is fixed in the format in its own commit first.

**Files:**
- Modify: `packages/format/src/table-pairs.test.ts`, `packages/format/src/table-cols-random.test.ts`, `packages/format/src/table-format-random.test.ts`, `packages/format/src/table-rows-random.test.ts`, `packages/format/src/test-helpers.ts` (only if a helper is missing)
- Test: the same files

**Interfaces:**
- Consumes: `tableEdit`, `untrackedTableEdit`, `expectEveryOrderAlike`, `expectNoDecisionRefused`, `everyOrder`, `fuzzCount`, `seeded`. Produces: no new export.

- [ ] **Step 1: Extend the suites.**
  - `table-pairs.test.ts`: the alignment pairs now run on the point form. Add `it('refuses a row operation on the header beside an alignment change, in either order')` and `it('allows a plain column operation beside it, and reads alike')` over the whole grid, asserting by the refusal words of "The form and the words" (the existing `REFUSALS` regexes already hold them); `it('every allowed pair that holds an alignment change has no decision refused')` counting such pairs (more than 40); if `TableOp` has `deleteTable` (Stage 4), add it to `shapes()` and assert: with another person's alignment change pending it gives rule 6's words (`Bo Chen's pending change is in this table. Decide it first.`), with your own it is written and `rejectAll` gives back the table with the old delimiter row and no mark.
  - `table-cols-random.test.ts`: keep `expectNoDecisionRefused(label, text, { unlessWithout: true, refusedWithout })` and print `refusedWithout.count` under `REDLINES_FUZZ_STATS` as the format-random suite prints its stats (no assertion on it); add a fixed `it` that draws a bare table, plain column operations and cell edits at the end of the last header cell with an alignment change pending (so the stat `withAlign` is not left to chance); and, at every step while an alignment change is pending, assert that the mark still ends the header's last cell (`alignPointIn` on that cell's content finds it) and that `originalView` has the old delimiter row. If a legitimate flow writes something after the mark, say so to the controller and settle Call 1 or 2; don't loosen the assertion on your own.
  - `table-rows-random.test.ts`: add `'align'` to its kinds (tracked and plain, one column), so that its pipe-less headers (`lead`/`trail` false) meet the mark; header-touching row operations drawn with a mark pending must be refused with the alignment words (count them, more than 0 at 1500).
  - `table-format-random.test.ts`: nothing but the stats if the suite already draws `align` and rectangles together; add a stat `withAlignAndRect` and expect it above 0 at 1500.
- [ ] **Step 2: Run** `npx -y pnpm@10.28.0 vitest run packages/format/src/table-pairs.test.ts` and the three suites at default fuzz — FAIL only where a new assertion fails; at `REDLINES_FUZZ=1500` run the three suites and read each failure's printed text.
- [ ] **Step 3: Fix** every fault the draws find in the format (a new test for it first, its own commit `Format: …`), then rerun at 1500 until clean; also with `REDLINES_SEED` set to two other values for one run each.
- [ ] **Step 4: Run** the gate — PASS.
- [ ] **Step 5: Commit** `Tests: the pair model and the random suites draw the point alignment change (#281)`.

### Task A.7: Drawing and the card

**Model:** `sonnet`.

**Files:**
- Modify: `packages/editor/src/table/columns.ts` (`alignedColumns`), `packages/editor/src/table/model.ts` (the `Cell` comment only), `packages/editor/src/blocks/cost.test.ts` (the alignment cost rows)
- Test: `packages/editor/src/table/align.test.ts`, `packages/editor/src/table/model.test.ts`, `plugins/review/src/cards.test.ts`

**Interfaces:**
- Produces: `alignedColumns(state, mark): { table: Table; cols: number[] } | null` finds, for a mark with no closer, the table of `tablesField` that holds its opener (`table.from <= open.from && open.to <= table.to`), else as today for the span form; `cols` as today. `decorations.ts` and `cards.ts` need no change (`alignAt` takes the line of `open.to`, which is the header's line for the point; `isAlignMark` skips the mark in `changeAt`). The editor's cells get the exclusion from `readRowCells` in the format.

- [ ] **Step 1: Write the failing tests.**
  - `align.test.ts`: a `POINT` fixture beside `CENTERED` (the span fixture stays as the span form's test): in Redlines each of the three rows has cells with `data-align` `['default', 'center']`, the text holds no `fmt`, `align=` or `:---:`; the dotted underline is under `Count` alone, and under `Fruit` too when its alignment changed; the header row has the bar and no other row has; Simple has the bars of Redlines and no underline, with the visible text of Clean; Clean has neither; the last header cell's text is exactly `Count` in every view (its width is the WebKit check's, A.10).
  - `model.test.ts`: the header's last cell has `textTo` in front of the mark; after typing `x` at it with Track Changes on (`input.type`), the insertion stands in front of the mark and the model's cell text is `Countx`; the caret stops are unchanged.
  - `cards.test.ts`: the card on the header row says `Formatted: column Count centered (was default)`, with Accept and Reject; Accept removes the mark and Reject writes the old row back, both in the document the card's editor holds (the span fixture's test stays).
  - `cost.test.ts`: the two alignment cost rows' comments are fixed (no "refused for now"); the pending-change row uses `tableEdit`, so it times the point form.
- [ ] **Step 2: Run** `npx -y pnpm@10.28.0 vitest run packages/editor/src/table/align.test.ts packages/editor/src/table/model.test.ts plugins/review/src/cards.test.ts` — FAIL.
- [ ] **Step 3: Implement** `alignedColumns`.
- [ ] **Step 4: Run** the three files, `REDLINES_COST=check npx -y pnpm@10.28.0 vitest run packages/editor/src/blocks/cost.test.ts -t "alignment"`, and the gate — PASS.
- [ ] **Step 5: Commit** `Editor: a point alignment change is drawn and carded (#281)`.

### Task A.8: Align Left, Center, Right and Default with Track Changes on

**Model:** `sonnet`.

**Files:**
- Modify: `packages/editor/src/table/ops.ts` (`alignCols`; delete `ALIGN_NOT_READY`), `packages/editor/src/blocks/cost.test.ts` (the tracked half of the cost row)
- Test: `plugins/tables/src/index.test.ts`, `plugins/tables/src/grips.test.ts`, `packages/editor/src/table/ops.test.ts`

**Interfaces:**
- Produces: `alignCols(view, align): boolean` with Track Changes on writes the format's tracked alignment as one step (`perform(view, { kind: 'align', table, cols, align }, 'table.align.col', select)`); a refusal is the format's, in the notice, with nothing written; the columns being aligned that way already is a silent no-op, as with Track Changes off. `select` maps the selection with the default association, so a caret at the end of the last header cell stays in front of the mark (Call 14). The command objects, the menus and `menu-model.ts` need no change: they never looked at Track Changes.

- [ ] **Step 1: Write the failing tests** (`plugins/tables/src/index.test.ts`, `describe('the alignment commands')`; the two tests about the refusal are replaced):
  - `it('are a point mark in the header with Track Changes on, one step to undo')`: `mount(doc, true)`, caret in `12`, `table.alignRight`: the document matches `/\| c<!--fmt \w{4} align=\\\|[^>]*--> \|/` in its header line, no blank line was added, the delimiter row is `| - | --: | -: |`, the caret is in the cell it was in (position of `12` shifted by the mark), the ledger holds one entry by `ada`; `undo` gives `doc` back and the selection it had.
  - `it('keeps a caret at the end of the last header cell in front of the mark')`: caret after `c` in the header, align, then type `x` with `input.type`: the insertion is in front of the mark.
  - `it('changes your own pending change in place, and takes it away when the old alignments are back')`.
  - `it('says why when another person's alignment change, a column or the header is pending')`: notices with the format's words (`Bo Chen's alignment change is pending. Decide it first.`, the column words, the row words), nothing written, no undo step.
  - `it('says why a column or header-row command is refused while an alignment change is pending')`: Insert Column Right, Delete Column, Move Column Left, Insert Row Above on the header, Delete Row on the header, Move Row Up on the first body row, tracked: the alignment words in the notice, nothing written; Insert Row Below on the header and Delete Row on a body row work; with Track Changes off the three column commands work and keep the mark at the end of the header (A.5).
  - `it('does nothing, and says nothing, for the alignment the columns have')` with Track Changes on and off.
  - `grips.test.ts`: the alignment items of the column grip's menu write the point with Track Changes on and check the caret's column afterwards.
  - `ops.test.ts`: `alignCols` with a rectangle over two columns writes one change for both.
- [ ] **Step 2: Run** `npx -y pnpm@10.28.0 vitest run plugins/tables/src packages/editor/src/table/ops.test.ts` — FAIL.
- [ ] **Step 3: Implement:** remove the `trackingField` refusal and the constant, keep the no-op test, use the default selection mapping; `cost.test.ts` loops `[false, true]`.
- [ ] **Step 4: Run** the files, `REDLINES_COST=check npx -y pnpm@10.28.0 vitest run packages/editor/src/blocks/cost.test.ts -t "alignment"`, and the gate — PASS.
- [ ] **Step 5: Commit** `Tables: Align Left, Center, Right and Default with Track Changes on (#281)`.

### Task A.9: The docs, and the size budgets

**Model:** `sonnet`.

**Files:**
- Modify: `docs/format.md` (§2.2 kinds table: a row "Alignment | `<!--fmt k3x9 align=SPEC-->` | A table's column alignment changed (§3.7) | nothing"; §2.6: the `align=SPEC` operation row and the sentence "An inline format change stays inside one block…"; §3.7: the bullet "An alignment change is a block format change (`align=SPEC`) around the table", rule 5 whole, the "Rows and columns don't change together" table and its paragraph, "Cells apart"; §3.9 one form per state; §3.10 "Tables"; §8 the review and the original views), `docs/design.md` (§5.8, "Aligning columns"), `docs/superpowers/specs/2026-11-10-tables-design.md` (the table row "Aligning a column", the rule 2 table row, rule 5), `apps/website-embed/size-budget.json` and `apps/embed-smoke/size-budget.json` only if a budget fails

**Interfaces:** none.

- [ ] **Step 1: Write §3.7's rule 5 afresh** (the plan's "The form and the words" and Calls 1 to 13 are its content). It says: the form, its place and value, accepting and rejecting write nothing outside the first two lines; one change per table; the header rule (a tracked alignment change is refused while the header is a pending row change, and a row operation on the header while one is pending, tracked or not, `Accept or reject the alignment change in this table first.`); rule 5's column refusals as they are, with the reason (`SPEC` keeps the whole old row), and plain column operations allowed with `SPEC` and the mark kept in step; the mark's cell text range, the pipe-less header and the closing pipe; the span form: "other tools write it; it is read, drawn, carded and decided, with a tracked edit right under its table refused while it is pending; Redlines writes only the point form". The table of allowed pairs's last row becomes "An alignment change | Any row change that leaves the header where it is". Remove "Redlines writes alignment changes with Track Changes off only" and its refusal words. Say in "Cells apart" that the point mark is one of the cell's marks, decided in its own tier.
- [ ] **Step 2: Update** `design.md` §5.8 ("Aligning columns": they work with Track Changes on and off; the point mark; the refusals; the span form read from other tools; a tracked edit under the table is refused only for the span form), the spec's three places, and grep `docs`, `website` and `README.md` for "alignment", "Align" and "Track Changes on" claims; fix any that still say tracked alignment is refused or "around the table".
- [ ] **Step 3: Run the size budgets:** `npx -y pnpm@10.28.0 --filter @redlines/website-embed size` and `npx -y pnpm@10.28.0 --filter @redlines/embed-smoke size`. If either is over, raise it **in a commit of its own**, with the reason in the file's note and the bytes added; if the change shrinks the bundle, leave the budget.
- [ ] **Step 4: Run** the gate — PASS (Prettier skips `docs/` and `*.md`).
- [ ] **Step 5: Commit** `Docs: a tracked alignment change is a point mark in the header row (§3.7, #281)`.

### Task A.10: The WebKit check, and the check by hand

**Model:** `sonnet`.

**Files:**
- Modify: `apps/desktop/src/table-check.ts` (the fixtures `WITH_ALIGN`, a new `WITH_ALIGN_SPAN`; the checks named below)

**Interfaces:** none (the check reads `editor.commands`, `doc(editor)`, `lineElements`, `cellElements`, `alignedAs`, `linedUp`, `colGripOf` as the file's other checks do).

- [ ] **Step 1: Replace and add checks.**
  - `align-with-track-changes-on-is-refused-in-words` becomes `align-with-track-changes-on-writes-the-point-mark-and-undoes`: Track Changes on, caret in a cell of column 2, `table.alignCenter`: `doc(editor)` has `<!--fmt` once, on the header line, in front of its last pipe; the delimiter row is centered; in Clean, Simple and Redlines the column draws centered and the columns still line up (`linedUp` off by at most 0.5 px, the right number of cells); Redlines has the bar on the header row and the dotted underline under the changed column's header text and no other; Simple the bar alone; no row grew a line; `editor.undo()` gives the document back. The same from the column grip's menu.
  - `WITH_ALIGN` becomes the point form (Bo's, with its ledger); `pending-alignment-change-in-redlines-is-drawn-carded-and-guards-the-gap` becomes `pending-alignment-change-in-redlines-is-drawn-and-carded`: underline, bar, centered column, the card text `Formatted: column Count centered (was default)` and its Accept and Reject; a letter typed with Track Changes on at the end of the last header cell lands in front of the mark and one typed on the line under the table is **written** (no notice).
  - `pending-alignment-change-in-simple` runs on the point form (bar alone, text equal to Clean's, no gap).
  - A new `span-form-alignment-change-from-another-tool-is-still-drawn-and-guards-the-gap` over `WITH_ALIGN_SPAN` (the old fixture and its old assertions, including the refused letter under the table).
  - A check that a header with no trailing pipe and one with trailing spaces draw the same as a padded one when a point mark is pending.
- [ ] **Step 2: Run** in `apps/desktop`: `VITE_TABLE_CHECK=1 npx -y pnpm@10.28.0 dev --port 1458 --strictPort`, open `http://localhost:1458` in WebKit (Safari, or `pnpm tauri dev` for WKWebView), and read the console's last line: `... done <n> passed, <n> failed` — 0 failed.
- [ ] **Step 3: By hand** (the PR records it): Align Center from the Table menu and its key-less item with Track Changes on, hover and press the card, Accept and Reject from the card and from the review bar, Undo; the same in a table with no outer pipes; the change another person made, in light and dark, with VoiceOver on the header row (the mark is not announced).
- [ ] **Step 4: Commit** `WebKit check: tracked alignment, drawn, carded and undone (#281)`.

**THE PR OPENS HERE** (closes #281; refs #294, #180): run the three table random suites at `REDLINES_FUZZ=1500`, the cost rows with `REDLINES_COST=check`, and the full gate once.

## Not in this plan

- Two alignment changes in one table (a merge can write them; their rejections would not read alike). Not read specially and not repaired.
- A mark that a merge or a text edit left in a body row: it is read, decided and drawn, but a row operation on that row (your own deleting it) folds it away without a word (Design problem 2, input B). The plan keeps it from happening by operations; it does not guard the state.
- Tracked column operations beside a pending alignment change (Calls 6 and 7; Design problem 3). If A.5 is reverted to its fallback, plain ones stay refused too.
- Plain edits of the delimiter row in Raw beside a pending alignment change (`SPEC` is not edited by them; a later reject can say `LOST`).
- Writing an alignment change by hand in Raw: Raw is the source as written.
- Narrowing `scopeOf` for a pending alignment change so that a keystroke checks only its cell's lines (cost only; Call 15).
- Moving an alignment change from the span form to the point form when it is touched (a span is left as it is, Call 11).
- An alignment change in Word export (`w:pPrChange`) and in the pandoc filter: design only today.
- An agent's `str_replace` that changes the delimiter row: still a cell edit, as on main; `packages/agent-tools/src/prompt.ts` is unchanged.
- A margin note or rail entry for the point mark: the card on the header row is what exists.
- Delete Table's own tests of a pending alignment change, beyond the pair model's `deleteTable` case in A.6 (Stage 4 owns the operation).
- Live-session simulations of alignment changes (format §13 item 4 stays open).
