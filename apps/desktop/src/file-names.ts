// What Redlines makes of a file by its name alone (format §9.1): whether it is a document, which it
// opens and edits, and whether a link in a document opens it in its default app. A module of its
// own, which imports nothing, so that the settings and Open Recent, which every window loads, can
// ask it without loading the window's host (host.ts) too.

/**
 * The kinds of document: Markdown has three views, Track Changes and a ledger; Plain-only has
 * none of them.
 */
export type DocumentKind = 'markdown' | 'plain-only';

/** The dialects of Markdown: GitHub's, and Pandoc's, which R Markdown and Quarto write. */
export type MarkdownDialect = 'gfm' | 'pandoc';

/**
 * The extensions of Markdown documents by dialect (format §9.1), lowercase: Markdown, and the R
 * Markdown and Quarto dialects. The dialect is for what differs in how a document is written, such
 * as an image's size. `src-tauri/src/project.rs` holds the same table, and a test says they agree
 * (`src-tauri/src/document_types.rs`).
 */
export const MARKDOWN_EXTENSIONS: Readonly<Record<MarkdownDialect, readonly string[]>> = {
  gfm: ['md', 'markdown'],
  pandoc: ['qmd', 'rmd'],
};

/** The dialect of a Markdown document by its name or path; null for any other file. */
export function markdownDialect(name: string): MarkdownDialect | null {
  const own = extension(name);
  for (const dialect of ['gfm', 'pandoc'] as const) {
    if (MARKDOWN_EXTENSIONS[dialect].includes(own)) return dialect;
  }
  return null;
}

/**
 * The extensions of the Plain-only documents, by group (format §9.1): text and code, which open in
 * Plain with no Clean or Redlines view, no Track Changes and no ledger.
 */
export const PLAIN_ONLY_EXTENSIONS: Readonly<Record<string, readonly string[]>> = {
  text: ['txt', 'text', 'log'],
  data: [
    'json',
    'jsonc',
    'yaml',
    'yml',
    'toml',
    'ini',
    'cfg',
    'conf',
    'env',
    'csv',
    'tsv',
    'xml',
    'plist',
  ],
  web: [
    'html',
    'htm',
    'css',
    'scss',
    'less',
    'js',
    'mjs',
    'cjs',
    'jsx',
    'ts',
    'mts',
    'cts',
    'tsx',
    'svg',
  ],
  code: [
    'py',
    'rb',
    'go',
    'rs',
    'swift',
    'java',
    'kt',
    'c',
    'h',
    'cc',
    'cpp',
    'hpp',
    'cs',
    'php',
    'lua',
    'r',
    'sql',
    'sh',
    'bash',
    'zsh',
    'ps1',
  ],
};

/** Every extension of the documents Redlines opens, lowercase. */
export const DOCUMENT_EXTENSIONS: readonly string[] = [
  ...MARKDOWN_EXTENSIONS.gfm,
  ...MARKDOWN_EXTENSIONS.pandoc,
  ...Object.values(PLAIN_ONLY_EXTENSIONS).flat(),
];

/**
 * The kind of a document by its name or path, from the extension alone and never the content;
 * null for a file that isn't a document.
 */
export function documentKind(name: string): DocumentKind | null {
  const own = extension(name);
  if (markdownDialect(name) !== null) return 'markdown';
  return DOCUMENT_EXTENSIONS.includes(own) ? 'plain-only' : null;
}

/** Whether a file is a document, which Redlines opens and edits, by its name or its path. */
export function isDocument(name: string): boolean {
  return documentKind(name) !== null;
}

/**
 * The extensions, lowercase, of the files that a link in a document opens in another app, Preview
 * on the Mac: images and PDFs. The app checks again, by the file a link names
 * (src-tauri/src/project.rs).
 */
const DEFAULT_APP_EXTENSIONS: ReadonlySet<string> = new Set(
  'png jpg jpeg gif webp heic tiff bmp pdf'.split(' '),
);

/** Whether a link opens a file in its default app, by its name or its path: an image or a PDF. */
export function opensInDefaultApp(name: string): boolean {
  return DEFAULT_APP_EXTENSIONS.has(extension(name));
}

/**
 * The extension of a file's name, or of the last name in a path, lowercase; '' for a name without
 * one, such as `.txt`, a hidden file's, as the app has it too (src-tauri/src/project.rs).
 */
export function extension(name: string): string {
  const own = name.slice(Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\')) + 1);
  const dot = own.lastIndexOf('.');
  return dot > 0 ? own.slice(dot + 1).toLowerCase() : '';
}
