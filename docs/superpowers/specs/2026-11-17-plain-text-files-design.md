# Plain text and code files, in Plain only

*Design, Nov 17, 2026, lane X of the usability Epic ([#537](https://github.com/skadauke/redlines/issues/537)),
for issue [#663](https://github.com/skadauke/redlines/issues/663). Design only: nothing is built.
It builds on [format.md](../../format.md) (§9.1 on extensions, §10 on Plain) and
[design.md](../../design.md).*

**A note on the name.** The third view was called "Raw" when #663 was written. It is "Plain" now
([#704](https://github.com/skadauke/redlines/pull/704), closing #662): the View menu, ⌥⌘3, the
hints and the docs all say Plain. The code still holds the identifier `'raw'` (`ViewMode`,
`setView('raw')`), which no one sees and no file records. This spec says Plain, and the build
keeps the identifier.

## What Stephan asked

Other text formats, `.txt` and code, open in Redlines and show only in Plain, with syntax colors.
The questions: which extensions, no Clean or Redlines view, no Track Changes and no ledger, how the
sidebar shows them, and that the colors come from `plugins/code`.

## 1. Which files

Today the app opens Markdown (`md`, `markdown`, `qmd`, `rmd`) and `txt` (`DOCUMENTS` in
`src-tauri/src/project.rs` and `DOCUMENT_EXTENSIONS` in `src/host.ts`; format §9.1). A `.txt` file
is treated as Markdown, which is wrong for most of them: `*` and `_` in a log become emphasis in
Clean, and a ledger could be written at the end.

Two classes, decided by extension (lowercase, last extension only), never by sniffing the content:

- **Markdown:** `md`, `markdown`, `qmd`, `rmd`. Unchanged: three views, Track Changes, ledger.
- **Plain-only:** the extensions below.

| Kind            | Extensions                                                                                                           |
| --------------- | -------------------------------------------------------------------------------------------------------------------- |
| Text            | `txt`, `text`, `log`                                                                                                 |
| Data and config | `json`, `jsonc`, `yaml`, `yml`, `toml`, `ini`, `cfg`, `conf`, `env`, `csv`, `tsv`, `xml`, `plist`                    |
| Web             | `html`, `htm`, `css`, `scss`, `less`, `js`, `mjs`, `cjs`, `jsx`, `ts`, `mts`, `cts`, `tsx`, `svg`                    |
| Code            | `py`, `rb`, `go`, `rs`, `swift`, `java`, `kt`, `c`, `h`, `cc`, `cpp`, `hpp`, `cs`, `php`, `lua`, `r`, `sql`, `sh`, `bash`, `zsh`, `ps1` |

Rules:

- **`.txt` moves from the Markdown class to Plain-only.** This is the one change for existing
  users: a `.txt` that opened as Markdown opens in Plain. A `.txt` that already holds a ledger
  keeps it as text (nothing reads it); Redlines never changes it.
- **Dotfiles and extensionless files** (`.gitignore`, `Makefile`, `Dockerfile`) are Plain-only
  when the grammar list names them (`LanguageDescription.matchFilename`); otherwise they are not
  listed. A file Redlines doesn't know, opened through Finder's Open With, is Plain-only with no
  colors (the safe default).
- **The list is one table.** The Rust side, the TypeScript side and the bundle's
  `document-types.plist` are tested against it, as `DOCUMENT_EXTENSIONS` and `DOCUMENTS` are today
  (a test fails when they differ).
- **Redlines isn't offered as the default app** for any of these: the plist declares them with
  `LSHandlerRank` `Alternate`, so Open With offers Redlines and nothing else changes. "Make
  Redlines the default" stays about Markdown.
- **Binary and big files.** A file with a NUL byte in its first 8 KB, or not valid UTF-8, isn't
  opened (the existing notice for an unreadable file). Above 2 MB the colors are off, and above
  20 MB the file isn't opened. The limits are constants, to be tuned by measuring.

## 2. What such a file has, and doesn't

A Plain-only file is **text in a monospace editor and nothing else**. Redlines' review is a
Markdown format; in a language where `<!--` or a comment marker means something, it would corrupt
the file.

| Feature                      | Plain-only file                                                                                                                                                                                                                      |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Views                        | Plain only. The View menu's Clean and Redlines rows, ⌥⌘1 and ⌥⌘2 are disabled (hint: "Only Markdown files have Clean and Redlines views."). The eye in the title bar shows no view rows.                                              |
| Track Changes                | Off, and can't be turned on: the pen's row and ⇧⌘E are disabled, with the reason in the hint. No pending change is ever shown.                                                                                                      |
| Comments, Ask, Accept/Reject | Disabled with the same kind of hint: Add Comment, Ask…, Accept, Reject, Highlight. Typing is untouched.                                                                                                                             |
| Ledger                       | Never written, never read. Saving writes the text exactly as it is (line endings and the final newline kept as found; format §5 is for Markdown). A literal `<!-- redlines` in a code file is code.                                  |
| Toolbar and palette          | Format, Insert, Table, List and Image are disabled. Edit (Undo, Cut, Copy, Paste, Select All, Find) works.                                                                                                                            |
| Find and Replace             | Works, as in Plain.                                                                                                                                                                                                                  |
| Outline, images, links       | Nothing is drawn: the outline is empty, images and links are text.                                                                                                                                                                   |
| Agents                       | Read and write the file as plain text. No tracked change exists, so an agent's edit is an ordinary untracked edit that Undo covers. The `redlines` command line refuses the marking commands (`comment`, `edit --track`) with "not a Markdown document" and allows plain `read` and `write`. |
| Print, Quick Look            | Print draws the colored text. Quick Look is left as it is (Markdown only).                                                                                                                                                           |

This follows the Epic's refusal policy: a command that never makes sense is **disabled with its
reason in the hint**, not refused after the click. There is no edit to widen, because nothing is
tracked.

**Where the rule lives.** One value on the document, `kind: 'markdown' | 'plain-only'`, set when
the file is opened. The editor's `setViewMode` ignores any mode but Plain when it is `plain-only`;
the commands' `isEnabled` read it; the format package is never called for such a file (no parse, no
ledger), which also makes a large file open fast.

## 3. The sidebar

The sidebar (`src/ui/sidebar.ts`, from `project.rs`) lists a project's documents. The decision:

- **It lists Plain-only files too, with the extensions above only**, so a repository's folder shows
  its code beside its notes. Nothing the list doesn't name (images, binaries, anything hidden or
  git-ignored, as now).
- **Names are shown in full, as now.** A Plain-only file's name is in the secondary ink; no tag is
  added, since the suffix says what it is.
- **A preference, "Show code and text files in the sidebar"**, in Preferences › General, on by
  default. Off hides every Plain-only file but the one open.
- The sidebar's change and comment dots are never shown for a Plain-only file.
- The Open dialog and drag and drop accept the same extensions. A link in a Markdown file to a
  Plain-only file opens it in Plain, as a link to a Markdown file opens it.

## 4. Colors, from `plugins/code`

`plugins/code` colors fenced and indented code blocks in Markdown (`codeHighlight`, `codeSpans`,
`codeStyle`, the theme's `--rl-code-*` tokens), with each grammar loaded on demand from
`@codemirror/language-data`. A Plain-only file reuses all of it:

- **Same style, same tokens**, in every theme, light and dark. No new color, so the contrast
  already checked for code blocks holds.
- **A new export, `codeFileHighlight(filename)`**, beside `codeHighlight`: it picks the grammar
  with `LanguageDescription.matchFilename(languages, name)` and, when it loads, adds the language
  and the highlight style over the whole document. Before the grammar arrives the text is
  uncolored, as a block is today. No grammar for the name, or a file over the size limit: no
  colors, still Plain.
- **`.txt`, `.log`, `.csv`** have no grammar: monospace, uncolored.
- The editor core stays free of the grammars, and the website embed's size budget is untouched:
  only the desktop app activates the plugin for files.
- **The font** is the code font at the editor's text size, with no soft wrap by default and tab
  characters kept.

## 5. Build order

1. The document kind from the extension, the shared table, and the `.txt` move (Rust and
   TypeScript, with the test that they agree and the plist test).
2. Plain-only enforcement: views, Track Changes, ledger-free save, the disabled commands and hints.
3. The sidebar rows and the preference.
4. `codeFileHighlight` in `plugins/code`.
5. Docs: format §9.1 (two classes; only Markdown has a ledger) and design.md's view section, and a
   journey with screenshots (open a `.ts` file, the colored Plain view, a disabled view row, light
   and dark).

One PR each; 1 and 2 first, since they change `.txt`.

## Rulings

- `.txt` becomes Plain-only, because a text file's `*` and `_` aren't Markdown to its author.
- Plain-only files take undo, find and an agent's plain `write`, but no marks at all.
- Redlines isn't offered as the default app for any of them.
- The sidebar shows them by default, with a switch.

## Not decided here

Soft wrap, a line-number gutter, and a language picker for an unknown extension: later, if asked.
