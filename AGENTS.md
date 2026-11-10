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
| `packages/editor`       | `@redlines/editor`: the editor core                                       |
| `packages/plugin-api`   | `@redlines/plugin-api`: the API that plugins are written against          |
| `packages/agent-process` | `@redlines/agent-process`: what the agent providers share               |
| `packages/agent-tools`  | `@redlines/agent-tools`: the six MCP tools every agent acts through       |
| `packages/cli`          | `redlines`: the command line for agents (`pnpm -s redlines` in a checkout) |
| `apps/desktop`          | `@redlines/desktop`: Tauri app (Vite frontend); Rust in `src-tauri/`      |
| `apps/desktop/redlines` | The `redlines` program in the app: Rust, QuickJS, `packages/cli` bundled  |
| `plugins/review`        | `@redlines/review`: margin notes, change cards and the review bar         |
| `plugins/agents`        | `@redlines/agents`: the @ picker, and the runs a posted mention starts    |
| `plugins/agent-claude`  | `@redlines/agent-claude`: the Claude provider (`claude -p`)               |
| `plugins/agent-codex`   | `@redlines/agent-codex`: the Codex provider (`codex exec`)                |
| `plugins/agent-acp`     | `@redlines/agent-acp`: any Agent Client Protocol agent the person added   |
| `plugins/code`          | `@redlines/code`: syntax colors in code blocks                            |
| `plugins/find`          | `@redlines/find`: find and replace                                        |
| `plugins/themes`        | `@redlines/themes`: the built-in themes, their tokens and the fonts       |
| `plugins/formatting`    | `@redlines/formatting`: format commands, shortcuts, Format and Paragraph  |
| `plugins/`              | Other first-party plugins, planned (workspace members); see its README    |
| `integrations/`         | Redlines in other tools; the Claude Code skill is written, see its README |
| `website/`              | Next.js static site; **not** part of the pnpm workspace, uses npm         |
| `docs/`                 | Design, format spec, research, Word export, images                        |

Workspace members are `packages/*`, `plugins/*` and `apps/*` (`pnpm-workspace.yaml`). Workspace
packages export their TypeScript sources; nothing is compiled before use.

## Commands

Requires Node >=22 and pnpm 10.28.0 (`packageManager`); `.npmrc` sets `engine-strict`. Run from the
repo root.

- `pnpm install` (CI uses `pnpm install --frozen-lockfile`)
- `pnpm typecheck`: `tsc` at the root, then `pnpm -r typecheck`
- `pnpm lint`: ESLint (`eslint.config.js`)
- `pnpm test`: `vitest run`. Tests are `src/**/*.test.ts` files under `apps/*`, `packages/*` and
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
  (it opens `src/sample.md`, signs in as Ada and keeps saves in memory); `pnpm tauri dev` runs the
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
- Website: in `website/`, `npm ci`, `npm run sync-release:check`, `npm run build`

## CI (`.github/workflows/`)

- `ci.yml`: `check` job (install, typecheck, lint, test, format:check) and `desktop` job (build the
  `redlines` program and the desktop frontend, then clippy with warnings denied and `cargo test`,
  for the program and for `src-tauri`). Runs on pull requests and pushes to `main`, and **ignores**
  changes that touch only `docs/**`, `website/**` or `**/*.md`.
- `website.yml`: builds `website/` (no deploy) on changes to `website/**` or the workflow itself.
- `release.yml`: on a published release tagged `v<version>`, builds the universal Mac app, signs,
  notarizes and staples it and its disk image, attaches them with the update and its manifest
  (`latest.json`, written and checked by `apps/desktop/scripts/update-manifest.ts`) to the release,
  then calls `deploy-website.yml`. Manual dispatch on `main` makes a test build, attached to the
  run. Its macOS job runs in the `release` environment, whose secrets (listed at the top of the
  workflow) only `main` and `v*` tags can read. A release fails without any of them, and a test
  build without them says loudly what it lacks. Dependencies are installed and the app compiled
  before any credential is unpacked, and third-party actions are pinned to commits. It checks that
  the `redlines` program in the signed app runs with an empty environment.
- `deploy-website.yml`: builds and deploys the site to GitHub Pages. Runs when `release.yml` calls
  it and by manual dispatch only; not on pushes.

`.syrus.yml` mirrors the `check` job as graders.

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
- News that must not interrupt goes in a notification (`apps/desktop/src/ui/notifications.ts`):
  small cards stacked in the lower-right corner, in the theme's grays (never red), that never take
  the focus. Updates use them (`src/update-notifications.ts`); no dialog ever tells of an update.
- Interface text is never too small to read: at least 13 px, and 12 px for a caption, a timestamp
  or a hint. Give it the theme's sizes, `var(--rl-size-ui)` and `var(--rl-size-ui-small)`, or,
  where it follows the text size as the margin notes do, `var(--rl-size-ui-scaled)` and
  `var(--rl-size-ui-small-scaled)` (`plugins/themes/src/tokens.css`), never a size in em or %.
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
  the behavior) in the same PR.
- Add or update vitest tests for new or changed behavior, next to the code.
- Run `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm format:check` before finishing. Run
  `pnpm format` to fix formatting.
