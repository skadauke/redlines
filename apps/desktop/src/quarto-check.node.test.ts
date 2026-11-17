// The Quarto check (scripts/quarto-check.ts, docs/research/quarto-check.md) needs Quarto to render,
// which CI's ordinary jobs don't have. What it feeds Quarto is built by the format library, and that
// part is held here: the marked-up probe holds changes at the hazardous places, no marker stands on a
// fence line or inside a reference, and accepting and rejecting give files that differ.

import { acceptAll, applyChanges, newestView, rejectAll } from '@redlines/format';
import { describe, expect, it } from 'vitest';
import { probe, withMarks } from '../scripts/quarto-check.ts';

describe('the Quarto check’s probe', () => {
  for (const engine of ['markdown', 'knitr', 'jupyter'] as const) {
    it(`is marked up at the hazardous places (${engine})`, () => {
      const marked = withMarks(engine);
      expect(marked).not.toBe(probe(engine));
      // A marker never stands on a fence line, nor inside the reference (format §3.1, rule 9).
      for (const line of marked.split('\n')) {
        if (/^:::/.test(line)) expect(line).not.toContain('<!--');
      }
      expect(marked).not.toMatch(/@sec-<!--|@s<!--/);
      const accepted = applyChanges(marked, acceptAll(marked));
      const rejected = applyChanges(marked, rejectAll(marked));
      expect(accepted).not.toBe(rejected);
      expect(accepted).not.toMatch(/<!--(?:ins|del|sub|fmt|split)/);
      // The newest view of the marked file is the accepted file's text.
      expect(newestView(marked).text.trim()).toBe(newestView(accepted).text.trim());
      expect(accepted).toContain('title="Tip"');
      expect(accepted).toContain('new code');
      expect(accepted).not.toContain('old code');
      expect(rejected).toContain('old code');
    });
  }
});
