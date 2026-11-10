// @ts-check
//
// The shape of lib/release.json, which sync-release.mjs writes and the website
// build reads: the latest release's tag, version, date and file sizes.

/** `v` and three numbers, with an optional pre-release part; the capture is the version. */
const TAG = /^v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/;

/**
 * @param {any} data
 * @returns {{ tag: string | null, version: string | null, publishedAt: string | null, assets: Record<string, number> }}
 */
export function validate(data) {
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
  if (typeof data.tag === 'string') {
    const match = TAG.exec(data.tag);
    if (!match) fail(`tag "${data.tag}" must be v and three numbers, as v1.2.3`);
    else if (data.version !== match[1]) {
      fail(`version "${data.version}" must be the tag's, without its v ("${match[1]}")`);
    }
  }
  const { assets } = data;
  if (typeof assets !== 'object' || assets === null || Array.isArray(assets)) {
    fail('assets must be an object');
  }
  for (const [file, size] of Object.entries(assets)) {
    if (!Number.isInteger(size) || size < 0) fail(`assets["${file}"] must be a size in bytes`);
  }
  return { tag: data.tag, version: data.version, publishedAt: data.publishedAt, assets };
}
