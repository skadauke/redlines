# The Quick Look preview

Space on a Markdown file in Finder, Mail, Spotlight or the Open dialog shows the file as the Clean
view draws it: every change accepted, in the Default theme, under one line that says what is
waiting in it (design §10). R Markdown and Quarto files too, where no other app declares those
extensions as its own type. This folder is that preview: the renderer, and the
Swift extension that hosts it. The app builds it as part of `pnpm build`
(`apps/desktop/scripts/build-quicklook`), and carries it as
`Redlines.app/Contents/PlugIns/RedlinesPreview.appex`.

## The renderer (`src/`)

TypeScript that runs in JavaScriptCore, with the language and nothing else: no Node, no browser and
no `console`. `rolldown.config.mjs` bundles it into `build/preview.js`, one script that defines
`redlinesPreview(text, name, cut, images)` and returns the page, and `redlinesImages(text, cut)`, which
lists the local images that the page would draw, so that the extension can load them and give them
back as `images`.

- `render.ts`: the file with every change accepted (`newestView` of `@redlines/format`), its front
  matter taken off and shown plainly, the first 300,000 characters of the rest drawn, under the line
  of `summary.ts`.
- `markdown.ts`: micromark with GitHub's extensions. HTML comments (the markers, and any note an
  author left) are not shown, an image is its alt text unless the extension loaded its file
  (`<img src="cid:…">`, which Quick Look answers from the attachments of its reply), the options of
  an R Markdown or Quarto chunk are kept as a line over its code, and a table sits in a box that
  scrolls. Raw HTML is text, never live.
- `summary.ts`: what waits in a file: the changes, counted as suggestions as the review bar counts
  them, and the open comment threads, and who made them.
- `theme.ts`, `fonts.ts`, `document.css`, `page.ts`: the page. The theme's tokens are read from
  `plugins/themes/src/tokens.css`, light and dark, and the fonts (Carlito and Cousine, Latin) are
  inside it as data URLs. The page has no script, and a Content-Security-Policy that loads nothing
  but the images the extension attached (`img-src cid:`).

`fixtures/` holds the files that the tests and `build-quicklook --check` render.

## The extension (`swift/`)

- `extension/PreviewProvider.swift`: a `QLPreviewProvider`. It reads the file it is asked to
  preview (the first 4 MB), runs the renderer, and answers with HTML. If the renderer fails it shows
  the file's text instead.
- `PreviewRenderer.swift`: runs `preview.js` in a `JSContext`. The extension and the test command
  line share it.
- `harness/main.swift`: `preview-render`, the test command line. `build/preview-render preview.js
  file.md` prints the page, and how long it took.
- `PreviewImages.swift`: loads the local images a document links to, by the app's own rule: inside
  the document's project (its repository, or its own folder; and only its own folder when the
  project is too broad: the home folder, one above it, the disk's root), no hidden file or folder,
  no link out of the project, the name and the first bytes both saying it is an image; shared with
  the harness (`--images`, `--list-images`, `--too-broad`).
- `RedlinesPreview.entitlements`: the sandbox, JavaScriptCore's compiler and a read-only exception
  for files, which the images need. Nothing else: no network.

`scripts/build-quicklook` writes the extension's Info.plist (its types are Markdown's two, and the
dynamic types of `.qmd` and `.rmd`), compiles it with `swiftc` for both architectures, and signs it.
How it is signed, checked and tried on a Mac is in [docs/releasing.md](../../../docs/releasing.md#the-quick-look-extension).

## Tests

`pnpm test` runs the renderer's tests in Node (`src/*.test.ts`), and one that builds the bundle and
runs it in a context with nothing but the language, as the extension does. `scripts/build-quicklook
--check`, on a Mac, runs it in the system's JavaScriptCore too.
