# Editor risks and the desktop shell

Status: research notes, October 2026. The risks of building the Redlines editor on CodeMirror 6,
how to contain them, and why the Mac app runs on WebKit through Tauri.

The goal is a beautiful, minimal and functional editor where the document looks like a document
and Markdown syntax appears only where the caret is. This page lists what stands between
CodeMirror 6 and that goal, and what to do about each risk.

## Method

- CodeMirror's documentation, forum and changelog, and the CodeMirror 6 packages themselves
  (`@codemirror/view` 6.43.14), installed for checks.
- Field reports from editors built on CodeMirror 6, in their issue trackers and forums.
- Electron's and Tauri's documentation and release notes.

The code and data are in the project's lab, outside this repository. The main public sources are
listed at the end.

## Why CodeMirror 6

A Markdown editor can hide syntax in two ways. It can render HTML in a `contenteditable` and keep
the Markdown markers in hidden elements, or it can keep the Markdown text and hide the markers
with decorations. The two look alike but fail in different places.

Redlines takes the second way. CodeMirror 6 is the only option that keeps the byte-exact Markdown
string as the single source of truth, and tracked changes, `@codemirror/collab` and git merges all
depend on that. The alternatives:

- ProseMirror holds a document tree, not the Markdown text, so every save would write the file
  out again from the tree instead of keeping it byte for byte.
- A custom `contenteditable` means years of caret and input-method work.

CodeMirror 6 is the right base under four conditions:

1. The editing behavior is a large layer on top of CodeMirror, not configuration.
2. Themes are written for Redlines' own DOM contract (risk 3).
3. The Mac app runs on WebKit (below).
4. Prototype tests make the final call (end of page).

## The largest risks

| #   | Risk                                               | Why it matters                                                                                                                                                                                                                                                     | Mitigation                                                                                                                                                                                                                                     |
| --- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Tables                                             | CodeMirror can't lay out editable text as a table, so every CodeMirror 6 editor uses a widget with per-cell sub-editors. One widely used table editor built this way still has corruption, undo and search bugs two years after release                            | A subsystem with its own prototype: one widget per table, one nested editor for the active cell bound to the outer document, the table key map ([tables.md](tables.md)), and tracked-change decorations in cells. The largest single work item |
| 2   | Scroll stability                                   | CodeMirror always virtualizes, and this can't be turned off. Height estimates for styled content (headings, spacing, images, math, tables) are wrong until measured, so content and the scrollbar jump. At least three CodeMirror 6 editors report it              | Spacing with padding only; measured block heights cached per file; a good `estimatedHeight` and `coordsAt` for every widget; image boxes reserved from cached sizes; a long-document scroll test                                               |
| 3   | Theme and spacing contract                         | Document styles usually space blocks with vertical margins on nested HTML. CodeMirror has one flat line per source line and forbids margins, even inside its new block wrappers                                                                                    | Redlines' own DOM contract: line classes per block type, block wrappers, hidden blank lines given the paragraph gap, and padding instead of margins. Themes are written for this contract                                                      |
| 4   | Block-editing model                                | Enter, Shift+Enter, Backspace and Tab; hidden blank lines between blocks; hidden block markers such as `##`; the moment typed syntax such as `## ` or `> ` turns into a block. All of it must be built on a line editor                                            | A block-editing layer, with keystroke scripts as its conformance suite                                                                                                                                                                         |
| 5   | Input methods next to decorations                  | Chinese, Japanese and Korean composition breaks when decorations change around it, differently in each engine. Users of a CodeMirror 6 editor reported it again in September and October 2026                                                                      | No decoration changes on the composing line until composition ends; an input-method test matrix in WebKit and Chromium                                                                                                                         |
| 6   | macOS text services                                | In Electron, system autocorrect while typing, auto-capitalization and the smart quotes set in System Settings don't work, text replacements are unreliable, and Writing Tools needs explicit wiring. In WebKit they work, but decorations near the caret interfere | Run on WebKit; enable spellcheck and autocorrect; mark code and URLs `spellcheck=false`; stop system edits from crossing marker ranges; delay decoration changes at the caret                                                                  |
| 7   | Caret and selection                                | Next to hidden syntax, CodeMirror needs its own drawn caret, which has to look like the system's. Up and Down skip block widgets. Clicks at line ends next to hidden markers are still buggy in at least one CodeMirror 6 editor in 2026                           | Draw the caret in the system `AccentColor` with the Mac blink rate; custom Up and Down that enter widgets; explicit click handling; a caret test matrix                                                                                        |
| 8   | Mac keyboard conventions                           | CodeMirror's defaults move the caret on Home and move lines on Option+Up/Down; "don't" splits into two words; a run of Chinese is one word. On the Mac, Home scrolls without moving the caret                                                                      | A macOS key map with Cocoa bindings; word motion through `Intl.Segmenter`                                                                                                                                                                      |
| 9   | Search, word count and spellcheck over hidden text | Searching the raw source finds hidden URLs, deletion payloads, mark ids and the ledger                                                                                                                                                                             | All of them run over a visible-text view with a position map                                                                                                                                                                                   |
| 10  | Rich copy and paste                                | Copying must write HTML, RTF and plain text, and pasting must turn HTML into Markdown. CodeMirror handles plain text only                                                                                                                                          | Custom clipboard handlers: HTML plus Markdown out; HTML to Markdown in ([paste.md](paste.md)); foreign `<!-- -->` stripped; a private format for copies that keep marks                                                                        |

Next in line:

- Layout shift on reveal. Showing syntax at the caret shifts the rest of the line. The editor
  accepts the shift instead of reserving room for hidden syntax, which would leave gaps in the
  text.
- Performance with many widgets.
- Export. It can't use the live DOM, because CodeMirror's DOM is partial.
- Differences between Markdown parser dialects.
- Accessibility.
- One maintainer. CodeMirror depends on one person, and its view layer was rewritten in late 2025.

## WebKit, Electron or Tauri

Tauri v2 runs the app in the system's web engine: WebKit on the Mac, WebView2 (Chromium) on Windows
and WebKitGTK on Linux. Electron ships Chromium on every platform. The difference matters most on
the Mac.

What Mac users would notice in an Electron app:

| Area                                                             | Electron compared with WebKit                                                   | Verdict                                                        |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Autocorrect while typing, auto-capitalization                    | Missing in Chromium                                                             | Real                                                           |
| Smart quotes and dashes from System Settings                     | Not from the system; must be rebuilt                                            | Real                                                           |
| Text replacements                                                | Unreliable                                                                      | Real risk                                                      |
| Grammar checking while typing                                    | Likely missing (inference)                                                      | Likely real                                                    |
| System context menu: Look Up, Translate, Services, Substitutions | Must be built by hand                                                           | Real unless rebuilt carefully                                  |
| Writing Tools (Apple Intelligence)                               | Possible since Electron 36, with extra wiring                                   | Minor if wired                                                 |
| Spelling underlines and suggestions                              | Work in Electron                                                                | "No spellcheck on Mac" is folklore                             |
| Font rendering, scrolling                                        | Very close                                                                      | Mostly folklore; the real scroll risk is CodeMirror's (risk 2) |
| Caret                                                            | Redlines draws its own in either engine                                         | Minor                                                          |
| Memory and size                                                  | Empty Tauri app on macOS ≈ 5 MB and ≈ 96 MB RAM; Electron ≈ 320 MB and ≈ 364 MB | Real on the Mac                                                |

Recommendation:

1. On the Mac, ship on WebKit, through Tauri v2. The first differences Mac users notice are system
   text features that Electron lacks: autocorrect, substitutions, grammar and the native context
   menu.
2. On Windows, Tauri uses WebView2, which is Chromium, the engine Electron ships, so nothing is
   lost there.
3. On Linux, decide with the prototype. Tauri uses WebKitGTK, the weakest WebKit port. Keep an
   Electron build for Linux behind the same `HostAdapter` if needed.
4. The costs:
   - the desktop backend is Rust, or a Node sidecar, instead of Node;
   - the test matrix spans macOS versions, because WebKit follows the OS;
   - automated tests on macOS are harder, because there is no free WKWebView WebDriver.
5. Either way, the editor package stays engine-independent and is tested on Chromium, WebKit and
   Firefox, because the embeddable component runs in any browser.

An Electron build for the Mac would need smart punctuation and text replacement rebuilt, a
hand-built context menu with Writing Tools, and a native helper for autocorrect, and Mac users
would still notice the difference.

## What this means for the design

For the design in [design.md](../design.md), these risks mean:

- HTML and PDF export come from a static renderer, not from the live DOM.
- The Mac shell is WebKit, through Tauri v2.
- Tables are their own subsystem, with their own prototype.
- Search, word count and spellcheck work on a visible-text projection that leaves out markers and
  the ledger.
- Themes are written for Redlines' own DOM contract.

## Prototype tests

1. A long document (200+ headings, 100+ images, 30+ tables, math). Scroll up, drag the scrollbar
   and jump from the outline: no visible jumps.
2. A table script: create a table, type, Tab through, add and delete rows and columns, set
   alignment, undo, type with an input method in a cell, and search inside.
3. Keystroke scripts for headings, paragraphs, lists, quotes, fences and math, including the moment
   typed syntax converts.
4. An input-method matrix next to every inline construct, in WebKit and Chromium: Pinyin, Japanese,
   Korean, dead keys, press-and-hold accents and dictation.
5. A caret matrix: arrows, clicks at line ends, Home and End, Option+arrows, double-click, and CJK
   word motion.
6. macOS services in WebKit: autocorrect, text replacement, smart quotes, and a Writing Tools
   rewrite of a paragraph that contains links and tracked changes.
7. A visual diff of a document corpus between the live editor and the static renderer, so the
   editor shows a document the way it exports.
8. Typing latency on a 500 KB document.

## Sources

- CodeMirror on
  [the viewport](https://discuss.codemirror.net/t/modifying-the-margin-viewport-from-an-external-source/8289),
  [margins](https://discuss.codemirror.net/t/how-to-set-the-line-spacing/9277/2),
  [tables](https://discuss.codemirror.net/t/cursor-changing-heights-over-widget-created-spans/9148/7)
  and [EditContext and macOS text services](https://github.com/codemirror/dev/issues/1579)
- [Electron 36's context menu](https://www.electronjs.org/blog/electron-36-0) and
  [Tauri 2.12](https://v2.tauri.app/blog/tauri-2.12/)
