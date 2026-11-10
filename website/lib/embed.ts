import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// The demos' bundle, built by apps/website-embed into public/embed/ (`npm run embed`) and described
// by Vite's manifest. Read at build, by a server component: the page gets the hashed names, so a
// cached old page never mixes the files of two builds.

export interface EmbedFiles {
  /** The bundle's URL path, under the site's base path. */
  js: string;
  /** Its stylesheet's. */
  css: string;
}

interface ManifestEntry {
  file: string;
  css?: string[];
  isEntry?: boolean;
}

/**
 * The bundle's files, or null when it hasn't been built, so that a contributor can work on copy
 * with `npm install` alone and the page shows its fallbacks. With REQUIRE_EMBED=1 (the deploy, and
 * the pull request's build) a missing bundle is an error, not a quiet fallback.
 */
export function embedFiles(): EmbedFiles | null {
  const manifest = join(process.cwd(), 'public', 'embed', 'manifest.json');
  if (!existsSync(manifest)) {
    if (process.env.REQUIRE_EMBED === '1') {
      throw new Error(
        'REQUIRE_EMBED is set, but public/embed/manifest.json is missing: run npm run embed first',
      );
    }
    return null;
  }
  const entry = Object.values(
    JSON.parse(readFileSync(manifest, 'utf8')) as Record<string, ManifestEntry>,
  ).find((each) => each.isEntry);
  const css = entry?.css?.[0];
  if (!entry || !css) throw new Error('public/embed/manifest.json has no entry with a stylesheet');
  const base = `${process.env.BASE_PATH ?? ''}/embed/`;
  return { js: base + entry.file, css: base + css };
}
