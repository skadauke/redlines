import { micromark } from 'micromark';
import { it } from 'vitest';
import { applyChanges } from './changes.ts';
import { trackedFormat, untrackedFormat } from './formatting.ts';
import type { FormatOp } from './formatting.ts';
import { seeded } from './random-docs.ts';
import { TIME, ada, bo, expectEveryDecision, expectEveryOrderAlike, file, bodyOf } from './test-helpers.ts';
import { fineEdits, trackedEdits } from './track.ts';
import { newestView } from './views.ts';
import type { Person } from './types.ts';

const bytes = (seed: number, step: number) => {
  const random = seeded(seed * 15485863 + step);
  return (n: number) => Uint8Array.from({ length: n }, () => Math.floor(random() * 256));
};
let at = 0;
const constant = (n: number): Uint8Array =>
  Uint8Array.from({ length: n }, () => (at++ * 7 + 3) % 19);
const msg = (e: unknown) => (e instanceof Error ? `${e.constructor.name}: ${e.message}` : String(e));
void micromark;

function edit(label: string, text: string, from: number, to: number, insert: string, who: Person = ada) {
  try {
    const view = newestView(text);
    const r = fineEdits(
      text,
      [{ from: view.map.toSource(from, 1), to: view.map.toSource(to, -1), insert }],
      { author: who, time: TIME, random: constant },
    );
    const after = applyChanges(text, r.changes);
    let every = 'ok';
    try {
      expectEveryOrderAlike(label, after);
    } catch (e) {
      every = 'ORDERS ' + msg(e).slice(0, 300);
    }
    const typed = applyChanges(view.text, [{ from, to, insert }]);
    const sq = (t: string) => t.replace(/\s+/g, '');
    const asTyped = sq(typed) === sq(newestView(after).text) && typed.split('\n').length === newestView(after).text.split('\n').length ? 'asTyped' : 'NOT-AS-TYPED typed=' + JSON.stringify(typed);
    const rd = (t: string) => micromark(t, { allowDangerousHtml: true }).replace(/<!--[^]*?-->/g, '').replace(/\s+/g, ' ').replace(/ ?(<[^>]*>) ?/g, '$1').trim();
    const same = rd(bodyOf(after)) === rd(newestView(after).text) ? 'fileReadsAsNewest' : 'FILE-READS-OTHERWISE';
    console.log(
      `PROBE ${label}: ${same} WRITTEN ${JSON.stringify(bodyOf(after))} newest=${JSON.stringify(newestView(after).text.slice(0, 120))} ${asTyped} ${every}`,
    );
  } catch (e) {
    console.log(`PROBE ${label}: ${msg(e).slice(0, 300)}`);
  }
}
function fmt(label: string, text: string, from: number, to: number, op: FormatOp, tracked = true) {
  try {
    const ctx = { author: ada, time: TIME, random: constant };
    const r = tracked
      ? trackedFormat(text, { from, to }, op, ctx)
      : { changes: untrackedFormat(text, { from, to }, op, ctx as never), markIds: [] as string[] };
    const after = applyChanges(text, r.changes);
    let every = 'ok';
    if (tracked)
      try {
        expectEveryDecision(label, text, after, r.markIds, { structure: op });
      } catch (e) {
        every = 'DECISION ' + msg(e).slice(0, 400);
      }
    const rd = (t: string) => micromark(t, { allowDangerousHtml: true }).replace(/<!--[^]*?-->/g, '').replace(/\s+/g, ' ').replace(/ ?(<[^>]*>) ?/g, '$1').trim();
    const same = rd(bodyOf(after)) === rd(newestView(after).text) ? 'fileReadsAsNewest' : 'FILE-READS-OTHERWISE';
    console.log(
      `PROBE ${label}: ${same} WRITTEN(${r.changes.length}) ${JSON.stringify(bodyOf(after))} ${every}`,
    );
  } catch (e) {
    console.log(`PROBE ${label}: ${msg(e).slice(0, 300)}`);
  }
}

it('probes', () => {
  const t = file('**b** | c\n--- | ---\nx | y');
  edit('429', t, 0, 0, '_');
  edit('429 b', t, 0, 0, 'x');
  const t2 = file('| **b** | c\n--- | ---\nx | y');
  try {
    const r = trackedEdits(t2, [{ from: 2, to: 2, insert: '_' }], { author: ada, time: TIME, random: constant });
    console.log('PROBE 429 trackedEdits ' + JSON.stringify(r.changes));
  } catch (e) { console.log('PROBE 429 trackedEdits ' + msg(e)); }
});
