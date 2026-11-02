# Redlines

**A beautiful, free Markdown editor that shows every change.**

Status: v0.1, November 2026. There is no app to download yet, but the Mac app builds from source
([below](#run-it)). This repository holds the design, the file format, the research behind them,
the website, and the code: the format library, the editor, the review interface, the command line
and the desktop app.

1. **The most beautiful Markdown editor for Mac, Windows and Linux.** Free and open source. What
   you see is the document; Markdown syntax appears only where the caret is.
2. **Made for the documents AI writes.** Markdown is the document format of AI. Files from
   ChatGPT, Claude and agents open as beautifully rendered documents, not code, and copy and paste
   with Word, Google Docs and the web just work.
3. **See every change.** When a colleague or an AI edits your document, every change shows who
   made it, and you accept or reject it, like Track Changes in Word or Suggesting in Google Docs.
   It is all saved in the plain Markdown file.

## What a Redlines file looks like

The editor shows a document three ways. This is one short document in each.

**Redlines** shows who changed what. Ada added "new". Claude, working for Ada, replaced "March"
with "April". Bo deleted a sentence and asked a question. Each change can be accepted or rejected.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/img/view-redlines-dark.png">
  <img src="docs/img/view-redlines-light.png" width="760" alt="The Redlines view: 'new' underlined in red, 'March' struck through before 'April' in purple, a deleted sentence struck through in green, and two cards in the margin: Claude's replacement with Accept and Reject, and Bo's question.">
</picture>

**Clean** shows the document with every change accepted. GitHub, VS Code and other Markdown tools
show the same, because they hide HTML comments.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/img/view-clean-dark.png">
  <img src="docs/img/view-clean-light.png" width="760" alt="The Clean view: 'We will ship the new importer in April, after the security review.'">
</picture>

**Raw** shows the file itself. Each change is a short HTML comment with an id. Who made each change
and when, and the comment threads, are in a block at the end of the file.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/img/view-raw-dark.png">
  <img src="docs/img/view-raw-light.png" width="760" alt="The Raw view: the Markdown source with each change in a short HTML comment, followed by a YAML block that lists the people, who made each change and when, and Bo's comment.">
</picture>

## Run it

You need [Node](https://nodejs.org) 22 or later and pnpm 10.28.0 (`corepack enable` picks the
version in `package.json`). For the desktop app, also [Rust](https://rustup.rs) and, on a Mac, the
Xcode command line tools (`xcode-select --install`). From the root of a checkout:

```sh
pnpm install
```

**In a browser.** The quickest way to try the editor, with nothing native to build:

```sh
pnpm --filter @redlines/desktop dev
```

Open <http://localhost:1420>. It shows the welcome document, `sample.md`, with an edit, a
suggestion, comments and an agent's change in it. You are Ada, one of its authors, and saving
keeps the file in memory.

**The desktop app, while working on it.** It opens with an empty document; File › Open (⌘O) opens
a Markdown file.

```sh
cd apps/desktop
pnpm tauri dev
```

**Build Redlines.app.**

```sh
cd apps/desktop
pnpm tauri build --bundles app
open src-tauri/target/release/bundle/macos/Redlines.app
```

To open a file in it from the terminal: `open -a /path/to/Redlines.app plan.md`. The app follows
the system's light or dark appearance; Redlines › Settings picks the theme for each. Its icon is a
red caret on warm paper, and while the app runs, its Dock icon shows another mark of the same
family, a different one at each launch; turning off Redlines › Settings › Rotate the Dock Icon keeps
the caret. Redlines › About Redlines says which build it is: the version and, in parentheses, the
commit and the time it was built (`0.1.0-dev (1a2b3c4-20261101.1430)`); a release shows its version
and commit.

**Build the disk image.** After building Redlines.app, in `apps/desktop`:

```sh
scripts/make-dmg
```

It writes `src-tauri/target/release/bundle/dmg/Redlines_<version>_<arch>.dmg` (`--debug` packages
the debug build). The script needs Python 3, which comes with the Xcode command line tools; its
first run sets up ds_store, mac_alias and Pillow in `src-tauri/target/dmg-tools`. It checks the
image it built before it says it is done.

The image holds only Redlines and the window's layout, so its window shows Redlines and nothing
else, without a scroll bar, even in a Finder that shows hidden files: the app's icon on a white
page, circled in red pen, with "Double-click to install" under it. The window's background, the
circle and the line, is `src-tauri/dmg/background.tiff`, which the app's build puts in the app;
after a change to either, or to where the icon sits, `scripts/make-dmg --background` draws it again
(at 1x and 2x, and it checks that the circle clears the icon and its name), and the app needs
building again.

There is nothing to drag: double-click Redlines and it asks "Install Redlines in your Applications
folder?" in a small window with two buttons to press, Not Now and Install, and no window buttons
(Return is Install, and Escape is Not Now). It installs itself in the Applications folder in your
home folder, or replaces the copy that is there already, or in /Applications where you can write.
Then it opens the installed copy and ejects the image. The installed copy is taken out of the
quarantine that a downloaded image's files carry, so macOS doesn't ask about it again, and it can
update itself. A release is signed and notarized; a build of your own isn't, and Gatekeeper stops
it on a downloaded image: allow it under System Settings › Privacy & Security, with Open Anyway.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/img/v0.1/app-default-dark.png">
  <img src="docs/img/v0.1/app-default-light.png" width="760" alt="The Redlines window: the welcome document with tracked changes in the authors' colors, and notes in the right margin for Claude's change and Bo's question.">
</picture>

**Releases** are built, signed, notarized and published by a workflow when a GitHub release is
published, and installed copies update themselves quietly: [docs/releasing.md](docs/releasing.md).

**Check your changes** as CI does: `pnpm typecheck && pnpm lint && pnpm test && pnpm format:check`.

## Claude Code

Claude edits a Redlines file through the `redlines` command line, so that each edit is a tracked
suggestion in its own name, for you to accept or reject. Give Claude the skill:

```sh
mkdir -p ~/.claude/skills/redlines
cp integrations/claude-code/SKILL.md ~/.claude/skills/redlines/SKILL.md
```

The command line isn't published yet. In a checkout, run it from the root with the file's full
path, because pnpm runs from the root:

```sh
pnpm -s redlines view --review /path/to/plan.md
pnpm -s redlines str-replace /path/to/plan.md --old 'in March' --new 'in April' \
  --as claude-ada --name Claude --for ada --note 'The roadmap moved the launch'
```

With the file open in Redlines, the suggestion shows up as soon as the command writes the file:
the app reloads a file that changed on disk, and keeps your unsaved edits if you have any. The
[integrations README](integrations/README.md) has an alias for running `redlines` from any folder.

## Read this first

- **[Design](docs/design.md):** what Redlines does and how it is built.
- **[Format](docs/format.md):** how tracked changes, comments and history are stored in a Markdown
  file.
- **[Releasing](docs/releasing.md):** how a release is built, signed and published, and how the app
  updates itself.

The [research](docs/research/README.md) behind both, the [Word export](docs/word-export/README.md)
notes and the [website](website/README.md) are here too. Feedback is welcome as an issue or as a
comment on a pull request.

## License

[MIT](LICENSE).
