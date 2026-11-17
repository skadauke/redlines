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
 * The file of a local image: `src` as written in the document at `documentPath`, made a path, if the
 * file is inside the folder `project`, otherwise null.
 */
export function localImagePath(src: string, documentPath: string, project: string): string | null {
  const path = resolve(src, documentPath);
  if (path === null) return null;
  const folder = project.replace(/[\\/]+$/, '');
  // A project with no path is a browser tab's one folder in memory: any path in it is inside, which
  // is every path that names no place of its own.
  if (project === '') return /^([\\/]|[A-Za-z]:)/.test(path) ? null : path;
  const inside = path.startsWith(folder + '/') || path.startsWith(folder + '\\');
  return inside ? path : null;
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
  const path = localImagePath(src, documentPath, project);
  return path === null ? null : toUrl(path);
}

/**
 * The path of the image at `imagePath` as the document at `documentPath` writes it: relative to the
 * document's folder, `shot.png` beside it, `img/shot.png` below it and `../img/shot.png` beside its
 * folder. Null when either has no path or they have no folder in common (another drive).
 */
export function relativeImagePath(documentPath: string | null, imagePath: string): string | null {
  if (documentPath === null) return null;
  const split = (path: string) => path.replaceAll('\\', '/').split('/');
  const from = split(documentPath).slice(0, -1);
  const to = split(imagePath);
  let shared = 0;
  while (shared < from.length && shared < to.length - 1 && from[shared] === to[shared]) shared++;
  // Nothing in common: another drive.
  if (shared === 0 && from.length > 0) return null;
  const up = from.slice(shared).map(() => '..');
  return [...up, ...to.slice(shared)].join('/');
}
