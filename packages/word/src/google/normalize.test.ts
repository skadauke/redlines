import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { partText, readParts } from '../shared/zip.ts';
import { isGoogleDocx, normalizeGoogleBytes, normalizeGoogleDocx } from './normalize.ts';

const FIXTURE = new URL('../../fixtures/docs-suggestions-and-comment.docx', import.meta.url);

describe('normalizeGoogleDocx', () => {
  const parts = readParts(new Uint8Array(readFileSync(FIXTURE)));
  const { parts: out, notes } = normalizeGoogleDocx(parts);
  const document = partText(out, 'word/document.xml') ?? '';

  it('knows Docs by its zero rsids', () => {
    expect(isGoogleDocx(parts)).toBe(true);
    expect(notes[0]?.kind).toBe('docs-comments');
  });

  it('drops the empty rPrChange of an insertion, and keeps the suggested bold', () => {
    expect(document).not.toContain('rsid');
    expect(document.match(/<w:rPrChange/g)).toHaveLength(1);
    expect(document).toMatch(/<w:b w:val="1"\/>[\s\S]*<w:rPrChange[^>]*w:id="5"/);
  });

  it('keeps the insertion, the deletion, their authors and dates', () => {
    expect(document).toContain('<w:ins w:author="Ada" w:id="0" w:date="2026-11-17T03:34:10Z">');
    expect(document).toContain('<w:delText xml:space="preserve">extra </w:delText>');
  });

  it('takes the fonts, sizes, rtl, heading bold and empty runs out', () => {
    expect(document).not.toMatch(/w:rtl|w:sz|w:rFonts/);
    expect(document).toContain('zebra-study Suggestions');
    const heading = /<w:p [^>]*>(?:(?!<\/w:p>)[\s\S])*Heading1[\s\S]*?<\/w:p>/.exec(document)?.[0];
    expect(heading).toBeDefined();
    expect(heading).not.toMatch(/<w:b[ C/]/);
    expect(document).not.toMatch(/<w:r><\/w:r>/);
    const comments = partText(out, 'word/comments.xml') ?? '';
    expect(comments).not.toMatch(/Arial|w:sz/);
    expect(comments).toContain('Comment one zebra-study');
  });

  it('does the same from bytes to bytes', () => {
    const bytes = new Uint8Array(readFileSync(FIXTURE));
    const result = normalizeGoogleBytes(bytes);
    expect(result.notes).toHaveLength(1);
    expect(partText(readParts(result.bytes), 'word/document.xml')).not.toContain('rsid');
  });

  it('keeps the empty old properties of a real formatting change', () => {
    expect(document).toMatch(/<w:rPrChange[^>]*w:id="5"[^>]*><w:rPr\/><\/w:rPrChange>/);
  });

  it('does not run on from a self-closing insertion mark', () => {
    const xml =
      '<w:document><w:p w:rsidR="00000000"><w:pPr><w:rPr><w:ins w:id="1" w:author="Ada"/></w:rPr></w:pPr>' +
      '<w:r><w:rPr><w:b/><w:rPrChange w:id="2"><w:rPr/></w:rPrChange></w:rPr><w:t>x</w:t></w:r>' +
      '<w:ins w:id="3"><w:r><w:rPr><w:rPrChange w:id="4"><w:rPr/></w:rPrChange></w:rPr><w:t>y</w:t></w:r></w:ins></w:p></w:document>';
    const out = normalizeGoogleDocx({ 'word/document.xml': new TextEncoder().encode(xml) });
    const text = partText(out.parts, 'word/document.xml') ?? '';
    expect(text).toContain('w:id="2"');
    expect(text).not.toContain('w:id="4"');
  });

  it('leaves a Word file as it is', () => {
    const word = { 'word/document.xml': new TextEncoder().encode('<w:document w:rsidR="00A1"/>') };
    expect(normalizeGoogleDocx(word)).toEqual({ parts: word, notes: [] });
  });
});
