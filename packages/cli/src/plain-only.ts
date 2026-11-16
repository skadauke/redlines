// Which files hold no tracked changes or comments: text and code, which Redlines opens in Plain
// alone (format §9.1). The same table as `PLAIN_ONLY_EXTENSIONS` in `apps/desktop/src/file-names.ts`,
// which a test there holds this one to (`file-names.node.test.ts`).

export const PLAIN_ONLY_EXTENSIONS: ReadonlySet<string> = new Set(
  [
    'txt text log',
    'json jsonc yaml yml toml ini cfg conf env csv tsv xml plist',
    'html htm css scss less js mjs cjs jsx ts mts cts tsx svg',
    'py rb go rs swift java kt c h cc cpp hpp cs php lua r sql sh bash zsh ps1',
  ].flatMap((group) => group.split(' ')),
);

/** Whether the file at `path` is a Plain-only file, by its last extension, in any case. */
export function isPlainOnly(path: string): boolean {
  const own = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
  const dot = own.lastIndexOf('.');
  return dot > 0 && PLAIN_ONLY_EXTENSIONS.has(own.slice(dot + 1).toLowerCase());
}
