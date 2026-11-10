# The website: the real editor on the page, and a site that is current

*Design, Nov 10, 2026. Epic [#191](https://github.com/skadauke/redlines/issues/191), sub-issues
[#192](https://github.com/skadauke/redlines/issues/192) (the new icon, and what else is out of date)
and [#193](https://github.com/skadauke/redlines/issues/193) (demos as embedded Redlines panels). It
builds on [design.md](../../design.md) (§6.3 packages, §6.5 hosts, §6.6 styling) and the website's
own [README](../../../website/README.md). The format is not touched: nothing here changes
[format.md](../../format.md).*

## Why

Stephan's words, from the issues:

- #192: "The website still shows the old icon. Update it to the red caret, and check every page for
  anything else out of date: screenshots, features, the download section, the agent pages."
- #193: "The website's demo widgets are drawings of the editor. They could be real, embedded Redlines
  panels, built from the embed bundle (`apps/embed-smoke`): a visitor could type, see a tracked
  change and accept it on the page."
- #191: "The website needs the new icon and a look at what else is out of date, and its demos could
  be the real editor."

Two things sit under those words.

**The site a visitor sees is not the site in the repo.** The repository has had the red caret as the
tab icon and the brand mark since Nov 1 (`c871821`), and the Nov 5 copy. The live site,
`https://www.redlines.md/`, is the build of **Oct 15**: its `icon.svg` is the old gray sheet with
three bars, and its sections are the old ones. `deploy-website.yml` runs only when `release.yml`
calls it or someone dispatches it by hand, and nobody has since Oct 15 (`gh run list` shows the last
run, `38794846703`, on Oct 15). So the "old icon" has one cause, and it is not in the code. This
design fixes the cause first (stage 0), then does what #192 asks for the icon and the copy.

**The page argues for a shared format, and its best evidence is a drawing.** The hero's three views
and the agent animation are hand-built markup with their own sample text, which the README already
warns must be "kept in step with the format". They can only drift. A visitor who can type in the real
editor, see their own change appear in red, press Accept, and read the file that results in Raw, has
seen the claim proved: tracked changes live in a plain Markdown file. And the page itself becomes the
first working embed of the editor outside the desktop app, which v0.2 only promised ("keeps the door
open and proves it with a smoke test").

## Goals

1. The live site shows the current icon and the current copy, and **stays current**: it redeploys
   when its content or the editor it embeds changes.
2. The two illustrations that carry the argument become **the real editor**: the hero's three
   views (Clean, Redlines, Raw) and the agent exchange. A visitor can type, toggle Track Changes,
   comment, switch views, accept and reject, undo, and read the real file; and ask a scripted
   Claude about a sentence and decide its edit.
3. The page is still a static page: it reads the same with JavaScript off, costs nothing until the
   panel is wanted, makes **no request to any server but its own**, and writes nothing to the
   visitor's machine because of the demo.
4. It works on a phone, with a keyboard and with a screen reader, in light and dark.
5. A release, or a change to the editor, needs no one to remember the website.

## Non-goals

- A hosted editor: opening, saving or downloading files, a file sidebar, menus, Preferences, Print.
  The panels hold one sample document each, in memory.
- A real agent, an account, or any request to a model. See "The scripted Claude".
- Putting every illustration in a panel. The comparison table, the cards and the use cases stay HTML.
- Publishing `@redlines/react` or any npm package. The demo bundle is built for this site and is not
  an API.
- A new brand, a redesign of the page, new sections, analytics, or cookies.
- Offering the v0.1.0 pre-release as a download (see "Download").

## Anti-goals

These would make it a failure even if it technically works.

- **A demo that is a video of the editor in a frame,** or a canned sequence the visitor watches. If
  the visitor can't type in it, it fails #193.
- **A fake that cheats.** A Raw view that is not the file, accept buttons that don't edit the
  document, an agent edit that isn't a tracked change. The panel runs the product's code: the same
  views, the same tracked-change layer, the same review interface, the same agent tools.
- **A page that gets slow or heavy for people who didn't ask for it.** No editor code is downloaded
  before it is near the screen, and none on a data-saving connection until asked for.
- **A page that breaks without JavaScript, or when the bundle fails to load.** The server-rendered
  sheet stays the fallback. A visitor never sees an empty frame, a spinner that doesn't end, or an
  error.
- **An agent that starts from words in a file.** The hard rule of the product (v0.2 design: "a
  comment already in a file ... must never start a run") holds on the website too: the visitor's own
  post starts the run, nothing the page loads does.
- **Pretending the scripted Claude is a model.** The page says what it is.
- **The site drifting from the product again,** in either direction: copy that says what the app
  doesn't do, or a demo that shows what the app doesn't do.
- **Red used for anything but the brand,** as in the app (icon direction): errors, warnings and
  disabled states on the panels are gray.

## What I found (the audit behind #192)

Everything below was checked against the live site, the repository at `4de60b1` and the workflows.

| Finding | Evidence | Fix |
| --- | --- | --- |
| The live site is the Oct 15 build: old icon, old sections | `https://www.redlines.md/icon.svg` is the gray sheet; the last `deploy-website.yml` run is Oct 15 | Deploy now; deploy on push (stage 0) |
| Deploy comments and README say the repository is private and the name "not final" | `deploy-website.yml` header, `website/README.md` "Deploy", `site.config.mjs` | The repo is public, `www.redlines.md` is the Pages custom domain (verified); rewrite those lines |
| Pages has a certificate in state `new` and `https_enforced: false` | `gh api repos/skadauke/redlines/pages` | An admin turns on Enforce HTTPS once the certificate is issued (not something the code can do; listed in "Left to Stephan") |
| No `apple-touch-icon`, no Open Graph or Twitter image | `website/public` holds only `favicons/`; `layout.tsx` has `openGraph` with no image | Add `app/apple-icon.png` and `app/opengraph-image.png` made from the caret (stage 1) |
| Three copies of the caret path (`icon.svg`, `BrandMark`, `public/favicons/*`) and the app's masters, with nothing keeping them equal | `website/src/app/icon.svg`, `components/icons.tsx`, `apps/desktop/src-tauri/icons/family/*.svg` | `npm run icons:check` compares path data against the masters (stage 1) |
| "Built to embed" says "a drop-in component comes later" | `lib/site.ts`, `developers.cards` | Reword once the panels exist: the demos on this page are the editor, embedded (stage 2) |
| The comparison's "as of October 2026" | `lib/site.ts`, `compare.body` | Re-check each row against its product's documentation, then change the month (stage 1); I did not re-verify rows in this round |
| The hero's Raw view is a hand-copied file, not the file | `components/hero-sheet.tsx` (`source`) | Replaced by the real Raw view (stage 2); the fallback no longer shows Raw |
| Download shows "Coming soon" | `lib/release.json` is empty: the only release, `v0.1.0`, is a pre-release, and `/releases/latest` never returns one | Correct today, and stays so until a full release exists. See "Download" |
| The page has no version-specific claims that are wrong | `aiDocs`, `changes`, `uses`, `developers` read against README "What is in the Mac app" (find and replace, text size, sidebar, plain-text files, agents, the command line) | Add find and replace's tracked form and themes to `aiDocs` only if a point has room; otherwise nothing |

## Constraints

- **The format's rulings hold in the panels** because they are the product's code: every allowed
  edit reads the same in every decision order, micromark 4.0.2 is the oracle, a refused edit is
  refused rather than repaired, and ordinary typing is never refused. The panels add no editing
  code of their own. Where a panel needs something the editor lacks, the editor or a plugin gets it
  (two small additions, both in stage 3), and it comes with its tests there.
- **A keystroke costs what it does on main.** The embed adds no keymap, no update listener and no
  extension to the editor that the desktop app doesn't have, except the Track Changes and view
  controls the page draws outside the editor.
- **`docs/format.md` stays the source of truth.** The sample documents are valid files; a test
  parses them with `@redlines/format` and checks they have no diagnostics.
- **Platform.** The panel runs in the visitor's browser, so Chromium, WebKit (Safari and every iOS
  browser) and Firefox, as design.md's test list already says for the web ("tested in Chromium, WebKit and Firefox"). The bundle targets
  `es2022` and Safari 16 (`build.target`); a browser that can't run it keeps the fallback.
- **The site's rules stay:** a static export (`output: 'export'`) on GitHub Pages with no server, a
  base path that may or may not be `/`, no Google Fonts requests from visitors, and Tailwind with the
  design's own tokens (`globals.css`). `website/` stays outside the pnpm workspace and keeps npm.
- **No network.** After the page, the bundle, its stylesheet and its fonts (all same-origin), the
  panels make no request: no `fetch`, no `XMLHttpRequest`, no `WebSocket`, no beacon, no remote
  font or image. A test fails the build if one happens (see "Tests").
- **Nothing is written to the visitor's machine** by the demo: no `localStorage`, `sessionStorage`,
  cookies, IndexedDB or caches. (The site's tab-icon rotation already keeps `redlines.mark` in
  `localStorage`; that is the site's, it stays, and the test allows exactly that key.) The review
  plugin keeps a comment draft only when the host gives it a `documentData` store
  (`ReviewOptions.documentData`); the embed gives none, so a half-written comment is gone with the
  page.
- **Accessibility.** WCAG 2.2 AA, as the page is today. Specifics below.

## Which demos become real panels

There are two illustrations that show the editor, and the rest of the page is prose and tables.

| Today | Becomes | Why |
| --- | --- | --- |
| Hero: `HeroSheet` (a three-view switch over markup) | **Panel 1, "plan.md"**: the editor on the Launch plan document, with Clean, Redlines and Raw as the editor's real views, a Track Changes switch, Comment and Reset | It is the first thing seen, and the product's whole claim fits in it: a file with changes, three ways to read it |
| Changes section: `AgentDemo` (a timed animation of an agent) | **Panel 2, "design.md"**: the editor on a short design note with a button that opens a comment box already holding "@Claude is this still right? Fix it if not."; posting it runs a scripted Claude | The strongest line of the pitch is the agent's tracked edit in its own name, and it is only true if the visitor sees it arrive through the real tools |
| Compare, uses, developers, closing, download | Stay HTML | Prose and a table gain nothing from an editor |

**Call: two panels, not one and not five.** One shared panel would have to show two jobs (reading
three views, and asking an agent) and would load on top of the headline; five would multiply the
weight and the places to keep right. Two matches the two claims of the page.

**Call: the visitor starts the agent; the page doesn't play a movie.** The current animation
auto-plays. A real run triggered by the page would be the page posting a comment as the visitor, which
contradicts the rule that only a person's own post starts a run, and a reader who sees something
happen to a document they didn't touch learns less than one who presses Post. The button does the
tedious part (selects the sentence, opens the box, writes the question); the visitor presses Post
(or ⌘/Ctrl+Return) and watches the line, the reply and the edit arrive.

## The embed

### A new package, built like `embed-smoke`

`apps/embed-smoke` exists to prove the core embeds and to hold a size line on the **minimal** embed
(editor core, formatting, review; budget 276 KB gzipped, today 274). The website needs more than
that (the agents plugin, the themes' tokens and fonts, a page-facing API), and its size line is a
different line. So:

- **New private workspace package `apps/website-embed`** (`@redlines/website-embed`), built with the
  same Vite settings as `embed-smoke` (`build.lib`, ES module, minified, one JS file) plus the CSS and
  the fonts. `embed-smoke` is left alone and keeps proving that the core needs nothing but a stub
  host.
- **Call: a separate package, not a second entry in `embed-smoke`,** so that adding the demo's needs
  never moves the core's budget and the core's budget never hides the demo's growth. Both depend on
  the same workspace packages, so the test that keeps the core free of the desktop app covers both.
- Its dependencies: `@redlines/editor`, `@redlines/format`, `@redlines/formatting`,
  `@redlines/plugin-api`, `@redlines/review`, `@redlines/agents`, `@redlines/agent-tools`,
  `@redlines/themes`, and the three `@fontsource` packages (for the latin files only; see Fonts).
  No `@redlines/code` (no code-language grammars; the demo documents hold no fenced code), no
  `@redlines/find`, no desktop code.

### What it includes and leaves out

Included: the editor core with the three views; `@redlines/formatting` (so ⌘/Ctrl+B and the other
shortcuts work, as they would in the app); `@redlines/review` (margin notes, change cards, the review
bar, the comment box); the part of `@redlines/agents` that draws and runs an agent's thread (the
picker, the runs, the live line); the Default theme's tokens.

Left out: find, themes other than Default (the page has one look), code grammars, images, the
sidebar, anything that needs a file system. A document holding an image or a fenced code block would
need more; the two sample documents hold neither.

**Call: the Default theme only, in light and dark.** The page has one look, and Book and Editorial
would add their tokens and a second serif face for nothing a visitor can use.

### Size, lazy loading, fonts

Measured with a scratch build of the current sources (`vite build` with aliases to the workspace,
not in the repo): the minimal embed is **276 KB gzipped**; the editor alone **236 KB**; adding the
agents plugin and its scripted-run support adds **about 18 KB**. The demo's own glue (the page-facing
API, the scripted Claude, two sample documents) is small. The budget is therefore:

| Part | Budget (gzipped / as served) |
| --- | --- |
| `redlines-embed.<hash>.js` | 310 KB |
| `redlines-embed.<hash>.css` | 10 KB |
| Fonts (woff2, latin only): Carlito 400, 400 italic, 700; Cousine 400 | about 107 KB (30.2 + 30.5 + 31.5 + 15.2) |
| First panel, all told | **at most 430 KB**, and 0 more for the second panel |

`apps/website-embed/size-budget.json` holds the JS number, and the CI step is the one `embed-smoke`
has (`check-size.ts` is given the package directory as an argument, so there is one script). The
note in the budget file records each rise with its reason, as `embed-smoke`'s does.

Fonts: the themes' `fonts.css` imports every Unicode subset of each face (the scratch build inlined
3.8 MB of CSS). The embed has its own `fonts.css` that imports only the `latin` files, with
`assetsInlineLimit: 0` so they are separate files under `embed/fonts/`, same-origin, `font-display:
swap`. **Call: latin only, no Carlito bold italic,** because the sample documents are English and
use bold and italic once each; a visitor who pastes Cyrillic gets the fallback font for those
glyphs, which is honest for a demo.

Loading is the page's job (next section): not before the panel is within 600 px of the viewport, and
on idle (`requestIdleCallback`, or a timeout where Safari lacks it). A browser reporting
`navigator.connection.saveData` gets a "Try it here" button instead and loads on click.
**Call: lazy by distance, with a data-saving opt-out,** so the headline and the Largest Contentful
Paint never wait for 400 KB, and a visitor on a metered connection chooses to pay.

### The page-facing API

`apps/website-embed/src/index.ts` exports **one function**:

```ts
export interface DemoOptions {
  /** The document as the file holds it. */
  doc: string;
  /** Who the visitor is: the first author color, red, as in the app. */
  author: Author; // { handle: 'ada', name: 'Ada Lovelace' }
  /** Whether the Claude script is wired up (panel 2). */
  agent?: boolean;
  /** Called for every change of what the page's controls show. */
  onState(state: DemoState): void;
  /** A message for people, from the editor's `onNotice`: "Raw is read-only while ...". */
  onNotice(message: string): void;
}
export interface DemoState {
  view: ViewMode;                // 'clean' | 'redlines' | 'raw'
  views: readonly ViewMode[];    // what the editor offers; the page draws one button each
  tracking: boolean;
  changes: number;               // pending changes, for a count on the page
  canComment: boolean;           // false in Raw, as the editor says
  claudeRunning: boolean;
}
export interface DemoHandle {
  setView(view: ViewMode): void;
  setTracking(on: boolean): void;
  startComment(initialText?: string): boolean; // opens the box; false when it did nothing
  askClaude(): boolean;                         // selects the sentence, opens the box with the question
  openReviewBar(): void;
  reset(): void;                                // the original document, default view and tracking
  getDoc(): string;                             // the file, for tests
  destroy(): void;
}
export function mountDemo(parent: HTMLElement, options: DemoOptions): DemoHandle;
```

**Call: the controls are drawn by the page, not by the embed.** The view switch, the Track Changes
switch and Reset already exist on the site as React (`ViewSwitch`, `SheetBar`), in the site's type
and tokens, with the site's focus rings and `aria-pressed` pattern. The embed supplies state and
actions; it draws only the document and the review interface inside it. The view buttons come from
`DemoState.views`, so when the simple-markup view of
[#182](https://github.com/skadauke/redlines/issues/182) lands, the page shows it with no change to
the site.

`mountDemo` does, in order, what `embed-smoke`'s `mountEmbed` does and `apps/desktop` does for a
window: `createEditor` (typing: `smartPunctuation: true`, `spellCheck: false`, `closePairs: false`;
**Call: spell check off,** so that "Redlines" and "importer" are not underlined as errors on a
marketing page), activate formatting before review, `createReview` with `onPosted`, `attachToField`
(the picker, panel 2 only) and **no `documentData`**, `applyTheme(root, 'default', appearance)` with
a `matchMedia('(prefers-color-scheme: dark)')` listener, and the token overrides below. `destroy`
removes the listener, the runs, the review interface and the editor, and is safe to call twice.

### Tokens: the editor fits its host

Design §6.6: "Embedded editors fit their host. The embedding app passes token values". The panel's
root sets the editor's **page, ink, rule, tint and card** tokens from the site's variables
(`--rl-page: var(--sheet)`, `--rl-ink: var(--ink)`, `--rl-ink-2: var(--ink-2)`,
`--rl-rule: var(--rule)`, ...), so the editor sits on the sheet as the illustrations do, in both
themes. It keeps the theme's **author colors, body font and sizes**: those are what the product
looks like, and the page's illustrations already say "Ada is red". The root also sets
`--rl-column` to fit the panel (the theme's 680 px is wider than the sheet).

### CSS: no leaks either way

- The embed's CSS is **unlayered**. Tailwind v4 puts its preflight in `@layer base`, and any
  unlayered rule beats a layered one, so preflight's resets of `button`, `textarea`, `ul`, `img` and
  heading margins do not reach the editor's elements. CodeMirror's and the plugins' CSS-in-JS styles
  are injected unlayered too.
- Everything the embed's own stylesheet adds is under a `.rl-embed` class on the panel root. Nothing
  styles `html`, `body` or a bare element. The site's `.sheet` has `overflow: hidden`, which would
  clip the review bar if it is positioned against the viewport; see the review bar under Mobile and
  accessibility.
- The first stage checks this with screenshots in both themes at 375, 768 and 1120 px; a leak
  either way is a bug in the embed's CSS, not a reason for shadow DOM.

**Call: no shadow DOM.** WebKit's selection and `getSelection()` handling across shadow roots has
been a long source of CodeMirror input bugs, and the review plugin positions its notes from the
document's geometry. Scoping by class and layer order gets the isolation without the risk.

### Where the files go

`pnpm --filter @redlines/website-embed build` writes `website/public/embed/` (git-ignored):

```
embed/redlines-embed.<hash>.js
embed/redlines-embed.<hash>.css
embed/fonts/*.woff2
embed/manifest.json      { "js": "redlines-embed.<hash>.js", "css": "...", "bytes": { ... } }
```

The site reads `manifest.json` at build (a server component, `lib/embed.ts`), puts the hashed names
in the page, and loads them under the base path. Hashed names mean a cached old page never mixes
files of two builds (Pages caches for ten minutes); a tab left open across a deploy keeps the
fallback, because its old hashed files are gone.

**Call: build the embed in CI and never commit it.** A committed 1 MB bundle would be stale the day
the editor changes, and a binary diff in every PR. The price is that the website's workflows need
pnpm; they get it (see "Release flow").

If `manifest.json` is missing, `npm run build` still succeeds and the page has fallbacks only, so a
contributor can work on copy with `npm install` alone. A deploy must not do that silently: the deploy
workflow sets `REQUIRE_EMBED=1`, and `lib/embed.ts` throws at build when it is set and the manifest
is missing.

## The page

### Components

- `components/demo-panel.tsx` (client): the sheet around a panel. It renders its **fallback children
  server-side** (today's `RedlinesView`, in its sheet), so the HTML and the no-JS page are what they
  are now. In an effect it observes the sheet; near the viewport and idle, it dynamic-imports the
  bundle, injects the stylesheet (a `<link>`, once per page), calls `mountDemo` into a div that
  replaces the fallback body, and draws the controls. Hydration sees the same markup on server and
  client (the fallback), and enhancement happens after.
- `components/demo-controls.tsx`: the controls row for a panel: the view group (same markup and
  classes as `ViewSwitch` today), a **Track Changes** toggle (`aria-pressed`, the pen drawn like the
  app's, red only while on, the brand's red), **Comment**, and **Reset** (hero); **Ask Claude** and
  **Reset** (agent panel).
- The dynamic import is `import(/* webpackIgnore: true */ /* turbopackIgnore: true */ url)` so that
  Next never tries to bundle it; stage 2 checks which magic comment this Next version honors.
- `lib/embed.ts` (server): reads the manifest, returns `{ js, css } | null`.
- `lib/demos.ts`: the two documents and the page's copy for them (title, captions, notices).
  The documents are `apps/website-embed/src/docs/launch-plan.md` and `design-note.md`, imported by
  the bundle with `?raw`, and mirrored for the fallback in `website/lib/demo-text.json` (see "The
  fallback").

### Loading, in order

1. HTML arrives with the fallback sheets. Controls that need the editor are `disabled`, or not
   rendered at all without JavaScript (as the agent demo's play button is hidden until it can work).
2. After `load`, and when the panel is within 600 px of the viewport (an `IntersectionObserver` with
   `rootMargin`), on idle: import the module, add the stylesheet, wait for `document.fonts.load()` of
   the body face (1 s at most), then mount. The fallback body and the editor are swapped in one frame
   at the same width; the sheet's `min-height` is the fallback's height, so nothing below moves.
3. If anything fails (a rejected import, no `IntersectionObserver`, a thrown mount), the fallback
   stays and the controls stay disabled. Nothing is shown to the visitor, and the console says why.
4. The second panel reuses the module already fetched. Hero first, then the agent panel when it
   nears the viewport.
5. `saveData`: no automatic load; the sheet shows a **Try it here** button (the same style as the
   other buttons), and a click starts step 2.

React Strict Mode runs effects twice in development: the effect keeps a `cancelled` flag and calls
`destroy` in its cleanup, so a late import never mounts into a dead node.

### The fallback

The fallback is the hero's **Redlines** view as it is today, and the agent sheet in its finished
state, both server-rendered, both what JavaScript-less visitors, crawlers and the loading moment
see. Clean and Raw are gone from the fallback: the view switch only ever worked with JavaScript.
The hand-drawn Raw view (`source` in `hero-sheet.tsx`) is deleted, and with it the README's
"update it if the syntax changes".

**Call: keep one hand-drawn view, and guard it.** The fallback's sentences and marks come from
`website/lib/demo-text.json`, a list of segments (`{ "t": "ins", "by": "ada", "s": "new " }`). The
embed package has a test that parses the sample document and checks the segment list against its
marks and its clean text. If either changes, the test names the file to update. The fallback can
still be wrong in how it *looks*, but not in what it *says*.

## Panel 1: plan.md

The document is the Launch plan the hero shows now, as a real file (the ledger names Ada, Bo and
Claude-for-Ada):

```md
# Launch plan

We will ship the <!--ins k3x9-->new <!--/k3x9-->importer in <!--sub p7qd March-->April<!--/p7qd-->,
after the <!--cmt c8d2-->security review<!--/c8d2-->.<!--del w2rf  The old exporter stays as it is.-->
```

(The paragraph is one line in the file; it is wrapped here to read.)

(plus the ledger block, exactly as the fallback tells it; the file is the single source). One
paragraph, three people, one comment thread: it fits above the fold on a phone.

### At the start

- View **Redlines**; Track Changes **on**; no focus in the editor (no autofocus, no scroll).
  **Call: tracking starts on,** so the first thing a visitor types visibly becomes a red underlined
  insertion in Ada's color, which is the demo's whole point; a visitor who turns it off sees plain
  edits.
- A caption under the sheet, in the site's caption style: "Type anywhere. Your edits are tracked, in
  your color." It changes with state: "Track Changes is off: your edits are plain text."
- The controls row: **Clean | Redlines | Raw**, **Track Changes**, **Comment**, **Reset**.

### What a visitor can do, exactly

| Action | What happens | What the file gets |
| --- | --- | --- |
| Click or tab into the text, type | In Redlines or Clean with Track Changes on: an insertion by Ada, underlined in red. In Clean, the view switches to Redlines (editor rule, design §5.3) so the suggestion isn't invisible | `<!--ins xxxx-->...<!--/xxxx-->` and an `at:`/`by: ada` entry in the ledger |
| Delete text (Backspace/Delete, with Track Changes on) | Struck through; the text stays until decided; Backspace never deletes a marker (design §5.5) | `<!--del ...-->` |
| Select and type over | A substitution: old struck, new underlined, one card | `<!--sub ...-->` |
| Bold with ⌘/Ctrl+B, with Track Changes on | A format change: dotted underline, card says "Formatted: Bold" | `<!--fmt ...-->` |
| Track Changes off, then type | Plain edits; typing inside someone's pending insertion joins no change (format §3.10) | The text itself |
| Hover (or tap) a change | Its card: who, when, what, Accept, Reject | nothing |
| Accept / Reject on a card | Decided in one step that Undo takes back; the change becomes plain text or goes | the mark and its ledger entry go |
| **Comment** (or ⌥⌘M / Ctrl+Alt+M) | Opens the comment box on the selection, or the word under the caret, or the caret; Post adds a thread by Ada; the rail (or a dot) shows it | `<!--cmt ...-->` and a `comments:` entry |
| **Raw** | The real file, with syntax colors. Read-only while Track Changes is on (the editor's rule): a keystroke there says so, and the page's notice line repeats it ("Raw is read-only while Track Changes is on. Turn it off to edit the file.") | unchanged |
| **Clean** | The document as if every change were accepted | unchanged |
| ⌘/Ctrl+Z, ⇧⌘/Ctrl+Y | Undo and redo, per panel | |
| **Review** (a button, also ⌥⌘] / Ctrl+Alt+]) | Opens the review bar inside the sheet: next and previous change, Accept and Reject | |
| **Reset** | `setDoc` of the original; view, tracking and history start over | back to the original bytes |

Edge cases, with the product's answers:

- **A refused edit** (a tracked change inside a place where its markers wouldn't read; typing in
  Raw with tracking on) changes nothing and is told in the notice line, in the editor's words.
- **Pasting rich text** goes through the editor's paste path; a paste of a long document works and
  is the visitor's own. No size cap. (**Call:** nothing in the demo can hurt anyone but the
  visitor's tab, and a cap would be code the product doesn't have.)
- **Deciding the last change** leaves the view where it is, as the app does.
- **The visitor deletes everything** or writes into the ledger in Raw with tracking off: the
  product's behavior (the file may stop parsing; broken markup shows as text). Reset is one click.
- **Two panels:** each has its own editor, history and Reset. Focus in one doesn't change the other.
- **Light/dark switch while open:** the theme follows `matchMedia` at once.

## Panel 2: design.md and the scripted Claude

The document is two sentences of a design note (the demo's current text), with Ada as the visitor.
The agent's edits are tracked by construction (they come through `str_replace`, which always writes
tracked changes in the agent's name); the visitor's own typing follows the same Track Changes switch
as panel 1 (it starts on).

```md
# Uploads

Uploads retry 3 times with backoff, then fail. Each attempt is logged.
```

### The flow

1. The visitor presses **Ask Claude**. The page selects "Uploads retry 3 times with backoff, then
   fail." (`handle.askClaude()`), opens the comment box on it (`startComment(text)`), writes
   "@Claude is this still right? Fix it if not." in the box, and moves focus to **Post**. The
   picker (`attachPicker`) is attached to the box as in the app, so typing `@` shows **Claude**.
   The visitor may edit the question or write their own.
2. The visitor presses **Post** (or ⌘/Ctrl+Return). The review plugin's `onPosted` hands the comment
   to `runs.posted`, the **only** way a run starts (the product's rule, unchanged). The thread
   appears in the rail with the visitor's comment.
3. The thread shows Claude's **live line** (as in the app, `createLiveLines`): "Reading
   uploader.ts", then "Editing this section", each about a second. It has a **Stop** button. The
   text is wired through the real tools.
4. Claude calls `str_replace` (a tracked substitution "3 times" to "5 times", in Claude's name for
   Ada, with a note "per uploader.ts:88") and `reply` ("Now 5, per uploader.ts:88. Fixed."). The
   change is drawn in Claude's color with its card; the reply is in the thread.
5. The visitor presses Accept or Reject on the card (or in the review bar), or ignores it, or edits
   around it. Undo works.
6. **Ask Claude** again: the script reads the sentence. If it already says 5, it replies "Already 5,
   per uploader.ts:88. Nothing to change." and edits nothing. If the visitor rejected the change, or
   reset, it fixes it again. **Call: the script is a small state machine on the document's text, not
   a fixed script,** so a second press is never a repeat of a stale edit.

Edge cases:

- **Stop** aborts the run: the live line goes, nothing further is applied, and the thread says
  nothing more (as the app does).
- **A comment that doesn't name @Claude** starts nothing. One that does, in a reply in the thread,
  starts a run in that thread; the script treats any question the same way (checks the sentence).
  **Call: any post naming @Claude gets the scripted behavior,** so the visitor never feels
  rejected for typing their own words, and the caption says plainly what it is.
- **A comment with the mention already in the file** (the visitor pastes a file's text into Raw)
  starts nothing. A test pins it.
- **Reset while a run is live** calls `runs.documentReplaced()` first (the product's own path), so
  the late tool call is refused.
- **Citations** (`uploader.ts:88`) render as plain text. In the app, a click opens the file; the
  embed has no project root, so `renderText` gets no `projectFolder`, and `findCitations` yields
  nothing to link. The caption names it: "In the app, a click opens the file."
- **Reduced motion:** the scripted waits shorten to about 300 ms, and the live line changes
  without animation. The change still arrives through the same path.

### Honest labeling

Under the sheet, in the caption style: "Claude here is a script, so this page needs no account and
makes no network request. In the app it is your own Claude Code or Codex, signed in as you."
The agent's byline in the card is what the app shows (**Claude**, with the badge "for Ada"). The
page does not claim it ran a model.

### How it is built

The product already has most of this. `@redlines/agents` exports `createRuns`, `createLiveLines` and
`attachPicker`, and `./fake-provider` is "an agent and a relay in memory ... a script that calls the
tools over MCP, as a real agent does". The embed:

- provides a **stub `HostAgents`**: `list()` returns the one scripted agent `{ id: 'claude', name:
  'Claude', readLimit: 'folder', state: { found: true, signedIn: true } }`; `run(agent, request,
  tools, signal)` is an async generator that drives `tools` (the `ToolLines` function the runs give
  every agent) with the script below;
- passes `createRuns` a document adapter over the editor (`read: editor.getDoc`, `save: () =>
  Promise.resolve(true)`, `applyAgentEdit: (next, agent) => editor.reloadDoc(next, { agent })`,
  `generation` counting `reset()` calls, `path: () => null`), settings that always answer `'document'`
  (so the first-run consent question never appears) and a `projectRoot` that returns a fixed
  in-memory root;
- calls the **same tool client the fake provider has** to talk to the toolbox. Today that client is
  built inside `fakeRelay().connect()`. Stage 3 extracts it as `toolClient(lines: ToolLines):
  FakeConnection` in `plugins/agents/src/fake-provider.ts`, so the demo and the tests use one
  implementation (a refactor with the existing `runs.test.ts` as its guard);
- scripts the run: `status('Reading uploader.ts')`, wait, `view`, `status('Editing this section')`,
  wait, `str_replace` the sentence, `reply`. Every call is made as a real agent's would be, and
  every limit (`fitReply`, the six tools) applies, because the tools are `@redlines/agent-tools`.

**Call: the real run machinery with a scripted provider, not a mock of the UI.** It costs about 18 KB
gzipped, and it means the website demonstrates the product's actual safeguards: tracked in the
agent's name, only after a post, stoppable, refused after the document is replaced.

One addition to the review plugin: `ReviewController.startComment(initialText?: string)`, which opens
the box with that text in the field (cursor at the end, nothing posted). It returns false in Raw,
as `startComment()` does. The desktop's menu calls it with no argument and is unchanged. It has tests
in `rail.test.ts` and a line in design §5.7.

## Mobile and accessibility

### Mobile

- **Layout.** The panel is the sheet at the column's width; below 641 px the controls wrap in two
  rows (views, then Track Changes / Comment / Reset). Labels are words, not icons alone. Tap targets
  are at least 44 × 44 px (the current 7 px-high buttons grow to a hit area of 44 on touch with
  padding, not a larger look).
- **The rail.** In a narrow editor the review plugin already shrinks the rail to a dot in the
  author's color beside each anchor; tapping a dot opens its note over the page. The first stage
  reads the threshold in `plugins/review/src/rail.ts` and sets the hero's column split so that at a
  1120 px page the rail shows (the hero grid goes from `1.05fr / 1fr` to `0.9fr / 1.1fr` if needed).
  If that squeezes the text more than a dot would, the dot wins: a readable column over a visible
  card.
- **Cards on touch.** There is no hover on a phone. A tap on a change pins its card (the product's
  rule: "Clicking a change pins its card"), and Accept and Reject are on it. The **Review** button
  opens the bar, which has next, previous, Accept and Reject as buttons.
- **The keyboard.** The editor's text is 16 px or larger on phones so that iOS doesn't zoom on focus
  (`--rl-size-body` is checked against that in stage 2). The page doesn't scroll to the editor on
  mount. `scroll-margin` keeps a focused caret clear of the on-screen keyboard.
- **No scroll traps.** The editor grows with its content and the page scrolls past it; the panels
  have no inner scroll area except the Raw view's own long lines, which wrap.
- **Touch selection and the comment box:** **Comment** and **Ask Claude** are buttons because there
  is no ⌥⌘M on a phone.

### Accessibility

- The panel is a `role="group"` with an `aria-label` ("Interactive demo: a Markdown document with
  tracked changes"). The editable is the editor's own `role="textbox"`, `aria-multiline`, labelled
  "Document: plan.md. An editable demo."
- **Keyboard.** Tab goes controls, then the editor, then past it: the editor binds no `Tab`, so it
  isn't a trap (WCAG 2.1.2) — stage 2 tests this, and if any plugin binds `Tab` outside a list, the
  embed leaves it unbound. Every action has a keyboard path: view buttons, Track Changes, Comment,
  Review (the bar's buttons), Reset, Post/Cancel, Stop, Accept/Reject on cards (reachable by the bar
  without hover).
- **Notices.** `onNotice` lines go to one `aria-live="polite"` region under the sheet (and are
  visible, in ink-2, never red). The agent's live line is announced by the same region at most once
  per status.
- **The review bar.** It floats at the bottom of the window in the app. In the page it is positioned
  inside the sheet (`position: absolute; inset-inline: 0; bottom: 0` against the sheet's
  `position: relative`), not against the viewport, so it can't cover page content or be clipped by
  `overflow: hidden`. If the plugin positions it with `fixed`, stage 2 overrides it in the embed's
  stylesheet under `.rl-embed`; it is not changed for the app.
- **Contrast.** The editor's tokens come from the site's colors for text and rules, which are
  checked for AA in both themes today; the author colors are the theme's, checked against the sheet
  in both themes in stage 2.
  Anything that fails gets the theme's token adjusted *in the embed's overrides*, not the app's.
- **Reduced motion** and **forced colors**: no animation beyond the editor's; under forced colors
  the underline and strike marks stay (they are text decorations, not colors).
- **Focus rings** are the site's (`outline: 2px solid var(--red)`), and the editor keeps its own
  caret.

## The icon, and what else is out of date (#192)

The caret is already the page's icon in the repository. The work:

1. **Deploy** (stage 0). That alone puts the caret and the Nov 5 copy on `www.redlines.md`.
2. **`app/apple-icon.png`** (180 × 180) and **`app/opengraph-image.png`** (1200 × 630: the caret on
   warm paper at the left, the title "One file for people and AI. See every change." in the page's
   type, no other chrome), rasterized from `apps/desktop/src-tauri/icons/family/caret.svg` and the
   site's tokens, committed under `website/src/app/` (Next's file convention writes the `<link>` and
   `<meta>` tags in a static export). A script, `website/scripts/make-social`, redraws them by hand
   when the icon changes (it needs `rsvg-convert`, like `scripts/make-icons`); CI doesn't run it.
   **Call: commit generated images, not generate them in CI,** because the render needs a font and
   `rsvg-convert`, and the images change twice a year.
3. **`npm run icons:check`** (run in `website.yml`): every `d="..."` in `src/app/icon.svg`,
   `public/favicons/*.svg` and `BrandMark` appears, verbatim, in a master under
   `apps/desktop/src-tauri/icons/family/`. `website.yml`'s path filter adds that directory, so
   changing the master fails the website until its copies are redrawn.
4. **Copy.** Edits to `lib/site.ts`:
   - `developers` "Built to embed": the format and the editor are TypeScript packages in the repo;
     "the demos on this page are the editor itself, embedded in a static page with no server;
     a drop-in component for React comes later." (Once stage 2 ships.)
   - `compare.body`: update the month **after** re-checking each row against the products'
     documentation (Word, Google Docs, Notion, VS Code). I did not re-verify the rows in this round,
     and the design does not guess them.
   - `hero.unreleased`: add that the editor below is the real one: "The first full release is on its
     way. Try the editor below, right here; the design and the format are on GitHub."
   - `changes.points`: the second point says "A click opens that file": keep, and add "(in the
     app)" so the panel's plain citation isn't a contradiction.
5. **Config comments and READMEs** that still say the repository is private or the name is not
   final: `site.config.mjs`, `deploy-website.yml`, `website/README.md`.

There are no screenshots on the page to refresh (the illustrations were markup). The README in the
repository root has PNG screenshots (`docs/img/view-*.png`); they are not the website's and are
out of scope here, but if the icon appears in them, it is a follow-up.

## Download

The Download section is correct for what exists: `lib/release.json` is empty because `v0.1.0` is a
pre-release, and `sync-release.mjs` reads `/releases/latest`, which never returns a pre-release
(by design: a pre-release "changes nothing" for installed copies, and for the site). Visitors
therefore see "Coming soon", which is true.

**Call: the site offers only a full release.** Offering the pre-release as a download would make a
build that the product owner has not called released the thing the site links to, and would change
what installed copies and the site agree on. The release doc already says how it changes: publish a
full release (`gh release create v0.2.0 --target main ...`), and `release.yml` redeploys the site,
whose Download section then shows it. **Stephan decides when `v0.2.0` goes out as a full release;
until it does, the panels are the site's strongest call to action,** and `hero.unreleased` says so.

`npm run sync-release:check` is unchanged and stays in `website.yml` (it validates the committed
file without network). Add one line to the check: if `lib/release.json` names a tag, its version must
match a `v<version>` tag in the form `releasing.md` documents, so a hand-edited file is caught.

## Release flow

### `deploy-website.yml`

- **Add the push trigger the workflow's own header already describes,** now: pushes to `main` that
  touch `website/**`, `apps/website-embed/**`, `apps/desktop/src-tauri/icons/family/**` or the packages
  the embed bundles (`packages/{editor,format,plugin-api,agent-tools}/**`,
  `plugins/{review,agents,formatting,themes}/**`), plus the workflow itself.
  **Call: the site redeploys when the editor it embeds changes,** so the demo is the product on main
  within minutes and nobody has to remember. The cost is a one-minute deploy per such merge, and
  that the page may show the editor a few days before the next release does. The page never names a
  version for the demo; the footer and Download name the release. `concurrency` already queues
  deploys.
- **Build the embed before the site.** In the `build` job, before `npm ci`: `pnpm/action-setup`
  (the version comes from `packageManager`, as `ci.yml` does), `setup-node` without cache (as now),
  `pnpm install --frozen-lockfile --filter @redlines/website-embed...`, then `pnpm --filter
  @redlines/website-embed build`. These steps need `working-directory: .`, since the job defaults to
  `website/`. The job still has read-only permissions and no secrets; third-party actions stay
  pinned as the workflow pins them today. Dependency caches stay off in a deploy.
- `npm run build` runs with `REQUIRE_EMBED=1`. The deploy fails if the manifest is missing, or if
  `embed:check` finds the bundle over its budget.
- The release path (`workflow_call` from `release.yml`) is unchanged: it builds `main` and refreshes
  the download metadata. It builds the embed in the same way.

### `website.yml` (pull requests and pushes)

Same steps without deploying, plus: `npm run sync-release:check`, `npm run icons:check`,
`npm run embed:check` (manifest present, files present, sizes within `size-budget.json`), and the
browser smoke test (see Tests). Its path filter adds the embed's paths, so a change to the editor
that breaks the page fails the PR that makes it, not a deploy later. `ci.yml` keeps ignoring
`website/**`; the new package is covered by `pnpm typecheck`, `pnpm lint`, `pnpm test` and a new
step `pnpm --filter @redlines/website-embed size` beside the existing embed step.

### Locally

```sh
cd website
npm install
npm run embed        # pnpm --filter @redlines/website-embed build, from the repo root
npm run dev          # the panels load from public/embed
npm run embed:watch  # rebuild the bundle on change (vite build --watch)
```

`website/README.md` gets this, and its "Interactive parts" paragraph is rewritten: the interactive
parts are the two panels, the page's controls for them, and the tab icon's rotation.

## Changes to `docs/`

- **`docs/format.md`:** none.
- **`docs/design.md`:**
  - §6.3 packages: a row for `apps/website-embed` ("The editor with the review interface and a
    scripted agent, built as a bundle for the website; no desktop code"), and the sentence on the
    test that keeps the core free of the desktop app now names both embeds.
  - §6.5 hosts and capabilities: a sentence that a host may supply **none** of the capabilities
    (the website's demos supply no files, no clipboard beyond the browser's, no printing, no network,
    no document data, and a scripted agent), and the editor degrades without each.
  - §5.7: the box can open with text in it (`startComment(initialText)`).
  - §6.6, "Embedded editors fit their host": the website is the first host that does this; one line.
  - §1 summary or §3: nothing. The claim "the same editor in the desktop app and embedded in other
    apps" (§2) is now demonstrated; leave the wording.
- **`AGENTS.md`:** the Layout table gets `apps/website-embed`; "Commands" gets the embed build,
  budget and `npm run embed` lines for the website; the CI section says what `website.yml` and
  `deploy-website.yml` now do (build the embed, push trigger).
- **`docs/releasing.md`:** one paragraph: the site redeploys on pushes to `main`; a release
  refreshes the Download section; what to do if the embed fails to build (the deploy stops and the
  site stays as it was).
- **`website/README.md`:** as above, plus the Deploy section's "it does not run on pushes" and
  "private" lines, which become false.
- **`README.md` (root):** nothing, unless it mentions the site's demos.

## Tests

The conformance suite for this work, where each line fails if the property breaks.

**In `apps/website-embed` (vitest, happy-dom; `*.test.ts` next to the code):**

1. `mountDemo` shows the sample document in Redlines with Track Changes on; `setView` reaches all
   three views; `DemoState.views` equals the editor's view list.
2. **Typing with tracking on** makes an `ins` mark by `ada` and a ledger entry; the same typing with
   tracking off changes only the text; **Raw with tracking on** refuses typing and calls `onNotice`
   with the editor's message.
3. `editor.accept` / `reject` through the page's card path give the same file as the CLI
   (`@redlines/format`'s decided text), byte for byte; Undo restores.
4. `reset()` restores the original string exactly, the default view and tracking, and clears
   history.
5. `destroy()` twice is safe, removes the `matchMedia` listener and the DOM, and leaves no
   `<style>` or event listener the test can find.
6. **The scripted Claude (fake timers):** posting "@Claude ..." through the comment box's
   `onPosted` runs; the live line shows two statuses; the document gains a `sub` by `claude-ada` with a
   `note` and a reply in the thread; Accept makes "5 times"; a second ask replies "Already 5" and
   changes nothing; Reject then ask edits again; **Stop** mid-run applies nothing; `reset()` mid-run
   refuses the late tool call.
7. **The mention rule:** `setDoc` of a document that contains `@Claude` in a comment starts nothing;
   a post without a mention starts nothing; a post inside a code span starts nothing.
8. **No network, no storage:** with `fetch`, `XMLHttpRequest`, `WebSocket`, `navigator.sendBeacon`,
   `localStorage`, `sessionStorage`, `indexedDB` and `document.cookie` replaced by spies that throw,
   a full session (mount, type, switch views, comment, ask Claude, accept, reset, destroy) makes no
   call.
9. **The sample documents are valid files:** `parse` reports no diagnostics, they round-trip, and the
   fallback's `demo-text.json` matches their marks and clean text (the drift guard).
10. **Size:** `pnpm --filter @redlines/website-embed size` fails over budget.

**In `plugins/review` / `plugins/agents`:** `startComment(initialText)` opens the box with the text,
returns false in Raw, and posts nothing by itself; `toolClient(lines)` behaves as the fake relay's
`connect` did (the existing `runs.test.ts` passes unchanged).

**In `website/` (a Playwright smoke test against `out/`, served statically, Chromium and WebKit;
`@playwright/test` as an npm dev dependency, run in `website.yml`):**

1. The page with JavaScript **off** has the fallback sheets and no broken controls.
2. With JavaScript on, scrolling to each panel mounts an editor; typing in panel 1 produces a
   `.rl-ins`-style mark (the test uses the editor's class); switching to Raw shows `<!--ins`; Reset
   restores.
3. **Every request is same-origin and under `/embed/` or the page's own assets;** a route handler
   fails the test on any other origin (this is "no network" on the built site, including fonts),
   `localStorage` holds only `redlines.mark`, and the first panel's transferred bytes are at most 430 KB.
4. With the embed files blocked (route abort), the page still shows the fallback and logs, not throws.
5. **Keyboard:** Tab from the page top reaches each control and the editor and leaves it; Post,
   Stop and Accept are operable without a mouse; `axe-core` finds no serious or critical violations in
   light and dark.
6. At 375, 768 and 1120 px: no horizontal page scroll, the controls don't overlap, and the review
   bar stays inside the sheet.

**By hand, before stage 2 ships and before any release (not in CI):** iOS Safari and Chrome on
Android (typing, the on-screen keyboard, tapping a change, the rail dots), desktop Safari, Chrome
and Firefox, VoiceOver on the panel, and the 4× CPU-throttled main-thread cost of loading the
bundle in Chromium: the module's evaluation plus mount should stay under **250 ms**; if it doesn't,
the second panel mounts only when it is on screen and the first waits for idle.

## Stages

Each is shippable alone and worth having.

**Stage 0 — the live site is current (no code; minutes).**
Run **Actions › Deploy website** (`gh workflow run deploy-website.yml`). Then add the push trigger
to `deploy-website.yml` (the paths of the header's own note, for now only `website/**` and the
workflow). Fixes #192's visible symptom.

**Stage 1 — icon, social image, copy (#192).**
`apple-icon.png`, `opengraph-image.png`, `make-social`, `icons:check`, the stale-comment fixes, the
`compare` re-check and date, the `hero.unreleased` and `changes.points` wording, `release.json`
check. No dependency on the editor.

**Stage 2 — the hero panel (#193, part 1).**
`apps/website-embed` (build, budget, `mountDemo` without the agent), `lib/embed.ts`, `DemoPanel` and
`DemoControls`, the fallback and its drift guard, the hero swap, the CSS isolation, token overrides,
the deploy and website workflows with pnpm, the Playwright smoke test, the mobile and accessibility
pass, and the "Built to embed" copy. After this stage the page's argument is true: the hero is the
product.

**Stage 3 — the agent panel (#193, part 2).**
`startComment(initialText)` in the review plugin, `toolClient` in the agents plugin, the stub host
and scripted Claude in the embed, panel 2 and its caption, tests 6 and 7. The old `AgentDemo` and
its animation code are deleted.

**Stage 4 — polish and keeping it true.**
The `saveData` button, throttled measurements and a trim if the budget is tight, the extra browsers
by hand, and the fourth view (simple markup, [#182](https://github.com/skadauke/redlines/issues/182))
when it lands: the page picks it up from `DemoState.views`, and the hero caption gets a line.

## Decisions most worth Stephan's look

1. **The agent is scripted, started by the visitor, and labeled.** No model, no network, no
   autoplay; a real run through the product's real tools, with the visitor's own post starting it.
2. **Two real panels (the hero, the agent), everything else stays HTML,** and the old three-view
   drawing is reduced to one fallback.
3. **Lazy load, about 430 KB for the first panel** (310 KB of script, 107 KB of fonts), after idle and
   near the viewport; a data-saving opt-out. A new package, `apps/website-embed`, rather than
   growing `embed-smoke`.
4. **The site redeploys on every push to `main` that touches it or the editor it embeds.** The demo
   can run a few days ahead of the downloadable app.
5. **The live site was stale because nothing deployed it since Oct 15,** not because the code has the
   old icon; stage 0 fixes that today. And the site offers only a full release for download: until
   you publish `v0.2.0` as one, the visitor's call to action is "try it here".

## Left to Stephan, or not decided

- **When `v0.2.0` becomes a full release** (not a pre-release). Until then Download says "Coming soon".
- **Enforce HTTPS** on the Pages custom domain once its certificate is issued (repository admin;
  `https_enforced` is false and the certificate state `new` as of today).
- **The comparison table's rows** need a check against the products' current documentation before the
  "as of" month changes; I did not do that here.
- **The review plugin's narrow threshold and the bar's positioning** (do the notes show at the hero's
  width, does the bar use `fixed`): both are measurements for stage 2 with the real build; the design
  says what to do in each case, not which case it is.
- Whether to add a **download or copy button for the Raw file** ("take plan.md with you"). Left out:
  it is not needed to prove the claim, and a download is a file the page makes.
