# Journeys

Playwright journeys in WebKit, the engine the app draws with. A journey opens the desktop page
(`pnpm dev` in `apps/desktop`: it opens `src/sample.md`, keeps saves in memory, and has a scripted
agent), then types, presses keys, pastes, clicks and drags as a person does, and takes screenshots
at the moments worth seeing. It is how a change gets looked at, not only tested.

## Running them

Once per machine, the browser: `pnpm --filter @redlines/journeys exec playwright install webkit`.

```sh
pnpm journeys                      # every journey (starts the dev server itself)
pnpm journeys -g @smoke            # the journeys tagged @smoke
pnpm journeys tests/lists.spec.ts  # one file
JOURNEYS_PORT=1482 pnpm journeys   # the dev server's port (1482 by default; use your lane's)
```

A server you started yourself (`JOURNEYS_BASE_URL=http://localhost:1482`) is used as it is.
Screenshots of a run are in `apps/desktop/journeys/test-results/**/shots/`; a failed run also has
a trace (`pnpm --filter @redlines/journeys exec playwright show-trace <trace.zip>`).

## Baselines

`j.baseline(name)` compares the window with its approved screenshot,
`apps/desktop/journeys/baselines/<spec file>/<name>.png`, and fails when more than 15 pixels differ
(antialiasing doesn't count, a changed letter, about 40, does). The caret is hidden in a baseline:
a journey asserts where it is with `caret()`. The look is in the file
name: `name.png` is light at 100%, then `name-dark.png`, `name-200.png`, `name-dark-200.png`. A failed
run leaves the picture it got, the approved one and a diff in `test-results/<journey>/`.

- A short run is the light 100% look. `JOURNEYS_PROJECTS=all pnpm journeys` runs all four looks
  (`light`, `dark`, `light-200`, `dark-200`; or a list of them separated by commas).
- `JOURNEYS_OTHER_GREP=@smoke` limits the looks other than the light one to the journeys matching it
  (what main runs in dark and at 200%).
- **Accepting a change on purpose:** `pnpm journeys:accept` (with the arguments of a run:
  `pnpm journeys:accept tests/lists.spec.ts`) rewrites the baselines that changed, and writes the
  ones that don't exist yet. A plain run never writes one: a missing baseline fails it. It rewrites
  only the looks that are run, so after a change to dark or 200% use
  `JOURNEYS_PROJECTS=all pnpm journeys:accept`; and a difference of 15 pixels or fewer is no change
  to it (the run passes with it). Look at each image git shows changed before you commit it: a
  baseline is approved by the person who reads the PR.
- **Where baselines are drawn:** by WebKit on macOS, as the app is, and CI runs the journeys on a
  macOS runner for that reason; baselines drawn on another system differ in the text's pixels.
- Keep baselines few. One guards a look that must not change (a smoke journey's view, a menu that was
  wrong once); a journey's other moments are `j.shot(name)`, for the look review, and are compared
  with nothing.

## Writing one

```ts
import { expect, test } from '../src/journey.ts';

test('Tab, then typing at once, in a bullet list', async ({ start }) => {
  const j = await start({ doc: '- one\n- two\n', tracking: false });
  await j.caretAfter('two');
  await j.after('Tab', 'abc'); // a structural key, then keys with nothing between
  expect(await j.text()).toBe('- one\n  - twoabc\n');
  expect((await j.caret()).lineText).toBe('  - twoabc');
  await j.shot('after-tab');
});
```

`start({ doc, tracking, view, scheme, textSize })` opens the page: the text (with its ledger if it
has changes), Track Changes on or off, the view (`clean`, `simple`, `redlines`, `raw`), and the
look (`scheme` light or dark, `textSize` 1 or 2 for 100% or 200%). Then:

- reading: `text()`, `drawn()`, `caret()`, `selectedText()`, `uiState()`;
- placing the caret (setup, not the journey): `caretAfter(text)`, `caretBefore`, `caretAtEnd`,
  `caretAtStart`, `selectText(text)`, `place(from, to)`;
- keys: `press('Tab', 'Shift+Tab', 'Enter', 'ControlOrMeta+b')`, `type(text)` at human speed, `burst(text)`
  with no wait between keys, `after(key, text)` a key and then a burst, `paste(text, html?)`;
- the mouse: `click(text | locator, { button })`, `hover`, `drag(from, to)`, `pointOf(text)`,
  `pointAt(offset)`;
- looking: `settle()`, `shot(name)`.

Keys and the mouse are real browser events. A paste is the browser's `paste` event, made up and
sent to the editor (it reaches the editor's paste handling, not the browser's own); the journey
fails if the editor didn't take it. Only setup and reading go through the page's hook
(`window.__redlines`, `src/journey-hook.ts`, set only in development in a plain tab). A script
error in the page fails the journey. CI: `.github/workflows/journeys.yml` (below).

## The app's own windows

The journeys draw the page. The title bar, Preferences, About, dialogs and the window's shadow are
the app's: `apps/desktop/scripts/app-windows` runs a built `Redlines.app`, finds its windows by
process id and takes each with `screencapture -l<window id>`, whatever is in front of it.

```sh
cd apps/desktop
pnpm tauri build --bundles app          # → src-tauri/target/release/bundle/macos/Redlines.app
scripts/app-windows                      # the main window → apps/desktop/app-windows/NN-*.png and index.md
scripts/app-windows --debug              # the debug build's app (pnpm tauri build --debug --bundles app)
scripts/app-windows --panes --file ../../docs/design.md   # also Preferences and About; open a document
```

The terminal (or the Claude app that runs it) needs **Screen Recording** permission, once: System
Settings › Privacy & Security › Screen & System Audio Recording; quit and open it again. Without it
`screencapture` writes the wallpaper, so the script stops first and says so. `--panes` also needs
**Accessibility** (it presses ⌘, and the About menu item through System Events); without it those
shots are skipped. It needs `swiftc` (the Xcode command line tools) for its small window-list
helper, and waits `--wait` seconds (4) before each shot. It never asks for computer use. It starts a
new instance of the app and stops only that one, with what that instance started (it asks, then
kills what is still running after ten seconds). It replaces its own earlier `NN-*.png` and `index.md`
in `--out` and nothing else.

## CI

`.github/workflows/journeys.yml` runs them on a macOS runner (WebKit there is the app's engine, and
baselines are drawn by it), as a job of its own in parallel with `check`:

| When | What | Looks |
|---|---|---|
| a pull request | the `@smoke` journeys, and those of the areas its paths touch (`src/areas.ts`) | light |
| a push to main | every journey, and the smoke journeys again | light; dark, 200% and dark 200% for the smoke ones |
| manual dispatch (the sweep) | every journey | all four |

A change to a path every journey draws through (the format, the editor's core, the themes, the
page's own code, the journeys, the workflow) runs every journey. The run uploads `journeys-test-results`
(the pictures, and for a failed comparison the picture got, the approved one and the diff) and
`look-review` (the pictures in order, with INDEX.md; see [look-review.md](look-review.md)). To
approve a changed baseline, run `pnpm journeys:accept` on a Mac and commit the images.
