# `website/`

The product website: one static page, built with Next.js 16 (App Router, Tailwind CSS 4) as a
static export (`output: 'export'`) and served by GitHub Pages. No server runs in production.

It is its own npm project, with its own `package-lock.json` and its own tooling: `npm run build`
type-checks, and there is no separate formatter or linter yet.

## Develop

```sh
cd website
npm install
npm run dev                 # http://localhost:3000
```

## Build

```sh
npm run sync-release        # refresh lib/release.json from the latest GitHub release (network)
npm run sync-release:check  # validate the committed lib/release.json, without network
npm run build               # type-check and write the static site to out/
npx serve out               # preview the export
```

`sync-release` reads GitHub's public API; `GITHUB_TOKEN=$(gh auth token)` only lifts its rate limit.
You rarely need it locally.

## Deploy

[`deploy-website.yml`](../.github/workflows/deploy-website.yml) builds the site and deploys `out/`
to GitHub Pages. It runs:

- when the release workflow, [`release.yml`](../.github/workflows/release.yml), calls it
  (`workflow_call` with `release_tag`), once a published release has its files, so that the
  Download section shows that release;
- by hand: Actions → Deploy website → Run workflow.

It does not run on pushes to main yet: until its push trigger is added (stage 5 of the website
design), a change goes live when someone runs it.
[`website.yml`](../.github/workflows/website.yml) builds, without deploying, every pull request and
push that touches `website/`.

### One-time setup (repository admin)

1. Settings → Pages → Build and deployment → Source: **GitHub Actions**.
2. Settings → Environments → **github-pages** → Deployment branches and tags: add the tag rule
   `v*`. Release-triggered runs happen on the release's tag, which the environment blocks by
   default.

Until a custom domain is set, Pages serves the site at `https://<owner>.github.io/<repository>/`.
The workflow passes that base path to the build (`BASE_PATH`), so asset URLs work there.

### Custom domain

The site's custom domain is `www.redlines.md`. Once GitHub has issued its certificate, turn on
**Enforce HTTPS** (Settings › Pages). The build needs no change: the base path becomes `/` by
itself. Deploys from Actions ignore a `CNAME` file, but you can add `public/CNAME` to keep the
domain on record in the repository, as Syrus does.

## How it works

- **Name and repository** live in [`site.config.mjs`](site.config.mjs), the only place that spells
  them out. Changing the name there updates the page, the download file names and the release
  sync.
- **Copy** lives in [`lib/site.ts`](lib/site.ts). The illustrations (`components/hero-sheet.tsx`,
  `components/agent-demo.tsx` and the sections' sheets) hold their own sample text; the hero's Raw
  view in `components/hero-sheet.tsx` shows the file as saved, in the format proposal's marker
  syntax, so update it if the syntax changes.
- **Interactive parts** are the only client components: the hero's view switch
  (`components/view-switch.tsx`), the agent demo (`components/agent-demo.tsx`) and the tab icon's
  rotation (below), which renders nothing. Everything else is static HTML, and the page reads the
  same with JavaScript off.
- **The icon** is the app's: a red caret on warm paper. The header's mark (`BrandMark` in
  `components/icons.tsx`) and the tab's icon (`src/app/icon.svg`) draw it the same way, without the
  filters in the app's artwork (`apps/desktop/src-tauri/icons/family/`), so that it stays crisp
  small. With JavaScript, each visit shows the next of the app's six marks in the tab, as its Dock
  icon changes with each launch (`components/favicon-rotation.tsx`, the files in
  `public/favicons/`); crawlers and visitors without JavaScript see the caret.
  Two images stand for the site outside it: `src/app/apple-icon.png` (180 × 180, the tile edge to
  edge, for iOS) and `src/app/opengraph-image.png` (1200 × 630, for link previews), which Next links
  from the page. When the caret changes, redraw them with `npm run make-social` (after `npx
  playwright install chromium`, once) and commit the results; CI doesn't run it.
  `npm run icons:check` holds the copies of the caret to the app's masters.
- **Downloads** link to `releases/latest/download/<file>`, a permalink to the newest release. A
  release must attach its installers under the exact file names in `site.config.mjs`, for example
  `Redlines-macOS.dmg`. `lib/release.json` holds the latest release's version, date and file
  sizes. Until it lists a release with those files, the Download section shows "Coming soon". The
  committed copy is that empty state; the deploy workflow refreshes it before each build and never
  commits it.
- **Light and dark** follow the system setting. The colors are CSS variables in
  [`src/app/globals.css`](src/app/globals.css), checked for WCAG AA contrast in both themes.
- **Fonts** (Manrope, Open Sans and IBM Plex Mono) come from `next/font/google`: `npm run build`
  downloads them from Google Fonts and serves them with the site, so the build needs network
  access, and visitors never contact Google.
