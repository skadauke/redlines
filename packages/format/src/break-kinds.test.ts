// A line break that a change takes out comes back exactly as it was (format §2.5, #142): rejecting
// gives the original bytes, an LF in a CRLF file comes back as an LF, and every order of decisions
// reads alike.

import { describe, expect, it } from 'vitest';
import { applyChanges, plainPayload, restoredPayload } from './changes.ts';
import { accept, reject } from './decide.ts';
import { EditError } from './errors.ts';
import { decodePayload, encodePayload, LF_IN_CRLF } from './payload.ts';
import { parse } from './parse.ts';
import { fuzzCount, seeded } from './random-docs.ts';
import { ada, bo, context } from './test-helpers.ts';
import { trackedEdit } from './track.ts';
import type { TextChange } from './types.ts';
import { newestView, originalView } from './views.ts';

describe('a payload keeps the kind of its line breaks', () => {
  it('writes a break of the file’s own kind as \\n, as every file did', () => {
    expect(encodePayload('a\r\nb\r\nc', '\r\n')).toBe('a\\nb\\nc');
    expect(encodePayload('a\nb\nc', '\n')).toBe('a\\nb\\nc');
  });

  it('writes a break of another kind as the kind it is', () => {
    expect(encodePayload('a\nb', '\r\n')).toBe('a\\x0ab');
    expect(encodePayload('a\r\nb', '\n')).toBe('a\\x0d\\nb');
    expect(encodePayload('a\rb', '\n')).toBe('a\\x0db');
    expect(encodePayload('a\rb', '\r\n')).toBe('a\\x0db');
  });

  it('keeps a U+FFFF of the text, and reads the old form of an LF in a CRLF file the same (#943)', () => {
    for (const style of ['\n', '\r\n'] as const) {
      for (const text of [
        '\uffff',
        'a\uffffb',
        'a\nb\uffff\n',
        '\\\uffff',
        '\uffffa',
        '\uffffb\n',
      ]) {
        const written = encodePayload(text, style);
        expect(restoredPayload(decodePayload(written), style), JSON.stringify(text)).toBe(text);
      }
    }
    // A literal U+FFFF is written as it is, and an LF of a CRLF file is still `\x0a`.
    expect(encodePayload('a\uffffb', '\r\n')).toBe('a\uffffb');
    expect(encodePayload('a\nb\uffff', '\r\n')).toBe('a\\x0ab\uffff');
    expect(plainPayload(decodePayload('a\\x0ab\uffff'))).toBe('a\nb\uffff');
  });

  it('writes every break as \\n where the text has no kind of its own', () => {
    expect(encodePayload('a\r\nb\rc\nd')).toBe('a\\nb\\nc\\nd');
  });

  it('reads a break of the file’s kind as the file writes it, and one of its own as it is', () => {
    expect(decodePayload('a\\nb')).toBe('a\nb');
    expect(decodePayload('a\\x0d\\nb')).toBe('a\r\nb');
    expect(decodePayload('a\\x0db')).toBe('a\rb');
    expect(decodePayload('a\\x0ab')).toBe(`a${LF_IN_CRLF}b`);
    expect(restoredPayload('a\nb', '\r\n')).toBe('a\r\nb');
    expect(restoredPayload('a\r\nb', '\n')).toBe('a\r\nb');
    expect(restoredPayload('a\rb', '\r\n')).toBe('a\rb');
    expect(restoredPayload(`a${LF_IN_CRLF}b`, '\r\n')).toBe('a\nb');
  });

  it('round-trips text of every mix of breaks, and backslashes in front of them', () => {
    const pieces = ['a', '\\', '-', '\n', '\r\n', '\r', '|', '`'];
    for (const style of ['\n', '\r\n'] as const) {
      for (let seed = 1; seed <= 300; seed++) {
        const random = seeded(seed);
        let text = '';
        for (let i = 0, n = 1 + Math.floor(random() * 8); i < n; i++) {
          text += pieces[Math.floor(random() * pieces.length)];
        }
        const written = encodePayload(text, style);
        expect(written).not.toMatch(/[\r\n]/);
        expect(restoredPayload(decodePayload(written), style), JSON.stringify(text)).toBe(text);
      }
    }
  });
});

describe('a change that takes out a line break gives it back as it was', () => {
  const rejected = (text: string, id: string) => applyChanges(text, reject(text, id));
  const accepted = (text: string, id: string) => applyChanges(text, accept(text, id));
  const edit = (text: string, change: TextChange) =>
    applyChanges(text, trackedEdit(text, change, context(ada, ['k3x9'])));

  it('gives back the LF of a CRLF file, which text typed after it made a substitution of', () => {
    const body = 'Hello world.\r\n\r\nSecond line here.\n';
    const typed = edit(body, { from: body.length, to: body.length, insert: 'Z' });
    expect(typed).toContain('here.<!--sub k3x9 \\x0a-->\nZ<!--/k3x9-->');
    expect(rejected(typed, 'k3x9')).toBe(body);
    expect(accepted(typed, 'k3x9')).toBe('Hello world.\r\n\r\nSecond line here.\nZ');
  });

  it('gives back a deleted LF in a CRLF file, and a deleted CRLF in an LF file', () => {
    for (const [body, at, length] of [
      ['one\r\ntwo\nthree\r\nfour', 8, 1],
      ['one\ntwo\r\nthree\nfour', 8, 2],
      ['one\r\ntwo\rthree\r\nfour', 8, 1],
    ] as const) {
      const cut = edit(body, { from: at, to: at + length, insert: '' });
      expect(parse(cut).marks).toHaveLength(1);
      expect(rejected(cut, 'k3x9'), JSON.stringify(body)).toBe(body);
    }
  });

  it('gives back the only CRLF of a file, which the change takes out of the body', () => {
    const body = 'alpha\r\nbeta\ngamma';
    const cut = edit(body, { from: 5, to: 7, insert: '' });
    expect(rejected(cut, 'k3x9')).toBe(body);
    const replaced = edit(body, { from: 5, to: 7, insert: ' and ' });
    expect(rejected(replaced, 'k3x9')).toBe(body);
    expect(accepted(replaced, 'k3x9')).toBe('alpha and beta\ngamma');
  });

  it('reads a file written before as it did: \\n is the file’s own break', () => {
    for (const eol of ['\n', '\r\n']) {
      const text = `a <!--del k3x9 x\\ny-->b${eol}${eol}<!-- redlines${eol}version: 1${eol}people:${eol}  ada: {name: Ada}${eol}marks:${eol}  k3x9: {by: ada, at: 2026-10-13T22:30Z}${eol}-->${eol}`;
      expect(rejected(text, 'k3x9')).toBe(`a x${eol}yb${eol}`);
    }
  });
});

describe('every order of decisions reads alike, with mixed line breaks', () => {
  const WORDS = ['alpha', 'beta', 'gamma', 'delta', 'café', 'x'];
  const BREAKS = ['\n', '\r\n', '\n\n', '\r\n\r\n', '\n\r\n', '\r\n\n'];
  const IDS = ['b2cd', 'b3cd', 'c4dg', 'd5fg', 'f6gh', 'g7hj'];

  /** Paragraphs of words, separated by line breaks of mixed kinds. */
  function document(random: () => number): string {
    const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)]!;
    let text = '';
    for (let i = 0, n = 3 + Math.floor(random() * 4); i < n; i++) {
      text += `${pick(WORDS)} ${pick(WORDS)}${i === n - 1 && random() < 0.3 ? '' : pick(BREAKS)}`;
    }
    return text;
  }

  /** The text with some tracked edits, by two people, each at a line break or near one. */
  function edited(random: () => number, original: string): string | undefined {
    let text = original;
    const edits = 1 + Math.floor(random() * 3);
    for (let i = 0; i < edits; i++) {
      // A break with text after it: white space at the end of a file is no change (§3.4).
      const body = text.slice(0, bodyEnd(text));
      const breaks = [...body.matchAll(/\r\n|\n/g)].filter(
        (found) => body.slice(found.index + found[0].length).trim() !== '',
      );
      if (breaks.length === 0) break;
      const found = breaks[Math.floor(random() * breaks.length)]!;
      const from = found.index;
      const to = from + found[0].length;
      const kind = Math.floor(random() * 3);
      const change: TextChange =
        kind === 0
          ? { from, to, insert: '' }
          : kind === 1
            ? { from, to, insert: ' and ' }
            : { from: to, to, insert: 'Z' };
      try {
        text = applyChanges(
          text,
          trackedEdit(text, change, context(i % 2 ? bo : ada, [IDS[i * 2]!, IDS[i * 2 + 1]!])),
        );
      } catch (error) {
        if (error instanceof EditError) return undefined;
        throw error;
      }
    }
    return text;
  }

  const bodyEnd = (text: string) => parse(text).ledgerRange?.from ?? text.length;

  const decide = (text: string, id: string, how: 'accept' | 'reject') =>
    applyChanges(text, how === 'accept' ? accept(text, id) : reject(text, id));

  /** The file after the decisions, in the order given; undefined where one is refused. */
  function decided(
    text: string,
    decisions: readonly [string, 'accept' | 'reject'][],
  ): string | undefined {
    let now = text;
    try {
      for (const [id, how] of decisions) now = decide(now, id, how);
    } catch (error) {
      if (error instanceof EditError) return undefined;
      throw error;
    }
    return now;
  }

  it('gives the original bytes when every change is rejected, and the same file in any order', () => {
    let tried = 0;
    for (let seed = 1; seed <= fuzzCount(300); seed++) {
      const random = seeded(seed);
      const original = document(random);
      const text = edited(random, original);
      if (text === undefined || !parse(text).ledgerRange) continue;
      const ids = parse(text).marks.map((mark) => mark.id);
      if (ids.length === 0) continue;
      tried++;
      // Rejecting all gives the original, in any order.
      const order = ids.toSorted(() => random() - 0.5);
      const back = decided(
        text,
        order.map((id): [string, 'reject'] => [id, 'reject']),
      );
      if (back !== undefined) expect(back, `seed ${seed}`).toBe(original);
      // A mix of decisions reads the same in every order.
      const decisions = ids.map((id): [string, 'accept' | 'reject'] => [
        id,
        random() < 0.5 ? 'accept' : 'reject',
      ]);
      const first = decided(
        text,
        decisions.toSorted(() => random() - 0.5),
      );
      const second = decided(
        text,
        decisions.toSorted(() => random() - 0.5),
      );
      if (first !== undefined && second !== undefined) expect(first, `seed ${seed}`).toBe(second);
      // And what a partial decision leaves still has the views the others have.
      const mid = decided(text, decisions.slice(0, 1));
      if (mid !== undefined && decisions.length > 1) {
        const rest = decisions.slice(1);
        const done = decided(mid, rest);
        const all = decided(text, decisions);
        if (done !== undefined && all !== undefined) expect(done, `seed ${seed}`).toBe(all);
      }
      expect(originalView(text).text, `seed ${seed}`).toBe(original);
      expect(newestView(text).text.length).toBeGreaterThan(0);
    }
    expect(tried).toBeGreaterThan(50);
  });
});

describe('the escapes never collide with text a person typed, and never leak', () => {
  const rejected = (text: string, id: string) => applyChanges(text, reject(text, id));
  const edit = (text: string, change: TextChange) =>
    applyChanges(text, trackedEdit(text, change, context(ada, ['k3x9'])));

  it('keeps a literal \\x0d, \\x0a and \\n in prose or code as text', () => {
    for (const literal of ['\\x0d', '\\x0a', '\\n', 'a\\x0d\\nb', '\\\r', '\\\n']) {
      for (const style of ['\n', '\r\n'] as const) {
        const written = encodePayload(literal, style);
        expect(written).not.toMatch(/[\r\n]/);
        expect(restoredPayload(decodePayload(written), style), JSON.stringify(literal)).toBe(
          literal,
        );
      }
    }
  });

  it('gives back a deleted literal U+FFFF byte for byte, beside an LF in a CRLF file (#943)', () => {
    for (const body of ['say \uffff\r\nthen\nmore', 'a\uffffb', 'x\nbeta\uffff\r\n\uffffz']) {
      const cut = edit(body, { from: 0, to: body.length - 1, insert: '' });
      expect(rejected(cut, 'k3x9'), JSON.stringify(body)).toBe(body);
    }
  });

  it('gives back a deleted literal \\x0d beside a CRLF in a mixed file byte for byte', () => {
    for (const body of ['say \\x0d\r\nthen\nmore', 'say \\x0a\nthen\r\nmore', 'a\\\r\nb\nc']) {
      const cut = edit(body, { from: 0, to: body.length - 1, insert: '' });
      expect(rejected(cut, 'k3x9'), JSON.stringify(body)).toBe(body);
    }
  });

  it('never gives LF_IN_CRLF to a view of the file', () => {
    const body = 'one\r\ntwo\nthree\r\nfour';
    const cut = edit(body, { from: 3, to: 12, insert: '' });
    expect(newestView(cut).text).not.toContain(LF_IN_CRLF);
    expect(originalView(cut).text).not.toContain(LF_IN_CRLF);
  });
});
