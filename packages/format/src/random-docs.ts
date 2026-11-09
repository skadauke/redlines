// A seeded generator of documents that hold every kind of mark, for tests that check what must
// always hold. Not part of the package.

import { newId } from './ids.ts';
import { normalizeLedger } from './ledger-order.ts';
import { serializeLedger } from './ledger-write.ts';
import { encodePayload } from './payload.ts';
import type { Ledger, Thread } from './types.ts';

/** How many random documents a test tries: `fallback`, or the number in REDLINES_FUZZ, for a
 * longer run (`REDLINES_FUZZ=5000 pnpm test`). */
export function fuzzCount(fallback: number): number {
  const wanted = Number(process.env['REDLINES_FUZZ']);
  return Number.isInteger(wanted) && wanted > 0 ? wanted : fallback;
}

/** A small seeded generator (mulberry32): the same seed gives the same numbers. */
export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Words of the body: no backticks (they would pair up and hide marks) and no `--`. Emoji and a
 * letter with a combining accent are there to test offsets. */
const WORDS = ['alpha', 'beta', 'gamma', 'delta', 'café', 'éclair', '😀', 'x', '42', 'a-b'];

/** Text that only payloads and comments hold: it needs escapes. */
const AWKWARD = ['q|r', '`c`', 'a--b', '{{y}}', 'back\\slash', 'line\nbreak', 'end-'];

const AUTHORS = ['ada', 'bo', 'claude-ada'];

/** YAML front matter (format §3.8), closed by `---` or `...`, with the first block right under its
 * closing line or after a blank line; some with a YAML block list, as Jekyll and Hugo posts have
 * them, whose lines read as list items. */
const FRONT_MATTER = [
  '---\ntitle: Notes\n---\n',
  '---\ntitle: Notes\ntags: [a, b]\n...\n',
  '---\ntitle: Notes\ntags:\n  - a\n  - b\n---\n',
  '---\ntags:\n- a\n- b\n...\n',
  '---\ntitle: Notes\n---\n\n',
  '---\ntitle: Notes\n...\n\n',
];

/** Inline constructs that take no marker inside them, or only in some places (format §3.1):
 * links, images, URLs, entities, code, emphasis, escapes. */
const CONSTRUCTS: readonly ((pick: <T>(items: readonly T[]) => T) => string)[] = [
  (pick) => `[${pick(WORDS)} ${pick(WORDS)}](https://example.org/a "${pick(WORDS)}")`,
  (pick) => `![${pick(WORDS)}](img/${pick(WORDS)}.png)`,
  () => '<https://example.org/x>',
  () => 'https://example.org/path?q=1',
  () => 'caf&eacute;',
  (pick) => `\`${pick(WORDS)}\``,
  (pick) => `**${pick(WORDS)}**`,
  (pick) => `*${pick(WORDS)}*`,
  (pick) => `_${pick(WORDS)}_`,
  (pick) => `foo**${pick(WORDS)}**baz`,
  () => 'snake_case_name',
  () => '\\*literal\\*',
];

/** A document with a ledger, made of blocks (paragraphs, bullet and numbered items, quotes,
 * headings) of plain words, constructs that take no marker inside them, insertions, deletions,
 * substitutions, comments (ranges, points, and ranges that cross an insertion) and highlights,
 * now and then after front matter. Insertions and substitutions hold other people's marks. Every
 * block starts with a plain word, and a line is only wrapped inside a run of plain words, so that
 * no marker starts a line. */
export function randomDocument(random: () => number): string {
  const taken = new Set<string>();
  const marks: Ledger['marks'] = {};
  const comments: Thread[] = [];
  const below = (n: number) => Math.floor(random() * n);
  const pick = <T>(items: readonly T[]): T => items[below(items.length)] as T;
  const bytes = (n: number) => Uint8Array.from({ length: n }, () => below(256));
  const id = () => {
    const value = newId(taken, bytes);
    taken.add(value);
    return value;
  };
  const authorOtherThan = (other?: string) => pick(AUTHORS.filter((a) => a !== other));
  const words = (max: number) =>
    Array.from({ length: 1 + below(max) }, () => pick(WORDS)).join(' ');
  /** The prefix of the lines that follow the first line of the block being made, which plain words
   * may be wrapped onto; null for a heading, which is one line. */
  let wrapPrefix: string | null = '';
  const plain = (max: number) =>
    Array.from({ length: 1 + below(max) }, () => pick(WORDS)).reduce(
      (text, word, i) =>
        i === 0
          ? word
          : `${text}${wrapPrefix !== null && random() < 0.25 ? `\n${wrapPrefix}` : ' '}${word}`,
      '',
    );
  const payload = () => encodePayload(random() < 0.3 ? `${words(2)} ${pick(AWKWARD)}` : words(2));
  const markId = (by: string) => {
    const value = id();
    marks[value] = { by, at: '2026-10-13T22:30Z' };
    return value;
  };
  const threadId = () => {
    const value = id();
    comments.push({
      id: value,
      by: pick(AUTHORS),
      at: '2026-10-13T22:40Z',
      likes: [],
      replies: [],
      text: random() < 0.3 ? `Is this ${pick(AWKWARD)}?` : 'A note.',
      ...(random() < 0.5 ? { quote: words(2) } : {}),
    });
    return value;
  };

  /** `container` is the author of the insertion or substitution around, whose marks are other
   * people's, as in format §3.6. Such a container holds no insertion: it holds deletions and
   * substitutions. */
  function unit(depth: number, container?: string): string {
    if (random() < 0.12) return pick(CONSTRUCTS)(pick);
    const roll = random();
    if (roll < 0.34 || depth > 3) return plain(3);
    if (roll < 0.5 && depth < 3) {
      if (container !== undefined)
        return `<!--del ${markId(authorOtherThan(container))} ${payload()}-->`;
      const by = authorOtherThan(container);
      const value = markId(by);
      return `<!--ins ${value}-->${inline(depth + 1, by)}<!--/${value}-->`;
    }
    if (roll < 0.62) {
      return `<!--del ${markId(authorOtherThan(container))} ${payload()}-->`;
    }
    if (roll < 0.7 && depth < 3) {
      const by = authorOtherThan(container);
      const value = markId(by);
      return `<!--sub ${value} ${payload()}-->${inline(depth + 1, by)}<!--/${value}-->`;
    }
    if (roll < 0.8) {
      const value = threadId();
      return `<!--cmt ${value}-->${inline(depth + 1, container)}<!--/${value}-->`;
    }
    if (roll < 0.85) return `<!--cmt ${threadId()}-->`;
    if (roll < 0.91) {
      const value = markId(authorOtherThan(container));
      return `<!--hl ${value}-->${inline(depth + 1, container)}<!--/${value}-->`;
    }
    if (depth === 0) {
      // A comment or highlight that starts inside an insertion and ends after it, or the reverse.
      const by = authorOtherThan(container);
      const change = markId(by);
      const note = roll < 0.96 ? threadId() : markId(authorOtherThan());
      const kind = comments.some((thread) => thread.id === note) ? 'cmt' : 'hl';
      const [one, two, three] = [words(2), words(2), words(2)];
      return random() < 0.5
        ? `<!--ins ${change}-->${one} <!--${kind} ${note}-->${two}<!--/${change}--> ${three}<!--/${note}-->`
        : `<!--${kind} ${note}-->${one} <!--ins ${change}-->${two}<!--/${note}--> ${three}<!--/${change}-->`;
    }
    return plain(2);
  }

  function inline(depth: number, container?: string): string {
    const count = 1 + below(depth === 0 ? 6 : 3);
    return Array.from({ length: count }, () => unit(depth, container)).join(' ');
  }

  /** A block: its lines, each with the prefix of the block. */
  function block(): string {
    const kind = below(10);
    const line = (prefix: string | null) => {
      wrapPrefix = prefix;
      return `${pick(WORDS)} ${inline(0)}`;
    };
    if (kind < 5) return line('');
    if (kind < 7) {
      return Array.from({ length: 1 + below(3) }, () => `- ${line('  ')}`).join('\n');
    }
    if (kind < 8) {
      return Array.from({ length: 1 + below(2) }, (_, i) => `${i + 1}. ${line('   ')}`).join('\n');
    }
    if (kind < 9) return `> ${line('> ')}`;
    return `## ${line(null)}`;
  }

  const blocks = Array.from({ length: 1 + below(3) }, block).join('\n\n');
  // Now and then front matter, which the first block may follow right under its closing line:
  // drawn last, so that the blocks are those of the document without it.
  const body = (random() < 0.25 ? pick(FRONT_MATTER) : '') + blocks;
  if (Object.keys(marks).length === 0 && comments.length === 0) return `${body}\n`;
  const ledger: Ledger = {
    version: 1,
    people: [
      { handle: 'ada', name: 'Ada Lovelace' },
      { handle: 'bo', name: 'Bo Chen' },
      { handle: 'claude-ada', name: 'Claude', agent: true, for: 'ada' },
    ],
    marks,
    comments,
  };
  return `${body}\n\n${serializeLedger(normalizeLedger(body, ledger))}\n`;
}
