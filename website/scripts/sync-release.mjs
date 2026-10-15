// @ts-check
//
// Refresh lib/release.json from the latest published GitHub release: its tag,
// its date, and the size of each desktop download it carries. The Download
// section shows "Coming soon" until a release has desktop downloads. The
// buttons link to the stable releases/latest/download/ permalinks, so they keep
// working when a newer release ships, even before the site is rebuilt.
//
// Run it explicitly (`npm run sync-release`), not as part of `build`, so local
// builds work offline with the committed file. The deploy workflow runs it
// before building and passes GITHUB_TOKEN, which lets it read a private
// repository and lifts the API rate limit. `--check-only` validates the
// committed file without network access or writes; the website CI runs that.
//
// A repository without a published release is a normal state, not an error:
// the script writes the empty state. Any other failure (network, API, no
// access) keeps the committed file and lets the build go on.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { downloads, repositorySlug } from '../site.config.mjs';

const out = fileURLToPath(new URL('../lib/release.json', import.meta.url));
const api = `https://api.github.com/repos/${repositorySlug}`;
const noRelease = { tag: null, version: null, publishedAt: null, assets: {} };

/**
 * @param {any} data
 * @returns {{ tag: string | null, version: string | null, publishedAt: string | null, assets: Record<string, number> }}
 */
function validate(data) {
  /** @param {string} message */
  const fail = (message) => {
    throw new Error(`lib/release.json: ${message}`);
  };
  if (typeof data !== 'object' || data === null || Array.isArray(data)) fail('must be an object');
  for (const key of ['tag', 'version', 'publishedAt']) {
    if (data[key] !== null && typeof data[key] !== 'string') {
      fail(`${key} must be a string or null`);
    }
  }
  if ((data.tag === null) !== (data.version === null)) fail('tag and version go together');
  const { assets } = data;
  if (typeof assets !== 'object' || assets === null || Array.isArray(assets)) {
    fail('assets must be an object');
  }
  for (const [file, size] of Object.entries(assets)) {
    if (!Number.isInteger(size) || size < 0) fail(`assets["${file}"] must be a size in bytes`);
  }
  return { tag: data.tag, version: data.version, publishedAt: data.publishedAt, assets };
}

/** @param {ReturnType<typeof validate>} data */
function describe(data) {
  if (!data.version) return 'no release yet';
  const count = Object.keys(data.assets).length;
  return `v${data.version}, ${count} of ${downloads.length} downloads`;
}

if (process.argv.includes('--check-only')) {
  const data = validate(JSON.parse(readFileSync(out, 'utf8')));
  console.log(`sync-release: lib/release.json is valid (${describe(data)})`);
  process.exit(0);
}

/** @type {Record<string, string>} */
const headers = {
  accept: 'application/vnd.github+json',
  'user-agent': `${repositorySlug} website build`,
  'x-github-api-version': '2022-11-28',
};
if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

/** @param {string} path */
const get = (path) => fetch(`${api}${path}`, { headers, signal: AbortSignal.timeout(15_000) });

try {
  let data;
  const res = await get('/releases/latest');
  if (res.status === 404) {
    // GitHub answers 404 both when there is no published release and when the
    // token can't see the repository. Only the first means "no release".
    const repo = await get('');
    if (!repo.ok) {
      throw new Error(`can't read ${repositorySlug} (HTTP ${repo.status}); is GITHUB_TOKEN set?`);
    }
    data = noRelease;
  } else if (!res.ok) {
    throw new Error(`GitHub API returned HTTP ${res.status}`);
  } else {
    const release = await res.json();
    /** @type {Map<string, number>} */
    const sizes = new Map((release.assets ?? []).map((/** @type {any} */ a) => [a.name, a.size]));
    /** @type {Record<string, number>} */
    const assets = {};
    for (const { file } of downloads) {
      const size = sizes.get(file);
      if (size !== undefined) assets[file] = size;
    }
    data = validate({
      tag: release.tag_name,
      version: String(release.tag_name).replace(/^v/, ''),
      publishedAt: release.published_at,
      assets,
    });
    const missing = downloads.filter(({ file }) => !(file in assets)).map(({ file }) => file);
    if (missing.length > 0) {
      console.warn(`sync-release: ${data.tag} has no asset named ${missing.join(', ')}`);
    }
  }

  writeFileSync(out, JSON.stringify(data, null, 2) + '\n');
  console.log(`sync-release: wrote lib/release.json (${describe(data)})`);

  // A deploy for a specific release (RELEASE_TAG) should find that release as
  // the latest one. It won't for a prerelease, which GitHub never calls latest.
  const expected = process.env.RELEASE_TAG;
  if (expected && expected !== data.tag) {
    console.warn(
      `sync-release: deploying for ${expected}, but the latest release is ${data.tag ?? 'none'}`,
    );
  }
} catch (err) {
  const reason = err instanceof Error ? err.message : String(err);
  console.warn(`sync-release: keeping the committed lib/release.json: ${reason}`);
}
