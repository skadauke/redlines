// A chat's history (#1194): what the app keeps of a document's conversation, as text, in the app's
// own data and never in the Markdown file (design §8.7). The page reads and writes it through a
// `ChatStore`, which the host fills (a folder of the app's, or memory in a plain browser tab).

import type { AskTurn } from '../ask/session.ts';

/** The most turns a record keeps: the oldest go first, so that a record never grows without end. */
export const TURNS_KEPT = 500;

/** Where chats are kept, by the key of the document they are about (its path). */
export interface ChatStore {
  /** What was kept for `key`, or null. */
  read(key: string): Promise<string | null>;
  write(key: string, text: string): Promise<void>;
  remove(key: string): Promise<void>;
  /** The document of `from` is now `to`: its chat goes with it. */
  move(from: string, to: string): Promise<void>;
}

/** A chat as it is kept. */
export interface ChatRecord {
  version: 1;
  /** The agent picked for this chat, by id, if the person picked one. */
  agent?: string;
  /** The model picked for it, as the agent lists it. */
  model?: string;
  turns: AskTurn[];
}

export const EMPTY_RECORD: ChatRecord = { version: 1, turns: [] };

const isRecordOf = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function turnOf(value: unknown): AskTurn | null {
  if (!isRecordOf(value)) return null;
  const { question, answer, agent, web, at, model } = value;
  if (typeof question !== 'string' || typeof answer !== 'string' || !isRecordOf(agent)) return null;
  if (typeof agent['id'] !== 'string' || typeof agent['name'] !== 'string') return null;
  return {
    question,
    answer,
    agent: { id: agent['id'], name: agent['name'] },
    ...(web === true ? { web: true as const } : {}),
    ...(typeof at === 'number' && Number.isFinite(at) ? { at } : {}),
    ...(typeof model === 'string' ? { model } : {}),
  };
}

/** The record in `text`; an empty one for text that is not one, so that a bad file never stops a chat. */
export function parseRecord(text: string | null): ChatRecord {
  if (text === null) return { ...EMPTY_RECORD, turns: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ...EMPTY_RECORD, turns: [] };
  }
  if (!isRecordOf(parsed) || parsed['version'] !== 1 || !Array.isArray(parsed['turns'])) {
    return { ...EMPTY_RECORD, turns: [] };
  }
  const turns = (parsed['turns'] as unknown[])
    .map(turnOf)
    .filter((turn): turn is AskTurn => turn !== null)
    .slice(-TURNS_KEPT);
  const { agent, model } = parsed;
  return {
    version: 1,
    ...(typeof agent === 'string' ? { agent } : {}),
    ...(typeof model === 'string' ? { model } : {}),
    turns,
  };
}

export function recordText(record: ChatRecord): string {
  return JSON.stringify({ ...record, turns: record.turns.slice(-TURNS_KEPT) });
}

/** A store in memory, for a page with no app behind it, and for tests. */
export function memoryStore(): ChatStore & { readonly kept: ReadonlyMap<string, string> } {
  const kept = new Map<string, string>();
  return {
    kept,
    read: (key) => Promise.resolve(kept.get(key) ?? null),
    write: (key, text) => {
      kept.set(key, text);
      return Promise.resolve();
    },
    remove: (key) => {
      kept.delete(key);
      return Promise.resolve();
    },
    move: (from, to) => {
      const text = kept.get(from);
      if (text !== undefined && !kept.has(to)) {
        kept.set(to, text);
        kept.delete(from);
      }
      return Promise.resolve();
    },
  };
}
