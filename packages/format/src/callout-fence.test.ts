// The type and the title of a Quarto callout (docs/research/quarto.md, Q7): a block format change of
// the div, `was=fence=ATTRIBUTES`, with no marker on a `:::` line (format §3.1, rule 9).

import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { readFenceLine, rewriteFence, titleOf } from './callout-fence.ts';
import { accept, reject } from './decide.ts';
import type { FormatOp } from './format-ops.ts';
import { formatChange } from './format-blocks.ts';
import { fineFormat as trackedFormat, untrackedFormat } from './formatting.ts';
import { parse } from './parse.ts';
import { withDialect } from './dialect.ts';
import { ada, bodyOf, context, expectEveryDecision } from './test-helpers.ts';
import type { Range } from './types.ts';
import { newestView, originalView } from './views.ts';

const QMD = { dialect: 'pandoc' } as const;
const ctx = (...ids: string[]) => context(ada, ids.length > 0 ? ids : ['m2bd'], QMD);
const callout = (type: string): FormatOp => ({ kind: 'callout', type });
const title = (value: string | null): FormatOp => ({ kind: 'callout-title', title: value });

const SOURCE = [
  '---',
  'title: "Sepsis audit"',
  'format: html',
  '---',
  '',
  '## Methods {#sec-methods}',
  '',
  'We used the cohort in @fig-flow and [@smith2020].',
  '',
  '::: {.callout-note}',
  'Report every ward the same way.',
  ':::',
  '',
  'Results follow.',
  '',
].join('\n');

/** The caret on the opening fence of the callout. */
const onFence = (text: string): Range => {
  const at = text.search(/^::: /m) + 4;
  return { from: at, to: at };
};

const tracked = (text: string, op: FormatOp, c = ctx()) =>
  applyChanges(text, trackedFormat(text, onFence(text), op, c).changes);
const rejected = (text: string, id: string) => applyChanges(text, reject(text, id));
const accepted = (text: string, id: string) => applyChanges(text, accept(text, id));
/** Every order of decisions, read as a `.qmd` is. */
const everyDecision = (label: string, before: string, after: string) =>
  withDialect('pandoc', () => expectEveryDecision(label, before, after, ['m2bd']));
const body = (text: string) => `${bodyOf(text).replace(/[\r\n]+$/, '')}\n`;

describe('the attribute text of a callout fence', () => {
  it('reads the type and the title, in a braced and a bare fence', () => {
    expect(readFenceLine('::: {.callout-tip title="A tip" collapse="true"}')?.type).toBe('tip');
    expect(readFenceLine('::: callout-warning')?.type).toBe('warning');
    expect(readFenceLine('::: {.columns}')).toBeUndefined();
    expect(readFenceLine(':::')).toBeUndefined();
    expect(titleOf('{.callout-tip title="A \\"quoted\\" tip"}')).toBe('A "quoted" tip');
    expect(titleOf('{.callout-tip}')).toBeNull();
  });

  it('rewrites the type and the title and keeps the rest as written', () => {
    const text = '{#nte-a .callout-note collapse="true" title="Old, with callout-tip"}';
    expect(rewriteFence(text, { type: 'tip' })).toBe(
      '{#nte-a .callout-tip collapse="true" title="Old, with callout-tip"}',
    );
    expect(rewriteFence(text, { title: 'New' })).toBe(
      '{#nte-a .callout-note collapse="true" title="New"}',
    );
    expect(rewriteFence(text, { title: null })).toBe('{#nte-a .callout-note collapse="true"}');
    expect(rewriteFence('{.callout-note}', { title: 'Hi "you"' })).toBe(
      '{.callout-note title="Hi \\"you\\""}',
    );
    expect(rewriteFence('callout-note', { title: 'Hi' })).toBe('{.callout-note title="Hi"}');
    expect(rewriteFence('callout-note', { type: 'tip' })).toBe('callout-tip');
  });
});

describe('a change of a callout’s type in a .qmd', () => {
  it('writes the marks outside the fences, and rejecting gives the file back', () => {
    const after = tracked(SOURCE, callout('warning'));
    expect(body(after)).toContain(
      [
        '<!--fmt m2bd was=fence={.callout-note}-->',
        '',
        '::: {.callout-warning}',
        'Report every ward the same way.',
        ':::',
        '<!--/m2bd-->',
        'Results follow.',
      ].join('\n'),
    );
    expect(rejected(after, 'm2bd')).toBe(SOURCE);
    expect(accepted(after, 'm2bd')).toBe(SOURCE.replace('.callout-note', '.callout-warning'));
  });

  it('reads right in the views, and is named for the cards', () => {
    const after = tracked(SOURCE, callout('caution'));
    expect(newestView(after).text).toContain('::: {.callout-caution}');
    expect(originalView(after).text).toContain('::: {.callout-note}');
    expect(originalView(after).text).not.toContain('caution');
    const [mark] = parse(after).marks;
    expect(mark && formatChange(parse(after), mark)).toEqual([callout('caution')]);
  });

  it('is the same in every order of decisions', () => {
    const after = tracked(SOURCE, callout('tip'));
    expect(everyDecision('callout type', SOURCE, after)).toBeGreaterThan(0);
  });

  it('asks nothing for the type it has', () => {
    expect(trackedFormat(SOURCE, onFence(SOURCE), callout('note'), ctx()).changes).toEqual([]);
  });

  it('changes your own change in place, and turning it back takes the mark away', () => {
    const tip = tracked(SOURCE, callout('tip'));
    const back = trackedFormat(tip, onFence(tip), callout('note'), ctx('z9z9'));
    expect(applyChanges(tip, back.changes)).toBe(SOURCE);
    const again = trackedFormat(tip, onFence(tip), callout('caution'), ctx('z9z9'));
    const text = applyChanges(tip, again.changes);
    expect(again.extendedIds).toEqual(['m2bd']);
    expect(body(text)).toContain('was=fence={.callout-note}');
    expect(rejected(text, 'm2bd')).toBe(SOURCE);
  });

  it('is plain text with Track Changes off', () => {
    const plain = untrackedFormat(SOURCE, onFence(SOURCE), callout('tip'), {
      author: ada,
      ...QMD,
    });
    expect(applyChanges(SOURCE, plain)).toBe(SOURCE.replace('.callout-note', '.callout-tip'));
  });

  it('works for a callout that ends the file, and for one with a title and an id', () => {
    const last =
      '## A\n\n::: {#nte-x .callout-tip title="Mind the gap" collapse="true"}\nText.\n:::\n';
    const after = tracked(last, callout('important'));
    expect(rejected(after, 'm2bd')).toBe(last);
    expect(accepted(after, 'm2bd')).toBe(last.replace('.callout-tip', '.callout-important'));
  });
});

describe('a change of a callout’s title in a .qmd', () => {
  it('sets a title, and rejecting takes it away', () => {
    const after = tracked(SOURCE, title('Audit scope'));
    expect(body(after)).toContain('::: {.callout-note title="Audit scope"}');
    expect(body(after)).toContain('was=fence={.callout-note}');
    expect(rejected(after, 'm2bd')).toBe(SOURCE);
    expect(accepted(after, 'm2bd')).toContain('::: {.callout-note title="Audit scope"}\n');
    expect(everyDecision('callout title', SOURCE, after)).toBeGreaterThan(0);
  });

  it('clears a title, and rejecting writes it back as it was', () => {
    const titled = SOURCE.replace(
      '{.callout-note}',
      '{.callout-note title="Audit  scope" collapse="false"}',
    );
    const after = tracked(titled, title(null));
    expect(body(after)).toContain('::: {.callout-note collapse="false"}');
    expect(rejected(after, 'm2bd')).toBe(titled);
    const [mark] = parse(after).marks;
    expect(mark && formatChange(parse(after), mark)).toEqual([title(null)]);
  });

  it('a type and a title together stay one mark, and name both', () => {
    const one = tracked(SOURCE, callout('tip'));
    const two = trackedFormat(one, onFence(one), title('Why'), ctx('z9z9'));
    const text = applyChanges(one, two.changes);
    expect(two.extendedIds).toEqual(['m2bd']);
    expect(rejected(text, 'm2bd')).toBe(SOURCE);
    const [mark] = parse(text).marks;
    expect(mark && formatChange(parse(text), mark)).toEqual([callout('tip'), title('Why')]);
  });

  it('leaves a .md file alone: no callout there to change', () => {
    expect(() =>
      trackedFormat(SOURCE, onFence(SOURCE), title('x'), context(ada, ['m2bd'])),
    ).toThrow();
  });
});
