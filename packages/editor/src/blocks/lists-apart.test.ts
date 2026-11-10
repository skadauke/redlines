// @vitest-environment happy-dom
// Return at the start of the first item of a list, over lists of different markers (`-`, `+`, `*`,
// `1.`, `1)`) side by side, at the same and at different depths, under a line of text and not,
// with Track Changes on and off: whatever the key writes reads as an item more in the newest view
// (micromark, the oracle), the file reads as the newest view does, and every order of decisions
// agrees (the suite's invariants). A key may refuse, in words, but it never writes a form that
// reads otherwise. The empty item of a first item cannot interrupt a paragraph, which is why the
// shapes under a line of text and under an item's text are the ones to hold.
import { newestView } from '@redlines/format';
import { micromark } from 'micromark';
import { describe, expect, it } from 'vitest';
import { invariantProblems, runScript, type Step } from './script.ts';

const MARKERS = ['-', '+', '*', '1.', '1)'];
const pad = (marker: string) => ' '.repeat(marker.length + 1);

/** The shapes: `a` the list above, `b` the list whose first item the caret is at the start of. */
function shapes(): string[] {
  const docs: string[] = [];
  for (const a of MARKERS) {
    for (const b of MARKERS) {
      for (const sep of ['⏎', '⏎⏎']) {
        docs.push(`${a} one${sep}${b} ‸delta`);
        docs.push(`${a} one⏎  more${sep}${b} ‸delta`);
        docs.push(`${a} one${sep}${pad(a)}${b} ‸delta`);
        docs.push(`${a} one⏎${pad(a)}more${sep}${pad(a)}${b} ‸delta`);
        docs.push(`${a} one${sep}${pad(a)}${b} sub${sep}${b} ‸delta`);
        docs.push(`> ${a} one${sep.replace('⏎⏎', '⏎>⏎')}> ${b} ‸delta`.replace('⏎>⏎>', '⏎>⏎>'));
      }
    }
    docs.push(`Beta⏎${a} ‸delta`, `Beta⏎⏎${a} ‸delta`, `> Beta⏎> ${a} ‸delta`);
    docs.push(`## Head⏎${a} ‸delta`, `${a} one⏎  Beta⏎  ${a} ‸delta`);
    docs.push(`${a} one⏎${a} ‸delta`, `${a} one⏎⏎${a} ‸delta`);
  }
  return docs;
}

const items = (text: string) =>
  (micromark(text, { allowDangerousHtml: true }).match(/<li/g) ?? []).length;

describe('Return at the start of a first item, lists side by side', () => {
  const keys: Step[][] = [['Enter'], ['Enter', { type: 'X' }], ['Enter', 'Backspace']];
  it('never writes a form that reads otherwise', () => {
    const failures: string[] = [];
    for (const doc of shapes()) {
      for (const tc of [true, false]) {
        for (const steps of keys) {
          const label = `${doc} ${tc ? 'on' : 'off'} ${JSON.stringify(steps)}`;
          try {
            const result = runScript({ name: label, doc, keys: steps, tc, expect: {} });
            const problems = Object.entries(invariantProblems(result)).filter(
              ([name, found]) =>
                found.length > 0 &&
                // A refused Return leaves Backspace to act as Backspace.
                !(name === 'take-back' && result.refusals.length > 0),
            );
            for (const [name, found] of problems) failures.push(`${label}: ${name}: ${found[0]}`);
            // The newest view of Return alone has one item more, or the key said why not.
            if (steps.length === 1 && result.refusals.length === 0) {
              const more =
                items(newestView(result.file).text) - items(newestView(result.start).text);
              const text = items(newestView(result.start).text);
              // A first item numbered other than 1 under text is no list, and no item.
              if (
                more !== 1 &&
                text > 0 &&
                !/(^|⏎)(?:> )?[^⏎]*\S⏎(?:> )?(?:\s*)\d+[.)] /.test(doc)
              ) {
                failures.push(`${label}: ${more} items more`);
              }
            }
          } catch (error) {
            failures.push(`${label}: threw ${String(error).slice(0, 120)}`);
          }
        }
      }
    }
    expect(failures).toEqual([]);
  }, 600_000);
});
