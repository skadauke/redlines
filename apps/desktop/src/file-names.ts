// What Redlines makes of a file by its name alone (format §9.1): whether it is a document, which it
// opens and edits, and whether a link in a document opens it in its default app. A module of its
// own, which imports nothing, so that the settings and Open Recent, which every window loads, can
// ask it without loading the window's host (host.ts) too.

/**
 * The extensions of the documents Redlines opens (format §9.1), lowercase: Markdown, its R Markdown
 * and Quarto dialects, and plain text, which is read as Markdown is.
 */
export const DOCUMENT_EXTENSIONS: readonly string[] = ['md', 'markdown', 'qmd', 'rmd', 'txt'];

/** Whether a file is a document, which Redlines opens and edits, by its name or its path. */
export function isDocument(name: string): boolean {
  return DOCUMENT_EXTENSIONS.includes(extension(name));
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
