# Zoom and the page

*Design, Nov 10, 2026, for epic #188: #189 (⌘+ and ⌘− zoom the whole window; the pinch zooms only the text) and #190 (in a wide window, text zoom widens the column before it rewraps), fitted to #163 (a floor for interface sizes). It builds on [design.md](../../design.md) and [format.md](../../format.md), and says where it departs from them. Stephan made no calls in this round: every decision below is mine, marked **Call:** with its reason.*

## Why

Stephan, from the review of the build 10 test drive:

- #189: "Make ⌘+ and ⌘− zoom everything in the window, the interface included, as the Claude app does: it helps with visual impairment and with screens that are closer or further away. Keep the trackpad pinch for the text only (Text Zoom), and make it look more fluid than it does today."
- #190: "In a large window, even zoomed in, the text column leaves wide empty margins. Text zoom should first widen the column to use the page, and only then change where lines wrap."
- #163: "Font is very small (e.g. update dialog, preferences). Let's not equate minimalism with text that's too small to read!"

What the app does today (design §5.1, `apps/desktop/src/text-size.ts`):

- There is one size, the text size. View › Larger Text (⌘=), Smaller Text (⌘-), Actual Size (⇧⌘0) and a pinch walk a ladder of eight sizes, 80% to 200%, kept in the settings for every window.
- It multiplies the document's sizes and those of everything drawn in px × `--rl-text-scale`: the margin notes, change cards, the review bar, the agents' live line and picker. Nothing makes the title bar, sidebar, menus, notices, notifications, find bar or Preferences bigger, so #163's small text can't be made bigger at all.
- The pinch moves one rung for every 10% the fingers travel: the text jumps by 10 to 20% at a time, rewraps at each jump, and keeps no line in place.
- The column is 680 px (`--rl-column`) at every text size. At 200% it holds about 47 characters a line, in a window of any width: that is #190.
- The rail stays 248 px wide while its notes' text grows with the text size, and the review bar's words grow inside its fixed 42 px height.

## In short

Two zooms, which multiply:

| | **Zoom** (the window) | **Text Zoom** (the text) |
| --- | --- | --- |
| Changes | Everything Redlines draws in its windows: the page, notes, cards, bars, menus, notices, notifications, the sidebar, Preferences; the title bar up to 150% | The document's text and what sits on it: the notes, cards, the live line and the picker |
| Asked with | ⌘+, ⌘−, ⌘0; Preferences › Appearance › Zoom | A pinch; ⌃⌘+, ⌃⌘−, ⌃⌘0; Preferences › Appearance › Text size |
| Sizes | 80, 90, 100, 110, 125, 150, 175, 200% | The same ladder from the keys; any whole percent from 80 to 200 from a pinch |
| How | WebKit's page zoom, which the app sets on every window (Tauri's `set_zoom`) | The CSS custom property `--rl-text-scale`, as today |
| Kept | The person's, for every window, across launches | The same, as today |
| Reaches the file, print, the clipboard or an export | Never | Never |

And the page (#190): the column is a number of characters, not of pixels. It grows with the text size until it meets the margins, and only then do lines rewrap; in a wide enough window a pinch is a smooth magnification of the column. The notes beside it grow with the text too, and the column gives up to a third of its width to keep them there.

## Goals

1. ⌘+, ⌘− and ⌘0 zoom everything in every Redlines window, the interface included, for low vision and for screens near and far (#189).
2. A pinch zooms only the text, continuously, with the line under the pointer held in place (#189).
3. In a wide window, Text Zoom widens the column first and rewraps only once it meets the margins (#190).
4. Both zooms are the person's: every window opens at them, and they survive a relaunch.
5. #163's floor holds at 100%; zoom adds to it and Text Zoom never takes interface text below it.

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

**The format.** Nothing here changes the file or what any edit writes, so the format's rulings (every allowed edit reads the same in every decision order, micromark 4.0.2 as the oracle, refuse rather than repair) are untouched. The one shortcut that moves, Body Text's, runs the same command, and nothing here refuses or changes typing. A keystroke costs what it does on main: the column is CSS, and the rail's new rule lives in the measure it already makes. Format §5.6 names zoom and text size among per-person state.

**Tauri, as locked (Cargo.lock: tauri 2.12.4, tauri-runtime-wry 2.12.2, wry 0.57.0, tao 0.37.1), read in the crate sources:**

- `WebviewWindow::set_zoom(f64)` and `Webview::set_zoom` reach wry's `zoom`, which on macOS sets `-[WKWebView setPageZoom:]` (macOS 11+). There is no getter: the app keeps the level itself. From a page, `getCurrentWebview().setZoom()` needs `core:webview:allow-set-webview-zoom`.
- `zoomHotkeysEnabled` (in the window config or the builder) turns on WebView2's own zoom keys on Windows; on macOS and Linux it injects a script (`webview/scripts/zoom-hotkey.js`) that takes ⌘ with `-`, `=`, `+` and `0`, and Ctrl with the mouse wheel, steps 20% between 20% and 1000%, and keeps its level in a page variable.
- The window buttons can be placed only when a window is built (`traffic_light_position`, `"trafficLightPosition": { "x": 20, "y": 28 }` for document windows). The runtime has `set_traffic_light_position` (`WindowMessage::SetTrafficLightPosition`, tao's `set_traffic_light_inset`), but tauri 2.12.4's `Window` and `WebviewWindow` don't expose it. And tao puts the buttons back at its stored inset at every `drawRect:` and on leaving full screen, so moving them with AppKit would be undone.
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

**Accessibility.** ⌘+ to 200% with nothing cut off is WCAG's resize-text bar (1.4.4). macOS's Zoom owns ⌥⌘= and ⌥⌘− when its keyboard shortcuts are on, so those stay free. VoiceOver hears each change through the notice (`role="status"`). No animation is added, so Reduce Motion has nothing to stop.

**#163.** It sets the floor for interface sizes at 100%: nothing under 13 px except captions at 12 px. This design multiplies whatever the floor gives, and never divides it except at a window zoom below 100%, which is the person's choice.

## Zoom: the window

### Keys and menus

| View menu | Mac | Windows and Linux | Enabled |
| --- | --- | --- | --- |
| Actual Size | ⌘0 | Ctrl+0 | Except at 100% |
| Zoom In | ⌘+ (also ⌘=) | Ctrl++ (also Ctrl+=) | Below 200% |
| Zoom Out | ⌘− | Ctrl+− | Above 80% |
| Actual Text Size | ⌃⌘0 | — | Except at 100% |
| Larger Text | ⌃⌘+ (also ⌃⌘=) | — | Below 200% |
| Smaller Text | ⌃⌘− | — | Above 80% |

The View menu becomes: Clean, Redlines, Raw; Actual Size, Zoom In, Zoom Out; Actual Text Size, Larger Text, Smaller Text; Show Files, Enter Full Screen. The Window menu's Zoom (the Mac's, which resizes the window) stays where it is, as in Safari.

**Call:** ⌘+, ⌘− and ⌘0 zoom the window. Because the Claude app, Safari and Chrome do, ⌘0 is Actual Size in Pages too, and Word on Windows now maps Ctrl+0 to 100% zoom.

**Call:** Body Text moves from ⌘0 to ⇧⌘N (Ctrl+Shift+N); Heading 1 to 6 keep ⌘1 to ⌘6. Because a habit that resets the zoom must never edit the document, ⇧⌘N is Word's Normal style on the Mac (Ctrl+Shift+N on Windows), and ⌘1 to ⌘6 already toggle a heading back to body text.

**Call:** Text Zoom's keys are ⌃⌘+, ⌃⌘− and ⌃⌘0, not Safari's ⌥⌘+ and ⌥⌘− (Make Text Bigger and Smaller). Because macOS's Zoom takes ⌥⌘= and ⌥⌘− when its keyboard shortcuts are on, and the people who turn those on are the people this is for. On Windows and Linux, Ctrl+Alt is AltGr on European keyboards and Ctrl+Shift+= is Ctrl++, so Text Zoom there is the pinch (Ctrl and the wheel) and the menu.

**Call:** Apple's order and today's names: Actual Size, Zoom In, Zoom Out, as Safari lists them; Larger Text and Smaller Text as now, and Actual Text Size for the reset. Because people know the order, and the names already shipped.

**Call:** each change shows a passing notice, the slim line under the title bar that already says "Track Changes is on": "Zoom 125%", "Text size 137%". Because there is no status bar or zoom field to show the level, the two zooms need telling apart, and VoiceOver reads it.

### What it zooms

Everything Redlines draws: the page and its text, notes, cards, the review bar, the find bar, notices, notifications, the drawn View and Review menus, hover hints, the sidebar, and Preferences. At 200% each is twice its size in points and laid out afresh in a page half as wide, as a browser does. The menu bar, context menus, the system's dialogs, the About panel and the install window keep the system's size.

**Call:** the window zoom is WebKit's page zoom, which the app sets with `set_zoom`. Because it is real zoom (measured above): the CSS viewport shrinks, text stays sharp, CodeMirror's coordinates stay exact, media queries and the rail's own width rule follow by themselves, and printing ignores it.

**Call:** not `zoomHotkeysEnabled`. Because its script steps 20% from 20% to 1000%, keeps the level in the page (lost at a relaunch, different in every window), takes ⌘0 and Ctrl with the wheel (the pinch's), and needs the zoom permission in every window.

**Call:** not CSS `zoom` on the root. Because viewport units, `innerWidth` and media queries don't follow it, and CodeMirror would have to map every coordinate through it, while under page zoom its mapping is exact as it stands (measured).

### The window's frame

The title bar is part of the page, but its controls sit beside the window buttons, which Tauri 2.12.4 can't move once a window exists. So the frame keeps the geometry it has at 100%, in points, at every zoom: the bar is 52 pt tall, its controls' middle is 26 pt from the top (the window buttons' line), and Files sits 84 pt from the left, clear of the buttons. What grows is what's in it: the icons and the file name zoom with the window up to 150%, and stay at 150% above it. The same holds for the sidebar's head (52 pt, under the window buttons) and for Preferences' top bar (56 pt, its tabs on its own line). The View and Review menus that open from the bar zoom fully, like the rest of the interface.

**Call:** the frame keeps its points, and its contents zoom up to 150%. Because at 150% a 28 px button is 42 pt and still fits the 52 pt bar on the buttons' line; above that it couldn't without moving the buttons, and the menu bar and the window buttons beside it don't zoom either. A later Tauri that exposes `set_traffic_light_position` could let the whole bar zoom.

### Every window, kept

The zoom is the person's, like the theme: one level for every window, kept across launches, set in Preferences › Appearance › Zoom (a stepper like Text size's: − 100% +, with the line "Everything in Redlines' windows"). A change in any window reaches all of them at once. A new window opens at it from its first frame.

**Call:** one zoom for every window, kept. Because it is about the person's eyes and screen, not the document, and every new window should open at a size the person can read.

**Call:** 80% to 200%, in the text size's eight steps. Because those are the steps people know from browsers in that range, one ladder for both zooms is one thing to learn, 200% is WCAG's bar, and past it the smallest window's page (360 CSS px at 200%) gets too small to hold the interface.

**Call:** the app sets the zoom on every window; a window only says what the person chose. The setting lives with the others (`settings.ts`), and the window that changes it tells the app (an event, as `dock-icon.ts` tells it about the Dock icon). The app keeps a copy in its data folder (`zoom.json`, like `icon.json`), sets it on each window right after building it, before its page draws, and on every window when it changes. Because one place sets it, new windows open already zoomed, and no window needs a zoom permission (#156: each window gets only what it calls). Each page also reports its setting when it loads, so the app's copy can't drift.

**Call:** Preferences grows with the zoom, 560 × 400 pt times the zoom, keeping its top edge and its middle, and never larger than the screen's visible area; past that its pane scrolls. Document windows keep their size. Because Preferences can't be resized by hand, while growing document windows would fight the person's own sizes and tiling.

### Narrow pages

Zoom makes the page narrower: the smallest window (720 × 480 pt) at 200% is a page of 360 × 240 CSS px. Every window works at that size:

- the title bar truncates the file name first; its icons keep their places;
- the column is the page less its margins, with the rail as dots (below);
- the review bar shows Accept and Reject as icons, with their names in their hints, when the whole bar doesn't fit the window less 16 px on each side;
- the sidebar covers the left of the page instead of pushing it when the page beside it would be narrower than 360 CSS px, and closes when a document is chosen in it;
- cards, notes shown from their dots, notices, notifications, menus and the find bar are never wider than the window less 16 px on each side (the find bar and notifications already are).

**Call:** the page holds down to 360 × 240 CSS px. Because real zoom makes pages that narrow, and the same rules serve the editor embedded in a narrow pane.

### The reading place

Zoom rewraps the text, so a window would lose its place without an anchor. When the zoom changes, each window keeps its reading place: the caret's line, when the caret is on screen, stays at the same height on the screen, in points; otherwise the line at the top stays at the top. The window where the change was made takes its anchor before asking the app; the others take theirs from CodeMirror's height map, which still holds the old layout until CodeMirror measures again, and put it back once it has. Drawn menus, pinned cards and notes opened from their dots close at a zoom change.

**Call:** keep the caret's line, else the top line. Because the caret is where the person works, and the top line is what CodeMirror keeps on its own.

**Call:** drawn menus, pinned cards and notes opened from their dots close at a zoom change. Because their places were measured for the old layout, and a zoom is rare enough that reopening one costs little.

### Browsers and embedded editors

In a browser (the dev server, `pnpm dev`) the zoom is the browser's own: the three rows have `keyInMenuOnly`, so the page leaves ⌘+, ⌘− and ⌘0 to the browser, and `--rl-zoom` stays 1. The editor core never zooms its host: an app that embeds Redlines keeps its own zoom and may set `--rl-text-scale`.

**Call:** the window zoom belongs to the desktop app. Because a page can't zoom its browser, and an embedded editor must not zoom the app around it.

## Text Zoom: the text

### What it scales

The document's text in every view, and what sits on the text: the rail's notes and their boxes, change cards, the live line and the @ picker in a thread. Not the review bar, find bar, menus, notices, notifications, sidebar, title bar or Preferences: they follow the window zoom alone.

**Call:** the review bar stops growing with Text Zoom. Because it is a control at the foot of the window, not part of the page, and today its words outgrow its fixed height.

**Call:** notes and cards grow with the text above 100%, and stay at their own size below (`--rl-note-scale: max(1, var(--rl-text-scale))`). Because a note at 80% would fall under #163's floor and cramp its rail; Text Zoom never takes interface text under the floor.

### The keys

Larger Text and Smaller Text step to the next size on the ladder above or below the current one, also from a size a pinch left between two (137% steps to 150% or 125%); Actual Text Size goes back to 100%. Each keeps the caret's line where it is on the screen when the caret is on screen, else the top line, and shows "Text size 150%".

**Call:** step to the next rung above or below. Because today's rule, a step from the nearest rung, would sometimes skip a rung from a size between two.

### The pinch

- **It follows the fingers.** The size is the size when the pinch began times the gesture's scale, held between 80% and 200%, to the nearest 1%. WKWebView sends `gesturestart`, `gesturechange` and `gestureend` with a scale; other webviews send a wheel with Ctrl held, and its ticks multiply into a scale, as today.
- **At most once a frame.** Events are gathered, and the newest size is applied in the next animation frame.
- **The line under the pointer stays put.** When the pinch begins, the document position under the pointer is the anchor (the gesture event's `clientX` and `clientY`, else the pointer's last position). Over the margins or the rail it is the line at that height; outside the editor, the line at the top. Every frame puts the anchor's line back at its height on the screen.
- **Nothing rewraps while the column can grow.** In a wide enough window the lines keep their breaks (The page, below), so the pinch looks like a smooth magnification of the column about the pointer's line. Once the column meets the margins, lines rewrap at each frame, with the anchor still held.
- **Where the fingers stop is the size.** Nothing snaps to the ladder when they lift.
- **At a limit,** the size stops; reversing the fingers moves it at once, as today.
- **When the fingers lift** (`gestureend`, or the wheel quiet for 250 ms), the size is saved, the other windows take it, Preferences shows it ("137%"), and the notice says "Text size 137%". During the pinch nothing is saved.
- Over Preferences, a pinch does nothing (and the page doesn't magnify).

**Call:** continuous and 1:1. Because today's stairs are what looks jumpy, and 1:1 is how a pinch feels in Preview, Photos and Pages.

**Call:** anchored at the pointer. Because Pages, Preview and Safari zoom about the pointer, and it is where the person is looking.

**Call:** no snap at the end. Because a snap after the fingers lift would rewrap the text once more, unasked.

**Call:** saved when the fingers lift. Because saving at every frame would make every other window lay out at every frame.

The text size stays what it is today in every other way: one for every window, kept across launches, in Preferences › Appearance › Text size, whose stepper now also shows sizes between rungs.

## The page

### The measure and the column

The column's measure is the theme's: `--rl-column` is its width at the theme's own text size, 680 px in Default and Book and 660 px in Editorial. Measured on prose, that is about 94 characters a line in Default (Carlito at 17.5 px), 84 in Book (Gelasio at 18 px), and so about 91 in Editorial. This design keeps the measure and makes it a number of characters rather than of pixels:

- **The column is the measure times the text size,** `calc(var(--rl-column) * var(--rl-text-scale))`, centered, and no wider than the page less its margins. It grows with the text, so a line keeps its words at every size, until it meets the margins; then it stops, and the lines rewrap.
- **It doesn't grow with the window.** At 100% a wide window keeps wide margins: the measure is what reads well. Whoever wants the text to fill the page zooms the text, and the column follows. In a full-screen window 1,470 points wide (a 13-inch MacBook Air), the whole ladder up to 200% widens the column without a rewrap.
- **The least margin** on each side is 24 px times the text size above 100% (`--rl-margin`); the change bars stay 24 px left of the text.
- **The window zoom** scales all of this with everything else: the column, at 680 CSS px, is 1,020 pt at 150%, and rewraps once the page is too narrow for it.

**Call:** a measure in characters that grows with the text. Because that is #190's "first widen the column to use the page, and only then change where lines wrap", and Google Docs' pageless documents behave the same way: their text width is each viewer's, and lines adjust as you zoom.

**Call:** keep the themes' measures. Because changing a theme's line length is a separate decision.

**Call:** the least margin is 24 px, times the text size above 100%. Because 24 px is where the change bars sit today, and a 24 px margin beside 35 px text looks cramped.

### Inside the column

Everything that shapes the text inside the column is written in em, or in px times the text size: the space between blocks (the gap lines' 16, 18 and 10 px, or whatever the block-editing design draws them with), the 6 px between list items, the quote's 18 px padding, the code block's 16 px, the table cells' 10 and 16 px, the column's 32 px top padding, and images. An image is its written width (`<img width>`, `{width=}`) or else its natural width, times the text size, and never wider than the column. The change bars' 2 px and 24 px stay as they are.

**Call:** everything inside the column scales with the text. Because then a line breaks in the same place at every size while the column grows (measured: one line in 408 moved by a word, a line that was exactly full), and the page magnifies as a whole rather than as text between fixed gaps.

### The rail beside it

The rail grows with the text: 248 px wide and 44 px from the column, both times the note scale. With notes to show (the Redlines view), the editor's width W decides, with C the column (the measure times the text size), R the rail and its gap, and M the least margin:

- W ≥ C + R + 2M: the column at its measure, the rail beside it, and the two centered together, as today.
- Narrower, down to ⅔C + R + 2M: the column gives up width, down to two-thirds of its measure, to keep the notes beside it; the text rewraps.
- Narrower still: the rail shrinks to dots, and the column has the page back. The 24 px margin against flickering at the edge stays.

| Text size | Column fills (no notes) | Notes beside, full column | Dots below |
| --- | --- | --- | --- |
| 80% | 592 px | 884 px | 703 px |
| 100% | 728 px | 1,020 px | 793 px |
| 125% | 910 px | 1,275 px | 992 px |
| 150% | 1,092 px | 1,530 px | 1,190 px |
| 200% | 1,456 px | 2,040 px | 1,587 px |

(Editor widths in CSS px; at a window zoom, times the zoom in points.)

**Call:** the notes grow with the text. Because today at 200% a note's text, twice its size in a rail of the same width, holds a few words a line.

**Call:** the column gives up to a third of its measure before the rail goes to dots. Because one rule then holds at every size, and two-thirds of 94 characters (about 63) still reads well; at 150% on a laptop it keeps the notes beside the text instead of hiding them. At 100% this keeps the rail down to an editor of about 800 px, where design §5.7 now says 1,000. Word, too, keeps its comment balloons beside the page rather than over it.

### Raw

Raw's column, 760 px of the code font at 13.5 px, is that times the text size too, with the same margins and the same 40 px top padding times the text size.

**Call:** Raw follows the same rule. Because #190 holds in every view.

## The views and Track Changes

- **Clean and the read-only previews** (the original, one person's changes): the column and its rules, no rail.
- **Redlines:** the column, the rail's three states, change bars in the left margin, the dots in the right.
- **Raw:** its own column, as above.
- **Track Changes on or off** makes no difference. Zooming is never an edit: it writes nothing, leaves no undo step, doesn't mark the document as changed, and shows no Track Changes notice. Only Body Text's key moves, and the command behind it is the same.

## What the file and the outputs get

- **The file:** nothing. Zoom and text size are per-person state (format §5.6).
- **Print:** WebKit's print already ignores the window zoom (measured). The print stylesheet sets `--rl-text-scale: 1` and takes away the room the rail keeps beside the column (`.rl-has-rail .cm-content`'s padding), so a document prints the same at every zoom and text size. Today the print stylesheet keeps the text size, so 200% prints at 200% (measured on the test page), and, by the stylesheet, a document with notes prints its column narrowed by the room the hidden rail still keeps.
- **Copy, Copy for Word, exports:** written from the Markdown and the theme's tokens, at the print scale (design §6.6), never from the sizes on screen. Copy already writes font families and no sizes (`packages/editor/src/clipboard/copy-html.ts`); the rule keeps it so for Copy for Word, `.docx`, HTML and PDF export as they come. A `.docx` gets no `w:zoom`, so Word opens it at its own.

**Call:** print and every output ignore both zooms. Because design §6.6 prints with the theme's tokens at a print scale, so the printed page looks the same for everyone.

## Edge cases

- **A pinch over the sidebar or the title bar** zooms the text, anchored at the top line.
- **A pinch while a comment box has the focus** zooms the text; the box keeps the focus and its draft.
- **A zoom change during a pinch** (a key pressed with the fingers down) takes effect, and the pinch carries on from the new layout.
- **Very long words and URLs** at large sizes break as they do now; **tables** wider than the column scroll sideways inside it, as now.
- **A window moved to a screen with another scale** changes `devicePixelRatio` but not the zoom; nothing is re-anchored.
- **Full screen:** the same rules; the frame keeps its points though the window buttons hide.
- **Settings from an older version** have no zoom: 100%. A saved text size off the ladder (from a pinch) is kept; one outside 80–200% loads as 100%, as an invalid one does today.
- **The app's copy and the setting disagree** (the copy deleted, say): the first page to load reports its setting, and the app takes it.
- **Find, the review bar and agents' runs** carry on through a zoom change; the bars place themselves again, as they do when the window resizes.

## Mechanism

### The page

| Module | Change |
| --- | --- |
| `plugins/themes/src/tokens.css` | Beside `--rl-text-scale: 1` on `:root`, the person's other derived units: `--rl-note-scale: max(1, var(--rl-text-scale))` and `--rl-margin: calc(24px * max(1, var(--rl-text-scale)))`. A comment says `--rl-column` is the column at the theme's own size |
| `packages/editor/src/preview/theme.ts` | `.cm-content`: `max-width: calc(var(--rl-column) * var(--rl-text-scale) + 2 * var(--rl-margin))`, side padding `var(--rl-margin)`, top padding × the text size; the gap lines, list spacing, quote, code block and table paddings in em or × the text size |
| `packages/editor/src/preview/image.ts` | On load, the image's width is its written or natural width × the text size (`calc(<w>px * var(--rl-text-scale))`), with `max-width: 100%` as now |
| `packages/editor/src/tracked/decorations.ts` | Raw's column and top padding × the text size, with `--rl-margin` |
| `plugins/review/src/styles.ts` | The rail's box: `max-width: calc(var(--rl-column) * var(--rl-text-scale) + 2 * var(--rl-margin) + 292px * var(--rl-note-scale))` and the matching right padding; the rail, notes, cards and their controls in px × `--rl-note-scale`; the review bar and its hints in plain px; the bar's icon-only form; cards and popover notes no wider than the window less 32 px |
| `plugins/review/src/rail.ts` | The compact rule as the inequality above, from the editor's width, `--rl-column`, the text size and the note scale (read from the computed style in the measure it already makes); the rail's width and the column's padding read from their boxes rather than `RAIL_WIDTH` and `COLUMN_PADDING`. A pure function for the rule, for its tests |
| `plugins/review/src/bar.ts` | Accept and Reject drop to icons when the bar doesn't fit |
| `plugins/agents/src/live-line.ts`, `picker.ts` | × `--rl-note-scale` instead of the text size |
| `plugins/formatting/src/index.ts` | Body Text: `Mod-Shift-n`, in the command and the manifest |
| `apps/desktop/src/text-size.ts` | The ladder (shared by both zooms); steps to the next rung above or below; the pinch: continuous size from the gesture's scale, held and re-based at the limits, rounded to 1%, applied once a frame, the anchor taken at its start, saved at its end |
| `apps/desktop/src/zoom.ts` (new) | Steps the window zoom; sets `--rl-zoom` on the root; tells the app (`emit('zoom', level)`); takes the reading place before a change and puts it back after the `resize` the change brings; the same for the windows that learn of it from the settings |
| `apps/desktop/src/settings.ts` | `zoom` (a rung, default 1); `textSize` accepts any whole percent from 80 to 200 |
| `apps/desktop/src/menu-model.ts` | The six rows, their enabled states (`MenuState` gains `zoom` and `textSize`), `MenuCommands` gains `zoomIn`, `zoomOut` and `actualSize`; the zoom rows `keyInMenuOnly` in a browser |
| `apps/desktop/src/main.ts` | Wiring: the commands, the notices, the anchors, applying both sizes when settings change |
| `apps/desktop/src/styles.css` | `--rl-zoom: 1` on `:root` until the page sets it; `--rl-pt: calc(1px / var(--rl-zoom))` and `--rl-frame: calc(1px * min(var(--rl-zoom), 1.5) / var(--rl-zoom))`; the title bar, the Files control and the sidebar's head in them; the notice's top under the bar; the sidebar covering the page when it must; in `@media print`, `--rl-text-scale: 1` and no rail room |
| `apps/desktop/src/preferences/` | The Zoom stepper; `--rl-zoom` applied; the top bar in frame units; the pane scrolls when the window can't grow enough |

### The app

- `apps/desktop/src-tauri/src/zoom.rs` (new): the level, read at setup from `zoom.json` in the app's data folder (1 when missing, unreadable or not a rung) and written when it changes; the `zoom` event from any window (a rung, or ignored); `set_zoom` on every webview window when it changes; Preferences' size, `preferences_size(zoom, work_area)`, 560 × 400 × the zoom within the work area, kept to its top edge and middle.
- `windows.rs` (`build_window`) and `lib.rs` (`open_preferences`) call `zoom::apply` right after `build()`; `open_preferences` builds at the zoomed size (`inner_size`) so it never resizes in view.
- No new permissions: events are in `core:default`, and the app sets the zoom itself.

### CodeMirror

- `posAtCoords` for the pinch's anchor; `coordsAtPos` for the caret's line; `lineBlockAtHeight` and `lineBlockAt` for the top line and for windows whose layout changed under them.
- `EditorView.scrollIntoView(pos, { y: 'start', yMargin })` to put an anchor back: `yMargin` is the anchor's old distance from the scroller's top, in points, divided by the new zoom (for Text Zoom, its old distance in px), kept under the scroller's height less the line's.
- `requestMeasure` after each size change, as now; `EditorView.baseTheme` for every rule above.

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

## Changes to design.md and format.md

- **design.md §5.1,** the Text size bullet becomes: "**Zoom and text size.** View › Zoom In (⌘+), Zoom Out (⌘−) and Actual Size (⌘0) zoom everything Redlines draws in its windows, from 80% to 200%: the page and its notes, cards, bars, menus, notices, notifications, the sidebar and Preferences. The title bar keeps its place beside the window buttons, and its icons and name grow up to 150%; the menu bar, context menus and the system's dialogs keep the system's size. Text Zoom changes only the document's text and the notes and cards on it, from 80% to 200%: a pinch follows the fingers and keeps the line under the pointer in place, and Larger Text (⌃⌘+), Smaller Text (⌃⌘−) and Actual Text Size (⌃⌘0) step the same sizes. The text column grows with the text until it meets the margins, and only then do lines rewrap. Both are each person's, for every window, kept across launches; neither reaches the file, a print, the clipboard or an export." The Preferences bullet: "Appearance (Match System, Light or Dark, the theme, zoom and text size)".
- **§5.7,** the rail's narrow window: "When the rail shows, the column moves left, so that column and rail together stay centered, and the notes grow with the text size as the text does. Where the window can't hold both, the column gives up to a third of its width to keep the notes beside it; below that, the rail shrinks to icons."
- **§5.9,** the table: Body, Heading 1 to 6 are ⇧⌘N and ⌘1 to ⌘6 (Ctrl+Shift+N and Ctrl+1 to Ctrl+6); a row "Zoom in, zoom out, actual size: ⌘+, ⌘− and ⌘0 (Ctrl++, Ctrl+− and Ctrl+0)"; the text size row becomes "Larger, smaller, actual text size: ⌃⌘+, ⌃⌘− and ⌃⌘0, or a pinch (a pinch)".
- **§5.12,** Could: "reading settings per viewer (a reading width, a dark page)", since the text size exists.
- **§6.6,** the default look: "a centered column of about 94 characters a line (680 px at the theme's own size), which grows with the text size until it meets the margins"; and "Print, PDF and Copy for Word use the same tokens, with a print scale (body text at 11 pt), and never the window's zoom or the text size, so they look like the screen."
- **§11,** per-person state: "view, mode, zoom and text size, filters, comment drafts, folds, the last version each person saw, and presence".
- **format.md §5.6,** the same list: "view, mode, zoom and text size, filters, comment drafts, folds, the last version someone saw, and presence". No format behavior changes.

## Tests

**Unit tests (vitest, next to the code):**

1. `text-size.test.ts`: steps from every rung and from off-ladder sizes (1.37 to 1.5 and 1.25), held at the ends; the pinch's size from a start and a scale (1 × 1.37 is 1.37; held at 0.8 and 2; reversing at a limit moves at once; whole percents); one size applied per animation frame with a fake `requestAnimationFrame`; saved once, at `gestureend` and after a quiet wheel; the anchor point taken at the start.
2. `zoom.test.ts`: steps and ends; `--rl-zoom` set; one report per change; the anchor's new `yMargin` from its old distance and the two zooms.
3. `settings.test.ts`: `zoom` defaults to 1 and takes only rungs; `textSize` takes whole percents from 80 to 200 and nothing else; old settings load with 100%.
4. `menu-model.test.ts`: the View rows in order, with their accelerators and enabled states at the ends; the zoom rows `keyInMenuOnly` in a browser; no key twice across the menu bar and the registry's commands (⌘0, ⇧⌘N and the ⌃⌘ keys taken once).
5. `plugins/formatting` tests: Body Text is `Mod-Shift-n`; `Mod-0` is nobody's.
6. `panes.test.ts`: the Zoom stepper walks the ladder, saves `zoom`, disables at the ends; Text size shows "137%".
7. The rail's rule as a pure function: the three states at the table's widths for 80% to 200%, and the 24 px against flicker; the review bar's icon form in a narrow window (happy-dom, widths given).
8. CSS read as text (as `styles.node.test.ts` does): the column's, Raw's and the rail box's formulas; the title bar and sidebar head in frame units; `@media print` sets `--rl-text-scale: 1` and removes the rail's room.
9. The clipboard: copying the welcome document at `--rl-text-scale: 2` gives the same bytes as at 1.

**The app (`cargo test`):** `zoom.json` read and written, with the missing, unreadable and off-ladder cases (as `dock_icon.rs` tests `icon.json`); `preferences_size` within small and large work areas; the event's payload checked.

**In WebKit (a `zoom-check.ts` like `print-check.ts`, run with `VITE_ZOOM_CHECK=1` in `pnpm tauri dev`, and the scratch harness for the window zoom):**

1. At zoom 0.8 to 2: CodeMirror's positions and coordinates map onto each other at every sampled position.
2. In an 1800-px window, sizes 1.1 to 2: lines break where they do at 1 (at most one exact-fit line in a hundred may move a word); the column is 680 × the size; past the margins it is the page less them.
3. The rail's three states at the table's widths.
4. The reading place: across ⌘+, ⌘−, ⌘0 and the text keys, the caret's line within 2 points of where it was; across a scripted pinch, the anchor's line within 2 px.
5. A pinch frame: at most 8 ms at the 90th percentile on the welcome document, and on the long-document fixture with its 200 marks and the rail showing.
6. Print: a PDF at zoom 2 and text size 2 matches one at 100% and 100%, page for page.
7. At 360 × 240 CSS px every surface fits: title bar, review bar, sidebar, cards, find bar, notices, notifications, menus.

**By hand, in a build:** the pinch with fingers on a real trackpad (Stephan, before it merges, as for v0.2's pinch); a new window opening at 150% with no frame at 100%; the title bar's icons on the window buttons' line from 80% to 200%; Preferences at 200% on a 13-inch screen; VoiceOver reading "Zoom 125%".

## Stages

Each stage is shippable alone and leaves design.md true.

| Stage | Work | Worth on its own |
| --- | --- | --- |
| **1. The page grows with the text** (#190) | The column, margins and inner lengths × the text size; images; Raw; the rail and cards × the note scale; the rail's two-thirds rule; the review bar off Text Zoom; print at 100%; design §5.7 and §6.6 | Today's keys and pinch already widen the column first, and print no longer carries the text size |
| **2. Zoom the window** (#189) | `zoom` in settings and `zoom.rs`; the six View rows and keys; Body Text to ⇧⌘N; the notices; frame units for the title bar, sidebar head and Preferences' top; Preferences' size; narrow pages; the reading place; design §5.1, §5.9, §5.12, §11 and format §5.6 | ⌘+ zooms the whole interface, for #163's readers and #189's screens |
| **3. A fluid pinch** (#189) | The continuous pinch, once a frame, anchored at the pointer, saved when the fingers lift; the keys anchored at the caret; steps from between rungs; settings and Preferences for whole percents | The pinch Stephan asked for |

Stages 1 and 2 are independent and can go in parallel worktrees; they overlap only a little, in `styles.css` and the review plugin's styles. Stage 3 needs stage 1, without which a pinch rewraps at every frame.

**Coordination:** the block-editing design (#168) may redraw the space between blocks and touches the Paragraph menu: whatever draws that space uses em or px × the text size, and Body Text's key is ⇧⌘N there too.

## The calls most worth Stephan's look

1. ⌘0 becomes Actual Size, and Body Text moves to ⇧⌘N (Word's Normal style); ⌘1 to ⌘6 stay and toggle back to body.
2. Text Zoom's keys are ⌃⌘+, ⌃⌘− and ⌃⌘0, not Safari's ⌥⌘+ and ⌥⌘−, which macOS's Zoom takes when its shortcuts are on.
3. One zoom for every window, kept across launches, 80% to 200% in the same steps as the text size.
4. The title bar keeps its place by the window buttons and zooms its icons and name only to 150%, because Tauri 2.12.4 can't move the buttons while the app runs.
5. The notes grow with the text, and keep their place beside it until the column would lose more than a third of its measure: about 800 px at 100%, where it is 1,000 px today. The review bar stops growing with Text Zoom.

## To check in a build

- That a new window never shows a frame at 100% before the app's zoom lands. If one does, document windows open hidden and show themselves once styled, as Preferences does.
- That WebKit's gesture events carry `clientX` and `clientY` on a trackpad; if not, the pointer's last position is the anchor, as designed.
- Whether the Claude app keeps its zoom across launches, or zooms its own title bar: I couldn't check without driving it. This design doesn't depend on either.

## Sources

Checked Nov 10, 2026.

- **Apple:** [Pages keyboard shortcuts](https://support.apple.com/guide/pages/tanc0ffef022/mac) (Actual Size ⌘0; Zoom In ⇧⌘>, Zoom Out ⇧⌘<); [Safari: change text size](https://support.apple.com/guide/safari/ibrw1068/) (Option with View › Make Text Bigger); [Mac: Zoom settings for accessibility](https://support.apple.com/guide/mac-help/mh40579/mac) (⌥⌘=, ⌥⌘− and ⌥⌘8)
- **Google:** [Docs: pages or pageless](https://support.google.com/docs/answer/11528737) (Text Width is each viewer's; line breaks adjust as you zoom)
- **Microsoft:** Word for Mac's Normal style on ⇧⌘N ([Q&A](https://learn.microsoft.com/en-us/answers/a/11310033)); Ctrl+0 now Zoom 100% in Word on Windows ([Q&A](https://learn.microsoft.com/en-us/answers/a/11905269))
- **Tauri, as locked:** tauri 2.12.4 (`webview/mod.rs` `set_zoom`, `webview/scripts/zoom-hotkey.js`, `manager/webview.rs`), tauri-runtime-wry 2.12.2 (`set_traffic_light_position`), wry 0.57.0 (`wkwebview/mod.rs` `zoom` and `print_with_options`), tao 0.37.1 (`platform_impl/macos/view.rs` `inset_traffic_lights`)
