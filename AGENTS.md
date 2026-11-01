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
| `packages/cli`          | `redlines`: the command line for agents (`pnpm -s redlines`)              |
| `apps/desktop`          | `@redlines/desktop`: Tauri app (Vite frontend); Rust in `src-tauri/`      |
| `plugins/review`        | `@redlines/review`: margin notes, change cards and the review bar         |
| `plugins/themes`        | `@redlines/themes`: the built-in themes, their tokens and the fonts       |
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
- `pnpm build`: `pnpm -r build` (builds the desktop frontend)
- Desktop app, in `apps/desktop`: `pnpm dev` serves the frontend on port 1420 for a plain browser
  (it opens `src/sample.md`, signs in as Ada and keeps saves in memory); `pnpm tauri dev` runs the
  app; `pnpm tauri build --bundles app` builds `src-tauri/target/release/bundle/macos/Redlines.app`,
  and then `scripts/make-dmg` (Python 3; `--debug` for the debug build) builds and checks the disk
  image `src-tauri/target/release/bundle/dmg/Redlines_<version>_<arch>.dmg`. Started from a mounted
  image, the app offers to install itself (`src-tauri/src/install.rs`); a debug build started with
  `REDLINES_INSTALL_ANSWER=install` or `not-now` answers for you, for unattended checks
- Rust: in `apps/desktop/src-tauri`, `cargo clippy --all-targets -- -D warnings` and `cargo test`
  (they need Tauri's Linux system libraries, see `ci.yml`)
- Website: in `website/`, `npm ci`, `npm run sync-release:check`, `npm run build`

## CI (`.github/workflows/`)

- `ci.yml`: `check` job (install, typecheck, lint, test, format:check) and `desktop` job (build the
  desktop frontend, then clippy with warnings denied, then `cargo test`). Runs on pull requests and
  pushes to `main`, and **ignores** changes that touch only `docs/**`, `website/**` or `**/*.md`.
- `website.yml`: builds `website/` (no deploy) on changes to `website/**` or the workflow itself.
- `deploy-website.yml`: builds and deploys the site to GitHub Pages. Runs on release publish,
  `workflow_call` and manual dispatch only; not on pushes.

`.syrus.yml` mirrors the `check` job as graders.

## Conventions

- TypeScript is strict: `tsconfig.base.json` sets `strict`, `noUncheckedIndexedAccess`,
  `noImplicitOverride`, `noFallthroughCasesInSwitch`, `verbatimModuleSyntax`, `isolatedModules` and
  `erasableSyntaxOnly` (no enums, namespaces or parameter properties), and `noEmit`. Use `import
  type` for type-only imports.
- The desktop app is checked as two programs, so that Node's types reach only the code that runs in
  Node: `tsconfig.app.json` (the page's types, no Node) and `tsconfig.node.json` (Node's types, for
  `vite.config.ts` and for the tests that read real files or run the command line). A test that
  needs Node's types is named `*.node.test.ts`, as `watch.node.test.ts` is. The desktop
  `tsconfig.json` only refers to the two, so `tsc --noEmit` run by hand in `apps/desktop` checks
  nothing: use `pnpm typecheck`.
- Prettier (`.prettierrc.json`): print width 100, single quotes. It skips `*.md`, `docs/`,
  `website/`, lockfiles and generated Tauri files (`.prettierignore`).
- `.editorconfig`: UTF-8, LF, 2-space indent (4 for `*.rs`), final newline, trimmed trailing
  whitespace (except in Markdown).
- **`docs/format.md` is the source of truth for `packages/format`.** If code and spec disagree,
  the spec decides; change the spec deliberately, not by accident.

## Guidance

- Keep PRs small and focused on one change.
- When you change format behavior, update `docs/format.md` (and `docs/design.md` if it describes
  the behavior) in the same PR.
- Add or update vitest tests for new or changed behavior, next to the code.
- Run `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm format:check` before finishing. Run
  `pnpm format` to fix formatting.
