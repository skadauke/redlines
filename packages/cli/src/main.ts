// The `redlines` command line (design §8.3). A stub until plan Track F.

/** What the command line reads and writes, so tests can run it in memory. */
export interface CliIo {
  readFile(path: string): Promise<string>;
  writeFile(path: string, text: string): Promise<void>;
  stdout(s: string): void;
  stderr(s: string): void;
  now(): Date;
}

const USAGE = 'Usage: redlines <view|str-replace|comment|reply|accept|reject> <file> [options]\n';

/** Runs a command and returns its exit code. */
export async function run(argv: string[], io: CliIo): Promise<number> {
  void argv;
  io.stderr(USAGE);
  return Promise.resolve(2);
}
