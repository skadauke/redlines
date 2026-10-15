// @ts-check
//
// The product's name and repository, in one place. The name is a working
// title: change it here and the page, the download file names and the release
// sync all follow. Nothing else under website/ spells out either value.
//
// This is plain JavaScript so that both the Next.js app and
// scripts/sync-release.mjs (run by bare Node) can import it.

export const product = {
  name: 'Redlines',
  repository: 'https://github.com/skadauke/redlines',
};

/** "owner/name", for the GitHub API. */
export const repositorySlug = new URL(product.repository).pathname.replace(/^\/|\/$/g, '');

const fileStem = product.name.replace(/[^A-Za-z0-9]+/g, '-');

/**
 * The desktop downloads, in display order. A release must attach its
 * installers under exactly these file names: the buttons link to
 * releases/latest/download/<file>, a permalink that always serves the newest
 * release, and scripts/sync-release.mjs looks them up by name to show sizes.
 *
 * @type {ReadonlyArray<{ os: string, label: string, file: string }>}
 */
export const downloads = [
  { os: 'macOS', label: 'Apple silicon and Intel', file: `${fileStem}-macOS.dmg` },
  { os: 'Windows', label: 'Installer, x64', file: `${fileStem}-Windows-x64-setup.exe` },
  { os: 'Linux', label: 'AppImage, x86-64', file: `${fileStem}-Linux-x86_64.AppImage` },
  { os: 'Linux', label: 'Debian and Ubuntu, x86-64', file: `${fileStem}-Linux-amd64.deb` },
];
