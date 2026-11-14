// The bundle that the extension runs, built as the script builds it and run as JavaScriptCore runs
// it: in a context with the language and nothing else, no Node and no browser. It must give the
// pages that the sources give.

import { readdirSync, readFileSync } from 'node:fs';
import { rolldown } from 'rolldown';
import vm from 'node:vm';
import { beforeAll, describe, expect, it } from 'vitest';
import config from '../rolldown.config.mjs';
import { previewImages, renderPreview } from './render.ts';

const FIXTURES = new URL('../fixtures/', import.meta.url);

let render: (text: string, name: string, cut?: boolean, images?: string) => string;
/** The global object of the context that the bundle ran in. */
let context: vm.Context;
/** What the bundle put on the global object of its context, which started with nothing. */
let defined: string[];

beforeAll(async () => {
  const bundle = await rolldown({
    input: 'src/entry.ts',
    platform: 'neutral',
    plugins: config.plugins,
    cwd: new URL('..', import.meta.url).pathname,
  });
  const { output } = await bundle.generate({ format: 'iife', minify: true });
  const code = output[0].code;
  context = vm.createContext({});
  vm.runInContext(code, context);
  defined = Object.keys(context);
  render = vm.runInContext('redlinesPreview', context) as typeof render;
}, 60_000);

describe('the bundle', () => {
  it('defines the two functions that the extension calls, and nothing else on the global object', () => {
    expect(typeof render).toBe('function');
    expect(defined.sort()).toEqual(['redlinesImages', 'redlinesPreview']);
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

  it('lists the local images, and draws those that were loaded, as the sources do', () => {
    const text = '![a](images/a.png) ![b](https://example.com/b.png) ![c](c%20c.png)\n';
    const images = vm.runInContext('redlinesImages', context) as (
      text: string,
      cut?: boolean,
    ) => string;
    expect(JSON.parse(images(text))).toEqual(previewImages(text));
    expect(JSON.parse(images('# No pictures\n'))).toEqual([]);
    const loaded = { 'images/a.png': 'img-0', 'c c.png': 'img-1' };
    expect(render(text, 'x.md', false, JSON.stringify(loaded))).toBe(
      renderPreview(text, 'x.md', false, new Map(Object.entries(loaded))),
    );
    // Nonsense from the host is no images.
    expect(render(text, 'x.md', false, 'not json')).toBe(renderPreview(text, 'x.md'));
  });

  it('draws a start of a file as the sources do', () => {
    const text = 'A <!--ins k3x9-->new <!--/k3x9-->word.\n';
    expect(render(text, 'x.md', true)).toBe(renderPreview(text, 'x.md', true));
  });
});
