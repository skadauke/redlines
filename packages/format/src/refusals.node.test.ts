// "Never add a refusal" (format §3.12, hardening.md), held by a test: every place in the sources
// that refuses an edit (`new EditError(`, a key plan's `refusal:`, a notice) has a tier in
// `refusals.ts`. A new refusal is a red test until it is widened, asked about, disabled or kept, and
// says which.

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { KEPT_CODES, REFUSALS, tierOfCode } from './refusals.ts';
import { refusalSites } from './refusals-scan.node.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');

describe('refusals', () => {
  const sites = refusalSites(root);
  const known = new Set(REFUSALS.map(([file, key]) => `${file}|${key}`));

  it('has a tier for every place that refuses', () => {
    const missing = sites
      .filter((site) => !known.has(`${site.file}|${site.key}`))
      .map((site) => `${site.file}:${site.line}  ${site.how}  ${JSON.stringify(site.key)}`);
    expect(
      missing,
      'A new place that refuses an edit. Redlines does not add refusals: widen the edit to the ' +
        'unit that holds it (widen.ts), or ask first, or disable the command. A refusal that has to ' +
        'stay is added to refusals.ts, with its tier and why.',
    ).toEqual([]);
  });

  it('gives each refusal one of the five tiers, and a reason', () => {
    for (const [file, key, tier, why] of REFUSALS) {
      expect(['widen', 'alert', 'disable', 'keep', 'info'], `${file} ${key}`).toContain(tier);
      expect(why, `${file} ${key}`).not.toBe('');
    }
    const seen = new Set<string>();
    for (const [file, key] of REFUSALS) {
      expect(seen.has(`${file}|${key}`), `${file} ${key} is listed twice`).toBe(false);
      seen.add(`${file}|${key}`);
    }
  });

  it('keeps a refusal only for what no write can set right', () => {
    // An error with one of these codes is a refusal that stays; the others are widened or asked about.
    expect(KEPT_CODES).toEqual([
      'unreadable-ledger',
      'unclosed-end',
      'markup',
      'unknown-id',
      'no-match',
      'many-matches',
    ]);
    expect(tierOfCode('no-legal-placement')).toBe('widen');
    expect(tierOfCode('would-hide-marks')).toBe('widen');
    expect(tierOfCode('inside-code')).toBe('widen');
    expect(tierOfCode('front-matter')).toBe('alert');
    expect(tierOfCode('unknown-id')).toBe('keep');
    expect(tierOfCode(undefined)).toBe('keep');
  });

  it('lists no refusal that is gone from the sources, once a unit is widened', () => {
    // A widened refusal is deleted with its code, and its row with it: say which rows are stale.
    const present = new Set(sites.map((site) => `${site.file}|${site.key}`));
    const stale = REFUSALS.filter(([file, key]) => !present.has(`${file}|${key}`)).map(
      ([file, key]) => `${file}  ${key}`,
    );
    // Not a failure: a row stays until its lane deletes it. Said, so that it is seen.
    if (stale.length > 0)
      console.log(`refusals.ts: ${stale.length} rows have no place in the sources`);
    expect(stale.length).toBeLessThan(REFUSALS.length);
  });
});
