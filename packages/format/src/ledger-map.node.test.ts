import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizeLedger } from './ledger-order.ts';
import { keepsLedger, serializeLedger } from './ledger-write.ts';
import { ledgerEntries, setLedgerEntries, writeLedger } from './ledger-map.ts';
import { findLedger, readSpan } from './ledger-read.ts';

// A round trip on every ledger in the repository: read into a map and written again, the ledger
// comes back byte for byte.

const root = resolve(import.meta.dirname, '../../..');
const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
  .split('\0')
  .filter((f) => /\.(md|ts|tsx|rs|js)$/.test(f));

const NOTE =
  serializeLedger({ version: 1, people: [], marks: {}, comments: [] }).split('\n')[1] ?? '';

const SNIPPET = /<!-- redlines[ \t]*\n[^]*?\n-->/g;

interface Fixture {
  name: string;
  /** The ledger comment as it stands. */
  ledger: string;
  /** A file that holds it, with the marks that it names. */
  file: string;
}

/** A body that names every mark and thread of a snippet, in the order the snippet has them. */
function bodyFor(ledger: string): string {
  const span = findLedger(ledger);
  const read = span ? readSpan(span) : undefined;
  if (!read?.valid) return '';
  const marks = Object.keys(read.ledger.marks).map((id) => `<!--ins ${id}-->x<!--/${id}-->\n`);
  const threads = read.ledger.comments.map((t) => `<!--cmt ${t.id}-->y<!--/${t.id}-->\n`);
  return [...marks, ...threads].join('\n');
}

function fixtures(): Fixture[] {
  const found: Fixture[] = [];
  for (const name of files) {
    const text = readFileSync(resolve(root, name), 'utf8');
    if (!text.includes('<!-- redlines')) continue;
    if (name.endsWith('.md')) {
      const span = findLedger(text);
      if (span && readSpan(span).valid) {
        found.push({ name, ledger: text.slice(span.start, span.range.to), file: text });
      }
      continue;
    }
    for (const match of text.matchAll(SNIPPET)) {
      const span = findLedger(match[0]);
      if (!span || !readSpan(span).valid) continue;
      found.push({ name, ledger: match[0], file: `${bodyFor(match[0])}\n\n${match[0]}\n` });
    }
  }
  return found;
}

describe('the ledger map on the repository', () => {
  const all = fixtures();

  it('finds ledgers to read', () => {
    expect(all.length).toBeGreaterThanOrEqual(10);
  });

  it("writes what today's writer writes for the ledger it reads", () => {
    for (const { name, file } of all) {
      const span = findLedger(file) as NonNullable<ReturnType<typeof findLedger>>;
      const { ledger } = readSpan(span);
      const expected = keepsLedger(ledger) ? serializeLedger(normalizeLedger(file, ledger)) : '';
      expect(writeLedger(ledgerEntries(file), file), name).toBe(expected);
    }
  });

  it("writes a ledger in the writer's own layout back byte for byte, and changes nothing", () => {
    let exact = 0;
    for (const { name, ledger, file } of all) {
      // Hand-written ledgers lack the first line's note, which the writer always puts.
      const written = ledger.replace(/^<!-- redlines\n(?!#)/, `<!-- redlines\n${NOTE}\n`);
      const text = file.replace(ledger, written);
      const map = ledgerEntries(text);
      if (writeLedger(map, text) !== written) continue;
      exact++;
      expect(setLedgerEntries(text, map), name).toEqual([]);
    }
    expect(exact).toBeGreaterThanOrEqual(6);
  });

  it('writes what it wrote the same again', () => {
    for (const { name, file } of all) {
      const written = writeLedger(ledgerEntries(file), file);
      if (written === '') continue;
      expect(writeLedger(ledgerEntries(`${written}\n`), file), name).toBe(written);
    }
  });
});
