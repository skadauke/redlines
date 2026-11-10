# Undo After an Agent's Edit, and the Allow Question: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One ⌘Z takes back your agent's run and ⇧⌘Z brings it back, byte for byte; your agent's changes from a terminal undo the same way; the Edit menu says whose step goes; and the first-run question reads as Redlines asking you, with buttons that look like buttons.

**Architecture:** The editor gets a history module of its own, a copy of CodeMirror's whose steps have an owner: an agent's edits of one run join one step across time and clicks, but never across your edits, and the loaded file with its line breaks becomes state that Undo gives back. An agent's whole-text write becomes `Editor.applyAgentEdit(next, step)`, a diffed step in place of a reload; each run names its step (`run-<n>`) and stops when the comment that started it is gone; a change on disk that is nothing but your agents' work (`agentWorkOf`) becomes a step too. The question is a panel that the live line draws in the thread, with a notification and Show when it waits out of view.

**Tech Stack:** TypeScript (strict), CodeMirror 6 (`@codemirror/state` 6.7.6, `@codemirror/commands` 6.11.1, `@codemirror/view` 6.43.14), Vitest with happy-dom 21, Tauri v2 (`@tauri-apps/api` 2.12.4, muda 0.20).

**Spec:** [docs/superpowers/specs/2026-11-10-agents-undo-and-allow-design.md](../specs/2026-11-10-agents-undo-and-allow-design.md) ("the design" below), with [docs/format.md](../../format.md) as the source of truth for `packages/format`. Each task names the design's sections it builds: read them before the task. Paths and line numbers are main's at `4de60b1`. Stage 5 of the design (Undo across other changes from outside) is not in this plan: it waits for live sessions, and until then a change on disk that isn't your agent's starts the history over, as today.

## Global Constraints

- Node >=22 and pnpm 10.28.0: run pnpm as `npx -y pnpm@10.28.0`, git as `/usr/bin/git`, and prefix cargo and tauri commands with `PATH=/opt/homebrew/opt/rustup/bin:$PATH`. The shell is zsh: quote globs, and use `git grep` or Python rather than `grep --include=*.ts`.
- In a new worktree: `npx -y pnpm@10.28.0 install`, then `scripts/build-redlines` in `apps/desktop` before any cargo (AGENTS.md).
- TypeScript as `tsconfig.base.json` sets it: strict, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `erasableSyntaxOnly` (no enums, namespaces or parameter properties); `import type` for types. Prettier: width 100, single quotes.
- Tests are `src/**/*.test.ts` beside the code; `// @vitest-environment happy-dom` for a DOM; a desktop test that needs Node's types is `*.node.test.ts`. happy-dom lays nothing out and its `IntersectionObserver` never calls back: test CodeMirror through states, transactions and the DOM it draws, and pass test doubles for what needs layout.
- Every task ends green: `npx -y pnpm@10.28.0 typecheck && npx -y pnpm@10.28.0 lint && npx -y pnpm@10.28.0 test && npx -y pnpm@10.28.0 format:check` (`npx -y pnpm@10.28.0 format` fixes formatting).
- In Stages 2 to 4 every Undo and Redo gives back a text the file had, byte for byte, the ledger and the line breaks included; nothing is replayed over a text it wasn't made on, and the only change made outside the history is `reloadDoc`, which starts it over.
- Only posting in this window's comment box starts a run. Undo, Redo, a reload, a paste and `setDoc` never do.
- A keystroke costs what it costs on main: no parse, diff or ledger comparison per keystroke beyond today's.
- No new chrome: no dialog, toolbar, badge or undo history panel. Color means a person: the question and its notification are in the theme's grays; red is the pen's alone.
- Interface text takes `var(--rl-size-ui-scaled)` or `var(--rl-size-ui-small-scaled)`, never a size in em or %, and never under 13 px or 12 px; `apps/desktop/src/interface-text.node.test.ts` checks every style source.
- Interface words use the typographic apostrophe (’), as the app's notices do: "Undo Claude’s Changes", "Redlines can’t keep …". The UI says "Claude", never "Claude Code" in a feature's name.
- `docs/format.md` decides format behavior; this plan changes only its §6.2 sentence (Task 10). Nothing in `packages/` or `plugins/` imports `@tauri-apps`. `packages/agent-tools`, the providers and the `redlines` program don't change.
- Never mention any other Markdown editor as a model or reference, in code, comments, docs, commits, PRs or issues.
- Commit messages are "Area: what changed" and end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; PR bodies end with the generated-with line. Merge a PR when no critical issue is open; file what is out of scope as issues.

## Review Focus

1. **A CRLF or mixed-line-break file with your typing between a run's edits.** Every text that ⌘Z walks back through, and ⇧⌘Z forward through, is byte for byte one the file had, also where typing deleted a line break of the other style. Test: Task 11 (the random walk on CRLF and mixed copies of the welcome document).
2. **⌘Z while the run's edit is still being written to disk.** The undo stands: the document is unsaved, the watcher's echo of the run's write doesn't reload over it, and ⌘S writes the undone text without asking to overwrite. Test: Task 10.
3. **A change on disk from another app during a run.** The history starts over, as today, with "Undo isn’t available after the file changed on disk." and never "after Claude’s edit"; the run goes on, and its next edit is one step that ⌘Z takes back exactly. Test: Task 10.
4. **⌘Z and ⇧⌘Z of a run in Clean whose change is hidden there** (a deletion, a substitution's old text): the caret lands in text the person can see, and the view stays Clean. Test: Task 7.
5. **Your terminal agent writing again after you took back its last change.** The window keeps the text you undid to, says "This file changed on disk. Your unsaved edits are kept.", and ⌘S asks before overwriting the agent's newer file. Test: Task 13.

---

## Execution order

One implementer works through the tasks in order. Each PR comes from its own worktree off main (superpowers:using-git-worktrees), and is reviewed and merged before the next PR's worktree is cut, so later stages build on merged code.

| Stage | PR (branch) | Tasks | Needs merged |
| --- | --- | --- | --- |
| 1. The Allow question (closes #187) | `v0.3/allow-question` | 1, 2, 3 | — |
| 2a. A history of our own | `v0.3/undo-history` | 4, 5, 6 | — |
| 2b. A run is a step (closes #186 for runs in the app) | `v0.3/undo-runs` | 7, 8, 9, 10, 11 | 1, 2a |
| 3. Your agent from outside | `v0.3/undo-from-disk` | 12, 13 | 2b |
| 4. The Edit menu names the step | `v0.3/undo-names` | 14, 15 | 3 |

Stage 4 starts with a check that can drop it (Task 14, Step 1). If it is dropped, Stages 1 to 3 stand as they are.

---

## Stage 1: The Allow question

### Task 1: Show opens a thread's note, and a resolved one stays while it asks

Design: The Allow question › Behavior (Out of view; In a resolved thread).

**Files:**
- Modify: `plugins/review/src/rail.ts` (`ThreadExtras` at 74-82, `Rail.sync` at 603, `Rail.refreshThread` at 877, a new `Rail.showThread`)
- Modify: `plugins/review/src/index.ts` (`ReviewController`)
- Test: `plugins/review/src/rail.test.ts`

**Interfaces:**
- Produces, in `rail.ts`:

```ts
export interface ThreadExtras {
  // renderText and footer as today
  /**
   * Whether a resolved thread's note stays in the rail though resolved comments are hidden, as one
   * whose run waits for an answer does. Asked each time the rail is drawn.
   */
  keepShown?(thread: string): boolean;
}
```

- Produces, in `index.ts`, on `ReviewController`:

```ts
  /**
   * Shows a thread's note, as Show in a notification asks: a document shown Clean or Raw switches
   * to Redlines, the note is selected and scrolled into view, and in a narrow editor it is pinned
   * over the page from its dot. Returns false, changing nothing, when the rail has no note for it:
   * no such thread, or a resolved one that isn't shown.
   */
  showThread(thread: string): boolean;
```

- [ ] **Step 1: Write the failing tests** in a new `describe('showThread')` in `rail.test.ts`, on the suite's `threads` file (threads `c2dk` and `c3fm`):
  - `it('switches Clean or Raw to Redlines, and selects the note and scrolls it into view')`: for `'clean'` and `'raw'`, `editor.setViewMode(mode)`; spy on `Element.prototype.scrollIntoView`; `review.showThread('c3fm')` is `true`; `editor.getUiState().view` is `'redlines'`; after `await frame()`, the note of `c3fm` has `rl-note-selected` and is among the spy's `mock.contexts`.
  - `it('pins the note over the page from its dot in a narrow editor')`: `stubWidth(editor.view.scrollDOM, 800)`, `await frame()`, `await tick()`; `showThread('c2dk')`; the note has `rl-note-open` and `rl-note-selected`.
  - `it('does nothing for a thread the rail has no note for')`: `showThread('zzzz')` and `showThread` of a resolved thread (built with `thread(…, resolved)`, resolved comments hidden) are `false`; a Clean document stays Clean.
  - `it('keeps a resolved thread’s note while keepShown says so, and lets it go after')`: a file with resolved `c3fm`; `mount(doc, { review: { extras: { keepShown: (id) => kept.has(id) } } })`; with `kept` empty there is no note for `c3fm`; `kept.add('c3fm')`, `review.refreshThread('c3fm')`: its note shows; `kept.delete('c3fm')`, `refreshThread('c3fm')`: it is gone.
- [ ] **Step 2: Run them.** `npx -y pnpm@10.28.0 vitest run plugins/review/src/rail.test.ts`. Expected: FAIL, `showThread` is not a function and the kept note doesn't show.
- [ ] **Step 3: Implement.** `sync` passes `notesIn` a keep set of `draftedThreads()` plus the resolved threads that `keepShown` keeps. `refreshThread` draws the rail again also for a thread with no note yet when `keepShown(thread)` is true. `showThread` checks that the note would be drawn before it changes anything, then dispatches `setViewModeEffect.of('redlines')` when needed, pins (`pin(id, false)`) in a compact rail or else selects, and `reveal`s the note.
- [ ] **Step 4: Run them.** Same command, then `npx -y pnpm@10.28.0 test`. Expected: PASS.
- [ ] **Step 5: Commit.** `Review: Show opens a thread's note, and a resolved one stays while it asks`

### Task 2: The question as a panel of Redlines' own

Design: The question; Behavior (It never takes the keyboard; Allow looks like the default; Answered); Look and accessibility. Design tests, Stage 1: 1, 3, 5, 7.

**Files:**
- Modify: `plugins/agents/src/live-line.ts` (`LiveLineActions`, `STYLE` at 69-175, the `asking` case of `parts` at 287-314, `draw` at 335-340)
- Test: `plugins/agents/src/live-line.test.ts` (rewrite the tests at 110-165)

**Interfaces:**
- Produces, on `LiveLineActions`:

```ts
  /**
   * Puts the keyboard in the document: where it goes after a question answered from the keyboard,
   * when it came to the panel from nowhere else.
   */
  focusDocument?: () => void;
```

- The panel is the line's element itself, with class `rl-ask` only (no `rl-live-line`, no `rl-author-*`, no dot), `role="group"`, `aria-labelledby` its title and `aria-describedby` its folder and note. Children, in order: `.rl-ask-title`, `.rl-ask-folder` (folder askers only; `shortFolder`, with the whole path as `title`), `.rl-ask-note`, `.rl-ask-answers` holding `<button type="button">`s, the first with class `rl-ask-allow`. Ids are unique per panel (`rl-ask-<n>-title`, …).
- Exact words, for an agent named `<name>`:

| | Folder (`readLimit: 'folder'`) | Machine (`readLimit: 'machine'`) |
| --- | --- | --- |
| Title | `Allow <name> to read this folder?` | `Allow <name> to read files on this Mac?` |
| Note | `<name> reads files here to answer, and changes only this document.` | `Redlines can’t keep <name> to one folder: its own settings decide what it reads.` |
| Buttons | `Allow`, `Just This Document`, `Not Now` | `Allow`, `Not Now` |

- `STYLE` takes the design's CSS block (Look and accessibility) as it is, and drops the old `.rl-live-line-asking`, `.rl-live-line-body`, `.rl-live-line-folder` and `.rl-live-line-answers` rules.

- [ ] **Step 1: Write the failing tests** in `describe('renderLiveLine')`:
  - `it('asks as a panel of Redlines’ own: title, folder, what it means, and three buttons in a group')`: for `/Users/ada/code/redlines`: class list is exactly `['rl-ask']`; no `.rl-live-line-dot`; `role` is `group`; the element its `aria-labelledby` names says `Allow Claude to read this folder?`; `aria-describedby` names the folder (`~/code/redlines`, title `/Users/ada/code/redlines`) and the note (`Claude reads files here to answer, and changes only this document.`); `buttons(el).map(named)` is `['Allow', 'Just This Document', 'Not Now']`, each `type === 'button'` with `tabIndex === 0`, the first with `rl-ask-allow`; pressing them calls `answer folder`, `answer document`, `answer no`.
  - `it('asks an agent that can’t be kept to a folder about the Mac, with Allow and Not Now')`: `agentName: 'Gemini'`, `readLimit: 'machine'`: title `Allow Gemini to read files on this Mac?`, note `Redlines can’t keep Gemini to one folder: its own settings decide what it reads.`, no `.rl-ask-folder`, buttons `['Allow', 'Not Now']`.
  - Keep `it('names a deep folder by its start and its end')`, reading `.rl-ask-folder`.
  - `it('answers Not Now on Escape from any of its buttons')`: focus `Just This Document`, dispatch a cancelable `keydown` `Escape`: `calls` is `['answer no']` and the event is default-prevented and stopped.
  - `it('gives the keyboard back after an answer from the keyboard: where it was, else to the document')`: a focused `<textarea>` in the page, then `focus()` on Allow, then `click()`: `calls` has `answer folder` and `document.activeElement` is the textarea. With nothing focused first: `focusDocument` was called. A click whose mousedown kept the keyboard elsewhere moves nothing (Allow never had it).
  - `it('draws its buttons so they look like buttons, wrap at large sizes and keep the 24 px floor')`: `styleSheet()` has a rule for `.rl-ask-answers button` with `min-height: max(24px, calc(26px * var(--rl-text-scale, 1)))`, `white-space: normal`, `font-size: var(--rl-size-ui-scaled)` and a `border`; `.rl-ask-folder, .rl-ask-note` take `var(--rl-size-ui-small-scaled)`; `.rl-ask-allow` has `font-weight: 700`; no `.rl-ask…` rule sets a `width` in px.
  - `it('turns into the running line in the same element, a status again')`, in `describe('createLiveLines')` with `handRuns`: an asking line in thread `c2dk`, then a running one: `footer('c2dk')` is the same element both times, and then has `rl-live-line rl-live-line-running`, `role` `status`, and no `aria-labelledby`.
- [ ] **Step 2: Run them.** `npx -y pnpm@10.28.0 vitest run plugins/agents/src/live-line.test.ts`. Expected: FAIL on the panel's class, words and roles.
- [ ] **Step 3: Implement.** `draw` sets the class, role and labels by kind, and removes the panel's attributes for the other kinds. The panel's buttons keep `button()`'s mousedown guard; a `focusin` on the panel keeps its `relatedTarget` when that is outside the panel, and an answer given while a panel button has the keyboard first gives it back (that element if still connected, else `focusDocument`), then calls `answer`. Escape is handled on the panel and goes no further.
- [ ] **Step 4: Run them**, then `npx -y pnpm@10.28.0 test` (the interface-text test reads the new style). Expected: PASS.
- [ ] **Step 5: Commit.** `Agents: the first-run question is a panel of its own, with buttons that look like buttons`

### Task 3: A question out of view is told of, and said once

Design: Behavior (Out of view); Look and accessibility (the announcement); Changes to design.md (§5.7, the live line; §8.6, Scope). Design tests, Stage 1: 2, 4, 6, 8, 9.

**Files:**
- Modify: `plugins/agents/src/live-line.ts` (`createLiveLines` at 408-488, `LiveLinesDeps`, `LiveLines`; `FailureNotice` becomes `LiveLineNotice`)
- Modify: `plugins/agents/src/index.ts` (export `LiveLineNotice` in place of `FailureNotice`)
- Modify: `apps/desktop/src/main.ts` (the review's `extras` at 229-261, `createLiveLines` at 421-444)
- Modify: `docs/design.md` (§5.7 "The live line"; §8.6 Scope, and its "Just this document")
- Test: `plugins/agents/src/live-line.test.ts`

**Interfaces:**
- Consumes: `ReviewController.showThread`, `ThreadExtras.keepShown` (Task 1); `LiveLineActions.focusDocument` (Task 2).
- Produces:

```ts
/** A line told of in the window's notifications: a failure, or a question waiting out of view. */
export interface LiveLineNotice {
  /** One per thread: a later notice for the thread replaces it. */
  key: string;
  text: string;
  /** What it offers: Show log for a failure that has a log, Show for a question. */
  action?: { label: string; run(): void };
}
// LiveLinesDeps: notify?(notice: LiveLineNotice): { close(): void } (in place of FailureNotice), and
  /** Shows a thread's note, for Show: `ReviewController.showThread`. */
  showThread?: (thread: string) => void;
  /** As `LiveLineActions.focusDocument`. */
  focusDocument?: () => void;
  /**
   * Calls `onLeave` each time `el` leaves the person's view, until the function it returns is
   * called. By default an IntersectionObserver, where the page has one.
   */
  watchView?: (el: HTMLElement, onLeave: () => void) => () => void;
// LiveLines gains:
  /** Whether the thread's note stays in the rail though resolved: its run is asking. For `ThreadExtras.keepShown`. */
  keepsShown(thread: string): boolean;
```

- Exact words: the notification `<name> is waiting for your answer.` with the action `Show`; the announcement `<name> is waiting for your answer: <title>`, `<title>` as in Task 2; a failure's action stays `Show log`.
- The live region: one visually hidden `<div class="rl-live-line-said" aria-live="polite">`, put in `document.body` by `createLiveLines`, empty until a question is said.

- [ ] **Step 1: Write the failing tests.** Change the failure tests that call `notice.showLog?.()` to `notice.action?.run()`, with the label `Show log`. Add, with `liveLines()` and an asking line `ASKING` (Claude, `/repo`):
  - `it('tells of a question out of view in a notification with Show, which shows its thread')`: `inView: () => false`, `showThread` a spy; after `set('c2dk', ASKING)`, `footer`, `await frame()`: one notice, text `Claude is waiting for your answer.`, action `Show`; `action.run()` calls `showThread('c2dk')`.
  - `it('tells of a question whose thread has no note, as in Clean or Raw, at once')`: `footer` never asked; after `frame()`: one notice, and `inView` not called.
  - `it('tells of a question that leaves view after it appeared, once')`: `inView: () => true`, a `watchView` double that keeps `onLeave`; after `frame()` no notice; `onLeave()` twice: one notice.
  - `it('takes the notification away when the question goes')`: then `set('c2dk', running('Starting…'))`: the notice is closed, and `onLeave` is no longer watched (the double's stop was called).
  - `it('says the question once: by its live region in view, by the notification out of view')`: right after `createLiveLines`, `.rl-live-line-said` is in the page, empty, `aria-live="polite"`; in view, after `frame()`, it says `Claude is waiting for your answer: Allow Claude to read this folder?` and there is no notice; for a question out of view, a notice and the region unchanged.
  - `it('keeps a resolved thread’s note while its run asks')`: `keepsShown('c2dk')` is `true` while asking, `false` once running.
  - In `describe('the live line in a thread')` (`mountRun` with no consent, so the run asks): `it('leaves the keyboard in a comment box when the question appears')` (a reply box open on the other thread has the keyboard before the question shows, and after); `it('turns into the running line in place after Allow, and is gone after Not Now, remembering nothing')` (the same element after Allow; `consent` gets `claude|/repo: folder`; after Not Now the note has no footer and `consent` is unchanged).
- [ ] **Step 2: Run them.** `npx -y pnpm@10.28.0 vitest run plugins/agents/src/live-line.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** A question is looked at after layout, as a failure is (`afterLayout`): out of view, or with no note drawn, it is told of at once; in view it is said in the region and watched with `watchView`, and told of when it leaves. One notice per question: keep the told lines in a `WeakSet<LiveLine>`, as `looked` does for failures. When the thread's line changes, stop watching, close its notice and empty the region. `actionsFor` passes `focusDocument` on. In `main.ts`: `extras.keepShown: (thread) => liveLines.keepsShown(thread)`; `createLiveLines` gets `showThread: (thread) => void review.showThread(thread)`, `focusDocument: () => editor.focus()`, and `notify` turns `action` into the notification's action, which runs it and closes the card, as Show log does today.
- [ ] **Step 4: Update `docs/design.md`.** §5.7, "The live line": the first-run question becomes the design's Stage 1 words (Changes to design.md and format.md, §5.7, the live line). §8.6, Scope: "asks, on its live line (§5.7)" becomes "asks in its thread (§5.7)", and "Just this document" becomes "Just This Document".
- [ ] **Step 5: Run everything**, `npx -y pnpm@10.28.0 test`, then by eye in `pnpm tauri dev` (`apps/desktop`) on a machine with Claude signed in: post "@Claude hello" in a document in a folder never allowed: the panel shows in all six themes, light and dark, at 80% and 200% text; scroll it away: the notification comes, and Show brings the note back. If the machine has no signed-in agent, say so in the PR. Expected: PASS.
- [ ] **Step 6: Commit.** `Agents: a question out of view is told of with Show, and said once`

---

## Stage 2: A run is a step

### Task 4: A history module of our own, a copy of CodeMirror's

Design: Mechanism › A history of our own (Stage 2): the copy, and the guard that moves into it unchanged. No behavior changes in this task. Design test, Stage 2: 21.

**Files:**
- Create: `packages/editor/src/history/history.ts`: a TypeScript copy of the history half of `@codemirror/commands` 6.11.1 (`dist/index.js`, from `fromHistory` to `historyKeymap`), with the package's MIT notice at its head (the copyright line, "Copyright (C) 2018-2021 by Marijn Haverbeke <marijn@haverbeke.berlin> and others", and the permission notice, from its `LICENSE`); it imports `isolateHistory` and `invertedEffects` from `@codemirror/commands` instead of defining them, and its `history()` keeps CodeMirror's own `beforeinput` handler on the module's commands
- Create: `packages/editor/src/history/guard.ts`: today's `packages/editor/src/history.ts`, unchanged but for importing the module's `history`, `historyField`, `historyKeymap`, `undo`, `redo`, `undoDepth` and `redoDepth`
- Create: `packages/editor/src/history/index.ts` (the module's exports)
- Move: `packages/editor/src/history.test.ts` to `packages/editor/src/history/guard.test.ts`
- Create: `packages/editor/src/history/history.test.ts`, `packages/editor/src/history/cost.test.ts`
- Create: `packages/editor/src/test-documents.ts`: `longDocument()` and `idFor()` moved out of `preview/long-document.test.ts`, which imports them
- Delete: `packages/editor/src/history.ts`
- Modify: `packages/editor/src/index.ts` (imports at 32; re-exports)
- Modify (imports of `undo`/`redo` from `@codemirror/commands`): `packages/editor/src/tracked/typing.test.ts`, `tracked/tracked.test.ts`, `plugins/formatting/src/index.test.ts`, `plugins/find/src/index.test.ts`

**Interfaces:**
- Produces, from `packages/editor/src/history/index.ts`: `history(config?: HistoryConfig): Extension`, `historyField`, `historyKeymap`, and the `StateCommand`s `undo`, `redo`, `undoSelection`, `redoSelection`, with `undoDepth(state)` and `redoDepth(state)`, all as CodeMirror's; and, from `guard.ts` as today, `UNDO_AFTER_RELOAD`, `REDO_AFTER_RELOAD`, `ReloadBy`, `startOver(state, by?)`, `refusedStep(tr)`, `undoKeymap`, `undoHistory()`.
- Produces, from `@redlines/editor`: `undo`, `redo`, `undoDepth`, `redoDepth` (tests and plugins use these; CodeMirror's own find no history in the editor any more).
- Produces, in `test-documents.ts` (not part of the package): `longDocument(): { doc: string; firstMark: number }`, `idFor(n: number): string`.

- [ ] **Step 1: Write the failing tests.** `history/history.test.ts`, on states made with the module's `history()` alone: `it('joins typing within half a second into one step, and not after a selection change')`, `it('keeps a transaction annotated isolateHistory a step of its own')`, `it('gives back what invertedEffects records, and its inverse on redo')`, `it('maps its steps through a change outside the history')`. `history/cost.test.ts`: `it('costs what CodeMirror’s history costs, on 1,000 keystrokes with Track Changes on and off')`: in an editor on `longDocument().doc`, record the change sets of 1,000 one-character insertions in the middle (`input.type`), tracked and untracked; replay each list on two bare states, one with CodeMirror's `history()` and one with the module's, each with `loadFile(doc).extension`; the median of 5 timed replays of the module is under 1.5 × CodeMirror's + 2 ms.
- [ ] **Step 2: Run them.** `npx -y pnpm@10.28.0 vitest run packages/editor/src/history`. Expected: FAIL, the module isn't there.
- [ ] **Step 3: Implement** the copy and the move, and switch the tests' imports. `guard.test.ts` keeps every test of today's `history.test.ts`, on the module's `undo` and `redo`.
- [ ] **Step 4: Run everything.** `npx -y pnpm@10.28.0 test`. Expected: PASS, with no test changed but for its imports.
- [ ] **Step 5: Commit.** `Editor: Undo and Redo from a history module of our own, a copy of CodeMirror's`

### Task 5: Steps with an owner

Design: A history of our own (Steps with an owner; Undo and Redo of an agent's step say whose they are); One ⌘Z after a run (the stretch Call); Redo (any new step clears Redo); While a run is live (the composition Call).

**Files:**
- Modify: `packages/editor/src/history/history.ts` (`HistEvent`, `HistoryState.addChanges`, `pop`, the field's `fromHistory` branch)
- Modify: `packages/editor/src/history/index.ts`, `packages/editor/src/index.ts` (exports), `packages/editor/src/api.ts` (`AgentStep`)
- Test: `packages/editor/src/history/history.test.ts`

**Interfaces:**
- Produces, in `api.ts`:

```ts
/** An agent's edit, for the history: what it is part of, and who made it (design: What a step is). */
export interface AgentStep {
  /** A run's id, or a change on disk's. Edits of one group join one step while nothing of yours comes between. */
  group: string;
  /** The agent as people read it: 'Claude', or 'Claude and Codex' for a change on disk by both. */
  agent: string;
}
```

- Produces, in `history/history.ts` (and `agentOf`, `followsText` from `@redlines/editor`):

```ts
/** Marks an agent's transaction: a step of its own, joined to the newest step when that is its group's. */
export const agentStep: AnnotationType<AgentStep>;
/** The agent whose step `tr` makes, takes back or brings back; null for anything else. */
export function agentOf(tr: Transaction): AgentStep | null;
/** Whether anchors follow text through `tr` rather than map: a reload, an agent's step, and its Undo and Redo. */
export function followsText(tr: Transaction): boolean;
```

- [ ] **Step 1: Write the failing tests** in `history/history.test.ts` (times through `Transaction.time`, agent edits annotated `agentStep.of({ group, agent: 'Claude' })`):
  - `it('joins an agent’s edits of one group into one step, whatever the time and the selections between them')`: two edits of `run-1` ten seconds apart with a selection change between: `undoDepth` 1; one `undo` gives the first text.
  - `it('keeps two groups apart, the newest first')`: `run-1` then `run-2`: depth 2, and `undo` takes back `run-2`'s edit only.
  - `it('never joins your typing to an agent’s step, nor an agent’s edit to yours')`: type `a`, an edit of `run-1` 10 ms later, type `b` 10 ms after that: depth 3.
  - `it('splits a run around your edit, and joins a stretch to the one before when nothing of yours is left between')`: `run-1`, typing, `run-1`: depth 3; `undo` twice: depth 1; another `run-1` edit: depth 1, and `undo` gives the first text.
  - `it('never joins an input method’s composition across owners')`: an `input.type.compose` edit right after an agent's, and an agent's right after a composition: two steps each.
  - `it('clears Redo with an agent’s step')`: type, `undo`: `redoDepth` 1; an agent's edit: 0.
  - `it('says whose step an undo or a redo takes back or brings back')`: capture the transactions `undo` and `redo` dispatch: `agentOf` is `{ group: 'run-1', agent: 'Claude' }` for the agent's, null for yours.
  - `it('follows text through a reload, an agent’s step and its undo and redo, and maps it through anything else')`: `followsText` is true for a transaction with user event `reload`, an agent's, and their undo and redo; false for typing and its undo.
- [ ] **Step 2: Run them.** `npx -y pnpm@10.28.0 vitest run packages/editor/src/history/history.test.ts`. Expected: FAIL, `agentStep` isn't exported.
- [ ] **Step 3: Implement.** `HistEvent` gains `owner: AgentStep | null`. An agent's event joins the last event only when that event's owner has its group (time, adjacency and selections after it don't matter); your event joins only an event of yours, by CodeMirror's rules, `input.type.compose` included. `fromHistory` carries the popped event's owner, so the event it makes on the other branch has it too, and the transaction `pop` makes carries it in an annotation of the module's own, which `agentOf` reads.
- [ ] **Step 4: Run everything.** `npx -y pnpm@10.28.0 test`, the cost test included. Expected: PASS.
- [ ] **Step 5: Commit.** `Editor: steps with an owner, and an agent's edits of one run joined across time`

### Task 6: The file's line breaks go back with Undo

Design: An agent's edit as a step (the two line-break Calls). Design test, Stage 2: 16, for your own undo.

**Files:**
- Modify: `packages/editor/src/line-breaks.ts` (`LoadedFile`, `loadFile`, `fileText`, the `lineBreaks` field)
- Modify: `packages/editor/src/index.ts` (no `file` variable: `getDoc`, `onChange`, `setDoc` and `reloadDoc` read or set the state's file)
- Test: `packages/editor/src/line-breaks.test.ts`

**Interfaces:**
- Produces, in `line-breaks.ts`:

```ts
export interface LoadedFile {
  text: string;
  lineBreak: string;
  formatBreak: string;
  doc: Text;
  /** The file and its line breaks as the state holds them: install it with the document. */
  extension: Extension;
  /**
   * Make this the editor's file, its line breaks with it, in a transaction that turns the document
   * into this file's (a reload, an agent's edit). Taking that transaction back gives the file before.
   */
  effects: readonly StateEffect<unknown>[];
}
/** The file's text for the document in `state`. */
export function fileText(state: EditorState): string;
```

- `loaded.extension` holds a field for the loaded file, the `lineBreaks` field, and an `invertedEffects` entry: a transaction with the file's effects is given back with the start state's file and record; any other that leaves the record with fewer ranges than it had (a break of the other style deleted) is given back with the start state's record. Of several such effects in one transaction, the last stands (`findLast`), so that the undo of a joined step gives back what was there before its first edit. The record's effect maps its ranges through changes.

- [ ] **Step 1: Write the failing tests** in `line-breaks.test.ts`, a new `describe('undo and line breaks')`:
  - `it('gives back the exact text when your undo brings back a line break of the other style')`: `load('one\r\ntwo\nthree\n')`; delete the LF after `two` (`delete.backward`); `undo` gives `one\r\ntwo\nthree\n`; `redo` gives the joined text; the same for `load('one\ntwo\r\nthree\n')` deleting the CRLF's LF.
  - `it('takes back a change of file with its line breaks, and brings it back')`: on a state with the module's `history()`, `parsedField` and `a.extension`, for `a` a mixed file with a ledger and `b` the same file with a line and a reply added in CRLF: a transaction with `lineChanges(a.doc, b.doc)` and `b.effects`: `fileText` is `b.text`; `undo`: `a.text`; `redo`: `b.text`.
  - `it('gives back the file from before the first of two joined changes of file')`: `a` to `b` to `c`, both annotated `agentStep` of one group: one `undo` gives `a.text`, one `redo` `c.text`.
  - `it('is exact for LF, CRLF, mixed, a CR alone and a ledger after a CRLF blank line')`: the previous test over those five files.
- [ ] **Step 2: Run them.** `npx -y pnpm@10.28.0 vitest run packages/editor/src/line-breaks.test.ts`. Expected: FAIL, the first with `one\r\ntwo\r\nthree\n`.
- [ ] **Step 3: Implement.** `reloadDoc` dispatches `next.effects` where it dispatched `next.reset`.
- [ ] **Step 4: Run everything.** `npx -y pnpm@10.28.0 test`, the cost test included. Expected: PASS.
- [ ] **Step 5: Commit.** `Editor: Undo gives back the file's line breaks, byte for byte`

### Task 7: An agent's edit lands as a step

Design: An agent's edit as a step; A history of our own (The caret for an agent's step); One ⌘Z after a run (the caret Calls). Design tests, Stage 2: 14, 16 (the editor's part), 22, 23.

**Files:**
- Modify: `packages/editor/src/api.ts`, `packages/editor/src/index.ts` (`applyAgentEdit`; `reloadDoc`'s selection logic at 238-257 moved to a helper both use)
- Create: `packages/editor/src/history/caret.ts`
- Modify: `packages/editor/src/history/history.ts` (`HistoryConfig.agentCaret`, used by `pop`), `history/guard.ts` (`undoHistory()` passes it)
- Modify: `plugins/review/src/anchors.ts` (`followAnchor` at 61-64)
- Create: `packages/editor/src/agent-edit.test.ts`
- Test: `plugins/review/src/rail.test.ts`

**Interfaces:**
- Consumes: `AgentStep`, `agentStep`, `followsText` (Task 5); `LoadedFile.effects` (Task 6).
- Produces, on `Editor` in `api.ts`:

```ts
  /**
   * Brings in an agent's edit: the whole new text of the file, which the agent's tool worked out
   * from `getDoc()`. As a reload, only the lines that differ are replaced, and the selection and the
   * scroll stay where the text stayed; unlike one, it is a step to undo, joined to the newest step
   * when that is `step.group`'s, and Track Changes leaves it as it is. `getDoc()` is then `next`
   * byte for byte; Undo gives back the text before, byte for byte, and Redo `next`.
   */
  applyAgentEdit(next: string, step: AgentStep): void;
```

- Produces, in `history/caret.ts`, and `HistoryConfig.agentCaret?: (tr: Transaction) => EditorSelection`:

```ts
/**
 * Where the caret goes when an agent's step is taken back or brought back (`tr`, that undo or redo,
 * as made with the step's own start selection): at the start of its first change in the body, moved
 * out of hidden text (`visibleSelection`); for a step that changed only the ledger, at the start of
 * the anchor (`openerRange(segment).to`) of the first thread whose replies differ; else as `tr` has it.
 */
export function agentCaret(tr: Transaction): EditorSelection;
```

- `pop` makes an agent's undo or redo once, asks `agentCaret` on it, and makes it again with that selection; `scrollIntoView` stays on. `applyAgentEdit` returns at once when `next` is `getDoc()`; else it dispatches the diff with the kept selection, `loadFile(next).effects`, and the annotations `agentStep.of(step)` and `trackedEditAnnotation.of(true)` (which `caretOutOfHiding` and the typing filter read). `anchors.ts` follows text when `followsText(tr)`.

- [ ] **Step 1: Write the failing tests** in `agent-edit.test.ts` (happy-dom; the launch-plan fixture; Claude as `{ handle: 'claude-ada', name: 'Claude', agent: true, for: 'ada' }`; `next` made with `suggestReplace` and `reply` from `@redlines/format` on `getDoc()`):
  - `it('lands as one step that ⌘Z takes back and ⇧⌘Z brings back, byte for byte')`: `applyAgentEdit(next, { group: 'run-1', agent: 'Claude' })`: `getDoc()` is `next`; ⌘Z (keymap) and Edit › Undo (`beforeinput` `historyUndo`) each give the fixture back, ⇧⌘Z and `historyRedo` `next`.
  - `it('is exact in CRLF and mixed files, and with a hand-written ledger out of order')`: the same on the fixture with CRLFs, on a file whose body mixes LF and CRLF, and on one whose ledger lists `comments` before `marks` (the agent's edit writes it in the canonical layout; ⌘Z gives back the hand-written bytes).
  - `it('leaves your steps before it as they were')`: type, the agent's edit, then ⌘Z twice: the fixture.
  - `it('is no typing: Track Changes on leaves it as the agent wrote it')`.
  - `it('puts the caret at its first change in the body, taken back or brought back')`: after ⌘Z and after ⇧⌘Z the caret is at the first index where the two LF texts differ, and `visibleSelection(state)` returns the state's own selection.
  - `it('puts the caret at the thread’s anchor when a step that only replied is taken back or brought back')`: a reply to `c8d2` alone: after ⌘Z and after ⇧⌘Z the caret is at the start of `c8d2`'s anchor, in the body.
  - `it('keeps the caret where the person can see it in Clean, for a deletion and a substitution')` (Review Focus 4): in Clean, steps that delete a word and that replace one, each taken back and brought back: `visibleSelection(state)` returns the state's own selection, and the view is `clean` throughout.
  - `it('keeps an input method’s composition out of the agent’s step')` (test 14): `input.type.compose` edits, the agent's edit on another line, more composing, then a `compositionend` and a timer tick: undoing goes through texts the editor had (`onChange` records them), and the text the agent's undo gives still holds the first composed part.
  - In `rail.test.ts`: `it('keeps a new comment’s anchor through ⌘Z and ⇧⌘Z of an agent’s step')` (test 23): a new comment on `importer` while an agent's step changes another word of that line: after the step, its ⌘Z and its ⇧⌘Z, the anchor holds `importer` and the box shows no notice that the text it pointed to changed.
- [ ] **Step 2: Run them.** `npx -y pnpm@10.28.0 vitest run packages/editor/src/agent-edit.test.ts plugins/review/src/rail.test.ts`. Expected: FAIL, `applyAgentEdit` is not a function.
- [ ] **Step 3: Implement**, as the Interfaces say.
- [ ] **Step 4: Run everything.** `npx -y pnpm@10.28.0 test`. Expected: PASS.
- [ ] **Step 5: Commit.** `Editor: an agent's edit lands as a step, with the caret where it changed`

### Task 8: Each edit of a run is a step of its run

Design: Runs (Stage 2), first bullet; An agent's edit as a step (`DocumentController.applyAgentEdit`, `reloadDoc` for disk alone); What Undo says (the agent variants go).

**Files:**
- Modify: `plugins/agents/src/runs.ts` (`RunDeps.document.applyAgentEdit` at 69, `Run`, `pump` at 297, `toolDocument` at 271-286)
- Modify: `apps/desktop/src/document.ts` (`DocumentEditor` at 55, `applyAgentEdit` at 363-387)
- Modify: `apps/desktop/src/main.ts` (`createRuns`' `document.applyAgentEdit` at 400)
- Modify: `packages/editor/src/api.ts`, `index.ts`, `history/guard.ts` (`reloadDoc(doc)` with no `by`; `startOver(state)`; `ReloadBy` and the "…after Claude’s edit." messages go)
- Test: `plugins/agents/src/runs.test.ts`, `plugins/agents/src/live-line.test.ts` (their harnesses' `applyAgentEdit`), `apps/desktop/src/document.test.ts`, `packages/editor/src/history/guard.test.ts`

**Interfaces:**
- Consumes: `Editor.applyAgentEdit(next, step)` (Task 7), `AgentStep` (Task 5).
- Produces: `RunDeps.document.applyAgentEdit(next: string, step: AgentStep): Promise<void>`; `DocumentController.applyAgentEdit(next: string, step: AgentStep): Promise<void>`; `Editor.reloadDoc(doc: string): void`. A run's id is `run-<n>`, `n` counting the window's runs from 1, given in `pump`; each write of the run passes `{ group: run.id, agent: run.job.agent.name }`.

- [ ] **Step 1: Write the failing tests.** The harnesses call `editor.applyAgentEdit(next, step)` and keep the steps. In `runs.test.ts`: `it('writes each edit of a run as a step of its run, by its agent')` (a script of two `str_replace`s and a `reply`: every step is `{ group: 'run-1', agent: 'Claude' }`); `it('gives each run its group, also two agents named in one comment')` (`@Claude @Codex`: `run-1` for Claude, `run-2` for Codex); `it('takes back a whole run, its reply included, with one undo')` (`undo(editor.view)` once after the run gives the text just after posting). In `document.test.ts`: `it('hands an agent’s edit to the editor as a step, whether or not there is a file')`, in place of the test that expected `reloadDoc(…, { agent })`; the other agent-edit tests pass `STEP = { group: 'run-1', agent: 'Claude' }`. In `guard.test.ts`, the two tests of the agent's name go.
- [ ] **Step 2: Run them.** `npx -y pnpm@10.28.0 vitest run plugins/agents apps/desktop/src/document.test.ts packages/editor/src/history`. Expected: FAIL.
- [ ] **Step 3: Implement.** The controller's saving doesn't change: it calls `applyAgentEdit` where it called `reloadDoc(next, by)`.
- [ ] **Step 4: Run everything.** `npx -y pnpm@10.28.0 typecheck && npx -y pnpm@10.28.0 test`. Expected: PASS, and `/usr/bin/git grep -n ReloadBy` finds nothing.
- [ ] **Step 5: Commit.** `Agents: each edit of a run is a step of its run; Desktop: the controller passes it on`

### Task 9: A run stops when its post is gone

Design: Runs (Stage 2), second bullet; While a run is live (Taking back the comment that started a run). Design test, Stage 2: 10.

**Files:**
- Modify: `plugins/review/src/comment-box.ts` (`PostedComment`, `BoxActions.post`, `post` at 181-202)
- Modify: `plugins/review/src/rail.ts` (`postComment` at 846, `reply` at 884-889, and the boxes' `post` callers)
- Modify: `plugins/agents/src/runs.ts` (`Job`, `RunDeps.document`, `RunController`, `examine` at 483, `start` at 313, `reachOf`, `refusal` at 261)
- Modify: `plugins/agents/src/fake-provider.ts` (`fakeProvider` takes `detect?: () => Promise<AgentState>`, so a test can hold detection)
- Modify: `apps/desktop/src/main.ts` (`onChange` at 155; `createRuns`' `document.parsed`)
- Test: `plugins/review/src/rail.test.ts`, `plugins/agents/src/runs.test.ts`

**Interfaces:**
- Produces, in `comment-box.ts`:

```ts
export interface PostedComment {
  thread: string;
  /** What was posted: the thread's id for a new comment, the reply's for a reply. */
  id: string;
  text: string;
}
// BoxActions.post(text: string): { thread: string; id: string }
```

- Produces, in `runs.ts`:

```ts
// RunController
  /**
   * The document changed, as the editor's onChange says: a run whose post is no longer in it stops,
   * with no line, and the jobs of that post waiting in its thread go. Does nothing when nothing is live.
   */
  documentChanged(): void;
// RunDeps.document
  /** The document's parse as the editor holds it (`Editor.getParsed`): whether a post is still there. */
  parsed(): Parsed;
```

- A job's post is there when the thread `job.thread` is in `parsed().ledger.comments` and, for a reply, has a reply with the post's id. It is checked when `examine` queues the job, after each await in `start` and `reachOf` (the save, the project lookup, the question), in `refusal` before each tool call, and in `documentChanged`. A run stopped for its post clears its thread's `failure` before it finishes, so that no earlier failure of that post comes back; the question's answer is null, and nothing is saved, asked or started after it.

- [ ] **Step 1: Write the failing tests.** In `rail.test.ts`: `it('says what was posted: the thread’s id for a comment, the new reply’s for a reply')` (`onPosted` gets `id === thread` for a new comment; for a reply, the id of the reply the ledger gained). In `runs.test.ts`:
  - `it('starts nothing for a comment taken back while the agents are looked up')`: detection held; post `@Claude …`; `undo(editor.view)`; let detection go; settle: no save, no request, no line.
  - `it('stops a run whose comment is taken back while it saves, asks or runs, with no line')`: three runs, each undone in one of those moments (the save held, the question up, the script waiting): the line is null, the provider's signal is aborted, and a tool call made after it is refused.
  - `it('stops a reply’s run in an older thread when the reply is taken back, and answers nothing there')`: no reply is written in the thread after the undo.
  - `it('puts no earlier failure of the post back on the line when its run stops for its post')`: `@Claude @Codex` with Claude signed out; while Codex runs, the comment is taken back: the line is null.
  - `it('starts nothing when the comment comes back with Redo')`.
  - `it('reads nothing while nothing is live')`: `documentChanged()` with no run never calls `parsed`.
- [ ] **Step 2: Run them.** `npx -y pnpm@10.28.0 vitest run plugins/review/src/rail.test.ts plugins/agents/src/runs.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** The rail finds a reply's id in the ledger after its edit: the reply of the thread that wasn't there before. In `main.ts`: `onChange: (text) => { controller.markEdited(text); runs.documentChanged(); }` and `parsed: () => editor.getParsed()`.
- [ ] **Step 4: Run everything.** `npx -y pnpm@10.28.0 test`. Expected: PASS.
- [ ] **Step 5: Commit.** `Agents: a run stops when the comment that started it is gone`

### Task 10: The undo suite for runs

Design: Tests › Stage 2 (1 to 19); What the file gets; What Undo says; Changes to design.md and format.md. Review Focus 2 and 3.

**Files:**
- Create: `apps/desktop/src/undo-agents.node.test.ts`
- Modify: `docs/design.md` (a new §5.13 Undo after §5.12; §5.7 "Only posting starts a run"; §7.1; §7.3; §8.2; §8.4; §8.6 "Where the work happens"), `docs/format.md` (§6.2)
- Modify: whatever module a failing case shows wrong, with its own test

**Interfaces:**
- Consumes: everything of Tasks 4 to 9.
- The harness, in the test file: the welcome document (`./sample.md?raw`) open in an editor with the review interface; a `DocumentController` over files in memory (as `undo-after-reload.node.test.ts`'s `memoryHost`, with writes that a test can hold); `createRuns` with `fakeProvider`, `fakeRelay` and `createMacAgents` (`@redlines/agents/fake-provider`), consent given for `/docs`; `onChange` calling `controller.markEdited` and `runs.documentChanged`, as `main.ts` does; posting through the comment box with ⌘↩; ⌘Z and ⇧⌘Z as `keydown` on `contentDOM`, and Edit › Undo and Redo as `beforeinput` `historyUndo` and `historyRedo`. "Exactly" compares `getDoc()` with the text recorded at that point.

- [ ] **Step 1: Write the tests**, one `it` per design test, named by what it shows, Stage 2 numbers in brackets: `it('takes back a run of one suggestion and a reply with one ⌘Z, and brings it back with ⇧⌘Z, exactly; Edit › Undo and Redo the same')` [1]; `it('takes back three suggestions, a comment on other text and a reply with one ⌘Z')` [2]; `it('takes back a run that only replied, then your comment')` [3]; `it('takes back the run, then your typing before it')` [4]; `it('takes back a run around your typing in stretches, newest first, each exactly')` [5]; `it('keeps a run one step through clicks, selections and writing in a comment box')` [6]; `it('makes two agents named in one comment two steps, the second’s first')` [7]; `it('makes a stopped run’s edits one step, and leaves a failed run’s line when its edit is taken back')` [8]; `it('takes back a run’s edits so far while it runs; its next edit is a new step, and Redo is cleared')` [9]; `it('stops the run when ⌘Z takes back the comment that started it, and ⇧⌘Z starts nothing')` [10]; `it('starts nothing on Redo of a run, or on Undo and Redo of a comment naming @Claude')` [11]; `it('takes back your decision on the run’s suggestion, then the run')` [12]; `it('passes only through texts the file had when your typing split the run’s suggestion')` [13]; `it('makes a saved run unsaved when it is taken back: ⌘S writes the text before it, or ⇧⌘Z makes it saved again')` [15, two branches]; `it('is exact in a CRLF file, a mixed one and one with a hand-written ledger out of order')` [16]; `it('refuses ⌘Z in Raw with Track Changes on, in Raw’s words, and takes the run back with it off')` [17]; `it('leaves Clean as it is through a run and its ⌘Z and ⇧⌘Z, and selects the thread’s note after ⌘Z of a reply-only run')` [18, 22]; `it('still starts over after another app’s change on disk, in today’s words, never “after Claude’s edit”')` [19]; and:
  - `it('keeps a ⌘Z of the run’s edit that is still being written: no reload over it, and ⌘S writes the undone text without asking')` (Review Focus 2): hold the host's write of the run's edit; ⌘Z; let the write go and fire the watcher: the editor keeps the undone text and is dirty; ⌘S writes it, and `askToOverwrite` isn't called.
  - `it('starts over after another app’s change during a run, and takes back the run’s next edit exactly')` (Review Focus 3): while the script waits, the file changes on disk and the watcher fires: ⌘Z says `Undo isn’t available after the file changed on disk.`; the script's next `str_replace` then lands, and one ⌘Z gives the text from just before it.
- [ ] **Step 2: Run them.** `npx -y pnpm@10.28.0 vitest run apps/desktop/src/undo-agents.node.test.ts`. Expected: PASS; for any that fails, find the cause in its module (superpowers:systematic-debugging), add a failing unit test there, fix it, and run the suite again.
- [ ] **Step 3: Update the docs** with the design's words (Changes to design.md and format.md): §5.13 Undo, without its sentence on your agent's changes from outside (Task 13) and its last sentence, on the Edit menu (Task 15); §5.7, Only posting starts a run (Undo and Redo start nothing; a run stops when its comment goes); §7.1; §7.3; §8.2; §8.4; §8.6, Where the work happens (an Undo is the person's edit, not saved for them); format.md §6.2's added clause.
- [ ] **Step 4: Run everything.** `npx -y pnpm@10.28.0 typecheck && npx -y pnpm@10.28.0 lint && npx -y pnpm@10.28.0 test && npx -y pnpm@10.28.0 format:check`. Expected: PASS.
- [ ] **Step 5: Commit.** `Desktop: the undo suite for runs; Docs: §5.13 Undo`

### Task 11: The random walk

Design: Tests › Stage 2: 20. Review Focus 1.

**Files:**
- Create: `apps/desktop/src/undo-random.node.test.ts` (the harness of Task 10, shared through a helper file `apps/desktop/src/undo-harness.ts` that both tests import: not part of the app, and with no Node API in it, since `tsconfig.app.json` checks it)
- Modify: `apps/desktop/src/undo-agents.node.test.ts` (imports the harness)

**Interfaces:**
- Consumes: `fuzzCount(fallback)` and `seeded(seed)` from `packages/format/src/random-docs.ts` (by its path); the harness of Task 10.

- [ ] **Step 1: Write the test.** `it('walks back and forth through texts the file had, in LF, CRLF and mixed files')`: for `fuzzCount(12)` seeds and each of the welcome document, its CRLF copy and a copy whose second half is CRLF, take 15 seeded actions: tracked typing, untracked typing, deleting a line break, accepting or rejecting a pending change, a comment, a reply, a run through the real toolbox (one to three `str_replace`s, a `comment`, a `reply`), and typing between two edits of a run whose script waits. Record every text `onChange` reports. Then ⌘Z until nothing is left, and ⇧⌘Z until nothing is left. Every text ⌘Z gives is one recorded, each recorded before the one before it, the last the starting text; ⇧⌘Z gives the same texts in reverse, ending at the text before the first ⌘Z; none has a parse warning the starting text hadn't. A failure prints its seed and file.
- [ ] **Step 2: Run it.** `npx -y pnpm@10.28.0 vitest run apps/desktop/src/undo-random.node.test.ts`, then once with `REDLINES_FUZZ=200`. Expected: PASS; a failure is fixed in its module with a unit test of its seed's case, as in Task 10.
- [ ] **Step 3: Run everything**, the four commands. Expected: PASS.
- [ ] **Step 4: Commit.** `Desktop: a random walk of Undo and Redo through runs, typing and decisions`

---

## Stage 3: Your agent from outside

### Task 12: The format names your agents' work

Design: Changes from outside (the strict test and its Calls); Your agent's changes from outside (Stage 3). Design test, Stage 3: 5.

**Files:**
- Create: `packages/format/src/agent-work.ts`, `packages/format/src/agent-work.test.ts`
- Modify: `packages/format/src/index.ts` (export)

**Interfaces:**
- Produces:

```ts
/**
 * The agents acting for `me` whose work alone turns `before` into `after` (design: Changes from
 * outside), named as people read them ("Claude", "Claude and Codex"), or null.
 */
export function agentWorkOf(before: string, after: string, me: Handle): { agent: string } | null;
```

- The algorithm, which the tests don't fix alone:
  1. `A` is the handles in either ledger's `people` with `agent: true` and `for: me`. None, or `before === after`: null.
  2. For each text, take out `A`'s work: delete their threads (`deleteThread`), then reject all their marks but `cmt` together (`rejectMarks`; an `EditError` gives null), then, in the parsed ledger, remove their replies and likes, and their `people` entries. A thread of theirs counts only by what others wrote in it: its replies and likes by anyone else, which must read the same on both sides.
  3. Where `after` has a reply by `A` that `before` hasn't, in a thread `before` has resolved and `after` hasn't, `after`'s thread gets `before`'s `resolved` back.
  4. The work is theirs when the two bodies (the text before `ledgerRange`) are the same, byte for byte, and the two ledgers read the same as values, compared by key (people by handle, marks and threads by id), not by their order or layout.
  5. The name lists the agents of `A` whose marks, threads or replies differ between `before` and `after`, by their `name`, in the order of `after`'s `people`, joined with ", " and a last " and "; none differs: null.

- [ ] **Step 1: Write the failing tests** (Ada is `me`; Claude for Ada, Codex for Ada and Claude for Bo as people; texts made with the format's own `suggestReplace`, `commentOnQuote`, `reply`, `resolve` and `reject`, on the launch-plan fixture and its CRLF copy):
  - `it('names your agent for its suggestion, its comment on other text, and its reply')`: each gives `{ agent: 'Claude' }`.
  - `it('names two of your agents together, in the order of people')`: `{ agent: 'Claude and Codex' }`.
  - `it('names your agent revising its own suggestion: grown, cut, taken back, or its note replaced')`.
  - `it('names your agent replying in a resolved thread, which reopens it')`.
  - `it('names a change that only takes your agent’s work back, whoever made it')`: `reject` of Claude's suggestion.
  - `it('gives null for anyone else’s work')`: Claude for Bo, Ada's own suggestion, and an agent with no `for`.
  - `it('gives null for one plain character more, a setting changed, or a reply of anyone else in your agent’s thread')`.
  - `it('gives null when a mark of your agent’s can’t be rejected, or a change of your agent’s touches another person’s mark')`.
  - `it('gives null when nothing of your agents’ changed, as for a ledger only written again in the canonical layout')`.
  - `it('reads CRLF files byte for byte')`.
- [ ] **Step 2: Run them.** `npx -y pnpm@10.28.0 vitest run packages/format/src/agent-work.test.ts`. Expected: FAIL, the module isn't there.
- [ ] **Step 3: Implement**, as above.
- [ ] **Step 4: Run them, and the format's suite.** `npx -y pnpm@10.28.0 vitest run packages/format`. Expected: PASS.
- [ ] **Step 5: Commit.** `Format: agentWorkOf names a change on disk that is your agents' work alone`

### Task 13: Your agent's changes on disk are steps

Design: Changes from outside; Your agent's changes from outside (Stage 3); Tests › Stage 3 (1 to 4, 6, 7). Review Focus 5.

**Files:**
- Modify: `apps/desktop/src/document.ts` (`DocumentOptions`, `#sawOnDisk` at 331-353, `markEdited` at 303-314)
- Modify: `apps/desktop/src/main.ts` (the controller's options at 276)
- Modify: `apps/desktop/src/undo-after-reload.node.test.ts`, `apps/desktop/src/document.test.ts`
- Modify: `docs/design.md` (§5.13's sentence on your agent's changes from outside)

**Interfaces:**
- Consumes: `agentWorkOf` (Task 12); `Editor.applyAgentEdit` (Task 7).
- Produces, on `DocumentOptions`:

```ts
  /** The handle this window writes as: a change on disk that is its agents' work alone is a step. Without it, none is. */
  author?: () => Handle;
```

- Where the controller reloads from disk today, it asks `agentWorkOf(editor.getDoc(), text, author())` first, and with an answer calls ``editor.applyAgentEdit(text, { group: `disk-${n}`, agent })``, `n` counting the document's changes on disk from 1; else `reloadDoc(text)`, as today. With unsaved edits it reloads nothing, as today. `main.ts` passes `author: () => author.handle`.

- [ ] **Step 1: Write the failing tests.** In `undo-after-reload.node.test.ts`, whose `claudeRuns` writes as `claude-ada` for Ada, the three tests turn around, and new ones come: `it('takes back Claude’s reply from the command line with ⌘Z, exactly, and the file keeps it until ⌘S')` [1]; the same for its suggestion and its comment [1]; `it('starts over after Claude for Bo’s change, keeping its work, as before')` [2: the old three cases, `--as claude-bo --for bo`]; `it('starts over after a change of Claude’s with one plain character more')` [3]; `it('makes three commands in a row three steps')` [4]; `it('takes back Claude’s revision of its own suggestion, then the suggestion')` [6]; `it('takes back Claude’s reply in a resolved thread, and gives the thread back resolved')` [7]; and `it('keeps your ⌘Z of Claude’s change when Claude writes again, and asks before ⌘S overwrites')` (Review Focus 5: after ⌘Z, another command: the notice is `CHANGED_ON_DISK`, the editor keeps the undone text, and ⌘S calls `askToOverwrite`). In `document.test.ts`: `it('applies your agent’s change on disk as a step, and reloads anyone else’s')`, with the fake editor's `applyAgentEdit` and `reloadDoc` spies and `author: () => 'ada'`.
- [ ] **Step 2: Run them.** `npx -y pnpm@10.28.0 vitest run apps/desktop/src/undo-after-reload.node.test.ts apps/desktop/src/document.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement**, and add §5.13's sentence on your agent's changes from outside, in the design's words.
- [ ] **Step 4: Run everything**, the four commands. Expected: PASS.
- [ ] **Step 5: Commit.** `Desktop: your agent's changes on disk are steps that ⌘Z takes back`

---

## Stage 4: The Edit menu names the step

### Task 14: The step's name

Design: Keys, menus, views and Track Changes (The Edit menu names the step, and its Calls); A history of our own (What the step is); Naming the step (Stage 4).

**Files:**
- Modify: `packages/editor/src/history/history.ts` (`HistEvent.label`, `HistoryConfig.label`), `history/guard.ts` (`undoHistory()` passes it)
- Create: `packages/editor/src/history/names.ts`, `packages/editor/src/history/names.test.ts`
- Modify: `packages/editor/src/api.ts` (`EditorUiState`), `packages/editor/src/index.ts` (`uiFor` at 176, `sameUi` at 80)
- Modify: `plugins/find/src/search.ts` (`replaceAll` at 186-192 dispatches with `input.replace.all`)
- Test: `packages/editor/src/tracked/tracked.test.ts` (the exact `getUiState()` at 586 gains `undo: null, redo: null`), `plugins/find/src/index.test.ts`

**Interfaces:**
- Consumes: `agentOf` and the events' owners (Task 5).
- Produces:

```ts
// api.ts, on EditorUiState
  /** What Undo would take back, for the Edit menu ("Typing", "Claude’s Changes"), or null for nothing, or a step with no name. */
  undo: string | null;
  /** What Redo would bring back, likewise. */
  redo: string | null;
// history/names.ts
export type StepLabel = { agent: string; onlyThreads: boolean } | { userEvent: string | null };
/** What a transaction's step is: an agent's, and whether it changed nothing but threads; or yours, by its user event. */
export function labelOf(tr: Transaction): StepLabel;
export function undoName(state: EditorState): string | null;
export function redoName(state: EditorState): string | null;
```

- An event takes `labelOf` of its first transaction; joining an agent's edit ANDs `onlyThreads`; the label goes with the event through Undo and Redo, as its owner does (Task 5). `onlyThreads` is true when every change lies in the ledger region and `ledger.marks` reads the same before and after (people and threads may change). Names, with ’:

| Step | Name |
| --- | --- |
| An agent's, `onlyThreads` | `<agent>’s Reply` |
| An agent's, otherwise | `<agent>’s Changes` |
| `input`, `input.type…`, `input.complete`, `delete…` but `delete.cut` | `Typing` |
| `delete.cut` | `Cut` |
| `input.paste` | `Paste` |
| `input.drop`, `move.drop` | `Drag` |
| `format…`, `input.format` | `Formatting` |
| `input.replace.all` | `Replace All` |
| `input.replace` | `Replace` |
| `accept`, `reject` | `Accept`, `Reject` |
| `review.comment`, `review.reply`, `review.resolve`, `review.reopen` | `Comment`, `Reply`, `Resolve`, `Reopen` |
| Anything else | null |

- [ ] **Step 1: Check that macOS keeps a predefined item's new title.** On a scratch branch that never merges, make the Edit menu's Undo with `PredefinedMenuItem.new({ item: 'Undo' })` in `native-menu.ts` and call `setText('Undo Check')` on it once the menu is drawn; run `pnpm tauri dev` in `apps/desktop`; type in the document; open the Edit menu by eye, and again with the keyboard in a comment box. If it reads "Undo Check" both times, delete the branch and go on. If it reads "Undo", "Undo Typing" or anything else, stop: Stage 4 is dropped (design, Naming the step). File an issue saying what the menu showed, leave Tasks 14 and 15 undone, and report it. This is the plan's one check that needs eyes on the screen; if the session can't look, ask Stephan.
- [ ] **Step 2: Write the failing tests.** `names.test.ts`: `it('names your steps as the Mac does')` (a row of the table each, through the editor's own commands where it has them: typing, ⌫, cut, paste, Paste as Plain Text (`pastePlain`), a drop, Bold, Replace and Replace All, accept, reject, a comment, a reply, a resolve, a reopen; an unknown user event gives null); `it('names an agent’s step Changes, or Reply when it changed only threads')`; `it('names a change on disk by two agents “Claude and Codex’s Changes”')`; `it('names what Redo would bring back')`; `it('has no name with nothing to undo')`. `tracked.test.ts`: the `ui state` test expects `undo: null, redo: null`. `plugins/find/src/index.test.ts`: `it('replaces all in one step whose user event is input.replace.all')`.
- [ ] **Step 3: Run them.** `npx -y pnpm@10.28.0 vitest run packages/editor/src/history/names.test.ts packages/editor/src/tracked/tracked.test.ts plugins/find`. Expected: FAIL.
- [ ] **Step 4: Implement.** `uiFor` fills `undo` and `redo`, and `sameUi` compares them.
- [ ] **Step 5: Run everything**, the four commands, the cost test included. Expected: PASS.
- [ ] **Step 6: Commit.** `Editor: each step knows its name, for the Edit menu`

### Task 15: The Edit menu says what Undo takes back

Design: Keys, menus, views and Track Changes (The Edit menu names the step); Naming the step (Stage 4); Tests › Stage 4.

**Files:**
- Modify: `apps/desktop/src/menu-model.ts` (`MenuState` at 47-63, `StandardRow` at 66-85, the Edit rows at 303-304, a new `undoTitles`)
- Modify: `apps/desktop/src/native-menu.ts` (`drawRow` at 121)
- Modify: `apps/desktop/src/main.ts` (`render` at 639-664; `focusin` and `focusout` draw the menu again)
- Modify: `docs/design.md` (§5.13's last sentence, on the Edit menu)
- Test: `apps/desktop/src/menu-model.test.ts`, `apps/desktop/src/native-menu.test.ts` (its Tauri mock gains `PredefinedMenuItem`)

**Interfaces:**
- Consumes: `EditorUiState.undo` and `.redo` (Task 14).
- Produces:

```ts
// MenuState gains
  /** What Undo would take back while the document has the keyboard, else null (see undoTitles). */
  undo: string | null;
  redo: string | null;
// StandardRow gains
  /** Its label, when that can change: drawn as a predefined item that is kept, and retitled. */
  textFor?: (state: MenuState) => string;
/** The names the Edit menu shows: the editor's while the document has the keyboard, else none. */
export function undoTitles(
  ui: Pick<EditorUiState, 'undo' | 'redo'>,
  documentHasKeyboard: boolean,
): { undo: string | null; redo: string | null };
```

- The Edit rows: ``{ item: 'Undo', textFor: (s) => (s.undo ? `Undo ${s.undo}` : 'Undo') }`` and the same for Redo. `drawRow` makes a row with `textFor` with `PredefinedMenuItem.new({ item, text })` and follows `textFor` with `setText`, through `follow`, so that only a change is sent. `main.ts` passes `undoTitles(ui, editor.view.hasFocus)` into the menu's state, and draws again on `focusin` and `focusout` of the page.

- [ ] **Step 1: Write the failing tests.** `menu-model.test.ts`: `it('names the step Undo and Redo would take, and says Undo and Redo without one')` (the Edit rows' `textFor` with `undo: 'Claude’s Changes'` gives `Undo Claude’s Changes`, with null `Undo`; Redo likewise); `it('names no step while the keyboard is elsewhere than the document')` (`undoTitles({ undo: 'Typing', redo: null }, false)` is all null; with `true`, the names). `native-menu.test.ts`: `it('keeps the Edit menu’s Undo and Redo, and retitles them as the step changes')` (Undo is made once as a predefined `Undo` item; `update` with `undo: 'Typing'` sets `Undo Typing`; with null, `Undo`; the same state twice sends nothing more); every `MenuState` in the two files gains `undo: null, redo: null`.
- [ ] **Step 2: Run them.** `npx -y pnpm@10.28.0 vitest run apps/desktop/src/menu-model.test.ts apps/desktop/src/native-menu.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement**, and add §5.13's sentence on the Edit menu, in the design's words.
- [ ] **Step 4: Run everything**, the four commands; then, in `pnpm tauri dev`, by eye: "Undo Typing" after typing, "Undo Claude’s Changes" after a run (with Claude signed in), and "Undo" with the keyboard in a comment box. Expected: PASS.
- [ ] **Step 5: Commit.** `Desktop: the Edit menu says what Undo takes back`
