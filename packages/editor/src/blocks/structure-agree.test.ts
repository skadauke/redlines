// @vitest-environment happy-dom
// The block structure, read from lezer's tree, against micromark 4.0.2, the format's oracle
// (design: block editing, "Reading the blocks"): on the format's random documents, every block
// `blockAt` finds starts and ends on the lines where micromark's does, and is of the same kind.
// Where the two read differently, the case is recorded below, with what the keys do there.

import { forceParsing } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import { parse, postprocess, preprocess } from 'micromark';
import { afterAll, describe, expect, it } from 'vitest';
import {
  fuzzCount,
  listDocument,
  randomDocument,
  seeded,
} from '../../../format/src/random-docs.ts';
import { createEditor, type Editor } from '../index.ts';
import { parsedField } from '../tracked/field.ts';
import { blockAt, formatReading, isGapLine } from './structure.ts';

/** A block as the lines it is on (counted from 1) and its kind. */
type Read = `${number}-${number} ${string}`;

const MICROMARK_KINDS: Record<string, string> = {
  paragraph: 'paragraph',
  atxHeading: 'heading',
  setextHeading: 'heading',
  codeFenced: 'code',
  codeIndented: 'code',
  htmlFlow: 'html',
  thematicBreak: 'rule',
  definition: 'definition',
};

/** One editor for every document, opened afresh on each: editors are slow to make in numbers. */
let shared: Editor | null = null;

afterAll(() => shared?.destroy());

/** The state of an editor on `doc`, parsed to its end, as the editor's keys read it. */
function stateOf(doc: string): EditorState {
  shared ??= createEditor(document.createElement('div'), {
    doc: '',
    author: { handle: 'ada', name: 'Ada Lovelace' },
  });
  shared.setDoc(doc);
  forceParsing(shared.view, shared.view.state.doc.length, 10_000);
  return shared.view.state;
}

/** The leaf blocks micromark reads. */
function micromarkBlocks(doc: string): Read[] {
  const events = postprocess(
    parse()
      .document()
      .write(preprocess()(doc, undefined, true)),
  );
  const blocks: Read[] = [];
  for (const [kind, token] of events) {
    const name = MICROMARK_KINDS[token.type];
    if (kind !== 'enter' || !name) continue;
    // A token ends at the start of the line after it when it ends with a line ending.
    const end = token.end.column === 1 && token.end.line > token.start.line ? -1 : 0;
    blocks.push(`${token.start.line}-${token.end.line + end} ${name}`);
  }
  return blocks;
}

/** The blocks `blockAt` finds on the document's lines, each once. */
function structureBlocks(state: EditorState): Read[] {
  const { doc } = state;
  const found = new Set<Read>();
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n);
    if (isGapLine(state, line)) continue;
    const block = blockAt(state, line.from);
    if (!block) continue;
    const first = doc.lineAt(block.lines.from).number;
    const last = doc.lineAt(block.lines.to).number;
    const kind = block.kind === 'math' ? 'paragraph' : block.kind;
    found.add(`${first}-${last} ${kind}`);
  }
  return [...found];
}

/** The lines (from 1) of the leading front matter, which micromark reads as other blocks. */
function frontMatterLines(doc: string): number {
  const lines = doc.split('\n');
  if (lines[0] !== '---') return 0;
  const close = lines.findIndex((line, i) => i > 0 && /^(---|\.\.\.)$/.test(line));
  return close > 0 ? close + 1 : 0;
}

/** A read's lines, from 1. */
const linesOf = (read: Read) => read.split(' ')[0]!.split('-').map(Number) as [number, number];

/**
 * Where the two read differently, outside the front matter: micromark's blocks of markers alone
 * and of the ledger, which are no blocks to the structure, are left out.
 */
function compare(state: EditorState): { missing: Read[]; extra: Read[] } {
  const doc = state.doc.toString();
  const front = frontMatterLines(doc);
  const inBody = (read: Read) => linesOf(read)[0] > front;
  const ledger = state.field(parsedField).ledgerRange;
  const gap = (read: Read) => {
    const [first, last] = linesOf(read);
    for (let n = first; n <= last; n++) {
      const line = state.doc.line(n);
      if (!isGapLine(state, line) && !(ledger && line.from >= ledger.from)) return false;
    }
    return true;
  };
  const ours = structureBlocks(state).filter(inBody);
  // A table is GFM's: micromark's core reads its lines as a paragraph, or as the lines of the
  // paragraph above it, which the table's header row ends in GFM.
  const tables = ours.filter((read) => read.endsWith(' table')).map(linesOf);
  const theirs = micromarkBlocks(doc)
    .filter((read) => inBody(read) && !gap(read))
    .flatMap((read): Read[] => {
      if (!read.endsWith(' paragraph')) return [read];
      const [first, last] = linesOf(read);
      const table = tables.find(([from, to]) => from <= last && to >= first);
      if (!table) return [read];
      return table[0] > first ? [`${first}-${table[0] - 1} paragraph`] : [];
    });
  return {
    missing: theirs.filter((read) => !ours.includes(read)),
    extra: ours.filter((read) => !theirs.includes(read) && !read.endsWith(' table')),
  };
}

/**
 * Whether line `n` comes after a table that interrupts the block above it (no blank line between),
 * with no block at the top level starting between: GFM's table ends a paragraph or a list there,
 * which micromark's core goes on with, lazily, so the two read the lines after it differently.
 */
function afterInterruptingTable(state: EditorState, ours: Read[], n: number): boolean {
  const { doc } = state;
  const blank = (k: number) => /^[ \t>]*$/.test(doc.line(k).text);
  const table = ours
    .filter((read) => read.endsWith(' table'))
    .map(linesOf)
    .filter(([, last]) => last < n)
    .at(-1);
  if (!table || table[0] === 1 || blank(table[0] - 1)) return false;
  for (let k = table[1] + 1; k < n; k++) {
    if (blank(k - 1) && /^[^ \t]/.test(doc.line(k).text)) return false;
  }
  return true;
}

/**
 * Why lezer and micromark read the blocks of a document differently: null where they agree (tables
 * aside, which are GFM's); `a table` after a table that GFM lets interrupt the block above it, which
 * micromark's core reads as text; `deferred` where the format's block reading, which the keys defer to, reads each block of
 * lezer's involved otherwise or not at all. Anything else is a difference the keys wouldn't know
 * of, given as the document and the two readings.
 */
function recorded(state: EditorState): string | null {
  const difference = compare(state);
  if (!difference.missing.length && !difference.extra.length) return null;
  const { doc } = state;
  const involved = new Set<Read>(difference.extra);
  const ours = structureBlocks(state);
  for (const read of difference.missing) {
    const [first, last] = linesOf(read);
    for (const block of ours) {
      const [from, to] = linesOf(block);
      if (from <= last && to >= first) involved.add(block);
    }
  }
  if ([...involved].every((read) => afterInterruptingTable(state, ours, linesOf(read)[0]))) {
    return 'a table';
  }
  const readings = [...involved].map((read) => {
    const block = blockAt(state, doc.line(linesOf(read)[0]).from)!;
    return formatReading(state, block);
  });
  if (readings.every((reading) => reading !== 'agrees')) return 'deferred';
  return `${JSON.stringify(doc.toString())}: micromark ${JSON.stringify(difference.missing)}, lezer ${JSON.stringify(difference.extra)}`;
}

describe('the block structure against micromark', () => {
  it('reads the blocks of a few documents alike', () => {
    for (const doc of [
      'One.\n\nTwo.\n',
      '## Head\nPara.\n\n- a\n- b\n\n  p2\n\n> q\nlazy\n\n---\n\n```js\nx\n\ny\n```\n',
      '1. one\n   - sub\n\n   ```\n   code\n   ```\n2. two\n',
      'Para\n<div>\nx\n</div>\n\n[a]: https://x.example\n',
    ]) {
      expect(recorded(stateOf(doc)), doc).toBeNull();
    }
  });

  const runs = fuzzCount(150);
  it.each([
    ['random documents', (random: () => number) => randomDocument(random)],
    [
      'random documents with indented code',
      (random: () => number) => randomDocument(random, { indentedCode: true }),
    ],
    ['list documents', listDocument],
  ])(
    `reads the blocks of ${runs} %s as micromark does`,
    (_, make) => {
      const unexplained: string[] = [];
      const counts = { agree: 0, table: 0, deferred: 0 };
      for (let seed = 1; seed <= runs; seed++) {
        const why = recorded(stateOf(make(seeded(seed))));
        if (why === null) counts.agree++;
        else if (why === 'a table') counts.table++;
        else if (why === 'deferred') counts.deferred++;
        else unexplained.push(`seed ${seed}: ${why}`);
      }
      expect(unexplained).toEqual([]);
      expect(counts.agree).toBeGreaterThan(runs / 2);
    },
    5_000 + runs * 10,
  );
});
