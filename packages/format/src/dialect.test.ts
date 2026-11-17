import { describe, expect, it } from 'vitest';
import { dialectOfName, isPandoc, withDialect } from './dialect.ts';

describe('dialect', () => {
  it('reads the dialect from the name', () => {
    expect(dialectOfName('paper.qmd')).toBe('pandoc');
    expect(dialectOfName('/a/b/Report.Rmd')).toBe('pandoc');
    expect(dialectOfName('notes.md')).toBe('gfm');
    expect(dialectOfName('notes.markdown')).toBe('gfm');
    expect(dialectOfName('')).toBe('gfm');
  });

  it('holds the dialect for the call only, and nested calls keep it', () => {
    expect(isPandoc()).toBe(false);
    withDialect('pandoc', () => {
      expect(isPandoc()).toBe(true);
      withDialect(undefined, () => expect(isPandoc()).toBe(true));
    });
    expect(isPandoc()).toBe(false);
    expect(() =>
      withDialect('pandoc', () => {
        throw new Error('x');
      }),
    ).toThrow();
    expect(isPandoc()).toBe(false);
  });
});
