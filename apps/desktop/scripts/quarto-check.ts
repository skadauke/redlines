// Runs Quarto on a `.qmd` that holds tracked changes, and checks what the research note
// (docs/research/quarto.md) only guessed: that a marked-up file renders the newest text in every
// format, that a chunk that was changed never runs its old code, and that an included file's pending
// changes don't reach the output. It needs Quarto on the PATH (and, for the engines, R with knitr or
// Python with Jupyter: an engine that isn't there is skipped, and said so).
//
//   node scripts/quarto-check.ts                    html, docx and typst, every engine there is
//   node scripts/quarto-check.ts --to html,docx     some formats
//   node scripts/quarto-check.ts --keep             leave the files it made (the folder is printed)
//   node scripts/quarto-check.ts --markdown         the results as a table for the note
//
// Run it in apps/desktop, with Node 24 or later, which runs TypeScript as it is. Its exit code is 1
// when a check failed, 0 when all that ran passed (skips are not failures), 2 when Quarto is missing.
// What it ran and how to read it: docs/research/quarto-check.md.

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  acceptAll,
  addComment,
  applyChanges,
  newestView,
  rejectAll,
  trackedEdits,
} from '@redlines/format';
import type { EditContext, TextChange } from '@redlines/format';

type Engine = 'markdown' | 'knitr' | 'jupyter';
type Format = 'html' | 'docx' | 'typst';

export interface Result {
  probe: string;
  format: Format;
  engine: Engine;
  status: 'pass' | 'fail' | 'skip';
  detail: string;
}

const CTX: EditContext = {
  author: { handle: 'ada', name: 'Ada Lovelace' },
  time: '2026-11-17T10:00Z',
  dialect: 'pandoc',
};

/** The probe file: front matter, a heading with a label, a callout, a cross-reference, a chunk. */
export function probe(engine: Engine): string {
  const chunk =
    engine === 'knitr'
      ? '```{r}\n#| label: fig-plot\nprint("old code")\n```'
      : engine === 'jupyter'
        ? '```{python}\n#| label: fig-plot\nprint("old code")\n```'
        : '```text\nold code\n```';
  return [
    '---',
    'title: "Probe"',
    ...(engine === 'jupyter' ? ['jupyter: python3'] : []),
    '---',
    '',
    '# Intro {#sec-intro}',
    '',
    '::: {.callout-note title="Note"}',
    'Be careful with the old plot.',
    ':::',
    '',
    'See @sec-intro and the figure below.',
    '',
    chunk,
    '',
    'A closing paragraph with a [span]{.mark} and a shortcode {{< meta title >}}.',
    '',
  ].join('\n');
}

/** An edit by words: `find` (in the newest text) becomes `to`, as a tracked change. */
function edit(text: string, find: string, to: string, at = 0, length = find.length): string {
  const view = newestView(text);
  const start = view.text.indexOf(find);
  if (start < 0) throw new Error(`The probe has no "${find}"`);
  // The offsets of the newest view are what a person sees; the file's are the format's.
  const from = view.map.toSource(start + at, -1);
  const end = view.map.toSource(start + at + length, -1);
  const change: TextChange = { from, to: length === 0 ? from : end, insert: to };
  return applyChanges(text, trackedEdits(text, [change], CTX).changes);
}

/** The probe with changes pending at the places the research note found hazardous. */
export function withMarks(engine: Engine): string {
  let text = probe(engine);
  text = edit(text, 'careful', 'very ', 0, 0);
  text = edit(text, 'old plot', 'new plot');
  text = edit(text, '@sec-intro', 'X', 5, 0); // inside a reference: widened to the token
  text = edit(text, 'title="Note"', 'title="Tip"'); // a fence line: widened to the div
  text = edit(text, 'old code', 'new code'); // a chunk: replaced whole
  text = edit(text, 'closing', 'last');
  const view = newestView(text);
  const at = view.text.indexOf('Intro');
  const range = { from: view.map.toSource(at, -1), to: view.map.toSource(at + 5, -1) };
  const { changes } = addComment(text, range, 'Is this the right title?', CTX);
  return applyChanges(text, changes);
}

/** The text of a rendered file, as one line, to compare two renders of the same words. */
function textOf(format: Format, folder: string): string {
  const files = readdirSync(folder);
  const pick = (extension: string) => {
    const found = files.find((name) => name.endsWith(extension));
    if (!found) throw new Error(`No ${extension} file in ${folder}`);
    return join(folder, found);
  };
  let text: string;
  if (format === 'html') {
    text = readFileSync(pick('.html'), 'utf8')
      .replace(/<(script|style|head)\b[\s\S]*?<\/\1>/g, ' ')
      .replace(/<[^>]*>/g, ' ');
  } else if (format === 'docx') {
    const run = spawnSync('unzip', ['-p', pick('.docx'), 'word/document.xml'], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    if (run.status !== 0) throw new Error(`unzip failed: ${run.stderr}`);
    text = run.stdout.replace(/<w:p[ >]/g, '\n$&').replace(/<[^>]*>/g, '');
  } else {
    text = readFileSync(pick('.typ'), 'utf8');
  }
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function quarto(args: string[], cwd: string) {
  return spawnSync('quarto', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function available(engine: Engine): string | null {
  if (engine === 'markdown') return null;
  if (engine === 'knitr') {
    const run = spawnSync('Rscript', ['-e', 'library(knitr)'], { encoding: 'utf8' });
    return run.status === 0 ? null : 'R with knitr is not installed';
  }
  const run = spawnSync('python3', ['-c', 'import jupyter_core, nbformat, yaml, ipykernel'], {
    encoding: 'utf8',
  });
  return run.status === 0 ? null : 'Python with Jupyter is not installed';
}

/** Renders `name` to `format` in a folder of its own, and returns the folder. */
function render(dir: string, name: string, format: Format, label: string): string {
  // Quarto reads the output folder as relative to the input.
  const folder = `out-${label}-${format}`;
  const out = join(dir, folder);
  mkdirSync(out, { recursive: true });
  const to = format;
  const run = quarto(
    [
      'render',
      name,
      '--to',
      to,
      '--output-dir',
      folder,
      ...(format === 'typst' ? ['-M', 'keep-typ:true'] : []),
      ...(format === 'html' ? ['-M', 'embed-resources:true'] : []),
    ],
    dir,
  );
  if (run.status !== 0) throw new Error(`quarto render failed:\n${run.stderr.slice(-800)}`);
  return out;
}

/** What each render must give: the marked-up file reads as the file with its changes accepted. */
function checkRender(dir: string, engine: Engine, format: Format): Result[] {
  const results: Result[] = [];
  const marked = withMarks(engine);
  const accepted = applyChanges(marked, acceptAll(marked));
  const rejected = applyChanges(marked, rejectAll(marked));
  writeFileSync(join(dir, `marked-${engine}.qmd`), marked);
  writeFileSync(join(dir, `accepted-${engine}.qmd`), accepted);
  writeFileSync(join(dir, `rejected-${engine}.qmd`), rejected);
  const base = (probeName: string, status: Result['status'], detail: string): void => {
    results.push({ probe: probeName, format, engine, status, detail });
  };
  try {
    const a = textOf(format, render(dir, `marked-${engine}.qmd`, format, `m-${engine}`));
    const b = textOf(format, render(dir, `accepted-${engine}.qmd`, format, `a-${engine}`));
    const c = textOf(format, render(dir, `rejected-${engine}.qmd`, format, `r-${engine}`));
    base(
      'pending renders as accepted',
      a === b ? 'pass' : 'fail',
      a === b ? 'same text' : `differs: ${firstDifference(a, b)}`,
    );
    base(
      'accepted differs from rejected',
      b !== c ? 'pass' : 'fail',
      b !== c
        ? 'the probe has changes that show'
        : 'the two renders are alike: the probe lost its changes',
    );
    base(
      'no marker or payload shows',
      /redlines/i.test(a) ? 'fail' : 'pass',
      'no ledger or marker text in the output',
    );
    if (engine !== 'markdown') {
      const old = /old code/.test(a);
      base(
        'a changed chunk never runs its old code',
        old ? 'fail' : 'pass',
        old ? 'the output holds "old code"' : 'only the new code ran',
      );
    }
  } catch (error) {
    base('render', 'fail', error instanceof Error ? error.message.split('\n')[0]! : String(error));
  }
  return results;
}

/** An include whose included file has changes pending: the output reads that file accepted. */
function checkInclude(dir: string, format: Format): Result[] {
  const markedPart = edit(probePart(), 'part', 'chapter');
  const front = ['---', 'title: "Include probe"', '---', '', '{{< include _part.qmd >}}', ''].join(
    '\n',
  );
  writeFileSync(join(dir, '_part.qmd'), markedPart);
  writeFileSync(join(dir, 'host.qmd'), front);
  const acceptedPart = applyChanges(markedPart, acceptAll(markedPart));
  const result = (status: Result['status'], detail: string): Result[] => [
    { probe: 'an include with pending changes', format, engine: 'markdown', status, detail },
  ];
  try {
    const marked = textOf(format, render(dir, 'host.qmd', format, 'inc-m'));
    writeFileSync(join(dir, '_part.qmd'), acceptedPart);
    const accepted = textOf(format, render(dir, 'host.qmd', format, 'inc-a'));
    return result(
      marked === accepted ? 'pass' : 'fail',
      marked === accepted ? 'same text' : `differs: ${firstDifference(marked, accepted)}`,
    );
  } catch (error) {
    return result('fail', error instanceof Error ? error.message.split('\n')[0]! : String(error));
  }
}

function probePart(): string {
  return '# Part\n\nThis is the part that is included.\n';
}

function firstDifference(a: string, b: string): string {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return `at ${i}: "${a.slice(Math.max(0, i - 20), i + 30)}" vs "${b.slice(Math.max(0, i - 20), i + 30)}"`;
}

export function run(argv: string[]): number {
  const formats = (
    argv.includes('--to') ? (argv[argv.indexOf('--to') + 1] ?? '') : 'html,docx,typst'
  )
    .split(',')
    .filter((f): f is Format => f === 'html' || f === 'docx' || f === 'typst');
  const version = spawnSync('quarto', ['--version'], { encoding: 'utf8' });
  if (version.status !== 0) {
    process.stderr.write(
      'Quarto is not on the PATH. Install it from https://quarto.org/docs/get-started/ and run again.\n',
    );
    return 2;
  }
  const dir = mkdtempSync(join(tmpdir(), 'quarto-check-'));
  const results: Result[] = [];
  for (const engine of ['markdown', 'knitr', 'jupyter'] as const) {
    const missing = available(engine);
    for (const format of formats) {
      if (missing) {
        results.push({ probe: 'every probe', format, engine, status: 'skip', detail: missing });
        continue;
      }
      results.push(...checkRender(dir, engine, format));
    }
  }
  for (const format of formats) results.push(...checkInclude(dir, format));
  if (argv.includes('--markdown')) {
    process.stdout.write(
      `Quarto ${version.stdout.trim()}\n\n| Probe | Format | Engine | Result |\n| --- | --- | --- | --- |\n`,
    );
    for (const r of results) {
      process.stdout.write(
        `| ${r.probe} | ${r.format} | ${r.engine} | ${r.status}: ${r.detail} |\n`,
      );
    }
  } else {
    process.stdout.write(`Quarto ${version.stdout.trim()}\n`);
    for (const r of results) {
      process.stdout.write(
        `${r.status.toUpperCase().padEnd(4)}  ${r.format.padEnd(5)} ${r.engine.padEnd(8)} ${r.probe}: ${r.detail}\n`,
      );
    }
  }
  if (argv.includes('--keep')) process.stdout.write(`\nFiles: ${dir}\n`);
  return results.some((r) => r.status === 'fail') ? 1 : 0;
}

if (import.meta.main) process.exitCode = run(process.argv.slice(2));
