// Writes the update manifest of a release, latest.json, which the app's updater reads at
// releases/latest/download/latest.json, after checking the update's signature as the updater
// will: with the public key in src-tauri/tauri.conf.json, and for the version being released. A
// release whose signing key doesn't match that public key would leave every installed copy
// unable to update, and quietly so; the release workflow fails here instead.
//
//   node scripts/update-manifest.ts --archive Redlines-macOS.app.tar.gz \
//     --signature Redlines-macOS.app.tar.gz.sig --app-version 0.1.0 --url <download URL> \
//     --notes <release page> > latest.json
//
// Run it in apps/desktop, with Node 24 or later, which runs TypeScript as it is.

import { createHash, createPublicKey, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

/** The lines of a minisign file, from the base64 that Tauri keeps it in. */
function lines(base64: string, what: string): string[] {
  const file = Buffer.from(base64.trim(), 'base64').toString('utf8');
  const found = file.split(/\r?\n/);
  if (found.length < 2 || !found[0]?.startsWith('untrusted comment:')) {
    throw new Error(`The ${what} isn't a minisign file in base64`);
  }
  return found;
}

function bytes(line: string | undefined, length: number, what: string): Buffer {
  const decoded = Buffer.from(line ?? '', 'base64');
  if (decoded.length !== length) throw new Error(`The ${what} isn't ${length} bytes long`);
  return decoded;
}

/**
 * Checks a minisign signature (`signature`, the contents of a Tauri `.sig` file) of `data` with
 * `publicKey` (as `plugins.updater.pubkey` holds it), as tauri-plugin-updater does, and returns
 * its trusted comment. Throws when it doesn't hold.
 */
export function verifySignature(data: Uint8Array, signature: string, publicKey: string): string {
  const key = bytes(lines(publicKey, 'public key')[1], 42, 'public key');
  if (key.subarray(0, 2).toString('latin1') !== 'Ed') {
    throw new Error('The public key is not an Ed25519 minisign key');
  }
  const [, signatureLine, commentLine, globalLine] = lines(signature, 'signature');
  const signed = bytes(signatureLine, 74, 'signature');
  const algorithm = signed.subarray(0, 2).toString('latin1');
  if (algorithm !== 'Ed' && algorithm !== 'ED') {
    throw new Error(`The signature's algorithm, ${algorithm}, isn't minisign's`);
  }
  if (!signed.subarray(2, 10).equals(key.subarray(2, 10))) {
    throw new Error(
      'The signature was made with another key than the public key in tauri.conf.json',
    );
  }
  const prefix = 'trusted comment: ';
  if (!commentLine?.startsWith(prefix)) throw new Error('The signature has no trusted comment');
  const trusted = commentLine.slice(prefix.length);
  const global = bytes(globalLine, 64, "signature's global signature");

  const ed25519 = createPublicKey({
    key: { kty: 'OKP', crv: 'Ed25519', x: key.subarray(10).toString('base64url') },
    format: 'jwk',
  });
  // "ED" signs a BLAKE2b-512 hash of the data, "Ed", the older form, the data itself.
  const message = algorithm === 'ED' ? createHash('blake2b512').update(data).digest() : data;
  if (!verify(null, message, ed25519, signed.subarray(10))) {
    throw new Error('The signature does not match the file');
  }
  const covered = Buffer.concat([signed.subarray(10), Buffer.from(trusted, 'utf8')]);
  if (!verify(null, covered, ed25519, global)) {
    throw new Error('The trusted comment was changed after signing');
  }
  return trusted;
}

/** The version a trusted comment says the file was signed for, as the Tauri CLI records it. */
export function signedVersion(trustedComment: string): string | null {
  for (const field of trustedComment.split('\t')) {
    if (field.startsWith('version:')) return field.slice('version:'.length);
  }
  return null;
}

export interface Release {
  version: string;
  notes: string;
  /** When it was published, in RFC 3339. */
  pubDate: string;
  /** Where the update's archive is downloaded from. */
  url: string;
  /** The contents of the archive's `.sig` file. */
  signature: string;
}

/** The manifest of a release: one universal app, for Apple silicon and Intel Macs. */
export function updateManifest(release: Release) {
  const platform = { signature: release.signature, url: release.url };
  return {
    version: release.version,
    notes: release.notes,
    pub_date: release.pubDate,
    platforms: { 'darwin-aarch64': platform, 'darwin-x86_64': platform },
  };
}

function main(): void {
  const { values } = parseArgs({
    options: {
      archive: { type: 'string' },
      signature: { type: 'string' },
      'app-version': { type: 'string' },
      url: { type: 'string' },
      notes: { type: 'string', default: '' },
    },
  });
  const { archive, signature: signatureFile, 'app-version': version, url, notes } = values;
  if (!archive || !signatureFile || !version || !url) {
    throw new Error('Usage: update-manifest --archive … --signature … --app-version … --url …');
  }
  const config = JSON.parse(
    readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'),
  ) as { plugins?: { updater?: { pubkey?: string } } };
  const publicKey = config.plugins?.updater?.pubkey ?? '';
  const signature = readFileSync(signatureFile, 'utf8').trim();
  const trusted = verifySignature(readFileSync(archive), signature, publicKey);
  // The app refuses an update whose signature names another version (requireSignedVersion).
  const signedFor = signedVersion(trusted);
  if (signedFor !== version) {
    throw new Error(`The update is signed for version ${signedFor ?? 'none'}, not ${version}`);
  }
  const manifest = updateManifest({
    version,
    notes: notes ?? '',
    pubDate: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    url,
    signature,
  });
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(`update-manifest: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
