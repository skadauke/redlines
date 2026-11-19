// The documents the raw-markup check opens (#1207): the repository's fixtures and the Test Drive's
// documents copied into apps/desktop/journeys/documents. Node only (it reads the files).

import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const repo = new URL('../../../../', import.meta.url).pathname;

interface TestDocument {
  /** The file's name, which is also what a known case names it by. */
  name: string;
  text: string;
}

const folders = [
  'apps/desktop/journeys/documents',
  'apps/desktop/quicklook/fixtures',
  'packages/format/src/fixtures',
];
const files = ['apps/desktop/src/sample.md'];

function under(folder: string): string[] {
  return readdirSync(join(repo, folder), { recursive: true })
    .map(String)
    .filter((file) => /\.(md|qmd|Rmd)$/.test(file))
    .map((file) => join(folder, file));
}

/**
 * Every test document. `_method.qmd` and the like are in too: a file that another includes is
 * opened by itself as well.
 */
export function testDocuments(): TestDocument[] {
  const docs = [...folders.flatMap(under), ...files].map((path) => ({
    name: basename(path),
    text: readFileSync(join(repo, path), 'utf8'),
  }));
  const names = docs.map((doc) => doc.name);
  const twice = names.filter((name, i) => names.indexOf(name) !== i);
  if (twice.length > 0) throw new Error(`Two test documents are named ${twice.join(', ')}`);
  return docs;
}
