// Collects a run's journey screenshots into one folder for a look review: every picture in the
// order the journey took it, grouped by journey, with an INDEX.md that an agent (or a person) reads
// top to bottom with the checklist in front of it (look-review.md). Run it after a run:
//
//   pnpm journeys                     # writes test-results/ and test-results/results.json
//   pnpm journeys:look                # writes look-review/INDEX.md and look-review/<spec>/<journey>/…
//
// Options: --results FILE (default test-results/results.json), --out DIR (default look-review),
// --only-changed (leave out journeys that passed with no failed comparison and no issue note).
// Node runs it as it is (`node --experimental-strip-types`).

import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

interface Attachment {
  name: string;
  contentType: string;
  path?: string;
}
interface Result {
  status: string;
  attachments: Attachment[];
}
interface Test {
  projectName: string;
  expectedStatus: string;
  status: string;
  annotations: { type: string; description?: string }[];
  results: Result[];
}
interface Spec {
  title: string;
  file: string;
  tests: Test[];
}
interface Suite {
  title: string;
  specs?: Spec[];
  suites?: Suite[];
}

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

function option(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 && process.argv[at + 1] ? (process.argv[at + 1] as string) : fallback;
}

const resultsFile = resolve(root, option('results', 'test-results/results.json'));
const outDir = resolve(root, option('out', 'look-review'));
const onlyChanged = process.argv.includes('--only-changed');

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 70) || 'journey';

interface Entry {
  file: string;
  title: string;
  look: string;
  status: 'passed' | 'failed' | 'known' | 'skipped';
  issues: string[];
  pictures: { name: string; path: string; kind: 'shot' | 'expected' | 'actual' | 'diff' }[];
}

function walk(suite: Suite, trail: string[], out: Entry[]): void {
  const here = suite.title && !suite.title.endsWith('.ts') ? [...trail, suite.title] : trail;
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests) {
      const attachments = test.results.at(-1)?.attachments ?? [];
      const pictures = attachments
        .filter((a) => a.contentType === 'image/png' && a.path)
        .map((a) => ({
          name: a.name,
          path: a.path as string,
          kind: /-diff\.png$|^diff$/.test(a.name)
            ? ('diff' as const)
            : /-actual\.png$|^actual$/.test(a.name)
              ? ('actual' as const)
              : /-expected\.png$|^expected$/.test(a.name)
                ? ('expected' as const)
                : ('shot' as const),
        }));
      const known = test.annotations.some((a) => a.type === 'issue');
      const failed = test.status === 'unexpected';
      out.push({
        file: spec.file,
        title: [...here, spec.title].join(' › '),
        look: test.projectName,
        status:
          test.status === 'skipped' ? 'skipped' : failed ? 'failed' : known ? 'known' : 'passed',
        issues: test.annotations.filter((a) => a.type === 'issue').map((a) => a.description ?? ''),
        pictures,
      });
    }
  }
  for (const child of suite.suites ?? []) walk(child, here, out);
}

let report: { suites: Suite[] };
try {
  report = JSON.parse(readFileSync(resultsFile, 'utf8')) as { suites: Suite[] };
} catch {
  console.error(`look-review: no results at ${resultsFile}. Run the journeys first: pnpm journeys`);
  process.exit(1);
}

const entries: Entry[] = [];
for (const suite of report.suites) walk(suite, [], entries);

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const checklist = (() => {
  const text = readFileSync(join(root, 'look-review.md'), 'utf8');
  const start = text.indexOf('<!-- checklist -->');
  const end = text.indexOf('<!-- /checklist -->');
  return start >= 0 && end > start ? text.slice(start + 18, end).trim() : '';
})();

const lines: string[] = [
  '# Look review',
  '',
  `Run: ${entries.length} journeys, ${entries.filter((e) => e.status === 'failed').length} failed, ` +
    `${entries.filter((e) => e.status === 'known').length} known (open issues).`,
  '',
  'Read each picture in order and check it against this list, then file what you see (see look-review.md).',
  '',
  checklist,
  '',
];

let shown = 0;
let pictures = 0;
let lastFile = '';
for (const entry of entries) {
  const interesting = entry.status !== 'passed' || entry.pictures.some((p) => p.kind !== 'shot');
  if (onlyChanged && !interesting) continue;
  if (entry.pictures.length === 0) continue;
  if (entry.file !== lastFile) {
    lines.push(`## ${entry.file}`, '');
    lastFile = entry.file;
  }
  shown++;
  const folder = join(slug(entry.file), `${slug(entry.title)}-${entry.look}`);
  mkdirSync(join(outDir, folder), { recursive: true });
  const badge =
    entry.status === 'failed'
      ? 'FAILED'
      : entry.status === 'known'
        ? `known bug ${entry.issues.join(', ')} (fails on purpose; see look-review.md)`
        : entry.status;
  lines.push(`### ${entry.title} [${entry.look}] — ${badge}`, '');
  entry.pictures.forEach((picture, index) => {
    const target = join(
      folder,
      `${String(index + 1).padStart(2, '0')}-${slug(picture.name.replace(/\.png$/, ''))}.png`,
    );
    copyFileSync(picture.path, join(outDir, target));
    pictures++;
    const label = picture.kind === 'shot' ? picture.name : `${picture.kind}: ${picture.name}`;
    lines.push(
      `${index + 1}. ${label}`,
      '',
      `   ![${label}](${relative(outDir, join(outDir, target))})`,
      '',
    );
  });
}

if (shown === 0) lines.push('Nothing to review: no journey took a screenshot.', '');
writeFileSync(join(outDir, 'INDEX.md'), `${lines.join('\n')}\n`);
console.log(`look-review: ${pictures} pictures of ${shown} journeys in ${outDir}/INDEX.md`);
