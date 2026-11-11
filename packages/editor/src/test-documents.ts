// Documents for tests and their measurements: not part of the package.

const REST = 'bcdfghjkmnpqrstvwxz23456789';

/** A valid mark id (format-changes §2) for each number. */
export const idFor = (n: number): string =>
  `b${REST[Math.floor(n / 729) % 27]}${REST[Math.floor(n / 27) % 27]}${REST[n % 27]}`;

const WORDS = 'the quick brown fox jumps over a lazy dog while reviewers read every line twice';

/**
 * A table of `rows` rows and 5 columns, with `marks` insertions in its cells, spread over its rows,
 * for the document that measures what a table costs. `ids` are the marks' ids.
 */
export function bigTable(rows: number, marks: number, ids: readonly string[]): string {
  const lines = [
    '| Item | Count | Place | Note | Owner |',
    '| ---- | ----- | ----- | ---- | ----- |',
  ];
  for (let n = 0; n < rows; n++) {
    const cells = [
      `item ${n}`,
      `${n}`,
      `place ${n}`,
      `${WORDS.split(' ').slice(0, 5).join(' ')}`,
      `owner ${n % 9}`,
    ];
    const k = Math.floor((n * marks) / rows);
    if (marks > 0 && Math.floor(((n + 1) * marks) / rows) > k && ids[k]) {
      cells[3] = `${cells[3]} <!--ins ${ids[k]}-->added<!--/${ids[k]}-->`;
    }
    lines.push(`| ${cells.join(' | ')} |`);
  }
  return lines.join('\n');
}

/**
 * Roughly 6,000 words in 300 paragraphs: 240 marks, 20 images, headings, lists and links. With
 * `table`, a 300-row table of 5 columns with 40 more marks in its cells stands in the middle.
 */
export function longDocument(options: { table?: boolean } = {}): {
  doc: string;
  firstMark: number;
} {
  const ids: string[] = [];
  const comments: string[] = [];
  const paragraphs: string[] = [];
  for (let n = 0; n < 300; n++) {
    let text = `${WORDS} ${n} with *emphasis* and **strong** and a [link](https://example.com/${n}) end.`;
    if (n % 15 === 0) paragraphs.push(`## Section ${n / 15}`);
    if (n % 5 === 0 && n / 5 < 20) text += `\n\n![figure ${n}](images/figure-${n}.png)`;
    if (n % 25 === 3) text = `- ${text}\n- second item of the list`;
    // Task boxes and entities, which the preview draws as widgets.
    if (n % 20 === 9) text = `- [ ] ${text} Fish &amp; chips\n- [x] done &mdash; &#169; item`;
    if (n < 240) {
      const id = idFor(n);
      ids.push(id);
      const kind = n % 3 === 0 ? 'ins' : n % 3 === 1 ? 'hl' : 'cmt';
      if (kind === 'cmt') comments.push(id);
      text = text.replace('quick brown', `<!--${kind} ${id}-->quick brown<!--/${id}-->`);
    }
    paragraphs.push(text);
    if (options.table && n === 150) {
      const tableIds = Array.from({ length: 40 }, (_, i) => idFor(1000 + i));
      ids.push(...tableIds);
      paragraphs.push(bigTable(300, 40, tableIds));
    }
  }
  const entries = ids.map((id) => `  ${id}: {by: ada, at: 2026-10-31T09:30Z}\n`).join('');
  const threads = comments
    .map((id) => `  ${id}:\n    by: ada\n    at: 2026-10-31T09:30Z\n    text: A question.\n`)
    .join('');
  const body = paragraphs.join('\n\n');
  const doc = `${body}\n\n<!-- redlines\nversion: 1\nmarks:\n${entries}comments:\n${threads}-->\n`;
  return { doc, firstMark: doc.indexOf(`<!--ins ${idFor(0)}-->`) };
}
