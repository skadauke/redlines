# Zoom and the Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ⌘+, ⌘− and ⌘0 zoom everything in every Redlines window; a pinch zooms only the text, following the fingers; and in a wide window the text column widens with the text before its lines rewrap (#188: #189, #190).

**Architecture:** Three stages, one PR each. The page: the column and everything in it are lengths times `--rl-text-scale`, and the notes' lengths times a note scale that never goes below 1, worked out on `[data-rl-theme]` beside #201's tokens; the rail's two-thirds rule is a pure function inside the measure it already makes. The window: the app (`zoom.rs`) is the only writer of WebKit's page zoom; it hands each new page its level in an initialization script, and on a change sends every window the `zoom` event and then `set_zoom`; the page (`zoom.ts`) takes its reading place on the event and sets `--rl-zoom` on the `resize`, and `zoom.css` derives the frame's point and 150% units from it. The pinch: `watchPinch` turns gestures into whole-percent sizes, and `text-zoom.ts` applies each one with its anchor, as a CodeMirror scroll target, in the same call, holding the rail until the fingers lift.

**Tech Stack:** TypeScript (strict), CodeMirror 6.43.14, Vitest 5 with happy-dom 21, Vite 8, Tauri 2.12.4 (Rust, edition 2024), WKWebView on macOS.

**Spec:** [docs/superpowers/specs/2026-11-10-zoom-and-page-design.md](../specs/2026-11-10-zoom-and-page-design.md). Each task names the spec's sections it builds; read them, and the spec's Mechanism table for where each piece lives. `docs/format.md` changes only in §5.6's list.

## Global Constraints

- Run pnpm as `npx -y pnpm@10.28.0`, git as `/usr/bin/git`, and prefix `cargo` and `tauri` commands with `PATH=/opt/homebrew/opt/rustup/bin:$PATH`. The shell is zsh: quote globs, and use `git grep` rather than `grep --include=*.ts`.
- Once in each new worktree: `npx -y pnpm@10.28.0 install`, then `scripts/build-redlines` in `apps/desktop` (every `cargo` in `src-tauri` needs it).
- Before each PR: `npx -y pnpm@10.28.0 typecheck && npx -y pnpm@10.28.0 lint && npx -y pnpm@10.28.0 test && npx -y pnpm@10.28.0 format:check`; with Rust touched, `cargo clippy --all-targets -- -D warnings` and `cargo test` in `apps/desktop/src-tauri`.
- TypeScript as `tsconfig.base.json` sets it (strict, `noUncheckedIndexedAccess`, `erasableSyntaxOnly`, `verbatimModuleSyntax`: `import type` for types). Prettier: width 100, single quotes.
- Tests sit beside the code as `src/**/*.test.ts`; `// @vitest-environment happy-dom` for a DOM; in `apps/desktop`, a test that needs Node's types is `*.node.test.ts`. A single file runs with `npx -y pnpm@10.28.0 test <path>`.
- Interface text: every font size is `var(--rl-size-ui)`, `var(--rl-size-ui-small)`, `var(--rl-size-ui-scaled)`, `var(--rl-size-ui-small-scaled)`, from Task 10 `var(--rl-size-ui-frame)` or `var(--rl-size-ui-small-frame)`, or a plain px of 13 or more; never em or %. Lengths, never font sizes, are multiplied by `--rl-note-scale`.
- Lengths inside the column are `calc(<n>px * var(--rl-text-scale, 1))`; the notes' and cards' are `calc(<n>px * var(--rl-note-scale, 1))`. The change bars' 2 px and 24 px stay.
- One ladder for both zooms: `[0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2]`. The zoom is always a rung; a text size is any whole percent from 80 to 200.
- Neither zoom reaches the file, a print, the clipboard or an export. Zooming is never an edit: no undo step, no unsaved mark, no Track Changes notice.
- No new Tauri permission, no `zoomHotkeysEnabled`, no CSS `zoom`; no page calls `setZoom` itself. The install window is never zoomed.
- Copy, exactly: the notices "Zoom 125%" and "Text size 137%" (`Math.round(level * 100)`); the View rows "Actual Size", "Zoom In", "Zoom Out", "Actual Text Size", "Larger Text", "Smaller Text"; Preferences › Appearance's row "Zoom", with the line "Everything in Redlines’ windows"; the Paragraph item keeps the name "Body".
- No new chrome (no slider, no percentage in the title bar, no status bar) and no animation. Grays only; red is the Track Changes pen's and the first author's.
- Never mention any other Markdown editor as a style or design reference in code, comments, docs, commits, PRs or issues.
- Commits are "Area: what changed", and end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; PR bodies end with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. A PR lists, for Stephan, the by-hand checks of its stage.

## Review Focus

1. **A comment being written when the zoom changes.** A note being written from its dot stays open, with its draft and the keyboard; only notes merely shown from their dots, and pinned cards, close. Test: Task 13.
2. **⌘+ pressed again before the first change lands.** The second press steps from the first's level, the page ends at the last level, and its reading place is taken once and put back once. Test: Task 8.
3. **A pinch whose end never comes**, as when the window loses the focus with the fingers down: the pinch ends on `blur` as at `gestureend`, the size is saved once, and the rail is let go. Test: Task 19.
4. **⌘+ in a comment box or the find bar.** It zooms the window once, as ⌘= does there through the menu, and types nothing. Test: Task 12.
5. **A reading place at the edges of the screen.** A caret's line near the bottom stays on screen at a larger zoom, and a top line half above the scroller keeps its place. Test: Task 7.

---

## Execution order

| Stage | Branch | Tasks | Needs merged |
| --- | --- | --- | --- |
| 1. The page grows with the text (#190) | `v0.3/zoom-page` | 1–6 | the spec |
| 2. Zoom the window (#189) | `v0.3/zoom-window` | 7–16 | — |
| 3. A fluid pinch (#189) | `v0.3/zoom-pinch` | 17–20 | stages 1 and 2 |

Work in order. Each stage is a branch from main in a worktree of its own and one PR, merged before the next stage starts. Each stage leaves design.md true: its tasks change the docs they make true.

## Files

New: `apps/desktop/src/reading-place.ts` (the place to keep across a size change), `zoom.ts` (the page's side of the window zoom), `zoom.css` (the frame's units and text tokens), `text-zoom.ts` (the keys, the pinch and other windows' sizes, each with its place), `zoom-check.ts` (debug-only WebKit checks), and their tests; `apps/desktop/src-tauri/src/zoom.rs` (the app's level, its file, its commands, Preferences' frame); `packages/editor/src/preview/long-document.ts` (the long document, out of its test). Everything else is a change to a file the spec's Mechanism table names.

---

## Stage 1: The page grows with the text (#190)

### Task 1: The theme's derived units

Spec: What it scales (the note scale's call and the derived sizes' call); The measure and the column (the least margin).

**Files:**
- Modify: `plugins/themes/src/tokens.css:12-32`, `docs/design.md:163-166`
- Test: `plugins/themes/src/index.test.ts`

**Interfaces:**
- Produces, on `[data-rl-theme]`: `--rl-note-scale: max(1, var(--rl-text-scale, 1))`; `--rl-margin: calc(24px * var(--rl-note-scale))`; `--rl-size-ui-scaled: max(13px, calc(var(--rl-size-ui) * var(--rl-note-scale)))`; `--rl-size-ui-small-scaled: max(12px, calc(var(--rl-size-ui-small) * var(--rl-note-scale)))`.

- [ ] **Step 1: Write the failing tests.** In `index.test.ts`, `scaled()` reads the new form and works it out with the note scale:

```ts
const match =
  /^max\((\d+(?:\.\d+)?)px, calc\(var\((--[\w-]+)\) \* var\(--rl-note-scale\)\)\)$/.exec(value ?? '');
// …
return Math.max(Number(match[1]), px(declared.get(match[2]!)) * Math.max(1, scale));
```

Rename the floors test `'grows the interface text that follows the text size above 100%, and keeps its size at 100% below'`: for every theme, appearance and token, `size(0.8)`, `size(0.9)` and `size(1)` are the base, `size(1.5)` is `1.5 * base`, `size(2)` is `2 * base`. Add:

```ts
it('works out the note scale and the least margin where the theme is set', () => {
  const derived = rule('[data-rl-theme]');
  expect(derived.get('--rl-note-scale')).toBe('max(1, var(--rl-text-scale, 1))');
  expect(derived.get('--rl-margin')).toBe('calc(24px * var(--rl-note-scale))');
});
```

- [ ] **Step 2: Run** `npx -y pnpm@10.28.0 test plugins/themes/src/index.test.ts`. Expected: FAIL, "not a size that follows the text size".
- [ ] **Step 3: Implement.** The four declarations in tokens.css's `[data-rl-theme]` rule, `--rl-note-scale` first. Its comment says the notes follow the text size above 100% and keep their size at 100% below, and that the derived sizes are worked out on the theme's element, so a host sets `--rl-text-scale` there or above it; the `:root` comment adds that `--rl-column` is the column's width at the theme's own size. design.md §5.1's Text size bullet ends "The notes and cards grow with the document above 100% and keep their size at 100% below it (§6.6)."
- [ ] **Step 4: Run** the themes test and `npx -y pnpm@10.28.0 test apps/desktop/src/interface-text.node.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `Themes: the notes grow with the text above 100% and keep their size below (#190)`.

### Task 2: The column, what is in it, and Raw

Spec: The measure and the column; Inside the column (and the image call); Raw.

**Files:**
- Modify: `packages/editor/src/preview/theme.ts`, `packages/editor/src/preview/image.ts:97-113`, `packages/editor/src/tracked/decorations.ts:821-905`, `docs/design.md` §6.6 (the default look)
- Create: `packages/editor/src/preview/theme.test.ts`
- Test: `packages/editor/src/preview/image.test.ts`

**Interfaces:**
- Produces: `textPx(px: number): string` (`calc(<px>px * var(--rl-text-scale, 1))`) and `baseThemeSpec`, both exported from `preview/theme.ts`, with `baseTheme = EditorView.baseTheme(baseThemeSpec)`; `trackedThemeSpec` exported from `tracked/decorations.ts` the same way. Both specs are typed `Parameters<typeof EditorView.baseTheme>[0]`.

- [ ] **Step 1: Write the failing tests.** In `theme.test.ts` (happy-dom), with `const s = textPx`:

```ts
it('makes the column the measure times the text size, between margins that grow above 100%', () => {
  expect(s(16)).toBe('calc(16px * var(--rl-text-scale, 1))');
  expect(baseThemeSpec['.cm-content']).toMatchObject({
    maxWidth: 'calc(var(--rl-column) * var(--rl-text-scale, 1) + 2 * var(--rl-margin, 24px))',
    padding: `${s(32)} var(--rl-margin, 24px) 30vh`,
  });
});
```

`it('writes every length inside the column times the text size')`: `.cm-line.rl-gap` is `{ lineHeight: s(16) }`, `.cm-line.rl-h1 + .cm-line.rl-gap` `{ lineHeight: s(18) }`, the h2–h6 gap selector (built as theme.ts builds it) `{ lineHeight: s(10) }`; `.rl-quote` has `paddingLeft: s(18)`; `.rl-image-own` `padding: \`${s(6)} 0\``; `.cm-line.rl-li + .cm-line.rl-li` `{ paddingTop: s(6) }`; `.rl-codeblock, .rl-frontmatter` `padding: \`0 ${s(16)}\``; `.rl-table` `margin: '0 0 0 -24px'` and `padding: \`${s(6)} 0 ${s(6)} 24px\``; `.rl-table th, .rl-table td` `padding: \`${s(10)} ${s(16)} ${s(10)} 0\``; `.rl-table th` `paddingBottom: s(8)`.
`it('gives Raw its column times the text size, and leaves the change bars where they are')`: `trackedThemeSpec['&.rl-view-raw .cm-content']` has `maxWidth: 'calc(760px * var(--rl-text-scale, 1) + 2 * var(--rl-margin, 24px))'`, `paddingTop: s(40)` and `fontSize: 'calc(13.5px * var(--rl-text-scale, 1))'`; `trackedThemeSpec['.rl-bar::before']` keeps `left: '-24px'` and `width: '2px'`.
In `image.test.ts`, `it('draws an image at its natural width times the text size once it loads')`: the img of `drawn(editorWith('![Plan](https://example.com/plan.png)\n\nText.\n'))` has no width; with `naturalWidth` defined as 400 and a `load` event, `img.style.getPropertyValue('width')` is `calc(400px * var(--rl-text-scale, 1))`; with `naturalWidth` 0 it stays `''`.

- [ ] **Step 2: Run** `npx -y pnpm@10.28.0 test packages/editor/src/preview`. Expected: FAIL (`baseThemeSpec` is not exported).
- [ ] **Step 3: Implement.** Export the specs and rewrite the values the tests name; nothing else in the column changes (radii, borders and the 24 px a table reaches into the margin stay). Raw imports `textPx` from `../preview/theme.ts`. The image's load listener sets the width with `textPx(img.naturalWidth)` when it is over 0, before its `requestMeasure`. design.md §6.6's default look becomes "a centered column of about 94 characters a line (680 px at the theme's own size), which grows with the text size until it meets the margins".
- [ ] **Step 4: Run** `npx -y pnpm@10.28.0 test packages/editor`. Expected: PASS.
- [ ] **Step 5: Commit** `Editor: the column and everything in it grow with the text size (#190)`.

### Task 3: The notes and cards grow with the text; the review bar doesn't

Spec: What it scales (the review bar's call); The rail beside it (its first paragraph); Narrow pages (cards and notes within the window).

**Files:**
- Modify: `plugins/review/src/styles.ts`, `plugins/agents/src/live-line.ts:63-175`, `plugins/agents/src/picker.ts:118-147`, `AGENTS.md` (Conventions, interface text), `docs/design.md` §5.1
- Create: `plugins/review/src/styles.test.ts`, `plugins/agents/src/styles.test.ts`

**Interfaces:**
- Produces, from `plugins/review/src/styles.ts`: `notePx(px: number): string` (`calc(<px>px * var(--rl-note-scale, 1))`); `reviewThemeSpec` with `reviewTheme = EditorView.baseTheme(reviewThemeSpec)`; `RAIL_WIDTH = 248`, `RAIL_GAP = 44`, `RAIL_SPACE = 292`, `NOTE_GAP = 8`, and `MARGIN = 24` in place of `COLUMN_PADDING` (the least margin at 100%, `--rl-margin`). From the agents plugin: `LIVE_LINE_STYLE` and `PICKER_STYLE`, the style texts, exported.

- [ ] **Step 1: Write the failing tests.** In `styles.test.ts`, with `const NOTE = /-?\d+(\.\d+)?px \* var\(--rl-note-scale, 1\)/g`, `const WINDOW = 'calc(100vw - 32px)'`, and `bare(value)` the value with every `NOTE` match and `WINDOW` taken out:

```ts
it('makes room for a rail that grows with the text, beside a column that does too', () => {
  expect(reviewThemeSpec['&.rl-has-rail .cm-content']).toEqual({
    maxWidth:
      'calc(var(--rl-column) * var(--rl-text-scale, 1) + 2 * var(--rl-margin, 24px) + 292px * var(--rl-note-scale, 1))',
    paddingRight: 'calc(var(--rl-margin, 24px) + 292px * var(--rl-note-scale, 1))',
  });
  expect(reviewThemeSpec['.rl-rail']).toMatchObject({ width: notePx(248) });
});
```

`it('writes every length of the notes and cards times the note scale')`: for each selector matching `/rl-(note|card|rail|dot|anchor)/` and not `/rl-review-bar|rl-bar-/`, every string value of a property other than `border`, `borderColor`, `borderStyle`, `borderWidth`, `outline`, `outlineOffset`, `boxShadow` and `transition` has no length left once bare: `expect(bare(value)).not.toMatch(/[1-9]\d*(\.\d+)?px/)`.
`it('keeps cards and notes shown from their dots inside the window')`: `.rl-card` has `minWidth: \`min(${notePx(232)}, ${WINDOW})\`` and `maxWidth: \`min(${notePx(360)}, ${WINDOW})\``; `.rl-rail-compact .rl-note` has `width: \`min(${notePx(248)}, ${WINDOW})\``.
`it("keeps the review bar at the interface's own sizes, whatever the text size")`: `.rl-review-bar` has `fontSize: 'var(--rl-size-ui)'` and `height: '42px'`; `.rl-bar-error` `fontSize: 'var(--rl-size-ui)'`; `.rl-review-bar .rl-hint` `fontSize: 'var(--rl-size-ui-small)'`; no rule whose selector matches `/rl-review-bar|rl-bar-/` holds the word `scale`.
In `plugins/agents/src/styles.test.ts`, `it("writes the live line's and the picker's lengths times the note scale")`: with comments and `border…: …;` declarations removed and `NOTE` taken out, neither style has a length of 2 px or more left (`/\b([2-9]|\d{2,})(\.\d+)?px/`); the 1 px of the hidden Stop button may stay.
- [ ] **Step 2: Run** `npx -y pnpm@10.28.0 test plugins/review/src/styles.test.ts plugins/agents/src/styles.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Every length in the notes', cards', rail's and dots' rules becomes `notePx(n)`, negative ones too (`notePx(-5)`); their font sizes stay #201's scaled tokens. Their icons get CSS sizes: `.rl-note-icon svg` `notePx(14)`, `.rl-note-resolved-line svg` `notePx(12)`, `.rl-card-button svg` `notePx(16)`, and the live line's Stop icon `calc(14px * var(--rl-note-scale, 1))`. The live line's dot centers with `calc(0.69em - 3px * var(--rl-note-scale, 1))`. The review bar's text and errors take `var(--rl-size-ui)`, and a new `.rl-review-bar .rl-hint` rule `var(--rl-size-ui-small)`; the note icons' hints keep the scaled token. `rail.ts` imports `MARGIN` for now where it used `COLUMN_PADDING`. AGENTS.md's interface-text bullet adds that the notes' lengths are multiplied by `--rl-note-scale`. design.md §5.1's Text size bullet: "It sets the document's size and its margin notes', not the review bar's or the title bar's."
- [ ] **Step 4: Run** `npx -y pnpm@10.28.0 test plugins/review plugins/agents apps/desktop/src/interface-text.node.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `Review: the notes and cards grow with the text, and the review bar keeps its size (#190)`.

### Task 4: The rail's two-thirds rule

Spec: The rail beside it (the rule, its table, and its last paragraph).

**Files:**
- Modify: `plugins/review/src/rail.ts:72, 311-331, 420-433, 672-746`, `docs/design.md` §5.7 (the narrow window)
- Test: `plugins/review/src/rail.test.ts:396-488`

**Interfaces:**
- Consumes: `RAIL_WIDTH`, `RAIL_SPACE`, `MARGIN`, `NOTE_GAP` from Task 3.
- Produces: `export function railCompact(at: { width: number; column: number; textScale: number; compact: boolean }): boolean`, true where the editor of `width` px shows dots. `COMPACT_BELOW` goes.

- [ ] **Step 1: Write the failing tests.**

```ts
describe('railCompact', () => {
  it.each([
    [0.8, 703],
    [1, 794],
    [1.25, 992],
    [1.5, 1190],
    [2, 1587],
  ])('at a text size of %s, keeps the notes in an editor of %i px and shrinks them to dots below', (textScale, width) => {
    expect(railCompact({ width, column: 680, textScale, compact: false })).toBe(false);
    expect(railCompact({ width: width - 1, column: 680, textScale, compact: false })).toBe(true);
  });
  it('brings the notes back from dots only with 24 px to spare', () => {
    expect(railCompact({ width: 817, column: 680, textScale: 1, compact: true })).toBe(true);
    expect(railCompact({ width: 818, column: 680, textScale: 1, compact: true })).toBe(false);
  });
  it("follows the theme's measure", () => {
    expect(railCompact({ width: 780, column: 660, textScale: 1, compact: false })).toBe(false);
    expect(railCompact({ width: 779, column: 660, textScale: 1, compact: false })).toBe(true);
  });
});
```

The DOM tests take the new widths: 'a narrow editor shrinks the rail to dots' stubs 700 (and 1200 for the rail's return); 'comes back from dots only with room to spare' goes 794 false, 793 true, 794 true, 817 true, 818 false, 794 false; the scroll bar test's width is `compact() ? 800 : 785`; "goes by the editor's width" stubs `offsetWidth` 803 and `clientWidth` 788.
- [ ] **Step 2: Run** `npx -y pnpm@10.28.0 test plugins/review/src/rail.test.ts`. Expected: FAIL (`railCompact` is not exported).
- [ ] **Step 3: Implement.** `railCompact` with C = column × textScale, NS = max(1, textScale), R = `RAIL_SPACE` × NS and M = `MARGIN` × NS: compact when `width < (2 * C) / 3 + R + 2 * M + (compact ? COMPACT_MARGIN : 0)`. The measure's read takes `--rl-column` and `--rl-text-scale` from `getComputedStyle(view.dom)` (680 and 1 where they don't parse, as in happy-dom), and the column's margin from `.cm-content`'s computed `paddingLeft` (else `MARGIN` × NS); `Layout` carries `noteScale`. The write places the rail at `edge - (this.dom.offsetWidth || RAIL_WIDTH * noteScale)` and multiplies `NOTE_LIFT`, `NOTE_GAP`, `DOT_SIZE`, `DOT_GAP`, `DOT_OFFSET`, `POPOVER_LIFT` and `NOTES_FOOT` by `noteScale`. The constructor's first guess is `railCompact` of the window's width at 100%. design.md §5.7's narrow-window sentence becomes the spec's §5.7 text without its last sentence (the pinch, Task 18).
- [ ] **Step 4: Run** `npx -y pnpm@10.28.0 test plugins/review`. Expected: PASS, the `419px` foot of notes among them.
- [ ] **Step 5: Commit** `Review: the column gives up a third of its width before the notes go to dots (#190)`.

### Task 5: Print and copy ignore the text size

Spec: What the file and the outputs get (and the `!important` call).

**Files:**
- Modify: `apps/desktop/src/styles.css:649-700`, `docs/design.md` §6.6 (print)
- Test: `apps/desktop/src/styles.node.test.ts`, `apps/desktop/src/clipboard.test.ts`

- [ ] **Step 1: Write the failing tests.** In `styles.node.test.ts`, `it("prints at the theme's own size, whatever the text size, without the rail's room")`: the print reset rule (`html[data-rl-theme][data-rl-appearance]`) declares `--rl-text-scale: 1 !important`; a rule after `@media print` whose selector holds `#editor` and `.rl-has-rail .cm-content` declares `max-width: calc(var(--rl-column) + 2 * var(--rl-margin, 24px))` and `padding-right: var(--rl-margin, 24px)`. In `clipboard.test.ts`, `it('copies the same bytes at any text size')`: the plain text and HTML that ⌘C puts on the clipboard for the welcome document's first two paragraphs are the same with `--rl-text-scale` set to `2` on `document.documentElement` as without (remove it afterwards).
- [ ] **Step 2: Run** `npx -y pnpm@10.28.0 test apps/desktop/src/styles.node.test.ts apps/desktop/src/clipboard.test.ts`. Expected: FAIL on the print rules; the clipboard test may already pass, and stays as the guard.
- [ ] **Step 3: Implement** the two declarations in `@media print`. design.md §6.6's print bullet becomes the spec's text ("… and never the window's zoom or the text size, so they look like the screen").
- [ ] **Step 4: Run** the two tests. Expected: PASS.
- [ ] **Step 5: Commit** `Desktop: print and copy ignore the text size (#190)`.

### Task 6: WebKit checks of the column and the rail

Spec: Tests, In WebKit, checks 2 and 3.

**Files:**
- Create: `apps/desktop/src/zoom-check.ts`
- Modify: `apps/desktop/src/main.ts:758-761` (beside the print check)

**Interfaces:**
- Produces: `runZoomCheck(context: ZoomCheckContext): Promise<void>` with `interface ZoomCheckContext { editor: Editor; scroller: HTMLElement }`; Task 16 adds `zoom: PageZoom | null`, and Task 20 `textZoom: TextZoom`. It reports each check as one `console.warn` line, `ZOOM-CHECK <name> pass` or `ZOOM-CHECK <name> FAIL <json>`, and ends with `ZOOM-CHECK done <passed> passed, <failed> failed`; Vite forwards `warn` to the terminal when an agent runs it (`server.forwardConsole`), as for `print-check.ts`.

- [ ] **Step 1: Write the checks.** The check opens the welcome document (`./sample.md?raw`, `editor.setDoc`) and sets the editor's width by giving `.rl-main` an inline width. `column-keeps-its-breaks`: in Clean, with the editor 1800 px wide, at text sizes 1.1, 1.25, 1.5, 1.75 and 2 (`applyTextSize`, then two frames): the column's text width (`.cm-content`'s client width less its two paddings) is 680 × the size within 1 px, and the count of visual lines (each `.cm-line`'s client rects, by top) differs from the count at 1 by at most one in a hundred; at 2 in a 1200-px editor, the column is 1200 − 96 px. `rail-states`: in Redlines, at each size of the spec's table, the editor at "Notes beside, full column" has `rl-has-rail` and the full column; at "Dots below" + 1 it still has the rail; at "Dots below" − 2 the rail has `rl-rail-compact`. `main.ts` runs it when `import.meta.env.DEV && import.meta.env['VITE_ZOOM_CHECK']`, with `{ editor, scroller: element('.rl-scroller') }`.
- [ ] **Step 2: Run** in `apps/desktop`: `VITE_ZOOM_CHECK=1 PATH=/opt/homebrew/opt/rustup/bin:$PATH npx -y pnpm@10.28.0 tauri dev` (in the background), and read the terminal. Expected: `ZOOM-CHECK done 2 passed, 0 failed`. A failure is a bug in Tasks 2–4: fix it there, with a unit test where one can hold it.
- [ ] **Step 3: Run** `npx -y pnpm@10.28.0 typecheck && npx -y pnpm@10.28.0 lint`. Expected: no errors.
- [ ] **Step 4: Commit** `Desktop: WebKit checks of the column and the rail at every text size (#190)`. The PR's by-hand list: today's keys and pinch at 200% in a full-screen window, on a document with notes.

## Stage 2: Zoom the window (#189)

### Task 7: The reading place

Spec: The reading place; Mechanism, CodeMirror.

**Files:**
- Create: `apps/desktop/src/reading-place.ts`, `apps/desktop/src/reading-place.test.ts`

**Interfaces:**
- Produces:

```ts
/** A line to keep in place: where it starts, and its top's distance below the scroller's top, in CSS px. */
export interface ReadingPlace { pos: number; top: number }
/** The caret's line while the caret is on screen, else the line at the top. */
export function readingPlace(view: EditorView, scroller: HTMLElement): ReadingPlace;
/** The line under `point`: by position over the text, by height beside it, else the top line. */
export function placeAt(view: EditorView, scroller: HTMLElement, point: { x: number; y: number } | null): ReadingPlace;
/** `place.top` times `factor` (the old zoom over the new), kept at most `room`. */
export function marginFor(place: ReadingPlace, factor: number, room: number): number;
/** The scroll target that puts the line back: `EditorView.scrollIntoView(place.pos, { y: 'start', yMargin })`. */
export function placeBack(view: EditorView, scroller: HTMLElement, place: ReadingPlace, factor?: number): StateEffect<unknown>;
```

- [ ] **Step 1: Write the failing tests** (happy-dom, a real editor; stub the scroller's `getBoundingClientRect` to top 52 and bottom 772, `view.coordsAtPos`, the view's `documentTop` getter and, where the test needs a line, `lineBlockAtHeight`). `it("is the caret's line while the caret is on screen")`: caret in the second paragraph, its coords inside the scroller: `pos` is that line's start, `top` is `documentTop + lineBlockAt(head).top - 52`. `it('is the line at the top when the caret is off screen')`. `it('takes the line under a point, the line at its height beside the text, and the top line outside the editor')`. `it('puts the line back as many points below the top at another zoom')`: `marginFor({ pos: 0, top: 120 }, 1 / 1.5, 600)` is 80; with factor 1 it is 120. Review Focus 5, `it('keeps a line near the bottom on screen, and a line above the top where it was')`: `marginFor({ pos: 0, top: 700 }, 1, 693)` is 693; `marginFor({ pos: 0, top: -12 }, 1, 693)` is −12; with `scroller.clientHeight` 720 and `view.defaultLineHeight` 27 stubbed, `placeBack` calls `EditorView.scrollIntoView` (spied) with `(pos, { y: 'start', yMargin: 693 })` for a top of 700.
- [ ] **Step 2: Run** `npx -y pnpm@10.28.0 test apps/desktop/src/reading-place.test.ts`. Expected: FAIL (no module).
- [ ] **Step 3: Implement** the four functions; `placeBack`'s room is `scroller.clientHeight - view.defaultLineHeight`, and its factor defaults to 1.
- [ ] **Step 4: Run** it. Expected: PASS.
- [ ] **Step 5: Commit** `Desktop: the reading place, taken and put back across a size change (#189)`.

### Task 8: The page follows the app's zoom

Spec: Every window, kept (the five steps and their calls); Edge cases (older settings, the app's copy, a window that opens during a change).

**Files:**
- Create: `apps/desktop/src/zoom.ts`, `apps/desktop/src/zoom.test.ts`
- Modify: `apps/desktop/src/settings.ts`, `apps/desktop/src/text-size.ts` (`TEXT_SIZES` becomes `LADDER`, wherever it is used)
- Test: `apps/desktop/src/settings.test.ts`, `apps/desktop/src/text-size.test.ts` (the rename)

**Interfaces:**
- Produces, from `text-size.ts`: `LADDER: readonly number[]`, the ladder of both zooms. From `settings.ts`: `Settings.zoom: number`, a rung, default 1. From `zoom.ts`:

```ts
export const ZOOM_EVENT = 'zoom';
export const RESIZE_WAIT_MS = 500;
/** The level the app's initialization script handed this page (`window.__REDLINES_ZOOM__`), if a rung. */
export function initialZoom(): number | null;
/** Sets `--rl-zoom` on `root`. */
export function applyZoom(root: HTMLElement, level: number): void;
export interface ZoomLink {
  set(level: number): Promise<void>; // the app's `set_zoom` command
  report(level: number): Promise<number>; // the app's `zoom_level` command: its level, or the report taken
  listen(handler: (level: number) => void): Promise<unknown>; // the `zoom` event, to this window
}
export function tauriZoomLink(): ZoomLink;
export interface ZoomOptions {
  root: HTMLElement;
  win: Window;
  /** The level `--rl-zoom` has now: what `initialZoom()` gave, or 1. */
  level: number;
  /** The level in this window's settings, and how to save another there. */
  settings(): number;
  save(level: number): void;
  /** On the event, before WebKit's zoom changes; `from` is the level the page is laid out at. */
  before?(level: number, from: number): void;
  /** Once `--rl-zoom` is `level`: in the first frame at it, or at once after the report. */
  after?(level: number, from: number): void;
}
export interface PageZoom {
  /** The level asked for last, or else the one the page is at. */
  level(): number;
  /** Saves `level` and asks the app for it; nothing for the level it has. */
  ask(level: number): Promise<void>;
}
export function followZoom(link: ZoomLink, options: ZoomOptions): Promise<PageZoom>;
```

- [ ] **Step 1: Write the failing tests.** `settings.test.ts`: `it('keeps a zoom from the ladder, and 100% for anything else or nothing')`: stored `1.25` loads as 1.25; `"1.25"`, `1.3`, `3`, `0`, `null` and settings without it load as 1; the full-settings round trips include `zoom`. `zoom.test.ts` (happy-dom, a fake link whose `listen` keeps the handler and whose `report` resolves an answer the test chooses):
  - `it('takes the level the initialization script handed the page, if it is a rung')`: `__REDLINES_ZOOM__` 1.5 gives 1.5; 1.3, `'1.5'`, `null` and none give null.
  - `it("reports the settings' level, and saves and shows the app's when it differs")`: level 1, settings 1.25, answer 1.5: `save(1.5)`, `--rl-zoom` is `1.5` without a `resize`, `after(1.5, 1)` once.
  - `it('takes the place on the event, and sets --rl-zoom on the resize that follows')`: event 2: `before(2, 1)` at once, `--rl-zoom` still `1`; a `resize` on `win`: `--rl-zoom` `2`, `after(2, 1)`.
  - `it('sets --rl-zoom half a second after the event when no resize comes')` (fake timers, `RESIZE_WAIT_MS`).
  - Review Focus 2, `it('ends at the last of the levels asked for before the first lands, taking the place once')`: `ask(1.1)`, then `ask(stepSize(zoom.level(), 1))` asks 1.25; events 1.1 and 1.25, then one `resize`: `--rl-zoom` `1.25`, `before` once with `(1.1, 1)`, `after` once with `(1.25, 1)`.
  - `it('asks the app once for a new level, after saving it, and not for the level it has')`.
- [ ] **Step 2: Run** `npx -y pnpm@10.28.0 test apps/desktop/src/zoom.test.ts apps/desktop/src/settings.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** `followZoom` listens before it reports. It keeps the level the layout is at, the level pending from events (with the `from` of the first), and the level asked for; a `resize`, or `RESIZE_WAIT_MS` after the last event, lands the pending level (`applyZoom`, then `after`). An answer to the report that differs from what the page has or awaits is applied at once. `tauriZoomLink` invokes `set_zoom` with `{ level }` and `zoom_level` with `{ reported }`, and listens with `getCurrentWebviewWindow().listen<number>(ZOOM_EVENT, …)`.
- [ ] **Step 4: Run** `npx -y pnpm@10.28.0 test apps/desktop`. Expected: PASS.
- [ ] **Step 5: Commit** `Desktop: the page follows the app's window zoom (#189)`.

### Task 9: The app keeps the zoom and sets it on every window

Spec: Every window, kept; Mechanism, The app; Tests, The app.

**Files:**
- Create: `apps/desktop/src-tauri/src/zoom.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs` (`mod zoom`, `.manage(zoom::Zoom::default())`, `zoom::set_up` in `setup` before the main window opens, the two commands in `generate_handler!`, `open_preferences:242-256`), `apps/desktop/src-tauri/src/windows.rs:365-383` (`build_window`)

**Interfaces:**
- Consumes: `ZOOM_EVENT = 'zoom'` and `__REDLINES_ZOOM__` from Task 8; `windows::is_document_window`, `windows::PREFERENCES_WINDOW`.
- Produces:

```rust
pub const ZOOM_EVENT: &str = "zoom";
#[derive(Default)] pub struct Zoom(Mutex<Option<f64>>);
#[derive(Clone, Copy, Debug, PartialEq)] pub struct Frame { pub x: f64, pub y: f64, pub width: f64, pub height: f64 }
pub fn set_up(app: &AppHandle);                    // reads zoom.json into the state
pub fn init_script(app: &AppHandle) -> String;     // for WebviewWindowBuilder::initialization_script
pub fn apply(window: &WebviewWindow);              // set_zoom, when the app has a level
pub fn preferences_inner_size(app: &AppHandle) -> (f64, f64);
pub fn preferences_frame(zoom: f64, current: Frame, area: Frame) -> Frame;
#[tauri::command] pub fn set_zoom(app: AppHandle, window: WebviewWindow, level: f64) -> Result<(), String>;
#[tauri::command] pub fn zoom_level(app: AppHandle, reported: f64) -> f64;
// Inside the module, for its tests:
fn is_rung(level: f64) -> bool;
fn read_remembered(file: &Path) -> Option<f64>;
fn keep(file: &Path, level: f64) -> io::Result<()>; // writes {"zoom":<level>}, making the folder
fn answer(level: &mut Option<f64>, reported: f64) -> (f64, bool); // the answer, and whether the report was taken
fn may_zoom(label: &str) -> Result<(), String>;
fn script(level: Option<f64>) -> String;
fn zoomed_size(zoom: f64, area: Option<(f64, f64)>) -> (f64, f64); // 560 × 400 × zoom, within the area
```

- [ ] **Step 1: Write the failing tests** in `zoom.rs`'s `mod tests`, as `dock_icon.rs` tests `icon.json`:
  - `the_ladder_is_the_pages`: `include_str!("../../src/text-size.ts")` holds `[0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2]`; `is_rung(1.25)`, and not 1.3, 0.0, 2.5 or `f64::NAN`.
  - `what_is_remembered_comes_back_from_its_file`: `keep(&file, 1.5)` writes `{"zoom":1.5}`, read back as `Some(1.5)`, its folder made; a missing file, `not json`, `{"zoom":1.3}`, `{"zoom":"1.5"}` and `{}` read as `None`.
  - `the_first_report_gives_the_app_its_level_and_no_later_one_does`: `answer(&mut None, 1.5)` is `(1.5, true)` and leaves `Some(1.5)`; then `answer(.., 2.0)` is `(1.5, false)`; `answer(&mut Some(1.25), 2.0)` is `(1.25, false)`; `answer(&mut None, 1.3)` is `(1.0, false)` and leaves `None`.
  - `only_a_document_window_or_preferences_may_zoom`: `may_zoom` is Ok for `main`, `doc-3` and `preferences`, an Err for `install`.
  - `the_script_hands_the_page_the_level`: `script(Some(1.25))` is `window.__REDLINES_ZOOM__ = 1.25;` and `script(None)` is `window.__REDLINES_ZOOM__ = null;`.
  - `the_window_hears_the_event_the_app_sends`: `include_str!("../../src/zoom.ts")` holds `'zoom'` and `__REDLINES_ZOOM__`.
  - `preferences_grows_from_its_top_and_middle_and_stays_on_the_screen`, with `area = Frame { x: 0.0, y: 25.0, width: 1440.0, height: 875.0 }` and `current = Frame { x: 440.0, y: 200.0, width: 560.0, height: 400.0 }`: zoom 1.25 gives `{ 370, 200, 700, 500 }`; zoom 2 gives `{ 160, 100, 1120, 800 }`; current at y 600 and zoom 1.1 gives `{ 412, 460, 616, 440 }`; in `{ 0, 25, 1024, 743 }` zoom 2 gives `{ 0, 25, 1024, 743 }`. `zoomed_size(2.0, Some((1024.0, 743.0)))` is `(1024.0, 743.0)`, and `zoomed_size(1.5, None)` is `(840.0, 600.0)`.
- [ ] **Step 2: Run** in `apps/desktop/src-tauri`: `PATH=/opt/homebrew/opt/rustup/bin:$PATH cargo test zoom`. Expected: FAIL to compile (no `zoom` module).
- [ ] **Step 3: Implement.** `set_zoom` refuses what isn't a rung or comes from another window, does nothing for the level the app has, else keeps it, writes `zoom.json` (an `eprintln!` if it can't, as `dock_icon.rs`), and broadcasts. `zoom_level` returns `answer`'s level, and when the report was taken writes the file and broadcasts unless it is 1. The broadcast goes to each `app.webview_windows()` entry that is a document window or Preferences: `app.emit_to(label.as_str(), ZOOM_EVENT, level)`, then `window.set_zoom(level)`, then, for Preferences, its new frame (`set_size` and `set_position`, logical, from `preferences_frame` of its frame and its monitor's work area). `build_window` adds `.initialization_script(zoom::init_script(app))` to the builder and calls `zoom::apply` on the window it built; `open_preferences` does the same, with `.inner_size(..)` from `preferences_inner_size` (560 × 400 times the zoom, within the primary monitor's work area when it is known).
- [ ] **Step 4: Run** `PATH=/opt/homebrew/opt/rustup/bin:$PATH cargo test` and `PATH=/opt/homebrew/opt/rustup/bin:$PATH cargo clippy --all-targets -- -D warnings`. Expected: PASS, no warnings.
- [ ] **Step 5: Commit** `Desktop: the app keeps the window zoom and sets it on every window (#189)`.

### Task 10: The frame keeps its points

Spec: The window's frame (and its two calls).

**Files:**
- Create: `apps/desktop/src/zoom.css`
- Modify: `apps/desktop/src/main.ts` and `apps/desktop/src/preferences/main.ts` (import `./zoom.css` and `../zoom.css`), `apps/desktop/src/styles.css:79-226, 367-370, 460-462`, `apps/desktop/src/preferences/preferences.css:42-70`, `AGENTS.md` (the interface-text bullet)
- Test: `apps/desktop/src/interface-text.node.test.ts:16-21`, `apps/desktop/src/styles.node.test.ts`

**Interfaces:**
- Produces, on `:root` in `zoom.css`: `--rl-zoom: 1`; `--rl-pt: calc(1px / var(--rl-zoom))`; `--rl-frame: calc(1px * min(var(--rl-zoom), 1.5) / var(--rl-zoom))`; `--rl-size-ui-frame: calc(var(--rl-size-ui) * min(var(--rl-zoom), 1.5) / var(--rl-zoom))`; `--rl-size-ui-small-frame: calc(var(--rl-size-ui-small) * min(var(--rl-zoom), 1.5) / var(--rl-zoom))`.

- [ ] **Step 1: Write the failing tests.** `interface-text.node.test.ts`: `TOKENS` gains `var(--rl-size-ui-frame)` and `var(--rl-size-ui-small-frame)`; `it("keeps the frame's text at the interface's sizes or larger, in points, at every zoom from 100%")`: `zoom.css` holds the two formulas above exactly, and in points (`size * Math.min(zoom, 1.5)`) each is at least its base at 1, 1.1, 1.25, 1.5, 1.75 and 2, and 21 for 14 px at 2. `styles.node.test.ts`, `it('keeps the frame in points beside the window buttons, its controls zooming to 150%')`: `.rl-titlebar` declares `height: calc(52 * var(--rl-pt))` and `padding: 0 calc(12 * var(--rl-pt))`; `.rl-files-control` `top: calc(26 * var(--rl-pt) - 14 * var(--rl-frame))` and `left: calc(84 * var(--rl-pt))`; `.rl-icon-button` `width: calc(32 * var(--rl-frame))` and `height: calc(28 * var(--rl-frame))`; `.rl-title` `font-size: var(--rl-size-ui-frame)`; `.rl-sidebar-head` `height: calc(52 * var(--rl-pt))`; `.rl-notice` `top: calc(56 * var(--rl-pt))`; `.rl-menu` `max-width: calc(100vw - 32px)`; and in `preferences.css`, `.rl-pref-bar` `height: calc(56 * var(--rl-pt))` and `.rl-pref-tab` `width: calc(44 * var(--rl-frame))`.
- [ ] **Step 2: Run** `npx -y pnpm@10.28.0 test apps/desktop/src/interface-text.node.test.ts apps/desktop/src/styles.node.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** In points (`--rl-pt`), what lines up with the window buttons: the bar's height and padding, Files' place, the sidebar head's height, the notice's top, and the title bar's side columns, `minmax(calc(84 * var(--rl-pt) + 40 * var(--rl-frame)), 1fr)` on both sides. In `--rl-frame`, the controls' own sizes: icon buttons (32 × 28, Files 30 wide), their radii and gaps, their SVGs (`calc(18 * var(--rl-frame))`, Files' 17), the title field's padding and radius, the tip under Files (`top: calc(34 * var(--rl-frame))`), the menu anchor (`top: calc(28 * var(--rl-frame))`), Preferences' tabs (44 × 34, gap 4, icons 20). The file name takes `var(--rl-size-ui-frame)`. AGENTS.md's interface-text bullet names the two frame tokens, for the title bar, the sidebar's head and Preferences' top bar. With `--rl-zoom` at 1 nothing moves yet.
- [ ] **Step 4: Run** `npx -y pnpm@10.28.0 test apps/desktop`. Expected: PASS.
- [ ] **Step 5: Commit** `Desktop: the frame keeps its points at every zoom (#189)`.

### Task 11: The View menu's six rows, and Body on ⇧⌘N

Spec: Keys and menus (the table and its calls, Body's paragraph); Browsers and embedded editors.

**Files:**
- Modify: `apps/desktop/src/menu-model.ts:8-64, 199-346`, `plugins/formatting/src/index.ts:161-166, 467, 537`, `docs/design.md` §5.9 (Body's row)
- Test: `apps/desktop/src/menu-model.test.ts:15-71, 166-185, 225-245`, `apps/desktop/src/native-menu.test.ts:119-175, 478-490`, `apps/desktop/src/format-menu.test.ts:71-79, 116`, `plugins/formatting/src/index.test.ts:384`

**Interfaces:**
- Produces: `MenuCommands.zoomIn(): void`, `zoomOut(): void`, `actualSize(): void` (`actualTextSize` is the text's); `MenuState.zoom: number` and `MenuState.textSize: number`; `appMenuModel(commands, registry, options?: { browser?: boolean })`. Body's shortcut is `Mod-Shift-n`.

- [ ] **Step 1: Write the failing tests.** The View rows read `['Clean', 'Alt+CmdOrCtrl+1'], ['Redlines', 'Alt+CmdOrCtrl+2'], ['Raw', 'Alt+CmdOrCtrl+3'], '---', ['Actual Size', 'CmdOrCtrl+0'], ['Zoom In', 'CmdOrCtrl+='], ['Zoom Out', 'CmdOrCtrl+-'], '---', ['Actual Text Size', 'Ctrl+Cmd+0'], ['Larger Text', 'Ctrl+Cmd+='], ['Smaller Text', 'Ctrl+Cmd+-'], '---', ['Show Files', 'Ctrl+Cmd+S'], 'Enter Full Screen'`. Each row's click runs its command (Actual Size `actualSize`, Actual Text Size `actualTextSize`). `it('enables the size rows between the ends')`: Actual Size is disabled at zoom 1 and enabled at 1.25, Zoom In disabled at 2, Zoom Out at 0.8; the text rows the same by `textSize`, all three enabled at 1.37. `it('leaves the zoom keys to the browser')`: with `{ browser: true }` the three zoom rows have `keyInMenuOnly: true` and the text rows don't; in the app no row of the six has it. `native-menu.test.ts`'s text size test becomes `'in a browser, leaves ⌘=, ⌘− and ⌘0 to it, and steps the text with ⌃⌘= (also as +), ⌃⌘− and ⌃⌘0'` (`press` returns false for the three zoom keys; ⇧⌘0 runs nothing). `format-menu.test.ts`: Body's row is `['Body', 'CmdOrCtrl+Shift+N']`, and `STATE` gains `zoom: 1, textSize: 1`; its "binds no key twice" test stays as the guard. `plugins/formatting`: the registration table has `'block.body': 'Mod-Shift-n'`, and `it('binds no command to Mod-0')`. Every `MenuCommands` and `MenuState` the tests build gains the new members.
- [ ] **Step 2: Run** `npx -y pnpm@10.28.0 test apps/desktop/src/menu-model.test.ts apps/desktop/src/native-menu.test.ts apps/desktop/src/format-menu.test.ts plugins/formatting`. Expected: FAIL.
- [ ] **Step 3: Implement** the rows in the spec's order and names, with `enabled` from the state: `zoom !== 1`, `zoom < 2`, `zoom > 0.8` (and the same of `textSize`). The text rows carry a comment that off the Mac `Cmd` is the Super key, as for Show Files, until Windows and Linux get keys of their own. Body's `Mod-0` becomes `Mod-Shift-n` in the command, the manifest and `createFormatting`'s doc comment ("Body ⇧⌘N"). Add `zoomIn`, `zoomOut` and `actualSize` to main.ts's `commands` as no-ops for now (Task 13 fills them), and pass `{ browser: !isTauri }` to `appMenuModel`. design.md §5.9's Body row becomes "⇧⌘N and ⌘1 to ⌘6 | Ctrl+Shift+N and Ctrl+1 to Ctrl+6".
- [ ] **Step 4: Run** the same tests, then `PATH=/opt/homebrew/opt/rustup/bin:$PATH cargo test menu_accelerators` in `apps/desktop/src-tauri`. Expected: PASS: muda parses `Ctrl+Cmd+0`, `Ctrl+Cmd+=` and `Ctrl+Cmd+-`.
- [ ] **Step 5: Commit** `Desktop: View › Actual Size, Zoom In and Zoom Out, and Body moves to ⇧⌘N (#189)`.

### Task 12: ⌘+ typed as "+"

Spec: Keys and menus (the "+" call); Constraints, the menu bar's keys.

**Files:**
- Modify: `apps/desktop/src/native-menu.ts`
- Test: `apps/desktop/src/native-menu.test.ts`

**Interfaces:**
- Consumes: the rows of Task 11 whose accelerators end in `+=` (`CmdOrCtrl+=`, `Ctrl+Cmd+=`).
- Produces: `installPlusKeys(model: MenuModel, state: () => MenuState | null): () => void`.

- [ ] **Step 1: Write the failing tests.** `it('runs Zoom In for ⌘+ and Larger Text for ⌃⌘+, from any key, Shift or not')`: a keydown with `key: '+'` and `metaKey`, once with `code: 'Equal'` and `shiftKey` (US) and once with `code: 'BracketRight'` (German), runs `zoomIn` once each and is prevented; with `ctrlKey` too, `biggerText`. `it('leaves = to the menu bar, and + at a limit')`: `key: '='` with ⌘ isn't prevented and runs nothing; with the state's zoom at 2, `+` isn't prevented and runs nothing. `it('leaves + without ⌘, or with ⌥')`. Review Focus 4, `it('zooms once from a comment box or the find bar')`: the keydown dispatched from a `<textarea>` and from an `<input>` in the page, bubbling, runs `zoomIn` once each and is prevented.
- [ ] **Step 2: Run** `npx -y pnpm@10.28.0 test apps/desktop/src/native-menu.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** A `keydown` listener on `window` that leaves an event already prevented; it takes `key === '+'` with `metaKey` and without `altKey`, picks the row by whether its accelerator has `Ctrl` as the event has `ctrlKey`, and runs its action, preventing the event, unless the row's `enabled(state())` is false.
- [ ] **Step 4: Run** it. Expected: PASS.
- [ ] **Step 5: Commit** `Desktop: ⌘+ typed as + zooms the window (#189)`.

### Task 13: ⌘+ and ⌘− zoom every document window

Spec: Keys and menus (the notice call); The reading place; Every window, kept; Changes to design.md, format.md and the README.

**Files:**
- Modify: `apps/desktop/src/main.ts`, `apps/desktop/src/ui/titlebar.ts:256-264`, `plugins/review/src/cards.ts:222-310`, `plugins/review/src/rail.ts` (`RailControl`), `plugins/review/src/index.ts`, `docs/design.md` (§5.1, the Preferences bullet, §5.9, §5.12, §6.6's floor, §11), `docs/format.md:1618-1619`, `README.md:52-56`
- Test: `apps/desktop/src/ui/titlebar.test.ts`, `plugins/review/src/rail.test.ts`, `plugins/review/src/cards.test.ts`

**Interfaces:**
- Consumes: `readingPlace`, `placeBack` (Task 7); `initialZoom`, `applyZoom`, `followZoom`, `tauriZoomLink`, `PageZoom` (Task 8); `installPlusKeys` (Task 12); `stepSize`.
- Produces: the title bar's `closeMenus(): void`; `ReviewController.closePopovers(): void`, which puts away a change's card and a note shown from its dot, but never a note being written; `cards(ctx)` returns `{ extension: Extension; close(view: EditorView): void }`; `RailControl.closePopover(): void`.

- [ ] **Step 1: Write the failing tests.** `titlebar.test.ts`: `it('closes its menus when asked')`: the View menu, opened by a click, is closed (its anchor hidden) after `closeMenus()`. `cards.test.ts`: `it('puts a pinned card away when asked')`. `rail.test.ts`: `it('puts a note shown from its dot away at closePopovers()')` (compact rail, a clicked dot, then `review.closePopovers()`: no `rl-note-open`). Review Focus 1, `it('leaves a note being written open, with its draft and the keyboard, at closePopovers()')`: in a compact rail, `review.startComment()`, text typed in its box, then `closePopovers()`: the note keeps `rl-note-open`, the box its value, and `document.activeElement` is still the box.
- [ ] **Step 2: Run** `npx -y pnpm@10.28.0 test apps/desktop/src/ui/titlebar.test.ts plugins/review`. Expected: FAIL.
- [ ] **Step 3: Implement the review and title bar parts**, then wire `main.ts`:
  - At the top, beside `followTheme`: `applyZoom(document.documentElement, initialZoom() ?? 1)`.
  - In the app, once the editor, title bar and review exist: `zoom = await followZoom(tauriZoomLink(), …)` with `level` the one applied, `settings: () => settings.zoom`, `save: (level) => changeSettings({ zoom: level })`, `before` taking `readingPlace(editor.view, scroller)` and calling `titleBar.closeMenus()` and `review.closePopovers()`, and `after` dispatching `placeBack(editor.view, scroller, place, from / level)` and calling `render()`. In a browser, `zoom` stays null.
  - `zoomIn` and `zoomOut` ask `stepSize(zoom.level(), ±1)` and `actualSize` asks 1, each saying "Zoom 125%" (only when the level changes); the menu's three text commands say "Text size 110%" after they change it (the pinch, which Task 19 rewrites, says nothing).
  - `render()` gives `nativeMenu.update` `zoom: zoom?.level() ?? 1` and `textSize: settings.textSize`, and keeps that state for `installPlusKeys(menuModel, () => menuState)`, installed in the app on the Mac only (`navigator.userAgent` holds `Macintosh`).
  - The docs: design.md §5.1's Text size bullet becomes the spec's Zoom and text size bullet, but for its sentence on Text Zoom, which until Task 19 reads "Text Zoom changes only the document's text and the notes and cards on it, from 80% to 200%: Larger Text (⌃⌘=), Smaller Text (⌃⌘-) and Actual Text Size (⌃⌘0), and a pinch, walk the same sizes."; the Preferences bullet "Appearance (Match System, Light or Dark, the theme, zoom and text size)"; §5.9 gains the zoom row and its text size row becomes "⌃⌘=, ⌃⌘- and ⌃⌘0, or a pinch | a pinch"; §5.12, §6.6's floor bullet, §11, format.md §5.6 and the README as the spec says.
- [ ] **Step 4: Run** `npx -y pnpm@10.28.0 test apps/desktop plugins/review`, then `npx -y pnpm@10.28.0 typecheck && npx -y pnpm@10.28.0 lint`. Expected: PASS, no errors.
- [ ] **Step 5: Commit** `Desktop: ⌘+ and ⌘− zoom every window (#189)`.

### Task 14: Preferences zooms, and its Zoom stepper

Spec: Every window, kept (the stepper, Preferences' size); The window's frame (Preferences' top bar).

**Files:**
- Modify: `apps/desktop/src/preferences/panes.ts:39-60, 278-322`, `apps/desktop/src/preferences/main.ts`
- Test: `apps/desktop/src/preferences/panes.test.ts:20-40, 66, 190-204`

**Interfaces:**
- Consumes: `initialZoom`, `applyZoom`, `followZoom`, `tauriZoomLink` (Task 8); the app resizes Preferences itself (Task 9).
- Produces: `PaneDeps.setZoom: (level: number) => void`.

- [ ] **Step 1: Write the failing tests.** Appearance's rows are `['Appearance', 'Theme', 'Zoom', 'Text size']`. `it('steps the zoom through the ladder, asks for it, and stops at its ends')`: the Zoom row shows `100%` and the line "Everything in Redlines’ windows"; Larger calls `setZoom(1.1)` and shows `110%`; ten Smallers reach `80%` and disable Smaller; ten Largers reach `200%` and disable Larger. The setup's deps gain `setZoom: vi.fn()`.
- [ ] **Step 2: Run** `npx -y pnpm@10.28.0 test apps/desktop/src/preferences/panes.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** One stepper builder serves both rows (value, Smaller and Larger, the live region on the value). Zoom starts at `settings().zoom` and calls `deps.setZoom`. `preferences/main.ts` applies `initialZoom() ?? 1` before anything draws, and in the app follows the zoom with `followZoom` (its `save` updates the settings, its `after` redraws the pane); `deps.setZoom` asks through it, or in a browser saves the setting.
- [ ] **Step 4: Run** `npx -y pnpm@10.28.0 test apps/desktop`. Expected: PASS.
- [ ] **Step 5: Commit** `Preferences: the Zoom stepper, and Preferences grows with the zoom (#189)`.

### Task 15: Every surface fits a narrow page

Spec: Narrow pages.

**Files:**
- Modify: `plugins/review/src/bar.ts:198-327`, `plugins/review/src/styles.ts` (the narrow bar), `apps/desktop/src/ui/sidebar.ts`, `apps/desktop/src/styles.css` (the sidebar), `apps/desktop/src/main.ts:337-345`
- Test: `plugins/review/src/bar.test.ts`, `apps/desktop/src/styles.node.test.ts`

**Interfaces:**
- Produces: `barNarrow(fullWidth: number, windowWidth: number): boolean` (true when `fullWidth > windowWidth - 32`), exported from `bar.ts`; the class `rl-review-bar-narrow`; `SIDEBAR_COVERS = '(max-width: 599.98px)'`, exported from `ui/sidebar.ts`.

- [ ] **Step 1: Write the failing tests.** `bar.test.ts`: `barNarrow(420, 452)` is false and `barNarrow(421, 452)` true; `it("shows Accept and Reject as icons, named in their hints, when the bar doesn't fit the window")`: with the bar's `offsetWidth` stubbed to 420 and `innerWidth` 400, after a frame the bar has `rl-review-bar-narrow`, Accept keeps `aria-label` `Accept` and holds an `.rl-hint` reading `Accept`; at `innerWidth` 800 the class goes. `styles.node.test.ts`: `it('lays the sidebar over the page when the page beside it would be under 360 px')`: the style sheet holds `@media ${SIDEBAR_COVERS}` with `.rl-app[data-sidebar='open'] .rl-sidebar` positioned `absolute`.
- [ ] **Step 2: Run** `npx -y pnpm@10.28.0 test plugins/review/src/bar.test.ts apps/desktop/src/styles.node.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** The text buttons keep their label in a span, and always an `aria-label`; the bar's `place()` keeps the width it measures while it isn't narrow, toggles the class from `barNarrow`, and places itself again when the class changes. The narrow class hides the labels and shows the text buttons' hints on hover, as the icon buttons'. The sidebar rule covers the page's left with the card's shadow; main.ts's `openFile` closes the sidebar after opening a document here while `matchMedia(SIDEBAR_COVERS)` matches.
- [ ] **Step 4: Run** `npx -y pnpm@10.28.0 test plugins/review apps/desktop`. Expected: PASS.
- [ ] **Step 5: Commit** `Desktop: every surface fits a page 360 px wide (#189)`.

### Task 16: WebKit checks of the window zoom

Spec: Tests, In WebKit, checks 1, 4 (the zoom's part) and 7; To check in a build.

**Files:**
- Modify: `apps/desktop/src/zoom-check.ts`, `apps/desktop/src/main.ts` (pass `zoom` to the check)

**Interfaces:**
- Consumes: `PageZoom` (Task 8), `ZoomCheckContext.zoom`.

- [ ] **Step 1: Write the checks.** Each asks its levels with `zoom.ask` and waits for `--rl-zoom` to be the level and two frames. `positions-map-at-every-zoom`: at 0.8, 1, 1.5 and 2, `posAtCoords` of the middle of `coordsAtPos(p)` is `p` for 50 positions on screen. `caret-keeps-its-place`: with the caret on a line mid-screen, its line's top in points (`coordsAtPos(head).top` times the zoom) is within 2 of where it was across 1 → 1.25 → 1 → 0.9 → 1. `frame-stays-on-the-buttons-line`: in every frame from an ask until three frames after it lands, the Files control's middle in points (CSS px times `devicePixelRatio` over its value at 100%) is 26 within 1. `surfaces-fit`: at zoom 2 with `innerWidth` 360 (the window at its smallest; else the check fails and says so), the title bar's controls, the open review bar, the open sidebar, a pinned card, the find bar, a notice, a notification and the open View menu are each inside the window, and those that keep 16 px from its sides keep them.
- [ ] **Step 2: Run** `VITE_ZOOM_CHECK=1 PATH=/opt/homebrew/opt/rustup/bin:$PATH npx -y pnpm@10.28.0 tauri dev` in `apps/desktop`, the window dragged to its smallest before `surfaces-fit`. Expected: `ZOOM-CHECK done 6 passed, 0 failed`. A failure is a bug in Tasks 7–15: fix it there.
- [ ] **Step 3: Run** `npx -y pnpm@10.28.0 typecheck && npx -y pnpm@10.28.0 lint`. Expected: no errors.
- [ ] **Step 4: Commit** `Desktop: WebKit checks of the window zoom (#189)`. The PR's by-hand list: ⌘+ as ⇧⌘= (US) and as the + key (German), each zooming once, and ⌃⌘+ the same; a new window at 150% with no frame at 100%; the title bar's icons on the window buttons' line from 80% to 200%, with no frame out of line at a change; Preferences at 200% on a 13-inch screen, and opened low on the screen; VoiceOver reading "Zoom 125%"; a print to PDF from the panel at 200% matching one at 100%, page for page.

## Stage 3: A fluid pinch (#189)

### Task 17: Text sizes between rungs

Spec: The keys (the next-rung call); Edge cases (older settings); The pinch's last paragraph (Preferences shows sizes between rungs).

**Files:**
- Modify: `apps/desktop/src/text-size.ts:27-40`, `apps/desktop/src/settings.ts:302-304`
- Test: `apps/desktop/src/text-size.test.ts:21-41`, `apps/desktop/src/settings.test.ts:249-256`, `apps/desktop/src/preferences/panes.test.ts`

**Interfaces:**
- Produces: `stepSize(size: number, by: number): number`: `by` rungs up from the first rung above `size`, or down from the last below it, held at the ends; 0 leaves it. `settings.textSize` takes any whole percent from 80 to 200.

- [ ] **Step 1: Write the failing tests.** `stepSize(1.37, 1)` is 1.5 and `stepSize(1.37, -1)` 1.25; `stepSize(1, 1)` 1.1, `stepSize(1.1, -2)` 0.9, `stepSize(1.02, -1)` 1, `stepSize(2, 1)` 2, `stepSize(0.8, -1)` 0.8, `stepSize(5, -1)` 2. Settings: `1.37` loads as 1.37; `1.375`, `0.79`, `2.01`, `"1.5"` and `null` load as 1. Panes: with `textSize` 1.37 the Text size row shows `137%`; Larger saves 1.5; from 1.37 again, Smaller saves 1.25.
- [ ] **Step 2: Run** `npx -y pnpm@10.28.0 test apps/desktop/src/text-size.test.ts apps/desktop/src/settings.test.ts apps/desktop/src/preferences/panes.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `stepSize` (compare with a 1e-9 margin) and `isTextSize` (a number from 0.8 to 2 whose hundredfold is whole within 1e-9). `sizeIndex` stays while main.ts's pinch uses it.
- [ ] **Step 4: Run** `npx -y pnpm@10.28.0 test apps/desktop`. Expected: PASS.
- [ ] **Step 5: Commit** `Desktop: text sizes between the rungs, and steps from them to the next (#189)`.

### Task 18: The rail keeps its state through a pinch

Spec: The pinch (Stephan's call, the notes bullet, the hold's call); The rail beside it (its last paragraph).

**Files:**
- Modify: `plugins/review/src/rail.ts` (the measure's write, `RailControl`), `plugins/review/src/index.ts`, `docs/design.md` §5.7 (its last sentence)
- Test: `plugins/review/src/rail.test.ts`

**Interfaces:**
- Consumes: `railCompact` (Task 4).
- Produces: `ReviewController.holdRail(held: boolean): void`; `RailControl.hold(held: boolean): void`.

- [ ] **Step 1: Write the failing tests.** `it('keeps its notes while held, however narrow the editor gets, and shrinks them to dots once let go')`: at 1200 px the rail shows; `review.holdRail(true)`; at 700 px, after a transaction, a frame and a tick, the editor still has `rl-has-rail` and the rail no `rl-rail-compact`, and the notes are still placed (their `style.top` set); `holdRail(false)`, a frame and a tick: compact. `it('keeps its dots while held, and brings the notes back once let go')`, the other way round.
- [ ] **Step 2: Run** `npx -y pnpm@10.28.0 test plugins/review/src/rail.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** While held, the write places the rail in the state it has and doesn't change it; letting go measures again, which applies the rule once. design.md §5.7 ends "During a pinch the rail keeps its state until the fingers lift."
- [ ] **Step 4: Run** `npx -y pnpm@10.28.0 test plugins/review`. Expected: PASS.
- [ ] **Step 5: Commit** `Review: the rail keeps its state through a pinch (#189)`.

### Task 19: The pinch follows the fingers

Spec: The pinch (every bullet and call); The keys; Edge cases (a pinch over the sidebar, beside notes, with a comment box focused, during a zoom change).

**Files:**
- Create: `apps/desktop/src/text-zoom.ts`, `apps/desktop/src/text-zoom.test.ts`
- Modify: `apps/desktop/src/text-size.ts` (the pinch), `apps/desktop/src/main.ts:93-95, 477-494, 595-597, 739-756`, `apps/desktop/src/preferences/main.ts`, `docs/design.md` §5.1 (the pinch clause)
- Test: `apps/desktop/src/text-size.test.ts:5-19, 43-121`

**Interfaces:**
- Consumes: `readingPlace`, `placeAt`, `placeBack` (Task 7); `stepSize` (Task 17); `ReviewController.holdRail` (Task 18).
- Produces, from `text-size.ts` (`pinchSteps`, `PINCH_FACTOR` and `sizeIndex` go):

```ts
export const WHEEL_QUIET_MS = 250;
export interface PinchHandlers {
  size(): number; // the size when a pinch begins
  start(point: { x: number; y: number } | null): void;
  change(size: number): void; // each new whole-percent size
  end(size: number): void; // once, when the fingers lift
}
export function watchPinch(target: Window, handlers: PinchHandlers): () => void;
/** Keeps a page that has no text to zoom, as Preferences, from magnifying itself. */
export function ignorePinch(target: Window): () => void;
```

From `text-zoom.ts`:

```ts
export interface TextZoomOptions {
  view: EditorView;
  scroller: HTMLElement;
  root: HTMLElement;
  size(): number; // the size in the settings now
  save(size: number): void;
  holdRail(held: boolean): void;
  say(text: string): void; // the notice
}
export interface TextZoom {
  step(by: 1 | -1): void; // Larger and Smaller Text
  reset(): void; // Actual Text Size
  follow(size: number): void; // a size another window saved
  stop(): void;
}
export function followTextZoom(win: Window, options: TextZoomOptions): TextZoom;
```

- [ ] **Step 1: Write the failing tests.** `text-size.test.ts` (the `watchPinch` block is rewritten):
  - `it('follows the fingers from the size it began at, to the nearest whole percent')`: from 1, scales 1.37 and 1.374 call `change(1.37)` once; 1.5 calls `change(1.5)`.
  - `it('holds at 80% and 200%, and moves back at once when the fingers turn')`: from 1.75, scale 1.2 gives 2; then 1.1 gives `Math.round((2 / 1.2) * 1.1 * 100) / 100`.
  - `it('keeps the page from magnifying itself')`: every gesture event is prevented.
  - `it("takes the gesture's point, else the pointer's last place")`: `start({ x, y })` from the event's `clientX` and `clientY`; without them, from the last `pointermove`; with neither, `start(null)`.
  - `it('ends once when the fingers lift')`: `gestureend` calls `end` with the last size, once.
  - Review Focus 3, `it('ends a pinch the window loses the focus in')`: after `gesturestart` and a change, a `blur` on the window calls `end` once, and a later `gestureend` nothing more.
  - `it('pinches with Ctrl and the wheel, and ends when the wheel has been quiet')` (fake timers): `deltaY` −20 from 1 calls `change(1.22)`; after `WHEEL_QUIET_MS`, `end(1.22)`; a plain wheel does nothing.
  - `it('keeps Preferences from magnifying under a pinch')` for `ignorePinch`.

  `text-zoom.test.ts` (happy-dom, a real editor; `holdRail`, `save` and `say` as `vi.fn()`):
  - `it('applies each size with its place in one call, so that no frame shows one without the other')`: in a `view.dispatch` spy, `--rl-text-scale` on `root` is already the new size, and the dispatch carries an effect; one dispatch for each new size, inside the gesture event's own dispatch.
  - `it('holds the rail from the first event until the fingers lift, and saves once')`: `holdRail(true)` at the start; at the end `save(1.37)`, `holdRail(false)` and `say('Text size 137%')`, once each; nothing saved before.
  - `it("steps from a size between rungs to the next, keeping the caret's line")`: at 1.37, `step(1)` saves 1.5, sets `--rl-text-scale` to `1.5`, dispatches a place and says `Text size 150%`; at 2, `step(1)` does nothing.
  - `it('takes the place before applying a size another window saved')`.
  - `it('is never an edit')`: after a pinch, `step`, `reset` and `follow`, the document is the same object, and nothing in the editor's `onChange` was called.
- [ ] **Step 2: Run** `npx -y pnpm@10.28.0 test apps/desktop/src/text-size.test.ts apps/desktop/src/text-zoom.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** `watchPinch` keeps the start size and re-bases it at a limit (size held at 2 for scale s makes the start 2 / s), rounds to whole percents, calls `change` only for a new size, and ends on `gestureend`, `blur` or a quiet wheel. `followTextZoom` takes `placeAt(view, scroller, point)` at the start, and on each change applies the size (`applyTextSize`) and dispatches `placeBack` in the same call, never from an animation-frame callback; `step`, `reset` and `follow` take `readingPlace` first. In main.ts it replaces `stepTextSize`, `resetTextSize` and the old `watchPinch`, its `holdRail` is `review.holdRail`, and `watchSettings` hands a changed `textSize` to `follow`; `preferences/main.ts` calls `ignorePinch(window)`. design.md §5.1's Text Zoom sentence becomes the spec's: "Text Zoom changes only the document's text and the notes and cards on it, from 80% to 200%: a pinch follows the fingers and keeps the line under the pointer in place, and Larger Text (⌃⌘=), Smaller Text (⌃⌘-) and Actual Text Size (⌃⌘0) step the same sizes."
- [ ] **Step 4: Run** `npx -y pnpm@10.28.0 test apps/desktop`, then `npx -y pnpm@10.28.0 typecheck && npx -y pnpm@10.28.0 lint`. Expected: PASS, no errors.
- [ ] **Step 5: Commit** `Desktop: the pinch follows the fingers and keeps the line under them (#189)`.

### Task 20: WebKit checks of the pinch

Spec: Tests, In WebKit, checks 4 (the text's part) and 5, and the two calls under them; To check in a build.

**Files:**
- Create: `packages/editor/src/preview/long-document.ts`
- Modify: `packages/editor/src/preview/long-document.test.ts:15-60` (imports the generator), `apps/desktop/src/zoom-check.ts`, `apps/desktop/src/main.ts` (pass `textZoom`)

**Interfaces:**
- Produces: `longDocument(): { doc: string; firstMark: number }` and `idFor(n: number): string`, moved unchanged out of the test; `zoom-check.ts` imports them by relative path, as `provider-lines.node.test.ts` reaches into the plugins.

- [ ] **Step 1: Move the generator** and run `npx -y pnpm@10.28.0 test packages/editor/src/preview/long-document.test.ts`. Expected: PASS, unchanged.
- [ ] **Step 2: Write the checks.** `text-keys-keep-the-caret`: across `textZoom.step(1)`, `step(-1)` and `reset()`, the caret's line within 2 px of where it was. `pinch-keeps-its-line`: synthetic `gesturestart`, 60 `gesturechange`s of 1% up and 60 down (`scale` set on each, `clientX` and `clientY` over a line mid-screen), then `gestureend`: in every frame, the anchor's line top within 2 px of where it was. `pinch-frame-time`: for 60 steps, the time from a `gesturechange` to the end of CodeMirror's next measure (a `requestMeasure` write queued after it), at most 8 ms at the 90th percentile, on the welcome document and on `longDocument()` in Redlines with the rail showing.
- [ ] **Step 3: Run** `VITE_ZOOM_CHECK=1 PATH=/opt/homebrew/opt/rustup/bin:$PATH npx -y pnpm@10.28.0 tauri dev` in `apps/desktop`, the window dragged to its smallest before `surfaces-fit` as in Task 16. Expected: `ZOOM-CHECK done 9 passed, 0 failed` (the 6 checks of stages 1 and 2, and these 3). A failure is a bug in Tasks 17–19: fix it there.
- [ ] **Step 4: Commit** `Desktop: WebKit checks of the pinch (#189)`. The PR's by-hand list, for Stephan before it merges: the pinch with fingers on a real trackpad, on the welcome document in a wide window (a smooth magnification, no rewrap until the margins) and on a document with notes on a laptop (no switch to dots or back while the fingers are down, one when they lift); that WebKit's gesture events carry `clientX` and `clientY`; a pinch with a comment box focused keeps its draft and the keyboard.
