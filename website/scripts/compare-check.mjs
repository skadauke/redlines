// @ts-check
//
// Holds the comparison table on the page (lib/compare.json) to the one in
// docs/design.md §4, the source. The page shows eleven of §4's rows; each must
// exist there with the same cells, the product names included. Plain Node, no
// network: `npm run compare:check`.

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const HEADING = '## 4. How Redlines compares';

/** @typedef {{ redlines: 'built' | 'planned'; others: boolean[] }} Cells */

/**
 * Reads the first table under §4's heading.
 * @param {string} markdown
 * @returns {{ products: string[]; rows: Map<string, Cells> }}
 */
export function readDesignTable(markdown) {
  const lines = markdown.split('\n');
  const start = lines.findIndex((line) => line.trim() === HEADING);
  if (start < 0) throw new Error(`docs/design.md: no "${HEADING}" heading`);
  let i = start + 1;
  while (i < lines.length && !lines[i]?.startsWith('|')) i++;
  /** @type {string[][]} */
  const table = [];
  for (; i < lines.length && lines[i]?.startsWith('|'); i++) {
    table.push(
      /** @type {string} */ (lines[i])
        .trim()
        .replace(/^\||\|$/g, '')
        .split('|')
        .map((cell) => cell.trim()),
    );
  }
  const header = table[0];
  if (!header || header.length < 6) throw new Error('docs/design.md §4: no header row');
  const products = header.slice(1);
  /** @type {Map<string, Cells>} */
  const rows = new Map();
  for (const cells of table.slice(2)) {
    const feature = cells[0] ?? '';
    const redlinesCell = cells[1];
    /** @type {'built' | 'planned'} */
    let redlines;
    if (redlinesCell === '✅') redlines = 'built';
    else if (redlinesCell === 'Planned') redlines = 'planned';
    else {
      throw new Error(
        `docs/design.md §4, "${feature}", column ${products[0]}: "${redlinesCell}" is neither ✅ nor Planned`,
      );
    }
    const others = cells.slice(2).map((cell, k) => {
      if (cell === '✅') return true;
      if (cell === '❌') return false;
      throw new Error(
        `docs/design.md §4, "${feature}", column ${products[k + 1]}: "${cell}" is neither ✅ nor ❌`,
      );
    });
    rows.set(feature, { redlines, others });
  }
  return { products, rows };
}

/**
 * One message per problem, each naming its row.
 * @param {{ feature: string; redlines: string; others: boolean[] }[]} pageRows
 * @param {string[]} products the page's products, Redlines first
 * @param {{ products: string[]; rows: Map<string, Cells> }} table
 * @returns {string[]}
 */
export function compareRows(pageRows, products, table) {
  /** @type {string[]} */
  const problems = [];
  for (let k = 0; k < Math.max(products.length, table.products.length); k++) {
    if (products[k] !== table.products[k]) {
      problems.push(
        `Product ${k + 1} is "${table.products[k]}" in §4 and "${products[k]}" on the page`,
      );
    }
  }
  for (const row of pageRows) {
    const design = table.rows.get(row.feature);
    if (!design) {
      problems.push(`"${row.feature}": the page has this row and §4 does not`);
      continue;
    }
    if (design.redlines !== row.redlines) {
      problems.push(
        `"${row.feature}": ${products[0]} is ${row.redlines} on the page and ${design.redlines} in §4`,
      );
    }
    row.others.forEach((yes, k) => {
      if (design.others[k] !== yes) {
        problems.push(
          `"${row.feature}": ${table.products[k + 1]} is ${yes ? 'yes' : 'no'} on the page and ${design.others[k] ? 'yes' : 'no'} in §4`,
        );
      }
    });
  }
  return problems;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { rows } = JSON.parse(
    readFileSync(new URL('../lib/compare.json', import.meta.url), 'utf8'),
  );
  const table = readDesignTable(
    readFileSync(new URL('../../docs/design.md', import.meta.url), 'utf8'),
  );
  // `others` in compare.json are in this order, after Redlines (the page's own name).
  const problems = compareRows(
    rows,
    ['Redlines', 'Word', 'Google Docs', 'Notion', 'VS Code'],
    table,
  );
  if (problems.length > 0) {
    console.error(
      `compare-check: the page differs from docs/design.md §4:\n- ${problems.join('\n- ')}`,
    );
    process.exit(1);
  }
  console.log(`compare-check: the page's ${rows.length} rows agree with docs/design.md §4`);
}
