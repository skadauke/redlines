// Reading and writing the file of a command. A command never leaves a file empty, cut off or
// overwritten by an older text: the new text is written whole or not at all.

import { randomBytes } from 'node:crypto';
import { basename, dirname, join } from 'node:path';
import { EditError } from '@redlines/format';
import type { Command } from './commands.ts';
import type { CliIo } from './main.ts';

/** For a file that can't be read or written: an error that says which file, and why. It is an
 * `EditError`, because the edit can't be made and the message is shown as it is. An `EditError`
 * that says it already, such as that a file isn't UTF-8 text, is kept. */
export function cannot(verb: 'read' | 'write', file: string): (error: unknown) => never {
  return (error) => {
    if (error instanceof EditError) throw error;
    const reason = error instanceof Error ? error.message : String(error);
    throw new EditError(`Cannot ${verb} ${file}: ${reason}`);
  };
}

/** The text of a file. */
export function readText(io: CliIo, file: string): Promise<string> {
  return io.readFile(file).catch(cannot('read', file));
}

/**
 * Gives the options that were given as files, such as `--old-file notes.txt`, the text of the
 * file as the value of `--old`; `-` is standard input. A final line break is not part of the text,
 * so that a file, or a here-document, can end the way files do.
 */
export async function readTextOptions(
  io: CliIo,
  command: Command,
  flags: Map<string, string>,
): Promise<void> {
  for (const name of command.texts) {
    const path = flags.get(`${name}-file`);
    if (path === undefined) continue;
    const text =
      path === '-'
        ? await io.readStdin().catch(cannot('read', 'standard input'))
        : await readText(io, path);
    flags.set(name, text.replace(/\r?\n$/, ''));
  }
}

/**
 * Replaces the text of `file`, which the command read as `previous`, with `next`. The new text is
 * written to a hidden file in the same folder and renamed over the file, so a write that fails
 * or is cut short, by a full disk or a command that is ended, leaves the file as it was. A
 * symbolic link is followed, so the link stays, and the new file has the permissions of the old.
 *
 * Just before the rename the file is read again. If it is not what the command read, someone else
 * saved it in the meantime, and their text is not ours to replace: the command fails, and runs
 * again on the new text.
 *
 * @throws EditError when the file can't be written, or changed on the way.
 */
export async function saveText(
  io: CliIo,
  file: string,
  previous: string,
  next: string,
): Promise<void> {
  const target = await io.realpath(file).catch(cannot('write', file));
  const mode = await io.modeOf(target).catch(cannot('write', file));
  const temp = join(dirname(target), `.${basename(target)}.${randomBytes(4).toString('hex')}.tmp`);
  try {
    await io.writeFile(temp, next, mode).catch(cannot('write', file));
    if ((await io.readFile(target).catch(cannot('read', file))) !== previous) {
      throw new EditError(`${file} changed while redlines was editing it. Run the command again.`);
    }
    await io.rename(temp, target).catch(cannot('write', file));
  } catch (error) {
    // The first failure is the one to report, so a failure to clean up is not.
    await io.remove(temp).catch(() => undefined);
    throw error;
  }
}
