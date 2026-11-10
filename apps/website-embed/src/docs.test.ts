import { parse, reviewView, serializeLedger } from '@redlines/format';
import { describe, expect, it } from 'vitest';
import { DOCS } from './docs.ts';

describe('the sample documents', () => {
  it('parses both files without a warning', () => {
    for (const { text } of Object.values(DOCS)) expect(parse(text).warnings).toEqual([]);
  });

  it('writes the plan’s ledger as the format writes it', () => {
    const text = DOCS.plan.text;
    expect(serializeLedger(parse(text).ledger)).toBe(
      text.slice(text.indexOf('<!-- redlines'), text.lastIndexOf('-->') + 3),
    );
  });

  it('says what the hero has always said', () => {
    expect(reviewView(DOCS.plan.text)).toBe(
      '# Launch plan\n\nWe will ship the {++new ++}[k3x9 ada]importer in {~~March~>April~~}[p7qd claude-ada], after the {==security review==}{>>[c8d2 bo] Who signs off on the security review?<<}.{-- The old exporter stays as it is.--}[w2rf bo]\n',
    );
  });

  it('gives the design note no ledger', () => {
    expect(parse(DOCS.design.text).ledgerRange).toBeNull();
  });
});
