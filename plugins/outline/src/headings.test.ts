// @vitest-environment happy-dom
// The headings of a document, as the outline lists them (design §5.12): from the syntax tree, as the
// text reads with every pending change accepted, without Markdown's marks.

import { forceParsing } from '@codemirror/language';
import { createEditor, type Editor } from '@redlines/editor';
import { afterEach, describe, expect, it } from 'vitest';
import { headingsOf, type Heading } from './headings.ts';

const open: Editor[] = [];
afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

function headings(doc: string): Heading[] {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, { doc, author: { handle: 'ada', name: 'Ada Lovelace' } });
  forceParsing(editor.view, editor.view.state.doc.length, 10_000);
  open.push(editor);
  return headingsOf(editor.view.state);
}

const brief = (found: Heading[]) => found.map(({ level, text }) => [level, text]);

describe('the headings of a document', () => {
  it('lists each ATX heading with its level, closing marks and spaces left out', () => {
    expect(
      brief(
        headings('# One\n\n## Two ##  \n\n### Three\n\n#### Four\n\n##### Five\n\n###### Six\n'),
      ),
    ).toEqual([
      [1, 'One'],
      [2, 'Two'],
      [3, 'Three'],
      [4, 'Four'],
      [5, 'Five'],
      [6, 'Six'],
    ]);
  });

  it('lists a Setext heading, whose text may run over lines', () => {
    expect(brief(headings('A title\n=======\n\nA long\nsection name\n------\n\nPlain.\n'))).toEqual(
      [
        [1, 'A title'],
        [2, 'A long section name'],
      ],
    );
  });

  it('lists the headings of quotes and list items, and no heading that only looks like one', () => {
    const doc = [
      '> ### In a quote',
      '',
      '- ## In a list',
      '',
      '#hashtag',
      '',
      '```md',
      '# In code',
      '```',
      '',
      '    # Indented code',
      '',
      '#',
      '',
      '# Real',
      '',
    ].join('\n');
    expect(brief(headings(doc))).toEqual([
      [3, 'In a quote'],
      [2, 'In a list'],
      [1, 'Real'],
    ]);
  });

  it('keeps out of front matter and the ledger', () => {
    const doc =
      '---\ntitle: A # not a heading\n---\n\n# Real\n\n<!-- redlines\nversion: 1\n# not a heading either\n-->\n';
    expect(brief(headings(doc))).toEqual([[1, 'Real']]);
  });

  it('reads the text as it is with every pending change accepted', () => {
    const doc = [
      '# A <!--ins k3x9-->new <!--/k3x9-->head<!--del w2rf  old-->ing',
      '',
      '## <!--sub p7qd Old name-->New name<!--/p7qd-->',
      '',
      '## <!--cmt c8d2-->Commented<!--/c8d2--> heading',
      '',
    ].join('\n');
    expect(brief(headings(doc))).toEqual([
      [1, 'A new heading'],
      [2, 'New name'],
      [2, 'Commented heading'],
    ]);
  });

  it('leaves out the marks of emphasis, code, links and images, and reads escapes and entities', () => {
    const doc =
      '# **Bold** and *em* and ~~gone~~ and `code` and [a link](https://x.org) and ![an image](a.png) &amp; \\* done\n';
    expect(brief(headings(doc))).toEqual([
      [1, 'Bold and em and gone and code and a link and an image & * done'],
    ]);
    expect(brief(headings('# See [the guide][g]\n\n[g]: https://x.org\n'))).toEqual([
      [1, 'See the guide'],
    ]);
    // What is no emphasis keeps its characters: intraword underscores, and asterisks with spaces.
    expect(brief(headings('# snake_case_name and 2 * 3 * 4\n'))).toEqual([
      [1, 'snake_case_name and 2 * 3 * 4'],
    ]);
  });

  it('keeps the brackets of a phrase that is no link, as the page draws them', () => {
    // No destination and no label: the preview leaves such a phrase as text.
    expect(
      brief(
        headings(
          '# [WIP] Feature\n\n## [x] Done\n\n## Title[^1]\n\n## A [link](https://x.org) b\n',
        ),
      ),
    ).toEqual([
      [1, '[WIP] Feature'],
      [2, '[x] Done'],
      [2, 'Title[^1]'],
      [2, 'A link b'],
    ]);
  });

  it('leaves out a link’s title and the tags of inline HTML, and keeps the text between them', () => {
    expect(
      brief(
        headings(
          '# See [the docs](https://x.org "Docs") now\n\n## <a id="install"></a>Install <kbd>⌘</kbd>K\n',
        ),
      ),
    ).toEqual([
      [1, 'See the docs now'],
      [2, 'Install ⌘K'],
    ]);
  });

  it('leaves a comment in a code span alone, which is code and no mark', () => {
    expect(brief(headings('# The `<!-- x -->` syntax\n\n## Two\n'))).toEqual([
      [1, 'The <!-- x --> syntax'],
      [2, 'Two'],
    ]);
  });

  it('leaves out the quote marks of a heading that runs over lines of a quote', () => {
    expect(brief(headings('> First line\n> second line\n> ---\n\n# Two\n'))).toEqual([
      [2, 'First line second line'],
      [1, 'Two'],
    ]);
  });

  it('leaves out the attributes that Quarto and Pandoc put after a heading', () => {
    expect(
      brief(
        headings(
          '# Methods {#sec-methods .unnumbered}\n\n## Results {#sec-results}\n\n## Braces {not attributes} here\n',
        ),
      ),
    ).toEqual([
      [1, 'Methods'],
      [2, 'Results'],
      [2, 'Braces {not attributes} here'],
    ]);
  });

  it('puts each at the start of its line, for the caret and the scroll', () => {
    const doc = 'Intro.\n\n## Second\n\nSetext\n======\n';
    expect(headings(doc).map(({ from }) => from)).toEqual([8, 19]);
  });

  it('says nothing of a document with no headings, and skips a heading with no text', () => {
    expect(headings('Just text.\n')).toEqual([]);
    expect(headings('#\n\n## \n')).toEqual([]);
  });
});
