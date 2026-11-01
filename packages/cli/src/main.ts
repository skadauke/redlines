// The `redlines` command line (design §8.3): views of a Redlines file, and the edits an agent makes
// to it. An edit is a tracked change or a comment by the author given with `--as`.

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { EditError } from '@redlines/format';
import { COMMANDS, UsageError } from './commands.ts';
import type { Command } from './commands.ts';
import { readText, readTextOptions, saveText } from './files.ts';
import { ignoreBrokenPipe, nodeIo } from './node-io.ts';

/** What the command line reads and writes, so tests can run it in memory. */
export interface CliIo {
  /** The text of a file. Rejects with an `EditError` when the file isn't UTF-8 text. */
  readFile(path: string): Promise<string>;
  /** Writes the text of a file. A new file gets the permissions `mode`. */
  writeFile(path: string, text: string, mode?: number): Promise<void>;
  stdout(s: string): void;
  stderr(s: string): void;
  now(): Date;
  /** Where a path really is: the file that a symbolic link leads to. */
  realpath(path: string): Promise<string>;
  /** The permissions of a file. */
  modeOf(path: string): Promise<number>;
  /** Renames a file, replacing the file at the new path in one step. */
  rename(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
  /** Everything on standard input, as UTF-8 text. */
  readStdin(): Promise<string>;
}

const USAGE = `Usage: redlines <command> <file> [options]

Commands:
${Object.entries(COMMANDS)
  .map(([name, command]) => `  redlines ${name} ${command.usage}`)
  .join('\n')}

view prints the newest text, with every change accepted. --review adds the pending changes and
comments, each with its id and author; --original is the text with every change rejected.
--old and --quote must match the newest text exactly once.

A text can be given as a file instead: --old-file, --new-file, --quote-file and --text-file take a
path, or - for standard input (once in a command). A final line break is not part of the text.
Use a file, or single quotes, for text with backticks or $, which a shell expands in double quotes.

--as is who makes the edit. An agent acts for a person: --as claude-ada --name Claude --for ada.
--note is the reason for a change; agents always give one.
`;

interface CommandLine {
  file: string;
  /** The arguments after the file. */
  args: string[];
  flags: Map<string, string>;
}

/** Whether the command takes a value for `--option`: one of its options, or the `-file` option of
 * one of its texts. */
function takesValue(command: Command, option: string): boolean {
  if (command.flags.includes(option)) return true;
  return option.endsWith('-file') && command.texts.includes(option.slice(0, -'-file'.length));
}

/** Splits the arguments of a command into the file, other arguments and options. An option that
 * takes a value takes the next argument, whatever it looks like, so that text can start with a
 * dash. */
function parseArguments(command: Command, argv: readonly string[]): CommandLine {
  const positionals: string[] = [];
  const flags = new Map<string, string>();
  const rest = [...argv];
  for (let arg = rest.shift(); arg !== undefined; arg = rest.shift()) {
    if (!arg.startsWith('--')) {
      positionals.push(arg);
      continue;
    }
    const equals = arg.indexOf('=');
    const option = arg.slice(2, equals === -1 ? undefined : equals);
    const given = equals === -1 ? undefined : arg.slice(equals + 1);
    if (command.switches.includes(option)) {
      if (given !== undefined) throw new UsageError(`--${option} takes no value`);
      flags.set(option, '');
    } else if (takesValue(command, option)) {
      const value = given ?? rest.shift();
      if (value === undefined) throw new UsageError(`--${option} needs a value`);
      flags.set(option, value);
    } else {
      throw new UsageError(`Unknown option: --${option}`);
    }
  }
  const [file, ...args] = positionals;
  if (file === undefined) throw new UsageError('Missing <file>');
  const missing = command.args[args.length];
  if (missing !== undefined) throw new UsageError(`Missing <${missing}>`);
  const extra = args[command.args.length];
  if (extra !== undefined) throw new UsageError(`Unexpected argument: ${extra}`);
  for (const text of command.texts) {
    if (flags.has(text) && flags.has(`${text}-file`)) {
      throw new UsageError(`Use --${text} or --${text}-file, not both`);
    }
  }
  if (command.texts.filter((text) => flags.get(`${text}-file`) === '-').length > 1) {
    throw new UsageError('Only one option can read standard input');
  }
  return { file, args, flags };
}

/** Runs a command and returns its exit code: 0 when it worked, 1 when the edit or the file was
 * refused (the message is on stderr), and 2 when the command line was wrong. */
export async function run(argv: string[], io: CliIo): Promise<number> {
  const [name, ...rest] = argv;
  if (name === '--help' || name === '-h') {
    io.stdout(USAGE);
    return 0;
  }
  try {
    if (name === undefined) throw new UsageError('Missing <command>');
    const command = Object.hasOwn(COMMANDS, name) ? COMMANDS[name] : undefined;
    if (command === undefined) throw new UsageError(`Unknown command: ${name}`);
    const { file, args, flags } = parseArguments(command, rest);
    const text = await readText(io, file);
    await readTextOptions(io, command, flags);
    const outcome = command.run(text, { args, flags, now: io.now() });
    for (const note of outcome.notes ?? []) io.stderr(`${note}\n`);
    if (outcome.text !== undefined) await saveText(io, file, text, outcome.text);
    io.stdout(outcome.output);
    return 0;
  } catch (error) {
    if (error instanceof UsageError) {
      io.stderr(`${error.message}\n\n${USAGE}`);
      return 2;
    }
    if (error instanceof EditError) {
      io.stderr(`${error.message}\n`);
      return 1;
    }
    throw error;
  }
}

/** Whether `node` was started with this file, rather than with a file that imports it. */
function isScript(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

// Run as a script (`pnpm redlines …`), the process ends once the output is written, with the exit
// code of the command. `process.exit` could cut off a long output that a pipe has not yet taken.
if (isScript()) {
  ignoreBrokenPipe(process.stdout);
  ignoreBrokenPipe(process.stderr);
  process.exitCode = await run(process.argv.slice(2), nodeIo);
}
