# Zoom and the page

*Design, Nov 10, 2026, for epic #188: #189 (⌘+ and ⌘− zoom the whole window; the pinch zooms only the text) and #190 (in a wide window, text zoom widens the column before it rewraps), built on #163's floor for interface text, which main has had since PR #201. It builds on [design.md](../../design.md) and [format.md](../../format.md), and says where it departs from them. Stephan made one call, on a pinch beside the margin notes (**Stephan's call**, in The pinch); every other decision is mine, marked **Call:** with its reason. A builder's check of this design against main (`4de60b1`), the locked crates and CodeMirror is folded in: its answers stand where a builder will look for them, as calls where they decide something.*

## Why

Stephan, from the review of the build 10 test drive:

- #189: "Make ⌘+ and ⌘− zoom everything in the window, the interface included, as the Claude app does: it helps with visual impairment and with screens that are closer or further away. Keep the trackpad pinch for the text only (Text Zoom), and make it look more fluid than it does today."
- #190: "In a large window, even zoomed in, the text column leaves wide empty margins. Text zoom should first widen the column to use the page, and only then change where lines wrap."
- #163: "Font is very small (e.g. update dialog, preferences). Let's not equate minimalism with text that's too small to read!"

What the app does today (design §5.1, `apps/desktop/src/text-size.ts`, `plugins/themes/src/tokens.css`):

- There is one size, the text size. View › Larger Text (⌘=), Smaller Text (⌘-), Actual Size (⇧⌘0) and a pinch walk a ladder of eight sizes, 80% to 200%, kept in the settings for every window.
- It multiplies the document's sizes (px × `--rl-text-scale`) and the text of what sits on it. Since #201 every interface font size is a theme token: the margin notes, change cards, the review bar, the agents' live line and picker take `--rl-size-ui-scaled` and `--rl-size-ui-small-scaled` (14 px and 13 px times the text size, never under 13 px and 12 px), and the rest of the interface takes `--rl-size-ui` (14 px) and `--rl-size-ui-small` (13 px). So the title bar, sidebar, menus, notices, notifications, find bar and Preferences are large enough at 100%, but nothing makes them bigger.
- The pinch moves one rung for every 10% the fingers travel: the text jumps by 10 to 20% at a time, rewraps at each jump, and keeps no line in place.
- The column is 680 px (`--rl-column`) at every text size. At 200% it holds about 47 characters a line, in a window of any width: that is #190.
- The rail stays 248 px wide while its notes' text grows with the text size, and the review bar's words grow inside its fixed 42 px height.

## In short

Two zooms, which multiply:

| | **Zoom** (the window) | **Text Zoom** (the text) |
| --- | --- | --- |
| Changes | Everything Redlines draws in its windows: the page, notes, cards, bars, menus, notices, notifications, the sidebar, Preferences; the title bar up to 150% | The document's text and what sits on it: the notes, cards, the live line and the picker |
| Asked with | ⌘+ (the menu shows ⌘=), ⌘−, ⌘0; Preferences › Appearance › Zoom | A pinch; ⌃⌘+, ⌃⌘−, ⌃⌘0; Preferences › Appearance › Text size |
| Sizes | 80, 90, 100, 110, 125, 150, 175, 200% | The same ladder from the keys; any whole percent from 80 to 200 from a pinch |
| How | WebKit's page zoom, which the app sets on every window (Tauri's `set_zoom`) | The CSS custom property `--rl-text-scale`, as today |
| Kept | The person's, for every window, across launches | The same, as today |
| Reaches the file, print, the clipboard or an export | Never | Never |

And the page (#190): the column is a number of characters, not of pixels. It grows with the text size until it meets the margins, and only then do lines rewrap; in a wide enough window a pinch is a smooth magnification of the column. The notes beside it grow with the text too, and the column gives up to a third of its width to keep them there. While the fingers are down in a pinch the notes keep their state, and that rule applies once they lift.

## Goals

1. ⌘+, ⌘− and ⌘0 zoom everything in every Redlines window, the interface included, for low vision and for screens near and far (#189).
2. A pinch zooms only the text, continuously, with the line under the pointer held in place (#189).
3. In a wide window, Text Zoom widens the column first and rewraps only once it meets the margins (#190).
4. Both zooms are the person's: every window opens at them, and they survive a relaunch.
5. #163's floor holds at 100%: zoom adds to it, and Text Zoom never takes interface text below its size at 100%.

## Non-goals

- A zoom kept per document, per window or per display. Word keeps a zoom in each `.docx` (`w:zoom`); a Markdown file has nowhere private to keep one, and per-person state never goes in the file (format §5.6).
- Zoom past 200%. macOS's own Zoom (System Settings › Accessibility › Zoom) magnifies the whole screen far beyond it.
- A reading width setting, like Google Docs' View › Text Width for pageless documents, or Pages' Fit Width. Design §5.12 keeps reading settings for later; this design leaves room for a width token.
- Zooming the menu bar, context menus, the system's open, save and alert dialogs, the About panel, and the install window. They are the system's, as in every Mac app; the install window runs before the app's settings exist.
- A pinch that zooms the window. Stephan: the pinch is for the text only.
- Changing any theme's measure. 94 characters a line in Default is on the long side, but it is the theme's choice.
- Windows and Linux beyond not breaking: Tauri's `set_zoom` drives WebView2 (`SetZoomFactor`) and WebKitGTK (`set_zoom_level`) the same way, and there the title bar is the platform's own. Only the Mac is tested.

## Anti-goals

These would make it a failure even if it technically works:

- **Blur.** Zoom that scales a picture of the page instead of laying it out again. Text stays sharp at every size.
- **A pinch that jumps**, or rewraps lines while the column could still grow, or loses the line under the fingers.
- **Wide empty margins around zoomed text** in a wide window.
- **Text Zoom growing the interface:** the review bar, menus, notices, find bar or Preferences. They belong to ⌘+.
- **A zoom key that edits the document.** ⌘0 converting a heading to body text, from a browser habit, is the case that matters.
- **Controls under, or out of line with, the window buttons** at any zoom, or a window that opens at 100% and then jumps.
- **Zoom in an output:** a size in the file, the clipboard, a print or an export.
- **New chrome:** a zoom slider, a percentage in the title bar, a status bar.

## Constraints

**The format.** Nothing here changes the file or what any edit writes, so the format's rulings (every allowed edit reads the same in every decision order, micromark 4.0.2 as the oracle, refuse rather than repair) are untouched. The one shortcut that moves, Body's, runs the same command, and nothing here refuses or changes typing. A keystroke costs what it does on main: the column is CSS, and the rail's new rule lives in the measure it already makes. Format §5.6 keeps per-person state out of the file; this design adds zoom and text size to its list.

**Tauri, as locked (Cargo.lock: tauri 2.12.4, tauri-runtime-wry 2.12.2, wry 0.57.0, tao 0.37.1, muda 0.20.0), read in the crate sources:**

- `WebviewWindow::set_zoom(f64)` and `Webview::set_zoom` reach wry's `zoom`, which on macOS sets `-[WKWebView setPageZoom:]` (macOS 11+). There is no getter: the app keeps the level itself. From a page, `getCurrentWebview().setZoom()` needs `core:webview:allow-set-webview-zoom`.
- `WebviewWindowBuilder::initialization_script` adds a script that runs in the window's page before the page's own scripts, at every load of it, with the text it was given when the window was built.
- `zoomHotkeysEnabled` (in the window config or the builder) turns on WebView2's own zoom keys on Windows; on macOS and Linux it injects a script (`webview/scripts/zoom-hotkey.js`) that takes ⌘ with `-`, `=`, `+` and `0`, and Ctrl with the mouse wheel, steps 20% between 20% and 1000%, and keeps its level in a page variable.
- The window buttons can be placed only when a window is built (`traffic_light_position`, `"trafficLightPosition": { "x": 20, "y": 28 }` for document windows). The runtime has `set_traffic_light_position` (`WindowMessage::SetTrafficLightPosition`, tao's `set_traffic_light_inset`), but tauri 2.12.4's `Window` and `WebviewWindow` don't expose it. And tao puts the buttons back at its stored inset at every `drawRect:` and on leaving full screen, so moving them with AppKit would be undone.
- **The menu bar's keys.** Tauri parses a menu item's accelerator as muda's `Accelerator`, a key by its position, and drops one it can't parse without a word (`menu_accelerators.rs` guards against that). `CmdOrCtrl+=` is the = key, which AppKit draws as ⌘= and matches by the character "="; there is no plus key (`CmdOrCtrl+Plus` and `CmdOrCtrl++` don't parse, and muda's `KeyAccelerator`, which takes "+", is never made by Tauri's menu API). So ⇧⌘=, which types "+", and the + key of a layout that has its own (German) likely reach no row. The page sees a key before the menu bar (`packages/editor/src/commands.ts`), and a key it takes never reaches the menu.
- **Between a page and the app.** A page's `emit` is the app's `emit` to every window (`plugin:event|emit`): every window's listeners hear it, the sender's own included. The app's own commands need no permission. Tauri hands WebKit a window's messages in the order they are sent (at once on the main thread, through the event loop from any other, `send_user_message`): an event sent to a page and a `set_zoom` after it reach the page in that order, as two messages.
- wry prints with `printOperationWithPrintInfo:`, run modally for the window, the same call measured below.

**WebKit, measured** on this Mac (macOS 27.0.1, a 2× display), in a never-shown WKWebView (see Measured):

- `pageZoom` is real zoom: at 150% a 1200-point window has `innerWidth` 800 and `devicePixelRatio` 3 (4 at 200%, 1.6 at 80%); media queries see the smaller width; a `resize` event fires at each change; a 100 px box is 100 px to `offsetWidth` and to `getBoundingClientRect`.
- A zoom set before the page loads holds, and survives a reload of the web view.
- Printing to PDF ignores it: at 200% the same 15 pages, with the same glyph sizes, as at 100%. The text size does reach print: at `--rl-text-scale` 2 the same page printed 58 pages at twice the size.
- WebKit computes `min()` and `max()` inside `calc()`, and division by a unitless custom property, as the CSS below needs.

**CodeMirror 6.43.14:**

- Under page zoom 1, 1.5 and 2, `posAtCoords` of the middle of `coordsAtPos(p)` gives back `p` at every sampled position: clicks, the caret and selection map as at 100%.
- `EditorView.scrollIntoView(pos, { y: 'start', yMargin })` puts the line of `pos` `yMargin` px below the top of the scroller (here `.rl-scroller`, a parent), and as a scroll target it switches off CodeMirror's own anchoring for that measure.
- CodeMirror's own anchoring keeps the top line in place when heights change, but with a parent scroller only while the editor has the focus (or just after a wheel or touch), so a window in the background would lose its place without ours.
- A measure runs in the next animation frame, asked for by `requestMeasure` or by a transaction that redraws or carries a scroll target, as one that only scrolls does. One asked for from inside an animation-frame callback waits for the frame after.

**Accessibility.** ⌘+ to 200% with nothing cut off is WCAG's resize-text bar (1.4.4). macOS's Zoom owns ⌥⌘= and ⌥⌘− when its keyboard shortcuts are on, so those stay free. VoiceOver hears each change through the notice (`role="status"`). No animation is added, so Reduce Motion has nothing to stop.

**#163, on main (PR #201).** Every interface font size in `apps/desktop/src` and `plugins/*/src` is one of four theme tokens or a plain px of 13 or more, and `apps/desktop/src/interface-text.node.test.ts` fails any other: `--rl-size-ui` (14 px) and `--rl-size-ui-small` (13 px), which each theme declares, and `--rl-size-ui-scaled` and `--rl-size-ui-small-scaled`, worked out on `[data-rl-theme]` as `max(13px, 14px × the text size)` and `max(12px, 13px × the text size)`. This design keeps that rule and its test. It redefines the two scaled tokens so that they never go below their size at 100% (What it scales), adds two frame tokens to the test's list (The window's frame), and multiplies lengths, never font sizes, by the note scale. It multiplies whatever the floor gives, and never divides it except at a window zoom below 100%, which is the person's choice.

## Zoom: the window

### Keys and menus

| View menu | Mac | Windows and Linux | Enabled |
| --- | --- | --- | --- |
| Actual Size | ⌘0 | Ctrl+0 | Except at 100% |
| Zoom In | ⌘= in the menu, and ⌘+ | Ctrl+= | Below 200% |
| Zoom Out | ⌘− | Ctrl+− | Above 80% |
| Actual Text Size | ⌃⌘0 | — | Except at 100% |
| Larger Text | ⌃⌘= in the menu, and ⌃⌘+ | — | Below 200% |
| Smaller Text | ⌃⌘− | — | Above 80% |

The View menu becomes: Clean, Redlines, Raw; Actual Size, Zoom In, Zoom Out; Actual Text Size, Larger Text, Smaller Text; Show Files, Enter Full Screen. The Window menu's Zoom (the Mac's, which resizes the window) stays where it is, as in Safari. A disabled row takes its key with it (`menu-model.ts`): ⌘0 at 100% and ⌘= at 200% do nothing, and the Mac beeps, as in Safari. ⌘0 leaves the text size alone, and ⌃⌘0 the zoom.

**Call:** ⌘+, ⌘− and ⌘0 zoom the window. Because the Claude app, Safari and Chrome do, ⌘0 is Actual Size in Pages too, and Word on Windows now maps Ctrl+0 to 100% zoom.

**Call:** Body moves from ⌘0 to ⇧⌘N (Ctrl+Shift+N), and keeps its name; Heading 1 to 6 keep ⌘1 to ⌘6. Because a habit that resets the zoom must never edit the document, ⇧⌘N is Word's Normal style on the Mac (Ctrl+Shift+N on Windows), and ⌘1 to ⌘6 already toggle a heading back to body text.

Freeing `Mod-0` gives ⌘0 to the menu bar: the registry binds each command's key at `Prec.high`, and the page sees a key before the menu bar, so with Body on `Mod-Shift-n` nothing in the page binds ⌘0. In a comment box or the find bar, ⇧⌘N reaches the menu's Body row, which `registry.run` refuses while another field has the focus, so the moved key can't edit the document from there either. None of the keys this design moves or adds is taken by a menu row, a plugin's command, CodeMirror's keymaps (whose ⌃N and ⇧⌃N have no ⌘) or the planned palette (⇧⌘P). ⇧⌘0 becomes free, and ⌥⌘= and ⌥⌘− stay macOS's Zoom's.

**Call:** Text Zoom's keys are ⌃⌘+, ⌃⌘− and ⌃⌘0, not Safari's ⌥⌘+ and ⌥⌘− (Make Text Bigger and Smaller). Because macOS's Zoom takes ⌥⌘= and ⌥⌘− when its keyboard shortcuts are on, and the people who turn those on are the people this is for. On Windows and Linux, Ctrl+Alt is AltGr on European keyboards and Ctrl+Shift+= is Ctrl++, so Text Zoom there is the pinch (Ctrl and the wheel) and the menu.

**Call:** off the Mac, the three text rows keep the Mac's keys as written (`Ctrl+Cmd+=`, which is Ctrl with the Super key there), as Show Files' `Ctrl+Cmd+S` does, with a comment that Windows and Linux get keys of their own when they are supported. Because a row has one accelerator for every platform, and those platforms are asked only not to break.

**Call:** ⌘+ typed as "+" reaches Zoom In through the page. Each window of the app, on the Mac, takes a key press whose `key` is "+" with ⌘ as Zoom In, and with ⌃⌘ as Larger Text, whatever Shift and the key's place, while the row is enabled; "=" goes on to the menu bar, and so does "+" at a limit, where the Mac beeps as for ⌘=. Because Tauri's menu can't hold a + key, and a key the page takes never reaches the menu, so nothing runs twice whether or not AppKit would have matched it.

**Call:** Apple's order and today's names: Actual Size, Zoom In, Zoom Out, as Safari lists them; Larger Text and Smaller Text as now, and Actual Text Size for the reset. Because people know the order, and the names already shipped.

**Call:** each change shows a passing notice, the slim line under the title bar that already says "Track Changes is on": "Zoom 125%", "Text size 137%". The window whose command made the change says it; with Preferences in front, a key runs in the document window behind it, whose menu bar it is (Preferences closes with the last document window), and that window says it. A change from Preferences' stepper is told by the stepper's value, a live region already. The other windows say nothing. Because there is no status bar or zoom field to show the level, the two zooms need telling apart, and VoiceOver should read it once.

**Call:** the docs write the keys as the menu shows them, ⌘= and ⌃⌘=, as design.md does today. Because that is what a reader finds in the menu.

### What it zooms

Everything Redlines draws: the page and its text, notes, cards, the review bar, the find bar, notices, notifications, the drawn View and Review menus, hover hints, the sidebar, and Preferences. At 200% each is twice its size in points and laid out afresh in a page half as wide, as a browser does. The menu bar, context menus, the system's dialogs, the About panel and the install window keep the system's size. The bars and popovers already place themselves by `innerWidth`, `innerHeight` and client rects, all in the zoomed CSS px, so the review bar, the find bar, the link popover, the picker, the live line and the rail follow as they are.

**Call:** the window zoom is WebKit's page zoom, which the app sets with `set_zoom`. Because it is real zoom (measured above): the CSS viewport shrinks, text stays sharp, CodeMirror's coordinates stay exact, media queries and the rail's own width rule follow by themselves, and printing ignores it.

**Call:** not `zoomHotkeysEnabled`. Because its script steps 20% from 20% to 1000%, keeps the level in the page (lost at a relaunch, different in every window), takes ⌘0 and Ctrl with the wheel (the pinch's), and needs the zoom permission in every window.

**Call:** not CSS `zoom` on the root. Because viewport units, `innerWidth` and media queries don't follow it, and CodeMirror would have to map every coordinate through it, while under page zoom its mapping is exact as it stands (measured).

### The window's frame

The title bar is part of the page, but its controls sit beside the window buttons, which Tauri 2.12.4 can't move once a window exists. So the frame keeps the geometry it has at 100%, in points, at every zoom: the bar is 52 pt tall, its controls' middle is 26 pt from the top (the window buttons' line), and Files sits 84 pt from the left, clear of the buttons. What grows is what's in it: the icons and the file name zoom with the window up to 150%, and stay at 150% above it. The same holds for the sidebar's head (52 pt, under the window buttons) and for Preferences' top bar (56 pt, its tabs on its own line). The View and Review menus that open from the bar zoom fully, like the rest of the interface.

The frame's lengths are in two units that `apps/desktop/src/zoom.css`, loaded by both windows, works out on `:root` from `--rl-zoom`: `--rl-pt`, one point whatever the zoom (`calc(1px / var(--rl-zoom))`), for what lines up with the window buttons (the bar's height, its controls' middle, Files' left edge, the space kept for them); and `--rl-frame`, a pixel that zooms only to 150% (`calc(1px * min(var(--rl-zoom), 1.5) / var(--rl-zoom))`), for the controls' own sizes and their icons. The frame's text takes two tokens of its own beside #201's, `--rl-size-ui-frame` and `--rl-size-ui-small-frame`: the interface sizes times `min(zoom, 1.5) / zoom`. `interface-text.node.test.ts` accepts them, and checks that they are at least the interface sizes, in points, at every zoom from 100%.

**Call:** the frame keeps its points, and its contents zoom up to 150%. Because at 150% a 28 px button is 42 pt and still fits the 52 pt bar on the buttons' line; above that it couldn't without moving the buttons, and the menu bar and the window buttons beside it don't zoom either. A later Tauri that exposes `set_traffic_light_position` could let the whole bar zoom.

**Call:** the frame's units and tokens live in the desktop app's `zoom.css`, not in the themes' tokens. Because `--rl-zoom` is the desktop app's, and an embedded editor has no window zoom.

### Every window, kept

The zoom is the person's, like the theme: one level for every window, kept across launches, set in Preferences › Appearance › Zoom (a stepper like Text size's: − 100% +, with the line "Everything in Redlines' windows"). A change in any window reaches all of them at once. A new window opens at it from its first frame.

The app is the only writer of WebKit's zoom, and the level travels like this:

1. **The app keeps the level** (`zoom.rs`): read at setup from `zoom.json` in its data folder, like `icon.json`, and none when the file is missing, unreadable or not a rung; written at every change.
2. **A new window starts at it.** When the app builds a document window or Preferences, it adds an initialization script that hands the page the level (`window.__REDLINES_ZOOM__`, `null` while the app has none) and calls `set_zoom` right after `build()`, before the page loads. `main.ts` and `preferences/main.ts` set `--rl-zoom` from it first, as they set the theme, so the first frame is drawn at the zoom.
3. **A window asks, and the app tells every window.** A window saves `zoom` in its settings and calls the app's `set_zoom` command; so does Preferences' stepper. The app takes only a rung from a document window or Preferences, keeps it, and then, for each of those windows, sends the page the `zoom` event with the level and calls `set_zoom` on it, in that order. The window that asked hears the same event as the others.
4. **A page follows in two steps.** On the `zoom` event, before WebKit's zoom changes, it takes its reading place from CodeMirror's layout, which is still the old one, and closes the drawn menus, pinned cards and notes opened from their dots, but for a note being written. On the `resize` that the new zoom brings, it sets `--rl-zoom` and puts its reading place back (The reading place). Should no `resize` come within half a second, it sets `--rl-zoom` then.
5. **The app's level is the truth once it has one.** Each page, once loaded, asks the app for it (`zoom_level`), reporting the level in its settings. The app takes the report only when it had no level at launch, and only the first; otherwise it answers with its own, and a page whose settings differ saves it. The answer also catches a change made while the page was loading, before it listened, and a reloaded page, whose initialization script still carries the level of when its window was built.

**Call:** one zoom for every window, kept. Because it is about the person's eyes and screen, not the document, and every new window should open at a size the person can read.

**Call:** 80% to 200%, in the text size's eight steps. Because those are the steps people know from browsers in that range, one ladder for both zooms is one thing to learn, 200% is WCAG's bar, and past it the smallest window's page (360 CSS px at 200%) gets too small to hold the interface.

**Call:** the app sets the zoom on every window; a window only asks. Because with one writer every window's zoom and its `--rl-zoom` change together, new windows open already zoomed, a late report can't undo a change, and no window needs a zoom permission (#156: each window gets only what it calls).

**Call:** a window asks with the app's commands, `set_zoom` and `zoom_level`, not with an event. Because a page's `emit` reaches every window's listeners, which would hear a request as the app's answer, and a command needs no permission and can be refused.

**Call:** `--rl-zoom` changes on the `resize`, not on the event. Because the event and WebKit's zoom reach the page as two messages, and a frame drawn between them would show the frame's units for one zoom on a page at the other; the `resize` comes in the first frame at the new zoom, before it is laid out.

**Call:** the zoom reaches the document windows and Preferences, and not the install window. Because the install window runs before the app's settings exist, and keeps the system's size (Non-goals).

**Call:** Preferences grows with the zoom, 560 × 400 pt times the zoom, keeping its top edge and its middle, never larger than the screen's visible area, and then moved the least distance that keeps it inside that area; past that its pane scrolls. Document windows keep their size. Because Preferences can't be resized by hand, while growing document windows would fight the person's own sizes and tiling. Its stepper's buttons move 10 to 25 pt from under the pointer at each step, which a rare change, with keys of its own, can bear.

### Narrow pages

Zoom makes the page narrower: the smallest window (720 × 480 pt) at 200% is a page of 360 × 240 CSS px. Every window works at that size:

- the title bar truncates the file name first; its icons keep their places;
- the column is the page less its margins, with the rail as dots (below);
- the review bar shows Accept and Reject as icons, with their names in their hints, when the whole bar doesn't fit the window less 16 px on each side;
- the sidebar covers the left of the page instead of pushing it when the page beside it would be narrower than 360 CSS px (a window under 600 CSS px, with the sidebar's 240), and closes when a document is chosen in it;
- cards, notes shown from their dots, notices, notifications, menus and the find bar are never wider than the window less 16 px on each side (the find bar, the link popover and notifications already are).

**Call:** the page holds down to 360 × 240 CSS px. Because real zoom makes pages that narrow, and the same rules serve the editor embedded in a narrow pane.

### The reading place

Zoom rewraps the text, so a window would lose its place without an anchor. When the zoom changes, each window keeps its reading place: the caret's line, when the caret is on screen, stays at the same height on the screen, in points; otherwise the line at the top stays at the top. Every window does it the same way: it takes the place on the app's `zoom` event, from CodeMirror's layout, which is still the old one, and on the `resize` it hands CodeMirror the place as a scroll target (`EditorView.scrollIntoView(pos, { y: 'start', yMargin })`, with `yMargin` the line's old distance from the scroller's top, in points, divided by the new zoom, and kept under the scroller's height less a line). CodeMirror's next measure, in that frame, lays the text out at the new zoom and scrolls the line back before the frame is drawn, in a window in the background too, where CodeMirror's own anchoring wouldn't hold. Drawn menus, pinned cards and notes opened from their dots close at a zoom change, but for a note being written. One module (`reading-place.ts`) takes and puts back the place, for the zoom, the text keys, a pinch and the settings.

**Call:** keep the caret's line, else the top line. Because the caret is where the person works, and the top line is what CodeMirror keeps on its own.

**Call:** drawn menus, pinned cards and notes opened from their dots close at a zoom change, but a note being written stays open, with its draft and the keyboard. Because their places were measured for the old layout, and a zoom is rare enough that reopening one costs little, while closing a note being written would take the keyboard from the person typing in it.

### Browsers and embedded editors

In a browser (the dev server, `pnpm dev`) the zoom is the browser's own: the menu model is told it isn't in the app, and its three zoom rows have `keyInMenuOnly`, so the page leaves ⌘+, ⌘− and ⌘0 to the browser; the "+" key handling isn't installed, and `--rl-zoom` stays 1. Body has no key there. The editor core never zooms its host: an app that embeds Redlines keeps its own zoom and may set `--rl-text-scale`.

**Call:** the window zoom belongs to the desktop app. Because a page can't zoom its browser, and an embedded editor must not zoom the app around it.

**Call:** no key for Body in a browser. Because Chrome and Safari keep ⇧⌘N and Ctrl+Shift+N for a new private window before the page sees them, and the Paragraph menu has Body while ⌘1 to ⌘6 toggle a heading back.

## Text Zoom: the text

### What it scales

The document's text in every view, and what sits on the text: the rail's notes and their boxes, change cards, the live line and the @ picker in a thread. Not the review bar, find bar, menus, notices, notifications, sidebar, title bar or Preferences: they follow the window zoom alone.

**Call:** the review bar stops growing with Text Zoom: its text, its hints and its errors take the unscaled tokens, `--rl-size-ui` and `--rl-size-ui-small`. Because it is a control at the foot of the window, not part of the page, and today its words outgrow its fixed height.

**Call:** notes and cards grow with the text above 100%, and keep their size at 100% below it. `--rl-note-scale: max(1, var(--rl-text-scale, 1))` is declared on `[data-rl-theme]`, beside #201's tokens, and #201's scaled tokens become the interface sizes times it, keeping their floors: `max(13px, calc(var(--rl-size-ui) * var(--rl-note-scale)))` and `max(12px, calc(var(--rl-size-ui-small) * var(--rl-note-scale)))`. Below 100% the notes then keep 14 px and 13 px, as #201's own description says of them, where main shrinks them to 13 and 12. Font sizes stay those tokens; only lengths are written times `--rl-note-scale` (the rail's width and gap, paddings, icon boxes and icons). Because a note at 80% would cramp its rail, and Text Zoom never takes interface text under its size at 100%.

**Call:** the derived sizes are declared on `[data-rl-theme]`, where #201 works out its own, and the tokens' comment says that a host sets `--rl-text-scale` on the theme's element or above it. Because a custom property made of others is worked out on the element that declares it, from that element's text size, so a text size set below it would leave them as they were.

### The keys

Larger Text and Smaller Text step to the next size on the ladder above or below the current one, also from a size a pinch left between two (137% steps to 150% or 125%); Actual Text Size goes back to 100%. Each keeps the caret's line where it is on the screen when the caret is on screen, else the top line (The reading place, with the zoom unchanged), and shows "Text size 150%". A text size that another window changes reaches this one through the settings (`watchSettings`), which takes the reading place before applying it.

**Call:** step to the next rung above or below. Because today's rule, a step from the nearest rung, would sometimes skip a rung from a size between two.

### The pinch

- **It follows the fingers.** The size is the size when the pinch began times the gesture's scale, held between 80% and 200%, to the nearest 1%. WKWebView sends `gesturestart`, `gesturechange` and `gestureend` with a scale; other webviews send a wheel with Ctrl held, and its ticks multiply into a scale, as today.
- **The newest size, with its anchor, in the next frame.** Each gesture event sets `--rl-text-scale` at once (setting it twice in a frame costs nothing) and, in the same call, hands CodeMirror the anchor as a scroll target. CodeMirror then measures once, in the next frame, at the newest size, and scrolls the anchor's line back before that frame is drawn. No frame shows a size without its anchor.
- **The line under the pointer stays put.** When the pinch begins, the document position under the pointer is the anchor (the gesture event's `clientX` and `clientY`, else the pointer's last position). Over the margins or the rail it is the line at that height; outside the editor, the line at the top. Every frame puts the anchor's line back at its height on the screen.
- **Nothing rewraps while the column can grow.** In a wide enough window the lines keep their breaks (The page, below), so the pinch looks like a smooth magnification of the column about the pointer's line. Once the column meets the margins, lines rewrap at each frame, with the anchor still held.
- **The notes keep their state while the fingers are down.** In the Redlines view with notes, the rail stays as it was when the pinch began: notes beside the column stay beside it, and dots stay dots, whatever the size. Beside the notes, the column grows until it and the notes meet the margins; past that the notes, which grow with the text, take width from it, its lines rewrap at each frame, and it may go below two-thirds of its measure.
- **Where the fingers stop is the size.** Nothing snaps to the ladder when they lift.
- **At a limit,** the size stops; reversing the fingers moves it at once, as today.
- **When the fingers lift** (`gestureend`, the window losing the focus, or the wheel quiet for 250 ms), the rail's rule (The rail beside it) applies once, so the notes may go to dots or come back, and the column then rewraps once; the size is saved, the other windows take it, Preferences shows it ("137%"), and the notice says "Text size 137%". During the pinch nothing is saved.
- Over Preferences, a pinch does nothing (and the page doesn't magnify).

**Stephan's call:** while the fingers are down in a pinch, the notes keep their state, with no switch to dots or back in mid-gesture; the rule is applied once, when the pinch ends. So the pinch never jumps under the fingers. (The builder's check set out three ways: the rule at every frame, which on a 1,470-px editor makes a pinch from 100% to 200% beside notes jump from about 840 to 1,260 px at about 185% as the rail goes to dots; the rail yielding to dots as soon as the fingers go down; or the rail keeping its state, which Stephan chose.)

**Call:** continuous and 1:1. Because today's stairs are what looks jumpy, and 1:1 is how a pinch feels in Preview, Photos and Pages.

**Call:** anchored at the pointer. Because Pages, Preview and Safari zoom about the pointer, and it is where the person is looking.

**Call:** no snap at the end. Because a snap after the fingers lift would rewrap the text once more, unasked; only the rail's rule may still rewrap once, by Stephan's call.

**Call:** saved when the fingers lift. Because saving at every frame would make every other window lay out at every frame.

**Call:** a pinch also ends when the window loses the focus. Because a gesture whose end never reached the window would otherwise leave the rail held and the size unsaved.

**Call:** each event sets the size and the anchor together, and the pinch draws no frame of its own. Because CodeMirror's measure already runs at most once a frame, and a frame of ours would hand CodeMirror the anchor one frame late, so that one frame showed the size without it.

**Call:** the host holds the rail through a pinch (`ReviewController.holdRail(true)` when the fingers go down, `holdRail(false)` when they lift, which applies the rule once). Because the pinch is the host's and the rail is the review plugin's, which can't tell a pinch from a resize.

The text size stays what it is today in every other way: one for every window, kept across launches, in Preferences › Appearance › Text size, whose stepper now also shows sizes between rungs.

## The page

### The measure and the column

The column's measure is the theme's: `--rl-column` is its width at the theme's own text size, 680 px in Default and Book and 660 px in Editorial. Measured on prose, that is about 94 characters a line in Default (Carlito at 17.5 px), 84 in Book (Gelasio at 18 px), and so about 91 in Editorial. This design keeps the measure and makes it a number of characters rather than of pixels:

- **The column is the measure times the text size,** `calc(var(--rl-column) * var(--rl-text-scale))`, centered, and no wider than the page less its margins. It grows with the text, so a line keeps its words at every size, until it meets the margins; then it stops, and the lines rewrap.
- **It doesn't grow with the window.** At 100% a wide window keeps wide margins: the measure is what reads well. Whoever wants the text to fill the page zooms the text, and the column follows. In a full-screen window 1,470 points wide (a 13-inch MacBook Air), the whole ladder up to 200% widens the column without a rewrap.
- **The least margin** on each side is 24 px times the text size above 100% (`--rl-margin`, `calc(24px * var(--rl-note-scale))`); the change bars stay 24 px left of the text.
- **The window zoom** scales all of this with everything else: the column, at 680 CSS px, is 1,020 pt at 150%, and rewraps once the page is too narrow for it.

**Call:** a measure in characters that grows with the text. Because that is #190's "first widen the column to use the page, and only then change where lines wrap", and Google Docs' pageless documents behave the same way: their text width is each viewer's, and lines adjust as you zoom.

**Call:** keep the themes' measures. Because changing a theme's line length is a separate decision.

**Call:** the least margin is 24 px, times the text size above 100%. Because 24 px is where the change bars sit today, and a 24 px margin beside 35 px text looks cramped.

### Inside the column

Everything that shapes the text inside the column is written in px times the text size: the space between blocks (the gap lines' 16, 18 and 10 px, or whatever the block-editing design draws them with), the 6 px between list items, the quote's 18 px padding, the code block's 16 px, the table cells' 10 and 16 px and its box's 6 px, the 6 px around an image on its own line, the column's 32 px top padding, and images. An image is its natural width times the text size, and never wider than the column. The change bars' 2 px and 24 px, and the 24 px a table's box reaches into the margin for them, stay as they are.

**Call:** everything inside the column scales with the text. Because then a line breaks in the same place at every size while the column grows (measured: one line in 408 moved by a word, a line that was exactly full), and the page magnifies as a whole rather than as text between fixed gaps.

**Call:** written as px times the text size (`calc(16px * var(--rl-text-scale, 1))`), not in em. Because each length is then exactly today's at 100% in every theme, where an em would follow each theme's body size.

**Call:** an image takes its natural width times the text size, set when it loads. Because the preview draws `![]()` at its natural width only; written widths (`<img width>`, `{width=}`, design §5.2's image size) aren't drawn yet, and join the rule when they are.

### The rail beside it

The rail grows with the text: 248 px wide and 44 px from the column, both times the note scale. With notes to show (the Redlines view), the editor's width W decides, with C the column (the measure times the text size), R the rail and its gap, and M the least margin:

- W ≥ C + R + 2M: the column at its measure, the rail beside it, and the two centered together, as today.
- Narrower, down to ⅔C + R + 2M: the column gives up width, down to two-thirds of its measure, to keep the notes beside it; the text rewraps.
- Narrower still: the rail shrinks to dots, and the column has the page back. The 24 px against flickering at the edge stays: from dots, the notes come back only at 24 px more.

| Text size | Column fills (no notes) | Notes beside, full column | Dots below |
| --- | --- | --- | --- |
| 80% | 592 px | 884 px | 703 px |
| 100% | 728 px | 1,020 px | 793 px |
| 125% | 910 px | 1,275 px | 992 px |
| 150% | 1,092 px | 1,530 px | 1,190 px |
| 200% | 1,456 px | 2,040 px | 1,587 px |

(Editor widths in CSS px; at a window zoom, times the zoom in points.)

The rule is a pure function of the editor's width, `--rl-column`, the text size and whether the rail is dots now; the rail's measure reads the first three (`offsetWidth`, and the computed style, with 680 px and 1 where it can't), and places the rail by the content's padding and its own box. While the host holds the rail (a pinch), the measure keeps its state and only places it; letting go applies the rule once.

**Call:** the notes grow with the text. Because today at 200% a note's text, twice its size in a rail of the same width, holds a few words a line.

**Call:** the column gives up to a third of its measure before the rail goes to dots. Because one rule then holds at every size, and two-thirds of 94 characters (about 63) still reads well; at 150% on a laptop it keeps the notes beside the text instead of hiding them. At 100% this keeps the rail down to an editor of about 800 px, where design §5.7 now says 1,000. Word, too, keeps its comment balloons beside the page rather than over it.

### Raw

Raw's column, 760 px of the code font at 13.5 px, is that times the text size too, with the same margins and the same 40 px top padding times the text size.

**Call:** Raw follows the same rule. Because #190 holds in every view.

## The views and Track Changes

- **Clean and the read-only previews** (the original, one person's changes): the column and its rules, no rail.
- **Redlines:** the column, the rail's three states, change bars in the left margin, the dots in the right.
- **Raw:** its own column, as above.
- **Track Changes on or off** makes no difference. Zooming is never an edit: it writes nothing, leaves no undo step, doesn't mark the document as changed, and shows no Track Changes notice. Only Body's key moves, and the command behind it is the same.

## What the file and the outputs get

- **The file:** nothing. Zoom and text size are per-person state (format §5.6).
- **Print:** WebKit's print already ignores the window zoom (measured). The print stylesheet sets `--rl-text-scale: 1 !important` on the root (`html[data-rl-theme][data-rl-appearance]`, the element that carries the inline size and where the derived sizes are worked out), and takes away the room the rail keeps beside the column (`.rl-has-rail .cm-content`'s padding and width), so a document prints the same at every zoom and text size. Today the print stylesheet keeps the text size, so 200% prints at 200% (measured on the test page), and, by the stylesheet, a document with notes prints its column narrowed by the room the hidden rail still keeps.
- **Copy, Copy for Word, exports:** written from the Markdown and the theme's tokens, at the print scale (design §6.6), never from the sizes on screen. Copy already writes font families and no sizes (`packages/editor/src/clipboard/copy-html.ts`); the rule keeps it so for Copy for Word, `.docx`, HTML and PDF export as they come. A `.docx` gets no `w:zoom`, so Word opens it at its own.

**Call:** print and every output ignore both zooms. Because design §6.6 prints with the theme's tokens at a print scale, so the printed page looks the same for everyone.

**Call:** `!important` on the print rule's text size. Because the text size is written in the root's `style` attribute, which beats any stylesheet rule without it.

## Edge cases

- **A pinch over the sidebar or the title bar** zooms the text, anchored at the top line.
- **A pinch while a comment box has the focus** zooms the text; the box keeps the focus and its draft.
- **A pinch beside notes** keeps the rail as it was until the fingers lift (Stephan's call); a key that changes the text size applies the rule at once.
- **A zoom change during a pinch** (a key pressed with the fingers down) takes effect, and the pinch carries on from the new layout.
- **A zoom change while a comment is being written** in a note shown from its dot leaves that note open, with its draft and the keyboard.
- **⌘+ in a comment box or the find bar** zooms the window, as the menu's row does from anywhere; ⌘= reaches it through the menu, "+" through the page.
- **Very long words and URLs** at large sizes break as they do now; **tables** wider than the column scroll sideways inside it, as now.
- **A window moved to a screen with another scale** changes `devicePixelRatio` but not the zoom; nothing is re-anchored.
- **Full screen:** the same rules; the frame keeps its points though the window buttons hide.
- **Settings from an older version** have no zoom: 100%, with their text size kept. A saved text size off the ladder (from a pinch) is kept; one outside 80–200%, or not a whole percent, loads as 100%, as an invalid one does today.
- **The app's copy and the setting disagree** (the copy deleted, say): the app's level is the truth once it has one, and a page whose settings differ saves the app's. With no copy at launch, the first page to report its setting gives the app its level, and later reports change nothing.
- **A window that opens while the zoom changes** may miss the `zoom` event; WebKit's zoom reaches it anyway, and the answer to its `zoom_level` sets its `--rl-zoom`.
- **Find, the review bar and agents' runs** carry on through a zoom change; the bars place themselves again, as they do when the window resizes.

## Mechanism

### The page

| Module | Change |
| --- | --- |
| `plugins/themes/src/tokens.css` | On `[data-rl-theme]`, beside #201's tokens: `--rl-note-scale: max(1, var(--rl-text-scale, 1))` and `--rl-margin: calc(24px * var(--rl-note-scale))`; the two scaled tokens times `--rl-note-scale`, with their floors. Comments: `--rl-column` is the column at the theme's own size; a host sets `--rl-text-scale` on the theme's element or above it |
| `packages/editor/src/preview/theme.ts` | `.cm-content`: `max-width: calc(var(--rl-column) * var(--rl-text-scale, 1) + 2 * var(--rl-margin, 24px))`, side padding `var(--rl-margin, 24px)`, top padding × the text size; the gap lines, list spacing, quote, code block, table and image paddings in px × the text size |
| `packages/editor/src/preview/image.ts` | On load, the image's width is its natural width × the text size (`calc(<w>px * var(--rl-text-scale, 1))`), with `max-width: 100%` as now |
| `packages/editor/src/tracked/decorations.ts` | Raw's column and top padding × the text size, with `--rl-margin` |
| `plugins/review/src/styles.ts` | The rail's box: `max-width: calc(var(--rl-column) * var(--rl-text-scale, 1) + 2 * var(--rl-margin) + 292px * var(--rl-note-scale))` and the matching right padding; the rail, notes, cards, their controls and icons in px × `--rl-note-scale`, their text in #201's scaled tokens; the review bar, its hints and its errors in the unscaled tokens and plain px; the bar's icon-only form; cards and notes shown from their dots no wider than the window less 32 px |
| `plugins/review/src/rail.ts` | The compact rule as the inequality above, a pure function (`railCompact`); the measure reads the editor's width, `--rl-column` and the text size, and places the rail by the content's left padding and the rail's own width rather than `RAIL_WIDTH` and `COLUMN_PADDING`; a hold that keeps the state |
| `plugins/review/src/bar.ts` | Accept and Reject drop to icons, with hints, when the bar doesn't fit |
| `plugins/review/src/index.ts` | `ReviewController.holdRail(held)`, and `closePopovers()` for a zoom change |
| `plugins/agents/src/live-line.ts`, `picker.ts` | Their lengths × `--rl-note-scale`; their text keeps #201's scaled token |
| `plugins/formatting/src/index.ts` | Body: `Mod-Shift-n`, in the command, the manifest and the doc comment |
| `apps/desktop/src/text-size.ts` | The ladder (shared by both zooms); steps to the next rung above or below; the pinch: continuous size from the gesture's scale, held and re-based at the limits, rounded to 1%, with the pointer's place at its start, its end after `gestureend`, the window's `blur` or a quiet wheel |
| `apps/desktop/src/reading-place.ts` (new) | The reading place: taken (the caret's line on screen, else the top line, or the line under a point) and put back as a scroll target, for a factor of zoom |
| `apps/desktop/src/zoom.ts` (new) | The page's side of the window zoom: the level from the initialization script, `set_zoom` and `zoom_level` through the app, the `zoom` event, `--rl-zoom` on the `resize`, the steps |
| `apps/desktop/src/zoom.css` (new) | `--rl-zoom: 1` on `:root` until the page sets it; `--rl-pt`, `--rl-frame`, `--rl-size-ui-frame` and `--rl-size-ui-small-frame` |
| `apps/desktop/src/interface-text.node.test.ts` | The two frame tokens in its list, and a test of their values |
| `apps/desktop/src/settings.ts` | `zoom` (a rung, default 1); `textSize` accepts any whole percent from 80 to 200 |
| `apps/desktop/src/menu-model.ts` | The six rows, their enabled states (`MenuState` gains `zoom` and `textSize`), `MenuCommands` gains `zoomIn`, `zoomOut` and `actualSize`; told whether it is in a browser, where the zoom rows are `keyInMenuOnly` |
| `apps/desktop/src/native-menu.ts` | `installPlusKeys`: "+" with ⌘ or ⌃⌘ runs the row whose key is = with those modifiers, while it is enabled |
| `apps/desktop/src/ui/titlebar.ts` | `closeMenus()` |
| `apps/desktop/src/main.ts` | Wiring: the commands, the notices, the reading places, the pinch and the rail's hold, applying both sizes when settings change |
| `apps/desktop/src/styles.css` | The title bar, the Files control and the sidebar's head in frame units; the notice's top under the bar; menus no wider than the window less 32 px; the sidebar covering the page under 600 CSS px; in `@media print`, `--rl-text-scale: 1 !important` and no rail room |
| `apps/desktop/src/preferences/` | The Zoom stepper; `--rl-zoom` from the initialization script and the `zoom` event; the top bar in frame units; the pane scrolls when the window can't grow enough; a pinch does nothing |
| `apps/desktop/src/zoom-check.ts` (new) | The WebKit checks, debug only, as `print-check.ts` |

### The app

- `apps/desktop/src-tauri/src/zoom.rs` (new): the level (`Option<f64>`), read at setup from `zoom.json` in the app's data folder (none when missing, unreadable or not a rung) and written when it changes; the commands `set_zoom` (a rung, from a document window or Preferences, or refused) and `zoom_level` (the app's level, or the first report while it has none); for each document window and Preferences, the `zoom` event, then `set_zoom`; the initialization script's text; Preferences' frame, `preferences_frame(zoom, current, work_area)`, 560 × 400 × the zoom within the work area, kept to its top edge and middle, then moved inside it.
- `windows.rs` (`build_window`) and `lib.rs` (`open_preferences`) add the initialization script to the builder and call `zoom::apply` right after `build()`; `open_preferences` builds at the zoomed size (`inner_size`) so it never resizes in view.
- No new permissions: the app's commands need none, events are in `core:default`, and the app sets the zoom itself.

### CodeMirror

- `posAtCoords` for the pinch's anchor; `coordsAtPos` for the caret's line; `lineBlockAtHeight` and `lineBlockAt` for the top line and for the line at a point outside the text.
- `EditorView.scrollIntoView(pos, { y: 'start', yMargin })` to put a place back: `yMargin` is its old distance from the scroller's top, in points, divided by the new zoom (for Text Zoom, its old distance in px), kept under the scroller's height less a line. It is dispatched with the size change, never from an animation-frame callback, so CodeMirror's next measure lays out and scrolls in one frame.
- `requestMeasure` after a size change that brings no scroll target, as now; `EditorView.baseTheme` for every rule above.

## Measured

A WKWebView in a scratch `osascript` process, never shown, on macOS 27.0.1 with a 2× display: a page laid out with the editor's column rules in Carlito on the prose of design.md §5–6, and CodeMirror 6.43.14 (bundled, with line wrapping and the column's theme) on design.md itself, 91 KB. The scripts stay out of the repo.

| What | Result |
| --- | --- |
| `innerWidth` and `devicePixelRatio` of a 1200-pt window at page zoom 0.8, 1, 1.5, 2 | 1500 and 1.6, 1200 and 2, 800 and 3, 600 and 4; a `resize` at each change |
| A zoom set before load; after a reload | Holds; holds |
| Print to PDF at zoom 1 and 2 | 15 pages both; the same glyph heights and the same first line |
| Print at text size 2 | 58 pages at twice the glyph size |
| CodeMirror's `posAtCoords` ∘ `coordsAtPos` at zoom 1, 1.5, 2 | Exact at every sampled position |
| Characters a full line, 680 px | 93.8 (Carlito 17.5 px), 83.6 (Gelasio 18 px) |
| Line breaks with the column × the text size, 1800-px window, sizes 1.1 to 2.5 | 408 lines at every size; one line, exactly full at 1, breaks a word earlier at the others |
| Restyle and layout after a size step, 37,000 characters all laid out | Median about 1 ms, 90th percentile 5 ms, at most 12 ms |
| A pinch frame in CodeMirror (size, measure, anchor), 60 steps of 1%, at zoom 1, 1.5, 2 | Median 1–2 ms, 90th percentile 2 ms, at most 4 ms; the anchored line within 1.3 px |
| WebKit's `min()`/`max()` in `calc()` and division by a custom property | Computed as designed |

The CodeMirror numbers have none of Redlines' decorations, the rail or the cards, so they are a floor; the budget below leaves room for them.

## Changes to design.md, format.md and the README

- **design.md §5.1,** the Text size bullet becomes: "**Zoom and text size.** View › Zoom In (⌘=, or ⌘+), Zoom Out (⌘-) and Actual Size (⌘0) zoom everything Redlines draws in its windows, from 80% to 200%: the page and its notes, cards, bars, menus, notices, notifications, the sidebar and Preferences. The title bar keeps its place beside the window buttons, and its icons and name grow up to 150%; the menu bar, context menus and the system's dialogs keep the system's size. Text Zoom changes only the document's text and the notes and cards on it, from 80% to 200%: a pinch follows the fingers and keeps the line under the pointer in place, and Larger Text (⌃⌘=), Smaller Text (⌃⌘-) and Actual Text Size (⌃⌘0) step the same sizes. The notes and cards grow with the text above 100% and never go below their size at 100%. The text column grows with the text until it meets the margins, and only then do lines rewrap. Both are each person's, for every window, kept across launches; neither reaches the file, a print, the clipboard or an export." The Preferences bullet: "Appearance (Match System, Light or Dark, the theme, zoom and text size)".
- **§5.7,** the rail's narrow window: "When the rail shows, the column moves left, so that column and rail together stay centered, and the notes grow with the text size as the text does. Where the window can't hold both, the column gives up to a third of its width to keep the notes beside it; below that, the rail shrinks to icons. During a pinch the rail keeps its state until the fingers lift."
- **§5.9,** the table: Body, Heading 1 to 6 are ⇧⌘N and ⌘1 to ⌘6 (Ctrl+Shift+N and Ctrl+1 to Ctrl+6); a row "Zoom in, zoom out, actual size: ⌘=, ⌘- and ⌘0 (Ctrl+=, Ctrl+- and Ctrl+0)"; the text size row becomes "Larger, smaller, actual text size: ⌃⌘=, ⌃⌘- and ⌃⌘0, or a pinch (a pinch)".
- **§5.12,** Could: "reading settings per viewer (a reading width, a dark page)", since the text size exists.
- **§6.6,** the default look: "a centered column of about 94 characters a line (680 px at the theme's own size), which grows with the text size until it meets the margins"; the floor's bullet adds "View › Zoom Out below 100% makes all of it smaller, as the person asks"; and "Print, PDF and Copy for Word use the same tokens, with a print scale (body text at 11 pt), and never the window's zoom or the text size, so they look like the screen."
- **§11,** per-person state: "view, mode, zoom and text size, filters, comment drafts, folds, the last version each person saw, and presence".
- **format.md §5.6,** the same list: "view, mode, zoom and text size, filters, comment drafts, folds, the last version someone saw, and presence". No format behavior changes.
- **README.md,** What is in the Mac app: "⌘= and ⌘- zoom the whole window, and a pinch or ⌃⌘= and ⌃⌘- the text alone", in place of "Text size has a ladder (⌘= and ⌘-) and a pinch"; Preferences: "themes, zoom and text size".

## Tests

**Unit tests (vitest, next to the code):**

1. `text-size.test.ts`: steps from every rung and from off-ladder sizes (1.37 to 1.5 and 1.25), held at the ends; the pinch's size from a start and a scale (1 × 1.37 is 1.37; held at 0.8 and 2; reversing at a limit moves at once; whole percents); one call with the newest size for each gesture event; the end once, at `gestureend`, at `blur` and after a quiet wheel; the pointer's place at the start.
2. `reading-place.test.ts`: the caret's line when it is on screen, else the top line, else the line at a point; the scroll target's `yMargin` from the old distance and the two zooms, kept under the scroller's height.
3. `zoom.test.ts`: steps and ends; `set_zoom` asked once per change; `--rl-zoom` set from the initialization script at once, and after a `zoom` event only on the `resize` (or after half a second); the place taken on the event and put back on the `resize`; a report at load, and the app's answer saved when the settings differ.
4. `settings.test.ts`: `zoom` defaults to 1 and takes only rungs; `textSize` takes whole percents from 80 to 200 and nothing else; old settings load with 100%.
5. `menu-model.test.ts` and `native-menu.test.ts`: the View rows in order, with their accelerators and enabled states at the ends; the zoom rows `keyInMenuOnly` in a browser; "+" with ⌘ and ⌃⌘ runs Zoom In and Larger Text once, Shift or not, from any key's place, and is left alone at a limit; "=" left to the menu. `format-menu.test.ts`'s check that no key is bound twice across the menu bar and the registry covers ⌘0, ⇧⌘N and the ⌃⌘ keys. The tests that pin the old keys change with them: `menu-model.test.ts`'s View rows and their clicks, `native-menu.test.ts`'s text size keys, `format-menu.test.ts`'s Paragraph rows and `plugins/formatting/src/index.test.ts`'s registration; `packages/editor/src/commands.test.ts` and `menu-model.test.ts`'s `acceleratorFor` cases use `Mod-0` only as notation, and stay.
6. `plugins/formatting` tests: Body is `Mod-Shift-n`; `Mod-0` is nobody's.
7. `panes.test.ts`: the Zoom stepper walks the ladder, asks the app and saves `zoom`, disables at the ends; Text size shows "137%" and steps from it to 150% and 125%.
8. The rail's rule as a pure function: the three states at the table's widths for 80% to 200%, and the 24 px against flicker; the hold keeps the state through widths that would change it, and letting go applies the rule once; the review bar's icon form in a narrow window (happy-dom, widths given).
9. CSS read as text or as the themes' objects (as `styles.node.test.ts` and the themes' test do): the column's, Raw's and the rail box's formulas; every length in the notes' and cards' rules × the note scale, and none in the review bar's; the title bar and sidebar head in frame units; `@media print` sets `--rl-text-scale: 1 !important` and removes the rail's room; the derived tokens and the frame tokens worked out at sizes and zooms.
10. The clipboard: copying the welcome document at `--rl-text-scale: 2` gives the same bytes as at 1.

**The app (`cargo test`):** `zoom.json` read and written, with the missing, unreadable and off-ladder cases (as `dock_icon.rs` tests `icon.json`); `set_zoom` refusing what isn't a rung and windows that aren't a document window or Preferences; `zoom_level` taking only the first report while the app has no level; the initialization script's text; `preferences_frame` within small and large work areas and at their edges; `src/zoom.ts` listening for the event the app sends.

**In WebKit (`zoom-check.ts`, like `print-check.ts`, run with `VITE_ZOOM_CHECK=1` in `pnpm tauri dev`; it asks for each zoom with the app's own `set_zoom`, so it needs no permission, and reports in the console):**

1. At zoom 0.8 to 2: CodeMirror's positions and coordinates map onto each other at every sampled position.
2. With the editor 1800 px wide, sizes 1.1 to 2: lines break where they do at 1 (at most one exact-fit line in a hundred may move a word); the column is 680 × the size; past the margins it is the page less them.
3. The rail's three states at the table's widths.
4. The reading place: across ⌘+, ⌘−, ⌘0 and the text keys, the caret's line within 2 points of where it was; across a scripted pinch, the anchor's line within 2 px; in every frame of a zoom change, the title bar's controls' middle at 26 pt.
5. A pinch frame: at most 8 ms at the 90th percentile on the welcome document, and on the long document (`packages/editor/src/preview/long-document.ts`, moved out of `long-document.test.ts`, with its 240 marks) with the rail showing.
6. By hand, from the print panel: a PDF at zoom 2 and text size 2 matches one at 100% and 100%, page for page.
7. At 360 × 240 CSS px (the smallest window at 200%) every surface fits: title bar, review bar, sidebar, cards, find bar, notices, notifications, menus.

**Call:** check 6 is made by hand, from the print panel, not by a debug command that prints without it. Because the stylesheet's rule is tested as text, WebKit's print was measured to ignore page zoom, and printing without the panel would need Objective-C written for this one check.

**Call:** the long document moves into a module of its own, which the test and the check both import. Because a test file runs its tests when it is imported, and the editor package exports no fixtures.

**By hand, in a build:** the pinch with fingers on a real trackpad, on a document with notes on a laptop (Stephan, before it merges, as for v0.2's pinch); ⌘+ as ⇧⌘= on a US layout and as the + key on a German one, each zooming once, and ⌃⌘+ the same; a new window opening at 150% with no frame at 100%; the title bar's icons on the window buttons' line from 80% to 200%, with no frame out of line at a change; Preferences at 200% on a 13-inch screen, and low on the screen; VoiceOver reading "Zoom 125%".

## Stages

Each stage is shippable alone and leaves design.md true.

| Stage | Work | Worth on its own |
| --- | --- | --- |
| **1. The page grows with the text** (#190) | The derived tokens on #201's; the column, margins and inner lengths × the text size; images; Raw; the rail and cards × the note scale; the rail's two-thirds rule; the review bar off Text Zoom; print at 100%; design §5.7 and §6.6 | Today's keys and pinch already widen the column first, and print no longer carries the text size |
| **2. Zoom the window** (#189) | `zoom` in settings and `zoom.rs`; the six View rows and keys, and "+"; Body to ⇧⌘N; the notices; frame units and tokens for the title bar, sidebar head and Preferences' top; Preferences' size; narrow pages; the reading place; design §5.1, §5.9, §5.12, §11, format §5.6 and the README | ⌘+ zooms the whole interface, for #163's readers and #189's screens |
| **3. A fluid pinch** (#189) | The continuous pinch, anchored at the pointer, saved when the fingers lift, holding the rail; the keys and other windows' changes anchored at the caret; steps from between rungs; settings and Preferences for whole percents | The pinch Stephan asked for |

Stages 1 and 2 are independent and can go in parallel worktrees; they overlap only a little, in `styles.css` and the review plugin's styles. Stage 3 needs stage 1, without which a pinch rewraps at every frame, and stage 2's reading place.

**Coordination:** the block-editing design (#168) may redraw the space between blocks and touches the Paragraph menu: whatever draws that space uses px × the text size, and Body's key is ⇧⌘N there too.

## The calls most worth Stephan's look

1. ⌘0 becomes Actual Size, and Body moves to ⇧⌘N (Word's Normal style); ⌘1 to ⌘6 stay and toggle back to body. In a browser Body has no key.
2. Text Zoom's keys are ⌃⌘+, ⌃⌘− and ⌃⌘0, not Safari's ⌥⌘+ and ⌥⌘−, which macOS's Zoom takes when its shortcuts are on.
3. One zoom for every window, kept across launches, 80% to 200% in the same steps as the text size, and set only by the app.
4. The title bar keeps its place by the window buttons and zooms its icons and name only to 150%, because Tauri 2.12.4 can't move the buttons while the app runs.
5. The notes grow with the text, and keep their place beside it until the column would lose more than a third of its measure: about 800 px at 100%, where it is 1,000 px today. The review bar stops growing with Text Zoom. (Stephan ruled on the pinch beside them: the notes keep their state until the fingers lift.)

## To check in a build

- That a new window never shows a frame at 100% before the app's zoom lands. If one does, document windows open hidden and show themselves once styled, as Preferences does.
- That the title bar's controls don't leave the window buttons' line for a frame at a zoom change, in the window that asked and in the others.
- That ⌘+ typed as ⇧⌘= (US) and as the + key (German) reaches Zoom In once, as ⌘= does through the menu.
- That WebKit's gesture events carry `clientX` and `clientY` on a trackpad; if not, the pointer's last position is the anchor, as designed.
- Whether the Claude app keeps its zoom across launches, or zooms its own title bar: I couldn't check without driving it. This design doesn't depend on either.

## Sources

Checked Nov 10, 2026.

- **Apple:** [Pages keyboard shortcuts](https://support.apple.com/guide/pages/tanc0ffef022/mac) (Actual Size ⌘0; Zoom In ⇧⌘>, Zoom Out ⇧⌘<); [Safari: change text size](https://support.apple.com/guide/safari/ibrw1068/) (Option with View › Make Text Bigger); [Mac: Zoom settings for accessibility](https://support.apple.com/guide/mac-help/mh40579/mac) (⌥⌘=, ⌥⌘− and ⌥⌘8)
- **Google:** [Docs: pages or pageless](https://support.google.com/docs/answer/11528737) (Text Width is each viewer's; line breaks adjust as you zoom)
- **Microsoft:** Word for Mac's Normal style on ⇧⌘N ([Q&A](https://learn.microsoft.com/en-us/answers/a/11310033)); Ctrl+0 now Zoom 100% in Word on Windows ([Q&A](https://learn.microsoft.com/en-us/answers/a/11905269))
- **Tauri, as locked:** tauri 2.12.4 (`webview/mod.rs` `set_zoom`, `webview/webview_window.rs` `initialization_script`, `webview/scripts/zoom-hotkey.js`, `manager/webview.rs`, `menu/normal.rs` and `event/plugin.rs`), tauri-runtime-wry 2.12.2 (`set_traffic_light_position`, `send_user_message`), wry 0.57.0 (`wkwebview/mod.rs` `zoom` and `print_with_options`), tao 0.37.1 (`platform_impl/macos/view.rs` `inset_traffic_lights`), muda 0.20.0 (`accelerator/mod.rs`, `accelerator/macos.rs`)
