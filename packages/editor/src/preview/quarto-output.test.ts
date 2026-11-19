// @vitest-environment happy-dom
// The outputs that come with a Quarto file, under the chunks that made them (docs/research/quarto.md):
// read from the freeze file, the `keep-md` file or the `keep-ipynb` notebook, paired with the chunks
// in order and by code, labeled as from the last run, stale when the chunk's code is not the code its cell ran, and nothing where
// there is no file or no match.

import { Text } from '@codemirror/state';
import { forceParsing } from '@codemirror/language';
import { afterEach, describe, expect, it } from 'vitest';
import type { IncludeHost } from '../api.ts';
import { createEditor, type Editor } from '../index.ts';
import {
  cellsOfMarkdown,
  cellsOfNotebook,
  executableChunks,
  findOutputs,
  matchCells,
  normalCode,
  outputFiles,
  parseFrozen,
  withFigures,
} from './quarto-output.ts';

const FENCE = '```';

/** The markdown of an executed document, as a freeze file holds it: a chunk with output, a figure. */
const FROZEN = [
  '---',
  'title: A study',
  '---',
  '',
  'Text before.',
  '',
  '::: {.cell}',
  '',
  FENCE + '{.r .cell-code}',
  'x <- 1:3',
  'sum(x)',
  FENCE,
  '',
  '::: {.cell-output .cell-output-stdout}',
  FENCE,
  '[1] 6',
  FENCE,
  ':::',
  ':::',
  '',
  'Text between.',
  '',
  '::: {#fig-plot .cell layout-align="center"}',
  '',
  FENCE + '{.r .cell-code}',
  'plot(x)',
  FENCE,
  '',
  '::: {.cell-output-display}',
  '![A plot](study_files/figure-html/fig-plot-output-1.png){#fig-plot}',
  ':::',
  ':::',
  '',
].join('\n');

const QMD = [
  '---',
  'title: A study',
  '---',
  '',
  'Text before.',
  '',
  FENCE + '{r}',
  'x <- 1:3',
  'sum(x)',
  FENCE,
  '',
  'Text between.',
  '',
  FENCE + '{r}',
  '#| label: fig-plot',
  'plot(x)',
  FENCE,
  '',
  FENCE + '{r}',
  'never_run()',
  FENCE,
  '',
  FENCE + 'r',
  'plain_code_block()',
  FENCE,
  '',
].join('\n');

describe('the chunks of a document', () => {
  const chunks = executableChunks(Text.of(QMD.split('\n')));

  it('are the fences whose info is an engine in braces, with their labels and code', () => {
    expect(chunks.map((chunk) => chunk.code)).toEqual([
      'x <- 1:3\nsum(x)',
      'plot(x)',
      'never_run()',
    ]);
    expect(chunks.map((chunk) => chunk.label)).toEqual([null, 'fig-plot', null]);
  });

  it('leave out an ordinary code block, and engines that run nothing here', () => {
    const doc = [
      '```{mermaid}',
      'graph TD',
      '```',
      '```{ojs}',
      'x = 1',
      '```',
      '```js',
      'y',
      '```',
    ];
    expect(executableChunks(Text.of(doc))).toEqual([]);
  });

  it('end at the closing fence, and a longer fence is not closed by a shorter one', () => {
    const doc = ['````{python}', '```', 'inner', '```', '````', 'after'];
    const [chunk] = executableChunks(Text.of(doc));
    expect(chunk?.code).toBe('```\ninner\n```');
    expect(chunk?.end).toBe(doc.slice(0, 5).join('\n').length);
  });
});

describe('the cells of executed Markdown', () => {
  const cells = cellsOfMarkdown(FROZEN);

  it('hold the code, the label and what the chunk printed and drew', () => {
    expect(cells).toHaveLength(2);
    expect(cells[0]).toEqual({
      label: null,
      code: 'x <- 1:3\nsum(x)',
      output: FENCE + '\n[1] 6\n' + FENCE,
    });
    expect(cells[1]?.label).toBe('fig-plot');
    expect(cells[1]?.code).toBe('plot(x)');
    expect(cells[1]?.output).toBe(
      '![A plot](study_files/figure-html/fig-plot-output-1.png){#fig-plot}',
    );
  });

  it('do not take a `:::` inside a code fence for a div', () => {
    const md = ['::: {.cell}', FENCE + '{.r .cell-code}', 'cat(":::")', ':::', FENCE, ':::'].join(
      '\n',
    );
    expect(cellsOfMarkdown(md)).toEqual([{ label: null, code: 'cat(":::")\n:::', output: '' }]);
  });
});

describe('a freeze file', () => {
  it('is read for its hash and its cells, and is no file when it is not Quarto’s', () => {
    const json = JSON.stringify({ hash: 'abc', result: { markdown: FROZEN } });
    expect(parseFrozen(json)?.hash).toBe('abc');
    expect(parseFrozen(json)?.cells).toHaveLength(2);
    expect(parseFrozen('not json')).toBeNull();
    expect(parseFrozen('{"hash":"abc"}')).toBeNull();
  });

  it('points its figures at the freeze folder, where Quarto keeps them', () => {
    expect(withFigures('![](study_files/figure-html/a.png)', '../_freeze/study')).toBe(
      '![](../_freeze/study/figure-html/a.png)',
    );
    expect(withFigures('![](study_files/figure-html/a.png)', '.')).toBe(
      '![](study_files/figure-html/a.png)',
    );
  });
});

describe('a notebook', () => {
  const notebook = JSON.stringify({
    cells: [
      { cell_type: 'markdown', source: ['text'] },
      {
        cell_type: 'code',
        source: ['x = 1\n', 'print(x)'],
        outputs: [{ output_type: 'stream', name: 'stdout', text: ['1\n'] }],
      },
      {
        cell_type: 'code',
        source: '#| label: fig-p\nplot()',
        outputs: [
          {
            output_type: 'display_data',
            data: { 'image/png': 'AAAA\n', 'text/plain': ['<Figure>'] },
          },
          { output_type: 'execute_result', data: { 'text/plain': '42' } },
        ],
      },
    ],
  });

  it('gives the code cells, their text and pictures as Markdown', () => {
    const cells = cellsOfNotebook(notebook);
    expect(cells).toHaveLength(2);
    expect(cells?.[0]).toEqual({
      label: null,
      code: 'x = 1\nprint(x)',
      output: FENCE + '\n1\n' + FENCE,
    });
    expect(cells?.[1]?.label).toBe('fig-p');
    expect(cells?.[1]?.output).toBe(
      '![](data:image/png;base64,AAAA)\n\n' + FENCE + '\n42\n' + FENCE,
    );
    expect(cellsOfNotebook('nope')).toBeNull();
  });
});

describe('matching chunks to cells', () => {
  const chunks = executableChunks(Text.of(QMD.split('\n')));
  const cells = cellsOfMarkdown(FROZEN);

  it('pairs in order, by label or by code, and leaves a chunk with no match without a cell', () => {
    const matched = matchCells(chunks, cells);
    expect(matched[0]).toEqual({ cell: cells[0], stale: false });
    expect(matched[1]).toEqual({ cell: cells[1], stale: false });
    expect(matched[2]).toBeNull();
  });

  it('pairs nothing when the code has changed, as a stale file’s chunk is', () => {
    const edited = chunks.map((chunk, i) => (i === 0 ? { ...chunk, code: 'x <- 1:4' } : chunk));
    expect(matchCells(edited, cells)[0]).toBeNull();
    expect(matchCells(edited, cells)[1]).toEqual({ cell: cells[1], stale: false });
  });

  it('says stale for a chunk found by its label whose code is no longer the cell’s', () => {
    const edited = chunks.map((chunk, i) =>
      i === 1 ? { ...chunk, code: 'plot(x, col = 2)' } : chunk,
    );
    expect(matchCells(edited, cells)[1]).toEqual({ cell: cells[1], stale: true });
    // Trailing blanks and `#|` lines are no change of the code.
    const spaced = chunks.map((chunk, i) =>
      i === 1 ? { ...chunk, code: normalCode('#| echo: true\nplot(x)  \n') } : chunk,
    );
    expect(matchCells(spaced, cells)[1]?.stale).toBe(false);
  });

  it('never gives one cell to two chunks', () => {
    const twice = [chunks[0]!, chunks[0]!];
    const matched = matchCells(twice, cells);
    expect(matched[0]?.cell).toBe(cells[0]);
    expect(matched[1]).toBeNull();
  });

  it('compares code without its `#|` lines or trailing blanks', () => {
    expect(normalCode('#| echo: false\nx  \n\n')).toBe('x');
  });
});

describe('the files that are tried', () => {
  it('are the project’s freeze files, from the document’s folder up, then keep-md and keep-ipynb', () => {
    const files = outputFiles('/work/book/ch1/study.qmd').map((entry) => entry.file);
    expect(files[0]).toBe('_freeze/study/execute-results/html.json');
    expect(files).toContain('../_freeze/ch1/study/execute-results/html.json');
    expect(files).toContain('../../_freeze/book/ch1/study/execute-results/html.json');
    expect(files.slice(-2)).toEqual(['study.md', 'study.ipynb']);
  });

  it('are found through the host, which reads only inside the project', async () => {
    const json = JSON.stringify({ hash: 'h', result: { markdown: FROZEN } });
    const asked: string[] = [];
    const host: IncludeHost = {
      read: (path) => {
        asked.push(path);
        return Promise.resolve(
          path === '../_freeze/ch1/study/execute-results/html.json' ? json : null,
        );
      },
      open: () => {},
    };
    const found = await findOutputs(host, '/work/book/ch1/study.qmd');
    expect(found?.source).toBe('freeze');
    expect(found?.dir).toBe('../_freeze/ch1/study');
    expect(asked[0]).toBe('_freeze/study/execute-results/html.json');
    const none = await findOutputs(
      { read: () => Promise.resolve(null), open: () => {} },
      '/work/study.qmd',
    );
    expect(none).toBeNull();
    // A file that is not Quarto's is no file.
    const odd = await findOutputs(
      { read: () => Promise.resolve('hello'), open: () => {} },
      '/work/study.qmd',
    );
    expect(odd).toBeNull();
  });
});

describe('under the chunks of an editor', () => {
  const open: Editor[] = [];
  afterEach(() => {
    for (const editor of open.splice(0)) editor.destroy();
    document.body.replaceChildren();
  });

  const author = { handle: 'ada', name: 'Ada Lovelace' };

  async function show(
    doc: string,
    files: Record<string, string>,
    dialect: 'gfm' | 'pandoc' = 'pandoc',
  ): Promise<HTMLElement[]> {
    const parent = document.createElement('div');
    document.body.append(parent);
    const host: IncludeHost = {
      read: (path) => Promise.resolve(files[path] ?? null),
      open: () => {},
      documentPath: () => '/work/study.qmd',
    };
    const editor = createEditor(parent, {
      doc,
      author,
      dialect,
      includes: host,
      resolveImage: (src) => `asset://${src}`,
    });
    open.push(editor);
    forceParsing(editor.view, editor.view.state.doc.length, 10_000);
    await new Promise((resolve) => setTimeout(resolve, 20));
    return [...editor.view.dom.querySelectorAll<HTMLElement>('.rl-output')];
  }

  const frozen = () =>
    JSON.stringify({ hash: 'a hash, kept as a note', result: { markdown: FROZEN } });
  const FILE = '_freeze/study/execute-results/html.json';

  it('shows the output of each chunk that has one, labeled as from the last run', async () => {
    const blocks = await show(QMD, { [FILE]: frozen() });
    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.querySelector('.rl-output-label')?.textContent).toBe(
      'Output from the last run',
    );
    expect(blocks[0]?.textContent).toContain('[1] 6');
    // The figure is the one in the freeze folder, which is where Quarto keeps it.
    expect(blocks[1]?.querySelector('img')?.getAttribute('src')).toBe(
      'asset://_freeze/study/figure-html/fig-plot-output-1.png',
    );
    expect(blocks[0]?.classList.contains('rl-output-stale')).toBe(false);
  });

  it('says stale for a chunk whose code is not the code its output came from, and not for the others', async () => {
    // The labeled chunk is edited since it ran; the other is as it was. The document has marks and
    // comments in it, which are none of the code, and make no output stale.
    const edited =
      QMD.replace('plot(x)', 'plot(x, col = 2)') + '\n<!-- a comment kept in the file -->\n';
    const blocks = await show(edited, { [FILE]: frozen() });
    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.querySelector('.rl-output-label')?.textContent).toBe(
      'Output from the last run',
    );
    expect(blocks[0]?.classList.contains('rl-output-stale')).toBe(false);
    expect(blocks[1]?.querySelector('.rl-output-label')?.textContent).toBe(
      'Output from the last run, stale',
    );
    expect(blocks[1]?.classList.contains('rl-output-stale')).toBe(true);
  });

  it('shows nothing where there is no file, no match, no host path, or the file is a Markdown one', async () => {
    expect(await show(QMD, {})).toHaveLength(0);
    expect(await show(QMD.replace('sum(x)', 'mean(x)'), { [FILE]: frozen() })).toHaveLength(1);
    expect(await show(QMD, { [FILE]: frozen() }, 'gfm')).toHaveLength(0);
  });
});
