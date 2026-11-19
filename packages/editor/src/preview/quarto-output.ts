// The outputs that come with a Quarto file, shown under the chunks that made them (design §5.13,
// docs/research/quarto.md). Redlines never runs code. A reviewer sees what a reader sees from what
// Quarto left on disk: the freeze file of a project (`_freeze/<doc>/execute-results/<format>.json`,
// whose `result.markdown` is the executed document as pandoc Markdown), the file `keep-md` keeps, or
// the notebook `keep-ipynb` keeps. Each executable chunk of the .qmd is paired, in order and by its
// code text (or its label), with a cell of that file, and the cell's output is drawn read-only under
// the chunk, labeled as output from the last run, and as stale when the chunk's code is not the code
// its cell ran. A chunk with no match, and a document with no file, show nothing. A file that can't be
// read is no file: the formats are Quarto's own, and may change.

import {
  type EditorState,
  type Extension,
  type Range,
  StateEffect,
  StateField,
  type Text,
} from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  WidgetType,
} from '@codemirror/view';
import type { IncludeHost } from '../api.ts';
import { documentHtml } from '../clipboard/document-html.ts';
import { dialectFacet } from '../dialect.ts';
import { imageResolver } from './image.ts';
import { parsedField, viewModeField } from '../tracked/field.ts';
import { space, textPx } from './theme.ts';
import { includeFacet } from './quarto-include.ts';

/** One executed chunk: its code, as the file has it, and its output as Markdown. */
export interface Cell {
  /** The chunk's label, from `#| label:` or the cell's id, or null. */
  label: string | null;
  /** The code the cell shows, with no `#|` lines; null where the chunk was not echoed. */
  code: string | null;
  /** What the chunk printed and drew, as Markdown: text in code blocks, pictures as images. */
  output: string;
}

/** The outputs found for a document. */
export interface Outputs {
  /** Which file they came from: `freeze`, `keep-md` or `keep-ipynb`. */
  source: 'freeze' | 'keep-md' | 'keep-ipynb';
  /** The MD5 of the file that was run (freeze files only), kept as a note: it is not compared. */
  hash: string | null;
  cells: Cell[];
}

/** A chunk of the document: where its closing fence ends, its label and its code. */
export interface Chunk {
  /** The position at the end of the closing fence's line. */
  end: number;
  label: string | null;
  code: string;
}

/** Engines that run nothing in the page's file or whose outputs are not Markdown: no outputs. */
const NOT_EXECUTED = new Set(['ojs', 'mermaid', 'dot', 'shinylive-python', 'shinylive-r']);

/** The code of a chunk or a cell as it is compared: no `#|` option lines, no trailing blanks. */
export function normalCode(code: string): string {
  return code
    .split('\n')
    .filter((line) => !/^\s*#\|/.test(line))
    .map((line) => line.replace(/\s+$/, ''))
    .join('\n')
    .replace(/^\n+|\n+$/g, '');
}

const labelOf = (code: string): string | null => {
  const found = /^\s*#\|\s*label:\s*['"]?([^\s'"]+)['"]?\s*$/m.exec(code);
  return found?.[1] ?? null;
};

/** The executable chunks of a document's text, in order: a fence whose info is `{engine ...}`. */
export function executableChunks(doc: Text): Chunk[] {
  const chunks: Chunk[] = [];
  let open: { mark: string; lines: string[]; engine: boolean } | null = null;
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n);
    const fence = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line.text);
    if (open) {
      const mark = fence?.[1];
      if (
        mark &&
        mark[0] === open.mark[0] &&
        mark.length >= open.mark.length &&
        !fence[2]?.trim()
      ) {
        if (open.engine) {
          const code = open.lines.join('\n');
          chunks.push({ end: line.to, label: labelOf(code), code: normalCode(code) });
        }
        open = null;
      } else open.lines.push(line.text);
      continue;
    }
    if (!fence?.[1]) continue;
    const info = fence[2]?.trim() ?? '';
    const engine = /^\{([A-Za-z][\w-]*)[^}]*\}$/.exec(info)?.[1];
    open = {
      mark: fence[1],
      lines: [],
      engine: engine !== undefined && !NOT_EXECUTED.has(engine.toLowerCase()),
    };
  }
  return chunks;
}

/**
 * The cells of executed pandoc Markdown (a freeze file's `result.markdown`, or a `keep-md` file):
 * each `::: {.cell}` div holds the code in a fence marked `.cell-code`, and the outputs in divs
 * that go on after it. The divs' fences are dropped, and what is left is Markdown.
 */
export function cellsOfMarkdown(markdown: string): Cell[] {
  const cells: Cell[] = [];
  const lines = markdown.split('\n');
  let depth = 0;
  let fence: string | null = null;
  let cell: { depth: number; id: string | null; code: string[] | null; out: string[] } | null =
    null;
  let codeBlock: string[] | null = null;
  for (const line of lines) {
    const mark = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence !== null) {
      if (
        mark?.[1] &&
        mark[1][0] === fence[0] &&
        mark[1].length >= fence.length &&
        !mark[2]?.trim()
      ) {
        fence = null;
        if (codeBlock) codeBlock = null;
        else cell?.out.push(line);
      } else if (codeBlock) codeBlock.push(line);
      else cell?.out.push(line);
      continue;
    }
    if (mark?.[1]) {
      fence = mark[1];
      const info = mark[2] ?? '';
      if (cell && cell.code === null && /(^|\s)\.cell-code(\s|\}|$)/.test(info)) {
        cell.code = codeBlock = [];
      } else cell?.out.push(line);
      continue;
    }
    const div = /^(:{3,})\s*(.*)$/.exec(line);
    if (div) {
      const attrs = div[2]?.trim() ?? '';
      if (attrs === '') {
        depth--;
        if (cell && depth < cell.depth) {
          cells.push({
            label: cell.id ? cell.id.replace(/^cell-/, '') : null,
            code: cell.code ? normalCode(cell.code.join('\n')) : null,
            output: cell.out.join('\n').replace(/^\n+|\n+$/g, ''),
          });
          cell = null;
        }
      } else {
        depth++;
        if (!cell && /(^|[\s{])\.cell([\s}]|$)/.test(attrs)) {
          const id = /#([\w:.-]+)/.exec(attrs)?.[1] ?? null;
          cell = { depth, id, code: null, out: [] };
        }
      }
      continue;
    }
    cell?.out.push(line);
  }
  return cells;
}

/** The text of a freeze file's cells: its `hash` and the cells of its `result.markdown`, or null. */
export function parseFrozen(json: string): { hash: string | null; cells: Cell[] } | null {
  try {
    const frozen = JSON.parse(json) as { hash?: unknown; result?: { markdown?: unknown } };
    const markdown = frozen.result?.markdown;
    if (typeof markdown !== 'string') return null;
    return {
      hash: typeof frozen.hash === 'string' ? frozen.hash : null,
      cells: cellsOfMarkdown(markdown),
    };
  } catch {
    return null;
  }
}

/** A Jupyter text field: a string, or a list of lines. */
const joined = (value: unknown): string =>
  Array.isArray(value) ? value.join('') : typeof value === 'string' ? value : '';

/** The code cells of a notebook (`keep-ipynb`), their outputs as Markdown. */
export function cellsOfNotebook(json: string): Cell[] | null {
  try {
    const notebook = JSON.parse(json) as { cells?: unknown };
    if (!Array.isArray(notebook.cells)) return null;
    const cells: Cell[] = [];
    for (const raw of notebook.cells as Record<string, unknown>[]) {
      if (raw['cell_type'] !== 'code') continue;
      const source = joined(raw['source']);
      const parts: string[] = [];
      for (const out of (Array.isArray(raw['outputs']) ? raw['outputs'] : []) as Record<
        string,
        unknown
      >[]) {
        const data = (out['data'] ?? {}) as Record<string, unknown>;
        if (out['output_type'] === 'stream') {
          parts.push('```\n' + joined(out['text']).replace(/\n$/, '') + '\n```');
        } else if (
          out['output_type'] === 'execute_result' ||
          out['output_type'] === 'display_data'
        ) {
          const png = joined(data['image/png']).replace(/\s+/g, '');
          const markdown = joined(data['text/markdown']);
          const text = joined(data['text/plain']);
          if (png) parts.push(`![](data:image/png;base64,${png})`);
          else if (markdown) parts.push(markdown);
          else if (text) parts.push('```\n' + text.replace(/\n$/, '') + '\n```');
        }
      }
      cells.push({ label: labelOf(source), code: normalCode(source), output: parts.join('\n\n') });
    }
    return cells;
  } catch {
    return null;
  }
}

/** A chunk's cell, and whether the chunk's code is no longer the code that cell ran. */
export interface Match {
  cell: Cell;
  stale: boolean;
}

/**
 * Pairs each chunk with a cell, in order: the next cell after the last one paired whose label is the
 * chunk's, or else whose code is the chunk's. Only a match is a pair, and a chunk that has none has
 * no output. A pair is stale when the chunk's code is not the code its cell ran (a chunk found by
 * its label and edited since), compared with no `#|` lines and no trailing blanks: it is the chunk's
 * own code that decides, not the document's, whose marks and comments change the file and not the
 * code. (A freeze file's `hash` is the MD5 of the whole file that was run, and is not used.)
 */
export function matchCells(chunks: readonly Chunk[], cells: readonly Cell[]): (Match | null)[] {
  let next = 0;
  return chunks.map((chunk) => {
    for (let i = next; i < cells.length; i++) {
      const cell = cells[i];
      if (!cell) continue;
      const byLabel = chunk.label !== null && cell.label === chunk.label;
      const byCode = cell.code !== null && cell.code === chunk.code;
      if (byLabel || byCode) {
        next = i + 1;
        return { cell, stale: cell.code !== null && cell.code !== chunk.code };
      }
    }
    return null;
  });
}

/**
 * The files to try for a document at `path`, as paths relative to the document: the project's freeze
 * files (`_freeze/<path from the project's folder>/execute-results/<format>.json`, the project's
 * folder being the document's or any one above it), then the Markdown file and the notebook that
 * `keep-md` and `keep-ipynb` leave beside it.
 */
export function outputFiles(
  path: string,
): { file: string; source: Outputs['source']; dir: string }[] {
  const parts = path.split(/[\\/]/).filter(Boolean);
  const name = (parts.pop() ?? '').replace(/\.[^.]*$/, '');
  if (!name) return [];
  const found: { file: string; source: Outputs['source']; dir: string }[] = [];
  for (let k = 0; k <= Math.min(5, parts.length); k++) {
    const stem = [...parts.slice(parts.length - k), name].join('/');
    const back = '../'.repeat(k);
    for (const format of FORMATS) {
      found.push({
        file: `${back}_freeze/${stem}/execute-results/${format}.json`,
        source: 'freeze',
        dir: `${back}_freeze/${stem}`,
      });
    }
  }
  found.push({ file: `${name}.md`, source: 'keep-md', dir: '.' });
  found.push({ file: `${name}.ipynb`, source: 'keep-ipynb', dir: '.' });
  return found;
}

/** The formats Quarto freezes a document for, the likeliest first. */
const FORMATS = ['html', 'pdf', 'docx', 'revealjs', 'typst', 'epub', 'gfm'];

/** Reads what Quarto left for the document at `path`: the first file that reads and is Quarto's. */
export async function findOutputs(
  host: IncludeHost,
  path: string,
): Promise<(Outputs & { dir: string }) | null> {
  for (const { file, source, dir } of outputFiles(path)) {
    const text = await host.read(file).catch(() => null);
    if (text === null) continue;
    if (source === 'freeze') {
      const frozen = parseFrozen(text);
      if (frozen) return { source, hash: frozen.hash, cells: frozen.cells, dir };
    } else if (source === 'keep-md') {
      const cells = cellsOfMarkdown(text);
      if (cells.length) return { source, hash: null, cells, dir };
    } else {
      const cells = cellsOfNotebook(text);
      if (cells?.length) return { source, hash: null, cells, dir };
    }
  }
  return null;
}

/** The output's Markdown with a freeze file's figures pointed at `_freeze/<doc>/figure-<format>/`. */
export function withFigures(output: string, dir: string): string {
  if (dir === '.') return output;
  return output.replace(/\]\(([^)\s]*?_files\/)(figure-[\w-]+\/)/g, `](${dir}/$2`);
}

/** What the loader found, or null where nothing is found (yet). */
const setOutputs = StateEffect.define<(Outputs & { dir: string }) | null>();

const loaded = StateField.define<(Outputs & { dir: string }) | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setOutputs)) return effect.value;
    return value;
  },
});

class OutputWidget extends WidgetType {
  readonly cell: Cell;
  readonly dir: string;
  readonly stale: boolean;
  readonly resolve: ((src: string) => string | null) | null;

  constructor(
    cell: Cell,
    dir: string,
    stale: boolean,
    resolve: ((src: string) => string | null) | null,
  ) {
    super();
    this.cell = cell;
    this.dir = dir;
    this.stale = stale;
    this.resolve = resolve;
  }

  override eq(other: OutputWidget): boolean {
    return (
      other.cell.output === this.cell.output &&
      other.stale === this.stale &&
      other.dir === this.dir &&
      other.resolve === this.resolve
    );
  }

  override get estimatedHeight(): number {
    return 80;
  }

  override toDOM(): HTMLElement {
    const block = document.createElement('div');
    block.className = this.stale ? 'rl-output rl-output-stale' : 'rl-output';
    block.setAttribute('role', 'group');
    const label = document.createElement('div');
    label.className = 'rl-output-label';
    label.textContent = this.stale ? 'Output from the last run, stale' : 'Output from the last run';
    if (this.stale) label.title = 'The chunk’s code has changed since it ran';
    const body = document.createElement('div');
    body.className = 'rl-output-body';
    const options = this.resolve ? { resolveImage: this.resolve } : {};
    body.innerHTML = documentHtml(withFigures(this.cell.output, this.dir), 'clean', options);
    block.append(label, body);
    return block;
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

/** The blocks of outputs under the chunks of `state`; none outside a pandoc file or in Plain. */
export function outputDecorations(state: EditorState): DecorationSet {
  if (state.facet(dialectFacet) !== 'pandoc') return Decoration.none;
  if (state.field(viewModeField, false) === 'raw') return Decoration.none;
  const found = state.field(loaded);
  if (!found || found.cells.length === 0) return Decoration.none;
  const { doc } = state;
  const ledger = state.field(parsedField, false)?.ledgerRange;
  const chunks = executableChunks(doc).filter((chunk) => !ledger || chunk.end < ledger.from);
  const matched = matchCells(chunks, found.cells);
  const resolve = state.facet(imageResolver);
  const ranges: Range<Decoration>[] = [];
  chunks.forEach((chunk, i) => {
    const match = matched[i];
    if (!match || match.cell.output.trim() === '') return;
    const { cell, stale } = match;
    ranges.push(
      Decoration.widget({
        widget: new OutputWidget(cell, found.dir, stale, resolve),
        block: true,
        side: 1,
      }).range(chunk.end),
    );
  });
  return Decoration.set(ranges, true);
}

const field = StateField.define<DecorationSet>({
  create: (state) => outputDecorations(state),
  update: (value, tr) =>
    tr.docChanged ||
    tr.effects.some((effect) => effect.is(setOutputs)) ||
    tr.startState.facet(dialectFacet) !== tr.state.facet(dialectFacet) ||
    tr.startState.field(viewModeField, false) !== tr.state.field(viewModeField, false)
      ? outputDecorations(tr.state)
      : value,
  provide: (f) => EditorView.decorations.from(f),
});

/** Reads the outputs when the editor opens and again whenever its window is looked at again. */
const loader = ViewPlugin.fromClass(
  class {
    readonly view: EditorView;
    #alive = true;
    readonly #again = () => void this.load();

    constructor(view: EditorView) {
      this.view = view;
      void this.load();
      window.addEventListener('focus', this.#again);
    }

    async load(): Promise<void> {
      const { state } = this.view;
      const host = state.facet(includeFacet);
      const path = host?.documentPath?.() ?? null;
      if (!host || path === null || state.facet(dialectFacet) !== 'pandoc') return;
      const outputs = await findOutputs(host, path).catch(() => null);
      if (!this.#alive) return;
      const same = JSON.stringify(outputs) === JSON.stringify(this.view.state.field(loaded));
      if (!same) this.view.dispatch({ effects: setOutputs.of(outputs) });
    }

    destroy(): void {
      this.#alive = false;
      window.removeEventListener('focus', this.#again);
    }
  },
);

/**
 * The block, in the grays of the rest of the review chrome: a label in the interface's small size
 * over the output, set apart by a rule at its left, and the space of a block above it, as a code
 * block has, so that it sits with the chunk it belongs to.
 */
const theme = EditorView.baseTheme({
  '.rl-output': {
    margin: `${space('item')} 0 0`,
    padding: `0 0 0 ${textPx(14)}`,
    borderLeft: '2px solid var(--rl-rule)',
    color: 'var(--rl-ink)',
    userSelect: 'text',
  },
  '.rl-output-label': {
    color: 'var(--rl-ink-3)',
    fontFamily: 'var(--rl-font-ui)',
    fontSize: 'var(--rl-size-ui-small-scaled)',
    lineHeight: '1.4',
    marginBottom: textPx(4),
  },
  '.rl-output-stale .rl-output-label': { color: 'var(--rl-ink-2)', fontStyle: 'italic' },
  '.rl-output-body': {
    fontSize: '0.92em',
    overflowX: 'auto',
  },
  '.rl-output-body img': { maxWidth: '100%', height: 'auto' },
  '.rl-output-body pre': { whiteSpace: 'pre-wrap', margin: '0' },
});

/** The outputs under a Quarto file's chunks. Needs the preview's theme. */
export function quartoOutputs(): Extension {
  return [loaded, field, loader, theme];
}
