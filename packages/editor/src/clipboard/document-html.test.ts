// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { documentHtml, documentText } from './document-html.ts';

const LEDGER = [
  '<!-- redlines',
  'version: 1',
  'people:',
  '  ada: {name: Ada Lovelace, email: ada@example.org}',
  '  bo: {name: Bo Chen, email: bo@example.org}',
  'marks:',
  '  k3x9: {by: ada, at: 2026-10-13T22:30Z}',
  '  p7qd: {by: ada, at: 2026-10-13T22:31Z}',
  '  w2rf: {by: bo, at: 2026-10-13T22:35Z}',
  'comments:',
  '  c8d2:',
  '    by: bo',
  '    at: 2026-10-13T22:40Z',
  '    text: |-',
  '      Who signs off on the security review?',
  '-->',
].join('\n');

const marked = [
  '# Launch plan',
  '',
  'We will ship the <!--ins k3x9-->new <!--/k3x9-->importer in <!--sub p7qd March-->April<!--/p7qd-->, after the <!--cmt c8d2-->security review<!--/c8d2-->.<!--del w2rf  The old exporter stays as it is.-->',
  '',
  LEDGER,
  '',
].join('\n');

describe('documentHtml', () => {
  it('draws the text as it reads now: insertions plain, deletions gone, no marks or comments', () => {
    const html = documentHtml(marked);
    expect(html).toContain('<h1');
    expect(html).toContain('We will ship the new importer in April, after the security review.');
    expect(html).not.toContain('exporter');
    expect(html).not.toMatch(/<!--|version: 1|c8d2|k3x9|Who signs off|Bo Chen|ada@example/);
  });

  it('draws the Original as it was: insertions gone, deletions and replaced text back', () => {
    const html = documentHtml(marked, 'original');
    expect(html).toContain('We will ship the importer in March, after the security review.');
    expect(html).toContain('The old exporter stays as it is.');
    expect(html).not.toMatch(/<!--|version: 1|c8d2|Who signs off/);
  });

  it('leaves out YAML front matter', () => {
    const html = documentHtml('---\ntitle: Secret\ntags: [a]\n---\n\n# Hello\n');
    expect(html).toContain('Hello');
    expect(html).not.toMatch(/Secret|title:/);
    expect(documentText('---\na: 1\n---\nText\n')).toBe('\nText\n');
  });

  it('leaves out an ordinary comment block', () => {
    const html = documentHtml('One\n\n<!-- a note to self -->\n\nTwo\n');
    expect(html).not.toContain('note to self');
    expect(html).toContain('Two');
  });

  it('draws tables, code, task items, footnotes and alerts', () => {
    const html = documentHtml(
      [
        '| a | b |',
        '| - | - |',
        '| 1 | 2 |',
        '',
        '```js',
        'const x = 1;',
        '```',
        '',
        '- [x] done',
        '- [ ] todo',
        '',
        'A claim[^1].',
        '',
        '[^1]: The source of it.',
        '',
        '> [!NOTE] Mind this',
        '',
      ].join('\n'),
    );
    expect(html).toContain('<table>');
    expect(html).toContain('<pre');
    expect(html).toContain('<li class="rl-task">☑ done</li>');
    expect(html).toContain('A claim<sup>1</sup>.');
    expect(html).toContain('<p class="rl-footnote"><sup>1</sup> The source of it.</p>');
    expect(html).toContain('rl-callout-note');
    expect(html).toContain('Mind this');
    expect(html).not.toContain('[!NOTE]');
  });

  it('draws emoji and the images the host resolves, and the alt text of the rest', () => {
    const html = documentHtml(
      '![Chart](pics/a%20b.png) ![Gone](missing.png) ![Web](https://example.org/x.png) :tent:',
      'clean',
      {
        emoji: (name) => (name === 'tent' ? '⛺' : undefined),
        resolveImage: (path) => (path === 'pics/a b.png' ? 'asset://a.png' : null),
      },
    );
    expect(html).toContain('<img src="asset://a.png" alt="Chart">');
    expect(html).toContain('https://example.org/x.png');
    expect(html).toContain('Gone');
    expect(html).not.toContain('missing.png');
    expect(html).toContain('⛺');
  });

  it('draws an HTML block sanitized, never live', () => {
    const html = documentHtml('<p align="center">Hi <script>alert(1)</script><b>there</b></p>\n');
    expect(html).toContain('class="rl-html"');
    expect(html).toContain('<b>there</b>');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onclick');
  });

  it('keeps an image inside an HTML block, as the host resolves it', () => {
    const html = documentHtml(
      '<p align="center"><img src="a.png" alt="Pic" width="120"></p>\n',
      'clean',
      {
        resolveImage: (path) => `asset://${path}`,
      },
    );
    expect(html).toContain('<img src="asset://a.png" alt="Pic" width="120">');
  });

  it('keeps a link as a link and its words as its text', () => {
    expect(documentHtml('See [the docs](https://example.org/d).')).toContain(
      '<a href="https://example.org/d">the docs</a>',
    );
  });
});

describe('documentHtml for Word and Google Docs (office)', () => {
  const md = [
    '~~gone~~ `code` text',
    '',
    '> quoted',
    '',
    '| A | B |',
    '| :- | -: |',
    '| 1 | 2 |',
    '',
    '```ts',
    'let x = 1;',
    '```',
    '',
    '![pic](data:image/png;base64,AAAA)',
    '',
  ].join('\n');

  it('writes <s>, a code color, bordered cells with widths, a quote that reads without its rule', () => {
    const html = documentHtml(md, 'clean', { office: true });
    expect(html).toContain('<s>gone</s>');
    expect(html).not.toContain('<del>');
    expect(html).toMatch(/<code style="[^"]*background:#f2f2f2;color:#24292f/);
    expect(html).toMatch(/<td style="[^"]*border:1px solid[^"]*width:50%[^"]*text-align:left"/);
    expect(html).toMatch(/<th style="[^"]*border:1px solid/);
    expect(html).toMatch(/<blockquote style="margin:0 0 0 1\.5em;padding:0 0 0 1em/);
    expect(html).toContain('<code class="language-ts">');
    expect(html).toContain('src="data:image/png;base64,AAAA"');
  });

  it('leaves print and the page as they were', () => {
    const html = documentHtml(md);
    expect(html).toContain('<del>gone</del>');
    expect(html).toContain('<blockquote>');
    expect(html).not.toContain('border:1px');
  });

  it('embeds an image through the host and shows held ones as alt text', () => {
    const embed = (u: string) => (u.startsWith('https:') ? 'data:image/png;base64,ZZ' : null);
    const remote = '![r](https://example.org/a.png) ![h](https://example.org/h.png)';
    const html = documentHtml(remote, 'clean', {
      office: true,
      embedImage: embed,
      altOnly: (h) => h.endsWith('h.png'),
    });
    expect(html).toContain('<img src="data:image/png;base64,ZZ" alt="r">');
    expect(html).not.toContain('h.png');
  });
});

describe('documentHtml of a selection (clip)', () => {
  it('keeps a selection that starts with a rule, and leaves alerts as text', () => {
    const html = documentHtml('---\nsome words\n---\n\n> [!NOTE]\n> hi', 'clean', {
      office: true,
      clip: true,
    });
    expect(html).toContain('<hr>');
    expect(html).toContain('some words');
    expect(html).not.toContain('rl-callout');
  });

  it('draws a task item as its box with no bullet, a paragraph that no list draws a bullet for', () => {
    const html = documentHtml('- [x] done\n- [ ] open', 'clean', { office: true, clip: true });
    expect(html).not.toContain('<li');
    expect(html).toContain('<p style="margin:0 0 0 0.5in">☑ done</p>');
    expect(html).toContain('☐ open');
  });
    expect(html).toContain('<li style="list-style-type:none">☑ done</li>');
    expect(html).toContain('☐ open');
  });
});

describe('picture sizes for Word and Docs', () => {
  const png = (width: number, height: number) => {
    const bytes = Buffer.alloc(24);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
    bytes.writeUInt32BE(13, 8);
    bytes.write('IHDR', 12);
    bytes.writeUInt32BE(width, 16);
    bytes.writeUInt32BE(height, 20);
    return `data:image/png;base64,${bytes.toString('base64')}`;
  };

  it('gives a picture its natural size, kept inside the column with its aspect', () => {
    const small = documentHtml(`![a](${png(16, 8)})`, 'clean', { office: true });
    expect(small).toContain('width="16" height="8"');
    const wide = documentHtml(`![a](${png(1248, 624)})`, 'clean', { office: true });
    expect(wide).toContain('width="624" height="312"');
  });

  it('takes the width set in the document, with the aspect of the file', () => {
    const html = documentHtml(`<img src="${png(400, 200)}" alt="a" width="100">`, 'clean', {
      office: true,
    });
    expect(html).toContain('width="100" height="50"');
  });

  it('leaves print as it was', () => {
    expect(documentHtml(`![a](${png(16, 8)})`)).not.toContain('height=');
  });
});

describe('JPEG sizes', () => {
  const jpeg = (exif: number[]) => {
    const sof = [0xff, 0xc0, 0, 17, 8, 0, 50, 0, 100, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
    return `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xff, ...exif, ...sof, 0, 0, 0]).toString('base64')}`;
  };

  it('reads a size past a fill byte', () => {
    expect(documentHtml(`![a](${jpeg([])})`, 'clean', { office: true })).toContain(
      'width="100" height="50"',
    );
  });

  it('gives only the width to a picture that EXIF turns', () => {
    // APP1, length 28, "Exif\0\0", little-endian TIFF, IFD at 8, one entry: orientation 6.
    const exif = [
      0xff, 0xe1, 0, 28, 0x45, 0x78, 0x69, 0x66, 0, 0, 0x49, 0x49, 42, 0, 8, 0, 0, 0, 1, 0, 0x12, 1,
      3, 0, 1, 0, 0, 0, 6, 0, 0, 0,
    ];
    const html = documentHtml(`![a](${jpeg(exif)})`, 'clean', { office: true });
    expect(html).not.toContain('height=');
  });
});

describe('a copy for Word (#1181)', () => {
  const office = (md: string) => documentHtml(md, 'clean', { office: true, clip: true });

  it('is in Arial, like the export, and keeps a face the theme chose', () => {
    expect(office('Some text')).toMatch(/^<div data-redlines style="font-family:Arial,/);
    const georgia = documentHtml('Some text', 'clean', {
      office: true,
      clip: true,
      fonts: { body: 'Georgia, Gelasio, serif', heading: 'Georgia, Gelasio, serif', mono: 'mono' },
    });
    expect(georgia).toContain('font-family:Georgia, Gelasio, serif');
    expect(georgia).not.toContain('Arial');
    // The page and the other targets still have Calibri.
    expect(documentHtml('Some text', 'clean', { clip: true })).toContain('Calibri');
  });

  it('keeps a checklist item apart from the bullet list above it', () => {
    const html = office('- First item\n  - Nested item\n- [ ] A checklist item\n- [x] Done\n- Last\n');
    // Two bullet lists, and the checklist between them is no item of either.
    expect(html).toMatch(
      /<ul><li>First item<ul><li>Nested item<\/li><\/ul><\/li><\/ul><div data-rl-tasks><p[^>]*>☐ A checklist item<\/p><p[^>]*>☑ Done<\/p><\/div><ul><li>Last<\/li><\/ul>/,
    );
  });

  it('has a table at the text width of a new document, 6.5 in', () => {
    const html = office('| a | b |\n| - | - |\n| 1 | 2 |\n');
    expect(html).toMatch(/<table width="624" style="[^"]*width:6\.5in/);
    expect(documentHtml('| a |\n| - |\n| 1 |\n')).not.toContain('6.5in');
  });

  it('shades a code block gray', () => {
    const html = office('```js\nlet a = 1;\n```\n');
    expect(html).toMatch(/<pre style="[^"]*background:#f2f2f2;mso-shading:#f2f2f2/);
  });

  it('gives each paragraph of a quote the Word "Quote" style', () => {
    const html = office('> One\n>\n> Two\n');
    expect(html).toContain('<p class="MsoQuote" style="mso-style-name:Quote">One</p>');
    expect(html).toContain('<p class="MsoQuote" style="mso-style-name:Quote">Two</p>');
    expect(html).toContain('<blockquote');
    expect(documentHtml('> One\n')).not.toContain('MsoQuote');
  });
});
