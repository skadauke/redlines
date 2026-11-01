// The `redlines` command line (design §8.3): views of a Redlines file, and the edits an agent makes
// to it. An edit is a tracked change or a comment by the author given with `--as`.

import { realpathSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { EditError } from '@redlines/format';
import { COMMANDS, UsageError } from './commands.ts';
import type { Command } from './commands.ts';

/** What the command line reads and writes, so tests can run it in memory. */
export interface CliIo {
  readFile(path: string): Promise<string>;
  writeFile(path: string, text: string): Promise<void>;
  stdout(s: string): void;
  stderr(s: string): void;
  now(): Date;
}

const USAGE = `Usage: redlines <command> <file> [options]

Commands:
${Object.entries(COMMANDS)
  .map(([name, command]) => `  redlines ${name} ${command.usage}`)
  .join('\n')}

view prints the newest text, with every change accepted. --review adds the pending changes and
comments, each with its id and author; --original is the text with every change rejected.
--old and --quote must match the newest text exactly once.

--as is who makes the edit. An agent acts for a person: --as claude-ada --name Claude --for ada.
--note is the reason for a change; agents always give one.
`;

interface CommandLine {
  file: string;
  /** The arguments after the file. */
  args: string[];
  flags: Map<string, string>;
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
    } else if (command.flags.includes(option)) {
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
  return { file, args, flags };
}

/** For a file that can't be read or written: an error that says which file, and why. It is an
 * `EditError`, because the edit can't be made and the message is shown as it is. */
function cannot(verb: 'read' | 'write', file: string): (error: unknown) => never {
  return (error) => {
    const reason = error instanceof Error ? error.message : String(error);
    throw new EditError(`Cannot ${verb} ${file}: ${reason}`);
  };
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
    const text = await io.readFile(file).catch(cannot('read', file));
    const outcome = command.run(text, { args, flags, now: io.now() });
    if (outcome.text !== undefined) {
      await io.writeFile(file, outcome.text).catch(cannot('write', file));
    }
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

/** The files and the clock of the machine the command runs on. */
const nodeIo: CliIo = {
  readFile: (path) => readFile(path, 'utf8'),
  writeFile: (path, text) => writeFile(path, text, 'utf8'),
  stdout: (s) => {
    process.stdout.write(s);
  },
  stderr: (s) => {
    process.stderr.write(s);
  },
  now: () => new Date(),
};

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
if (isScript()) process.exitCode = await run(process.argv.slice(2), nodeIo);
