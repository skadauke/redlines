# Block Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Return, Shift-Return, Backspace, Delete, Tab and Shift-Tab edit blocks as a word processor does, with the blank lines between blocks hidden, in Clean and Redlines, with Track Changes on and off.

**Architecture:** A block layer in `packages/editor/src/blocks/` reads the block at the caret from the syntax tree, and each key computes plain edits that the existing tracked layer records through `trackedEdit` or `untrackedEdit` (block changes through `trackedFormat`). Blank lines between blocks are hidden lines with spacing drawn by kind; the empty paragraph Return opens is a transient state field plus a record that lets Backspace take a Return back exactly. A few format rules are added so that no ordinary key is refused.

**Tech Stack:** TypeScript (strict), CodeMirror 6 (view 6.43, commands 6.11, lang-markdown 6.5, `@lezer/markdown`), `@redlines/format`, vitest with happy-dom, micromark 4.0.2 as the format's oracle. pnpm is `npx -y pnpm@10.28.0`.

**Spec:** `docs/superpowers/specs/2026-11-10-block-editing-design.md` (read it first; its tables are the expected behavior, and every "Call:" in it is decided). The builder check that fed it is not in the repo.

## Global Constraints

- `docs/format.md` is the source of truth for `packages/format`; a rule that changes it is written there in the same task (AGENTS.md).
- A key makes one block lookup and one format call; Return and Backspace on 16 KB and 150 KB documents with 200 marks cost what they do on main (measured in Task 1.20).
- Keys apply in Clean and Redlines only; Raw keeps CodeMirror's keys and is read-only with Track Changes on. Text editing stays native (spell check, input methods, dictation); autocorrect stays off.
- Interface text takes `var(--rl-size-ui)` / `var(--rl-size-ui-small)` (at least 13 px, 12 for captions) and passes `apps/desktop/src/interface-text.node.test.ts`.
- Anti-goals are test failures: a refused ordinary key, a Return plus Backspace that does not give the file back byte for byte, stray blank lines or a tight list turned loose, a change mark for something no reader sees, the caret on an invisible line, text landing in another block, decoration changes on a composing line, new chrome, Tab trapping the keyboard.
- TypeScript: `import type`, no enums, strict flags of `tsconfig.base.json`; Prettier width 100, single quotes. A test needing a DOM starts with `// @vitest-environment happy-dom`; one needing Node types is named `*.node.test.ts`.
- Each stage is its own branch and PR; the standard gate before every commit is `pnpm typecheck && pnpm lint && pnpm test && pnpm format:check` (the "gate" below), and after a task touching `packages/format` also `scripts/build-redlines` in `apps/desktop` before the Rust tests.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; no source outside the stage's tasks changes.

## Review Focus

Failure modes the spec implies but no table row exercises, most likely first; each has its test in the named task.

- A file with CRLF line endings: Return, Backspace and the take-back write and give back the file's own line endings byte for byte, and the empty paragraph is never saved (Task 1.13).
- The last block just before the ledger comment (`One two.⏎⏎<!-- redlines …-->`): Return at its end opens the empty paragraph above the ledger, not inside it, and saving mid-way leaves the ledger untouched (Task 1.13).
- Select-all then Delete, Backspace or Return, and typing over a select-all, in every block mix: ends as one empty paragraph that `getDoc` reads as `""` (or the ledger alone), never a hidden-line-only document or a caret in a hidden range (Task 1.16).
- Save, close, switch to Raw, accept a decision or receive an agent's edit while the empty paragraph is open: the file text has no stray blank line, the host's dirty state is not set by a Return alone, and the caret lands in a visible block (Task 1.11 and Task 1.12).
- Lists nested with tab characters or four-space continuation and text with emoji, CJK or combining marks at block edges: the ladder's hard break goes at the item's own text column in the file's own indentation, and no key splits a surrogate pair or combining sequence (Task 1.17 and Task 1.16).

---

# Stage 1: Blocks are structure

Ends with the shipped model: hidden blank lines, Return, Backspace and Delete at block edges, the empty paragraph and its record, and the format rules they need. Checked in WKWebView by hand (Task 1.20) before it ships.

### Task 1.1: The keystroke-script harness

**Files:**
- Create: `packages/editor/src/blocks/script.ts`, `packages/editor/src/blocks/script.test.ts`
- Read: `packages/editor/src/tracked/typing.test.ts` (its `load`, `randomIds`, `runScopeHandlers` use)

**Interfaces:**
- Produces:
  - `type KeyName = 'Enter' | 'Shift-Enter' | 'Backspace' | 'Delete' | 'Tab' | 'Shift-Tab' | 'ArrowLeft' | 'ArrowRight' | 'Alt-Backspace' | …` (a CodeMirror key name).
  - `interface Script { name: string; doc: string; keys: (KeyName | { type: string })[]; tc: boolean; ids?: string[]; others?: string; expect: { file?: string; newest?: string; original?: string; caret?: string; refusal?: string } }`. `doc` and `caret` use the design's notation: `‸` caret (or `[` `]` for a selection), `⏎` line break, `·` no-break space, and `<split>`, `<ins>x</ins>`, `<del x>`, `<sub x>y</sub>`, `<fmt was=…>` expanded to the format's markers with the given `ids`.
  - `runScript(s: Script): ScriptResult`, and `checkInvariants(result): void` (below).
  - `scriptRows(rows: Script[]): void` registers one `it` per row.

- [ ] **Step 1: Write the failing test** in `script.test.ts`: `runScript({ name: 'noop', doc: 'One.‸', keys: [], tc: false, expect: { file: 'One.' } })` passes; a script with `keys: ['Enter']` on `One two.‸⏎⏎Next.` expecting a wrong text fails with a readable diff; `‸` inside a hidden range is reported.
- [ ] **Step 2: Run** `pnpm exec vitest run packages/editor/src/blocks/script.test.ts` — FAIL (module missing).
- [ ] **Step 3: Implement `runScript` and `checkInvariants`** on a real `createEditor` with the formatting plugin's commands, keys through `runScopeHandlers`, as the findings' probes did. `checkInvariants` asserts, after every script: the caret is in no hidden range (`atomic`/`pastHidden` from `tracked/test-helpers.ts`); `getDoc()` holds no empty paragraph and no `·` of an empty line; the tracked text passes the format's checks (`parse` has no problems, `newestView`/`originalView` equal the views the script expects, and every order of decisions reads as the views via `acceptAll`/`rejectAll` and a random order); no marker starts a line; no refusal unless `expect.refusal`, then its words; Return-then-Backspace on the same script (when `keys` is a single Enter) gives back `doc` byte for byte and an unchanged ledger; Undo after each key gives back the state before it.
- [ ] **Step 4: Run** the test — PASS; then the gate.
- [ ] **Step 5: Commit** `Editor: keystroke scripts for the block editing suite (#168)`.

### Task 1.2: Format rule 1, a block change of your own new block is an edit (#173)

**Files:**
- Modify: the format's block-change code (`packages/format/src/format-blocks.ts`, `formatting.ts`); `docs/format.md` §2.6 ("Your own pending changes don't count")
- Test: `packages/format/src/format-blocks.test.ts`

**Interfaces:** Produces: `trackedFormat` on a block that is all your own pending insertion, or an item your pending split made, writes the new syntax into that change and no mark of its own.

- [ ] **Step 1: Write the failing tests**: `trackedFormat` Heading 2 on `One.⏎⏎<ins>⏎⏎A paragraph</ins>` by the insertion's author gives `One.⏎⏎<ins>⏎⏎## A paragraph</ins>` with no `<fmt>`; the same by another author is still refused; indent on `- two<ins><split>⏎- X</ins>` (own) gives `- two<ins><split>⏎  - X</ins>`; rejecting the insertion gives back `One.`; both views read right in every order of decisions.
- [ ] **Step 2: Run** `pnpm exec vitest run packages/format/src/format-blocks.test.ts` — FAIL ("A pending change or a comment starts this block…").
- [ ] **Step 3: Implement** the exemption beside format §2.6's inline "own pending changes" rule; edit `docs/format.md` §2.6 as the design's "Changes to format.md" says.
- [ ] **Step 4: Run** — PASS; gate.
- [ ] **Step 5: Commit** `Format: a block change of your own new block edits it (#173)`.

### Task 1.3: Format rule 10, Return next to a hard line break

**Files:**
- Modify: `packages/format/src/track.ts` (split placement), `docs/format.md` §3.4
- Test: `packages/format/src/typing.test.ts`

**Interfaces:** Produces: `trackedEdit` of a paragraph break replacing a hard break (`\⏎`) is written, not refused, for the original text's break and for another person's; and for your own pending hard break the split takes a blank line as its break.

- [ ] **Step 1: Write the failing tests**: original `One \⏎two.` with the edit `\⏎` → `⏎⏎` (Track Changes on) is a substitution of the break, newest view `One ⏎⏎two.`, original view unchanged; your own `One <split>\⏎two.` edited the same way gives `One <split>⏎⏎two.` (newest view has the paragraph break); other author's pending hard break gives a substitution; `untrackedEdit` on `One \⏎⏎⏎two.`-producing input never leaves a trailing literal backslash.
- [ ] **Step 2: Run** `pnpm exec vitest run packages/format/src/typing.test.ts -t "hard line break"` — FAIL.
- [ ] **Step 3: Implement** the three forms; document in format.md §3.4 ("Return next to a hard line break").
- [ ] **Step 4: Run** — PASS; gate.
- [ ] **Step 5: Commit** `Format: Return next to a hard line break is written`.

### Task 1.4: Format rule 11, a typed backslash is not followed by a closer

**Files:**
- Modify: `packages/format/src/track.ts`, `docs/format.md` §3.1
- Test: `packages/format/src/typing.test.ts`

**Interfaces:** Produces: no `trackedEdit` writes a closer directly after an unescaped backslash; the form is the implementer's, checked by micromark.

- [ ] **Step 1: Write the failing tests**: typing `\` mid-line (`One two.` → `One\ two.`) and inserting `\` in front of a soft break (`One two⏎three.`) with Track Changes on give text where no `<!--/ID-->` follows an unescaped `\`; micromark renders the tracked text (markers stripped by the format's own view) without a stray `<` as text; accepting and rejecting give `One\ two.` and `One two.`.
- [ ] **Step 2: Run** — FAIL (`\<!--/X-->` written today).
- [ ] **Step 3: Implement** the fix (for example ending the insertion after the next character, or a form §3.1 already allows) and state it in §3.1; file nothing else.
- [ ] **Step 4: Run** — PASS; gate.
- [ ] **Step 5: Commit** `Format: a typed backslash is never followed by a closer`.

### Task 1.5: Format rule 12, Return at the end of an item's last paragraph in numbered steps (#204)

**Files:**
- Modify: whichever module raises "A marker here would start a line." for this input (find it with the failing test); `docs/format.md` only if the rule changes
- Test: `packages/format/src/typing.test.ts`

- [ ] **Step 1: Write the failing test**: `1. a⏎⏎   b` with the edit `⏎⏎2. ` at the end of `b` (Track Changes on, as a split) is written as `…b<split>⏎⏎2. ` with both views right, and not refused; the same for `10. a⏎⏎    b`.
- [ ] **Step 2: Run** — FAIL with "A marker here would start a line."; find its cause in the output and note it in the commit.
- [ ] **Step 3: Implement** the fix in the format library; keep the refusal for the inputs that truly start a line.
- [ ] **Step 4: Run** — PASS; gate.
- [ ] **Step 5: Commit** `Format: Return at the end of a numbered item's last paragraph is written (#204)`.

### Task 1.6: Block structure

**Files:**
- Create: `packages/editor/src/blocks/structure.ts`, `packages/editor/src/blocks/structure.test.ts`
- Read: `packages/editor/src/preview/decorations.ts` (how it reads the tree), `packages/format/src/block-read.ts`

**Interfaces:**
- Produces (pure, over `EditorState`):
  - `type BlockKind = 'paragraph' | 'heading' | 'code' | 'table' | 'html' | 'front-matter' | 'rule' | 'math' | 'definition'`.
  - `interface Container { kind: 'item' | 'quote'; prefix: { from: number; to: number }; depth: number; ordered?: boolean; task?: 'open' | 'done'; loose?: boolean }`.
  - `interface Block { kind: BlockKind; level?: number; setext?: boolean; text: { from: number; to: number }; lines: { from: number; to: number }; prefix: { from: number; to: number }; containers: Container[] }`.
  - `interface Break { from: number; to: number; blank: number; hidden: { from: number; to: number }[] }`.
  - `blockAt(state, pos): Block | null`, `breakBefore(state, block): Break | null`, `breakAfter(state, block): Break | null`, `neighbours(state, block): { prev: Block | null; next: Block | null }` (skipping lines that hold only markers).

- [ ] **Step 1: Write the failing tests**: a table of documents with `‸` and the expected `Block` for each kind in the design's matrices: paragraph, ATX and setext heading, a tight and a loose item with nested items at depth 1 to 3, numbered and task items, a quote in a list item and an item in a quote, a lazy line of a quote (text range includes the lazy line), code (fenced, indented), table, HTML block, front matter, thematic break, math, a link reference definition. Plus `neighbours` skips marker-only lines and returns the nested item's last line for the item above.
- [ ] **Step 2: Run** `pnpm exec vitest run packages/editor/src/blocks/structure.test.ts` — FAIL.
- [ ] **Step 3: Implement** by walking up `syntaxTree(state)` from `pos`; where lezer and CommonMark could differ (lazy line, fence info string with a backtick, HTML block start, front matter) check the few lines around with the format's block reading (export `block-read.ts`'s reader from `@redlines/format` if not exported).
- [ ] **Step 4: Run** — PASS; gate.
- [ ] **Step 5: Commit** `Editor: the block at a position, read from the syntax tree (#168)`.

### Task 1.7: Open inline constructs, and lezer against micromark

**Files:**
- Modify: `packages/editor/src/blocks/structure.ts`
- Test: `packages/editor/src/blocks/structure.test.ts`, `packages/editor/src/blocks/structure-agree.test.ts`
- Read: `packages/format/src/random-docs.ts`

**Interfaces:** Produces: `openConstructs(state, pos): { kind: 'emphasis' | 'strong' | 'strike' | 'code' | 'link' | 'atom'; from: number; to: number; open: string; close: string; tail?: string }[]` (`tail` is a link's `](url)`), innermost last.

- [ ] **Step 1: Write the failing tests**: at `One **bold ‸text** two.` one `strong` construct with `open: '**'`; inside `[the ‸guide](https://x.example)` a `link` with `tail`; inside `` `npm ‸install` `` a `code`; at a construct's edge none (the break goes outside); inside an image or autolink an `atom`. Agreement test: on the format's random documents (`random-docs.ts`, seeded, longer under `REDLINES_FUZZ`) every `blockAt` boundary equals micromark's block boundaries, or the test records the case where the keys defer to the format's reading.
- [ ] **Step 2: Run** both files — FAIL.
- [ ] **Step 3: Implement** `openConstructs` from lezer's inline tree.
- [ ] **Step 4: Run** — PASS; gate.
- [ ] **Step 5: Commit** `Editor: the inline constructs open at a position`.

### Task 1.8: Front matter is one block (#154)

**Files:**
- Create: `packages/editor/src/blocks/front-matter.ts` (a `@lezer/markdown` `MarkdownConfig` extension)
- Modify: the `markdown({ extensions })` setup in `packages/editor/src/index.ts`; `packages/editor/src/preview/decorations.ts` (`frontMatterEnd` goes; the preview reads the node)
- Test: `packages/editor/src/preview/preview.test.ts`, `packages/editor/src/blocks/structure.test.ts`

**Interfaces:** Produces: a `FrontMatter` node for leading `---…---` or `---…...` front matter; `blockAt` returns `kind: 'front-matter'` there.

- [ ] **Step 1: Write the failing tests**: front matter closed by `...` is one block (#154) and a list key under it works as the block structure sees it; the preview draws the same as before for closed-by-`---` front matter; a `---` rule later in the file is not front matter.
- [ ] **Step 2: Run** the two files — FAIL.
- [ ] **Step 3: Implement** the extension and switch the preview over; delete `frontMatterEnd`.
- [ ] **Step 4: Run** — PASS; gate.
- [ ] **Step 5: Commit** `Editor: front matter is one block of the Markdown parse (#154)`.

### Task 1.9: Hidden blank lines

**Files:**
- Create: `packages/editor/src/blocks/hidden.ts`
- Modify: `packages/editor/src/tracked/decorations.ts` (one hidden-line computation, atomic ranges, `caretOutOfHiding`), `packages/editor/src/preview/decorations.ts` (`gaps()` goes), `packages/editor/src/preview/table.ts` (look for the table's widget, not any block decoration)
- Test: `packages/editor/src/blocks/hidden.test.ts`, `packages/editor/src/preview/preview.test.ts` (the `rl-gap` test is replaced)

**Interfaces:**
- Produces: `hiddenLines(state): RangeSet<HiddenRun>` (whole blank lines between blocks with the line breaks around them, marker lines as now, the ledger; excluding blank lines inside code, front matter, math, HTML blocks that hold them, and the open empty block); `atomicRanges` over each run.
- Consumes: `blockAt`, `breakAfter` (Task 1.6).

- [ ] **Step 1: Write the failing tests**: in Clean and Redlines no visible blank line between `One.⏎⏎Two.`, `One.⏎⏎⏎⏎Two.` and `## H⏎Para.` (the last has none to hide); blank lines in code stay; Raw draws every line; ↑/↓ via `moveVertically` never land on a hidden line; a typed `>` line the caret is on is not hidden as "only markers" (#167's caret rule); the change bar of a break whose marker is on a hidden line is drawn on the line where the break is drawn and its card opens from there (#198), with line break marks hidden and shown (#161); a table is still keyed to its widget; 4,000 own-line markers keep the pass linear (time two sizes and compare the ratio, #20).
- [ ] **Step 2: Run** `pnpm exec vitest run packages/editor/src/blocks/hidden.test.ts packages/editor/src/preview/preview.test.ts` — FAIL.
- [ ] **Step 3: Implement** `hiddenLines` in the pass that finds marker lines today (once per change, sorted spans); replace `gaps()`; keep `caretOutOfHiding` moving a caret in a hidden range to the nearest block.
- [ ] **Step 4: Run** — PASS; gate.
- [ ] **Step 5: Commit** `Editor: blank lines between blocks are hidden in Clean and Redlines (#168)`.

### Task 1.10: Spacing by kind, and numbers as Markdown counts them

**Files:**
- Modify: `packages/editor/src/preview/decorations.ts`, `packages/editor/src/preview/theme.ts`, `plugins/themes/src/tokens.css` (spacing tokens)
- Test: `packages/editor/src/preview/preview.test.ts`

**Interfaces:** Produces: `Decoration.line` classes with `padding-top` from tokens on the first line after each hidden run: 16 px between blocks, 18 px under a heading 1, 10 px under headings 2 to 6, 6 px between items of a tight list, 16 px between the items of a loose list and the paragraphs of a quote or an item. List numbers are drawn as CommonMark counts them (first number, then +1), the source number shown when the caret is on the marker.

- [ ] **Step 1: Write the failing tests**: the same spacing class for a paragraph under a heading with no blank line, one, or three; tight vs loose item spacing; `1. a⏎1. b⏎5. c` drawn as 1, 2, 3; `3. a⏎7. b` drawn as 3, 4; the number reverts to its source with the caret on the marker; the spacing and numbers are computed from `textWithoutOpen` plus a character in the open block when one exists (stub the open block until Task 1.11; the test for it lands there).
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** with the theme tokens (names within design §6.6; tokens in `tokens.css`, none in em for interface text).
- [ ] **Step 4: Run** — PASS; gate and `interface-text.node.test.ts`.
- [ ] **Step 5: Commit** `Editor: the space between blocks is drawn by their kinds; numbers as counted`.

### Task 1.11: The empty block, `textWithoutOpen`, and the file never gets it

**Files:**
- Create: `packages/editor/src/blocks/open.ts`, `packages/editor/src/blocks/open.test.ts`
- Modify: `packages/editor/src/index.ts` (`getDoc`, `onChange`, the host's edited state, Raw switch, an empty document), `packages/editor/src/preview/decorations.ts` (spacing reads it)

**Interfaces:**
- Produces: `openBlockField: StateField<OpenBlock | null>` with `interface OpenBlock { empty: { from: number; to: number }; pressedIn: { from: number; to: number } | null }`; `textWithoutOpen(state): string`; `openBlock(state)`. A transaction filter takes the open block back (removes its line breaks as an ordinary transaction, one undo step) when a transaction moves the selection out of it and its `pressedIn` block, or when another change touches its line; any empty line between blank lines or at the document's edges the caret lands on becomes the open block (⌘Z of typing, of a take-back, deleting all your own new paragraph's text with Track Changes on); an empty document is one empty paragraph; take-backs wait for `compositionend`.

- [ ] **Step 1: Write the failing tests**: with a block opened by a test helper at `One two.⏎⏎‸⏎⏎Next.`, `getDoc()` and the `onChange` text are `One two.⏎⏎Next.` and a Return alone does not set the edited state; moving the caret to `Next.` removes the lines; typing `X` there keeps it as a paragraph; switching to Raw takes it back first; an empty document `getDoc()` is `''`; a file ending `One two.⏎⏎<!-- redlines …-->` keeps the ledger intact while open (Review Focus); spacing and numbers of `- one⏎⏎‸⏎⏎- two` are computed as if the open block held a character (the list is not drawn loose).
- [ ] **Step 2: Run** `pnpm exec vitest run packages/editor/src/blocks/open.test.ts` — FAIL.
- [ ] **Step 3: Implement** the field, the filter and `textWithoutOpen`; route `getDoc`/`onChange`/save through it.
- [ ] **Step 4: Run** — PASS; gate.
- [ ] **Step 5: Commit** `Editor: the empty paragraph exists only while the caret is in it (#168)`.

### Task 1.12: The record of Returns, history, the view, the mouse, `reloadDoc`

**Files:**
- Modify: `packages/editor/src/blocks/open.ts`, `packages/editor/src/history.ts` (`outsideField` skips marked take-backs), `packages/editor/src/index.ts` (`reloadDoc`, view switch)
- Test: `packages/editor/src/blocks/open.test.ts`, `packages/editor/src/history.test.ts`

**Interfaces:**
- Produces: `recordField: StateField<Record>` where `interface Taken { changes: ChangeSet; view: ViewMode }` holds each Return's inverse changes and the view it switched from; `takeBack(view): boolean` (used by Backspace/Delete, Task 1.13); `const takeBackAnnotation: AnnotationType<true>` read by `outsideField`. Any other edit (typing, a command, an agent's edit) ends the record; so does the caret leaving, once the empty block is taken back. Take-backs go in with `addToHistory: false` and the annotation, so CodeMirror's history drops the Returns' events; when the record isn't intact the generic removal goes in as one ordinary undo step. The mouse: a mousedown leaving the open block does not take it back until the selection ends. `reloadDoc` diffs against `textWithoutOpen` and maps the open block through the diff (stays open when the blocks on either side survive, else the caret goes to the end of the block above).

- [ ] **Step 1: Write the failing tests**: two Returns then `takeBack` twice gives `doc` byte for byte with an unchanged ledger, tracked and not; after leaving an empty paragraph with nothing done between, ⌘Z undoes what came before the Returns; with something done between, ⌘Z brings the empty paragraph back; the view Return switched from is restored; a mouse selection leaving the block takes it back at its end and the text under the pointer does not move first; `reloadDoc` while open with an agent edit above keeps the caret in the open block, and one that removes a neighbour puts it at the end of the block above; the record survives switching Clean and Redlines (Review Focus: also accept/reject while open leaves no stray blank line).
- [ ] **Step 2: Run** both files — FAIL.
- [ ] **Step 3: Implement** as described, marking take-backs so `outsideField` skips them.
- [ ] **Step 4: Run** — PASS; gate.
- [ ] **Step 5: Commit** `Editor: Returns are recorded, and taken back exactly (#168)`.

### Task 1.13: Return in paragraphs, headings and quotes

**Files:**
- Create: `packages/editor/src/blocks/edits.ts` (pure `planReturn`), `packages/editor/src/blocks/keys.ts` (the keymap at `Prec.highest`, Clean and Redlines only, `applyKeyEdit`), `packages/editor/src/blocks/paragraph-keys.test.ts`
- Modify: `packages/editor/src/index.ts` (install the extension above `editingKeymap`)

**Interfaces:**
- Produces: `interface KeyEdit { changes: ChangeSpec[]; selection: EditorSelection; userEvent: 'input.break' | 'input.break.line' | 'delete.backward.block' | 'delete.forward.block' | 'indent'; refusal?: string; block?: FormatOp }`; `planReturn(state): KeyEdit | null` (null declines, so CodeMirror's key runs); `applyKeyEdit(view, edit): boolean` (isolates history so each key is one undo step, records into the record of Task 1.12, opens the empty block).
- Consumes: Tasks 1.6, 1.11, 1.12.

- [ ] **Step 1: Write the failing tests** via `scriptRows`: every row of the design's Paragraphs, Headings and Quotes tables that has no list, selection, inline-syntax or hard-break case, with Track Changes on and off, including the ✓ forms (end, middle `One <split>⏎⏎‸two.`, start, soft line break, first block, last block `One two.⏎`, paragraph right under a heading, setext heading, pending change on the heading, quote end/middle/start/lazy line/leaving, alert first line, "Return in an empty paragraph does nothing", "Return again at the start of a block whose empty paragraph is open above"); Return then Backspace gives the file back; a CRLF file keeps its line endings through Return, Backspace and the take-back (Review Focus); Return at the end of the last block before the ledger opens the paragraph above the ledger (Review Focus).
- [ ] **Step 2: Run** `pnpm exec vitest run packages/editor/src/blocks/paragraph-keys.test.ts` — FAIL.
- [ ] **Step 3: Implement** `planReturn` for these blocks: a new block gets a blank line above and below whatever the file's habit; edits are plain text edits (the tracked layer records them); order of edits inside one transaction respects that the format processes last first.
- [ ] **Step 4: Run** — PASS; gate.
- [ ] **Step 5: Commit** `Editor: Return makes a block (#168)`.

### Task 1.14: Return in list items

**Files:**
- Modify: `packages/editor/src/blocks/edits.ts`, `packages/editor/src/blocks/keys.ts`
- Test: `packages/editor/src/blocks/list-keys.test.ts`

**Interfaces:** Consumes: `planReturn` (Task 1.13), format rules 12 (Task 1.5) and 1 (Task 1.2). Extends `planReturn` to items.

- [ ] **Step 1: Write the failing tests** via `scriptRows`: every row of the design's List items table and its Containers table, tracked and not: end of a filled item, loose list, item with nested list, first paragraph with a second after it, middle, start, empty nested item up a level, empty top-level item (last, middle), list in a quote, numbered (next number, `1.` throughout, middle of the list: no renumbering), task items (new unchecked item, empty task item leaves the list), the empty item that holds nested items, end of an item's last paragraph in numbered steps (#204, `1. a⏎⏎   b‸` writes `…b<split>⏎⏎2. ‸`, not refused), start of a task item's text; the chain `- one⏎  - sub⏎⏎After.` Return, Return, Return, then Backspace three times gives the starting text exactly, tracked and not.
- [ ] **Step 2: Run** `pnpm exec vitest run packages/editor/src/blocks/list-keys.test.ts` — FAIL.
- [ ] **Step 3: Implement** the item rules; one container per Return; an empty paragraph in an item that already has a second paragraph after it stays inside the item.
- [ ] **Step 4: Run** — PASS; gate.
- [ ] **Step 5: Commit** `Editor: Return in list items (#168, #204)`.

### Task 1.15: Return inside inline syntax, at breaks, over selections

**Files:**
- Modify: `packages/editor/src/blocks/edits.ts`
- Test: `packages/editor/src/blocks/return-edge-cases.test.ts`

**Interfaces:** Consumes: `openConstructs` (Task 1.7), format rule 10 (Task 1.3).

- [ ] **Step 1: Write the failing tests** via `scriptRows`: inside bold, emphasis, strikethrough, a code span and a link's text both halves render with no delimiter showing (the rendering check is part of `checkInvariants` here: render each half with micromark), with the probed forms for bold and link; at a construct's edge and in an atom the break goes outside; Return either side of a hard break and right after Shift-Return (the record takes it back, then Return acts); selections in one paragraph, across two blocks and across three or more; a selection of all of one block's text; Return before an opening fence, a table's first `|` or an HTML block with no paragraph above; a heading's inline construct.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** the close-and-reopen (a space at the split goes outside the delimiters), the hard-break replacement, and selection handling that keeps each block's kind.
- [ ] **Step 4: Run** — PASS; gate.
- [ ] **Step 5: Commit** `Editor: Return inside inline syntax, at hard breaks and over selections`.

### Task 1.16: Backspace and Delete at block edges

**Files:**
- Modify: `packages/editor/src/blocks/edits.ts` (`planBackspace`, `planDelete`), `packages/editor/src/blocks/keys.ts` (Backspace, Delete, Alt-/Cmd-Backspace and Alt-Delete at an edge)
- Test: `packages/editor/src/blocks/backspace-delete.test.ts`

**Interfaces:** Produces: `planBackspace(state): KeyEdit | null`, `planDelete(state): KeyEdit | null`. Backspace right after a Return calls `takeBack` first (Task 1.12). List items' first press is Task 1.17: here an item above takes the join form only for the "second press".

- [ ] **Step 1: Write the failing tests** via `scriptRows`: every row of "Backspace and Delete at block edges" except the list-item ladder: paragraph and heading joins (kind of the block above kept), paragraph after a list, empty heading/item/quote above, code/table/HTML/front matter/definition above (caret moves, nothing deleted), thematic break deleted, first block, first item of a nested or top-level list, quote's first and later paragraphs, empty paragraph/item (any depth, #204: `- one⏎  - ‸` goes, no stray marker at 2 spaces), a later paragraph of an item (#204), Delete joins and empties, inside-code edges do nothing, an empty code block goes whole; selections including the start-to-start selection (covered blocks go whole, both modes); the two lazy-line and numbered-join Calls; atoms: no key splits a surrogate pair or a combining sequence (emoji, CJK, `é` as `e` + U+0301) at an edge (Review Focus); select-all then Delete, Backspace, Return and typing end as one empty paragraph, `getDoc()` `''` (Review Focus).
- [ ] **Step 2: Run** `pnpm exec vitest run packages/editor/src/blocks/backspace-delete.test.ts` — FAIL.
- [ ] **Step 3: Implement**; block changes of a block that stands alone go through `trackedFormat`/`untrackedFormat`, others as the plain edit through `trackedEdit`/`untrackedEdit` (the suite pins which).
- [ ] **Step 4: Run** — PASS; gate.
- [ ] **Step 5: Commit** `Editor: Backspace and Delete act on blocks (#168, #204)`.

### Task 1.17: Backspace at a list item's start, Word's two presses

**Files:**
- Modify: `packages/editor/src/blocks/edits.ts` (`planBackspace` list item branch)
- Test: `packages/editor/src/blocks/list-ladder.test.ts`

- [ ] **Step 1: Write the failing tests** via `scriptRows`: tight `- one⏎- ‸two` first press `- one\⏎  ‸two`, tracked `- one<del ⏎- ><split>\⏎  ‸two`; second press `- one‸two`, tracked `- one<del ⏎- >‸two` with the split cancelled; loose `- one⏎⏎- ‸two` first press `- one⏎⏎  ‸two`, tracked `- one<sub ⏎⏎- two>⏎⏎  ‸two</sub>`; the item above has a nested last item (continuation at that item's text column); numbered items; an item whose own nested items follow (they become the item above's); the item above ends in a heading (joins at once), in code/table (caret moves); a list indented with tab characters or four spaces keeps the file's own indentation in the hard break line (Review Focus); empty item skips the first press; first item of a nested list goes up a level, of a top-level list out of the list (`<fmt was=ul>` for a one-item list); Backspace right after Return takes one press (the record), not the ladder; Delete at an item's end joins the next at once.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** the ladder as a branch of `planBackspace` using the plain edit through `trackedEdit` (not `trackedFormat`, which refuses a block that doesn't stand alone).
- [ ] **Step 4: Run** — PASS; gate.
- [ ] **Step 5: Commit** `Editor: Backspace at a list item removes the bullet, then joins`.

### Task 1.18: Shift-Return, Return in tables and HTML, Option variants

**Files:**
- Modify: `packages/editor/src/blocks/edits.ts` (`planShiftReturn`, table/HTML Return), `packages/editor/src/blocks/keys.ts`
- Test: `packages/editor/src/blocks/shift-return.test.ts`

- [ ] **Step 1: Write the failing tests** via `scriptRows`: Shift-Return mid-text in a paragraph, item and quote (`One \⏎‸two.`, tracked `One <split>\⏎‸two.`, takes the item's text column, `> ` prefix); at a block's end it does what Return does (the empty paragraph) in this stage; at a soft line break `One two\⏎‸three.` (tracked sound through rule 11); in emphasis/link inside, after a code span; across blocks (join, then the hard break); in a heading and a table cell refused with "A heading is one line in Markdown." / "A table cell is one line in Markdown."; in code and front matter a plain line break; Return at the end of the last table row opens the empty paragraph after the table, in a row nothing; Return at the end of an HTML block's last line opens the empty paragraph after it.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement**; the refusal goes through `refusedEditEffect` so the host shows its notice.
- [ ] **Step 4: Run** — PASS; gate.
- [ ] **Step 5: Commit** `Editor: Shift-Return, and Return in tables and HTML blocks`.

### Task 1.19: Arrows, clicks, the Mac control keys, `beforeinput`

**Files:**
- Modify: `packages/editor/src/blocks/keys.ts`, `packages/editor/src/preview/decorations.ts` (`atxHeading`, `quoteMark` show source only while the caret is inside), `packages/editor/src/tracked/typing.ts` (`editingKeymap` entries overridden)
- Test: `packages/editor/src/blocks/navigation.test.ts`

- [ ] **Step 1: Write the failing tests**: ← at the start of a heading's text goes to the end of the text above in one press (and → back), over a prefix showing or not; ⌘←/⌘→ on a block's first row stop at the text's start; ↑/↓ keep the column across hidden lines; a click in the upper half of a gap puts the caret at the end of the block above at the click's column, in the lower half in the block below, below the last block at its end; a heading's `#`s and a quote's `>` show only while the caret is inside them; ⌃H/⌃D act as Backspace/Delete, ⌃K and ⌘⌦ at a block's end as Delete, ⌘Return as Return at the end of the block, ⌃O as Return with the caret left, ⇧⌘K/⌃L only on the text, ⌃T nothing across a break, ⌃A/⌃E as ⌘←/⌘→; a `beforeinput` of `insertParagraph` is Return and `insertLineBreak` is Shift-Return; a user edit from anything else that adds or removes a line break in a hidden run is dropped.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement**; CodeMirror's own keys run when a block key declines.
- [ ] **Step 4: Run** — PASS; gate.
- [ ] **Step 5: Commit** `Editor: the caret crosses breaks in one press; control keys act on blocks`.

### Task 1.20: Random walks, the issue scripts, cost, documents, WKWebView

**Files:**
- Modify: `packages/editor/src/tracked/typing-random.test.ts` (extend), `docs/design.md` (§5.1, new §5.13, §5.3, §5.5, §5.9, §6.6 as the spec's "Changes to design.md"), `docs/format.md` (verify the Stage 1 rules are all written), `docs/research/editor.md` (risks 3 and 4), `apps/desktop/src/sample.md` (the welcome document's "Press Return…" line)
- Create: `packages/editor/src/blocks/issues.test.ts`, `packages/editor/src/blocks/walk.test.ts`

- [ ] **Step 1: Write the tests**: `walk.test.ts` — seeded random walks over the format's random documents (`random-docs.ts`): keys at random block edges and in random blocks, typing, Track Changes on and off, two authors, `checkInvariants` after every key (longer under `REDLINES_FUZZ`, seeds recorded); `issues.test.ts` — the scripts for #143, #136, #130, #120, #112 (refused with its words), #102, #107, #108, #109, #110, #119, #154, #35, #20 (4,000 own-line markers), #198, #204's three cases, #161 (hidden and shown), as the design's Tests section lists them; a cost test measuring Return and Backspace on 16 KB and 150 KB documents with 200 marks against main's recorded numbers (print the numbers; fail on more than 2x).
- [ ] **Step 2: Run** `pnpm exec vitest run packages/editor/src/blocks` — FAIL where behavior is missing; fix those in the owning task's files.
- [ ] **Step 3: Update the documents** as listed; no Stage 2+ text.
- [ ] **Step 4: Run** the gate and `scripts/build-redlines` + the Rust gate; then by hand in `pnpm tauri dev` (WKWebView): ↑/↓ over hidden lines and past tables and images, clicks in gaps, Japanese/Chinese/Korean input in an empty paragraph and at block starts and ends, dictation and press-and-hold accents, text replacements, spell check on a new paragraph, VoiceOver on a document with an empty paragraph; write what was checked in the PR.
- [ ] **Step 5: Commit** `Editor: the block editing suite, the documents and the cost check (#168)`.

**STAGE 1 ENDS HERE. Open the PR (closes #169, #173, #198, #204, #154; refs #168) and merge before Stage 2.**

---

# Stage 2: Tab and numbered sublists

### Task 2.1: Format rules 3, 4 and 5 (#171, #172)

**Files:**
- Modify: `packages/format/src/format-blocks.ts`, `packages/format/src/list-run.ts`, `docs/format.md` §2.6
- Test: `packages/format/src/format-blocks.test.ts`

- [ ] **Step 1: Write the failing tests**: indenting `3. three` under `2. two` writes `<!--fmt ID was=indent=0 was=ol=3.\x20-->` with `1.` written, and rejecting gives `3. three`; the region of a block change is the list CommonMark reads (a bulleted, a numbered and a task list separated by blank lines are three regions; a changed bullet character or `.`/`)` ends one) unless a pending change could make them one; the refusal reads "There are 7 pending changes in this list, too many to check this change against. Accept or reject some of them first." and a box click's "This box can't be changed while 7 changes in its list are pending…".
- [ ] **Step 2: Run** `pnpm exec vitest run packages/format/src/format-blocks.test.ts` — FAIL.
- [ ] **Step 3: Implement** the three rules and write them in format.md §2.6.
- [ ] **Step 4: Run** — PASS; gate.
- [ ] **Step 5: Commit** `Format: numbered sublists restart at 1, the list is the region, refusals say how many (#171, #172)`.

### Task 2.2: Tab and Shift-Tab in list items

**Files:**
- Modify: `packages/editor/src/blocks/edits.ts` (`planTab`), `packages/editor/src/blocks/keys.ts`, `plugins/formatting/src/index.ts` (Indent and Outdent call the block layer; ⌘] and ⌘[ stay), `packages/editor/src/index.ts` (export the block layer's indent and outdent)
- Test: `packages/editor/src/blocks/tab.test.ts`, `plugins/formatting/src/index.test.ts`

**Interfaces:** Produces: `planTab(state, outdent: boolean): KeyEdit | null`; Escape then Tab and ⇧⌥M still leave the document.

- [ ] **Step 1: Write the failing tests** via `scriptRows`: every row of the Tab table that concerns lists, tracked and not: Tab anywhere in an item indents it under the one above with its nested items (`- one⏎  - ‸two`, tracked `<fmt was=indent=0>`); on your own new item after Return it edits the split's break (`- two<split>⏎  - ‸`) and writes no mark; first item refused with the format's words; a numbered item becomes `1.`; Shift-Tab outdents, the items after it become its children, top level does nothing; Tab/Shift-Tab over several items is one group; Tab in a paragraph, heading or quote does nothing; a list with more than five other pending changes is refused with rule 5's words (until Task 3.2); Escape then Tab moves focus out.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement**; block changes through `trackedFormat` where the item stands alone, else the plain edit.
- [ ] **Step 4: Run** — PASS; gate.
- [ ] **Step 5: Commit** `Editor: Tab and Shift-Tab indent and outdent list items (#171, #172)`.

### Task 2.3: Option-arrows by paragraph, and triple-click

**Files:**
- Modify: `packages/editor/src/blocks/keys.ts`
- Test: `packages/editor/src/blocks/navigation.test.ts`

- [ ] **Step 1: Write the failing tests**: ⌥↑/⌥↓ go to the start of the paragraph, or of the one before when already there, and to the end or the next one's (never moving the source line); with ⇧ they select; ⌥←/⌥→ by word cross a break; triple-click (a `mouseSelectionStyle`, three clicks) selects a block's text without its line break and typing over it keeps the break.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** both.
- [ ] **Step 4: Run** — PASS; gate.
- [ ] **Step 5: Commit** `Editor: Option-arrows move by paragraph; triple-click selects a block's text`.

**STAGE 2 ENDS HERE. Gate, PR (closes #171, #172 as far as marks apart allows; refs #168), merge.**

---

# Stage 3: Marks apart for block changes

### Task 3.1: Format rule 6, marks apart for block changes

**Files:**
- Modify: `packages/format/src/format-apart.ts`, `docs/format.md` §2.6 (its own section after "Marks apart")
- Test: `packages/format/src/format-apart.test.ts`

- [ ] **Step 1: Write the failing tests**: a block change in a list with eight other pending changes inside items' text after their first character (words inserted, deleted, replaced) leaves those marks pending and succeeds; a mark that a decision could make reach a line's start or a line break still counts toward the refusal; every order of decisions reads as the newest and original views (the format's random suite extended with block changes, seeded).
- [ ] **Step 2: Run** `pnpm exec vitest run packages/format/src/format-apart.test.ts` — FAIL.
- [ ] **Step 3: Implement** with its own proof written in format.md (the inline proof does not carry over because a block change writes in its own block's lines).
- [ ] **Step 4: Run** — PASS; gate.
- [ ] **Step 5: Commit** `Format: marks apart for block changes (#172)`.

### Task 3.2: Lift the five-change refusal in the editor

**Files:**
- Modify: `packages/editor/src/blocks/edits.ts`, `plugins/formatting/src/index.ts` (whatever carries the temporary count)
- Test: `packages/editor/src/blocks/tab.test.ts`

- [ ] **Step 1: Write the failing test**: Tab and a box click in a list with eight pending inline changes succeed and leave them pending.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** by removing the guard.
- [ ] **Step 4: Run** — PASS; gate.
- [ ] **Step 5: Commit** `Editor: Tab works in a list under review (#172)`.

**STAGE 3 ENDS HERE. PR, merge.**

---

# Stage 4: Line breaks and typed blocks

Starts only when #167 has merged (`gh pr list`/`git log origin/main`); if not, do Tasks 4.1, 4.2 and 4.4 and leave 4.3 for after it.

### Task 4.1: Shift-Return's empty line, hard breaks drawn

**Files:**
- Modify: `packages/editor/src/blocks/edits.ts`, `packages/editor/src/blocks/open.ts` (the empty line), `packages/editor/src/preview/decorations.ts` (the backslash or two spaces hidden and stepped over)
- Test: `packages/editor/src/blocks/shift-return.test.ts`

- [ ] **Step 1: Write the failing tests** via `scriptRows`: the end-of-text rows of the Shift-Return table (paragraph, item, quote: `One two.\⏎‸·`, tracked `<ins><split>\⏎·</ins>`); typing replaces the `·` (a transaction filter; an input method's text replaces it when composition ends in the step that makes it a tracked change); Return on the empty line takes the Shift-Return back and opens an empty paragraph; the line is taken back when the caret leaves; the view switch and the card are held until the first character; Backspace over a hard break counts as one character, with either kind (backslash or two spaces).
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run** — PASS; gate.
- [ ] **Step 5: Commit** `Editor: Shift-Return opens an empty line at a block's end`.

### Task 4.2: Format rules 2, 7 and 8

**Files:**
- Modify: `packages/format/src/format-blocks.ts`, `packages/format/src/track.ts`, `docs/format.md` §2.6 and §3.4
- Test: `packages/format/src/format-blocks.test.ts`, `packages/format/src/typing.test.ts`

- [ ] **Step 1: Write the failing tests**: ⌘2 on a paragraph right under a heading, a thematic break or a closing fence changes kind (rule 2); taking out in one edit `⏎>⏎> ` of a quote's blank lines that reads as one is plain (rule 7; leaving a quote in a quote or an item is plain); Enter in a quote that holds a fenced block or a `<` line is written (rule 8, #130) while a quote with an autolink is ordinary.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** each and write them in format.md.
- [ ] **Step 4: Run** — PASS; gate.
- [ ] **Step 5: Commit** `Format: a block under a heading may change kind; a quote's blank lines leave plain; Enter in quotes (#130)`.

### Task 4.3: Typed syntax, and the Paragraph menu on an empty paragraph (#170)

**Files:**
- Create: `packages/editor/src/blocks/typed.ts`
- Modify: `packages/editor/src/preview/decorations.ts` (a lone `#` or `-` drawn as body until complete), `plugins/formatting/src/index.ts`
- Test: `packages/editor/src/blocks/typed.test.ts`, `plugins/formatting/src/index.test.ts`

- [ ] **Step 1: Write the failing tests**: in an empty paragraph, `## ` on the space makes a heading 2, `- `/`1. `/`- [ ] ` an item/task, `>` a quote at once, three backticks a closed fence with the caret after the opening fence, `---` then Return a rule and an empty paragraph after, `| a | b |` then Return a table header and delimiter row; before completion the line is drawn as body; with Track Changes on the typed syntax is part of the paragraph's whole-block insertion; the Paragraph menu on an empty paragraph writes the syntax (Heading 1–6, Quote, Bulleted, Numbered, Task, Code Block with the caret inside, Table with the caret in the first cell, Horizontal Rule with an empty paragraph after); Body does nothing; on a block with text the menu changes its type as before; inserted blocks keep a blank line each side.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** (input rule on the space; a transaction that closes the fence).
- [ ] **Step 4: Run** — PASS; gate and `interface-text.node.test.ts`.
- [ ] **Step 5: Commit** `Editor: typed Markdown makes a block; the Paragraph menu works on empty paragraphs (#170)`.

**STAGE 4 ENDS HERE. PR (closes #170; refs #168), merge.**

---

# Stage 5: Checkboxes

### Task 5.1: The box, and its pending state

**Files:**
- Modify: `packages/editor/src/preview/task.ts`, `packages/editor/src/preview/theme.ts`, `plugins/themes/src/tokens.css`
- Test: `packages/editor/src/preview/task.test.ts`

- [ ] **Step 1: Write the failing tests**: the box is a small SVG, 0.8 em square centred on the x-height, not a font glyph; unchecked has a 1.25 px border in the third ink, radius 0.18 em; checked is filled in the second ink with a check in the page color; hover darkens the border; `role="checkbox"` and `aria-checked` stay; a box with a pending change is drawn in its new state in its author's color with the line's change bar instead of its source; a checked item's text is not struck through; the box's source shows while the caret touches the marker with its column unchanged.
- [ ] **Step 2: Run** `pnpm exec vitest run packages/editor/src/preview/task.test.ts` — FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run** — PASS; gate.
- [ ] **Step 5: Commit** `Editor: task boxes are drawn as boxes, and show a pending change (#174)`.

### Task 5.2: The empty task item (#198)

**Files:**
- Modify: `packages/editor/src/preview/task.ts`, `packages/editor/src/preview/decorations.ts`
- Test: `packages/editor/src/preview/task.test.ts`

- [ ] **Step 1: Write the failing tests**: `- [ ] ` drawn as an empty box at the item's indent, not `• [ ]` at the column's edge; clicking it gives the notice "Write the item first." (through `onNotice`); nested and numbered-task variants.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run** — PASS; gate.
- [ ] **Step 5: Commit** `Editor: an empty task item is an empty box (#198)`.

### Task 5.3: Paragraph › Check Item (⇧⌘U)

**Files:**
- Modify: `plugins/formatting/src/index.ts`, the desktop menu definition (find where Paragraph menu items are declared, `apps/desktop/src/`)
- Test: `plugins/formatting/src/task.test.ts`

- [ ] **Step 1: Write the failing tests**: Check Item checks or unchecks the task items in the selection, tracked as a box change (like a click) and untracked when Track Changes is off; ⇧⌘U is the menu's accelerator; in a list with many pending changes it works, as Tab does after Stage 3.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run** — PASS; gate.
- [ ] **Step 5: Commit** `Formatting: Paragraph › Check Item (#174)`.

**STAGE 5 ENDS HERE. PR (closes #174, #198), merge.**

---

# Stage 6: Code, tables, front matter

### Task 6.1: Format rule 9, code edited with Track Changes on

**Files:**
- Modify: `packages/format/src/track.ts` (and the code-block paths of `edit-support.ts`), `docs/format.md` §3.5 (if the build exposes a gap)
- Test: `packages/format/src/typing.test.ts`

- [ ] **Step 1: Write the failing tests**: a line break and a character typed in a fenced code block with Track Changes on become a whole-block substitution, both views right, rejecting restores the block; the same for indented code (read #205's result in format.md first) and front matter's records of §3.8 are not touched.
- [ ] **Step 2: Run** — FAIL ("A tracked change can't go inside code…").
- [ ] **Step 3: Implement** §3.5.
- [ ] **Step 4: Run** — PASS; gate.
- [ ] **Step 5: Commit** `Format: code edited with Track Changes on is a whole-block substitution`.

### Task 6.2: Keys in code, math and HTML blocks

**Files:**
- Modify: `packages/editor/src/blocks/edits.ts`, `packages/editor/src/blocks/keys.ts`
- Test: `packages/editor/src/blocks/code-keys.test.ts`

- [ ] **Step 1: Write the failing tests** via `scriptRows`: the Code/HTML rows of the design: Return in fenced or indented code (a line break with the line's indentation), on the empty last line it leaves the block (an empty paragraph opens after the closing fence), at the opening fence's end it goes into the code; HTML blocks and math the same; Tab inserts the code's indentation unit (its language's, else what its lines use) and Shift-Tab removes one; Backspace/Delete edges stay no-ops; with Track Changes on all of it is rule 9's substitution.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run** — PASS; gate.
- [ ] **Step 5: Commit** `Editor: Return and Tab in code (#168)`.

### Task 6.3: Tables and front matter

**Files:**
- Modify: `packages/editor/src/blocks/edits.ts`, `packages/editor/src/blocks/keys.ts`
- Test: `packages/editor/src/blocks/table-keys.test.ts`

- [ ] **Step 1: Write the failing tests**: Return in a table row moves to the same cell of the row below, on the last row adds a new row (shown), on an empty last row leaves the table (the row goes, an empty paragraph opens); Tab to the next cell, in the last cell a new row, Shift-Tab the cell before; Return in front matter is a line break with the line's indentation; Tab in front matter inserts two spaces; with Track Changes on front matter edits are refused with format §3.8's words; End of front matter's closing line opens an empty paragraph at the start of the body.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run** — PASS; gate.
- [ ] **Step 5: Commit** `Editor: Return and Tab in tables and front matter (#168)`.

**STAGE 6 ENDS HERE. PR, merge.**

---

# Stage 7: Later

Each task starts with the prototype the design asks for, and stops to report if the prototype fails.

### Task 7.1: Typed syntax at the start of existing text is a block change

**Files:**
- Modify: `packages/editor/src/blocks/typed.ts`, the format's refusal ("a marker would start a line")
- Test: `packages/editor/src/blocks/typed.test.ts`

- [ ] **Step 1: Write the failing tests**: `- ` and `> ` typed at the start of an existing paragraph's text with Track Changes on are written as the block change the menu makes ("Formatted: Bulleted List"), `## ` likewise, not as an insertion or a refusal; rejecting restores the bytes.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** through `trackedFormat`.
- [ ] **Step 4: Run** — PASS; gate.
- [ ] **Step 5: Commit** `Editor: typed block syntax at the start of text is a block change`.

### Task 7.2: Soft line breaks drawn as spaces

**Files:**
- Modify: `packages/editor/src/preview/decorations.ts`
- Test: `packages/editor/src/preview/preview.test.ts`

- [ ] **Step 1: Prototype first**: draw a paragraph's soft line breaks as spaces on hard-wrapped files with marks in a copy of the editor, and record whether carets, clicks and marks behave; stop and report if not.
- [ ] **Step 2: Write the failing test**: a paragraph's soft break is drawn as a space in Clean and Redlines, Raw unchanged, a break with a mark on it keeps its change bar.
- [ ] **Step 3: Implement**, run the test — PASS; gate.
- [ ] **Step 4: Commit** `Editor: a paragraph's soft line breaks are drawn as spaces`.

**STAGE 7 ENDS HERE. PR, merge, close #168.**
