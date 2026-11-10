# The website: the real editor on the page, and a site that is current

*Design, Nov 10, 2026. Epic [#191](https://github.com/skadauke/redlines/issues/191), sub-issues
[#192](https://github.com/skadauke/redlines/issues/192) (the new icon, and what else is out of date)
and [#193](https://github.com/skadauke/redlines/issues/193) (demos as embedded Redlines panels). It
builds on [design.md](../../design.md) (§6.3 packages, §6.5 hosts, §6.6 styling) and the website's
own [README](../../../website/README.md). The format is not touched: nothing here changes
[format.md](../../format.md). A builder's check against the code (`website/`, `apps/embed-smoke`,
the plugins and the workflows) followed the same day; its answers are folded in below, each new
decision marked "Call:", and so is Stephan's request that the comparison say what is built and
what is planned.*

## Why

Stephan's words, from the issues:

- #192: "The website still shows the old icon. Update it to the red caret, and check every page for
  anything else out of date: screenshots, features, the download section, the agent pages."
- #193: "The website's demo widgets are drawings of the editor. They could be real, embedded Redlines
  panels, built from the embed bundle (`apps/embed-smoke`): a visitor could type, see a tracked
  change and accept it on the page."
- #191: "The website needs the new icon and a look at what else is out of date, and its demos could
  be the real editor."
- Nov 10, on the comparison: "For the website, just so we're being honest, let's come up with a way
  to indicate which features are already built in Redlines and which are planned in the big
  comparison matrix."

Two things sit under those words.

**The site a visitor sees is not the site in the repo.** The repository has had the red caret as the
tab icon and the brand mark since Nov 1 (`c871821`), and the Nov 5 copy. The live site,
`https://www.redlines.md/`, is the build of **Oct 15**: its `icon.svg` is the old gray sheet with
three bars, and its sections are the old ones. `deploy-website.yml` runs only when `release.yml`
calls it or someone dispatches it by hand, and nobody has since Oct 15 (`gh run list` shows the last
run, `38794846703`, on Oct 15). So the "old icon" has one cause, and it is not in the code. A
deploy fixes it in minutes, but a deploy publishes to the web, and so does a push trigger: both
wait for Stephan's yes, and come last (stage 5), after everything else is built and checked. He can
say yes to the first deploy at any point; it needs nothing from the other stages.

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
6. The comparison says what Redlines has **built** and what it has only **planned**, and a check
   holds the page to the design's own table, so it can't claim a feature the design says isn't
   built.

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
  doesn't do, a demo that shows what the app doesn't do, or a comparison that calls a planned
  feature built.
- **Red used for anything but the brand,** as in the app (icon direction): errors, warnings and
  disabled states on the panels are gray.

## What I found (the audit behind #192)

Everything below was checked against the live site, the repository at `4de60b1` and the workflows.

| Finding | Evidence | Fix |
| --- | --- | --- |
| The live site is the Oct 15 build: old icon, old sections | `https://www.redlines.md/icon.svg` is the gray sheet; the last `deploy-website.yml` run is Oct 15 | Deploy, and deploy on push (stage 5, each on Stephan's yes) |
| Deploy comments and README say the repository is private and the name "not final" | `deploy-website.yml` header, `website/README.md` "Deploy", `site.config.mjs` | The repo is public, `www.redlines.md` is the Pages custom domain (verified); rewrite those lines |
| Pages has a certificate in state `new` and `https_enforced: false` | `gh api repos/skadauke/redlines/pages` | An admin turns on Enforce HTTPS once the certificate is issued (not something the code can do; listed in "Left to Stephan") |
| No `apple-touch-icon`, no Open Graph or Twitter image | `website/public` holds only `favicons/`; `layout.tsx` has `openGraph` with no image | Add `app/apple-icon.png` and `app/opengraph-image.png` made from the caret (stage 1) |
| Three copies of the caret path (`icon.svg`, `BrandMark`, `public/favicons/*`) and the app's masters, with nothing keeping them equal | `website/src/app/icon.svg`, `components/icons.tsx`, `apps/desktop/src-tauri/icons/family/*.svg` | `npm run icons:check` compares their shapes with the masters' (stage 1) |
| "Built to embed" says "a drop-in component comes later" | `lib/site.ts`, `developers.cards` | Reword once the panels exist: the demos on this page are the editor, embedded (stage 2) |
| The comparison's "as of October 2026" | `lib/site.ts`, `compare.body` | Re-check each row against its product's documentation, then change the month; I did not re-verify rows in this round. **Call: the other products' cells and the month stay with Stephan, and the build changes neither,** because they are public claims about other companies' products, which this design never checked |
| The comparison's Redlines column has only Yes and No: two planned features (live sessions, Word files) show as No, and nothing says what is built. `docs/design.md` §4, which the page copies, says "Redlines as designed" and ticks every row | `lib/site.ts`, `compare.rows`; `docs/design.md` §4 | A Planned mark, a legend, a rule for built, and a check that holds the page to §4, which gets the same marks (stage 1; see "Built and planned, in the comparison") |
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
  controls the page draws outside the editor, and one static attribute, the editable's accessible
  name (`EditorView.contentAttributes`), which no keystroke reads.
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
  **Call: the built page carries a Content Security Policy in a `<meta>` (production builds only)
  that allows its own origin and nothing else** (`default-src 'self'`, with `'unsafe-inline'` for
  the scripts and styles Next and CodeMirror write inline, `img-src 'self' data:`), because the
  editor loads a remote image as it is once it isn't inside a pending change, so a visitor who
  pastes a paragraph from another site, with Track Changes off or then accepted, would otherwise
  make the page fetch from that site. Pages can't send headers; a `<meta>` policy covers every
  directive this needs.
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
| Hero: `HeroSheet` (a three-view switch over markup) | **Panel 1, "plan.md"**: the editor on the Launch plan document, with Clean, Redlines and Raw as the editor's real views, a Track Changes switch, Comment, Review and Reset | It is the first thing seen, and the product's whole claim fits in it: a file with changes, three ways to read it |
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

- **New private workspace package `apps/website-embed`** (`@redlines/website-embed`), built with
  Vite as `embed-smoke` is, to one minified ES module, plus its stylesheet and the fonts.
  `embed-smoke` is left alone and keeps proving that the core needs nothing but a stub host.
- **Call: a separate package, not a second entry in `embed-smoke`,** so that adding the demo's needs
  never moves the core's budget and the core's budget never hides the demo's growth. Both depend on
  the same workspace packages, so the test that keeps the core free of the desktop app covers both.
- **Call: the ESLint rule that keeps Tauri out of `packages/` and `plugins/` covers both embeds
  too** (`apps/embed-smoke`, `apps/website-embed`), because a bundler would quietly bundle a Tauri
  import rather than fail on it.
- **Call: an app entry, not `build.lib`:** `rollupOptions.input` is `src/index.ts`, with
  `preserveEntrySignatures: 'strict'` to keep its export, because Vite leaves the whitespace in an
  ES library build, which costs about 35 KB gzipped here (measured below).
- **Call: no `external` list.** `embed-smoke` marks every `@codemirror/lang-*` but Markdown external,
  which suits a size line but not a page: `@codemirror/lang-markdown` imports the HTML grammar at
  load, which imports the CSS and JavaScript grammars, so a bundle that runs must carry all three.
- **Call: `base: './'`,** so every URL the bundle and its stylesheet hold (the fonts) is relative to
  the file, and one build works under `/` and under a Pages base path such as `/redlines/`.
- Its dependencies: `@redlines/editor`, `@redlines/format`, `@redlines/formatting`,
  `@redlines/plugin-api`, `@redlines/review`, `@redlines/agents`, `@redlines/agent-tools`,
  `@redlines/themes`, and the two `@fontsource` packages the Default theme uses, `carlito` and
  `cousine` (their latin files only; see Fonts). No `@redlines/code` (no code-language grammars;
  the demo documents hold no fenced code), no `@redlines/find`, no desktop code.

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
**Call: the stylesheet imports `@redlines/themes/tokens.css` whole,** although only Default is
applied: it is 2.4 KB gzipped, and a copy of the Default blocks would drift from the theme.

### Size, lazy loading, fonts

Measured with a scratch build of the current sources (`vite build` with aliases to the workspace,
not in the repo; KB here are 1,024 bytes, as in the budget files, gzipped at level 9):

| Bundle | `build.lib`, `embed-smoke`'s externals | `build.lib`, runnable | App entry, runnable |
| --- | --- | --- | --- |
| The minimal embed (`embed-smoke`'s entry) | 274.9 KB (281,449 bytes) | 342.4 KB | 309.6 KB |
| The same with the agents plugin's runs, live lines, picker, comment text and tool client | | 357.3 KB | **323.1 KB (330,831 bytes)** |

The first column is the number `embed-smoke` holds a line on (budget 276 KB). It leaves out the
grammars that `@codemirror/lang-markdown` imports (about 66 KB) and keeps the whitespace of a
library build (about 35 KB), so it is no guide to what a page downloads. The demo's own glue (the
page-facing API, the scripted Claude, two sample documents) adds a few KB to the last cell.

**Call: the JS budget starts at the first real build plus 3%, rounded up to a KB,** which should
land near 336 KB, because the 310 KB first written here was read off the first column. A first
build far above 330 KB means something unplanned came in, and the builder finds it before setting
the number.

| Part | Budget |
| --- | --- |
| The JS file (gzipped) | the first build + 3%, about 336 KB (`size-budget.json`, `jsGzipBytes`) |
| The CSS file (gzipped) | 10 KB (`cssGzipBytes`); about 4 KB expected, the tokens being 2.4 |
| Fonts (woff2, latin only, as served) | Carlito 400 29.4 KB, 400 italic 29.8, 700 30.7; Cousine 400 14.9: 104.8 KB (`fontBytes`) |
| What the first panel downloads | about **390 KB**: the JS, the CSS, and Carlito 400 and 700 (60 KB), the two faces the hero shows; about 435 KB once Raw (Cousine) and italic are used; 0 more for the second panel |

**Call: each embed keeps its own size check.** `embed-smoke`'s `check-size.ts` measures one
unhashed `dist/embed.js` and calls any other file a split, while this one writes a hashed JS file,
a stylesheet, fonts and a manifest elsewhere: `apps/website-embed/scripts/check-size.ts` reads the
manifest, gzips the JS and the CSS, adds up the fonts as they are, checks each against
`size-budget.json`, and fails when the JS is more than one file. It is the only size check: CI runs
it as `pnpm --filter @redlines/website-embed size`, and the site's `npm run embed:check` calls the
same script. The note in the budget file records each rise with its reason, as `embed-smoke`'s
does.

Fonts: the themes' `fonts.css` imports every Unicode subset of each face (the scratch build inlined
3.8 MB of CSS). The embed has its own `fonts.css` that imports only the `latin` files, with
`assetsInlineLimit: 0` so they are separate files under `embed/fonts/`, same-origin, `font-display:
swap`. **Call: latin only, no Carlito bold italic,** because the sample documents are English and
use bold and italic once each; a visitor who pastes Cyrillic gets the fallback font for those
glyphs, which is honest for a demo. **Call: the embed writes its four `@font-face` rules itself,
naming the woff2 files only,** because fontsource's `latin-*.css` also names a `.woff` that no
browser the bundle targets would fetch, and the size check counts what ships. A browser fetches a
face only when text uses it, which is why the first panel costs 60 KB of fonts, not 105.

Loading is the page's job (next section): not before the panel is within 600 px of the viewport, and
on idle (`requestIdleCallback`, or a timeout where Safari lacks it). A browser reporting
`navigator.connection.saveData` gets a "Try it here" button instead and loads on click.
**Call: lazy by distance, with a data-saving opt-out,** so the headline and the Largest Contentful
Paint never wait for 400 KB, and a visitor on a metered connection chooses to pay.

### The page-facing API

`apps/website-embed/src/index.ts` exports **one function**, `mountDemo`. Its types are in
`apps/website-embed/src/api.ts`:

```ts
/** The two demos; the bundle holds their documents. */
export type DemoName = 'plan' | 'design';
/** The editor's views, as `ViewMode` has them (a type test in the embed holds them equal). */
export type DemoView = 'clean' | 'redlines' | 'raw';

export interface DemoOptions {
  demo: DemoName;
  /** Called for every change of what the page's controls show, and once at mount. */
  onState(state: DemoState): void;
  /** A message for people, from the editor's `onNotice`: "Raw is read-only while ...". */
  onNotice(message: string): void;
}
export interface DemoState {
  view: DemoView;
  /** What the editor offers, in order, with the words the app's View menu uses. */
  views: readonly { view: DemoView; label: string }[];
  tracking: boolean;
  changes: number;               // pending changes: Review is disabled at 0
  canComment: boolean;           // false in Raw, where the review plugin takes no comment
  claudeRunning: boolean;
}
export interface DemoHandle {
  setView(view: DemoView): void;
  setTracking(on: boolean): void;
  startComment(): boolean;       // opens the box, as Comment does in the app; false when it did nothing
  askClaude(): boolean;          // 'design' only: selects the sentence, opens the box with the question
  openReviewBar(): void;
  reset(): void;                 // the original document, the demo's view and tracking, no history
  getDoc(): string;              // the file, for tests
  destroy(): void;
}
export type MountDemo = (parent: HTMLElement, options: DemoOptions) => DemoHandle;
```

**Call: the page names the demo, and the bundle holds the rest:** the two documents (imported with
`?raw`), the visitor (`{ handle: 'ada', name: 'Ada Lovelace' }`), the people record and the
script, because `website/` can't import files from outside itself (`turbopack.root` is `website/`),
and a document the page passed in would be a second copy.
**Call: `api.ts` imports nothing,** and the site imports it type-only by relative path
(`import type { MountDemo, DemoState } from '../../apps/website-embed/src/api'`), because the
site's TypeScript can't resolve `@redlines/*` from `website/`, and a hand-kept copy of the types
would drift. A type-only import is erased before the bundler sees it.
**Call: the embed holds the view list** (`[{ view: 'clean', label: 'Clean' }, ...]`) in an object
that `satisfies Record<ViewMode, string>`, because the editor exports no list of its views (the
app's View menu writes them out too): a fourth `ViewMode` fails the embed's type check until it has
a label, and the page then draws it with no change of its own.

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

**Call: `createEditor` gets a people record, `[{ handle: 'claude-ada', color: 2 }, { handle: 'bo',
color: 3 }]`, with no `onNewPeople` to keep anything,** and the live lines and the picker get the
same record (`getMet`). Without one, colors come from handles, and `claude-ada` leads to color 4,
blue, while the fallback, and the page everywhere else, draw Claude purple (color 2) and Bo teal
(color 3): the swap at mount would recolor Claude's change. Someone a visitor pastes in takes the
next color, as in the app.

Each demo starts the same way at mount and at `reset()`: **Redlines, Track Changes on.** `setDoc`
alone would put tracking back to the file's default, off (neither file says `tracking: everyone`),
so `reset()` sets both again after it.

### Tokens: the editor fits its host

Design §6.6: "Embedded editors fit their host. The embedding app passes token values". The panel's
root sets the editor's surface tokens from the site's variables, so the editor sits on the sheet
as the illustrations do, in both themes. It keeps the theme's **author colors, body font and
sizes**: those are what the product looks like, and the page's illustrations already say "Ada is
red".

**Call: five tokens come from the site, and only those:** `--rl-page: var(--sheet)`,
`--rl-ink: var(--ink)`, `--rl-ink-2: var(--ink-2)`, `--rl-ink-3: var(--ink-3)` and
`--rl-rule: var(--rule)`. The site has no twin for the rest (card, tint, pressed, tip, shadow,
syntax, mixed), so they stay the theme's; the theme's dark card is lighter than the sheet, which is
what lifts a card off it. The override's selector outranks the theme's
(`.rl-embed[data-rl-theme][data-rl-appearance]`), which sits on the same element.
**Call: no `--rl-column` override.** The column is a `max-width`, so it already takes the sheet's
width, and nothing else reads the token at this width.
**Call: the embed's stylesheet sets the column's top and bottom padding** to the sheet's (20 px top
and 24 px bottom; 26 px top from 641 px), in place of the app's 32 px and **30 vh**, which would
leave a third of a screen empty under every panel; it keeps the 24 px sides, which the review
plugin's dots are placed by (`COLUMN_PADDING`).

### CSS: no leaks either way

- The embed's CSS is **unlayered**. Tailwind v4 puts its preflight in `@layer base`, and an
  unlayered rule beats a layered one for every property it sets. CodeMirror's and the plugins'
  CSS-in-JS styles are injected unlayered too, and they set what their elements need (the review
  plugin's buttons and comment field set their own padding, border, background and font). Preflight
  still reaches what nobody sets, such as `box-sizing`, margins and `svg { display: block }`; the
  editor's elements don't depend on those, and the screenshots below are the check.
- Everything the embed's own stylesheet adds is under a `.rl-embed` class on the panel root. Nothing
  styles `html`, `body` or a bare element. See the review bar under Mobile and accessibility for the
  one plugin element that is placed against the window.
- **Call: on a touch screen (`pointer: coarse`) the comment box's field is 16 px,** in the embed's
  stylesheet only: it is the theme's 14 px interface size, and iOS zooms the whole page when a
  field under 16 px takes the focus, which Comment and Ask Claude both do. The document's text is
  already 17.5 px.
- **Call: `apps/desktop/src/interface-text.node.test.ts` reads `apps/website-embed/src` too,** so
  the embed's stylesheet keeps to the floors of 13 px and 12 px as the app's do.
- Stage 2 checks this with screenshots in both themes at 375, 768 and 1120 px; a leak either way
  is a bug in the embed's CSS, not a reason for shadow DOM.

**Call: no shadow DOM.** WebKit's selection and `getSelection()` handling across shadow roots has
been a long source of CodeMirror input bugs, and the review plugin positions its notes from the
document's geometry. Scoping by class and layer order gets the isolation without the risk.

### Where the files go

`pnpm --filter @redlines/website-embed build` writes `website/public/embed/` (git-ignored, in
`website/.gitignore`; Vite needs `emptyOutDir: true` to empty a folder outside its package):

```
embed/redlines-embed-<hash>.js
embed/redlines-embed-<hash>.css
embed/fonts/*-<hash>.woff2
embed/manifest.json      Vite's own manifest (build.manifest: 'manifest.json')
```

**Call: the manifest is Vite's own,** whose entry for `src/index.ts` names the JS (`file`) and the
stylesheet (`css[0]`), because it needs no plugin and can't disagree with the build.

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
is missing. **Call: `website.yml` sets it too,** so a pull request that breaks the embed's path
fails there, not in a deploy.

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
  app's, red only while on, the brand's red), **Comment**, **Review** and **Reset** (hero);
  **Ask Claude**, **Review** and **Reset** (agent panel).
  **Call: both panels have Review,** because the bar is the keyboard's only way to a change's
  Accept and Reject (cards open on hover or click), and the agent panel's whole point is deciding
  Claude's edit. Review is disabled while `changes` is 0, and shows no count: the bar says "Change 1
  of 3".
  **Call: the controls appear when the editor mounts, in room the sheet's bar keeps for them** (a
  min-height for one row, and for the wrapped rows below 641 px). Before that, and without
  JavaScript, the bar shows only the file's name, so no control is ever dead, and the view labels
  can come with the state.
- The dynamic import is `import(/* webpackIgnore: true */ /* turbopackIgnore: true */ url)` so that
  Next never tries to bundle it; stage 2 checks which magic comment this Next version honors.
- `lib/embed.ts` (server): reads the manifest, returns `{ js, css } | null`.
- `lib/demos.ts`: the page's copy for the two panels (file names, labels, captions, notices); not
  the documents. Those are `apps/website-embed/src/docs/launch-plan.md` and `design-note.md`,
  imported by the bundle with `?raw`, and mirrored for the fallback in `website/lib/demo-text.json`
  (see "The fallback").

### Loading, in order

1. HTML arrives with the fallback sheets. The controls are not rendered until the editor mounts;
   their room is kept (as the agent demo's play button is hidden until it can work).
2. After `load`, and when the panel is within 600 px of the viewport (an `IntersectionObserver` with
   `rootMargin`), on idle: import the module, add the stylesheet, wait for `document.fonts.load()` of
   the body face (1 s at most), then mount. The fallback body and the editor are swapped in one frame
   at the same width; the sheet's `min-height` is the fallback's height, so nothing below moves.
3. If anything fails (a rejected import, no `IntersectionObserver`, a thrown mount), the fallback
   stays and the controls never appear. Nothing is shown to the visitor, and the console says why.
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
**Call: the agent panel's fallback is checked against what the scripted run leaves,** since no file
holds that state: test 6 runs the script on `design-note.md` and compares the fallback's segments,
question and reply with the file it ends with (ids and times aside). `str_replace` records only the
words that differ, so the fallback shows "retry ~~3~~ 5 times", not today's "~~3 times~~ 5 times".
Its Accept and Reject are drawn, not buttons, as the hero fallback's are.
**Call: the drift guard also runs in `website.yml`,** which runs the embed's tests: `ci.yml`
ignores `website/**` and `**/*.md`, so a change to `demo-text.json` or to a sample document alone
would otherwise meet no test.

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

**Call: both sample files are written as the format writes them** (§5.7: the fixed first line,
`version: 1`, people sorted, one line per mark, the comment's text as a `|-` block, no emails), so
the visitor's first edit changes only what they did; today's `source` in `hero-sheet.tsx` lacks
`version: 1` and writes the comment's text inline, and the editor would rewrite both on the first
keystroke. Test 9 checks it: `serializeLedger(parse(doc).ledger)` is the file's ledger, byte for
byte.

### At the start

- View **Redlines**; Track Changes **on**; no focus in the editor (no autofocus, no scroll).
  **Call: tracking starts on,** so the first thing a visitor types visibly becomes a red underlined
  insertion in Ada's color, which is the demo's whole point; a visitor who turns it off sees plain
  edits.
- A caption under the sheet, in the site's caption style: "Type anywhere. Your edits are tracked, in
  your color." It changes with state: "Track Changes is off: your edits are plain text."
- The controls row: **Clean | Redlines | Raw**, **Track Changes**, **Comment**, **Review**,
  **Reset**.
- **Call: the page promises no keyboard shortcut of its own.** The view keys (⌥⌘1–3), Track Changes
  (⇧⌘E) and Review (⌥⌘]) are the app's menu bar, not the editor's, so the embed would need a
  keymap the constraints rule out, and macOS browsers take ⌥⌘M (Minimize All) before the page sees
  it. What the editor and its plugins bind works as in the app (⌘/Ctrl+B and the other formatting
  keys, Undo and Redo, ⌘/Ctrl+Return in the comment box); every other action is a button.
  **Call: the embed's stylesheet hides the keys in the review bar's Previous and Next hints**
  (⌥⌘[ and ⌥⌘], `.rl-hint-keys`), which name the app's menu bar; the bar's Esc, which the plugin
  binds itself, keeps its hint.

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
| **Comment** | Opens the comment box on the selection, or the word under the caret, or the caret; Post adds a thread by Ada; a dot beside the line shows it (the rail is dots at every width this page has; see Mobile) | `<!--cmt ...-->` and a `comments:` entry |
| **Raw** | The real file, with syntax colors. Read-only while Track Changes is on (the editor's rule): a keystroke there says so, and the page's notice line repeats it in the editor's words ("Raw is read-only while Track Changes is on. Turn Track Changes off to edit the source.") | unchanged |
| **Clean** | The document as if every change were accepted | unchanged |
| ⌘/Ctrl+Z, ⇧⌘/Ctrl+Y | Undo and redo, per panel | |
| **Review** | Opens the review bar at the foot of the editor, inside the sheet: next and previous change, Accept and Reject | |
| **Reset** | `setDoc` of the original, then Redlines and Track Changes on again; history starts over | back to the original bytes |

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
tracked changes in the agent's name).

**Call: panel 2 starts in Redlines with Track Changes on, and has no view or Track Changes controls
of its own,** only Ask Claude, Review and Reset; panel 1's switches don't reach it. The panel shows
one thing, the agent's tracked edit and the visitor's decision, and panel 1 already shows the
views. The file has no redlines at first, so the editor would open it Clean: the embed passes the
view.

```md
# Uploads

Uploads retry 3 times with backoff, then fail. Each attempt is logged.
```

### The flow

1. The visitor presses **Ask Claude**. The page selects "Uploads retry 3 times with backoff, then
   fail." (`handle.askClaude()`), opens the comment box on it (`startComment(text)`), and writes
   "@Claude is this still right? Fix it if not." in the box. The picker (`attachPicker`) is
   attached to the box as in the app, so typing `@` shows **Claude**. The visitor may edit the
   question or write their own.
   **Call: the focus stays in the box's field, after the question,** as the review plugin leaves
   it; the page doesn't move it to Post, which would mean reaching into the plugin's DOM. Post and
   ⌘/Ctrl+Return both post; on a phone the keyboard opens, as it does for Comment.
   **Call: the sentence is found in the editor's text by its start ("Uploads retry") and its end
   ("then fail."),** markers in between included, so a second ask after Claude's pending edit still
   finds it; when it is gone, the selection stays where it is and the box opens as Comment's does,
   with the same question.
2. The visitor presses **Post** (or ⌘/Ctrl+Return). The review plugin's `onPosted` hands the comment
   to `runs.posted`, the **only** way a run starts (the product's rule, unchanged). The thread
   appears in the rail with the visitor's comment.
3. The thread shows Claude's **live line** (as in the app, `createLiveLines`): "Reading
   uploader.ts", then "Editing this section", each about a second. It has a **Stop** button. The
   text is wired through the real tools.
4. Claude calls `str_replace` ("3 times" to "5 times", in Claude's name for Ada, with a note "per
   uploader.ts:88"; the tool records only the word that differs, a substitution of "3" with "5")
   and `reply` ("Now 5, per uploader.ts:88. Fixed."). The change is drawn in Claude's color with
   its card; the reply is in the thread.
5. The visitor presses Accept or Reject on the card (or in the review bar), or ignores it, or edits
   around it. Undo takes back a decision. It doesn't take back Claude's edit, which arrives as a
   reload (`reloadDoc`), and a reload starts the history over, as in the app: an Undo before it
   says so through `onNotice`.
6. **Ask Claude** again: the script reads the sentence. If it already says 5, it replies "Already 5,
   per uploader.ts:88. Nothing to change." and edits nothing. If the visitor rejected the change, or
   reset, it fixes it again. **Call: the script is a small state machine on the document's text, not
   a fixed script,** so a second press is never a repeat of a stale edit. It reads what the `view`
   tool returns, the newest text, where a pending change counts as accepted: a pending "5" is
   "Already 5", as a real agent would read it.
   **Call: when the newest text has no "retry N times" (the visitor deleted or rewrote it), or a
   tool call is refused, the script replies in one plain sentence ("I can't find the retry count
   in this note any more.", or "I couldn't make that edit here.") and ends,** and never yields an
   error event, because a failed run's line on a scripted demo would read as a broken page.

Edge cases:

- **Stop** aborts the run: nothing further is applied, and the line says "Stopped." with its cross
  to put it away, as in the app (`runs.stop` ends the run with that line). The script's waits
  listen to the run's `signal`, so it ends at once.
- **A comment that doesn't name @Claude** starts nothing. One that does, in a reply in the thread,
  starts a run in that thread; the script treats any question the same way (checks the sentence).
  **Call: any post naming @Claude gets the scripted behavior,** so the visitor never feels
  rejected for typing their own words, and the caption says plainly what it is.
- **A comment with the mention already in the file** (the visitor pastes a file's text into Raw)
  starts nothing. A test pins it.
- **Reset while a run is live** bumps the document's generation, then calls
  `runs.documentReplaced()` (the product's own path), then `setDoc`, in that order, so the late
  tool call is refused.
- **Citations** (`uploader.ts:88`) render as plain text. In the app, a click opens the file; the
  embed has no file, so `renderText` is `renderCommentText` with a `documentPath` that answers
  null, which links nothing and keeps the app's fold of a long reply. The caption names it: "In
  the app, a click opens the file."
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
  Promise.resolve(true)`, `applyAgentEdit: (next, agent) => { editor.reloadDoc(next, { agent: agent
  ?? null }); return Promise.resolve(); }`, as the desktop does for a document with no file,
  `generation` counting `reset()` calls, `path: () => null`), settings that always answer
  `'document'` and a `projectRoot` that returns a fixed in-memory root. With no path and an agent
  whose `readLimit` is `'folder'`, `createRuns` takes "this document" without asking and calls
  neither: they are there for the types, and the first-run question never appears;
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
**Call: the text goes only into an empty box.** A draft that Escape set aside on that anchor comes
back as it does today, and a box already being written in keeps its words, because the plugin
never throws away what a person typed (`openNewComment(restored?.text ?? initialText)`, the latter
only when the open box is empty).
The agents plugin's addition, `toolClient(lines)`, keeps its home in `fake-provider.ts` and the
package's `./fake-provider` export; that file's header says it now serves the website's scripted
agent as well as the tests.

## Mobile and accessibility

### Mobile

- **Layout.** The panel is the sheet at the column's width; below 641 px the controls wrap in two
  rows (views, then Track Changes / Comment / Review / Reset). Labels are words, not icons alone. Tap targets
  are at least 44 × 44 px (the current 7 px-high buttons grow to a hit area of 44 on touch with
  padding, not a larger look).
- **The rail.** In a narrow editor the review plugin shrinks the rail to a dot in the author's
  color beside each anchor; tapping a dot opens its note over the page, to the dot's left, and a
  new comment's box opens there too. The threshold is the editor's own width, 1,000 px
  (`COMPACT_BELOW` in `plugins/review/src/rail.ts`), and the widest sheet on this page is about
  520 px. **Call: the panels always show dots, and the hero's grid stays as it is,** because no
  column split this page could take would bring the rail back.
- **Cards on touch.** There is no hover on a phone. A tap on a change pins its card (the product's
  rule: "Clicking a change pins its card"), and Accept and Reject are on it. The **Review** button
  opens the bar, which has next, previous, Accept and Reject as buttons.
- **The keyboard.** The editor's text is 17.5 px (`--rl-size-body`), over the 16 px under which iOS
  zooms on focus, and the comment box's field is 16 px on touch screens (see CSS). The page doesn't
  scroll to the editor on mount. `scroll-margin` keeps a focused caret clear of the on-screen
  keyboard.
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
- **The review bar.** It floats at the bottom of the window in the app: it is `position: fixed`
  (`plugins/review/src/styles.ts`), appended to the editor's root, and `bar.ts` writes its `left`
  and `bottom` from the window's geometry. On the page that would leave it hanging over whatever
  scrolls under it. **Call: the embed's stylesheet places it at the foot of the editor instead**
  (`.rl-embed .rl-review-bar { position: absolute !important; left: 50% !important; bottom: 12px
  !important }`, against the editor root, which CodeMirror makes `position: relative`; its own
  `translateX(-50%)` centers it), and pads the foot of the text while it is open
  (`.rl-embed .cm-editor:has(> .rl-review-bar) .cm-content`), because the inline values the plugin
  writes lose only to `!important`. The app is unchanged. Change cards are CodeMirror tooltips,
  `fixed` and placed against the window, and the sheet's `overflow: hidden` doesn't clip them.
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

1. **Deploy** (stage 5, on Stephan's yes). That alone puts the caret and the Nov 5 copy on
   `www.redlines.md`.
2. **`app/apple-icon.png`** (180 × 180) and **`app/opengraph-image.png`** (1200 × 630: the caret on
   warm paper at the left, the title "One file for people and AI. See every change." in the page's
   type, no other chrome), rasterized from `apps/desktop/src-tauri/icons/family/caret.svg` and the
   site's tokens, committed under `website/src/app/` (Next's file convention writes the `<link>` and
   `<meta>` tags in a static export; `metadata.twitter.card` is `summary_large_image`, so the image
   shows large there too). A script, `website/scripts/make-social.mjs`, redraws them by hand when
   the icon changes; CI doesn't run it.
   **Call: commit generated images, not generate them in CI,** because the render needs a font and
   a renderer, and the images change twice a year.
   **Call: `make-social` renders in Playwright's Chromium, with Manrope from `@fontsource/manrope`
   (both dev dependencies),** not with `rsvg-convert`, which finds fonts on the system, and Manrope
   isn't there: `next/font` downloads it into the build only.
   **Call: the apple icon is the caret's tile drawn edge to edge,** square and opaque, because iOS
   rounds the corners itself and fills what is transparent with black.
3. **`npm run icons:check`** (run in `website.yml`) compares the site's copies with the masters
   under `apps/desktop/src-tauri/icons/family/`: `src/app/icon.svg` and `BrandMark` with
   `caret.svg`, and each of `public/favicons/*.svg` with the master of its name. `website.yml`'s
   path filter adds that directory, so changing a master fails the website until its copies are
   redrawn.
   **Call: it compares shapes, not strings:** the same rects, circles and paths in the same order and
   colors (case aside), rects exactly, circles within 0.1, and each path's outline within 0.25 of
   the master's both ways (every vertex of one within 0.25 of the other's outline, in the tile's
   100 units). The site's paths are simplified copies, with a tenth of the points rounded to one
   decimal, so no `d` of theirs appears in a master; today's copies are within 0.14, and a redrawn
   master is off by whole units. A `node:test` file shows the check failing for a vertex moved by
   0.5 and a circle left out.
4. **Copy.** Edits to `lib/site.ts`:
   - `developers` "Built to embed": the format and the editor are TypeScript packages in the repo;
     "the demos on this page are the editor itself, embedded in a static page with no server;
     a drop-in component for React comes later." (Once stage 2 ships.)
   - `compare.body`: update the month **after** re-checking each row against the products'
     documentation (Word, Google Docs, Notion, VS Code). I did not re-verify the rows in this round,
     and the design does not guess them.
   - `hero.unreleased`: add that the editor on the page is the real one: "The first full release is
     on its way. Try the editor on this page; the design and the format are on GitHub." ("Below" is
     wrong from 921 px, where the sheet is beside the text.)
   - `changes.points`: the second point says "A click opens that file": keep, and add "(in the
     app)" so the panel's plain citation isn't a contradiction.
5. **Config comments and READMEs** that still say the repository is private or the name is not
   final: `site.config.mjs`, `deploy-website.yml`, `website/README.md`. The lines that say the
   deploy doesn't run on pushes stay true until stage 5, and change with the trigger.
6. **The comparison's built and planned marks** (next section).

There are no screenshots on the page to refresh (the illustrations were markup). The README in the
repository root has PNG screenshots (`docs/img/view-*.png`); they are not the website's and are
out of scope here, but if the icon appears in them, it is a follow-up.

## Built and planned, in the comparison

Today the Redlines column says Yes or No. Two of its Nos are features the design plans (live
sessions, Word files), and its Yeses don't say whether a visitor can use the feature today. The
design's own table, `docs/design.md` §4, which the page is a copy of, says "Redlines as designed"
and ticks all fifteen rows.

**The marks.** Each Redlines cell is **Built** (the check) or **Planned**; the other products keep
Yes and No, from their documentation. A legend under the table names the marks: "✓ Yes. For
Redlines: built, it works today. ◌ Planned: designed, not built yet. ✕ No."
**Call: Planned is a dashed ring in the third ink, the size of the check, named "Planned" for
screen readers and in the cell's title** ("Redlines: planned"), because gray keeps red for the
brand and green for what exists, and a ring reads as not yet filled in. It is a third `<symbol>`
beside `icon-yes` and `icon-no` (`components/icons.tsx`).
**Call: only the Redlines column has Planned,** because the page can't know the other products'
plans and reports only their documentation.

**Call: a row is built when all of it works on `main`:** a person can do it in the app built from
`main`, or, for a row about the file, the file and the `redlines` command line do it on `main`. A
library function that nothing in the app reaches doesn't count, and a row half built is planned.
The page deploys from `main` and its panels are `main`'s editor, so a rule by the latest release
would call the editor in the hero planned while there is no full release; it is the same trade as
the push deploy, a few days ahead of a release and never behind it.

**Call: `docs/design.md` §4 is the source, and the page shows its rows.** §4's Redlines column
says ✅ or Planned under that rule, its introduction says so, and `npm run compare:check` fails when
any cell the page shows differs from §4's, so the page can't claim a feature the design marks as not
built, and the two tables stay one ("The website shows the same table" becomes checked).
**Call: the page keeps its eleven rows.** §4's other four (accept or reject by person, full edit
history, the three desktop platforms, the embeddable component) are all planned, and would add
claims about the other products to re-verify; the page's argument doesn't need them.
**Call: the rows move to `website/lib/compare.json`** (`{ "feature", "redlines": "built" |
"planned", "others": [Word, Google Docs, Notion, VS Code] }`), which `lib/site.ts` and the check both
read, because the check is then plain Node, as `sync-release.mjs` is, and needs no TypeScript
loader. `lib/site.ts` keeps the words around the table.

Each Redlines row, checked against the code at `4de60b1`:

| Row (on the page) | Redlines | Why |
| --- | --- | --- |
| Edits Markdown files | Built | The Mac app (README, "What is in the Mac app") |
| R Markdown and Quarto | Built | `.qmd` and `.Rmd` open as documents (`apps/desktop/src/file-names.ts`); markers stay out of chunks, inline code, math, shortcodes and labels (format §9.4, `packages/format/src/inline.ts`) |
| Tracked changes (suggestions) | Built | The editor's tracked-change layer, cards and review bar |
| Comment threads | Built | The rail: comments, replies, resolve and reopen (`plugins/review`) |
| Tracked changes stored in the Markdown file | Built | The format (`packages/format`) |
| Changes and comments merge in git | Built | Plain git: conflicts only in the ledger, resolved by keeping both sides, which the ledger's first line says (format §7.2–7.3). The merge driver and resolving on open (§7.4) aren't built, and the row doesn't claim them |
| Live collaboration with people | **Planned** | Live sessions (design §7.1–7.2, M4); nothing in the code |
| Live collaboration with AI | Built | Agents in comments, with the live line (`plugins/agents`) |
| AI agents suggest changes in their own name | Built | `str_replace` writes tracked changes as `claude-ada` (`packages/agent-tools`) |
| Word files with tracked changes, in and out | **Planned** | Word import and export (M3, `docs/word-export/`); no code |
| Free and open source | Built | MIT, a public repository |
| *§4 only:* Accept or reject by person | Planned | The bar decides one change at a time; §5.6's bulk decisions aren't built (the format's `acceptAll` filter has no caller in the app) |
| *§4 only:* Full edit history, stored in the file | Planned | Format §6's save blocks aren't written |
| *§4 only:* Desktop app for Mac, Windows and Linux | Planned | The Mac app is built; Windows and Linux aren't (§10). §4 says so under the table |
| *§4 only:* Embeddable editor component | Planned | The core embeds (`embed-smoke`, this page's panels), but the component of §6.3 (`@redlines/react`) isn't built |

The words around the table change with the marks: `compare.body` becomes "What ${name} has built,
and what it plans. Other products as of October 2026, from their documentation. VS Code includes
the Live Share, GitHub Copilot and Quarto extensions."; in `compare.note`, "${name} has no server, so
people share the file as they share any file. Word import and export come next." becomes "Until
live sessions come, people share a ${name} file as they share any file. Word import and export are
planned."

The check, `website/scripts/compare-check.mjs` (`npm run compare:check`, no network), reads §4's
first table under `## 4. How Redlines compares`, refuses a Redlines cell that is neither ✅ nor
Planned and another product's that is neither ✅ nor ❌, and for each row of `compare.json` fails,
naming the row, when §4 has no row of that name or any cell differs, the product names included. It
runs in `website.yml`, whose path filter adds `docs/design.md`, and in the deploy before the build.
`scripts/compare-check.test.mjs` (`node --test`, the site's `npm test`) shows it failing for a row
the page calls built and §4 calls planned, for a row §4 lacks, and for a changed cell of another
product, and passing on the files as they are.

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

- **Add the push trigger the workflow's own header already describes** (stage 5, on Stephan's yes):
  pushes to `main` that touch `website/**`, `apps/website-embed/**`,
  `apps/desktop/src-tauri/icons/family/**` or the packages the embed bundles
  (`packages/{editor,format,plugin-api,agent-tools}/**`, `plugins/{review,agents,formatting,themes}/**`),
  plus the workflow itself. (`docs/design.md` is in `website.yml`'s filter, not here: a change to §4
  that the page must follow changes `website/lib/compare.json` too, which deploys.) GitHub's path
  filters have no braces, so each package is a line of its own, in both workflows.
  **Call: the site redeploys when the editor it embeds changes,** so the demo is the product on main
  within minutes and nobody has to remember. The cost is a one-minute deploy per such merge, and
  that the page may show the editor a few days before the next release does. The page never names a
  version for the demo; the footer and Download name the release. `concurrency` already queues
  deploys.
  **Call: the trigger and the first deploy are the last task, and each waits for Stephan's yes,**
  because both publish to the web; every change before them is built and checked without
  publishing anything (a merge to `main` deploys nothing until the trigger exists).
- **Build the embed before the site** (stage 2; the workflow still runs only by hand or from a
  release). In the `build` job, before `npm ci`: `pnpm/action-setup` (the version comes from
  `packageManager`, as `ci.yml` does), `setup-node` without cache (as now), `pnpm install
  --frozen-lockfile --filter @redlines/website-embed...`, then `pnpm --filter
  @redlines/website-embed build`. These steps need `working-directory: .`, since the job defaults to
  `website/`. The job still has read-only permissions and no secrets. Dependency caches stay off in
  a deploy.
  **Call: `pnpm/action-setup` is pinned to the commit `release.yml` pins
  (`0977fd99725f1db4007ccb2928dbb4e90d06cc86`, v6.0.10),** because it is the first third-party action
  in a job whose output is published, and `release.yml` already holds such actions to a commit.
- Before the build: `npm run sync-release` (as now), `npm run compare:check`, and the size check.
  `npm run build` runs with `REQUIRE_EMBED=1`. The deploy fails if the manifest is missing, if the
  bundle is over its budget, or if the comparison disagrees with the design.
- The release path (`workflow_call` from `release.yml`) is unchanged: it builds `main` and refreshes
  the download metadata. It builds the embed in the same way.

### `website.yml` (pull requests and pushes)

Same steps without deploying, plus: `npm run sync-release:check`, `npm run icons:check`,
`npm run compare:check`, `npm test` (the checks' own tests), the embed's size check, the embed's
vitest tests (`pnpm exec vitest run apps/website-embed`, the drift guard among them), and the
browser smoke test (see Tests), with `REQUIRE_EMBED=1` on the build. Its path filter adds the
embed's paths, `apps/desktop/src-tauri/icons/family/**` and `docs/design.md`, so a change to the
editor, an icon master or §4 that breaks the page fails the PR that makes it, not a deploy later.
**Call: `website.yml` installs the whole workspace, with pnpm's cache, as `ci.yml` does,** because
the embed's tests run on the root's vitest and happy-dom, which a `--filter` install leaves out;
the deploy, which only builds, keeps the filtered install. Its timeout goes from 10 to 20 minutes
for the browsers (`npx playwright install --with-deps chromium webkit`).
`ci.yml` keeps ignoring `website/**`; the new package is covered by `pnpm typecheck`, `pnpm lint`,
`pnpm test` and a new step `pnpm --filter @redlines/website-embed size` beside the existing embed
step.

### Locally

```sh
pnpm install         # at the repo root, once: the embed is a workspace package
cd website
npm install
npm run embed        # pnpm --filter @redlines/website-embed build, from the repo root
npm run dev          # the panels load from public/embed
npm run embed:watch  # rebuild the bundle on change (vite build --watch)
npm run compare:check && npm run icons:check && npm test
npm run build && npm run test:e2e   # the browser smoke test, against out/
```

`website/README.md` gets this, and its "Interactive parts" paragraph is rewritten: the interactive
parts are the two panels, the page's controls for them, and the tab icon's rotation.

## Changes to `docs/`

- **`docs/format.md`:** none.
- **`docs/design.md`:**
  - §4: the Redlines column says ✅ or Planned under the rule above, the introduction says "Redlines
    as built on `main`, and what it plans" and names the check, and a line under the table says the
    Mac app is built and Windows and Linux are planned.
  - §6.3 packages: a row for `apps/website-embed` ("The editor with the review interface and a
    scripted agent, built as a bundle for the website; no desktop code, which the lint rule that
    keeps Tauri out of shared code checks"). design.md has no sentence on the smoke test today (the
    v0.2 design holds it), so the row is where both embeds are named.
  - §6.5 hosts and capabilities: a sentence that a host may supply **none** of the capabilities
    (the website's demos supply no files, no clipboard beyond the browser's, no printing, no network,
    no document data, and a scripted agent), and the editor degrades without each.
  - §5.7: the box can open with text in it (`startComment(initialText)`).
  - §6.6, "Embedded editors fit their host": the website is the first host that does this; one line.
  - §1 summary or §3: nothing. The claim "the same editor in the desktop app and embedded in other
    apps" (§2) is now demonstrated; leave the wording.
- **`AGENTS.md`:** the Layout table gets `apps/website-embed`; "Commands" gets the embed build,
  budget and `npm run embed` lines for the website, and the website's checks (`compare:check`,
  `icons:check`, `npm test`, `test:e2e`); the CI section says what `website.yml` now does (build and
  check the embed, the checks, the smoke test), and, with the stage 5 change only, that
  `deploy-website.yml` runs on pushes.
- **`docs/releasing.md`:** one paragraph, with the stage 5 change: the site redeploys on pushes to
  `main`; a release refreshes the Download section; what to do if the embed fails to build (the
  deploy stops and the site stays as it was).
- **`website/README.md`:** as above, plus the Deploy section's "private" and "name is not final"
  lines, which are false now, and its "it does not run on pushes" line, which becomes false in
  stage 5 and changes there.
- **`README.md` (root):** nothing, unless it mentions the site's demos.

## Tests

The conformance suite for this work, where each line fails if the property breaks.

**In `apps/website-embed` (vitest, happy-dom; `*.test.ts` next to the code):**

1. `mountDemo` shows the sample document in Redlines with Track Changes on; `setView` reaches all
   three views; `DemoState.views` is the embed's view list, in the View menu's order and words.
2. **Typing with tracking on** makes an `ins` mark by `ada` and a ledger entry; the same typing with
   tracking off changes only the text; **Raw with tracking on** refuses typing and calls `onNotice`
   with the editor's message.
3. `editor.accept` / `reject` through the page's card path give the same file as the CLI
   (`@redlines/format`'s decided text), byte for byte; Undo restores.
4. `reset()` restores the original string exactly, Redlines and Track Changes on, and clears
   history.
5. `destroy()` twice is safe, removes the `matchMedia` listener and the panel's DOM, and removes
   every listener the embed added to `window` and `document` (spies on `addEventListener` and
   `removeEventListener` pair them). **Call: the stylesheets CodeMirror and the live line put in
   the document's head stay,** since every editor on a page shares them and neither library takes
   them out; the test doesn't ask for that.
6. **The scripted Claude (fake timers):** posting "@Claude ..." through the comment box's
   `onPosted` runs; the live line shows two statuses; the document gains a `sub` by `claude-ada` with a
   `note` and a reply in the thread; Accept makes "5 times"; Undo takes the Accept back, and an Undo
   past Claude's edit is refused with the editor's notice; a second ask replies "Already 5" and
   changes nothing; Reject then ask edits again; a sentence rewritten without its count gets the
   plain reply and no edit; **Stop** mid-run applies nothing and leaves the line "Stopped.";
   `reset()` mid-run refuses the late tool call. The file it ends with checks the agent fallback
   (see "The fallback").
7. **The mention rule:** `setDoc` of a document that contains `@Claude` in a comment starts nothing;
   a post without a mention starts nothing; a post inside a code span starts nothing.
8. **No network, no storage:** with `fetch`, `XMLHttpRequest`, `WebSocket`, `navigator.sendBeacon`,
   `localStorage`, `sessionStorage`, `indexedDB` and `document.cookie` replaced by spies that throw,
   a full session (mount, type, switch views, comment, ask Claude, accept, reset, destroy) makes no
   call.
9. **The sample documents are valid files:** `parse` reports no diagnostics, their ledger is what
   `serializeLedger` writes, byte for byte, and the fallback's `demo-text.json` matches their marks
   and clean text (the drift guard).
10. **Size:** `pnpm --filter @redlines/website-embed size` fails over budget, and when the JS is
    split.
11. **Types:** `DemoView` and the editor's `ViewMode` are each assignable to the other, and the view
    list covers every `ViewMode` (a compile-time test, run by `pnpm typecheck`).

**In `plugins/review` / `plugins/agents`:** `startComment(initialText)` opens the box with the text,
returns false in Raw, posts nothing by itself, and leaves a draft set aside on that anchor, or one
being written, as it is; `toolClient(lines)` behaves as the fake relay's `connect` did (the
existing `runs.test.ts` passes unchanged).

**In `website/` (a Playwright smoke test against `out/`, served statically, Chromium and WebKit;
`@playwright/test` and `@axe-core/playwright` as npm dev dependencies, run in `website.yml` as
`npm run test:e2e`):**

**Call: Playwright's `webServer` runs `website/scripts/serve.mjs`,** a small `node:http` server for
`out/` (directories to `index.html`, the right media types), because `npx serve` would fetch an
undeclared package at test time.

1. The page with JavaScript **off** has the fallback sheets and no controls.
2. With JavaScript on, scrolling to each panel mounts an editor; typing in panel 1 produces a
   `.rl-ins`-style mark (the test uses the editor's class); switching to Raw shows `<!--ins`; Reset
   restores.
3. **Every request is same-origin and under `/embed/` or the page's own assets;** a route handler
   fails the test on any other origin (this is "no network" on the built site, including fonts),
   `localStorage` holds only `redlines.mark`, no file under `/embed/` is requested before a panel
   nears the viewport, the first panel requests the manifest's JS and CSS and no more than the
   fonts it shows, and an image from another origin pasted with Track Changes off is never fetched
   (the policy above). **Call: the test checks which files are fetched, not their bytes,** because its
   server doesn't compress and the size check already measures them gzipped.
4. With the embed files blocked (route abort), the page still shows the fallback and logs, not throws.
5. **Keyboard:** Tab from the page top reaches each control and the editor and leaves it; Post,
   Stop and Accept are operable without a mouse; `axe-core` finds no serious or critical violations in
   light and dark.
6. At 375, 768 and 1120 px: no horizontal page scroll, the controls don't overlap, and the review
   bar stays inside the sheet.
7. **The comparison:** the Redlines cells for live collaboration with people and Word files are
   named "Planned", the others "Yes", and the legend is there.

**In `website/scripts/` (`node --test`, the site's `npm test`):** the comparison check and the
icons check each fail on a planted mismatch and pass on the files as they are (see their sections).

**Measured by a script, by hand, before stage 2 ships (not in CI):** `npm run perf` loads the built
page in Playwright's Chromium with the CPU throttled 4× (the DevTools protocol's
`Emulation.setCPUThrottlingRate`) and reports the main-thread cost of loading the bundle: the
module's evaluation plus mount should stay under **250 ms**; if it doesn't, the second panel mounts
only when it is on screen and the first waits for idle. **Call: a script, not a person with
DevTools,** so the number can be taken again the same way after a change.

**By hand, before the first deploy and before any release (not in CI, and left to Stephan):** iOS
Safari and Chrome on Android (typing, the on-screen keyboard, tapping a change, the rail dots),
desktop Safari, Chrome and Firefox, and VoiceOver on the panel.

## Stages

Each is worth having alone, and stages 1 to 4 publish nothing: merged to `main`, they wait there
until stage 5.

**Call: the deploy moves from first (stage 0) to last (stage 5), and the push trigger with it,**
because both publish to the web, which only Stephan says yes to; he can still say yes to the first
deploy at any point, since it needs nothing from the other stages.

**Stage 1 — icon, social image, copy, the comparison (#192).**
`apple-icon.png`, `opengraph-image.png`, `make-social`, `icons:check`, the stale-comment fixes, the
`release.json` check, and the comparison's built and planned marks with `compare:check` and §4's
marks; `website.yml` runs the new checks. The `compare` re-check against the other products and its
month stay with Stephan (below). No dependency on the editor. **Call: `hero.unreleased` changes in
stage 2 and `changes.points` in stage 3,** with the panels they describe, so the page never points
to an editor it doesn't have yet.

**Stage 2 — the hero panel (#193, part 1).**
`apps/website-embed` (build, budget, `mountDemo` without the agent), `lib/embed.ts`, `DemoPanel` and
`DemoControls`, the fallback and its drift guard, the hero swap, the CSS isolation, token overrides,
the page's Content Security Policy, the deploy (build steps only) and website workflows with pnpm,
the Playwright smoke test, the mobile and accessibility pass, and the `hero.unreleased` and "Built
to embed" copy. After this stage the page's argument is true: the hero is the product.

**Stage 3 — the agent panel (#193, part 2).**
`startComment(initialText)` in the review plugin, `toolClient` in the agents plugin, the stub host
and scripted Claude in the embed, panel 2 and its caption, the `changes.points` wording, tests 6
and 7. The old `AgentDemo` and its animation code are deleted.

**Stage 4 — polish and keeping it true.**
The `saveData` button, `npm run perf` and a trim if the budget is tight, and the list of checks by
hand for Stephan. The fourth view (simple markup,
[#182](https://github.com/skadauke/redlines/issues/182)) lands with #182: the page picks it up from
`DemoState.views`, and the hero caption gets a line then.

**Stage 5 — publish (each step on Stephan's yes).**
The push trigger in `deploy-website.yml`, with the lines in its header, `website/README.md` and
`AGENTS.md` that say it doesn't run on pushes, and `docs/releasing.md`'s paragraph; then
**Actions › Deploy website**
(`gh workflow run deploy-website.yml`), and a look at `https://www.redlines.md/` afterwards: the
caret, the panels, the marks. Fixes #192's visible symptom.

## Decisions most worth Stephan's look

1. **The agent is scripted, started by the visitor, and labeled.** No model, no network, no
   autoplay; a real run through the product's real tools, with the visitor's own post starting it.
2. **Two real panels (the hero, the agent), everything else stays HTML,** and the old three-view
   drawing is reduced to one fallback.
3. **Lazy load, about 390 KB for the first panel** (about 326 KB of script, the HTML, CSS and
   JavaScript grammars that Markdown's grammar imports included; 4 KB of CSS; 60 KB for the two font
   faces it shows), after idle and near the viewport; a data-saving opt-out. A new package,
   `apps/website-embed`, rather than growing `embed-smoke`. The first draft's 310 KB of script was
   `embed-smoke`'s line, which leaves out what a page must download.
4. **The site redeploys on every push to `main` that touches it or the editor it embeds,** once you
   say yes to the trigger. The demo can run a few days ahead of the downloadable app.
5. **The live site was stale because nothing deployed it since Oct 15,** not because the code has the
   old icon; a deploy fixes that, and it waits for your yes, which you can give at any point. And
   the site offers only a full release for download: until you publish `v0.2.0` as one, the
   visitor's call to action is "try it here".
6. **The comparison marks each Redlines row Built or Planned,** under one rule (built means it all
   works on `main`), with `docs/design.md` §4 as the source and a check that fails when the page
   claims more. Today that makes live sessions and Word files Planned, and every other row on the
   page Built.

## Left to Stephan, or not decided

- **The yes for stage 5:** the push trigger, and the first deploy. Each publishes to the web.
- **When `v0.2.0` becomes a full release** (not a pre-release). Until then Download says "Coming soon".
- **Enforce HTTPS** on the Pages custom domain once its certificate is issued (repository admin;
  `https_enforced` is false and the certificate state `new` as of today).
- **The comparison table's other products** need a check against their current documentation
  before the "as of" month changes; I did not do that here. (The Redlines column was checked
  against the code, above.)
- **The checks by hand on devices:** iOS Safari, Chrome on Android and VoiceOver (see Tests), which
  no one but a person with the devices can do.
- Whether to add a **download or copy button for the Raw file** ("take plan.md with you"). Left out:
  it is not needed to prove the claim, and a download is a file the page makes.

The builder's check settled the two measurements this list used to hold: the rail is dots at every
width this page has (the editor is never 1,000 px wide), and the review bar is `fixed`, which the
embed's stylesheet overrides (see Mobile and accessibility).
