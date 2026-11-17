// @vitest-environment happy-dom
// Deriving an intent again on newer text (multiuser §4.2): placed among the visible words, not by
// offsets. With the place unchanged it is what the filter wrote; with text added, moved or
// deleted around it, it lands where its words are, keeps text whose paragraph is gone, and does
// nothing for a deletion whose text is gone. Never a new refusal, never a change to the original.
import type { ChangeSet, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { newestView, originalView, parse } from '@redlines/format';
import { afterEach, describe, expect, it } from 'vitest';
import { createEditor, type Editor } from '../index.ts';
import { intentOf, type TypingIntent } from './intent.ts';
import { anchorIntent, rederiveIntent } from './rederive.ts';
import { editSourceFacet } from './typing.ts';

const open: Editor[] = [];
afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

/** A random source with a stream of its own, so that ids differ between edits. */
const source = (seed: number) => {
  let a = seed;
  return (n: number) =>
    Uint8Array.from({ length: n }, () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return (t ^ (t >>> 14)) & 0xff;
    });
};

function editor(doc: string, tracking = true, seed = 7) {
  const parent = document.createElement('div');
  document.body.append(parent);
  const intents: { start: EditorState; intent: TypingIntent; changes: ChangeSet }[] = [];
  const made = createEditor(parent, {
    doc,
    author: { handle: 'ada', name: 'Ada Lovelace' },
    tracking,
    extensions: [
      editSourceFacet.of({ now: () => new Date('2026-11-01T10:00:30Z'), random: source(seed) }),
      EditorView.updateListener.of((update) => {
        for (const tr of update.transactions) {
          const intent = intentOf(tr);
          if (intent?.kind === 'typing') {
            intents.push({ start: tr.startState, intent, changes: tr.changes });
          }
        }
      }),
    ],
  });
  open.push(made);
  return { editor: made, intents };
}

const type = (e: Editor, from: number, to: number, insert: string) =>
  e.view.dispatch({ changes: { from, to, insert }, userEvent: 'input.type' });

/** Ada's edit of `base`, then the intent placed again on `newer`. */
function again(base: string, edit: [number, number, string], newer: string, tracking = true) {
  const { editor: ada, intents } = editor(base, tracking);
  type(ada, ...edit);
  const one = intents.at(-1)!;
  const anchored = anchorIntent(base, one.intent);
  const { editor: other } = editor(newer, tracking, 11);
  const result = rederiveIntent(other.view.state, anchored);
  const applied = result.ok
    ? result.changes.apply(other.view.state.doc).toString()
    : other.view.state.doc.toString();
  return { one, result, applied, newer };
}

const visible = (text: string) => newestView(text).text;

describe('placing an intent again', () => {
  const base = 'First paragraph here.\n\nSecond paragraph with words.\n';
  const AT = base.indexOf('paragraph with');

  it('is what the filter wrote, when nothing changed', () => {
    const { one, result } = again(base, [AT, AT, 'extra '], base);
    expect(result.ok && JSON.stringify(result.changes.toJSON())).toBe(
      JSON.stringify(one.changes.toJSON()),
    );
    expect(result.ok && result.moved).toBe(false);
  });

  it('finds its place after text was added before it', () => {
    const newer = `A whole new first paragraph.\n\n${base}`;
    const { result, applied } = again(base, [AT, AT, 'extra '], newer);
    expect(result.ok).toBe(true);
    expect(visible(applied)).toBe(
      visible(newer).replace('Second paragraph', 'Second extra paragraph'),
    );
    expect(originalView(applied).text).toBe(originalView(newer).text);
  });

  it('finds its place after the text around it was changed', () => {
    const newer = base.replace('Second paragraph with', 'Second chapter, with');
    const { result, applied } = again(base, [AT, AT, 'extra '], newer);
    expect(result.ok).toBe(true);
    expect(visible(applied)).toContain('extra');
    expect(originalView(applied).text).toBe(originalView(newer).text);
  });

  it('keeps text whose paragraph was deleted, and says so', () => {
    const newer = 'First paragraph here.\n';
    const { result, applied } = again(base, [AT, AT, 'extra '], newer);
    expect(result.ok && result.notices).toEqual([
      'The text around your edit was deleted. Your text is kept here.',
    ]);
    expect(visible(applied)).toContain('extra');
  });

  it('deletes the same words after text was added before them', () => {
    const start = base.indexOf('paragraph with');
    const newer = `New line.\n\n${base}`;
    const { result, applied } = again(base, [start, start + 'paragraph'.length, ''], newer);
    expect(result.ok).toBe(true);
    expect(visible(applied)).toBe(visible(newer).replace('Second paragraph with', 'Second  with'));
    expect(originalView(applied).text).toBe(originalView(newer).text);
  });

  it('does nothing for a deletion whose text is gone, and says nothing', () => {
    const start = base.indexOf('words');
    const newer = base.replace('with words', 'with');
    const { result } = again(base, [start, start + 5, ''], newer);
    expect(result.ok && result.changes.empty).toBe(true);
    expect(result.ok && result.notices).toEqual([]);
  });

  it('becomes an insertion when the text it replaced is gone', () => {
    const start = base.indexOf('words');
    const newer = base.replace('with words', 'with');
    const { result, applied } = again(base, [start, start + 5, 'ideas'], newer);
    expect(result.ok).toBe(true);
    expect(visible(applied)).toContain('ideas');
  });

  it('works with Track Changes off', () => {
    const newer = `New line.\n\n${base}`;
    const { result, applied } = again(base, [AT, AT, 'extra '], newer, false);
    expect(result.ok).toBe(true);
    expect(visible(applied)).toContain('Second extra paragraph');
  });

  it('is the same each time', () => {
    const newer = `New line.\n\n${base}`;
    const a = again(base, [AT, AT, 'extra '], newer);
    const b = again(base, [AT, AT, 'extra '], newer);
    expect(a.applied).toBe(b.applied);
  });
});

/** `base` with Bo's insertion of the first `word` in it, ledger and all. */
const bos = (base: string, word: string) =>
  base.replace(` ${word}`, ` <!--ins b2b2-->${word}<!--/b2b2-->`).trimEnd() +
  '\n\n<!-- redlines\nversion: 1\npeople:\n  bo: {name: Bo Chen}\nmarks:\n  b2b2: {by: bo, at: 2026-10-31T09:30Z}\n-->\n';

describe('placing intents again at random', () => {
  it('never changes the original, and always reads back', () => {
    const words = 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu'.split(' ');
    let a = 20261117;
    const next = () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const pick = <T>(list: readonly T[]) => list[Math.floor(next() * list.length)]!;
    const paragraphs = () =>
      Array.from({ length: 4 }, () => Array.from({ length: 6 }, () => pick(words)).join(' ')).join(
        '\n\n',
      ) + '\n';
    let placed = 0;
    let failed = 0;
    for (let i = 0; i < 120; i++) {
      const tracking = i % 3 !== 0 || i % 4 === 3;
      const base = paragraphs();
      // Someone else's change: a word inserted, or a paragraph dropped, or two words replaced.
      const lines = base.trimEnd().split('\n\n');
      const kind = i % 4;
      const newer =
        kind === 0
          ? `${pick(words)} ${base}`
          : kind === 1
            ? `${lines.filter((_, k) => k !== 1).join('\n\n')}\n`
            : kind === 2
              ? base.replace(pick(words), 'changed')
              : bos(base, pick(words));
      const x = Math.floor(next() * base.length);
      const y = next() < 0.5 ? x : Math.min(base.length, x + Math.floor(next() * 8));
      const text = y > x && next() < 0.5 ? '' : pick(words);
      const { editor: ada, intents } = editor(base, tracking, i + 1);
      type(ada, x, y, text);
      const one = intents.at(-1);
      if (!one) continue;
      const { editor: other } = editor(newer, tracking, i + 500);
      const result = rederiveIntent(other.view.state, anchorIntent(base, one.intent));
      if (!result.ok) {
        failed++;
        continue;
      }
      placed++;
      const applied = result.changes.apply(other.view.state.doc).toString();
      expect(parse(applied).warnings, applied).toEqual([]);
      if (tracking) expect(originalView(applied).text).toBe(originalView(newer).text);
      // Bo's insertion, if any, is as he wrote it, and what was typed is still there.
      const bo = newer.match(/<!--ins b2b2-->.*?<!--\/b2b2-->/)?.[0];
      if (bo) expect(applied).toContain(bo);
      if (text) expect(visible(applied)).toContain(text);
    }
    expect(placed).toBeGreaterThan(60);
    // The format may still refuse where it refuses the first time; it is rare.
    expect(failed).toBeLessThan(placed / 5);
    expect(failed).toBeLessThan(30);
  });
});
