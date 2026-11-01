// Helpers shared by the tests of the command line. They are not part of the package.

import { run } from './main.ts';
import type { CliIo } from './main.ts';

/** The time of every test, with the seconds and milliseconds that the ledger leaves out. */
export const NOW = new Date('2026-10-31T23:30:45.678Z');

/** What a command did. */
export interface Run {
  code: number;
  stdout: string;
  stderr: string;
  /** The files after the command, by path. */
  files: Record<string, string>;
  /** The files the command replaced, in order. */
  writes: string[];
  /** Every file operation, in order, such as `write plan.md.tmp` and `rename plan.md.tmp plan.md`. */
  operations: string[];
}

/** What a test can change about the machine a command runs on. */
export interface Machine {
  /** What standard input holds. */
  stdin?: string;
  /** Symbolic links: the path each one leads to. */
  links?: Record<string, string>;
  /** The permissions of every file. */
  mode?: number;
  /** The paths that can't be written to, as a file with the mode 0444 can't. */
  readOnly?: readonly string[];
  /** Runs before a file is written. It can throw, as a full disk does, or change `files`, as
   * someone else saving the file does. */
  beforeWrite?(path: string, files: Record<string, string>, mode: number | undefined): void;
  /** Runs before a file is renamed. */
  beforeRename?(from: string, to: string, files: Record<string, string>): void;
  now?(): Date;
}

/** Runs the command line against files in memory. */
export async function redlines(
  args: string[],
  files: Record<string, string> = {},
  machine: Machine = {},
): Promise<Run> {
  const stored = { ...files };
  const writes: string[] = [];
  const operations: string[] = [];
  let stdout = '';
  let stderr = '';
  const missing = (path: string) => new Error(`ENOENT: no such file or directory, open '${path}'`);
  const real = (path: string) => machine.links?.[path] ?? path;
  // Each operation fails with a rejected promise, as the real ones do.
  const later = <T>(operation: () => T): Promise<T> => Promise.resolve().then(operation);

  const io: CliIo = {
    readFile: (path) =>
      later(() => {
        operations.push(`read ${path}`);
        const text = stored[real(path)];
        if (text === undefined) throw missing(path);
        return text;
      }),
    writeFile: (path, text, mode) =>
      later(() => {
        operations.push(`write ${path}`);
        machine.beforeWrite?.(path, stored, mode);
        stored[path] = text;
      }),
    realpath: (path) => later(() => real(path)),
    modeOf: () => later(() => machine.mode ?? 0o644),
    canWrite: (path) => later(() => !machine.readOnly?.includes(path)),
    rename: (from, to) =>
      later(() => {
        operations.push(`rename ${from} ${to}`);
        machine.beforeRename?.(from, to, stored);
        const text = stored[from];
        if (text === undefined) throw missing(from);
        stored[to] = text;
        delete stored[from];
        writes.push(to);
      }),
    remove: (path) =>
      later(() => {
        operations.push(`remove ${path}`);
        if (stored[path] === undefined) throw missing(path);
        delete stored[path];
      }),
    readStdin: () => later(() => machine.stdin ?? ''),
    stdout(s) {
      stdout += s;
    },
    stderr(s) {
      stderr += s;
    },
    now: () => machine.now?.() ?? NOW,
  };
  const code = await run(args, io);
  return { code, stdout, stderr, files: stored, writes, operations };
}
