import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { compareRows, readDesignTable } from './compare-check.mjs';

const PRODUCTS = ['Redlines', 'Word', 'Google Docs', 'Notion', 'VS Code'];
const markdown = readFileSync(new URL('../../docs/design.md', import.meta.url), 'utf8');
const table = readDesignTable(markdown);
const { rows } = JSON.parse(readFileSync(new URL('../lib/compare.json', import.meta.url), 'utf8'));

test('the page agrees with docs/design.md §4', () => {
  assert.deepEqual(compareRows(rows, PRODUCTS, table), []);
});

test('a row the page calls built and §4 calls planned fails, by its name', () => {
  const word = 'Word files with tracked changes, in and out';
  const problems = compareRows(
    rows.map((r) => (r.feature === word ? { ...r, redlines: 'built' } : r)),
    PRODUCTS,
    table,
  );
  assert.equal(problems.length, 1);
  assert.match(problems[0], /Word files with tracked changes, in and out/);
});

test('a row §4 lacks fails, by its name', () => {
  const problems = compareRows(
    [
      ...rows,
      { feature: 'Edits PDF files', redlines: 'built', others: [true, false, false, false] },
    ],
    PRODUCTS,
    table,
  );
  assert.equal(problems.length, 1);
  assert.match(problems[0], /Edits PDF files/);
});

test('a changed cell of another product fails, naming the row and the product', () => {
  const problems = compareRows(
    rows.map((r) =>
      r.feature === 'Comment threads' ? { ...r, others: [false, ...r.others.slice(1)] } : r,
    ),
    PRODUCTS,
    table,
  );
  assert.equal(problems.length, 1);
  assert.match(problems[0], /Comment threads/);
  assert.match(problems[0], /Word/);
});

test('other product names fail, naming the product', () => {
  const problems = compareRows(
    rows,
    ['Redlines', 'Word', 'Google Docs', 'Pages', 'VS Code'],
    table,
  );
  assert.equal(problems.length, 1);
  assert.match(problems[0], /Notion/);
});

const MINI = `## 4. How Redlines compares

| Feature | Redlines | Word | Google Docs | Notion | VS Code |
| ------- | :------: | :--: | :---------: | :----: | :-----: |
| Edits Markdown files | ✅ | ❌ | ✅ | ❌ | ✅ |
`;

test('a one-row table reads', () => {
  assert.equal(readDesignTable(MINI).rows.get('Edits Markdown files')?.redlines, 'built');
});

test('a Redlines cell that is neither ✅ nor Planned is refused', () => {
  assert.throws(() => readDesignTable(MINI.replace('| ✅ |', '| Soon |')), /Redlines/);
});
