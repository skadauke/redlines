// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { htmlToMarkdown } from './paste-html.ts';

describe('Google Docs clipboard (a real capture, fixtures/docs-clipboard.html)', () => {
  const md = htmlToMarkdown(
    readFileSync('packages/editor/src/clipboard/fixtures/docs-clipboard.html', 'utf8'),
  );

  it('does not read the wrapping <b style="font-weight:normal"> as bold', () => {
    expect(md).toContain('Plain paragraph with **bold**, *italic*, strike,');
    expect(md).not.toMatch(/\*\*The end\.\*\*/);
  });
  it('makes an indented paragraph a blockquote', () => {
    expect(md).toContain('> A quoted zebra-study line with a second line');
  });
  it('makes the colored runs of a code block one fenced block', () => {
    expect(md).toContain(
      '```\nexport function zebra(x: number): number {\n  return x * 2;\n}\n```',
    );
    expect(md).not.toContain('`export function`');
  });
  it('keeps the alignment set on the paragraphs of a table', () => {
    expect(md).toContain('| Left | Center | Right |\n| --- | :---: | ---: |');
  });
  it('nests a list that Docs puts directly in a list', () => {
    expect(md).toContain('- Bullet one\n  - Nested bullet\n    - Third level\n- Bullet two');
    expect(md).toContain('2. Second\n   1. Nested number\n3. Third');
  });
  it('leaves no Docs trace', () => {
    expect(md).not.toMatch(/docs-internal-guid|font-weight|<span|<b/);
  });
});

describe('Docs: more forms', () => {
  it('joins indented paragraphs into one quote', () => {
    const p = (t: string) => `<p style="margin-left:36pt;margin-right:36pt"><span>${t}</span></p>`;
    expect(
      htmlToMarkdown(
        `<b style="font-weight:normal" id="docs-internal-guid-1">${p('One')}${p('Two')}</b>`,
      ),
    ).toBe('> One\n>\n> Two');
  });
  it('fences a code block that has backticks in it', () => {
    const line = (t: string) =>
      `<p><span style="font-family:'Roboto Mono',monospace;color:#1967d2">${t}</span></p>`;
    expect(htmlToMarkdown(line('a ```') + line('b'))).toBe('````\na ```\nb\n````');
  });
  it('fences a single monospace paragraph', () => {
    expect(
      htmlToMarkdown('<p><span style="font-family:\'Courier New\',monospace">ls -la</span></p>'),
    ).toBe('```\nls -la\n```');
  });
  it('keeps a blank line and a <br> inside one code block', () => {
    const m = (t: string) => `<span style="font-family:'Roboto Mono',monospace">${t}</span>`;
    expect(
      htmlToMarkdown(`<p>${m('a')}</p><p>${m('<br>')}</p><p>${m('b<br>c')}</p><p>${m('<br>')}</p>`),
    ).toBe('```\na\n\nb\nc\n```');
  });
  it('does not read a hanging indent, a list paragraph or a quoted paragraph as a quote', () => {
    expect(htmlToMarkdown('<p style="margin-left:36pt;text-indent:-36pt">Smith 1999</p>')).toBe(
      'Smith 1999',
    );
    expect(htmlToMarkdown('<ul><li><p style="margin-left:36pt">hi</p></li></ul>')).toBe('- hi');
  });
  it('keeps one monospace run in a sentence as inline code', () => {
    expect(
      htmlToMarkdown(
        '<p>Run <span style="font-family:\'Courier New\',monospace">ls</span> now</p>',
      ),
    ).toBe('Run `ls` now');
  });
});

// These Word forms are written by hand from Word's documented HTML (mso-* styles, MsoNormal and
// MsoListParagraph classes, conditional comments), not captured from Word. Replace them with real
// captures when the study lane has Word access.
describe('Word clipboard (hand-written from the documented forms)', () => {
  const wrap = (body: string) =>
    `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">
<head><meta charset=utf-8><!--[if gte mso 9]><xml><o:OfficeDocumentSettings><o:AllowPNG/></o:OfficeDocumentSettings></xml><![endif]-->
<style><!-- p.MsoNormal {margin:0in;mso-pagination:widow-orphan} --></style></head>
<body lang=EN-US style='tab-interval:.5in'><!--StartFragment-->${body}<!--EndFragment--></body></html>`;

  it('reads MsoNormal paragraphs, mso styles and o:p', () => {
    const md = htmlToMarkdown(
      wrap(
        `<p class=MsoNormal style='mso-margin-top-alt:auto'>Hello <b style='mso-bidi-font-weight:normal'>bold</b> and <i>italic</i><o:p></o:p></p>
<p class=MsoNormal><o:p>&nbsp;</o:p></p>
<p class=MsoNormal>Second<o:p></o:p></p>`,
      ),
    );
    expect(md).toBe('Hello **bold** and *italic*\n\nSecond');
  });

  it('drops conditional comments and their XML', () => {
    const md = htmlToMarkdown(
      wrap(
        `<!--[if gte mso 9]><xml><w:WordDocument><w:View>Normal</w:View></w:WordDocument></xml><![endif]--><p class=MsoNormal>Text<![if !supportLineBreakNewLine]><br style='mso-ignore:vglayout'><![endif]></p>`,
      ),
    );
    expect(md).toBe('Text');
  });

  it('reads MsoListParagraph lists, with nesting', () => {
    const li = (cls: string, level: number, mark: string, text: string) =>
      `<p class=${cls} style='text-indent:-.25in;mso-list:l0 level${level} lfo1'><![if !supportLists]><span style='font-family:Symbol'><span style='mso-list:Ignore'>${mark}<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span></span></span><![endif]>${text}<o:p></o:p></p>`;
    const md = htmlToMarkdown(
      wrap(
        li('MsoListParagraphCxSpFirst', 1, '·', 'One') +
          li('MsoListParagraphCxSpMiddle', 2, 'o', 'Child') +
          li('MsoListParagraphCxSpLast', 1, '·', 'Two'),
      ),
    );
    expect(md).toBe('- One\n  - Child\n- Two');
  });

  it('reads a numbered Word list', () => {
    const li = (n: number, t: string) =>
      `<p class=MsoListParagraph style='text-indent:-.25in;mso-list:l1 level1 lfo2'><![if !supportLists]><span style='mso-list:Ignore'>${n}.<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;</span></span><![endif]>${t}</p>`;
    expect(htmlToMarkdown(wrap(li(1, 'A') + li(2, 'B')))).toBe('1. A\n2. B');
  });

  it('reads headings, the quote style and a table with alignment', () => {
    const md = htmlToMarkdown(
      wrap(
        `<h1><span style='mso-bookmark:_Toc1'>Title</span></h1>
<p class=MsoQuote>Quoted</p>
<table class=MsoTableGrid border=1 cellspacing=0><tr><td width=100 style='border:solid windowtext 1.0pt'><p class=MsoNormal><b>H1</b><o:p></o:p></p></td><td><p class=MsoNormal align=right style='text-align:right'><b>H2</b></p></td></tr>
<tr><td><p class=MsoNormal>a</p></td><td><p class=MsoNormal style='text-align:right'>1</p></td></tr></table>`,
      ),
    );
    expect(md).toBe('# Title\n\n> Quoted\n\n| H1 | H2 |\n| --- | ---: |\n| a | 1 |');
  });

  it('makes consecutive Consolas paragraphs one fenced block', () => {
    const line = (t: string) =>
      `<p class=MsoNormal style='mso-layout-grid-align:none'><span style='font-size:10.0pt;font-family:Consolas'>${t}</span></p>`;
    expect(htmlToMarkdown(wrap(line('let a = 1;') + line('let b = 2;')))).toBe(
      '```\nlet a = 1;\nlet b = 2;\n```',
    );
  });
});
