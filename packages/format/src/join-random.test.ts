// The joining of an agent's edit (format §3.11) on random documents: it writes every edit that the
// word form writes, as asked, credits nobody else's words to the agent, and makes no more marks.

import { describe, expect, it } from 'vitest';
import { suggestReplace, uniqueMatch, wordHunks } from './agent.ts';
import { applyChanges } from './changes.ts';
import { accept, reject, rejectAll } from './decide.ts';
import { eolOf, inEol, paragraphBreaks } from './edit-support.ts';
import { EditError } from './errors.ts';
import { parse } from './parse.ts';
import { fuzzCount, listDocument, randomDocument, seeded } from './random-docs.ts';
import { claudeAda, expectInOrder } from './test-helpers.ts';
import { trackedEdits } from './track.ts';
import type { EditContext, MarkRange, Parsed } from './types.ts';
import { newestView, originalView } from './views.ts';

const WORDS = ['alpha', 'beta', 'gamma', 'delta', 'café', 'omega', 'sigma', 'tau', 'rho', 'zeta'];
const TOKEN = /[\p{L}\p{N}\p{M}_]+|\s+|[^\p{L}\p{N}\p{M}_\s]/gu;

/** A context that draws its ids from `random`. */
const contextOf = (random: () => number): EditContext => ({
  author: claudeAda,
  time: '2026-11-10T10:00Z',
  note: 'n',
  group: 'gzd7',
  random: (n) => Uint8Array.from({ length: n }, () => Math.floor(random() * 256)),
});

/** The same ids twice: the two forms of an edit are written with the same ids. */
function twice(seed: number): [EditContext, EditContext] {
  return [contextOf(seeded(seed)), contextOf(seeded(seed))];
}

/** The edit as the word form writes it, each change the comparison finds, or undefined where it is
 * refused. */
function wordForm(text: string, oldStr: string, newStr: string, ctx: EditContext) {
  const eol = eolOf(text);
  const before = inEol(oldStr, eol);
  const after = inEol(newStr, eol);
  const view = newestView(text);
  const start = uniqueMatch(view.text, before);
  const edits = wordHunks(before, after).map((hunk) => {
    if (hunk.from === hunk.to) {
      const at = view.map.toSource(start + hunk.from, hunk.from > 0 ? -1 : 1);
      return { from: at, to: at, insert: hunk.insert };
    }
    return {
      from: view.map.toSource(start + hunk.from, 1),
      to: view.map.toSource(start + hunk.to, -1),
      insert: hunk.insert,
    };
  });
  try {
    return trackedEdits(text, edits, ctx);
  } catch (error) {
    if (error instanceof EditError) return undefined;
    throw error;
  }
}

/** Every result of deciding `ids`, each accepted or rejected, in every order, by the set of
 * decisions: one text for each set when every order reads the same. */
function orders(text: string, ids: readonly string[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const walk = (current: string, left: readonly string[], path: string[]) => {
    if (left.length === 0) {
      const key = path.toSorted().join(' ');
      const set = out.get(key) ?? new Set<string>();
      set.add(current);
      out.set(key, set);
      return;
    }
    for (const id of left) {
      for (const [how, decide] of [
        ['a', accept],
        ['r', reject],
      ] as const) {
        let next: string;
        try {
          next = applyChanges(current, decide(current, id));
        } catch (error) {
          if (error instanceof EditError) continue;
          throw error;
        }
        walk(
          next,
          left.filter((other) => other !== id),
          [...path, how + id],
        );
      }
    }
  };
  walk(text, ids, []);
  return out;
}

/** Whether `decide` works on mark `id` of `text`. */
function decides(text: string, id: string, decide: typeof accept): boolean {
  try {
    decide(text, id);
    return true;
  } catch (error) {
    if (error instanceof EditError) return false;
    throw error;
  }
}

/** The text of a mark: its content, without the markers in it or the line breaks that go with an
 * opener on its own line (format §3.3), which no view shows. */
function textOf(parsed: Parsed, mark: MarkRange): string {
  const hidden = parsed.marks.flatMap((other) =>
    other.segments.flatMap((segment) =>
      [segment.open, segment.close, segment.carrier].filter((range) => range !== undefined),
    ),
  );
  return mark.segments
    .map((segment) => {
      let out = '';
      for (let at = segment.content.from; at < segment.content.to;) {
        const range = hidden.find((r) => r.from <= at && at < r.to);
        if (range) {
          at = range.to;
          continue;
        }
        out += parsed.text[at] ?? '';
        at++;
      }
      return out;
    })
    .join('');
}

/** What the tests counted, compared with the prototype's at REDLINES_FUZZ=4000. */
interface Counts {
  tried: number;
  today: number;
  rule: number;
  newRefusals: number;
  /** Edits that the word form writes other than asked, written so by the rule as well. */
  todayOtherwise: number;
  ordersChecked: number;
  marksToday: number;
  marksRule: number;
  fewer: number;
}

/**
 * Writes `oldStr` as `newStr` in `doc` both ways and checks the rule's form: it is written when
 * the word form is; the newest view reads as asked (or, where the word form reads otherwise, it is
 * the word form) and the original is the same bytes; rejecting
 * everything gives the original back; every order of deciding the new marks gives one text for
 * each set of decisions; every other mark is decided exactly when it could be before; another
 * person's marks keep their ids, kinds, authors and text; and there are no more marks than in the
 * word form.
 */
function check(
  label: string,
  doc: string,
  oldStr: string,
  newStr: string,
  seed: number,
  counts: Counts,
) {
  counts.tried++;
  const [first, second] = twice(seed);
  const today = wordForm(doc, oldStr, newStr, first);
  if (today) counts.today++;
  let edits: ReturnType<typeof suggestReplace>;
  try {
    edits = suggestReplace(doc, oldStr, newStr, second);
  } catch (error) {
    if (!(error instanceof EditError)) throw error;
    if (today) counts.newRefusals++;
    expect(today, `${label}: refused, and the word form is not`).toBeUndefined();
    return;
  }
  counts.rule++;
  const out = applyChanges(doc, edits.changes);
  const view = newestView(doc).text;
  const eol = eolOf(doc);
  const asked = view.replace(inEol(oldStr, eol), () => inEol(newStr, eol));
  if (paragraphBreaks(newestView(out).text) !== paragraphBreaks(asked)) {
    // Only where the word form itself reads otherwise, and the rule wrote it as it is today.
    counts.todayOtherwise++;
    expect(today, `${label}: reads otherwise`).toBeDefined();
    expect(out, `${label}: reads otherwise, and not as today`).toBe(
      applyChanges(doc, today?.changes ?? []),
    );
  }
  expect(originalView(out).text, label).toBe(originalView(doc).text);
  expect(newestView(applyChanges(out, rejectAll(out))).text, label).toBe(originalView(doc).text);
  expectInOrder(
    label,
    parse(doc).ledger.comments.map((t) => t.id),
    out,
  );
  if (edits.markIds.length <= 4) {
    counts.ordersChecked++;
    for (const [decided, results] of orders(out, edits.markIds)) {
      expect(results.size, `${label}: ${decided}`).toBe(1);
    }
  }
  const before = parse(doc);
  const after = parse(out);
  const todayAfter = today ? parse(applyChanges(doc, today.changes)) : undefined;
  for (const mark of before.marks) {
    if (mark.kind === 'cmt') continue;
    for (const decide of [accept, reject]) {
      expect(decides(out, mark.id, decide), `${label}: ${mark.id}`).toBe(
        decides(doc, mark.id, decide),
      );
    }
    if (mark.entry.by === claudeAda.handle) continue;
    const now = after.marks.find((other) => other.id === mark.id);
    expect(now?.kind, `${label}: ${mark.id}`).toBe(mark.kind);
    expect(now?.entry.by, `${label}: ${mark.id}`).toBe(mark.entry.by);
    expect(now?.payload, `${label}: ${mark.id}`).toBe(mark.payload);
    // Their text is what the word form leaves of it, which changes it only where the agent asked.
    const then = todayAfter?.marks.find((other) => other.id === mark.id);
    if (now && then && todayAfter) {
      expect(textOf(after, now), `${label}: ${mark.id}`).toBe(textOf(todayAfter, then));
    }
  }
  if (today) {
    counts.marksToday += today.markIds.length;
    counts.marksRule += edits.markIds.length;
    if (edits.markIds.length < today.markIds.length) counts.fewer++;
    expect(edits.markIds.length, `${label}: more marks`).toBeLessThanOrEqual(today.markIds.length);
  }
}

const zero = (): Counts => ({
  tried: 0,
  today: 0,
  rule: 0,
  newRefusals: 0,
  todayOtherwise: 0,
  ordersChecked: 0,
  marksToday: 0,
  marksRule: 0,
  fewer: 0,
});

/** Prints the counts on a long run, for the PR. */
function report(name: string, counts: Counts) {
  if (process.env['REDLINES_FUZZ']) console.log(name, counts);
}

/** `text` with each word replaced by a random one with chance `density`. */
const rewritten = (text: string, density: number, random: () => number) =>
  (text.match(TOKEN) ?? [])
    .map((token) =>
      /^[\p{L}\p{N}]/u.test(token) && random() < density
        ? (WORDS[Math.floor(random() * WORDS.length)] ?? token)
        : token,
    )
    .join('');

describe('the joining rule on random documents', { timeout: 1_200_000 }, () => {
  it('writes every edit that today’s form writes, as asked, and gives back every byte', () => {
    const counts = zero();
    const documents = fuzzCount(150);
    for (let seed = 1; seed <= documents; seed++) {
      // As the prototype's random run made them: a random stretch of one line of the newest text,
      // its words rewritten at a random density.
      const random = seeded(seed);
      const doc = randomDocument(random);
      const newest = newestView(doc).text;
      const lines = newest.split('\n').filter((line) => /\p{L}.*\s.*\p{L}/u.test(line));
      if (lines.length === 0) continue;
      const line = lines[Math.floor(random() * lines.length)] ?? '';
      const tokens = line.match(TOKEN) ?? [];
      const a = Math.floor(random() * tokens.length);
      const b = a + 1 + Math.floor(random() * (tokens.length - a));
      const oldStr = tokens.slice(a, b).join('');
      if (!oldStr.trim() || newest.split(oldStr).length !== 2) continue;
      const newStr = rewritten(oldStr, random(), random);
      if (newStr === oldStr) continue;
      check(`seed ${seed}: ${JSON.stringify([oldStr, newStr])}`, doc, oldStr, newStr, seed, counts);
    }
    report('one block', counts);
    expect(counts.newRefusals).toBe(0);
    expect(counts.fewer).toBeGreaterThan(0);
  });

  it('does the same for edits of several blocks', () => {
    const counts = zero();
    const documents = fuzzCount(150);
    /** A blank line, a line that starts a block, or a cell's pipe: where a stretch's blocks part. */
    const BREAK = /(\n[ \t]*\n[ \t]*|\n(?=[ \t]*(?:[-*+>#|]|\d+[.)]))| \| )/;
    for (let seed = 1; seed <= documents; seed++) {
      const random = seeded(seed * 7919);
      const below = (n: number) => Math.floor(random() * n);
      const doc =
        below(3) === 0
          ? listDocument(random)
          : randomDocument(random, { indentedCode: below(4) === 0 });
      const newest = newestView(doc).text;
      // A stretch from a word of one line to a word of a line after it, one to three lines on.
      const starts = [...newest.matchAll(/\p{L}+/gu)].map((match) => match.index);
      const from = starts[below(starts.length)];
      if (from === undefined) continue;
      const lineEnd = newest.indexOf('\n', from);
      if (lineEnd === -1) continue;
      let end = lineEnd;
      for (let n = below(3); n > 0 && newest.indexOf('\n', end + 1) !== -1; n--) {
        end = newest.indexOf('\n', end + 1);
      }
      const tail = newest.indexOf('\n', end + 1);
      const words = [...newest.slice(end, tail === -1 ? newest.length : tail).matchAll(/\p{L}+/gu)];
      const last = words[below(words.length)];
      if (!last) continue;
      const oldStr = newest.slice(from, end + last.index + last[0].length);
      if (newest.split(oldStr).length !== 2) continue;
      // Each block rewritten or not, and now and then a break added or taken away.
      const pieces = oldStr.split(BREAK);
      let newStr = pieces
        .map((piece, k) =>
          k % 2 === 1 || below(2) === 0 ? piece : rewritten(piece, 0.3 + random() * 0.7, random),
        )
        .join('');
      const roll = below(6);
      if (roll === 0) newStr = newStr.replace(/ (?=\p{L})/u, '\n\n');
      if (roll === 1) newStr = newStr.replace(/\n[ \t]*\n[ \t]*/, ' ');
      if (newStr === oldStr) continue;
      check(`seed ${seed}: ${JSON.stringify([oldStr, newStr])}`, doc, oldStr, newStr, seed, counts);
    }
    report('several blocks', counts);
    expect(counts.newRefusals).toBe(0);
  });
});
