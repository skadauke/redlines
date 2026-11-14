// Which journeys a pull request runs: the smoke journeys always, and the ones tagged for the area
// of each path it changes. A path the journeys can't be about (the Rust, the agents' programs, the
// command line) adds none; a path that every journey is about (the format, the editor's core, the
// themes, the page's own code, the journeys, this workflow) runs them all.

/** The areas a journey can be tagged with (`test.describe('lists @lists', …)`). */
export const AREAS = ['lists', 'blocks', 'tables', 'links', 'views'] as const;
export type Area = (typeof AREAS)[number];

type Effect = readonly Area[] | 'all';

const RULES: readonly (readonly [RegExp, Effect])[] = [
  // Everything draws through these.
  [/^packages\/(format|plugin-api)\//, 'all'],
  [/^plugins\/themes\//, 'all'],
  [/^packages\/editor\/src\/[^/]+\.ts$/, 'all'],
  [/^packages\/editor\/src\/(tracked|clipboard|history)\//, 'all'],
  [/^apps\/desktop\/src\/(main|styles|zoom|text-size|document|settings|journey-hook)[^/]*$/, 'all'],
  [/^apps\/desktop\/(journeys\/|index\.html|vite\.config\.ts|package\.json)/, 'all'],
  [
    /^(\.github\/workflows\/journeys\.yml|pnpm-lock\.yaml|package\.json|pnpm-workspace\.yaml)$/,
    'all',
  ],
  // Areas.
  [/^(packages\/editor\/src\/blocks\/|plugins\/formatting\/)/, ['lists', 'blocks']],
  [/^(packages\/editor\/src\/table\/|plugins\/tables\/)/, ['tables']],
  [
    /^(packages\/editor\/src\/preview\/|plugins\/(code|emoji)\/)/,
    ['lists', 'blocks', 'links', 'tables'],
  ],
  [/^(plugins\/(review|palette)\/|apps\/desktop\/src\/ui\/)/, ['views', 'links']],
];

/** The areas to run for the paths changed, or 'all' when one of them touches everything. */
export function areasFor(paths: readonly string[]): readonly Area[] | 'all' {
  const wanted = new Set<Area>();
  for (const path of paths) {
    for (const [pattern, effect] of RULES) {
      if (!pattern.test(path)) continue;
      if (effect === 'all') return 'all';
      for (const area of effect) wanted.add(area);
    }
  }
  return AREAS.filter((area) => wanted.has(area));
}

/**
 * The `--grep` pattern for the paths changed: `@smoke|@lists|…`, or the empty string for every
 * journey.
 */
export function grepFor(paths: readonly string[]): string {
  const areas = areasFor(paths);
  if (areas === 'all') return '';
  return ['smoke', ...areas].map((tag) => `@${tag}`).join('|');
}
