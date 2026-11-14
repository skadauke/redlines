// Random block changes of a paragraph you just typed (format §2.6, "Your own pending changes don't
// count", #173): Ada types a paragraph with Track Changes on, in the places the editor writes one (after
// a block, in front of one, between two, in an empty file), someone makes a change next to it or in it,
// and Ada changes its type with the caret at the start, in the middle, at the end or past the hidden
// closer of her insertion, or a selection of it. Whatever is written reads as micromark 4.0.2 with
// GFM reads it without the change, in every order of every decision: the typed block as asked, every
// other block as it was. Whatever is refused says why, and nothing is a silent no-op.

import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { EditError } from './errors.ts';
import type { BlockType, FormatOp } from './format-ops.ts';
import { trackedFormat } from './formatting.ts';
import { parse } from './parse.ts';
import { fuzzCount, seeded } from './random-docs.ts';
import { decidable, expectSameWords, expectSampledDecisions } from './own-block-oracle.ts';
import { LINE_PREFIX, trackedEdits } from './track.ts';
import {
  REFUSALS,
  TIME,
  ada,
  blockLeaves,
  bo,
  bodyOf,
  exactly,
  expectEveryDecision,
  expectEveryOrderAlike,
  expectNoNewLineStarts,
  file,
  problemsOf,
  viewBlocks,
} from './test-helpers.ts';
import type { EditContext, Person, Range } from './types.ts';
import { newestView } from './views.ts';

/** The blocks of the file Ada types in. */
const BLOCKS = [
  'One two three.',
  'Wrapped line one\nwrapped line two',
  '# Title here',
  '## Section here',
  '- item one\n- item two',
  '1. first\n2. second',
  '> quoted line\n> more quoted',
  'Some *emphasis* and `code` here.',
  '```sh\nredlines open\n```',
  '| a | b |\n| - | - |\n| c | d |',
  '- [ ] task one\n- [x] task two',
  '---',
  'Last words.',
  // What reads differently once the first line of a block has the new syntax in front of it.
  'Run this:\n\n    npm install',
  '- a\n\n  para\n- b',
  '> 1. a\n> 2. b',
  'Text\n- -',
  'Text\n```x`y\nmore',
  'Line one\n---',
  'Text\n| - |',
];

/** What Ada types in front of a word that is only hers, which finds her paragraph again. */
const HEADS = ['A', 'Typed words', 'A new paragraph here', 'Brand new title', 'café éclair', 'x y'];

const TYPES: readonly BlockType[] = [
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'quote',
  'ul',
  'ol',
  'task',
  'p',
];

/** The type each block type writes, as a leaf of micromark's reading says it. */
const LEAF: Record<string, { kind: string; chain: string }> = {
  p: { kind: 'p', chain: '' },
  h1: { kind: 'h1', chain: '' },
  h2: { kind: 'h2', chain: '' },
  h3: { kind: 'h3', chain: '' },
  h4: { kind: 'h4', chain: '' },
  h5: { kind: 'h5', chain: '' },
  h6: { kind: 'h6', chain: '' },
  quote: { kind: 'p', chain: 'blockquote' },
  ul: { kind: 'p', chain: 'ul>li' },
  ol: { kind: 'p', chain: 'ol>li' },
  task: { kind: 'p', chain: 'ul>li' },
};

/** Where the text of the body ends: the editor never puts a caret after it, in the ledger. */
const bodyEnd = (text: string) => bodyOf(text).replace(/\s+$/, '').length;

describe('random block changes of a paragraph you just typed', () => {
  function run(first: number, last: number) {
    const stats = new Map<string, number>();
    const count = (name: string) => stats.set(name, (stats.get(name) ?? 0) + 1);
    for (let seed = first; seed <= last; seed++) {
      const random = seeded(seed * 7919);
      const below = (n: number) => Math.floor(random() * n);
      const pick = <T>(items: readonly T[]) => items[below(items.length)] as T;
      const bytes = (n: number) => Uint8Array.from({ length: n }, () => below(256));
      const context = (author: Person): EditContext => ({ author, time: TIME, random: bytes });
      const token = `Zq${seed}`;
      const words = `${pick(HEADS)} ${token}`;
      const blocks = Array.from({ length: 1 + below(3) }, () => pick(BLOCKS));
      let text = file(`${blocks.join('\n\n')}`, {});
      // Ada types her paragraph, as the editor writes one.
      const form = below(6);
      try {
        const view = newestView(text);
        // The blocks of the body, which the file has no marks in yet: the view is the source.
        const found = viewBlocks(blocks.join('\n\n'));
        const block = pick(found);
        if (form === 0 || form === 5 || found.length === 0) {
          // After the last block, or in an empty file; with `form` 5, a document typed in one go:
          // several paragraphs, one of them the one with the token.
          const at = found.length === 0 ? 0 : (found[found.length - 1] as { end: number }).end;
          const paragraphs = Array.from({ length: 3 + below(6) }, (_, i) => `Other ${i} words`);
          paragraphs[below(paragraphs.length)] = words;
          const typed = form === 5 ? paragraphs.join('\n\n') : words;
          const insert = found.length === 0 ? typed : `\n\n${typed}`;
          const place = Math.min(view.map.toSource(at, -1), bodyEnd(text));
          text = applyChanges(
            text,
            trackedEdits(text, [{ from: place, to: place, insert }], context(ada)).changes,
          );
        } else if (form === 1 || form === 2) {
          // At the end of a block: Return, then the words.
          const place = Math.min(view.map.toSource(block.end, form === 1 ? -1 : 1), bodyEnd(text));
          text = applyChanges(
            text,
            trackedEdits(text, [{ from: place, to: place, insert: `\n\n${words}` }], context(ada))
              .changes,
          );
        } else if (form === 3) {
          // At the start of a block: the words, then Return.
          const place = Math.min(view.map.toSource(block.text, 1), bodyEnd(text));
          text = applyChanges(
            text,
            trackedEdits(text, [{ from: place, to: place, insert: `${words}\n\n` }], context(ada))
              .changes,
          );
        } else {
          // Between two blocks, the opener alone on its line, as the editor writes a paragraph
          // that it opened between them.
          const at = below(blocks.length + 1);
          const before = blocks.slice(0, at);
          const after = blocks.slice(at);
          const body = [...before, `<!--ins k3x9-->\n\n${words}<!--/k3x9-->`, ...after].join(
            '\n\n',
          );
          text = file(body, { k3x9: 'ada' });
        }
      } catch (error) {
        if (error instanceof EditError || error instanceof RangeError) {
          count('typing refused');
          continue;
        }
        throw error;
      }
      // Someone makes a change next to it or in it, or Ada does: before her token or after it.
      for (let step = below(3); step > 0; step--) {
        try {
          const view = newestView(text);
          const spot = view.text.indexOf(token);
          if (spot < 0) break;
          const edge = spot + token.length;
          const lineStart = view.text.lastIndexOf('\n', spot - 1) + 1;
          const before = [lineStart - 3, lineStart - 1, lineStart, lineStart + 1, spot - 1, spot];
          const afterwards = [edge, edge + 1, edge + 3];
          const at = pick(below(3) === 0 ? afterwards : before.concat(before, afterwards));
          if (at < 0 || at > view.text.length) continue;
          const author = pick([bo, bo, ada]);
          const kind = below(3);
          const length = at < spot ? Math.min(1 + below(3), spot - at) : 1 + below(3);
          const from = Math.min(view.map.toSource(at, below(2) === 0 ? -1 : 1), bodyEnd(text));
          const to = Math.min(
            view.map.toSource(Math.min(at + length, view.text.length), 1),
            bodyEnd(text),
          );
          const edit =
            kind === 0
              ? { from, to: from, insert: pick(['new ', 'x', '\n\nmore']) }
              : kind === 1
                ? { from, to: Math.max(from, to), insert: '' }
                : { from, to: Math.max(from, to), insert: 'y' };
          text = applyChanges(text, trackedEdits(text, [edit], context(author)).changes);
        } catch (error) {
          if (!(error instanceof EditError || error instanceof RangeError)) throw error;
        }
      }
      // Ada changes the paragraph's type.
      const view = newestView(text);
      const spot = view.text.indexOf(token);
      if (spot < 0 || view.text.indexOf(token, spot + 1) >= 0) {
        count('typed words lost');
        continue;
      }
      const to = pick(TYPES);
      const op: FormatOp = { kind: 'block', to };
      // The start of the paragraph's text, after the syntax of its block (`> `, `- `, `## `).
      const lineAt = view.text.lastIndexOf('\n', spot - 1) + 1;
      const lineStart = lineAt + (LINE_PREFIX.exec(view.text.slice(lineAt, spot))?.[0].length ?? 0);
      // The middle is inside the token, in the text: the caret never rests in front of the hidden marker
      // that starts a paragraph, where a block change finds no paragraph (#420).
      const positions = { start: lineStart, middle: spot + 2, end: spot + token.length };
      const where = pick(['start', 'middle', 'end', 'end', 'selected'] as const);
      // A caret stands where the text is: at its start after the hidden markers in front of it (the
      // editor never puts one in front of a marker that starts a paragraph), and at its end on
      // either side of the markers behind it.
      const one = view.map.toSource(
        where === 'selected' ? lineStart : positions[where],
        where === 'start' || where === 'selected' ? 1 : below(2) === 0 ? -1 : 1,
      );
      const two =
        where === 'selected'
          ? view.map.toSource(spot + token.length, below(2) === 0 ? -1 : 1)
          : one;
      const range: Range = {
        from: Math.min(one, two, bodyEnd(text)),
        to: Math.min(Math.max(one, two), bodyEnd(text)),
      };
      const label = `seed ${seed}: ${to} at ${where} ${JSON.stringify(range)} in ${JSON.stringify(bodyOf(text))}`;
      let result;
      try {
        result = trackedFormat(text, range, op, context(ada));
      } catch (error) {
        if (error instanceof EditError && REFUSALS.includes(error.code ?? '')) {
          expect(error.message.trim().length, `${label}: says why`).toBeGreaterThan(10);
          count(`refused: ${error.message.slice(0, 48)}`);
          continue;
        }
        throw new Error(`${label}: ${String(error)}`, { cause: error });
      }
      const detail = `${label}\n=> ${JSON.stringify(bodyOf(applyChanges(text, result.changes)))}`;
      if (result.changes.length === 0) {
        // Nothing to change is no refusal, but only where the paragraph has that type already.
        const leaf = blockLeaves(newestView(text).text).find((l) => l.text.includes(token));
        const want = LEAF[to] as { kind: string; chain: string };
        const boxed = /^\[[ xX]\] /.test(leaf?.text ?? '');
        // A quote asked of what is in a quote already is left as it is.
        const chain = leaf?.chain.join('>') ?? '';
        expect(
          leaf !== undefined &&
            leaf.kind === want.kind &&
            (to === 'quote' ? chain.includes('blockquote') : chain === want.chain) &&
            (to === 'task' ? boxed : to === 'ul' || to === 'ol' ? !boxed : true),
          `${label}: a silent no-op, and the paragraph is ${JSON.stringify(leaf)}`,
        ).toBe(true);
        count('already that type');
        continue;
      }
      const after = applyChanges(text, result.changes);
      expect(problemsOf(parse(after)), detail).toEqual([]);
      expectNoNewLineStarts(label, parse(text), parse(after));
      if (result.markIds.length === 0) {
        // Typed into her own insertion: every order of every decision reads as it does without the
        // syntax, the typed block as asked, and the same in every order; for a document with more
        // marks than every order can be tried for (typed in one go), random orders.
        if (decidable(after).length <= 6) {
          expectEveryDecision(label, text, after, [], {
            inPlace: true,
            structure: op,
            alsoChanged: 1,
            limit: 7,
          });
          expectEveryOrderAlike(label, after, exactly);
          expectEveryOrderAlike(label, after);
          expectSameWords(label, text, after);
        } else {
          expectSampledDecisions(label, text, after, op, seed, 8);
        }
        count('typed into the insertion');
      } else {
        const reshaped = parse(text).marks.filter(
          (mark) =>
            parse(after).marks.find((other) => other.id === mark.id)?.segments.length !==
            mark.segments.length,
        ).length;
        expectEveryDecision(label, text, after, result.markIds, {
          structure: op,
          inPlace: result.extendedIds.length > 0 || reshaped > 0,
          alsoChanged: result.extendedIds.length + reshaped,
          limit: 7,
        });
        count('made a mark');
      }
    }
    return stats;
  }

  it('reads alike in every order of decisions, and every refusal says why', () => {
    const total = fuzzCount(150);
    const stats = run(1, total);
    if (process.env['REDLINES_FUZZ']) {
      console.log('own-block-random:', JSON.stringify([...stats].sort()));
    }
    // Most paragraphs typed by Ada take the syntax as typed text.
    expect(stats.get('typed into the insertion') ?? 0, JSON.stringify([...stats])).toBeGreaterThan(
      total / 8,
    );
  }, 120_000);
});
