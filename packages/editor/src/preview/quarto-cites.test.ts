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
