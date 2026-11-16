import { describe, expect, it } from 'vitest';
import {
  DOCUMENT_EXTENSIONS,
  documentKind,
  isDocument,
  markdownDialect,
  PLAIN_ONLY_EXTENSIONS,
} from './file-names.ts';

describe('documentKind', () => {
  it('is Markdown for Markdown and its R Markdown and Quarto dialects, in any case', () => {
    for (const name of ['a.md', 'a.markdown', 'b.qmd', '/x/c.RMD', 'D.MD']) {
      expect(documentKind(name), name).toBe('markdown');
    }
  });

  it('is Plain-only for text and code, and .txt has moved there', () => {
    for (const name of ['notes.txt', 'a.ts', 'b.py', 'c.JSON', 'd.log', '/x/y/z.sh']) {
      expect(documentKind(name), name).toBe('plain-only');
    }
  });

  it('goes by the last extension only, and not at all for other files', () => {
    expect(documentKind('plan.md.txt')).toBe('plain-only');
    expect(documentKind('plan.txt.md')).toBe('markdown');
    for (const name of ['pic.png', 'doc.pdf', 'Makefile', '.gitignore', '.txt', 'a.']) {
      expect(documentKind(name), name).toBeNull();
      expect(isDocument(name)).toBe(false);
    }
  });

  it('names the dialect of Markdown by extension, for what differs in how it is written', () => {
    expect(markdownDialect('a.md')).toBe('gfm');
    expect(markdownDialect('a.markdown')).toBe('gfm');
    expect(markdownDialect('a.qmd')).toBe('pandoc');
    expect(markdownDialect('a.Rmd')).toBe('pandoc');
    expect(markdownDialect('a.txt')).toBeNull();
  });

  it('lists every extension once', () => {
    expect(new Set(DOCUMENT_EXTENSIONS).size).toBe(DOCUMENT_EXTENSIONS.length);
    expect(Object.keys(PLAIN_ONLY_EXTENSIONS)).toEqual(['text', 'data', 'web', 'code']);
  });
});
