// A Quarto callout that can't take the mark of a block change in place (no blank line before or
// after it, or no line break after its closing fence) is changed as a whole-block substitution: the old
// callout struck above the new one (docs/research/quarto.md, Q7; format §3.12).

import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { accept, reject } from './decide.ts';
import type { FormatOp } from './format-ops.ts';
import { trackedFormat } from './formatting.ts';
import { withDialect } from './dialect.ts';
import { ada, bodyOf, context, expectEveryDecision } from './test-helpers.ts';
import { newestView, originalView } from './views.ts';

const QMD = { dialect: 'pandoc' } as const;
const ctx = () => context(ada, ['m2bd', 'n3be'], QMD);
const callout = (type: string): FormatOp => ({ kind: 'callout', type });
const title = (value: string | null): FormatOp => ({ kind: 'callout-title', title: value });

const CASES: Record<string, string> = {
  'under a line of text': 'Intro line.\n::: {.callout-note}\nUse the form.\n:::\n\nAfter.\n',
  'with text right after it':
    'Intro.\n\n::: {.callout-note}\nUse the form.\n:::\nAfter, no blank.\n',
  'ending the file with no line break': 'Intro.\n\n::: {.callout-note}\nUse the form.\n:::',
};

describe('a callout outside blank lines', () => {
  for (const [name, source] of Object.entries(CASES)) {
    for (const op of [callout('warning'), title('Careful')]) {
      it(`${name}: ${op.kind} is a substitution of the callout, and reads alike in every order`, () => {
        const at = source.indexOf('::: {') + 4;
        const done = trackedFormat(source, { from: at, to: at }, op, ctx());
        const after = applyChanges(source, done.changes);
        expect(done.markIds.length).toBeGreaterThan(0);
        // The new callout is in the newest view and the old one in the original view.
        const wanted = op.kind === 'callout' ? '.callout-warning' : 'title="Careful"';
        expect(newestView(after).text).toContain(wanted);
        expect(originalView(after).text).toBe(source);
        const id = done.markIds[0]!;
        expect(applyChanges(after, reject(after, id))).toBe(source);
        expect(applyChanges(after, accept(after, id))).toContain(wanted);
        expect(bodyOf(after)).not.toMatch(/:::[^\n]*<!--/);
        expect(
          withDialect('pandoc', () => expectEveryDecision(name, source, after, done.markIds)),
        ).toBeGreaterThan(0);
      });
    }
  }
});
