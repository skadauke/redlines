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
- keys: `press('Tab', 'Shift+Tab', 'Enter', 'Meta+b')`, `type(text)` at human speed, `burst(text)`
  with no wait between keys, `after(key, text)` a key and then a burst, `paste(text, html?)`;
- the mouse: `click(text | locator, { button })`, `hover`, `drag(from, to)`, `pointOf(text)`,
  `pointAt(offset)`;
- looking: `settle()`, `shot(name)`.

Keys and the mouse are real browser events. Only setup and reading go through the page's hook
(`window.__redlines`, `src/journey-hook.ts`, set only in development in a plain tab).
