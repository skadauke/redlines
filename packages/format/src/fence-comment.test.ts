// A comment or a highlight on a `:::` fence line of a `.qmd` is widened, not refused: out to the whole
// div (markers on their own lines outside the fences), or in to the body.

import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { addComment, deleteThread } from './comments.ts';
import { reject } from './decide.ts';
import { trackedFormat } from './formatting.ts';
import { addHighlight } from './highlights.ts';
import { ada, bodyOf, context } from './test-helpers.ts';
import { newestView, originalView } from './views.ts';

const QMD = [
  '---',
  'title: "Triage study"',
  '---',
  '',
  '## Methods {#sec-methods}',
  '',
  'We followed the protocol.',
  '',
  '::: {.callout-note}',
  'Report every ward the same way.',
  '',
  'Use the form.',
  ':::',
  '',
  'Results follow.',
  '',
].join('\n');

const ctx = (...ids: string[]) =>
  context(ada, ids.length > 0 ? ids : ['c2bd'], { dialect: 'pandoc' });
const at = (needle: string, length = needle.length, from = 0) => {
  const start = QMD.indexOf(needle, from);
  if (start === -1) throw new Error(`${needle} is not in the text`);
  return { from: start, to: start + length };
};
const FENCE = '::: {.callout-note}';

/** No line that is a fence has anything else on it. */
const fencesAlone = (text: string) => {
  for (const line of bodyOf(text).split('\n')) {
    if (line.includes(':::')) expect(line).toMatch(/^:{3,}(?: \{[^}]*\})?$/);
  }
};

describe('a comment whose range is on a fence', () => {
  it('goes out to the whole div from the opening fence', () => {
    const { changes } = addComment(QMD, at(FENCE), 'Which callout?', ctx());
    const after = applyChanges(QMD, changes);
    fencesAlone(after);
    expect(after).toContain('<!--cmt c2bd-->\n::: {.callout-note}');
    expect(after).toContain('Use the form.\n:::\n<!--/c2bd-->');
    expect(newestView(after).text).toBe(QMD);
    expect(originalView(after).text).toBe(QMD);
  });

  it('goes out to the whole div from the closing fence, and from a point on a fence', () => {
    const close = QMD.indexOf('\n:::\n') + 1;
    for (const range of [
      { from: close, to: close + 3 },
      { from: close + 1, to: close + 1 },
    ]) {
      const { changes } = addComment(QMD, range, 'x', ctx());
      const after = applyChanges(QMD, changes);
      fencesAlone(after);
      expect(after).toContain('<!--cmt c2bd-->\n::: {.callout-note}');
      expect(newestView(after).text).toBe(QMD);
    }
  });

  it('goes out to the whole div from a range that runs from text above into it', () => {
    const from = QMD.indexOf('the protocol');
    const to = QMD.indexOf(FENCE) + 6;
    const { changes } = addComment(QMD, { from, to }, 'x', ctx());
    const after = applyChanges(QMD, changes);
    fencesAlone(after);
    expect(after).toContain('<!--cmt c2bd-->the protocol');
    expect(after).toContain('Use the form.\n:::\n<!--/c2bd-->');
    expect(newestView(after).text).toBe(QMD);
  });

  it('is pulled in to the body when the range is inside the div', () => {
    const from = QMD.indexOf(FENCE) + 2;
    const to = QMD.indexOf('Use the');
    const { changes } = addComment(QMD, { from, to: to + 3 }, 'x', ctx());
    const after = applyChanges(QMD, changes);
    fencesAlone(after);
    expect(after).not.toContain('<!--cmt c2bd-->\n::: ');
    expect(after.indexOf('<!--cmt c2bd-->')).toBeGreaterThan(after.indexOf(FENCE));
    expect(newestView(after).text).toBe(QMD);
    const end = QMD.indexOf('Use the form.');
    const upto = QMD.indexOf('\n:::\n') + 2;
    const toEnd = addComment(QMD, { from: end, to: upto }, 'y', ctx('d3cm'));
    const closed = applyChanges(QMD, toEnd.changes);
    fencesAlone(closed);
    expect(closed.indexOf('<!--/d3cm-->')).toBeLessThan(closed.lastIndexOf('\n:::'));
    expect(newestView(closed).text).toBe(QMD);
  });

  it('works in a div with no body, and in a nested div', () => {
    const empty = 'Before.\n\n::: {.columns}\n:::\n\nAfter.\n';
    const one = addComment(
      empty,
      { from: empty.indexOf(':::') + 1, to: empty.indexOf(':::') + 1 },
      'x',
      ctx(),
    );
    const after = applyChanges(empty, one.changes);
    fencesAlone(after);
    expect(newestView(after).text).toBe(empty);
    const nested = 'Before.\n\n:::: {.columns}\n::: {.column}\nText.\n:::\n::::\n\nAfter.\n';
    const inner = nested.indexOf('::: {.column}') + 1;
    const two = addComment(nested, { from: inner, to: inner }, 'x', ctx());
    const made = applyChanges(nested, two.changes);
    fencesAlone(made);
    expect(made).toContain('<!--cmt c2bd-->\n::: {.column}');
    expect(newestView(made).text).toBe(nested);
  });

  it('is the same text again in every order of deleting overlapping threads', () => {
    // Three threads on the same div: the whole div twice, and one on its body.
    const first = addComment(QMD, at(FENCE), 'a', ctx('c2bd'));
    let text = applyChanges(QMD, first.changes);
    const closeAt = text.indexOf('\n:::\n') + 1;
    const second = addComment(text, { from: closeAt, to: closeAt + 3 }, 'b', ctx('d3cm'));
    text = applyChanges(text, second.changes);
    const bodyAt = text.indexOf('Report');
    const third = addComment(
      text,
      { from: bodyAt, to: bodyAt + 6 },
      'c',
      ctx('e4dn', 'f5eo', 'g6fp'),
    );
    text = applyChanges(text, third.changes);
    fencesAlone(text);
    expect(newestView(text).text).toBe(QMD);
    const ids = [first.id, second.id, third.id];
    const orders = [
      [0, 1, 2],
      [0, 2, 1],
      [1, 0, 2],
      [1, 2, 0],
      [2, 0, 1],
      [2, 1, 0],
    ];
    for (const order of orders) {
      let now = text;
      for (const i of order) {
        now = applyChanges(now, deleteThread(now, ids[i]!));
        fencesAlone(now);
        expect(newestView(now).text).toBe(QMD);
      }
      expect(now, order.join()).toBe(QMD);
    }
  });
});

describe('a highlight whose range is on a fence', () => {
  it('goes out to the whole div, and into the body', () => {
    const out = applyChanges(QMD, addHighlight(QMD, at(FENCE), ctx('h7jk')).changes);
    fencesAlone(out);
    expect(out).toContain('<!--hl h7jk-->\n::: {.callout-note}');
    expect(newestView(out).text).toBe(QMD);
    const from = QMD.indexOf(FENCE) + 2;
    const to = QMD.indexOf('Use the') + 3;
    const inside = applyChanges(QMD, addHighlight(QMD, { from, to }, ctx('h7jk')).changes);
    fencesAlone(inside);
    expect(newestView(inside).text).toBe(QMD);
  });
});

describe('a comment on a fence in a .md file', () => {
  it('is still the Markdown rules: the colons are text', () => {
    const { changes } = addComment(QMD, at(FENCE), 'x', context(ada, ['c2bd']));
    expect(applyChanges(QMD, changes)).not.toContain(':::\n<!--/c2bd-->');
  });
});

describe('the edges of a div', () => {
  const TIGHT = 'Intro.\n\n::: {.callout-note}\nUse the form.\n:::\nResults.\n';

  it('gives the bytes back where no blank line follows the closing fence', () => {
    for (const text of [TIGHT, TIGHT.replaceAll('\n', '\r\n')]) {
      const open = text.indexOf(':::') + 1;
      const done = addComment(text, { from: open, to: open }, 'x', ctx());
      const after = applyChanges(text, done.changes);
      expect(newestView(after).text).toBe(text);
      expect(applyChanges(after, deleteThread(after, done.id))).toBe(text);
    }
  });

  it('puts the new marks outside a pending change of the callout, so that no two cross', () => {
    const base = applyChanges(
      QMD,
      trackedFormat(QMD, at(FENCE), { kind: 'callout', type: 'warning' }, ctx('m2bd')).changes,
    );
    const fence = base.indexOf('::: {.callout-warning}') + 1;
    const done = addComment(base, { from: fence, to: fence }, 'x', ctx('c2bd'));
    const after = applyChanges(base, done.changes);
    expect(after.indexOf('<!--cmt c2bd-->')).toBeLessThan(after.indexOf('<!--fmt m2bd'));
    expect(after.indexOf('<!--/m2bd-->')).toBeLessThan(after.indexOf('<!--/c2bd-->'));
    const back = bodyOf(applyChanges(after, reject(after, 'm2bd')));
    expect(back).toContain('<!--cmt c2bd-->\n::: {.callout-note}');
    expect(back).not.toContain('fmt');
    fencesAlone(back);
  });

  it('takes a point at the first column of a body, and a range with the fence’s line break', () => {
    const body = QMD.indexOf('Report');
    const point = applyChanges(QMD, addComment(QMD, { from: body, to: body }, 'x', ctx()).changes);
    expect(newestView(point).text).toBe(QMD);
    const from = QMD.indexOf(FENCE);
    const to = QMD.indexOf('\n:::\n') + 5;
    const whole = applyChanges(QMD, addComment(QMD, { from, to }, 'x', ctx()).changes);
    fencesAlone(whole);
    expect(newestView(whole).text).toBe(QMD);
  });
});
