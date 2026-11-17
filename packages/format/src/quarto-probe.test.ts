// The Quarto probe (docs/research/quarto.md, "The probe"): edits at the constructs of a `.qmd` that
// pandoc reads by its own grammar. No marker stands on a `:::` line or inside an `@fig-x` token, in
// the file as written or after any decision, and the file reads alike in every order.

import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { expectEveryOrderRead, expectSound } from './oracle.ts';
import { ada, bodyOf, context, file } from './test-helpers.ts';
import { trackedEdits } from './track.ts';
import { newestView } from './views.ts';

const BODY = [
  '# Intro {#sec-intro}',
  '',
  '::: {.callout-note title="Note"}',
  'Careful with @fig-plot and [@smith2020, p. 4].',
  ':::',
  '',
  'See @sec-intro.',
].join('\n');
const START = file(BODY);
const IDS = ['k3x9', 'w8nn', 'p5qm', 'q6rs', 'c2dd', 'f3gg', 'h4jj', 'm5nn', 'r2zd', 's3vb'];

/** The hazards pandoc has: a marker on a fence line, or inside a reference token. */
function hazards(text: string): string[] {
  const out: string[] = [];
  const body = bodyOf(text);
  for (const line of body.split('\n')) {
    if (/^[ \t]*:{3,}/.test(line) && /<!--/.test(line)) out.push(`fence line: ${line}`);
  }
  // A marker with a label character on each side of it is inside the key.
  if (/@(?:fig|sec|tbl|eq)[\w-]*<!--[^>]*-->[\w-]/.test(body)) out.push('marker in a label');
  if (/(?:^|[^\w])@(?:fig|sec|tbl|eq)<!--/.test(body)) out.push('marker in a label prefix');
  if (/\[-?@[^\]\n]*<!--(?!\/)/.test(body)) out.push('marker in a citation');
  return out;
}

function edit(find: string, replace: string, offset: number, length: number) {
  const view = newestView(START).text;
  const at = view.indexOf(find) + offset;
  const changes = trackedEdits(
    START,
    [{ from: at, to: at + length, insert: replace }],
    context(ada, IDS),
  ).changes;
  return applyChanges(START, changes);
}

// [label, text to find, replacement, offset into it, length replaced]
const cases: [string, string, string, number, number][] = [
  ['fence attributes, insert', '{.callout-note', 'X', 2, 0],
  ['fence attributes, word', '.callout-note', '.callout-tip', 0, 13],
  ['fence title', 'title="Note"', 'title="Tip"', 0, 12],
  ['closing fence, between colons', '\n:::\n', 'X', 2, 0],
  ['closing fence, after', '\n:::\n', 'X', 4, 0],
  ['closing fence, before', '\n:::\n', 'X', 1, 0],
  ['delete a colon of the closing fence', '\n:::\n', '', 2, 1],
  ['delete the opening fence colons', '::: {.callout', '', 0, 3],
  ['insert in @fig-plot, after the dash', '@fig-plot', 'X', 5, 0],
  ['insert in @fig-plot, in the prefix', '@fig-plot', 'X', 2, 0],
  ['delete a letter of @fig-plot', '@fig-plot', '', 6, 1],
  ['replace the key', 'fig-plot', 'fig-line', 0, 8],
  ['before @fig-plot', '@fig-plot', 'X', 0, 0],
  ['insert in a citation key', 'smith2020', 'X', 5, 0],
  ['citation page', 'p. 4', 'p. 5', 0, 4],
  ['inside @sec-intro', '@sec-intro.', 'X', 6, 0],
  ['delete @fig-plot', '@fig-plot', '', 0, 9],
  ['delete a citation', '[@smith2020, p. 4]', '', 0, 18],
  ['a word in the callout', 'Careful', 'Very careful', 0, 7],
];

describe('the probe: edits at Quarto constructs', () => {
  for (const [label, find, replace, offset, length] of cases) {
    it(label, () => {
      const after = edit(find, replace, offset, length);
      expect(hazards(after), after).toEqual([]);
      expectEveryOrderRead(label, after);
      expectSound(label, after);
    });
  }
});

describe('superscripts', () => {
  const START2 = file('E = mc^2^ and x^2^ here.');
  const cases2: [string, string, string, number, number][] = [
    ['inside a superscript', '^2^', 'X', 2, 0],
    ['delete a superscript', '^2^', '', 0, 3],
  ];
  for (const [label, find, insert, offset, length] of cases2) {
    it(label, () => {
      const at = newestView(START2).text.indexOf(find) + offset;
      const changes = trackedEdits(
        START2,
        [{ from: at, to: at + length, insert }],
        context(ada, IDS),
      ).changes;
      const after = applyChanges(START2, changes);
      expect(bodyOf(after)).not.toMatch(/\^[^\s^]*<!--(?!\/)/);
      expectEveryOrderRead(label, after);
      expectSound(label, after);
    });
  }
});

describe('typing next to a token', () => {
  // Text typed after a key goes outside it, as its own insertion: the file shows the key as it was
  // until the insertion is accepted, and every order of decisions reads alike.
  it('after @fig-plot', () => {
    const after = edit('@fig-plot', 'X', 9, 0);
    expect(after).toContain('@fig-plot<!--ins');
    expectEveryOrderRead('after', after);
  });
});

describe('new and deleted divs', () => {
  const typed = (insert: string, after: string) => {
    const view = newestView(START).text;
    const at = view.indexOf(after) + after.length;
    const changes = trackedEdits(START, [{ from: at, to: at, insert }], context(ada, IDS)).changes;
    return applyChanges(START, changes);
  };
  const divs: [string, string][] = [
    ['a callout, one paragraph', '\n\n::: {.callout-tip}\nA tip.\n:::'],
    ['a callout, two paragraphs', '\n\n::: {.callout-tip}\nA tip.\n\nMore.\n:::'],
    ['a callout with blank lines inside', '\n\n::: {.callout-tip}\n\nA tip.\n\n:::'],
    [
      'columns',
      '\n\n:::: {.columns}\n::: {.column width="50%"}\nLeft\n:::\n\n::: {.column}\nRight\n:::\n::::',
    ],
    ['an empty div', '\n\n::: {.hidden}\n:::'],
  ];
  for (const [label, insert] of divs) {
    for (const where of ['# Intro {#sec-intro}', 'See @sec-intro.']) {
      it(`${label}, typed after "${where}"`, () => {
        const after = typed(insert, where);
        expect(hazards(after), after).toEqual([]);
        expect(newestView(after).text).toContain(insert.trim());
        expectEveryOrderRead(label, after);
        expectSound(label, after);
      });
    }
  }
  it('typed in one go in the callout, before its closing fence', () => {
    const after = typed('\n\n::: {.callout-tip}\nA tip.\n:::', 'p. 4].');
    expect(hazards(after), after).toEqual([]);
    expectEveryOrderRead('inside', after);
  });
  it('deleting a whole callout', () => {
    const view = newestView(START).text;
    const from = view.indexOf('::: {.callout-note');
    const to = view.indexOf('See @sec-intro');
    const changes = trackedEdits(START, [{ from, to, insert: '' }], context(ada, IDS)).changes;
    const after = applyChanges(START, changes);
    expect(hazards(after), after).toEqual([]);
    expectEveryOrderRead('delete', after);
  });
});
