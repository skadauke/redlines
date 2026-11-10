// @ts-check
//
// Holds the site's copies of the app's icon to the masters in
// apps/desktop/src-tauri/icons/family/. The copies are simplified (no filters,
// fewer points), so this compares shapes, not strings: the same rects,
// circles and paths in the same order and colors, rects exactly, circles
// within 0.1, and each path's outline within 0.25 of the master's both ways,
// in the tile's 100 units. Plain Node, no network: `npm run icons:check`.

import { readdirSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * @typedef {{
 *   kind: 'rect' | 'circle' | 'path';
 *   fill: string;
 *   stroke?: string;
 *   attrs: Record<string, number>;
 *   points?: [number, number][];
 * }} Shape
 */

const RECT = ['x', 'y', 'width', 'height', 'rx'];
const CIRCLE = ['cx', 'cy', 'r'];
const CIRCLE_TOLERANCE = 0.1;
const PATH_TOLERANCE = 0.25;

/** @param {string} tag */
function attributesOf(tag) {
  /** @type {Record<string, string>} */
  const found = {};
  for (const m of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|\{\s*([^}]*?)\s*\})/g)) {
    found[/** @type {string} */ (m[1])] = m[2] ?? m[3] ?? '';
  }
  return found;
}

/**
 * A closed polygon from `M`, `L` and `Z` commands in absolute coordinates.
 * @param {string} d
 * @returns {[number, number][]}
 */
function polygonOf(d) {
  const tokens = d.match(/[A-Za-z]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? [];
  /** @type {number[]} */
  const numbers = [];
  for (const token of tokens) {
    if (/^[A-Za-z]$/.test(token)) {
      if (token !== 'M' && token !== 'L' && token !== 'Z') {
        throw new Error(`a path is read as a polygon (M, L and Z only), not "${token}" in "${d.slice(0, 40)}"`);
      }
    } else {
      numbers.push(Number(token));
    }
  }
  if (numbers.length % 2 !== 0) throw new Error(`a path with an odd number of coordinates: "${d.slice(0, 40)}"`);
  /** @type {[number, number][]} */
  const points = [];
  for (let i = 0; i < numbers.length; i += 2) {
    points.push([/** @type {number} */ (numbers[i]), /** @type {number} */ (numbers[i + 1])]);
  }
  return points;
}

/**
 * The rects, circles and paths of an SVG or of a JSX fragment, in document order.
 * `<defs>` and filters are ignored; the fill comes from the shape or its `<g>`.
 * @param {string} source
 * @returns {Shape[]}
 */
export function shapesOf(source) {
  /** @type {Shape[]} */
  const shapes = [];
  /** @type {string[]} */
  const fills = [];
  let defs = 0;
  for (const m of source.matchAll(/<(\/?)([A-Za-z]+)\b([^>]*?)(\/?)>/g)) {
    const [, closing, name, rest, selfClosing] = m;
    if (name === 'defs') {
      defs += closing ? -1 : 1;
      continue;
    }
    if (defs > 0) continue;
    const attrs = attributesOf(rest ?? '');
    if (name === 'g') {
      if (closing) fills.pop();
      else if (!selfClosing) fills.push((attrs['fill'] ?? fills[fills.length - 1] ?? '').toLowerCase());
      continue;
    }
    if (closing || (name !== 'rect' && name !== 'circle' && name !== 'path')) continue;
    const fill = (attrs['fill'] ?? fills[fills.length - 1] ?? '').toLowerCase();
    const stroke = attrs['stroke']?.toLowerCase();
    if (name === 'path') {
      shapes.push({ kind: 'path', fill, attrs: {}, points: polygonOf(attrs['d'] ?? ''), ...(stroke ? { stroke } : {}) });
      continue;
    }
    /** @type {Record<string, number>} */
    const numbers = {};
    for (const key of name === 'rect' ? RECT : CIRCLE) numbers[key] = Number(attrs[key] ?? 0);
    shapes.push({ kind: name, fill, attrs: numbers, ...(stroke ? { stroke } : {}) });
  }
  return shapes;
}

/**
 * @param {[number, number]} p
 * @param {[number, number]} a
 * @param {[number, number]} b
 */
function distanceToSegment(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length2 = dx * dx + dy * dy;
  const t = length2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/**
 * The most any vertex of `from` lies from the closed outline of `to`.
 * @param {[number, number][]} from
 * @param {[number, number][]} to
 */
function farthestVertex(from, to) {
  let far = 0;
  for (const p of from) {
    let near = Infinity;
    for (let i = 0; i < to.length; i++) {
      near = Math.min(
        near,
        distanceToSegment(p, /** @type {[number, number]} */ (to[i]), /** @type {[number, number]} */ (to[(i + 1) % to.length])),
      );
    }
    far = Math.max(far, near);
  }
  return far;
}

/**
 * One message per problem.
 * @param {Shape[]} site
 * @param {Shape[]} master
 * @returns {string[]}
 */
export function compareShapes(site, master) {
  if (site.length !== master.length) {
    return [`the copy has ${site.length} shapes and the master ${master.length}`];
  }
  /** @type {string[]} */
  const problems = [];
  site.forEach((copy, i) => {
    const original = /** @type {Shape} */ (master[i]);
    const at = `shape ${i + 1} (${original.kind})`;
    if (copy.kind !== original.kind) {
      problems.push(`${at}: the copy has a ${copy.kind}`);
      return;
    }
    if (copy.fill !== original.fill) {
      problems.push(`${at}: fill ${copy.fill || 'none'} in the copy, ${original.fill || 'none'} in the master`);
    }
    if ((copy.stroke ?? '') !== (original.stroke ?? '')) {
      problems.push(`${at}: stroke ${copy.stroke ?? 'none'} in the copy, ${original.stroke ?? 'none'} in the master`);
    }
    if (copy.kind === 'rect') {
      for (const key of RECT) {
        if (copy.attrs[key] !== original.attrs[key]) {
          problems.push(`${at}: ${key} is ${copy.attrs[key]} in the copy and ${original.attrs[key]} in the master`);
        }
      }
    } else if (copy.kind === 'circle') {
      for (const key of CIRCLE) {
        const off = Math.abs(/** @type {number} */ (copy.attrs[key]) - /** @type {number} */ (original.attrs[key]));
        if (off > CIRCLE_TOLERANCE) {
          problems.push(`${at}: ${key} is ${copy.attrs[key]} in the copy and ${original.attrs[key]} in the master`);
        }
      }
    } else {
      const a = copy.points ?? [];
      const b = original.points ?? [];
      const off = Math.max(farthestVertex(a, b), farthestVertex(b, a));
      if (off > PATH_TOLERANCE) {
        problems.push(`${at}: the outline is ${off.toFixed(2)} from the master's (at most ${PATH_TOLERANCE})`);
      }
    }
  });
  return problems;
}

const here = (/** @type {string} */ path) => fileURLToPath(new URL(path, import.meta.url));
const FAMILY = here('../../apps/desktop/src-tauri/icons/family/');

/**
 * The shapes in a file: an SVG, or the `BrandMark` of icons.tsx.
 * @param {string} file
 */
export function shapesOfFile(file) {
  const text = readFileSync(file, 'utf8');
  if (!file.endsWith('.tsx')) return shapesOf(text);
  const start = text.indexOf('export function BrandMark');
  const end = text.indexOf('</svg>', start);
  if (start < 0 || end < 0) throw new Error(`${file}: no BrandMark`);
  return shapesOf(text.slice(start, end));
}

const masters = readdirSync(FAMILY)
  .filter((f) => f.endsWith('.svg'))
  .map((f) => basename(f, '.svg'))
  .sort();
const favicons = readdirSync(here('../public/favicons/'))
  .filter((f) => f.endsWith('.svg'))
  .map((f) => basename(f, '.svg'))
  .sort();

/** Each copy on the site and the master it is held to. */
export const PAIRS = [
  { site: here('../src/app/icon.svg'), master: `${FAMILY}caret.svg` },
  { site: here('../components/icons.tsx'), master: `${FAMILY}caret.svg` },
  ...favicons
    .filter((name) => masters.includes(name))
    .map((name) => ({ site: here(`../public/favicons/${name}.svg`), master: `${FAMILY}${name}.svg` })),
];

/** Favicons without a master, and masters without a favicon. */
export function unpaired() {
  return [
    ...favicons.filter((n) => !masters.includes(n)).map((n) => `public/favicons/${n}.svg has no master`),
    ...masters.filter((n) => !favicons.includes(n)).map((n) => `the master ${n}.svg has no favicon`),
  ];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const problems = unpaired();
  for (const pair of PAIRS) {
    for (const problem of compareShapes(shapesOfFile(pair.site), shapesOfFile(pair.master))) {
      problems.push(`${basename(pair.site)} against ${basename(pair.master)}: ${problem}`);
    }
  }
  if (problems.length > 0) {
    console.error(`icons-check: the site's marks differ from the app's masters:\n- ${problems.join('\n- ')}`);
    process.exit(1);
  }
  console.log(`icons-check: ${PAIRS.length} copies match their masters`);
}
