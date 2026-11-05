// What the Claude and Codex providers share: checking a program, and following a run of it to
// one ending event. Nothing here knows an agent's flags or events; the providers pass those in.

import type {
  AgentEvent,
  AgentRequest,
  AgentState,
  HostProcesses,
  McpEndpoint,
  ProcessHandle,
} from '@redlines/plugin-api';

export function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Why something failed, in one short line. */
export function reasonOf(error: unknown): string {
  return clip(error instanceof Error ? error.message : String(error), 200);
}

/**
 * What the toolbox's tools say while they run. A map, so that a tool named `constructor` is
 * unknown. The `status` tool says nothing: its text arrives by the relay.
 */
export const TOOLBOX_STATUS: ReadonlyMap<string, string | null> = new Map([
  ['view', 'Reading the document'],
  ['read_thread', 'Reading the thread'],
  ['str_replace', 'Editing'],
  ['comment', 'Commenting'],
  ['reply', 'Replying'],
  ['status', null],
]);

export function versionOf(output: string): string | undefined {
  return /\d+\.\d+\.\d+/.exec(output)?.[0];
}

/** Whether `version` is at least `minimum`, both as `x.y.z`. */
export function atLeast(version: string, minimum: string): boolean {
  const a = version.split('.').map(Number);
  const b = minimum.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const [x, y] = [a[i] ?? 0, b[i] ?? 0];
    if (x !== y) return x > y;
  }
  return true;
}

/** What differs between agents when checking a program. */
export interface DetectSpec {
  /** `Claude`, as the person reads it. */
  name: string;
  /** The program's name, for `which`. */
  binary: string;
  notFoundHelp: string;
  minVersion: string;
  signedOutHelp: string;
  /** The program's own sign-in command, such as `['auth', 'status']`. */
  statusArgs: string[];
  isSignedIn(result: { code: number | null; stdout: string }): boolean;
}

/** Finds the program, checks its version and asks it, never a file, whether it is signed in. */
export async function detectAgent(processes: HostProcesses, spec: DetectSpec): Promise<AgentState> {
  try {
    const program = await processes.which(spec.binary);
    if (program === null) return { found: false, help: spec.notFoundHelp };
    const version = versionOf((await processes.exec(program, ['--version'])).stdout);
    if (version !== undefined && !atLeast(version, spec.minVersion)) {
      return {
        found: true,
        signedIn: false,
        version,
        help: `${spec.name} ${version} is too old. Update it to ${spec.minVersion} or newer.`,
      };
    }
    const signedIn = spec.isSignedIn(await processes.exec(program, spec.statusArgs));
    return {
      found: true,
      signedIn,
      ...(version === undefined ? {} : { version }),
      ...(signedIn ? {} : { help: spec.signedOutHelp }),
    };
  } catch (error) {
    return { found: false, help: `${spec.name} couldn't be checked: ${reasonOf(error)}` };
  }
}

export interface FolderOptions {
  /** Makes a fresh, empty folder to run in when the agent may read none. Defaults to `mktemp -d`. */
  emptyFolder?: () => Promise<string>;
  /** Removes a folder `emptyFolder` made. Defaults to `rmdir`, which only removes an empty one. */
  removeFolder?: (folder: string) => Promise<void>;
}

/** What differs between agents when running one. */
export interface RunSpec<S> {
  /** `claude`, for the run's log. */
  id: string;
  name: string;
  binary: string;
  /** Builds the arguments, once the folder is known. `request` has the scope it really runs at. */
  args(context: {
    request: AgentRequest;
    tools: McpEndpoint;
    folder: string;
    program: string;
  }): Promise<string[]>;
  newState(): S;
  parse(line: string, state: S): AgentEvent | null;
  /** True when the line just parsed was a retry: its error is held back, not ended on. */
  held?(state: S): boolean;
  /** The reason a run is failing, once the stream has said so. */
  failure?(state: S): string | undefined;
}

/** How long a program's stdout may stay open after the program ended (an orphan can hold it). */
export const DRAIN_MS = 100;

/**
 * Runs an agent's program and follows it to the end: statuses, then one `done` or `error`. It never
 * throws and never hangs after the program has ended.
 */
export async function* runAgent<S>(
  processes: HostProcesses,
  spec: RunSpec<S>,
  options: FolderOptions,
  request: AgentRequest,
  tools: McpEndpoint,
  signal: AbortSignal,
): AsyncGenerator<AgentEvent> {
  let made: string | undefined;
  let handle: ProcessHandle | undefined;
  try {
    const program = await processes.which(spec.binary);
    if (program === null) {
      yield { type: 'error', message: `${spec.name} isn't installed on this Mac.` };
      return;
    }
    // A document with no folder is run like This document: nothing but an empty folder.
    const own = request.scope === 'document' || !request.folder;
    let folder = request.folder ?? '';
    if (own) {
      folder = await (options.emptyFolder ?? (() => makeFolder(processes)))();
      made = folder;
    }
    const asked: AgentRequest = own ? { ...request, scope: 'document' } : request;
    handle = await processes.start({
      program,
      args: await spec.args({ request: asked, tools, folder, program }),
      cwd: folder,
      log: {
        agent: spec.id,
        thread: request.thread,
        ...(request.documentPath === undefined ? {} : { document: request.documentPath }),
      },
    });
  } catch (error) {
    yield { type: 'error', message: `${spec.name} couldn't be started: ${reasonOf(error)}` };
    await tidy(processes, options, made);
    return;
  }
  try {
    yield* follow(handle, spec, signal);
  } finally {
    await tidy(processes, options, made);
  }
}

async function makeFolder(processes: HostProcesses): Promise<string> {
  const made = await processes.exec('/usr/bin/mktemp', ['-d', '-t', 'redlines-run']);
  const folder = made.stdout.trim();
  if (made.code !== 0 || !folder.startsWith('/')) throw new Error('no empty folder to run in');
  return folder;
}

async function tidy(
  processes: HostProcesses,
  options: FolderOptions,
  folder: string | undefined,
): Promise<void> {
  if (folder === undefined) return;
  try {
    await (options.removeFolder ?? ((f) => processes.exec('/bin/rmdir', [f]).then(() => {})))(
      folder,
    );
  } catch {
    // A leftover empty folder in the temp folder is not worth a failure.
  }
}

async function* follow<S>(
  handle: ProcessHandle,
  spec: RunSpec<S>,
  signal: AbortSignal,
): AsyncGenerator<AgentEvent> {
  let over = false;
  const ended = handle.ended.then(
    (end) => {
      over = true;
      return end;
    },
    () => {
      over = true;
      return { code: null, stderr: '' };
    },
  );
  const stop = () => {
    try {
      handle.stop();
    } catch {
      // Stopping a program that is already gone is not a second ending.
    }
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (signal.aborted) stop();
  else signal.addEventListener('abort', stop, { once: true });

  const state = spec.newState();
  try {
    const lines = handle.lines[Symbol.asyncIterator]();
    for (;;) {
      const next = lines.next();
      // The cutoff restarts for each line: it fires only when nothing arrives for DRAIN_MS once the
      // program has ended, however slowly the consumer takes the events.
      const quiet = ended.then(
        () =>
          new Promise<'drained'>(
            (resolve) => (timer = setTimeout(() => resolve('drained'), DRAIN_MS)),
          ),
      );
      const got = await Promise.race([next, quiet]);
      clearTimeout(timer);
      if (got === 'drained') {
        next.catch(() => {});
        void lines.return?.()?.catch(() => {});
        break;
      }
      if (got.done) break;
      const event = spec.parse(got.value, state);
      // A retry may still work: it is held back, and reported only if the run then fails.
      if (event === null || spec.held?.(state) === true) continue;
      yield event;
      if (event.type === 'error') stop();
      if (event.type !== 'status') return;
    }
    const end = await ended;
    const failure = spec.failure?.(state);
    if (signal.aborted) {
      yield { type: 'error', message: 'Stopped.' };
    } else if (failure !== undefined) {
      yield { type: 'error', message: failure };
    } else {
      const last = end.stderr
        .split('\n')
        .map((text) => text.trim())
        .filter((text) => text && !text.startsWith('Reading additional input'))
        .at(-1);
      yield {
        type: 'error',
        message: last
          ? `${spec.name} stopped: ${clip(last, 200)}`
          : `${spec.name} ended without an answer.`,
      };
    }
  } catch (error) {
    yield { type: 'error', message: `${spec.name} stopped: ${reasonOf(error)}` };
  } finally {
    signal.removeEventListener('abort', stop);
    clearTimeout(timer);
    if (!over) stop();
  }
}
