import { describe, expect, it } from 'vitest';
import { partText, readParts } from '../shared/zip.ts';
import { exportDocx } from './build.ts';

async function documentOf(text: string): Promise<string> {
  const parts = readParts(await exportDocx(text, { carriers: false }));
  return partText(parts, 'word/document.xml') ?? '';
}

const paragraphs = (document: string) =>
  [...document.matchAll(/<w:p>.*?<\/w:p>/gs)].map((m) => m[0]);
const spacingOf = (p: string) => /<w:spacing ([^>]*)\/>/.exec(p)?.[1] ?? '';

const TEXT = `A table, a quote and code.

| Left | Right |
| --- | --- |
| a | b |

> A quote

\`\`\`js
const a = 1;
const b = 2;
\`\`\`

Done.
`;

describe('the space between blocks (#1179)', () => {
  it('opens the block after a table', async () => {
    const document = await documentOf(TEXT);
    const after = paragraphs(document.slice(document.indexOf('</w:tbl>')))[0] as string;
    expect(after).toContain('A quote');
    expect(spacingOf(after)).toMatch(/w:before="120"/);
  });

  it('keeps the lines of a code block together and spaces its last line from what follows', async () => {
    const document = await documentOf(TEXT);
    const lines = paragraphs(document).filter((p) => /const [ab] = /.test(p));
    expect(lines).toHaveLength(2);
    expect(spacingOf(lines[0] as string)).toMatch(/w:after="0"/);
    expect(spacingOf(lines[1] as string)).toMatch(/w:after="120"/);
    for (const line of lines) expect(line).toContain('<w:shd ');
  });

  it('spaces a table that follows a code block', async () => {
    const document = await documentOf('```\nx\n```\n\n| A |\n| --- |\n| b |\n');
    const code = paragraphs(document).find((p) => p.includes('>x<')) as string;
    expect(spacingOf(code)).toMatch(/w:after="120"/);
  });
});

describe('two code blocks side by side (#1179)', () => {
  it('are two blocks with a gap between them', async () => {
    const document = await documentOf('```\none\ntwo\n```\n\n```\nthree\n```\n');
    const by = (word: string) =>
      paragraphs(document).find((p) => p.includes(`>${word}<`)) as string;
    expect(spacingOf(by('one'))).toMatch(/w:after="0"/);
    expect(spacingOf(by('two'))).toMatch(/w:after="120"/);
    expect(spacingOf(by('three'))).toMatch(/w:after="120"/);
  });
});

describe('inline code (#1179)', () => {
  it('has a light gray shading on its run, and the text around it has none', async () => {
    const document = await documentOf('Some `inline code` here.\n');
    const runs = [...document.matchAll(/<w:r>.*?<\/w:r>/gs)].map((m) => m[0]);
    const code = runs.find((r) => r.includes('inline code')) as string;
    const shd = /<w:shd ([^>]*)\/>/.exec(code)?.[1] ?? '';
    expect(shd).toContain('w:fill="F2F2F2"');
    expect(shd).toContain('w:val="clear"');
    expect(code).toContain('Courier New');
    for (const r of runs.filter((r) => !r.includes('inline code'))) {
      expect(r).not.toContain('<w:shd ');
    }
  });
});
