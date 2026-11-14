// Which local images the preview may load (design, Rendering): those inside the project folder
// the app shows for the document. The app lets the page load only those (src-tauri/src/images.rs);
// the page leaves out the rest, which show their alt text, rather than ask for what it would be
// refused.

/** The path of `src`, written relative to the document at `documentPath`, with `.` and `..` folded. */
function resolve(src: string, documentPath: string): string | null {
  const separator = documentPath.includes('\\') && !documentPath.includes('/') ? '\\' : '/';
  const written = src.replaceAll('\\', '/');
  const absolute = written.startsWith('/') || /^[A-Za-z]:\//.test(written);
  const base = documentPath.replaceAll('\\', '/').split('/').slice(0, -1);
  const parts = absolute ? written.split('/') : [...base, ...written.split('/')];
  const folded: string[] = [];
  for (const part of parts) {
    if (part === '..') {
      if (folded.length <= 1) return null;
      folded.pop();
    } else if (part !== '.' && (part !== '' || folded.length === 0)) {
      folded.push(part);
    }
  }
  return folded.join(separator);
}

/**
 * The URL a local image loads from: `src` as written in the document at `documentPath`, if the
 * file is inside the folder `project`, otherwise null. `toUrl` makes the URL of a file the
 * app serves.
 */
export function localImageUrl(
  src: string,
  documentPath: string,
  project: string,
  toUrl: (path: string) => string | null,
): string | null {
  const path = resolve(src, documentPath);
  if (path === null) return null;
  const folder = project.replace(/[\\/]+$/, '');
  // A project with no path is a browser tab's one folder in memory: any path in it is inside, which
  // is every path that names no place of its own.
  if (project === '') return /^([\\/]|[A-Za-z]:)/.test(path) ? null : toUrl(path);
  const inside = path.startsWith(folder + '/') || path.startsWith(folder + '\\');
  return inside ? toUrl(path) : null;
}
