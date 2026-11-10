import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PAIRS, compareShapes, shapesOf, shapesOfFile, unpaired } from './icons-check.mjs';

const caret = () => shapesOfFile(PAIRS[0].site);
const clone = (shapes) => structuredClone(shapes);

test('every copy matches its master', () => {
  assert.equal(PAIRS.length, 8);
  assert.deepEqual(unpaired(), []);
  for (const pair of PAIRS) {
    assert.deepEqual(compareShapes(shapesOfFile(pair.site), shapesOfFile(pair.master)), [], pair.site);
  }
});

// Down by 0.5, not along: the first vertex is the caret's tip, and a slide of 0.5 along its edge
// leaves the outline where it was (0.19 off), which is no change to catch.
test('a vertex moved by 0.5 fails', () => {
  const site = clone(caret());
  const path = site.find((s) => s.kind === 'path');
  path.points[0][1] += 0.5;
  const problems = compareShapes(site, shapesOfFile(PAIRS[0].master));
  assert.equal(problems.length, 1);
  assert.match(problems[0], /path/);
});

test('a circle left out fails', () => {
  const site = caret();
  const at = site.findIndex((s) => s.kind === 'circle');
  const master = shapesOfFile(PAIRS[0].master);
  const problems = compareShapes(site.filter((_, i) => i !== at), master);
  assert.equal(problems.length, 1);
  assert.match(problems[0], new RegExp(`${site.length - 1} shapes`));
});

test('another red fails', () => {
  const site = clone(caret()).map((s) => (s.fill === '#d42a1e' ? { ...s, fill: '#d42a1f' } : s));
  const problems = compareShapes(site, shapesOfFile(PAIRS[0].master));
  assert.ok(problems.length > 0);
  assert.match(problems[0], /fill/);
});

test('a curve is refused', () => {
  assert.throws(() => shapesOf('<svg><path d="M0 0C1 1 2 2 3 3Z"/></svg>'), /polygon/);
});
