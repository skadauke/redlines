// A callout typed or pasted whole with Track Changes on, at the start of a paragraph (#1169, refs
// #381): pandoc takes a `:::` fence only when nothing else is on its line (format §3.1, rule 9), so
// no marker stands on a fence line, as for a fenced code block. The insertion is the div whole, and
// its closer stands alone on the line after the closing fence.

import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { acceptAll, rejectAll } from './decide.ts';
import { expectEveryOrderRead, expectSound } from './oracle.ts';
import { ada, bodyOf, context, file } from './test-helpers.ts';
import { trackedEdits } from './track.ts';
import { newestView } from './views.ts';

const START = file('Before.\n\nAfter.');
const IDS = ['k3x9', 'w8nn', 'p5qm', 'q6rs', 'c2dd', 'f3gg', 'h4jj', 'm5nn', 'r2zd', 's3vb'];
const QMD = { dialect: 'pandoc' } as const;

function typed(insert: string, at: string, end = false) {
  const view = newestView(START).text;
  const pos = view.indexOf(at) + (end ? at.length : 0);
  const changes = trackedEdits(
    START,
    [{ from: pos, to: pos, insert }],
    context(ada, IDS, QMD),
  ).changes;
  return applyChanges(START, changes);
}

const cases: [string, string, string, boolean][] = [
  ['at the start of a paragraph', 'After', '::: {.callout-tip}\nA tip.\n:::\n\n', false],
  [
    'with a title and two paragraphs',
    'After',
    '::: {.callout-tip}\n## A tip\n\nOne.\n\nTwo.\n:::\n\n',
    false,
  ],
  ['at the end of a paragraph', 'Before.', '\n\n::: {.callout-note}\nA note.\n:::', true],
  ['at the start of the document', 'Before', '::: {.callout-warning}\nCareful.\n:::\n\n', false],
];

describe('a callout inserted whole (#1169)', () => {
  for (const [label, at, insert, end] of cases) {
    it(
      label,
      () => {
        const after = typed(insert, at, end);
        // No marker on a fence line.
        for (const line of bodyOf(after).split('\n')) {
          if (/^[ \t]*:{3,}/.test(line)) expect(line, after).not.toMatch(/<!--/);
        }
        expect(bodyOf(after)).toContain(insert.replace(/\n\n$/, '\n').replace(/^\n\n/, ''));
        expectEveryOrderRead(label, after);
        expectSound(label, after);
        // Rejecting gives the document back, and accepting keeps the callout, with no marks left.
        const rejected = applyChanges(after, rejectAll(after, undefined, 'pandoc'));
        expect(bodyOf(rejected).replace(/\s+/g, ' ').trim()).toBe('Before. After.');
        const accepted = applyChanges(after, acceptAll(after, undefined, 'pandoc'));
        expect(bodyOf(accepted)).not.toMatch(/<!--/);
        expect(bodyOf(accepted)).toMatch(/^[ \t]*:::[ \t]*$/m);
      },
      60_000,
    );
  }
});
