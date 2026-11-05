// The few path operations the command line needs, without Node's path module, so that the logic runs
// where Node does not. Paths use `/`, as on the Mac and Linux.

/** The folder of a path: everything before the last `/`, `.` when there is none. */
export function dirname(path: string): string {
  const slash = path.lastIndexOf('/');
  if (slash === -1) return '.';
  return slash === 0 ? '/' : path.slice(0, slash);
}

/** The last part of a path. */
export function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** A folder and a name in it. */
export function join(folder: string, name: string): string {
  if (folder === '.') return name;
  return folder.endsWith('/') ? `${folder}${name}` : `${folder}/${name}`;
}
