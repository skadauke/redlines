// The names of emoji (#312): gemoji's list, which GitHub's shortcodes are, read once on first use.

import { GEMOJI } from './names.ts';

/** One shortcode and the emoji it stands for. */
export interface EmojiName {
  name: string;
  char: string;
}

let table: { all: readonly EmojiName[]; byName: ReadonlyMap<string, string> } | undefined;

function load() {
  if (table) return table;
  const all: EmojiName[] = [];
  const byName = new Map<string, string>();
  for (const line of GEMOJI.split('\n')) {
    const [char, ...names] = line.split(' ');
    if (!char) continue;
    for (const name of names) {
      all.push({ name, char });
      byName.set(name, char);
    }
  }
  table = { all, byName };
  return table;
}

/** The emoji for a shortcode's name (`tent` for `:tent:`), or undefined for a name GitHub doesn't know. */
export function emojiFor(name: string): string | undefined {
  return load().byName.get(name);
}

/**
 * What `:query` offers: the names that start with it, then those with a word of it (after `_` or
 * `-`), each in gemoji's order, and an exact name first. Two names of one emoji are one row. At most
 * `limit` rows.
 */
export function emojiMatches(query: string, limit = 8): EmojiName[] {
  const wanted = query.toLowerCase();
  if (wanted === '') return [];
  const starts: EmojiName[] = [];
  const words: EmojiName[] = [];
  for (const entry of load().all) {
    if (entry.name.startsWith(wanted)) starts.push(entry);
    else if (entry.name.includes(`_${wanted}`) || entry.name.includes(`-${wanted}`)) {
      words.push(entry);
    }
  }
  const exact = starts.findIndex((entry) => entry.name === wanted);
  if (exact > 0) starts.unshift(...starts.splice(exact, 1));
  const rows: EmojiName[] = [];
  const seen = new Set<string>();
  for (const entry of [...starts, ...words]) {
    if (seen.has(entry.char)) continue;
    seen.add(entry.char);
    rows.push(entry);
    if (rows.length === limit) break;
  }
  return rows;
}
