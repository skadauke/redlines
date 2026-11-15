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

## The look review

`pnpm journeys:look` collects a run's screenshots into `apps/desktop/journeys/look-review/` with an
`INDEX.md`, for an agent or a person to check against the checklist. How a lane uses it:
[look-review.md](look-review.md).

## Journeys for bugs that are still open

A journey that fails today because of an open issue is written as
`known(510, 'title', /the pasted bullet is an item of its own/, body)` (from `src/journey.ts`). The
body runs, and it must fail with the signature in its message (give the assertion that shows the bug
a message: `expect(x, 'the pasted bullet is an item of its own')`), so a typo, a timeout or a page
error fails the journey instead of passing as "the bug". The run stays green while the bug stands and
goes red ("known bug #510 no longer fails") when the fix lands: the lane that fixed it changes
`known(510, …)` to `test(…)`, and the journey guards the fix. The failure is the evidence:
`JOURNEYS_EVIDENCE=1 pnpm journeys tests/lists.spec.ts` runs `known` journeys as ordinary tests and
shows what fails and where (and the shots show what it looks like).

## Tags and areas

`@smoke` runs on every pull request (the page opens, Track Changes marks typing, a list, a table,
the eye's menu). The area tags, `@lists`, `@blocks`, `@tables`, `@links`, `@views`, say which part of
the app a journey is about, so that a PR runs the ones for the paths it touches.

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
error in the page fails the journey. Not in CI yet: a later PR adds the job.

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
