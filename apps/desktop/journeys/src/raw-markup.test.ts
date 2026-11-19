import { describe, expect, it } from 'vitest';
import { codeOf, judge, scanLines, type Found, type KnownCase } from './raw-markup.ts';

const rules = (lines: string[], code: string[] = []) =>
  scanLines(lines, code).map((hit) => [hit.rule, hit.text]);

describe('the raw-markup scan', () => {
  it('sees the build 21 cases: the callout’s marker, {#sec-…} and the literal \\n', () => {
    expect(rules(['A <!--ins zjh9-->useful <!--/zjh9-->tip'])).toEqual([['marker', '<!--ins']]);
    expect(rules(['Introduction {#sec-intro}'])).toEqual([['attributes', '{#sec-intro}']]);
    expect(rules(['Footnotes\\n- Tags in the sidebar'])).toEqual([['literal-newline', '\\n']]);
  });

  it('sees unrendered bold, math, subscripts, references and fences', () => {
    expect(rules(['a **bold** word'])).toEqual([['bold', '**bold**']]);
    expect(rules(['$$ E = mc^2 $$'])).toEqual([['math', '$$']]);
    expect(rules(['the area $x^2$ here'])).toEqual([['math', '$x^2$']]);
    expect(rules(['water as H~2~O'])).toEqual([['sub-sup-strike', '~2~']]);
    expect(rules(['struck ~~out~~'])).toEqual([['sub-sup-strike', '~~out~~']]);
    expect(rules(['see @fig-sketch'])).toEqual([['reference', '@fig-sketch']]);
    expect(rules(['::: {.callout-note}'])).toEqual([
      ['attributes', '{.callout-note}'],
      ['fence', ':::'],
    ]);
  });

  it('leaves alone what is not raw: prices, an author’s own comment, ordinary braces', () => {
    expect(rules(['It costs $5 and $6 more.'])).toEqual([]);
    expect(rules(['<!-- A note that only the author sees. -->'])).toEqual([]);
    expect(rules(['a {curly} word, an e-mail ada@sec.example'])).toEqual([]);
    expect(rules(['2 ** 3 is not bold when it has spaces'])).toEqual([]);
  });

  it('allows what the document itself holds as code', () => {
    const source = 'Text.\n\n```\n<!--ins k3x9-->\\n\n```\n\nAnd `$$x$$` inline.\n';
    expect(codeOf(source)).toContain('<!--ins k3x9-->\\n');
    expect(rules(['<!--ins k3x9-->\\n', '$$x$$'], codeOf(source))).toEqual([]);
    expect(rules(['<!--ins k3x9-->\\n'])).toEqual([
      ['marker', '<!--ins'],
      ['literal-newline', '\\n'],
    ]);
  });
});

describe('judging what the scan found against the known cases', () => {
  const known: KnownCase[] = [
    {
      issue: 1,
      doc: 'a.qmd',
      surfaces: ['redlines'],
      rule: 'attributes',
      text: /\{#sec-/,
      why: 'a heading’s attributes',
    },
  ];
  const found = (doc: string, text: string): Found => ({
    doc,
    surface: 'redlines',
    hit: { rule: 'attributes', text, line: text },
  });

  it('passes a known case', () => {
    expect(judge([found('a.qmd', '{#sec-x}')], ['redlines'], ['a.qmd'], known)).toEqual({
      unknown: [],
      gone: [],
    });
  });

  it('fails on a case nobody knows, wherever it comes back', () => {
    const result = judge(
      [found('b.qmd', '{#sec-x}'), found('a.qmd', '{#fig-x}')],
      ['redlines'],
      ['a.qmd', 'b.qmd'],
      known,
    );
    expect(result.unknown).toHaveLength(2);
    expect(result.gone[0]).toContain('#1 no longer shows');
  });

  it('says to delete a known case that no longer shows', () => {
    const result = judge([], ['redlines'], ['a.qmd'], known);
    expect(result.gone).toEqual([expect.stringContaining('delete its entry from KNOWN')]);
  });

  it('judges a known case only on the surfaces that were run', () => {
    expect(judge([], ['word'], ['a.qmd'], known).gone).toEqual([]);
  });
});
