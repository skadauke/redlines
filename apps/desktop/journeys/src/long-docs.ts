// Long documents for the scrolling journeys (#695), made from code so that nothing big is in git.
// They are deterministic: the same call is the same text.

const REST = 'bcdfghjkmnpqrstvwxz23456789';
/** A valid mark id for each number (the ids of docs/format.md: a letter, then three of REST). */
const idFor = (n: number): string =>
  `b${REST[Math.floor(n / 729) % 27]}${REST[Math.floor(n / 27) % 27]}${REST[n % 27]}`;

/** A small deterministic generator (mulberry32), so that every run draws the same bytes. */
function random(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = (
  'the quick brown fox jumps over a lazy dog while reviewers read every line twice and ' +
  'agents suggest changes in their own name so that nothing is lost between drafts'
).split(' ');

function sentence(next: () => number, words: number): string {
  const out: string[] = [];
  for (let i = 0; i < words; i++) out.push(WORDS[Math.floor(next() * WORDS.length)]!);
  const text = out.join(' ');
  return text.charAt(0).toUpperCase() + text.slice(1) + '.';
}

/** The base64 of about `chars` characters of pseudo-random bytes behind a PNG's signature. */
function pngBase64(next: () => number, chars: number): string {
  const bytes = Buffer.alloc(Math.floor((chars * 3) / 4));
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
  for (let i = 8; i < bytes.length; i++) bytes[i] = Math.floor(next() * 256);
  return bytes.toString('base64');
}

export const END_OF_DOCUMENT = 'The very last paragraph, which must read exactly right.';

function ledger(marks: string[], comments: string[]): string {
  const entries = marks.map((id) => `  ${id}: {by: ada, at: 2026-11-10T09:30Z}\n`).join('');
  const threads = comments
    .map((id) => `  ${id}:\n    by: ada\n    at: 2026-11-10T09:31Z\n    text: Is this right?\n`)
    .join('');
  return (
    `\n<!-- redlines\nversion: 1\npeople:\n  ada: {name: Ada Lovelace}\n` +
    `marks:\n${entries}comments:\n${threads}-->\n`
  );
}

/**
 * A document of the shape of the one that stalled the app (#694): about 12,700 lines, 18 of them
 * very long (84% of the bytes, the longest 1.5 million characters): base64 PNG `data:` URIs in code
 * spans, in quoted list items.
 */
export function longLinesDocument(): string {
  const next = random(694);
  const lines: string[] = ['# Notes with pictures', ''];
  // The 18 long lines' sizes in characters: the first is the longest, about 3.9 million in all.
  const sizes = [1_541_728, 520_000, 380_000, 300_000, 240_000, 200_000, 160_000, 130_000];
  while (sizes.length < 18) sizes.push(60_000 - sizes.length * 2_000);
  const at = new Set(sizes.map((_, i) => 400 + i * 650));
  let long = 0;
  for (let n = 0; lines.length < 12_700; n++) {
    if (at.has(n)) {
      const data = pngBase64(next, sizes[long]!);
      lines.push(`> - Screenshot ${long}: \`data:image/png;base64,${data}\``);
      long++;
    } else if (n % 40 === 0) {
      lines.push('', `## Section ${n / 40}`, '');
    } else if (n % 7 === 0) {
      lines.push(`- ${sentence(next, 9)}`);
    } else {
      lines.push(`${sentence(next, 12)} ${sentence(next, 8)}`);
    }
  }
  lines.push('', END_OF_DOCUMENT, '');
  return lines.join('\n');
}

/**
 * Ordinary text of about `bytes` characters, with headings, lists, tables, images, and hundreds of
 * tracked changes and comments, and a ledger at the end.
 */
export function ordinaryDocument(bytes: number, marks = 600): string {
  const next = random(bytes);
  const blocks: string[] = ['# A long document', ''];
  const ids: string[] = [];
  const comments: string[] = [];
  let size = 0;
  let n = 0;
  // The marks are spread over the paragraphs, evenly.
  const every = Math.max(1, Math.floor(bytes / 330 / marks));
  while (size < bytes) {
    let text = `${sentence(next, 30)} ${sentence(next, 22)}`;
    if (n % every === 0 && ids.length < marks) {
      const id = idFor(ids.length);
      ids.push(id);
      const kind = ['ins', 'del', 'cmt', 'hl'][ids.length % 4]!;
      if (kind === 'cmt') comments.push(id);
      if (kind === 'del') text += `<!--del ${id}  An old sentence that was removed.-->`;
      else text = text.replace('quick brown', `<!--${kind} ${id}-->quick brown<!--/${id}-->`);
    }
    if (n % 25 === 0) blocks.push(`## Section ${n / 25}`, '');
    blocks.push(text, '');
    size += text.length + 2;
    if (n % 9 === 4) {
      blocks.push(`- ${sentence(next, 7)}`, `- ${sentence(next, 6)}`, '  - nested', '');
      size += 80;
    }
    if (n % 31 === 5) {
      blocks.push('| Item | Count | Note |', '| ---- | ----- | ---- |');
      for (let r = 0; r < 4; r++) blocks.push(`| item ${n}.${r} | ${r} | ${sentence(next, 4)} |`);
      blocks.push('');
      size += 200;
    }
    if (n % 40 === 7) {
      blocks.push(`![figure ${n}](images/figure-${n}.png)`, '');
      size += 40;
    }
    n++;
  }
  blocks.push(END_OF_DOCUMENT, '');
  return blocks.join('\n') + ledger(ids, comments);
}
