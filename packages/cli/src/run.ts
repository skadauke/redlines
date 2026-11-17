// The `redlines` command line (design §8.3): views of a Redlines file, and the edits an agent makes
// to it. An edit is a tracked change or a comment by the author given with `--as`. This file and
// the ones it imports use nothing of Node: everything of the machine arrives through `CliIo`, so
// the same logic runs in Node and in the QuickJS of the `redlines` program.

import { EditError } from '@redlines/format';
import { COMMANDS, UsageError } from './commands.ts';
import type { Command } from './commands.ts';
import { cannot, readText, readTextOptions, saveText } from './files.ts';
import { isPlainOnly } from './plain-only.ts';

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
  /** Whether the file can be written to. A file with the mode 0444 can't be, though a rename
   * could replace it. Rejects when that can't be told, for a file that isn't there. */
  canWrite(path: string): Promise<boolean>;
  /** Renames a file, replacing the file at the new path in one step. */
  rename(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
  /** Everything on standard input, as UTF-8 text. */
  readStdin(): Promise<string>;
  /** `n` random bytes as `2 * n` lowercase hexadecimal digits, from the operating system. */
  randomHex(n: number): string;
  /** Writes a binary file. Absent where the command line can't make one (the app's program). */
  writeBytes?(path: string, bytes: Uint8Array): Promise<void>;
  /** The text as a .docx and what the file can't hold. Absent where `writeBytes` is. */
  /** The bytes of a file. Absent where `importDocx` is. */
  readBytes?(path: string): Promise<Uint8Array>;
  /** A .docx as Markdown, with what could not be kept. Absent where `exportDocx` is. */
  importDocx?(
    bytes: Uint8Array,
  ): Promise<{ markdown: string; notes: string[]; media: Record<string, Uint8Array> }>;
  /** `file` is the Markdown's path, which the pictures it links are read beside. */
  exportDocx?(text: string, file?: string): Promise<{ bytes: Uint8Array; notes: string[] }>;
}

const USAGE = `Usage: redlines <command> <file> [options]

Commands:
  redlines export-docx <file> [-o <out.docx>]
  redlines import-docx <file.docx> [-o <out.md>]
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

/** `redlines export-docx <file.md> [-o out.docx]`: the file as a Word file, with its tracked
 * changes and comments. It leaves the file alone, so it is no command of the table. */
async function exportDocx(rest: string[], io: CliIo): Promise<number> {
  let file: string | undefined;
  let out: string | undefined;
  for (let arg = rest.shift(); arg !== undefined; arg = rest.shift()) {
    if (arg === '-o' || arg === '--output') {
      out = rest.shift();
      if (out === undefined) throw new UsageError(`${arg} needs a value`);
    } else if (arg.startsWith('-')) {
      throw new UsageError(`Unknown option: ${arg}`);
    } else if (file === undefined) {
      file = arg;
    } else {
      throw new UsageError(`Unexpected argument: ${arg}`);
    }
  }
  if (file === undefined) throw new UsageError('Missing <file>');
  if (!io.exportDocx || !io.writeBytes) {
    throw new EditError('export-docx is not in this copy of redlines. Use the one in a checkout.');
  }
  const text = await readText(io, file);
  const target = out ?? file.replace(/\.[^./\\]*$/, '') + '.docx';
  if (target === file)
    throw new EditError(`${file} is the file to export; give another name with -o.`);
  const { bytes, notes } = await io.exportDocx(text, file);
  await io.writeBytes(target, bytes).catch(cannot('write', target));
  for (const note of notes) io.stderr(`${note}\n`);
  io.stdout(`${target}\n`);
  return 0;
}

/** `redlines import-docx <file.docx> [-o out.md]`: a Word or Google Docs file as a Redlines file,
 * beside the .docx by default; never over a file that is there. */
async function importDocx(rest: string[], io: CliIo): Promise<number> {
  let file: string | undefined;
  let out: string | undefined;
  for (let arg = rest.shift(); arg !== undefined; arg = rest.shift()) {
    if (arg === '-o' || arg === '--output') {
      out = rest.shift();
      if (out === undefined) throw new UsageError(`${arg} needs a value`);
    } else if (arg.startsWith('-')) {
      throw new UsageError(`Unknown option: ${arg}`);
    } else if (file === undefined) {
      file = arg;
    } else {
      throw new UsageError(`Unexpected argument: ${arg}`);
    }
  }
  if (file === undefined) throw new UsageError('Missing <file>');
  if (!io.importDocx || !io.readBytes) {
    throw new EditError('import-docx is not in this copy of redlines. Use the one in a checkout.');
  }
  const bytes = await io.readBytes(file).catch(cannot('read', file));
  const target = out ?? file.replace(/\.[^./\\]*$/, '') + '.md';
  if (target === file)
    throw new EditError(`${file} is the file to import; give another name with -o.`);
  const { markdown, notes, media } = await io.importDocx(bytes).catch(() => {
    throw new EditError(`${file} is not a Word file that redlines can read.`);
  });
  // Never over a file that is there, whatever its name came from.
  if (
    await io.realpath(target).then(
      () => true,
      () => false,
    )
  ) {
    throw new EditError(`${target} is there already; give another name with -o.`);
  }
  // The pictures go beside the Markdown, where its links name them (`media/image1.png`), and
  // never over a file that is there.
  const folder = target.includes('/') ? target.slice(0, target.lastIndexOf('/') + 1) : '';
  if (Object.keys(media).length > 0 && !io.writeBytes) {
    throw new EditError('This copy of redlines cannot write the pictures of a file.');
  }
  const pictures = Object.entries(media).filter(
    ([name]) => /^media\/[^/\\]+$/.test(name) && name !== 'media/..',
  );
  if (pictures.length < Object.keys(media).length) {
    notes.push('Some pictures have names redlines does not write, and were left out.');
  }
  for (const [name] of pictures) {
    if (
      await io.realpath(folder + name).then(
        () => true,
        () => false,
      )
    ) {
      throw new EditError(`${folder + name} is there already; give another folder with -o.`);
    }
  }
  for (const [name, picture] of pictures) {
    await io.writeBytes?.(folder + name, picture).catch(cannot('write', folder + name));
  }
  await io.writeFile(target, markdown).catch(cannot('write', target));
  for (const note of notes) io.stderr(`${note}\n`);
  io.stdout(`${target}\n`);
  return 0;
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
    if (name === 'export-docx') return await exportDocx(rest, io);
    if (name === 'import-docx') return await importDocx(rest, io);
    const command = Object.hasOwn(COMMANDS, name) ? COMMANDS[name] : undefined;
    if (command === undefined) throw new UsageError(`Unknown command: ${name}`);
    const { file, args, flags } = parseArguments(command, rest);
    const text = await readText(io, file);
    if (isPlainOnly(file)) {
      // Text and code hold no marks: `view` is the file as it is, and no command makes one.
      if (name !== 'view') {
        throw new EditError(
          `${file} is not a Markdown document: text and code files hold no tracked changes or comments. Edit the file as text.`,
        );
      }
      io.stdout(text);
      return 0;
    }
    await readTextOptions(io, command, flags);
    const outcome = command.run(text, { args, flags, now: io.now(), file });
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
