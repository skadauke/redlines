// @vitest-environment happy-dom
// A random walk of Undo and Redo: seeded interleavings of tracked and untracked typing, deleted line
// breaks, decisions, comments, replies and runs through the real toolbox, some with typing between
// their edits, in LF, CRLF and mixed files. Then ⌘Z to the start and ⇧⌘Z to the end: every text on
// the way is one the file had, byte for byte, in time order, with no new parse warning
// (docs/superpowers/specs/2026-11-10-agents-undo-and-allow-design.md, Tests, Stage 2, 20).
// REDLINES_FUZZ sets the number of seeds.

import { redoDepth, undoDepth } from '@redlines/editor';
import { newestView, parse, type Warning } from '@redlines/format';
import { afterEach, describe, expect, it } from 'vitest';
import { fuzzCount, seeded } from '../../../packages/format/src/random-docs.ts';
import sample from './sample.md?raw';
import {
  type Call,
  comment,
  field,
  gate,
  openWindow,
  replace,
  reply,
  script,
  settle,
  type Window,
} from './undo-harness.ts';

const windows: Window[] = [];
afterEach(() => {
  for (const window of windows.splice(0)) window.editor.destroy();
  document.body.replaceChildren();
});

const lines = sample.split('\n');
const half = Math.floor(lines.length / 2);
const FILES: [name: string, text: string][] = [
  ['LF', sample],
  ['CRLF', sample.replace(/\n/g, '\r\n')],
  ['mixed', lines.slice(0, half).join('\n') + '\n' + lines.slice(half).join('\r\n')],
];

const WORDS = ['quietly', 'often', 'new', 'café', 'still', 'twice'];

type Random = () => number;
const pick = <T>(random: Random, items: readonly T[]): T | undefined =>
  items[Math.floor(random() * items.length)];

/**
 * Places in the body where a word can go: right after a space, outside every marker, in a line that
 * is plain prose (no code fence, no heading, no list or quote marker at the caret).
 */
function typingPlaces(w: Window): number[] {
  const text = w.editor.view.state.doc.toString();
  const end = w.editor.getParsed().ledgerRange?.from ?? text.length;
  const places: number[] = [];
  let inMarker = false;
  let inCode = false;
  let lineStart = 0;
  for (let i = 0; i < end; i++) {
    if (i === lineStart && text.startsWith('```', i)) inCode = !inCode;
    if (text.startsWith('<!--', i)) inMarker = true;
    if (inMarker && text.startsWith('-->', i)) {
      inMarker = false;
      i += 2;
      continue;
    }
    if (text[i] === '\n') lineStart = i + 1;
    if (!inMarker && !inCode && i > lineStart + 2 && text[i - 1] === ' ' && /\w/.test(text[i]!)) {
      places.push(i);
    }
  }
  return places;
}

/** Line breaks between two lines of prose, outside markers and code. */
function joinablePlaces(w: Window): number[] {
  const doc = w.editor.view.state.doc;
  const end = w.editor.getParsed().ledgerRange?.from ?? doc.length;
  const places: number[] = [];
  let inCode = false;
  for (let n = 1; n < doc.lines; n++) {
    const line = doc.line(n);
    if (line.text.startsWith('```')) inCode = !inCode;
    if (inCode || line.to >= end) continue;
    const next = doc.line(n + 1).text;
    if (/[a-z.]$/.test(line.text) && /^[A-Z]/.test(next) && !line.text.includes('<!--')) {
      places.push(line.to);
    }
  }
  return places;
}

/** Phrases of the newest view that a `str_replace` can find exactly once. */
function uniquePhrases(w: Window): string[] {
  const view = newestView(w.editor.getDoc().replace(/\r\n?/g, '\n')).text;
  const end = view.indexOf('<!-- redlines');
  const body = end < 0 ? view : view.slice(0, end);
  const phrases = body.match(/\b[A-Za-z]{4,}(?: [A-Za-z]{3,}){1,2}\b/g) ?? [];
  return phrases.filter((p) => body.indexOf(p) === body.lastIndexOf(p) && !p.includes('Claude'));
}

/** Words of the document's own text, outside markers, which a new comment can be on. */
function commentWords(w: Window): string[] {
  const text = w.editor.view.state.doc.toString();
  const end = w.editor.getParsed().ledgerRange?.from ?? text.length;
  const body = text.slice(0, end).replace(/<!--[\s\S]*?-->/g, ' ');
  const words = body.match(/\b[A-Za-z]{5,}\b/g) ?? [];
  return words.filter((word) => {
    const first = text.indexOf(word);
    return first >= 0 && first === text.lastIndexOf(word) && first < end;
  });
}

/** What a run of the agent does: one to three edits, a comment, and its reply. */
function runCalls(w: Window, random: Random, n: number): Call[] {
  const phrases = uniquePhrases(w);
  const calls: Call[] = [];
  const count = 1 + Math.floor(random() * 3);
  for (let i = 0; i < count; i++) {
    const phrase = pick(random, phrases);
    if (phrase) calls.push(replace(phrase, `${phrase} ${pick(random, WORDS)}`));
  }
  const quote = pick(random, phrases);
  if (quote && random() < 0.5) calls.push(comment(quote, `About this, ${n}?`));
  calls.push(reply(`Run ${n} done.`));
  return calls;
}

/** Waits until `done` holds, as promises and timers go on. */
async function waitFor(done: () => boolean): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (done()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('Waited too long');
}

/** Comments as Ada; a refusal (the box says why) closes the box and posts nothing. */
function tryPost(w: Window, word: string, text: string): string | null {
  try {
    return w.post(word, text);
  } catch {
    const box = field(w.editor);
    box?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return null;
  }
}

async function act(w: Window, random: Random, step: number, log: string[]): Promise<void> {
  const kind = Math.floor(random() * 8);
  const { editor } = w;
  if (kind === 0 || kind === 1) {
    const at = pick(random, typingPlaces(w));
    if (at === undefined) return;
    editor.setTracking(kind === 0);
    const word = `${pick(random, WORDS)} `;
    log.push(`${kind === 0 ? 'tracked' : 'untracked'} typing ${JSON.stringify(word)} at ${at}`);
    w.type(at, word);
  } else if (kind === 2) {
    const at = pick(random, joinablePlaces(w));
    if (at === undefined) return;
    editor.setTracking(false);
    log.push(`deleting the line break at ${at}`);
    editor.view.dispatch({ changes: { from: at, to: at + 1 }, userEvent: 'delete.forward' });
  } else if (kind === 3) {
    const change = pick(random, editor.getUiState().changes);
    if (!change) return;
    const accept = random() < 0.5;
    log.push(`${accept ? 'accepting' : 'rejecting'} ${change.id}`);
    if (accept) editor.accept(change.id);
    else editor.reject(change.id);
  } else if (kind === 4) {
    const word = pick(random, commentWords(w));
    if (!word) return;
    log.push(`a comment on ${word}`);
    tryPost(w, word, `Note ${step}.`);
  } else if (kind === 5) {
    const threads = editor.getParsed().ledger.comments;
    const texts = threads.map(({ text }) => text);
    const thread = pick(
      random,
      threads.filter(({ text }) => texts.indexOf(text) === texts.lastIndexOf(text)),
    );
    if (!thread) return;
    log.push(`a reply in ${thread.id}`);
    try {
      w.replyIn(thread.id, `Reply ${step}.`);
    } catch {
      // A thread whose note doesn't show, such as a resolved one.
    }
  } else {
    const word = pick(random, commentWords(w));
    if (!word) return;
    const calls = runCalls(w, random, step);
    const between = kind === 7;
    log.push(`a run on ${word}${between ? ', with typing between' : ''}: ${JSON.stringify(calls)}`);
    if (between && calls.length > 1) {
      const go = gate();
      const halves = script(calls.slice(0, 1), go.opened, calls.slice(1));
      w.claude.script = halves;
      const before = editor.getDoc();
      if (tryPost(w, word, `@Claude step ${step}`) === null) return go.open();
      const posted = editor.getDoc();
      // The first edit is in, or refused, and the script waits.
      await waitFor(() => halves.answers.length > 0 || !w.runs.isLive());
      const at = pick(random, typingPlaces(w));
      if (at !== undefined && editor.getDoc() !== posted && editor.getDoc() !== before) {
        editor.setTracking(random() < 0.5);
        w.type(at, `${pick(random, WORDS)} `);
      }
      go.open();
    } else {
      w.claude.script = script(calls);
      if (tryPost(w, word, `@Claude step ${step}`) === null) return;
    }
    await w.runsEnd();
  }
}

/** Warnings, counted by what they say. */
function warningsOf(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  const key = (warning: Warning) => `${warning.code} ${warning.id ?? ''}`;
  for (const warning of parse(text).warnings)
    counts.set(key(warning), (counts.get(key(warning)) ?? 0) + 1);
  return counts;
}

function newWarning(start: Map<string, number>, text: string): string | null {
  for (const [key, count] of warningsOf(text)) if (count > (start.get(key) ?? 0)) return key;
  return null;
}

describe('a random walk of Undo and Redo', () => {
  it('walks back and forth through texts the file had, in LF, CRLF and mixed files', async () => {
    const seeds = fuzzCount(12);
    for (let seed = 1; seed <= seeds; seed++) {
      for (const [name, file] of FILES) {
        const where = `seed ${seed}, ${name} file`;
        const random = seeded(seed * 7919 + name.length);
        const w = await openWindow(file);
        windows.push(w);
        const log: string[] = [];
        for (let step = 0; step < 15; step++) await act(w, random, step, log);
        const why = () => `${where}\n${log.join('\n')}`;
        const texts = w.texts;
        expect(texts[0], why()).toBe(file);
        const start = warningsOf(file);

        const top = w.editor.getDoc();
        let index = texts.lastIndexOf(top);
        expect(index, why()).toBeGreaterThanOrEqual(0);
        const back: string[] = [top];
        while (undoDepth(w.editor.view.state) > 0) {
          w.undoKey();
          const now = w.editor.getDoc();
          back.push(now);
          if (now === back.at(-2)) continue;
          const found = texts.lastIndexOf(now, index - 1);
          expect(
            found,
            `${why()}\nundo ${back.length - 1} gave a text the file never had`,
          ).toBeGreaterThanOrEqual(0);
          expect(newWarning(start, now), why()).toBeNull();
          index = found;
        }
        expect(w.editor.getDoc(), why()).toBe(file);

        for (let i = back.length - 2; i >= 0; i--) {
          w.redoKey();
          expect(w.editor.getDoc(), `${why()}\nredo ${back.length - 1 - i}`).toBe(back[i]);
        }
        expect(redoDepth(w.editor.view.state), why()).toBe(0);
        await settle();
        w.editor.destroy();
        windows.splice(windows.indexOf(w), 1);
      }
    }
  }, 600_000);
});
