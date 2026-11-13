// The bundle that the extension runs, built as the script builds it and run as JavaScriptCore runs
// it: in a context with the language and nothing else, no Node and no browser. It must give the
// pages that the sources give.

import { readdirSync, readFileSync } from 'node:fs';
import { rolldown } from 'rolldown';
import vm from 'node:vm';
import { beforeAll, describe, expect, it } from 'vitest';
import config from '../rolldown.config.mjs';
import { renderPreview } from './render.ts';

const FIXTURES = new URL('../fixtures/', import.meta.url);

let render: (text: string, name: string, cut?: boolean) => string;

beforeAll(async () => {
  const bundle = await rolldown({
    input: 'src/entry.ts',
    platform: 'neutral',
    plugins: config.plugins,
    cwd: new URL('..', import.meta.url).pathname,
  });
  const { output } = await bundle.generate({ format: 'iife', minify: true });
  const code = output[0].code;
  const context = vm.createContext({});
  vm.runInContext(code, context);
  render = vm.runInContext('redlinesPreview', context) as typeof render;
}, 60_000);

describe('the bundle', () => {
  it('defines the one function that the extension calls, and nothing else on the global object', () => {
    expect(typeof render).toBe('function');
  });

  const files = readdirSync(FIXTURES).filter((name) => /\.(md|qmd|Rmd)$/.test(name));

  it('has fixtures', () => {
    expect(files).toEqual(
      expect.arrayContaining([
        'plain.md',
        'redlines.md',
        'frontmatter.qmd',
        'table.md',
        'analysis.Rmd',
      ]),
    );
  });

  it.each(files)('draws %s as the sources do', (name) => {
    const text = readFileSync(new URL(name, FIXTURES), 'utf8');
    expect(render(text, name)).toBe(renderPreview(text, name));
  });

  it('draws a start of a file as the sources do', () => {
    const text = 'A <!--ins k3x9-->new <!--/k3x9-->word.\n';
    expect(render(text, 'x.md', true)).toBe(renderPreview(text, 'x.md', true));
  });
});
