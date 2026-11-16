// An edit's scan is made from the one before it (#700), and is what scanning the whole text gives:
// random edits to a document of every construct the scan knows, tried against a fresh scan and a
// fresh parse.
import { describe, expect, it } from 'vitest';
import { parse } from './parse.ts';
import { scan, scanChanged, scanFresh } from './scan.ts';

function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

const IDS = Array.from(
  { length: 300 },
  (_, i) =>
    `b${'cdfghjkm'[i % 8]}${'npqrstvw'[Math.floor(i / 8) % 8]}${'x2345678'[Math.floor(i / 64)]}`,
);
const WORDS = 'the quick brown fox jumps over a lazy dog while reviewers read every line twice';

/** A document of every construct the scan reads: the pieces repeat, after blank lines. */
function documentOf(pieces: number): string {
  const out: string[] = [];
  let m = 0;
  const id = () => IDS[m++ % IDS.length]!;
  for (let n = 0; n < pieces; n++) {
    const a = id();
    const b = id();
    out.push(
      [
        `## Section ${n}\n\n${WORDS} ${WORDS} ${WORDS}`,
        `${WORDS} <!--ins ${a}-->an insertion<!--/${a}--> and <!--del ${b} some old words--> here, \`code <!--ins zzzz-->\` too.`,
        `\`\`\`ts\nconst x = '<!--ins ${a}-->';\n\nconst y = 2;\n\`\`\``,
        `> ${WORDS}\n> <!--sub ${a} old-->new<!--/${a}--> text\n>\n> \`\`\`\n> quoted <!--hl ${b}-->fence\n> \`\`\``,
        `- ${WORDS}\n- item <!--hl ${a}-->two<!--/${a}-->\n  \`\`\`\n  fence in item\n  \`\`\`\n- three`,
        `<!-- an ordinary comment\n\nspanning blank lines -->\n\n${WORDS}`,
        `<pre>\nraw <!--ins ${a}-->\n\nblock\n</pre>\n\n${WORDS}`,
        `${WORDS} \`\`two backticks\`\` and a lone \` backtick ${WORDS}`,
        `line one <!--split ${a}-->\nline two <!--cmt ${b}-->commented<!--/${b}-->`,
        `~~~\ntilde fence\n~~~\n\n${WORDS} ${WORDS}`,
      ][n % 10]!,
    );
  }
  const entries = IDS.slice(0, Math.min(m, IDS.length))
    .map((x) => `  ${x}: {by: ada, at: 2026-10-31T09:30Z}\n`)
    .join('');
  return `${out.join('\n\n')}\n\n<!-- redlines\nversion: 1\nmarks:\n${entries}-->\n`;
}

/** Bits that change what the scan sees: markers, fences, comments, ticks, blank lines. */
const BITS = [
  '`',
  '``',
  '```',
  '~~~',
  '<!--',
  '-->',
  '<!--ins bbbb-->',
  '<!--/bbbb-->',
  '<pre>',
  '</pre>',
  '\n',
  '\n\n',
  '> ',
  '- ',
  '  ',
  '<!-- redlines\n',
  'x',
  ' ',
  '\\',
];

describe('scanChanged', () => {
  it('is what a fresh scan gives, after random edits', () => {
    const next = random(7);
    let text = documentOf(120);
    expect(text.length).toBeGreaterThan(25_000);
    let parsed = parse(text);
    let incremental = 0;
    const rounds = 200;
    for (let round = 0; round < rounds; round++) {
      const kind = next();
      const from = Math.floor(next() * (text.length + 1));
      let to = from;
      let insert = '';
      if (kind < 0.35) insert = BITS[Math.floor(next() * BITS.length)]!;
      else if (kind < 0.6) to = Math.min(text.length, from + 1 + Math.floor(next() * 4));
      else if (kind < 0.8) {
        to = Math.min(text.length, from + Math.floor(next() * 30));
        insert = BITS[Math.floor(next() * BITS.length)]!;
      } else insert = WORDS.slice(0, Math.floor(next() * 40));
      const after = text.slice(0, from) + insert + text.slice(to);
      const change = { from, oldTo: to, newTo: from + insert.length };
      const made = scanChanged(text, after, change);
      const fresh = scanFresh(after);
      if (made) {
        incremental++;
        expect(made.markers).toEqual(fresh.markers);
        expect(made.ledgers).toEqual(fresh.ledgers);
        expect(made.verbatim).toEqual(fresh.verbatim);
        expect(scan(after)).toBe(made);
      }
      const next_ = parse(after, parsed, change);
      const whole = parse(after + '', undefined);
      expect(next_.marks).toEqual(whole.marks);
      expect(next_.warnings).toEqual(whole.warnings);
      expect(next_.ledger).toEqual(whole.ledger);
      expect(next_.ledgerRange).toEqual(whole.ledgerRange);
      expect(next_.payloads).toEqual(whole.payloads);
      // Mostly keep the edit, so that the document drifts; now and then start again from the
      // plain document, so that it doesn't fill with debris that nothing is read from.
      if (round % 25 === 24) text = documentOf(120);
      else text = after;
      parsed = next_;
    }
    // The scan was made from the earlier one for most edits, and not by scanning everything.
    expect(incremental).toBeGreaterThan(rounds / 3);
  }, 60_000);

  it('gives up where it can not be sure: front matter, an unclosed comment', () => {
    const body = documentOf(40);
    const front = `---\ntitle: x\n---\n${body}`;
    scan(front);
    expect(
      scanChanged(front, front.replace('title: x', 'title: yy'), {
        from: 11,
        oldTo: 12,
        newTo: 13,
      }),
    ).toBeUndefined();
    const open = `${body}\n\n<!-- never closed\n`;
    scan(open);
    const edited = open.replace('## Section 0', '## Section 00');
    expect(scanChanged(open, edited, { from: 12, oldTo: 12, newTo: 13 })).toBeUndefined();
  });
});
