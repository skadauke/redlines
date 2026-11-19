// @vitest-environment happy-dom
// Citations as chips (docs/research/quarto.md, Q9): `[@key]`, `[@a; @b, p. 4]` and a narrative
// `@key` are chips with the cited keys in a pandoc file; the kinds Quarto numbers are left to the
// cross-reference chips, and code, front matter and a `.md` file are text.

import { forceParsing } from '@codemirror/language';
import { afterEach, describe, expect, it } from 'vitest';
import { createEditor, type Editor } from '../index.ts';
import { citationsOf } from './quarto-cites.ts';

const author = { handle: 'ada', name: 'Ada Lovelace' };
const open: Editor[] = [];

afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

const DOC = [
  '---',
  'title: "Sepsis audit"',
  'bibliography: refs.bib',
  'note: "[@infront] in front matter"',
  '---',
  '',
  '## Background {#sec-background}',
  '',
  'Early recognition matters [@smith2020; @jones2021, p. 4] and @lee2019 agrees [-@kim2018].',
  '',
  'See @fig-flow and [@fig-flow], mail ada@example.org, or `[@incode]`.',
  '',
  '```{r}',
  '# [@inchunk]',
  '```',
  '',
  '<!--cmt c2bd-->Marked [@marked2020]<!--/c2bd-->',
  '',
].join('\n');

function editorAt(doc: string, cursor: number, dialect: 'gfm' | 'pandoc' = 'pandoc'): Editor {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, { doc, author, dialect });
  forceParsing(editor.view, editor.view.state.doc.length, 10_000);
  editor.view.dispatch({ selection: { anchor: cursor } });
  open.push(editor);
  return editor;
}

const chips = (editor: Editor) =>
  [...editor.view.dom.querySelectorAll('.rl-cite')].map((chip) => chip.textContent);

describe('citations as chips', () => {
  it('reads the citations of a document and leaves the rest as text', () => {
    const { doc } = editorAt(DOC, 0).view.state;
    expect(citationsOf(doc).map((each) => each.text)).toEqual([
      'smith2020; jones2021 p. 4',
      'lee2019',
      'kim2018',
      'marked2020',
    ]);
  });

  it('draws each as a chip, and a key that Quarto numbers is no citation', () => {
    const editor = editorAt(DOC, 0);
    expect(chips(editor)).toEqual([
      'smith2020; jones2021 p. 4',
      'lee2019',
      'kim2018',
      'marked2020',
    ]);
    expect(editor.view.dom.textContent).toContain('ada@example.org');
    expect(editor.view.dom.textContent).toContain('@fig-flow');
  });

  it('leaves links, addresses, math, indented code and changing citations as text', () => {
    const doc = [
      'A [see @smith](http://u.org), https://medium.com/@user/p and <https://x.com/@h>.',
      '',
      '[@a, see @fig-x] and [@smith<!--ins k3x9-->2020]<!--/k3x9-->.',
      '',
      '    indented @code',
      '',
      '$$ a @b $$',
      '',
      'Cited [see @a and @b, p. 2].',
      '',
    ].join('\n');
    const { doc: text } = editorAt(doc, 0).view.state;
    expect(citationsOf(text).map((each) => each.text)).toEqual(['a, b p. 2']);
  });

  it('shows the source while the caret is on the citation', () => {
    const at = DOC.indexOf('@lee2019') + 2;
    const editor = editorAt(DOC, at);
    expect(chips(editor)).not.toContain('lee2019');
    expect(editor.view.dom.textContent).toContain('@lee2019');
  });

  it('draws none in a Markdown file, where the characters are text', () => {
    expect(chips(editorAt(DOC, 0, 'gfm'))).toEqual([]);
  });
});

describe('citations from the bibliography (#1171)', () => {
  const BIB = [
    '@book{knuth1984, author = {Donald E. Knuth}, title = {The TeXbook}, year = {1984}}',
    '@article{lamport1994, author = {Lamport, Leslie}, title = {LaTeX}, year = {1994}}',
  ].join('\n');
  const FRONT = '---\ntitle: T\nbibliography: refs.bib\n---\n\n';

  function withHost(doc: string, files: Record<string, string>): Editor {
    const parent = document.createElement('div');
    document.body.append(parent);
    const editor = createEditor(parent, {
      doc,
      author,
      dialect: 'pandoc',
      includes: { read: (path) => Promise.resolve(files[path] ?? null), open: () => {} },
      citations: () => import('@redlines/citations'),
    });
    forceParsing(editor.view, editor.view.state.doc.length, 10_000);
    editor.view.dispatch({ selection: { anchor: 0 } });
    open.push(editor);
    return editor;
  }

  const settled = async (editor: Editor, want: (text: (string | null)[]) => boolean) => {
    for (let i = 0; i < 100 && !want(chips(editor)); i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
  };

  it('prints a citation as author and year, with a page, and one that is part of the sentence', async () => {
    const editor = withHost(
      `${FRONT}As @knuth1984 shows [@lamport1994, p. 4; @knuth1984], and [-@knuth1984].\n`,
      { 'refs.bib': BIB },
    );
    await settled(editor, (text) => text.includes('Knuth (1984)'));
    expect(chips(editor)).toEqual(['Knuth (1984)', '(Lamport 1994, 4; Knuth 1984)', '(1984)']);
    // The keys are the chip's title; the source shows under the caret.
    expect(editor.view.dom.querySelector('.rl-cite')?.getAttribute('title')).toBe('knuth1984');
  });

  it('keeps the keys without a bibliography, for a key that is not in it, and without a host', async () => {
    const none = withHost(`${FRONT}See [@knuth1984].\n`, {});
    await new Promise((r) => setTimeout(r, 50));
    expect(chips(none)).toEqual(['knuth1984']);
    const missing = withHost(`${FRONT}See [@nobody1999].\n`, { 'refs.bib': BIB });
    await new Promise((r) => setTimeout(r, 50));
    expect(chips(missing)).toEqual(['nobody1999']);
    expect(chips(editorAt(`${FRONT}See [@knuth1984].\n`, 0))).toEqual(['knuth1984']);
  });

  it('takes the style from the csl file the front matter names', async () => {
    const apa = '<style><id>http://www.zotero.org/styles/apa</id><title>APA</title></style>';
    const editor = withHost(
      '---\nbibliography: refs.bib\ncsl: apa.csl\n---\n\nSee [@knuth1984].\n',
      { 'refs.bib': BIB, 'apa.csl': apa },
    );
    await settled(editor, (text) => text.includes('(Knuth, 1984)'));
    expect(chips(editor)).toEqual(['(Knuth, 1984)']);
  });
});
