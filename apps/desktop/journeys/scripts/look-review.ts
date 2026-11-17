// Collects a run's journey screenshots into one folder for a look review: every picture in the
// order the journey took it, grouped by journey, with an INDEX.md that an agent (or a person) reads
// top to bottom with the checklist in front of it (look-review.md). Run it after a run:
//
//   pnpm journeys                     # writes test-results/ and test-results/results.json
//   pnpm journeys:look                # writes look-review/INDEX.md and look-review/<spec>/<journey>/…
//
// Options: --results FILE (default test-results/results.json), --out DIR (default look-review),
// --only-changed (leave out journeys that passed with no failed comparison and no issue note).
// Node runs it as it is (`node --experimental-strip-types`, Node 22.6 or later).

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
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

// A path given on the command line is relative to where it is typed; the defaults are the package's.
const resultsFile = resolve(
  process.cwd(),
  option('results', join(root, 'test-results/results.json')),
);
const outDir = resolve(process.cwd(), option('out', join(root, 'look-review')));
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
  status: 'passed' | 'failed' | 'known' | 'expected-failure' | 'skipped';
  issues: string[];
  pictures: { name: string; path: string; kind: 'shot' | 'expected' | 'actual' | 'diff' }[];
}

const order = (kind: 'shot' | 'expected' | 'actual' | 'diff') =>
  ({ actual: 0, expected: 1, diff: 2, shot: 3 })[kind];

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
        }))
        // The picture the run got comes first, then the approved one and the diff, then the rest.
        .sort((a, b) => order(a.kind) - order(b.kind));
      const known = test.annotations.some((a) => a.type === 'issue');
      const failsOnPurpose = test.expectedStatus === 'failed';
      const failed = test.status === 'unexpected';
      out.push({
        file: spec.file,
        title: [...here, spec.title].join(' › '),
        look: test.projectName,
        status:
          test.status === 'skipped'
            ? 'skipped'
            : failed
              ? 'failed'
              : known
                ? 'known'
                : failsOnPurpose
                  ? 'expected-failure'
                  : 'passed',
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

// The folder is rebuilt: it is made beside, and put in place when it is whole. It is only ever
// replaced when it is inside this package (and not its own code) and was made by this script.
const guarded = [root, ...['src', 'tests', 'scripts', 'baselines'].map((d) => join(root, d))];
if (!outDir.startsWith(root + sep) || guarded.includes(outDir)) {
  console.error(`look-review: --out must be a new folder inside ${root}, not ${outDir}`);
  process.exit(1);
}
if (existsSync(outDir) && readdirSync(outDir).length > 0 && !existsSync(join(outDir, 'INDEX.md'))) {
  console.error(
    `look-review: ${outDir} is not empty and holds no INDEX.md of an earlier run; not replacing it`,
  );
  process.exit(1);
}
const buildDir = `${outDir}.building`;
rmSync(buildDir, { recursive: true, force: true });
mkdirSync(buildDir, { recursive: true });

const checklist = (() => {
  const text = readFileSync(join(root, 'look-review.md'), 'utf8');
  const start = text.indexOf('<!-- checklist -->');
  const end = text.indexOf('<!-- /checklist -->');
  if (start < 0 || end <= start) {
    console.error('look-review: look-review.md has lost its <!-- checklist --> markers');
    process.exit(1);
  }
  return text.slice(start + 18, end).trim();
})();

// Failed journeys first, then the ones that fail on purpose, then the rest in the order they ran.
const rank = (e: Entry) => (e.status === 'failed' ? 0 : e.status === 'known' ? 1 : 2);
const withPictures = entries.filter((e) => e.pictures.length > 0);
const chosen = withPictures
  .filter((e) => !onlyChanged || e.status !== 'passed' || e.pictures.some((p) => p.kind !== 'shot'))
  .map((entry, index) => ({ entry, index }))
  .sort((a, b) => rank(a.entry) - rank(b.entry) || a.index - b.index)
  .map(({ entry }) => entry);

const count = (status: Entry['status']) => chosen.filter((e) => e.status === status).length;
const lines: string[] = [
  '# Look review',
  '',
  `${chosen.length} journeys with pictures (of ${entries.length} run): ${count('failed')} failed, ` +
    `${count('known')} known bugs (open issues, failing on purpose).`,
  '',
  'Read each picture in order and check it against this list, then file what you see (see look-review.md).',
  '',
  checklist,
  '',
];

let pictures = 0;
let lastFile = '';
const folders = new Set<string>();
for (const entry of chosen) {
  if (entry.file !== lastFile) {
    lines.push(`## ${entry.file}`, '');
    lastFile = entry.file;
  }
  // A folder per journey and look; two titles that slug alike get a number.
  const base = join(slug(entry.file), `${slug(entry.title)}-${entry.look}`);
  let folder = base;
  for (let n = 2; folders.has(folder); n++) folder = `${base}-${n}`;
  folders.add(folder);
  mkdirSync(join(buildDir, folder), { recursive: true });
  const badge =
    entry.status === 'failed'
      ? 'FAILED'
      : entry.status === 'known'
        ? `known bug ${entry.issues.join(', ')} (fails on purpose; see look-review.md)`
        : entry.status === 'expected-failure'
          ? 'expected to fail (no issue noted: a bug picture, not a good one)'
          : entry.status;
  lines.push(`### ${entry.title} [${entry.look}] — ${badge}`, '');
  entry.pictures.forEach((picture, index) => {
    const label = picture.kind === 'shot' ? picture.name : `${picture.kind}: ${picture.name}`;
    if (!existsSync(picture.path)) {
      // A report from another machine, or a run's folder that was cleaned: say so, and go on.
      lines.push(`${index + 1}. ${label} — **missing**: ${picture.path}`, '');
      return;
    }
    const target = join(
      folder,
      `${String(index + 1).padStart(2, '0')}-${slug(picture.name.replace(/\.png$/, ''))}.png`,
    );
    copyFileSync(picture.path, join(buildDir, target));
    pictures++;
    lines.push(`${index + 1}. ${label}`, '', `   ![${label}](${target})`, '');
  });
}

if (chosen.length === 0) {
  lines.push(
    onlyChanged && withPictures.length > 0
      ? 'Nothing changed: every journey passed, with no failed comparison and no known bug.'
      : 'Nothing to review: no journey took a screenshot.',
    '',
  );
}
writeFileSync(join(buildDir, 'INDEX.md'), `${lines.join('\n')}\n`);
rmSync(outDir, { recursive: true, force: true });
renameSync(buildDir, outDir);
console.log(`look-review: ${pictures} pictures of ${chosen.length} journeys in ${outDir}/INDEX.md`);
