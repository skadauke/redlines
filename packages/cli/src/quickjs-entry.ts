// The entry of the `redlines` program, which runs this logic in QuickJS (design: the `redlines`
// program). The program defines a global `__host` that does what the machine does for the command
// line, and calls `redlinesMain` with the arguments. QuickJS has no Node, so nothing here or in
// `run.ts` may import it.

import { run } from './run.ts';
import type { CliIo } from './run.ts';
import { notUtf8 } from './files.ts';

/** What the program gives the logic. A method may return its result or a promise of it, and a
 * failure is an `Error` that is thrown or rejected, whose `message` says why (for example
 * `ENOENT: no such file or directory`). A file whose bytes aren't UTF-8 text is an `Error` with the
 * `name` `NotUtf8`. Paths are the ones the command line was given. */
interface Host {
  readFile(path: string): string | Promise<string>;
  writeFile(path: string, text: string, mode?: number): void | Promise<void>;
  stdout(s: string): void;
  stderr(s: string): void;
  /** Milliseconds since 1970-01-01T00:00Z. */
  nowMs(): number;
  realpath(path: string): string | Promise<string>;
  modeOf(path: string): number | Promise<number>;
  canWrite(path: string): boolean | Promise<boolean>;
  rename(from: string, to: string): void | Promise<void>;
  remove(path: string): void | Promise<void>;
  readStdin(): string | Promise<string>;
  /** The bytes of a file, for a .docx or a picture. */
  readBytes(path: string): Uint8Array;
  /** Writes a file of bytes, and the folders above it that aren't there yet. */
  writeBytes(path: string, bytes: Uint8Array): void;
  /** Evaluates the Word half of the program (`quickjs-word.ts`), which sets `__redlinesWord`. It is
   * not evaluated unless a Word command asks, since it is most of the program's weight. */
  loadWord(): void;
  randomHex(n: number): string;
}

declare const __host: Host;
declare const __redlinesWord: Required<Pick<CliIo, 'importDocx' | 'exportDocx'>>;

/** The Word half, loaded by the first command that needs it. */
function word() {
  if (typeof __redlinesWord === 'undefined') __host.loadWord();
  return __redlinesWord;
}

/** A text from the host, with a failure to decode it as the error that `nodeIo` gives. */
async function decoded(source: string, read: () => string | Promise<string>): Promise<string> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof Error && error.name === 'NotUtf8') throw notUtf8(source);
    throw error;
  }
}

/** The result of a synchronous call as a promise, which a failure rejects, as `await` of an async
 * function would. */
function attempt<T>(call: () => T): Promise<T> {
  return new Promise((resolve) => resolve(call()));
}

function ioOf(host: Host): CliIo {
  return {
    readFile: (path) => decoded(path, () => host.readFile(path)),
    writeFile: async (path, text, mode) => host.writeFile(path, text, mode),
    stdout: (s) => host.stdout(s),
    stderr: (s) => host.stderr(s),
    now: () => new Date(host.nowMs()),
    realpath: async (path) => host.realpath(path),
    modeOf: async (path) => host.modeOf(path),
    canWrite: async (path) => host.canWrite(path),
    rename: async (from, to) => host.rename(from, to),
    remove: async (path) => host.remove(path),
    readStdin: () => decoded('Standard input', () => host.readStdin()),
    randomHex: (n) => host.randomHex(n),
    readBytes: (path) => attempt(() => host.readBytes(path)),
    writeBytes: (path, bytes) => attempt(() => host.writeBytes(path, bytes)),
    importDocx: (bytes) => word().importDocx(bytes),
    exportDocx: (text, images) => word().exportDocx(text, images),
  };
}

/** Runs the command line and gives its exit code. A failure of the program itself is reported on
 * stderr as one line, with the code 70. */
async function redlinesMain(argv: string[]): Promise<number> {
  try {
    return await run(argv, ioOf(__host));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    __host.stderr(`redlines: ${reason}\n`);
    return 70;
  }
}

declare global {
  var redlinesMain: (argv: string[]) => Promise<number>;
}
globalThis.redlinesMain = redlinesMain;
