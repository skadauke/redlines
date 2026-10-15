// What the Download section shows, baked in at build time from
// lib/release.json (written by `npm run sync-release`). The buttons link to
// GitHub's releases/latest/download/ permalinks, so they keep serving the
// newest release even before the site is rebuilt; the version, date and sizes
// are display only.

import { downloads, product } from '../site.config.mjs';
import data from './release.json';

type ReleaseData = {
  tag: string | null;
  version: string | null;
  publishedAt: string | null;
  assets: Record<string, number>;
};

const release: ReleaseData = data;

export type Download = {
  os: string;
  label: string;
  file: string;
  url: string;
  size: number;
};

/** The downloads attached to the latest release, in display order. */
const available: Download[] = downloads.flatMap((d) => {
  const size = release.assets[d.file];
  if (size === undefined) return [];
  return [{ ...d, url: `${product.repository}/releases/latest/download/${d.file}`, size }];
});

/**
 * The latest release, or null while there is none with desktop downloads.
 * Null is the "Coming soon" state.
 */
export const latestRelease =
  release.tag && release.version && available.length > 0
    ? {
        version: release.version,
        publishedAt: release.publishedAt,
        notesUrl: `${product.repository}/releases/tag/${encodeURIComponent(release.tag)}`,
        downloads: available,
      }
    : null;

export const allReleasesUrl = `${product.repository}/releases`;

/** The operating systems we build for, in display order. */
export const platforms = [...new Set(downloads.map((d) => d.os))];

export function formatSize(bytes: number): string {
  const mb = bytes / 1024 ** 2;
  return mb >= 10 ? `${Math.round(mb)} MB` : `${mb.toFixed(1)} MB`;
}

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeZone: 'UTC' }).format(
    new Date(iso),
  );
}
