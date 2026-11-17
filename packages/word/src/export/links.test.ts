import { describe, expect, it } from 'vitest';
import { readDocx } from '../import/read.ts';
import { partText, readParts } from '../shared/zip.ts';
import { exportDocx } from './build.ts';

const TEXT = 'See the [Redlines guide](https://example.org/guide) for **more**.\n';

describe('links', () => {
  it('writes a link as a hyperlink to its address with the display text once', async () => {
    const parts = readParts(await exportDocx(TEXT));
    const document = partText(parts, 'word/document.xml') ?? '';
    const rels = partText(parts, 'word/_rels/document.xml.rels') ?? '';
    expect(document.match(/<w:hyperlink /g)).toHaveLength(1);
    expect(document.match(/Redlines guide/g)).toHaveLength(1);
    expect(document).not.toContain('https://example.org/guide');
    expect(rels).toContain('Target="https://example.org/guide"');
    expect(rels).toContain('TargetMode="External"');
  });

  it('reads back as one link with the same text and address', async () => {
    const blocks = JSON.stringify(readDocx(await exportDocx(TEXT)).blocks);
    expect(blocks.match(/Redlines guide/g)).toHaveLength(1);
    expect(blocks).toContain('"href":"https://example.org/guide"');
    expect(blocks.match(/https:\/\/example\.org\/guide/g)).toHaveLength(1);
  });

  it('writes an autolink and a bare address as hyperlinks whose text is the address', async () => {
    const parts = readParts(
      await exportDocx(
        'A <https://example.org/a> b <me@example.org> c https://example.org/b d www.example.org\n',
      ),
    );
    const document = partText(parts, 'word/document.xml') ?? '';
    const rels = partText(parts, 'word/_rels/document.xml.rels') ?? '';
    expect(document.match(/<w:hyperlink /g)).toHaveLength(4);
    for (const shown of ['https://example.org/a', 'me@example.org', 'https://example.org/b']) {
      expect(document.match(new RegExp(`>${shown}<`, 'g'))).toHaveLength(1);
    }
    expect(document).toContain('>www.example.org<');
    expect(rels).toContain('Target="mailto:me@example.org"');
    expect(rels).toContain('Target="http://www.example.org"');
  });

  it('writes the sample when WORD_LINKS_OUT names a file', async () => {
    const out = process.env.WORD_LINKS_OUT;
    if (!out) return;
    const { writeFileSync } = await import('node:fs');
    writeFileSync(
      out,
      await exportDocx(
        `${TEXT}\nAn autolink: <https://example.org/auto> and [a *styled* link](https://example.org/b "Title").\n`,
      ),
    );
  });
});
