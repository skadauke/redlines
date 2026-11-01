// Helpers shared by the tests of the editing functions. They are not part of the package.

import { readFileSync } from 'node:fs';
import { expect } from 'vitest';
import { setLedger } from './ledger-write.ts';
import { parse } from './parse.ts';
import type { EditContext, Parsed, Person } from './types.ts';

/** The example of format §1.2. */
export const fixture = readFileSync(new URL('./fixtures/launch-plan.md', import.meta.url), 'utf8');

export const ada: Person = { handle: 'ada', name: 'Ada Lovelace', email: 'ada@example.org' };
export const bo: Person = { handle: 'bo', name: 'Bo Chen', email: 'bo@example.org' };
export const claudeAda: Person = { handle: 'claude-ada', name: 'Claude', agent: true, for: 'ada' };

const FIRST = 'bcdfghjkmnpqrstvwxz';
const REST = 'bcdfghjkmnpqrstvwxz23456789';

/** A deterministic stand-in for `crypto.getRandomValues` that spells out the given ids, one after
 * the other, and throws when they run out. */
export function randomIds(...ids: string[]): (n: number) => Uint8Array {
  const bytes = ids.flatMap((id) =>
    [...id].map((c, i) => (i === 0 ? FIRST : REST).indexOf(c)).filter((b) => b >= 0),
  );
  let at = 0;
  return (n) => {
    if (at + n > bytes.length) throw new Error('The test ran out of random ids');
    const chunk = Uint8Array.from(bytes.slice(at, at + n));
    at += n;
    return chunk;
  };
}

/** The time of every test edit. */
export const TIME = '2026-10-31T09:00Z';

/** An edit context for `author`, drawing the given ids in order. */
export function context(
  author: Person,
  ids: string[] = [],
  more: Partial<EditContext> = {},
): EditContext {
  return { author, time: TIME, random: randomIds(...ids), ...more };
}

/** A thread for the ledger of `file`, as YAML lines. */
export function thread(id: string, by = 'ada', text = 'A note.', more: string[] = []): string[] {
  return [
    `  ${id}:`,
    `    by: ${by}`,
    '    at: 2026-10-13T22:40Z',
    ...more.map((line) => `    ${line}`),
    '    text: |-',
    `      ${text}`,
  ];
}

/** The first line of every ledger (format §5.5). */
export const LEDGER_NOTE =
  "# If git shows a merge conflict in this block, keep both sides. The order of entries doesn't matter.";

/**
 * A file with the given body and a ledger in the form `serializeLedger` writes, so that saving it
 * again changes nothing. `marks` gives the author of each mark by id, in the order of the
 * document; Ada and Bo are the people; `threads` are the lines of the `comments` key (see `thread`).
 */
export function file(
  body: string,
  marks: Record<string, string> = {},
  threads: string[] = [],
): string {
  const lines = ['<!-- redlines', LEDGER_NOTE, 'version: 1', 'people:'];
  lines.push('  ada: {name: Ada Lovelace}', '  bo: {name: Bo Chen}');
  const entries = Object.entries(marks);
  if (entries.length > 0) {
    lines.push('marks:');
    for (const [id, by] of entries) lines.push(`  ${id}: {by: ${by}, at: 2026-10-13T22:30Z}`);
  }
  if (threads.length > 0) lines.push('comments:', ...threads);
  lines.push('-->');
  return `${body}\n\n${lines.join('\n')}\n`;
}

/** A file without its ledger: the body, as it looks after an edit. */
export function bodyOf(text: string): string {
  const range = parse(text).ledgerRange;
  return range ? text.slice(0, range.from) : text;
}

/** The ids of the marks of a file, with the comment threads, in document order. */
export function idsOf(text: string): string[] {
  return parse(text).marks.map((mark) => mark.id);
}

/** Warnings that mean marks and ledger do not match: what no edit should leave behind. */
const STRUCTURAL = new Set([
  'unclosed-mark',
  'unopened-close',
  'kind-mismatch',
  'duplicate-id',
  'missing-entry',
  'orphan-entry',
  'orphan-thread',
  'bad-ledger',
]);

export function problemsOf(parsed: Parsed): string[] {
  return parsed.warnings
    .filter((w) => STRUCTURAL.has(w.code))
    .map((w) => `${w.code} ${w.id ?? ''}`.trim());
}

/** Insertions never hold insertions (format §3.6): the ids of those that sit in the text of an
 * insertion or substitution. */
export function nestedInsertions(parsed: Parsed): string[] {
  const nested: string[] = [];
  for (const outer of parsed.marks) {
    if (outer.kind !== 'ins' && outer.kind !== 'sub') continue;
    for (const holder of outer.segments) {
      if (!holder.close) continue;
      for (const inner of parsed.marks) {
        if (inner.kind !== 'ins' || inner.id === outer.id) continue;
        const inside = inner.segments.some(
          (s) => s.close && s.open.from >= holder.content.from && s.close.to <= holder.content.to,
        );
        if (inside) nested.push(inner.id);
      }
    }
  }
  return nested;
}

/** What every edit must leave: marks and ledger that match, the ledger written the way
 * `setLedger` would write it again, and the threads there should be. */
export function expectInOrder(label: string, threads: string[], after: string): Parsed {
  const parsed = parse(after);
  expect(problemsOf(parsed), label).toEqual([]);
  expect(nestedInsertions(parsed), `${label}: insertions inside insertions`).toEqual([]);
  expect(setLedger(after, parsed.ledger), `${label}: the ledger is not canonical`).toEqual([]);
  expect(
    parsed.ledger.comments.map((t) => t.id),
    `${label}: threads`,
  ).toEqual(threads);
  return parsed;
}
