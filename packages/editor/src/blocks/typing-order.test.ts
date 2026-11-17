// @vitest-environment happy-dom
// Typed words keep their order after a block key (#508). Stephan sometimes sees letters typed
// backwards (`cba` for `abc`) right after an indent change or a Return in a long document with
// lists: the sign of a caret that does not advance, so that each letter goes in at the same place.
// This suite puts the caret in an item of a complicated random document (lists nested two to four
// deep, bullets, numbers and tasks, loose and tight, items with a second paragraph, other people's
// pending marks and comments in and next to the items, tables, quotes and code around them),
// presses one block key, and types a word of distinct letters one keystroke at a time, each its
// own transaction as the keyboard's input reaches the editor. After the word: the newest view is
// what it was after the key with the word put in where the caret stood (so the word is whole, in
// order, where the caret was), the caret stands right after its last letter, and every invariant
// of the suite that the starting document holds still holds.
//
// What it can't see: a race of timing in WebKit (keys that arrive before the DOM selection is
// written), since every step here is synchronous. It sees the state's side of that: a caret that
// is wrong in the state itself. Seeded, so a failure repeats; `REDLINES_FUZZ` for more seeds,
// `TYPING_SEED=n` for one seed (with its steps printed).
import { encodePayload, newestView } from '@redlines/format';
import { expect, it } from 'vitest';
import { fuzzCount, seeded } from '../../../format/src/random-docs.ts';
import { openBlock } from './open.ts';
import {
  type Invariant,
  invariantProblems,
  notation,
  runScript,
  type Script,
  settle,
  type Step,
} from './script.ts';

/**
 * Seeds that fail, each with the issue that holds its cause, skipped so that main stays green. A
 * skip that no longer fails is reported, so that it is taken away. These are found by the longer
 * runs (`REDLINES_FUZZ=300`), not the default one.
 */
const KNOWN: ReadonlyMap<number, string> = new Map<number, string>([
]);

const SEEDS = fuzzCount(45);
/** The invariants cost ten times the typing check: by default every third seed has them. */
const EVERY = process.env['REDLINES_FUZZ'] ? 1 : 3;

const PLAIN = ['alpha', 'beta', 'gamma', 'delta', 'plan', 'ship', 'review', 'note', 'text', 'code'];
const MARK_CHARS = 'bcdfghjkmnpqrstvwxz23456789';
const SENTINEL = '⌖';

interface Line {
  /** What stands before the item's text on this line: quote marker, indent, bullet. */
  prefix: string;
  text: string;
  /** Offsets in `text` where the caret may go (never inside a marker). */
  carets?: { start: number; end: number; middle: number[]; nextToMark: number[] };
}

interface Generated {
  doc: string;
  /** The document with the caret placed. */
  withCaret: string;
  where: string;
}

function generate(seed: number): Generated {
  const random = seeded(seed * 7919 + 17);
  const below = (n: number) => Math.floor(random() * n);
  const pick = <T>(items: readonly T[]): T => items[below(items.length)] as T;
  const words = (n: number) => Array.from({ length: n }, () => pick(PLAIN)).join(' ');

  let counter = 0;
  const id = () => {
    counter++;
    const a = MARK_CHARS[counter % MARK_CHARS.length]!;
    const b = MARK_CHARS[Math.floor(counter / MARK_CHARS.length) % MARK_CHARS.length]!;
    return `m${a}${b}${MARK_CHARS[below(MARK_CHARS.length)]}`;
  };
  const marks: string[] = [];
  const comments: string[] = [];

  /** A mark by another author, as a piece of text. */
  const mark = (): string => {
    const mid = id();
    marks.push(`  ${mid}: {by: bo, at: 2026-10-13T22:35Z}`);
    switch (below(6)) {
      case 0:
        return `<!--ins ${mid}-->${words(1 + below(2))}<!--/${mid}-->`;
      case 1:
        return `<!--del ${mid} ${encodePayload(words(1 + below(2)))}-->`;
      case 2:
        return `<!--sub ${mid} ${encodePayload(words(1))}-->${words(1)}<!--/${mid}-->`;
      case 3:
        return `<!--fmt ${mid} +bold-->**${pick(PLAIN)}**<!--/${mid}-->`;
      case 4:
        return `<!--fmt ${mid} +italic-->*${pick(PLAIN)}*<!--/${mid}-->`;
      default: {
        // A comment: its thread is in the ledger, not among the marks.
        marks.pop();
        const tid = `m${MARK_CHARS[below(MARK_CHARS.length)]}c${MARK_CHARS[below(MARK_CHARS.length)]}`;
        if (comments.some((c) => c.includes(`  ${tid}:`))) return pick(PLAIN);
        comments.push(`  ${tid}:\n    by: bo\n    at: 2026-10-13T22:40Z\n    text: Check this.`);
        return below(4) === 0
          ? `<!--cmt ${tid}-->`
          : `<!--cmt ${tid}-->${pick(PLAIN)}<!--/${tid}-->`;
      }
    }
  };

  /** The text of an item or a paragraph, with 0 to 2 marks, and where the caret may go in it. */
  const content = (marked: boolean): NonNullable<Line['carets']> & { text: string } => {
    let text = '';
    const middle: number[] = [];
    const nextToMark: number[] = [];
    const plain = () => {
      const w = words(1 + below(3));
      if (w.length > 2) middle.push(text.length + 1 + below(w.length - 2));
      text += w;
    };
    plain();
    for (let n = marked ? [0, 0, 1, 1, 2][below(5)]! : 0; n > 0; n--) {
      text += below(5) === 0 ? '' : ' ';
      nextToMark.push(text.length);
      text += mark();
      nextToMark.push(text.length);
      text += below(5) === 0 ? '' : ' ';
      plain();
    }
    return { text, start: 0, end: text.length, middle, nextToMark };
  };

  const items: Line[] = [];

  const list = (indent: string, depth: number, maxDepth: number, quote: string): Line[] => {
    const lines: Line[] = [];
    const ordered = below(3) === 0;
    const kind = below(4);
    const loose = below(3) === 0;
    const count = 1 + below(3);
    for (let i = 0; i < count; i++) {
      const bullet = ordered ? `${i + 1}. ` : pick(['- ', '* ', '+ ']);
      const task = !ordered && kind === 0 ? pick(['[ ] ', '[x] ']) : '';
      const pad = indent + ' '.repeat(ordered ? bullet.length : 2);
      const body = content(true);
      const line: Line = {
        prefix: quote + indent + bullet + task,
        text: body.text,
        carets: body,
      };
      lines.push(line);
      items.push(line);
      if (below(4) === 0) {
        lines.push({ prefix: quote, text: '' });
        const second = content(true);
        const l2: Line = { prefix: quote + pad, text: second.text, carets: second };
        lines.push(l2);
        items.push(l2);
      }
      if (depth < maxDepth && items.length < 9 && (depth < 2 || below(2) === 0)) {
        if (loose) lines.push({ prefix: quote, text: '' });
        lines.push(...list(pad, depth + 1, maxDepth, quote));
      }
      if (loose && i < count - 1) lines.push({ prefix: quote, text: '' });
    }
    return lines;
  };

  const around = (): string[] => {
    switch (below(5)) {
      case 0:
        return [`${words(4)}`];
      case 1:
        return ['| a | b |', '| - | - |', `| ${pick(PLAIN)} | ${pick(PLAIN)} |`];
      case 2:
        return [`> ${words(3)}`, `> ${words(2)}`];
      case 3:
        return ['```', `${words(2)}`, '```'];
      default:
        return [`## ${words(2)}`];
    }
  };

  // Blocks, each a list of lines with their carets, joined by blank lines.
  const blocks: Line[][] = [];
  for (let n = 2 + below(2); n > 0; n--) {
    if (items.length >= 9 || below(3) === 0)
      blocks.push(around().map((text) => ({ prefix: '', text })));
    else {
      const maxDepth = 2 + below(3);
      const quote = below(6) === 0 ? '> ' : '';
      blocks.push(list('', 1, maxDepth, quote));
    }
  }
  if (!items.length) blocks.push(list('', 1, 3, ''));

  const lines: Line[] = [];
  blocks.forEach((block, i) => {
    if (i > 0) lines.push({ prefix: '', text: '' });
    lines.push(...block);
  });
  const file = lines.map((l) => (l.text === '' ? l.prefix.trimEnd() : l.prefix + l.text));
  const body = file.join('\n');

  // The caret: an item line, a place in its text.
  const chosen = pick(items);
  const at = lines.indexOf(chosen);
  const carets = chosen.carets!;
  const place = pick(['start', 'end', 'middle', 'next']);
  const options =
    place === 'start'
      ? [carets.start]
      : place === 'end'
        ? [carets.end]
        : place === 'middle'
          ? carets.middle
          : carets.nextToMark;
  const offset = options.length ? pick(options) : carets.end;
  const kindOfPlace = options.length ? place : 'end';
  let from = 0;
  for (let i = 0; i < at; i++) from += file[i]!.length + 1;
  const caret = from + chosen.prefix.length + offset;

  const ledger = [
    '<!-- redlines',
    'version: 1',
    ...(marks.length ? ['marks:', ...marks] : []),
    ...(comments.length ? ['comments:', ...comments] : []),
    '-->',
  ].join('\n');
  const full = `${body}\n\n${ledger}\n`;
  return {
    doc: full,
    withCaret: `${body.slice(0, caret)}‸${body.slice(caret)}\n\n${ledger}\n`,
    where: `item line ${at + 1}, ${kindOfPlace}`,
  };
}

const BLOCK_KEYS: readonly (() => Step)[] = [
  () => 'Tab',
  () => 'Tab',
  () => 'Shift-Tab',
  () => 'Shift-Tab',
  () => 'Enter',
  () => 'Enter',
  () => 'Shift-Enter',
  () => 'Backspace',
  () => ({ paste: '- pasted one\n- pasted two\n' }),
  () => 'Alt-ArrowUp',
  () => 'Alt-ArrowDown',
  () => ({ agent: 'The agent wrote this.' }),
];

/** A word of `length` distinct letters. */
function word(random: () => number): string {
  const letters = [...'abcdefghijklmnopqrstuvwxyz'];
  const length = 6 + Math.floor(random() * 3);
  const out: string[] = [];
  while (out.length < length) {
    out.push(...letters.splice(Math.floor(random() * letters.length), 1));
  }
  return out.join('');
}

/** The newest view's text with the caret at `at` in the file as a sentinel, or null if it hides. */
function newestWithCaret(file: string, at: number): string | null {
  const text = newestView(file.slice(0, at) + SENTINEL + file.slice(at)).text.replaceAll(' ', '');
  return text.includes(SENTINEL) ? text : null;
}

const CHECKED: Invariant[] = [
  'hidden-caret',
  'empty-paragraph',
  'stray-blank-line',
  'render',
  'format',
  'line-start',
  'decisions',
  'list-reads',
  'open-caret',
  'file-text',
];

interface Outcome {
  problems: string[];
  steps: string;
  file: string;
}

/** Plays a seed's script; the problems it finds, none where it holds. */
function play(script: Script, letters: string, invariants: boolean): Outcome {
  let atKey: string | null = null;
  let openAfterKey = false;
  let afterKey = '';
  let stateAfter: { doc: string; head: number } | null = null;
  const problems: string[] = [];
  const result = runScript(script, {
    light: true,
    onStep(editor, i) {
      const { state } = editor.view;
      if (i === 0) {
        openAfterKey = openBlock(state) !== null;
        afterKey = state.doc.toString();
        atKey = newestWithCaret(afterKey, state.selection.main.head);
        if (state.selection.main.anchor !== state.selection.main.head) atKey = null;
      }
      if (i === script.keys.length - 1) {
        stateAfter = { doc: state.doc.toString(), head: state.selection.main.head };
      }
    },
  });
  const typed = script.keys.length - 1 === letters.length;
  if (typed && stateAfter && atKey !== null) {
    const { doc, head } = stateAfter as { doc: string; head: number };
    const now = newestWithCaret(doc, head);
    const want = (atKey as string).replace(SENTINEL, letters + SENTINEL);
    // Line breaks, indents and quote markers are no part of the word's place: a Return before another person's
    // mark leaves the new item's text on the line under its marker until the first letter, which
    // writes it after the marker (the letters, in order, at the caret, are what is checked).
    const bare = (text: string | null) => text?.replace(/[\s>]+/g, '') ?? null;
    if (bare(now) !== bare(want)) {
      problems.push(
        `typed ${letters}${openAfterKey ? ' (after an open empty block)' : ''}: the newest view with the caret is ${JSON.stringify(now)}, not ${JSON.stringify(want)}`,
      );
    }
  }
  if (invariants) {
    const before = invariantProblems(runScript({ ...script, keys: [] }, { light: true }));
    const after = invariantProblems(result);
    for (const invariant of CHECKED) {
      if (before[invariant].length || !after[invariant].length) continue;
      problems.push(`${invariant}: ${after[invariant].join('; ').slice(0, 400)}`);
    }
  }
  return { problems, steps: JSON.stringify(script.keys), file: result.file };
}

/** Takes lines out of the document while the typing check still fails. */
function shrink(script: Script, letters: string): string {
  let doc = script.doc;
  const fails = (candidate: string) => {
    if (!candidate.includes('‸')) return false;
    try {
      return play({ ...script, doc: candidate }, letters, false).problems.length > 0;
    } catch {
      return false;
    }
  };
  for (let pass = 0; pass < 3; pass++) {
    const lines = doc.split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i]!.includes('‸') || /^(<!--|-->|version|marks:|comments:)/.test(lines[i]!))
        continue;
      const without = [...lines.slice(0, i), ...lines.slice(i + 1)].join('\n');
      if (fails(without)) {
        doc = without;
        lines.splice(i, 1);
      }
    }
  }
  return doc;
}

it(`types a word in order after a block key, over ${SEEDS} seeds`, async () => {
  const failures: string[] = [];
  const stale: number[] = [];
  for (let seed = 1; seed <= SEEDS; seed++) {
    await settle();
    if (process.env['TYPING_SEED'] && Number(process.env['TYPING_SEED']) !== seed) continue;
    const random = seeded(seed * 104729 + 3);
    const { withCaret, where } = generate(seed);
    const key = BLOCK_KEYS[Math.floor(random() * BLOCK_KEYS.length)]!();
    const tc = random() < 0.5;
    const letters = word(random);
    const script: Script = {
      name: `seed ${seed}`,
      doc: withCaret,
      keys: [key, ...[...letters].map((type): Step => ({ type }))],
      tc,
      expect: {},
    };
    let outcome: Outcome;
    try {
      outcome = play(script, letters, seed % EVERY === 0);
    } catch (error) {
      outcome = { problems: [`threw ${String(error)}`], steps: '', file: '' };
    }
    const known = KNOWN.get(seed);
    if (known !== undefined) {
      if (!outcome.problems.length) stale.push(seed);
      continue;
    }
    if (!outcome.problems.length) continue;
    const small = shrink(script, letters);
    failures.push(
      [
        `seed ${seed} (${where}), Track Changes ${tc ? 'on' : 'off'}, key ${JSON.stringify(key)}, word ${letters}:`,
        ...outcome.problems.map((p) => `  ${p}`),
        `  document: ${notation(withCaret)}`,
        `  reduced:  ${notation(small)}`,
        `  file after: ${notation(outcome.file)}`,
      ].join('\n'),
    );
  }
  expect(stale, 'seeds in KNOWN that no longer fail: take them out').toEqual([]);
  expect(failures.join('\n\n')).toBe('');
}, 600_000);
