import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newestView, originalView, parse, reviewView } from '@redlines/format';
import { COMMANDS } from './commands.ts';
import { run } from './main.ts';
import type { CliIo } from './main.ts';

/** The example of format §1.2: Ada's insertion, Claude's substitution, Bo's comment and deletion. */
const fixture = readFileSync(
  new URL('../../format/src/fixtures/launch-plan.md', import.meta.url),
  'utf8',
);

/** A file that has never been edited in Redlines. */
const PLAIN = '# Plan\n\nWe will ship the importer in March.\n';

/** Seconds and milliseconds, which the ledger leaves out. */
const NOW = new Date('2026-10-31T23:30:45.678Z');

const NO_MATCH = 'No match found for replacement. Please check your text and try again.\n';

/** The author of the agent examples: Claude working for Ada. */
const AS_CLAUDE = ['--as', 'claude-ada', '--name', 'Claude', '--for', 'ada'];

interface Result {
  code: number;
  stdout: string;
  stderr: string;
  /** The files after the command, by path. */
  files: Record<string, string>;
  /** The paths the command wrote to, in order. */
  writes: string[];
}

/** Runs the command line against files in memory. */
async function redlines(args: string[], files: Record<string, string> = {}): Promise<Result> {
  const stored = { ...files };
  const writes: string[] = [];
  let stdout = '';
  let stderr = '';
  const io: CliIo = {
    readFile(path) {
      const text = stored[path];
      if (text === undefined) {
        return Promise.reject(new Error(`ENOENT: no such file or directory, open '${path}'`));
      }
      return Promise.resolve(text);
    },
    writeFile(path, text) {
      stored[path] = text;
      writes.push(path);
      return Promise.resolve();
    },
    stdout(s) {
      stdout += s;
    },
    stderr(s) {
      stderr += s;
    },
    now: () => NOW,
  };
  const code = await run(args, io);
  return { code, stdout, stderr, files: stored, writes };
}

/** The text of the file at `path` after a command. */
function fileAt(result: Result, path = 'plan.md'): string {
  const text = result.files[path];
  if (text === undefined) throw new Error(`There is no file ${path}`);
  return text;
}

const MAIN = fileURLToPath(new URL('./main.ts', import.meta.url));

/** What a process gave: the exit code and the output. */
type ProcessResult = Pick<Result, 'code' | 'stdout' | 'stderr'>;

/** Runs `main.ts` in a new process, with the options of the `redlines` script in package.json. */
async function script(args: string[]): Promise<ProcessResult> {
  const options = ['--experimental-strip-types', '--disable-warning=ExperimentalWarning'];
  try {
    const { stdout, stderr } = await promisify(execFile)(
      process.execPath,
      [...options, MAIN, ...args],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    );
    return { code: 0, stdout, stderr };
  } catch (error) {
    // `execFile` rejects when the exit code is not 0, with the code and the output.
    const { code, stdout, stderr } = error as ProcessResult;
    return { code, stdout, stderr };
  }
}

describe('view', () => {
  it('prints the newest view', async () => {
    const result = await redlines(['view', 'plan.md'], { 'plan.md': fixture });
    expect(result.code).toBe(0);
    expect(result.stdout).toBe(newestView(fixture).text);
    expect(result.stdout).toContain('We will ship the new importer in April, after the');
    // Markers, deleted text and the ledger are not in it.
    expect(result.stdout).not.toContain('<!--');
    expect(result.stdout).not.toContain('exporter');
    expect(result.stderr).toBe('');
  });

  it('--review prints the review view', async () => {
    const result = await redlines(['view', 'plan.md', '--review'], { 'plan.md': fixture });
    expect(result.code).toBe(0);
    expect(result.stdout).toBe(reviewView(fixture));
    expect(result.stdout).toContain('{++new ++}[k3x9 ada]');
    expect(result.stdout).toContain('{~~March~>April~~}[p7qd claude-ada]');
    expect(result.stdout).toContain('{>>[c8d2 bo] Who signs off on the security review?<<}');
    expect(result.stderr).toBe('');
  });

  it('--original prints the text with every change rejected', async () => {
    const result = await redlines(['view', 'plan.md', '--original'], { 'plan.md': fixture });
    expect(result.code).toBe(0);
    expect(result.stdout).toBe(originalView(fixture).text);
    expect(result.stdout).toContain(
      'We will ship the importer in March, after the security review.',
    );
    expect(result.stdout).toContain('The old exporter stays as it is.');
    expect(result.stderr).toBe('');
  });

  it('does not write the file', async () => {
    const result = await redlines(['view', 'plan.md', '--review'], { 'plan.md': fixture });
    expect(result.writes).toEqual([]);
  });

  it('refuses --review together with --original', async () => {
    const result = await redlines(['view', 'plan.md', '--review', '--original'], {
      'plan.md': fixture,
    });
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('Use --review or --original, not both');
    expect(result.stdout).toBe('');
  });
});

describe('the command line', () => {
  it('prints the usage and exits 2 when given nothing', async () => {
    const result = await redlines([]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('Usage: redlines');
    expect(result.stdout).toBe('');
  });

  it('prints the usage of every command for --help', async () => {
    for (const flag of ['--help', '-h']) {
      const result = await redlines([flag]);
      expect(result.code, flag).toBe(0);
      expect(result.stderr, flag).toBe('');
      for (const command of Object.keys(COMMANDS)) {
        expect(result.stdout, `${flag} ${command}`).toContain(`redlines ${command} <file>`);
      }
    }
  });

  it('names every option of a command in its usage', async () => {
    const { stdout } = await redlines(['--help']);
    for (const [name, command] of Object.entries(COMMANDS)) {
      const line = stdout.split('\n').find((l) => l.includes(`redlines ${name} <file>`)) ?? '';
      for (const option of [...command.flags, ...command.switches]) {
        expect(line, `${name} --${option}`).toContain(`--${option}`);
      }
      for (const arg of command.args) expect(line, `${name} <${arg}>`).toContain(`<${arg}>`);
    }
  });

  it('exits 2 and names a command that does not exist', async () => {
    const result = await redlines(['frobnicate', 'plan.md']);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('Unknown command: frobnicate');
    expect(result.stderr).toContain('Usage: redlines');
  });

  it('does not take the name of an object property for a command', async () => {
    const result = await redlines(['constructor', 'plan.md']);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('Unknown command: constructor');
  });

  it('exits 2 and names an option the command does not take', async () => {
    const result = await redlines(['view', 'plan.md', '--frob'], { 'plan.md': fixture });
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('Unknown option: --frob');
    // A real option of another command is not one of this command's.
    const accepted = await redlines(['accept', 'plan.md', 'k3x9', ...AS_CLAUDE], {
      'plan.md': fixture,
    });
    expect(accepted.code).toBe(2);
    expect(accepted.stderr).toContain('Unknown option: --as');
    expect(accepted.writes).toEqual([]);
  });

  it('exits 2 when an option has no value', async () => {
    const result = await redlines(['str-replace', 'plan.md', '--old'], { 'plan.md': PLAIN });
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('--old needs a value');
  });

  it('exits 2 when an option that stands alone is given a value', async () => {
    const result = await redlines(['view', 'plan.md', '--review=yes'], { 'plan.md': fixture });
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('--review takes no value');
  });

  it('exits 2 and names the option that is missing', async () => {
    const result = await redlines(['str-replace', 'plan.md', '--old', 'March', '--new', 'April'], {
      'plan.md': PLAIN,
    });
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('Missing --as');
    expect(result.writes).toEqual([]);
  });

  it('exits 2 when the file or an argument is missing', async () => {
    const noFile = await redlines(['view']);
    expect(noFile.code).toBe(2);
    expect(noFile.stderr).toContain('Missing <file>');
    const noId = await redlines(['accept', 'plan.md'], { 'plan.md': fixture });
    expect(noId.code).toBe(2);
    expect(noId.stderr).toContain('Missing <id>');
  });

  it('exits 2 when there are more arguments than the command takes', async () => {
    const result = await redlines(['view', 'plan.md', 'extra'], { 'plan.md': fixture });
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('Unexpected argument: extra');
  });

  it('exits 1 and says why when the file cannot be read', async () => {
    const result = await redlines(['view', 'missing.md']);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(
      "Cannot read missing.md: ENOENT: no such file or directory, open 'missing.md'",
    );
    expect(result.stdout).toBe('');
  });
});

describe('str-replace', () => {
  it('writes tracked changes by the agent', async () => {
    const result = await redlines(
      [
        'str-replace',
        'plan.md',
        ...['--old', 'in March', '--new', 'in April'],
        ...AS_CLAUDE,
        ...['--note', 'Matches the roadmap'],
      ],
      { 'plan.md': PLAIN },
    );
    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');

    const parsed = parse(fileAt(result));
    const [mark, ...others] = parsed.marks;
    expect(others).toEqual([]);
    expect(mark?.kind).toBe('sub');
    expect(mark?.payload).toBe('March');
    expect(mark?.entry).toEqual({
      by: 'claude-ada',
      at: '2026-10-31T23:30Z',
      note: 'Matches the roadmap',
    });
    expect(parsed.ledger.people).toEqual([
      { handle: 'claude-ada', name: 'Claude', agent: true, for: 'ada' },
    ]);
    expect(parsed.warnings).toEqual([]);
    expect(newestView(fileAt(result)).text).toBe(PLAIN.replace('March', 'April'));
    // The command says which mark it made.
    expect(result.stdout).toBe(`Suggested 1 change: ${mark?.id}\n`);
  });

  it('shows in the review view as a suggestion by the agent', async () => {
    const edited = await redlines(
      [
        'str-replace',
        'plan.md',
        ...['--old', 'after the security review', '--new', 'after the security and privacy review'],
        ...AS_CLAUDE,
      ],
      { 'plan.md': fixture },
    );
    const [, id] = /: (\w{4})\n$/.exec(edited.stdout) ?? [];
    const review = await redlines(['view', 'plan.md', '--review'], edited.files);
    expect(review.stdout).toContain(`{++and privacy ++}[${id} claude-ada]`);
    const newest = await redlines(['view', 'plan.md'], edited.files);
    expect(newest.stdout).toContain('after the security and privacy review.');
  });

  it("with no match exits 1 with the tool's message", async () => {
    const result = await redlines(
      ['str-replace', 'plan.md', ...['--old', 'in May', '--new', 'in April'], ...AS_CLAUDE],
      { 'plan.md': PLAIN },
    );
    expect(result.code).toBe(1);
    expect(result.stderr).toBe(NO_MATCH);
    expect(result.stdout).toBe('');
    expect(fileAt(result)).toBe(PLAIN);
  });

  it('cannot reach a marker or the ledger through --old', async () => {
    for (const old of ['<!--ins k3x9-->', 'version: 1', '<!-- redlines', 'claude-ada: {name']) {
      const result = await redlines(
        ['str-replace', 'plan.md', ...['--old', old, '--new', 'x'], ...AS_CLAUDE],
        { 'plan.md': fixture },
      );
      expect(result.code, old).toBe(1);
      expect(result.stderr, old).toBe(NO_MATCH);
      expect(result.writes, old).toEqual([]);
    }
  });

  it('refuses new text that holds Redlines markup', async () => {
    const result = await redlines(
      [
        'str-replace',
        'plan.md',
        ...['--old', 'in March', '--new', 'in <!--ins k3x9-->April<!--/k3x9-->'],
        ...AS_CLAUDE,
      ],
      { 'plan.md': PLAIN },
    );
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('This text holds Redlines markup');
    expect(result.writes).toEqual([]);
  });

  it("with several matches exits 1 with the tool's message", async () => {
    const text = 'one two one two\n';
    const result = await redlines(
      ['str-replace', 'plan.md', ...['--old', 'one', '--new', '1'], ...AS_CLAUDE],
      { 'plan.md': text },
    );
    expect(result.code).toBe(1);
    expect(result.stderr).toBe(
      'Found 2 matches for replacement text. Please provide more context to make a unique match.\n',
    );
    expect(result.writes).toEqual([]);
  });

  it('lists the marks it made in the order of the text', async () => {
    const text = 'We ship the old importer next week.\n';
    const result = await redlines(
      [
        'str-replace',
        'plan.md',
        ...['--old', 'the old importer next week', '--new', 'the new exporter next month'],
        ...AS_CLAUDE,
      ],
      { 'plan.md': text },
    );
    expect(result.code).toBe(0);
    const marks = parse(fileAt(result)).marks;
    expect(marks.map((mark) => mark.payload)).toEqual(['old', 'importer', 'week']);
    expect(result.stdout).toBe(`Suggested 3 changes: ${marks.map((mark) => mark.id).join(', ')}\n`);
  });

  it('leaves the file alone when the new text is the old text', async () => {
    const result = await redlines(
      ['str-replace', 'plan.md', ...['--old', 'in March', '--new', 'in March'], ...AS_CLAUDE],
      { 'plan.md': PLAIN },
    );
    expect(result.code).toBe(0);
    expect(result.stdout).toBe('Suggested 0 changes.\n');
    expect(result.writes).toEqual([]);
    expect(fileAt(result)).toBe(PLAIN);
  });

  it('takes text that starts with a dash', async () => {
    const text = '# Todo\n\n- ship the importer\n- write the docs\n';
    const result = await redlines(
      [
        'str-replace',
        'plan.md',
        ...['--old', '- write the docs', '--new', '- write the guide'],
        ...AS_CLAUDE,
      ],
      { 'plan.md': text },
    );
    expect(result.code).toBe(0);
    expect(newestView(fileAt(result)).text).toBe(text.replace('docs', 'guide'));
  });

  it('takes an option written as --name=value', async () => {
    const result = await redlines(
      [
        'str-replace',
        'plan.md',
        ...['--old=in March', '--new=in April', '--as=claude-ada', '--note=Matches a=b'],
      ],
      { 'plan.md': PLAIN },
    );
    expect(result.code).toBe(0);
    const [mark] = parse(fileAt(result)).marks;
    expect(mark?.payload).toBe('March');
    expect(mark?.entry.by).toBe('claude-ada');
    expect(mark?.entry.note).toBe('Matches a=b');
  });

  it('keeps the line breaks of a file that uses CRLF', async () => {
    const text = 'One\r\nTwo\r\nThree\r\n';
    const result = await redlines(
      ['str-replace', 'plan.md', ...['--old', 'Two\nThree', '--new', 'Two\nFour'], ...AS_CLAUDE],
      { 'plan.md': text },
    );
    expect(result.code).toBe(0);
    const after = fileAt(result);
    expect(after.replaceAll('\r\n', '')).not.toMatch(/[\r\n]/);
    expect(newestView(after).text).toBe('One\r\nTwo\r\nFour\r\n');
  });

  it('uses the handle as the name when there is no --name', async () => {
    const result = await redlines(
      ['str-replace', 'plan.md', ...['--old', 'March', '--new', 'April', '--as', 'claude-ada']],
      { 'plan.md': PLAIN },
    );
    expect(result.code).toBe(0);
    expect(parse(fileAt(result)).ledger.people).toEqual([
      { handle: 'claude-ada', name: 'claude-ada' },
    ]);
  });

  it('counts an empty --name, --for or --note as left out', async () => {
    const result = await redlines(
      [
        'str-replace',
        'plan.md',
        ...['--old', 'March', '--new', 'April', '--as', 'ada'],
        ...['--name', '', '--for', '', '--note', ''],
      ],
      { 'plan.md': PLAIN },
    );
    expect(result.code).toBe(0);
    const parsed = parse(fileAt(result));
    expect(parsed.ledger.people).toEqual([{ handle: 'ada', name: 'ada' }]);
    expect(parsed.marks[0]?.entry).toEqual({ by: 'ada', at: '2026-10-31T23:30Z' });
  });

  it.each(['Claude', 'claude ada', '1claude', 'no', 'unknown'])(
    'refuses %j as a handle',
    async (handle) => {
      for (const options of [
        ['--as', handle],
        ['--as', 'claude-ada', '--for', handle],
      ]) {
        const result = await redlines(
          ['str-replace', 'plan.md', ...['--old', 'March', '--new', 'April'], ...options],
          { 'plan.md': PLAIN },
        );
        expect(result.code, options.join(' ')).toBe(1);
        expect(result.stderr, options.join(' ')).toContain(`"${handle}" can't be a handle.`);
        expect(result.writes).toEqual([]);
      }
    },
  );

  it('refuses an empty --as', async () => {
    const result = await redlines(
      ['str-replace', 'plan.md', ...['--old', 'March', '--new', 'April', '--as', '']],
      { 'plan.md': PLAIN },
    );
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(`"" can't be a handle.`);
    expect(result.writes).toEqual([]);
  });

  it('keeps the people and marks that are in the file', async () => {
    const result = await redlines(
      [
        'str-replace',
        'plan.md',
        ...['--old', '# Launch plan', '--new', '# Launch plan for May'],
        ...['--as', 'claude-ada', '--name', 'Someone else'],
      ],
      { 'plan.md': fixture },
    );
    expect(result.code).toBe(0);
    const before = parse(fixture);
    const parsed = parse(fileAt(result));
    // Claude is in the file already, under the name it has there.
    expect(parsed.ledger.people).toEqual(before.ledger.people);
    expect(parsed.marks).toHaveLength(before.marks.length + 1);
    for (const [id, entry] of Object.entries(before.ledger.marks)) {
      expect(parsed.ledger.marks[id], id).toEqual(entry);
    }
    expect(parsed.ledger.comments).toEqual(before.ledger.comments);
  });

  it.each([
    'Matches the roadmap: see #3, "May" ships - done',
    'First line\nSecond line',
    'Uses --> and <!--ins k3x9--> as text',
  ])('writes the note %j so that the file reads back', async (note) => {
    const result = await redlines(
      [
        'str-replace',
        'plan.md',
        ...['--old', 'March', '--new', 'April', '--note', note],
        ...AS_CLAUDE,
      ],
      { 'plan.md': PLAIN },
    );
    expect(result.code).toBe(0);
    const parsed = parse(fileAt(result));
    expect(parsed.warnings).toEqual([]);
    expect(parsed.marks[0]?.entry.note).toBe(note);
  });
});

describe('comment', () => {
  it('adds a thread on the quoted text', async () => {
    const result = await redlines(
      ['comment', 'plan.md', ...['--quote', 'importer', '--text', 'Which importer?'], ...AS_CLAUDE],
      { 'plan.md': PLAIN },
    );
    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');

    const after = fileAt(result);
    const parsed = parse(after);
    const [thread, ...others] = parsed.ledger.comments;
    expect(others).toEqual([]);
    expect(thread).toMatchObject({
      by: 'claude-ada',
      at: '2026-10-31T23:30Z',
      text: 'Which importer?',
      quote: 'importer',
    });
    expect(result.stdout).toBe(`Added comment ${thread?.id}\n`);
    expect(after).toContain(`the <!--cmt ${thread?.id}-->importer<!--/${thread?.id}--> in March.`);
    expect(newestView(after).text).toBe(PLAIN);
    expect(parsed.ledger.people).toEqual([
      { handle: 'claude-ada', name: 'Claude', agent: true, for: 'ada' },
    ]);
    expect(parsed.warnings).toEqual([]);
  });

  it('finds the quote in the text people read, whatever markers lie in it', async () => {
    const result = await redlines(
      [
        'comment',
        'plan.md',
        ...['--quote', 'new importer in April', '--text', 'Is April safe?'],
        ...['--as', 'bo'],
      ],
      { 'plan.md': fixture },
    );
    expect(result.code).toBe(0);
    const after = fileAt(result);
    const parsed = parse(after);
    expect(parsed.warnings).toEqual([]);
    expect(newestView(after).text).toBe(newestView(fixture).text);
    const thread = parsed.ledger.comments.find((t) => t.text === 'Is April safe?');
    expect(thread?.quote).toBe('new importer in April');
    // Every mark that was there still is.
    expect(parsed.marks.map((mark) => mark.id)).toEqual(
      expect.arrayContaining(parse(fixture).marks.map((mark) => mark.id)),
    );
  });

  it('does not find text that the newest view does not show', async () => {
    for (const quote of ['old exporter', '<!--ins k3x9-->', 'k3x9']) {
      const result = await redlines(
        ['comment', 'plan.md', ...['--quote', quote, '--text', 'Hmm.'], ...AS_CLAUDE],
        { 'plan.md': fixture },
      );
      expect(result.code, quote).toBe(1);
      expect(result.stderr, quote).toBe(
        'No match found for the quote. Please check your text and try again.\n',
      );
      expect(result.writes).toEqual([]);
    }
  });

  it('does not take an empty quote for a match', async () => {
    const result = await redlines(
      ['comment', 'plan.md', ...['--quote', '', '--text', 'Hmm.'], ...AS_CLAUDE],
      { 'plan.md': PLAIN },
    );
    expect(result.code).toBe(1);
    expect(result.stderr).toBe(
      'No match found for the quote. Please check your text and try again.\n',
    );
    expect(result.writes).toEqual([]);
  });

  it('exits 1 when the quote matches several places', async () => {
    const result = await redlines(
      ['comment', 'plan.md', ...['--quote', 'one', '--text', 'Which one?'], ...AS_CLAUDE],
      { 'plan.md': 'one two one\n' },
    );
    expect(result.code).toBe(1);
    expect(result.stderr).toBe(
      'Found 2 matches for the quote. Please provide more context to make a unique match.\n',
    );
    expect(result.writes).toEqual([]);
  });

  it('finds a quote over several lines in a file that uses CRLF', async () => {
    const text = 'One\r\nTwo\r\nThree\r\n';
    const result = await redlines(
      ['comment', 'plan.md', ...['--quote', 'One\nTwo', '--text', 'Why?'], ...AS_CLAUDE],
      { 'plan.md': text },
    );
    expect(result.code).toBe(0);
    const after = fileAt(result);
    expect(after.replaceAll('\r\n', '')).not.toMatch(/[\r\n]/);
    expect(newestView(after).text).toBe(text);
    const [mark] = parse(after).marks;
    expect(mark?.kind).toBe('cmt');
    expect(after).toMatch(/<!--cmt \w{4}-->One\r\nTwo<!--\/\w{4}-->/);
  });

  it('exits 1 for a comment with no text', async () => {
    const result = await redlines(
      ['comment', 'plan.md', ...['--quote', 'importer', '--text', '  '], ...AS_CLAUDE],
      { 'plan.md': PLAIN },
    );
    expect(result.code).toBe(1);
    expect(result.stderr).toBe('The comment is empty.\n');
    expect(result.writes).toEqual([]);
  });
});

describe('reply', () => {
  it('adds a reply to the thread', async () => {
    const result = await redlines(
      ['reply', 'plan.md', 'c8d2', '--text', 'Ada does.', '--as', 'ada'],
      {
        'plan.md': fixture,
      },
    );
    expect(result.code).toBe(0);
    expect(result.stdout).toBe('Replied to c8d2\n');
    expect(result.stderr).toBe('');

    const thread = parse(fileAt(result)).ledger.comments.find((t) => t.id === 'c8d2');
    expect(thread?.replies).toMatchObject([
      { by: 'ada', at: '2026-10-31T23:30Z', text: 'Ada does.' },
    ]);
    expect(thread?.text).toBe('Who signs off on the security review?');
  });

  it('exits 1 when there is no such thread', async () => {
    const result = await redlines(['reply', 'plan.md', 'zzzz', '--text', 'Hello.', ...AS_CLAUDE], {
      'plan.md': fixture,
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toBe('There is no comment thread with the id zzzz.\n');
    expect(result.writes).toEqual([]);
  });

  it('exits 1 for a reply with no text', async () => {
    const result = await redlines(['reply', 'plan.md', 'c8d2', '--text', '', ...AS_CLAUDE], {
      'plan.md': fixture,
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toBe('The reply is empty.\n');
    expect(result.writes).toEqual([]);
  });
});

describe('accept', () => {
  it('removes the mark', async () => {
    const result = await redlines(['accept', 'plan.md', 'k3x9'], { 'plan.md': fixture });
    expect(result.code).toBe(0);
    expect(result.stdout).toBe('Accepted k3x9\n');
    expect(result.stderr).toBe('');

    const after = fileAt(result);
    expect(after).not.toContain('k3x9');
    expect(after).toContain('We will ship the new importer in <!--sub p7qd March-->');
    const parsed = parse(after);
    expect(parsed.marks.map((mark) => mark.id)).toEqual(['p7qd', 'c8d2', 'w2rf']);
    expect(parsed.ledger.marks).not.toHaveProperty('k3x9');
  });

  it('exits 1 when there is no such change', async () => {
    const result = await redlines(['accept', 'plan.md', 'zzzz'], { 'plan.md': fixture });
    expect(result.code).toBe(1);
    expect(result.stderr).toBe('There is no change with the id zzzz.\n');
    expect(result.writes).toEqual([]);
  });
});

describe('reject', () => {
  it('brings back the text of a deletion', async () => {
    const result = await redlines(['reject', 'plan.md', 'w2rf'], { 'plan.md': fixture });
    expect(result.code).toBe(0);
    expect(result.stdout).toBe('Rejected w2rf\n');
    expect(result.stderr).toBe('');

    const after = fileAt(result);
    expect(after).not.toContain('w2rf');
    expect(newestView(after).text).toContain('review. The old exporter stays as it is.');
  });

  it('removes an insertion with its text', async () => {
    const result = await redlines(['reject', 'plan.md', 'k3x9'], { 'plan.md': fixture });
    expect(result.code).toBe(0);
    expect(newestView(fileAt(result)).text).toContain('We will ship the importer in April');
    expect(parse(fileAt(result)).ledger.marks).not.toHaveProperty('k3x9');
  });

  it('exits 1 for a comment, which is resolved or deleted instead', async () => {
    const result = await redlines(['reject', 'plan.md', 'c8d2'], { 'plan.md': fixture });
    expect(result.code).toBe(1);
    expect(result.stderr).toBe('A comment is resolved or deleted, not accepted or rejected.\n');
    expect(result.writes).toEqual([]);
  });
});

describe('a file whose ledger cannot be read', () => {
  const broken = `${PLAIN}\n<!-- redlines\nversion: 1\npeople: [unclosed\n-->\n`;

  it('can still be viewed', async () => {
    const result = await redlines(['view', 'plan.md'], { 'plan.md': broken });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('We will ship the importer in March.');
  });

  it('is left as it is by an edit, which says why', async () => {
    const result = await redlines(
      ['str-replace', 'plan.md', ...['--old', 'March', '--new', 'April'], ...AS_CLAUDE],
      { 'plan.md': broken },
    );
    expect(result.code).toBe(1);
    expect(result.stderr).toBe(
      "The ledger at the end of this file can't be read, so Redlines won't change it. Fix or remove it first.\n",
    );
    expect(result.writes).toEqual([]);
  });
});

describe('a failure that is not the file or the command line', () => {
  it('is not hidden behind an exit code', async () => {
    const io: CliIo = {
      readFile: () => Promise.resolve(PLAIN),
      writeFile: () => Promise.resolve(),
      stdout: () => undefined,
      stderr: () => undefined,
      now: () => {
        throw new TypeError('The clock broke');
      },
    };
    await expect(run(['view', 'plan.md'], io)).rejects.toThrow('The clock broke');
  });
});

describe('writing the file', () => {
  it('exits 1 and says why when the file cannot be written', async () => {
    let stderr = '';
    const io: CliIo = {
      readFile: () => Promise.resolve(PLAIN),
      writeFile: () => Promise.reject(new Error("EACCES: permission denied, open 'plan.md'")),
      stdout: () => undefined,
      stderr: (s) => (stderr += s),
      now: () => NOW,
    };
    const code = await run(
      ['str-replace', 'plan.md', ...['--old', 'March', '--new', 'April'], ...AS_CLAUDE],
      io,
    );
    expect(code).toBe(1);
    expect(stderr).toBe("Cannot write plan.md: EACCES: permission denied, open 'plan.md'\n");
  });
});

describe('as a script', () => {
  let directory = '';

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'redlines-cli-'));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  /** Writes a file in a scratch directory and returns its path. */
  async function fileWith(content: string | Buffer): Promise<string> {
    const path = join(directory, 'plan.md');
    await writeFile(path, content);
    return path;
  }

  it('prints a view and exits 0', async () => {
    const path = await fileWith(fixture);
    expect(await script(['view', path])).toEqual({
      code: 0,
      stdout: newestView(fixture).text,
      stderr: '',
    });
  });

  it('edits the file on disk', async () => {
    const path = await fileWith(PLAIN);
    const result = await script([
      ...['str-replace', path, '--old', 'in March', '--new', 'in April'],
      ...AS_CLAUDE,
    ]);
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/^Suggested 1 change: \w{4}\n$/);
    expect(newestView(await readFile(path, 'utf8')).text).toBe(PLAIN.replace('March', 'April'));
  });

  it('exits with the code of the command', async () => {
    const path = await fileWith(PLAIN);
    const refused = await script([
      ...['str-replace', path, '--old', 'in May', '--new', 'in June'],
      ...AS_CLAUDE,
    ]);
    expect(refused).toEqual({ code: 1, stdout: '', stderr: NO_MATCH });
    const wrong = await script([]);
    expect(wrong.code).toBe(2);
    expect(wrong.stderr).toContain('Usage: redlines');
    const missing = await script(['view', join(directory, 'missing.md')]);
    expect(missing.code).toBe(1);
    expect(missing.stderr).toContain('Cannot read');
  });

  it('keeps a byte order mark and emoji as they were', async () => {
    const bom = Buffer.from([0xef, 0xbb, 0xbf]);
    const path = await fileWith(Buffer.concat([bom, Buffer.from('Plan 🎉\n\nShip in March.\n')]));
    const result = await script([
      ...['str-replace', path, '--old', 'in March', '--new', 'in April'],
      ...AS_CLAUDE,
    ]);
    expect(result.code).toBe(0);
    const after = await readFile(path);
    expect(after.subarray(0, 3)).toEqual(bom);
    expect(after.toString('utf8')).toContain('Plan 🎉\n\nShip in <!--sub');
  });

  it('prints a long view whole before it exits', async () => {
    const long = 'A line of text, long enough to fill a pipe.\n'.repeat(20_000);
    const path = await fileWith(long);
    const result = await script(['view', path]);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe(long);
  });
});
