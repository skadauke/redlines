# AGENTS.md

Guide for agents working in this repository.

## What this is

Redlines is a Markdown editor that shows every change (tracked changes and comments stored in the
plain `.md` file). The repo holds the design, the file format, the research behind them, the
website, and early TypeScript packages and a Tauri desktop shell. It is a pnpm workspace. Start
with [README.md](README.md), then [docs/design.md](docs/design.md) (the product and architecture)
and [docs/format.md](docs/format.md) (the file format).

## Layout

| Path                    | What it is                                                                |
| ----------------------- | ------------------------------------------------------------------------- |
| `packages/format`       | `@redlines/format`: types, ids and payload handling for the file format   |
| `packages/collab`       | `@redlines/collab`: the session authority for multiuser editing, its hub, window client and transports (live between windows of the app) |
| `packages/editor`       | `@redlines/editor`: the editor core                                       |
| `packages/plugin-api`   | `@redlines/plugin-api`: the API that plugins are written against          |
| `packages/agent-process` | `@redlines/agent-process`: what the agent providers share               |
| `packages/agent-tools`  | `@redlines/agent-tools`: the six MCP tools every agent acts through       |
| `packages/word`         | `@redlines/word`: Word (.docx) export, import and Google Docs' export normalizer; not in the editor bundle |
| `packages/cli`          | `redlines`: the command line for agents (`pnpm -s redlines` in a checkout) |
| `packages/collab-sim`   | `@redlines/collab-sim`: the session simulation harness: seeded live sessions over the real format library, with an oracle (research tooling, not shipped; `REDLINES_FUZZ=<n>` for the larger run, `pnpm --filter @redlines/collab-sim matrix` for the matrix) |
| `apps/desktop`          | `@redlines/desktop`: Tauri app (Vite frontend); Rust in `src-tauri/`      |
| `apps/desktop/redlines` | The `redlines` program in the app: Rust, QuickJS, `packages/cli` bundled  |
| `apps/desktop/quicklook` | `@redlines/quicklook`: the Quick Look preview in the app: the renderer (TypeScript, run in JavaScriptCore) and the Swift extension (`swift/`) |
| `apps/desktop/journeys` | `@redlines/journeys`: Playwright journeys in WebKit against the desktop dev page, screenshot baselines, the look review (not shipped) |
| `apps/embed-smoke`      | `@redlines/embed-smoke`: the smallest embed of the core and review, which holds the core's size (not shipped) |
| `apps/website-embed`    | `@redlines/website-embed`: the editor, review and a scripted agent, bundled for the website |
| `plugins/review`        | `@redlines/review`: margin notes, change cards and the review bar         |
| `plugins/agents`        | `@redlines/agents`: the @ picker, the runs a posted mention starts, and Ask |
| `plugins/agent-claude`  | `@redlines/agent-claude`: the Claude provider (`claude -p`)               |
| `plugins/agent-codex`   | `@redlines/agent-codex`: the Codex provider (`codex exec`)                |
| `plugins/agent-acp`     | `@redlines/agent-acp`: Agent Client Protocol agents, and OpenClaw's bridge |
| `plugins/code`          | `@redlines/code`: syntax colors in code blocks                            |
| `plugins/find`          | `@redlines/find`: find and replace                                        |
| `plugins/outline`       | `@redlines/outline`: the outline of the headings, in the left margin      |
| `plugins/themes`        | `@redlines/themes`: the built-in themes, their tokens and the fonts       |
| `plugins/formatting`    | `@redlines/formatting`: format commands, shortcuts, Format and Paragraph  |
| `plugins/tables`        | `@redlines/tables`: the Table menu and its commands, the grips and the +  |
| `plugins/emoji`         | `@redlines/emoji`: emoji shortcodes drawn as emoji, and the list after a colon |
| `plugins/sync`          | `@redlines/sync`: binds the editor to a session (pending edits, intents derived again, remote edits) |
| `plugins/toolbar`       | `@redlines/toolbar`: the toolbar, from the title bar's wrench, on right-click and from the keyboard |
| `plugins/`              | Other first-party plugins, planned (workspace members); see its README    |
| `integrations/`         | Redlines in other tools; the agent skills are written, see its README     |
| `.claude-plugin/`       | This repository as a Claude Code marketplace (`marketplace.json`)         |
| `website/`              | Next.js static site; **not** part of the pnpm workspace, uses npm         |
| `docs/`                 | Design, format spec, research, Word export, images                        |

Workspace members are `packages/*`, `plugins/*`, `apps/*`, `apps/desktop/quicklook` and
`apps/desktop/journeys` (`pnpm-workspace.yaml`). Workspace packages export their TypeScript sources; nothing is compiled
before use.

## Commands

Requires Node >=22 and pnpm 10.28.0 (`packageManager`); `.npmrc` sets `engine-strict`. Run from the
repo root.

- `pnpm install` (CI uses `pnpm install --frozen-lockfile`)
- `pnpm typecheck`: `tsc` at the root, then `pnpm -r typecheck`
- `pnpm lint`: ESLint (`eslint.config.js`)
- `pnpm test`: `vitest run`. The timing tests (the block keys' cost in `packages/editor/src/blocks/cost.test.ts`, the hidden lines' linearity in `hidden.test.ts`, the keystroke in a file without indented code in `packages/format/src/indented-code.test.ts`) run only with `REDLINES_COST=check` (CI's check job sets it on pushes to main; pull requests skip them until #432), since a busy machine can't time them. Tests are `src/**/*.test.ts` files under `apps/*`, `packages/*` and
  `plugins/*`, next to the code they test, run in Node. A test that needs a DOM starts with a
  `@vitest-environment happy-dom` comment.
- `pnpm format` / `pnpm format:check`: Prettier
- `pnpm build`: `pnpm -r build` (builds the `redlines` program and the desktop frontend; needs
  Rust)
- **Once in a new worktree, after `pnpm install`: `scripts/build-redlines` in `apps/desktop`.**
  Every `cargo` in `src-tauri` needs the program for its target, which isn't in git, and stops
  without it (`bundle.externalBin`). `pnpm build`, `pnpm tauri dev` and `pnpm tauri build` run the
  script for themselves. It bundles `packages/cli` (`pnpm --filter redlines bundle`, to
  `apps/desktop/redlines/bundle/redlines.js`), compiles the crate and copies the program to
  `src-tauri/binaries/redlines-<triple>` (Python 3; a triple as its argument, or
  `TAURI_ENV_TARGET_TRIPLE`, picks the target, and `universal-apple-darwin` makes three files)
- Desktop app, in `apps/desktop`: `pnpm dev` serves the frontend on port 1420 for a plain browser
  (it opens `src/sample.md`, signs in as Ada, keeps saves in memory and has a scripted agent in place of
  the agent programs, `src/dev-agents.ts`, which answers an Ask); `pnpm tauri dev` runs the
  app; `pnpm tauri build --bundles app` builds `src-tauri/target/release/bundle/macos/Redlines.app`,
  and then `scripts/make-dmg` (Python 3; `--debug` for the debug build) builds and checks the disk
  image `src-tauri/target/release/bundle/dmg/Redlines_<version>_<arch>.dmg`. The image's background,
  `src-tauri/dmg/background.tiff`, goes into the image as `.background/background.tiff` at the
  volume's root, where every Finder reads it (not into the app); `scripts/make-dmg --background`
  draws it again (the icon circled in red pen, and a line under it,
  from code, at 1x and 2x). Started from a mounted image, the app asks to install itself
  (`src-tauri/src/install.rs`) in a small window of its own (`install.html`, `src/install/`; the
  title is "Install Redlines" for VoiceOver, and neither it nor the window buttons are drawn), and
  takes the copy it installs out of quarantine, so that macOS doesn't translocate it and it can
  update itself; a debug build started with `REDLINES_INSTALL_ANSWER` set to `install`,
  `not-now`, `return`, `escape` or `close` answers in that window for you, for unattended checks;
  `REDLINES_QUIT_ANSWER` takes the same words for the second question, asked when the Redlines to be
  replaced is open (nothing else ever quits it)
- Journeys (`apps/desktop/journeys`, [its README](apps/desktop/journeys/README.md)): Playwright in
  WebKit drives the desktop dev page as a person does (keys, typing in bursts, paste, clicks, drags)
  and takes screenshots; they are how a change gets looked at, not only tested. Once per machine,
  `pnpm --filter @redlines/journeys exec playwright install webkit`. `pnpm journeys` runs them (it
  starts the dev server on `JOURNEYS_PORT`, 1482 unless your lane has its own port; `-g @smoke`, or a
  spec file, picks some; `JOURNEYS_PROJECTS=all` runs the four looks, light and dark at 100% and
  200% text). `j.baseline(name)` compares the window with the approved image in
  `journeys/baselines/` (at most 15 pixels differ; a failed run leaves the picture it got and a
  diff in `test-results/`), and `pnpm journeys:accept` approves changes on purpose: look at each
  changed image before you commit it. A bug that's still open is `known(issue, …)`: green while it
  stands, red when the fix lands, and `JOURNEYS_EVIDENCE=1` shows its failure. `pnpm journeys:look`
  collects a run's pictures into `journeys/look-review/INDEX.md` for the look review
  ([look-review.md](apps/desktop/journeys/look-review.md): the checklist, and how a lane uses it);
  `apps/desktop/scripts/app-windows` screenshots a built `Redlines.app`'s own windows (it needs
  Screen Recording for the terminal, once). Baselines are drawn by WebKit on macOS, as the app is;
  a journey is a `tests/*.spec.ts` file in the package (not a vitest test)
- Checks in WebKit, which happy-dom can't make: in `apps/desktop`, `VITE_BLOCK_CHECK=1 pnpm dev`
  (block editing), `VITE_TABLE_CHECK=1 pnpm dev` (tables: layout, presses, keys, typing, the
  cost of a keystroke), `VITE_STRUCK_CHECK=1 pnpm dev` (deleted and replaced blocks, the caret
  over them, their bars and cards, in Redlines and its simple look) and `VITE_PALETTE_CHECK=1 pnpm
  dev` (the toolbar's right-click and hints, and Ask's bubble, answered by the
  page's scripted agent) serve the page, and `pnpm tauri dev` runs it in WKWebView; each writes its
  results to the console and ends with a `... done <n> passed, <n> failed` line
  (`src/block-check.ts`, `src/table-check.ts`, `src/struck-check.ts`, `src/palette-check.ts`).
  `VITE_SIMPLE_CHECK=1` (the click on a change bar through real layout, `src/simple-check.ts`) is
  the same, and `VITE_ZOOM_CHECK=1` (the column and the rail at every text size, and the window
  zoom, which needs `pnpm tauri dev`; `src/zoom-check.ts`) runs in the app. `VITE_PRINT_CHECK=1`
  (`src/print-check.ts`) shows that the printed page holds the document and no mark (and, in `pnpm tauri dev` with `REDLINES_EXPORT_PDF=<path>`, writes the PDF there with no panel). They read nothing in a
  release build, and are no part of CI
- Crashes (`apps/desktop/src-tauri/src/crash.rs`, `src/crash.ts`): errors in the page, the web content
  process ending, Rust panics, the last run's macOS crash report and a page that stops answering are
  written to `crash.log` in the app's log folder (`~/Library/Logs/md.redlines.editor/crash/`, slow
  timers in `slow.log`), and a gray notification offers **Report…** (a filled-in GitHub issue with the
  build, system, trace and the document's shape, never its text) and **Reveal Log**; Help has both.
  In `pnpm tauri dev`, `__simulateFailure('throw' | 'reject' | 'hang' | 'panic' | 'terminate')` in
  the page's console makes each happen
- Recovery (`apps/desktop/src-tauri/src/recovery.rs`, `src/recovery.ts`): while a document has
  unsaved edits its window keeps a copy of the text in the app's support folder
  (`~/Library/Application Support/md.redlines.editor/recovery/`), never next to the file; saving or
  closing without saving deletes it, and so does a quit that asked about every document. A window
  that opens the document after a crash puts the edits back and says so in a notification
- The Quarto check, in `apps/desktop`: `node scripts/quarto-check.ts` (Node 24; Quarto on the PATH)
  renders a marked-up `.qmd` to HTML, Word and Typst and checks that the newest text comes out
  ([docs/research/quarto-check.md](docs/research/quarto-check.md)). CI runs it in an optional
  workflow (`quarto.yml`: the open Epic's schedule, and pull requests that touch Quarto code)
- Releases: [docs/releasing.md](docs/releasing.md). The app's version is written in one place,
  `apps/desktop/src-tauri/Cargo.toml` (`tauri.conf.json` has none, and takes Cargo's). Every build
  has a build tag, which About Redlines shows and nothing else does: `0.1.0 (1a2b3c4)` for a
  release, `0.1.0-dev (1a2b3c4-20261101.1430)` for any other build (`src-tauri/build.rs`,
  `src-tauri/src/build_tag.rs`; the release workflow sets `REDLINES_RELEASE=1` and
  `REDLINES_COMMIT`). Only a release build updates itself. The app checks, downloads and installs
  for every window, and no window owns any of it (`src-tauri/src/updates.rs`,
  `src-tauri/src/updates/checks.rs`, with the schedule's timings); a window shows what the app says
  and asks it (`src/updates.ts`, `src/update-link.ts`, `src/update-notifications.ts`), and has none
  of the updater's permissions. The updater's public key is in `tauri.conf.json`
- Rust: in `apps/desktop/src-tauri`, `cargo clippy --all-targets -- -D warnings` and `cargo test`
  (they need Tauri's Linux system libraries, see `ci.yml`, and `scripts/build-redlines` above)
- The `redlines` program: in `apps/desktop/redlines`, the same two commands. Its tests run the real
  program on real files (`tests/commands.rs`), and need the bundle: run `scripts/build-redlines`
  again after changing `packages/cli` or `packages/format`. `src/engine.rs` is the host that
  `packages/cli/src/quickjs-entry.ts` describes, and `redlines mcp --relay <socket>`
  (`src/relay.rs`) is the pipe from an agent to the app, with no JavaScript
- The skill (`integrations/skill/body.md`) is one text, and `scripts/build-skills.ts` makes its copies
  for Claude Code, Codex and OpenClaw (`integrations/*/skills/redlines/SKILL.md`), the Claude Code
  plugin's manifest and `integrations/skill/version.json`: after changing the text, or what differs
  per agent in the script, run `node scripts/build-skills.ts --write` in `apps/desktop` (Node 24)
  and commit what it wrote. `src/skills.node.test.ts` fails when a copy isn't what the source
  makes, or shows a command or option that `redlines` doesn't have, and CI runs for these files
  though they are Markdown. The app embeds the copies (`src-tauri/src/agents/skills.rs`) and
  installs them from Preferences › Agents
- The Quick Look extension (macOS only), in `apps/desktop`: `scripts/build-quicklook` bundles the
  renderer (`apps/desktop/quicklook`, with `rolldown`), compiles the Swift extension for both
  architectures with `swiftc` (no Xcode project), and writes
  `apps/desktop/quicklook/build/RedlinesPreview.appex`, signed ad hoc, or with the identity in
  `APPLE_SIGNING_IDENTITY`. `pnpm build` runs it (on a Mac it needs the Xcode command line tools, and
  on any other system it does nothing), and
  `bundle.macOS.files` in `tauri.conf.json` copies it to `Redlines.app/Contents/PlugIns`; Tauri
  signs the app and its programs but never a plug-in, so the release workflow signs the extension
  first (`--sign-only`). `scripts/build-quicklook --check` also runs the renderer in the system's
  JavaScriptCore, through `preview-render`, on `apps/desktop/quicklook/fixtures`, and reads the
  extension's layout, Info.plist, entitlements and signature; CI's `quicklook` job runs it.
  `--check-app <Redlines.app> [--signed]` checks the extension inside a built app. To see a
  preview, register the app (`lsregister -f -R -trusted`, `pluginkit -a <the .appex>`) and run
  `qlmanage -p file.md`; the steps are in [docs/releasing.md](docs/releasing.md#the-quick-look-extension).
  The renderer's tests are ordinary Vitest tests (`apps/desktop/quicklook/src`).
  The Finder thumbnails are a second extension, `RedlinesThumbnail.appex` (the same script builds,
  signs and checks both, and `--check-app` reads both). What decides the picture Finder draws for a
  `.md` file: Quick Look's thumbnail service asks every registered `com.apple.quicklook.thumbnail`
  extension whose `QLSupportedContentTypes` the file's type conforms to; if one answers, its picture
  is drawn, and the document icon of the default app (`document-types.plist`) is only what is drawn
  when none does. So with Redlines as the default app and no thumbnail extension, Finder shows
  Redlines' document icon, and with it, the page. `qlmanage -t` uses the old generators and never
  asks the extension: to see Finder's picture, ask `QLThumbnailGenerator`.
- Website: in `website/`, `npm ci`, `npm run embed` (builds the embed first), `npm test`,
  `npm run compare:check`, `npm run icons:check`, `npm run sync-release:check`, `npm run build` and
  `npm run test:e2e` (the browser smoke test of `out/`, in Chromium and WebKit) and `npm run perf`
  (after a build: the hero editor's load at 4× CPU throttling, limit 250 ms)
- The website's embed, from the root: `pnpm --filter @redlines/website-embed build` writes the bundle
  (one hashed JS file, a stylesheet, four woff2 fonts and Vite's `manifest.json`) to
  `website/public/embed/`, which git ignores; `size` builds it and holds it to
  `apps/website-embed/size-budget.json` (JS and CSS gzipped, fonts as served; CI runs it as the
  "Website embed size budget" step). Raise the budget deliberately, in a commit of its own, with
  the reason in the file's note

## CI (`.github/workflows/`)

- **Epics work on an integration branch** (#773). `epic/<issue>` starts from main; lane PRs target
  it and get the **thin** CI below; one PR from it to main, after the final sweep, gets the full
  CI and merges as a merge commit. **Thin** is `ci.yml` on a pull request (but the one from `epic/*` to main, which is full) and on
  a push to `epic/**`: typecheck, lint, format, `vitest run --changed <base>` plus the rule tests,
  and the Rust, Quick Look and journeys jobs only when their paths change (the journeys on a pull
  request by the label, as below; a push runs none). A push that makes a branch has no base, so
  it runs every test. **Full** is a push to main, and the scheduled run.
  **Which branch the scheduled run tests:** a schedule always runs main's copy of `ci.yml`, and its
  `changes` job picks the commit: the repository variable `EPIC_BRANCH` when it is set, else the one
  `epic/*` branch there is (the highest number if several; `epic/collab`, a long-lived branch,
  never), else main. Every job checks out that commit. `deploy-website.yml` and `release.yml` stay on main.
- `ci.yml`: a `changes` job (Ubuntu, no install) lists the files a change touches, against the
  pull request's base or the push's previous commit, and sets flags: `rust` (`apps/desktop/src-tauri`,
  `apps/desktop/redlines`, `packages/cli`, and on main `packages/format`), `quicklook`
  (`apps/desktop/quicklook`, `scripts/build-quicklook`, and on main `packages/format`) and `ui` (the desktop's `src` and `journeys`,
  `plugins`, `packages/editor`, `packages/format`); a change to `.github/workflows/**`, or a diff
  that can't be made, sets all. Then:
  - `check` always runs typecheck, lint, format:check and the two size budgets. **On a pull
    request** its tests are `vitest run --changed <base sha>`: the tests that import, through any
    chain, a file the PR changed (a package's dependents' among them), and all of them when a
    config or `package.json` changes, plus the tests that read the source files to hold every change
    to a rule (refusals, text contrast and sizes, styles, hints, command permissions, the skill). **On main** it runs every test, the timing tests included.
  - `desktop` (Rust: build the `redlines` program and the frontend, clippy with warnings denied,
    `cargo test` for the program and `src-tauri`) and `quicklook` (macOS) run only when their flag is
    set; otherwise the job is skipped, which counts as passing.
  **A full run** (`schedule`, `23 */2 * * *`, or `workflow_dispatch`, started by
  `gh workflow run ci.yml --ref <branch>`) sets every flag, runs every test with `REDLINES_COST=check`
  and calls `journeys.yml` (the middle tier). It has a concurrency group of its own and is never
  cancelled; a scheduled one is skipped when a finished full run, scheduled or dispatched (not
  cancelled), already tested main's head, meaning nothing has merged since. The workflow **ignores** changes that touch only `docs/**`, `website/**` or `**/*.md`, but for the
  skill's files, which a test checks. The Epic's final sweep runs everything.
- **The Mac jobs are on** (#900): the Quick Look job and the journeys run as the entries below say,
  on pull requests and on main.
- `journeys.yml`: the journeys, on a macOS runner (WebKit there is the app's engine, and the
  baselines are drawn by it), as a job of its own beside `check`: **pull requests** run it only when
  someone adds the **`journeys` label** (lanes run their journeys locally and attach screenshots;
  a push doesn't run them), and then run the smoke
  journeys and those tagged for the areas their paths touch (`journeys/src/areas.ts`), in the light
  look; **main** runs every journey in the light look and the smoke journeys in the other
  three looks from `ci.yml`'s full run every two hours, not on every push (nobody waits on it;
  a red main goes to the coordinator); **manual dispatch is the
  sweep**: every journey in all four looks. It skips docs, the website and Markdown, as `ci.yml` does (but for the sample document). Every run uploads
  `journeys-test-results` (screenshots, and the picture got, the approved one and the diff for a
  failed comparison) and `look-review` (the pictures in order, with INDEX.md).
- The `quicklook` job of `ci.yml` runs on macOS, when its flag is set (on a pull request, only for
  a change to the Quick Look code; on main, also for `packages/format`): it builds the Quick Look
  extension and checks it (`scripts/build-quicklook --check`), since no other job compiles Swift.
- `website.yml`: builds and checks the embed (its size budget and tests), runs the site's checks,
  builds `website/` (no deploy) with `REQUIRE_EMBED=1` and runs the smoke test, on changes to
  `website/**`, `apps/website-embed/**`, the icon masters, `docs/design.md`, the lockfile or the
  workflow itself, and, on main only, to the packages and plugins the embed bundles.
- `release.yml`: on a published release tagged `v<version>`, builds the universal Mac app, signs,
  notarizes and staples it and its disk image, attaches them with the update and its manifest
  (`latest.json`, written and checked by `apps/desktop/scripts/update-manifest.ts`) to the release,
  then calls `deploy-website.yml`. Manual dispatch on `main` makes a test build, attached to the
  run. Its macOS job runs in the `release` environment, whose secrets (listed at the top of the
  workflow) only `main` and `v*` tags can read. A release fails without any of them, and a test
  build without them says loudly what it lacks. Dependencies are installed and the app compiled
  before any credential is unpacked, and third-party actions are pinned to commits. It checks that
  the `redlines` program in the signed app runs with an empty environment.
- `deploy-website.yml`: builds and deploys the site to GitHub Pages. Runs on pushes to `main` that
  touch the site, the embed, the icon masters or the packages the embed bundles; when `release.yml`
  calls it; and by manual dispatch.

`.syrus.yml` mirrors the `check` job as graders (the full test run).

## Conventions

- TypeScript is strict: `tsconfig.base.json` sets `strict`, `noUncheckedIndexedAccess`,
  `noImplicitOverride`, `noFallthroughCasesInSwitch`, `verbatimModuleSyntax`, `isolatedModules` and
  `erasableSyntaxOnly` (no enums, namespaces or parameter properties), and `noEmit`. Use `import
  type` for type-only imports.
- The desktop app is checked as two programs, so that Node's types reach only the code that runs in
  Node: `tsconfig.app.json` (the page's types, no Node) and `tsconfig.node.json` (Node's types, for
  `vite.config.ts`, the release scripts in `scripts/*.ts`, which Node runs as they are, and the
  tests that read real files or run the command line). A test that
  needs Node's types is named `*.node.test.ts`, as `watch.node.test.ts` is. The desktop
  `tsconfig.json` only refers to the two, so `tsc --noEmit` run by hand in `apps/desktop` checks
  nothing: use `pnpm typecheck`.
- Prettier (`.prettierrc.json`): print width 100, single quotes. It skips `*.md`, `docs/`,
  `website/`, lockfiles and generated Tauri files (`.prettierignore`).
- `.editorconfig`: UTF-8, LF, 2-space indent (4 for `*.rs`), final newline, trimmed trailing
  whitespace (except in Markdown).
- The app's own commands are permissions: `build.rs` lists every command `generate_handler!`
  registers (`src-tauri/src/lib.rs`), and a window calls only those its capability file
  (`src-tauri/capabilities/`) grants as `allow-<command-with-dashes>`. A new command is added to
  both lists and granted to the windows whose code calls it; `src/command-permissions.node.test.ts`
  fails when a window's grants and the commands its code names (its entry point and what it
  imports) differ. Code a window shouldn't call goes in a file that window doesn't import.
- News that must not interrupt goes in a notification (`apps/desktop/src/ui/notifications.ts`):
  small cards stacked in the lower-right corner, in the theme's grays (never red), that never take
  the focus. Updates use them (`src/update-notifications.ts`); no dialog ever tells of an update.
- Interface text is never too small to read: at least 13 px, and 12 px for a caption, a timestamp
  or a hint. Give it the theme's sizes, `var(--rl-size-ui)` and `var(--rl-size-ui-small)`, or,
  where it follows the text size as the margin notes do, `var(--rl-size-ui-scaled)` and
  `var(--rl-size-ui-small-scaled)` (`plugins/themes/src/tokens.css`), or, in the title bar, the
  sidebar's head and Preferences' top bar, which keep their points at every window zoom beside
  the window buttons, `var(--rl-size-ui-frame)` and `var(--rl-size-ui-small-frame)`
  (`apps/desktop/src/zoom.css`), never a size in em or %.
  The notes' and cards' lengths are multiplied by `--rl-note-scale` (`notePx` in
  `plugins/review/src/styles.ts`), never their font sizes. Borders, focus rings, shadows and the
  review bar keep their size.
  `apps/desktop/src/interface-text.node.test.ts` reads every style source of the app and its
  plugins and holds them to it.
- **`docs/format.md` is the source of truth for `packages/format`.** If code and spec disagree,
  the spec decides; change the spec deliberately, not by accident.
- The app's icon is a red caret on warm paper, one of a family of six marks:
  `apps/desktop/src-tauri/icons/family` holds each as an SVG master and a 1024 px PNG, clear outside
  the tile. The caret is the icon the app is installed with, and the platform icons beside the
  family are generated from it. After changing a master, run `scripts/make-icons` in `apps/desktop`
  (it needs `rsvg-convert`: `brew install librsvg`). The running app shows another mark in its Dock
  at every launch (`src-tauri/src/dock_icon.rs`); it never changes the installed bundle or its
  icon, which would break the bundle's signature. The website's favicon and brand mark draw the
  same marks without the filters (`website/public/favicons`, `website/components/icons.tsx`).

## Guidance

- Keep PRs small and focused on one change.
- When you change format behavior, update `docs/format.md` (and `docs/design.md` if it describes
  the behavior) in the same PR. Before you change how an edit is written, read
  [docs/hardening.md](docs/hardening.md): the four properties the format is built to hold, what
  holds them, what is known not to hold, and how to add a rule without loosening one.
- Add or update vitest tests for new or changed behavior, next to the code.
- Run `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm format:check` before finishing. Run
  `pnpm format` to fix formatting.
