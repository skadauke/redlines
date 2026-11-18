// What people do, per workload (collaboration.md, Method):
// - hot: everyone in one paragraph;
// - typical: 80% of each person's edits in their own paragraph, the rest anywhere;
// - spread: anywhere;
// - review: the owner decides while the others edit.
// Everyone mixes typing, deleting, substituting (also across someone's insertion), bold, comments,
// replies, and the odd decision of their own.

import { isDecidable, newestView, parse } from '@redlines/format';
import type { Anchor, Intent, IntentBody } from './intents.ts';
import { signatureOf } from './intents.ts';
import type { Rng } from './rng.ts';
import { PEOPLE, timeAt, tokenRanges, typistOf } from './text.ts';
import type { VisibleToken } from './text.ts';

export type WorkloadName = 'hot' | 'typical' | 'spread' | 'review';

export const WORKLOADS: readonly WorkloadName[] = ['hot', 'typical', 'spread', 'review'];

type Kind = IntentBody['kind'];

const WEIGHTS: Record<Kind, number> = {
  type: 32,
  delete: 14,
  sub: 12,
  bold: 10,
  comment: 8,
  reply: 6,
  decide: 6,
};

const OWNER_REVIEW: Record<Kind, number> = {
  type: 12,
  delete: 6,
  sub: 5,
  bold: 3,
  comment: 5,
  reply: 5,
  decide: 64,
};

/** What a client needs to know to decide what to do. */
export interface Scene {
  rng: Rng;
  workload: WorkloadName;
  /** Index into PEOPLE. */
  who: number;
  /** The client's own screen: confirmed text and its pending edits. */
  local: string;
  /** The last confirmed text, which decisions and replies are aimed at. */
  confirmed: string;
  /** For unique words. */
  counter: { words: number; notes: number; replies: number; intents: number };
  at: number;
  /** Accept and reject carry the mark as seen. */
  guard: boolean;
}

interface Block {
  tokens: VisibleToken[];
}

function blocksOf(text: string, tokens: VisibleToken[]): Block[] {
  const blocks: Block[] = [];
  let last: VisibleToken | undefined;
  for (const token of tokens) {
    if (!last || /\n\s*\n/.test(text.slice(last.to, token.from))) blocks.push({ tokens: [] });
    blocks[blocks.length - 1]?.tokens.push(token);
    last = token;
  }
  return blocks;
}

function pickBlock(scene: Scene, blocks: Block[]): Block | undefined {
  const paragraphs = blocks.slice(1).length > 0 ? blocks.slice(1) : blocks;
  if (paragraphs.length === 0) return undefined;
  const { rng, workload, who } = scene;
  if (workload === 'hot') return paragraphs[0];
  if (workload === 'typical' && rng.chance(0.8)) return paragraphs[who % paragraphs.length];
  return rng.pick(paragraphs);
}

function anchorsAround(tokens: VisibleToken[], k: number): Anchor[] {
  const anchors: Anchor[] = [];
  const take = (i: number, side: Anchor['side']) => {
    const t = tokens[i];
    if (t) anchors.push({ token: t.token, side });
  };
  take(k, 'after');
  take(k + 1, 'before');
  take(k - 1, 'after');
  take(k + 2, 'before');
  take(0, 'before');
  return anchors;
}

function newWords(scene: Scene, n: number): string[] {
  const letter = PEOPLE[scene.who]?.letter ?? 'a';
  return Array.from(
    { length: n },
    () => `e${letter}${String(scene.counter.words++).padStart(3, '0')}`,
  );
}

/** A run of 1–4 neighbouring words, sometimes starting on someone else's typed word, so that the
 * edit crosses an insertion, and in a spread workload now and then on into the next paragraph. */
function pickRun(scene: Scene, blocks: Block[], block: Block): VisibleToken[] {
  const { rng } = scene;
  const mine = PEOPLE[scene.who]?.letter;
  let pool = block.tokens;
  if (scene.workload === 'spread' && rng.chance(0.05)) {
    const at = blocks.indexOf(block);
    pool = [...block.tokens, ...(blocks[at + 1]?.tokens ?? [])];
  }
  const foreign = pool
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => {
      const typist = typistOf(t.token);
      return typist !== undefined && typist !== mine;
    });
  let start = rng.int(pool.length);
  if (foreign.length > 0 && rng.chance(0.3)) start = rng.pick(foreign).i - rng.int(2);
  start = Math.max(0, start);
  const length = rng.between(1, 4);
  return pool.slice(start, start + length);
}

/** One more thing for a person to do, or null when there is nothing to aim at. */
export function makeIntent(scene: Scene): Intent | null {
  const { rng } = scene;
  const person = PEOPLE[scene.who];
  if (!person) throw new Error('no such person');
  const view = newestView(scene.local);
  const tokens = tokenRanges(view.text);
  const blocks = blocksOf(view.text, tokens);
  const weights = scene.workload === 'review' && scene.who === 0 ? OWNER_REVIEW : { ...WEIGHTS };
  if (scene.workload === 'review' && scene.who !== 0) weights.decide = 0;
  const kind = rng.weighted(Object.entries(weights) as [Kind, number][]);

  const block = pickBlock(scene, blocks);
  const make = (body: IntentBody): Intent => ({
    id: `${person.handle}-${scene.counter.intents++}`,
    author: { handle: person.handle, name: person.name },
    time: timeAt(scene.at),
    seed: rng.int(2 ** 31),
    at: scene.at,
    body,
  });
  const typing = (): Intent | null => {
    if (!block || block.tokens.length === 0) return null;
    const k = rng.int(block.tokens.length);
    return make({
      kind: 'type',
      anchors: anchorsAround(block.tokens, k),
      words: newWords(scene, rng.between(1, 3)),
    });
  };

  switch (kind) {
    case 'type':
      return typing();
    case 'delete': {
      if (!block) return null;
      const run = pickRun(scene, blocks, block);
      if (run.length === 0) return null;
      return make({ kind: 'delete', tokens: run.map((t) => t.token) });
    }
    case 'sub': {
      if (!block) return null;
      const run = pickRun(scene, blocks, block);
      if (run.length === 0) return null;
      return make({
        kind: 'sub',
        tokens: run.map((t) => t.token),
        words: newWords(scene, rng.between(1, 2)),
      });
    }
    case 'bold': {
      if (!block) return null;
      const run = pickRun(scene, blocks, block);
      if (run.length === 0) return null;
      return make({ kind: 'bold', tokens: run.map((t) => t.token), on: rng.chance(0.85) });
    }
    case 'comment': {
      if (!block) return null;
      const note = `n${person.letter}${String(scene.counter.notes++).padStart(3, '0')}`;
      const run = rng.chance(0.2) ? [] : pickRun(scene, blocks, block);
      const k = rng.int(block.tokens.length);
      return make({
        kind: 'comment',
        tokens: run.map((t) => t.token),
        anchors: anchorsAround(block.tokens, k),
        note,
      });
    }
    case 'reply': {
      const threads = parse(scene.confirmed).ledger.comments;
      if (threads.length === 0) return typing();
      const thread = rng.pick(threads);
      const body = `r${person.letter}${String(scene.counter.replies++).padStart(3, '0')}`;
      return make({ kind: 'reply', note: thread.text, body });
    }
    case 'decide': {
      const parsed = parse(scene.confirmed);
      const marks = parsed.marks.filter((m) => isDecidable(m));
      if (marks.length === 0) return typing();
      const others = marks.filter((m) => m.entry.by !== person.handle);
      const mark = rng.pick(others.length > 0 && rng.chance(0.8) ? others : marks);
      return make({
        kind: 'decide',
        mark: mark.id,
        decision: rng.chance(0.55) ? 'accept' : 'reject',
        seen: signatureOf(scene.confirmed, mark),
      });
    }
  }
}
