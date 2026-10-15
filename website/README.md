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

While the repository is private, `sync-release` needs a token: `GITHUB_TOKEN=$(gh auth token)`.
Without one it keeps the committed file. You rarely need it locally.

## Deploy

[`deploy-website.yml`](../.github/workflows/deploy-website.yml) builds the site and deploys `out/`
to GitHub Pages. It runs:

- when a release is published;
- when a release workflow calls it (`workflow_call` with `release_tag`), as Syrus's release
  pipeline does;
- by hand: Actions → Deploy website → Run workflow.

It does not run on pushes to main yet: a Pages site is public, while the repository is private and
the name is not final. At launch, add the `push` trigger shown at the top of the workflow.
[`website.yml`](../.github/workflows/website.yml) builds, without deploying, every pull request and
push that touches `website/`.

### One-time setup (repository admin)

1. Settings → Pages → Build and deployment → Source: **GitHub Actions**. Pages for a private
   repository needs a paid plan.
2. Settings → Environments → **github-pages** → Deployment branches and tags: add the tag rule
   `v*`. Release-triggered runs happen on the release's tag, which the environment blocks by
   default.

Until a custom domain is set, Pages serves the site at `https://<owner>.github.io/<repository>/`.
The workflow passes that base path to the build (`BASE_PATH`), so asset URLs work there.

### Custom domain

Once a domain is chosen, set it under Settings → Pages → Custom domain, add the DNS records GitHub
asks for, and turn on **Enforce HTTPS**. The build needs no change: the base path becomes `/` by
itself. Deploys from Actions ignore a `CNAME` file, but you can add `public/CNAME` to keep the
domain on record in the repository, as Syrus does.

## How it works

- **Name and repository** live in [`site.config.mjs`](site.config.mjs), the only place that spells
  them out. The name is a working title: changing it there updates the page, the download file
  names and the release sync.
- **Copy** lives in [`lib/site.ts`](lib/site.ts). The illustrations (`components/hero-sheet.tsx`,
  `components/agent-demo.tsx` and the sections' sheets) hold their own sample text; the hero's Raw
  view in `components/hero-sheet.tsx` shows the file as saved, in the format proposal's marker
  syntax, so update it if the syntax changes.
- **Interactive parts** are the only client components: the hero's view switch
  (`components/view-switch.tsx`) and the agent demo (`components/agent-demo.tsx`). Everything else
  is static HTML, and the page reads the same with JavaScript off.
- **Downloads** link to `releases/latest/download/<file>`, a permalink to the newest release. A
  release must attach its installers under the exact file names in `site.config.mjs`, for example
  `Redlines-macOS.dmg`. `lib/release.json` holds the latest release's version, date and file
  sizes. Until it lists a release with those files, the Download section shows "Coming soon". The
  committed copy is that empty state; the deploy workflow refreshes it before each build and never
  commits it.
- **Light and dark** follow the system setting. The colors are CSS variables in
  [`src/app/globals.css`](src/app/globals.css), checked for WCAG AA contrast in both themes.
- **Fonts** (Figtree, Open Sans and IBM Plex Mono) come from `next/font/google`: `npm run build`
  downloads them from Google Fonts and serves them with the site, so the build needs network
  access, and visitors never contact Google.
