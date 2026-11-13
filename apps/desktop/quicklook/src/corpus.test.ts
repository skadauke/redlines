// The renderer on Markdown that nobody wrote for it: the repository's own documents, the format's
// specification among them, with its tables, its code and the markers it shows as examples. Each
// must draw, and no page may hold a script, an image, a comment, anything that loads, an event
// handler or a `javascript:` address, whatever the text said.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderPreview } from './render.ts';

const repo = new URL('../../../../', import.meta.url).pathname;

/** The Markdown files under `folder` of the repository, as paths from its root. */
function markdownUnder(folder: string): string[] {
  return readdirSync(join(repo, folder), { recursive: true })
    .map(String)
    .filter((file) => /\.(md|qmd|Rmd)$/.test(file) && !file.includes('node_modules'))
    .map((file) => join(folder, file));
}

const files = [
  'README.md',
  'AGENTS.md',
  ...markdownUnder('docs'),
  ...markdownUnder('integrations'),
];

/** What a preview must never hold, and where it may not. */
const FORBIDDEN: [string, RegExp][] = [
  ['a script', /<script/i],
  ['an image', /<img/i],
  ['a comment', /<!--/],
  ['something that loads', /<(?:iframe|object|embed|link|form|video|audio|source|svg)\b/i],
  ['an event handler', /<[a-z][^>]*\son[a-z]+\s*=/i],
  ['a javascript: address', /(?:href|src)="\s*javascript:/i],
];

describe('the repository’s own documents', () => {
  it('has a good many of them', () => {
    expect(files.length).toBeGreaterThan(30);
  });

  it.each(files)('%s draws as a page that loads nothing', (file) => {
    const text = readFileSync(join(repo, file), 'utf8');
    const html = renderPreview(text, file.split('/').pop() ?? file);
    const body = html.slice(html.indexOf('<body>'));
    expect(body.length).toBeGreaterThan(40);
    for (const [what, pattern] of FORBIDDEN) {
      expect(pattern.test(body), `${file} holds ${what}`).toBe(false);
    }
  });

  it('draws the format’s specification, with its examples of markers, as the text they are', () => {
    const html = renderPreview(readFileSync(join(repo, 'docs/format.md'), 'utf8'), 'format.md');
    // The markers that its examples show are code, escaped, and not comments that vanish.
    expect(html).toContain('&lt;!--ins k3x9--&gt;');
  });
});
