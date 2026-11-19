import { describe, expect, it } from 'vitest';
import { partText, readParts } from '../shared/zip.ts';
import { exportDocx } from './build.ts';
import { parseBibtex } from '@redlines/citations';
import { isQuarto, quartoToMarkdown } from './quarto.ts';

const DOC = `---
title: "Quarto @fig-never"
---

# Introduction {#sec-intro}

::: {.callout-note}
## A note

Says something. See @sec-methods.
:::

::: {.callout-important title="Important"}
In the fence.
:::

::: {.columns}
::: {.column width="50%"}
Left.
:::
::: {.column width="50%"}
Right.
:::
:::

# Methods {#sec-methods}

The method is in @sec-intro, then @fig-sketch, @tbl-owners and @eq-mass.

![A sketch](sketch.png){#fig-sketch}

| Milestone | Owner |
|-----------|-------|
| Review    | Ada   |

: Who owns what {#tbl-owners}

$$ E = mc^2 $$ {#eq-mass}

Water is H~2~O, a square is x^2^, and \`code @fig-sketch x^2^\` stays. Not ~~struck~~.

\`\`\`{r}
#| label: fig-plot
x <- c(1, 2)
\`\`\`
`;

describe('a Quarto document for the Word export (#1215)', () => {
  it('knows a Quarto document by its syntax, and leaves any other text alone', () => {
    expect(isQuarto(DOC)).toBe(true);
    expect(isQuarto('# Title\n\nSome **text** with x^2^ and H~2~O.\n')).toBe(false);
    expect(isQuarto('::: {.callout-tip}\nHi\n:::\n')).toBe(true);
  });

  const out = quartoToMarkdown(DOC);

  it('writes a callout as a quote that starts with its title', () => {
    expect(out).toContain('> **A note**\n>\n> Says something. See Section 2.');
    expect(out).toContain('> **Important**\n>\n> In the fence.');
    expect(out).not.toContain(':::');
  });

  it('drops the fences of other divs and keeps their paragraphs apart', () => {
    expect(out).toMatch(/Left\.\n\n+Right\./);
  });

  it('drops attributes, and numbers the targets in the order they are written', () => {
    expect(out).toContain('# Introduction\n');
    expect(out).toContain('![A sketch](sketch.png)\n');
    expect(out).toContain('Table 1: Who owns what');
    expect(out).toContain('The method is in Section 1, then Figure 1, Table 1 and Equation 1.');
    expect(out).not.toMatch(/\{#/);
  });

  it('writes a display formula as its TeX with its number', () => {
    expect(out).toContain('E = mc^2    (1)');
    expect(out).not.toContain('$$');
  });

  it('writes a superscript and a subscript, and leaves strike and code alone', () => {
    expect(out).toContain('H<sub>2</sub>O');
    expect(out).toContain('x<sup>2</sup>,');
    expect(out).toContain('`code @fig-sketch x^2^`');
    expect(out).toContain('~~struck~~');
  });

  it('never touches the front matter, a chunk or the ledger', () => {
    expect(out.startsWith('---\ntitle: "Quarto @fig-never"\n---')).toBe(true);
    const chunk = '```{r}\n# @fig-sketch ::: {#sec-x} $$ x^2^\n```\n';
    expect(quartoToMarkdown(`# H {#sec-h}\n\n${chunk}`)).toBe(`# H\n\n${chunk}`);
    const withLedger = `${DOC}\n<!-- redlines\nversion: 1\ncomments:\n  k3x9:\n    text: |-\n      See @fig-sketch\n-->\n`;
    expect(quartoToMarkdown(withLedger).endsWith('      See @fig-sketch\n-->\n')).toBe(true);
  });

  it('exports with no Quarto syntax in a text of the document, and says so', async () => {
    const report: { kind: string; message: string }[] = [];
    const parts = readParts(await exportDocx(DOC, { report }));
    const xml = partText(parts, 'word/document.xml') ?? '';
    const texts = [...xml.matchAll(/<w:t\b[^>]*>([^<]*)</g)].map((m) => m[1]);
    expect(texts.join('\n').replace('code @fig-sketch x^2^', '')).not.toMatch(
      /:::|\{#|@(?:sec|fig|tbl|eq)-|\$\$|\^2\^/,
    );
    expect(texts).toContain('A note');
    expect(xml).toContain('<w:vertAlign w:val="superscript"/>');
    expect(report.map((r) => r.kind)).toContain('quarto');
    expect(Object.keys(parts)).not.toContain('customXml/redlines-source.xml');
  });
});

describe('citations in the Word export (#1171)', () => {
  const BIB = [
    '@book{knuth1984, author = {Donald E. Knuth}, title = {The TeXbook}, year = {1984}}',
    '@article{lamport1994, author = {Lamport, Leslie}, title = {LaTeX}, year = {1994}}',
  ].join('\n');
  const DOC = [
    '---',
    'title: T',
    'bibliography: refs.bib',
    '---',
    '',
    'As @knuth1984 shows [@lamport1994, p. 4; @knuth1984], and [-@knuth1984] and [@nobody]. `[@knuth1984]`',
    '',
  ].join('\n');
  const files =
    (known: Record<string, string>) =>
    (path: string): Uint8Array | undefined =>
      known[path] === undefined ? undefined : new TextEncoder().encode(known[path]);

  it('writes the bibliography’s print of a citation, as the editor draws it', () => {
    const out = quartoToMarkdown(DOC, {
      bib: parseBibtex(BIB),
      style: 'chicago-author-date',
    });
    expect(out).toContain(
      'As Knuth (1984) shows (Lamport 1994, 4; Knuth 1984), and (1984) and [@nobody]. `[@knuth1984]`',
    );
  });

  it('reads the bibliography and the style beside the document, through the picture reader', async () => {
    const apa = '<style><id>http://www.zotero.org/styles/apa</id><title>APA</title></style>';
    const report: { kind: string; message: string }[] = [];
    const parts = readParts(
      await exportDocx(DOC.replace('refs.bib', 'refs.bib\ncsl: apa.csl'), {
        report,
        images: files({ 'refs.bib': BIB, 'apa.csl': apa }),
      }),
    );
    const xml = partText(parts, 'word/document.xml') ?? '';
    const text = [...xml.matchAll(/<w:t\b[^>]*>([^<]*)</g)].map((m) => m[1]).join('');
    expect(text).toContain('Knuth (1984) shows (Lamport, 1994, p. 4; Knuth, 1984)');
    expect(report.map((r) => r.kind)).not.toContain('bibliography');
  });

  it('writes the citations as typed, and says so, where the bibliography can’t be read', async () => {
    const report: { kind: string; message: string }[] = [];
    const parts = readParts(await exportDocx(DOC, { report, images: files({}) }));
    const xml = partText(parts, 'word/document.xml') ?? '';
    expect(xml).toContain('@knuth1984');
    expect(report.find((r) => r.kind === 'bibliography')?.message).toContain('refs.bib');
  });
});

describe('math in the Word export (#1173)', () => {
  it('writes an inline formula as its TeX in code, with no dollars, and leaves money alone', () => {
    const out = quartoToMarkdown(
      '# T {#sec-t}\n\nMass $m$ and $E = mc^2$, costs $5 and $6, \\$x\\$ and `$c$`.\n',
    );
    expect(out).toContain('Mass `m` and `E = mc^2`, costs $5 and $6, \\$x\\$ and `$c$`.');
  });

  it('writes a display formula as a paragraph of its TeX, numbered', () => {
    const out = quartoToMarkdown(
      '# T {#sec-t}\n\n$$\n\\int_0^1 x\\,dx\n$$ {#eq-int}\n\nSee @eq-int.\n',
    );
    expect(out).toContain('\\int_0^1 x\\,dx    (1)');
    expect(out).toContain('See Equation 1.');
  });
});
