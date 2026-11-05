// The Codex provider (design: Routes to the agents). It starts the person's own `codex exec`,
// hands it the toolbox over MCP and turns its JSON Lines into status lines. The flags and the
// events are in docs/superpowers/plans/2026-11-05-v0.2-spike-findings.md.

import type {
  AgentEvent,
  AgentProvider,
  AgentRequest,
  AgentState,
  HostProcesses,
  McpEndpoint,
  Plugin,
  ProcessHandle,
} from '@redlines/plugin-api';
import { definePlugin } from '@redlines/plugin-api';

/** The oldest Codex tested. `--strict-config` makes an older one fail rather than ignore a key. */
export const MIN_VERSION = '0.166.0';

export const SIGNED_OUT_HELP = 'Run `codex login`.';

/**
 * What Codex hands the model by default that Redlines turns off: the person's ChatGPT connectors
 * (GitHub commits, deleting files...), plugins, image generation, goals and the browsers. The list
 * is tested by name, because Codex adds to its defaults without warning.
 */
const DISABLED_FEATURES = [
  'apps',
  'plugins',
  'image_generation',
  'goals',
  'skill_search',
  'tool_suggest',
  'computer_use',
  'browser_use',
  'in_app_browser',
];

/** Where a run happens and which folders hold Codex's own program. */
export interface CodexSetup {
  /** The folder to run in: the one Codex may read, or an empty one at This document. */
  folder: string;
  /** The folder Codex was found in, and the folder of its real path. */
  programFolders: string[];
}

/**
 * The whole command line, in one place, so that a correction is a one-line change.
 *
 * Reads are held to the folder by a permission profile, not by `--sandbox read-only`, which
 * reads anywhere. Never pass both. The folders of Codex's own program must be readable, or it
 * fails to load AGENTS.md ("execvp ... Operation not permitted"). The folder itself never goes in
 * the profile, as `":project_roots"={"."="read"}`, so its quotes and spaces can't break it. At
 * This document there is no `:project_roots` and the folder is empty.
 *
 * A repo's or the person's `AGENTS.md` still reaches the model (`-c project_doc_max_bytes=0`
 * should turn that off, but wasn't tried), and it is only words in the prompt.
 */
export function codexArgs(request: AgentRequest, tools: McpEndpoint, setup: CodexSetup): string[] {
  const readable = request.scope === 'document' ? [] : ['":project_roots"={"."="read"}'];
  const programs = setup.programFolders.map((folder) => `${JSON.stringify(folder)}="read"`);
  const filesystem = `{${['":minimal"="read"', ...readable, '":slash_tmp"="deny"', ...programs].join(',')}}`;
  return [
    'exec',
    '--json',
    '--strict-config',
    '-C',
    setup.folder,
    '--skip-git-repo-check',
    '--ignore-user-config',
    '--ignore-rules',
    '-c',
    'approval_policy="never"',
    '-c',
    'default_permissions="redlines"',
    '-c',
    `permissions.redlines.filesystem=${filesystem}`,
    '-c',
    `mcp_servers.redlines.command=${JSON.stringify(tools.command)}`,
    '-c',
    `mcp_servers.redlines.args=${JSON.stringify(tools.args)}`,
    // Without this every toolbox call fails: "requires approval, but approval policy is never".
    '-c',
    'mcp_servers.redlines.default_tools_approval_mode="approve"',
    '-c',
    `developer_instructions=${JSON.stringify(request.systemPrompt)}`,
    ...DISABLED_FEATURES.flatMap((feature) => ['--disable', feature]),
    '-c',
    'web_search="disabled"',
    request.prompt,
  ];
}

/** What a stream remembers between lines. */
export interface CodexState {
  /** The last `agent_message` that had words in it. */
  lastMessage?: string;
  /** The last top-level error, for a stream that ends without saying why. */
  lastError?: string;
}

export function newCodexState(): CodexState {
  return {};
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** One quiet line for a failure message from Codex. */
function failureFrom(message: string): string {
  if (/\b401\b|unauthorized|not logged in|bearer/i.test(message)) {
    return `Codex isn't signed in. ${SIGNED_OUT_HELP}`;
  }
  if (/usage limit|rate.?limit|\b429\b/i.test(message)) {
    return 'Codex has hit its usage limit. Try again later.';
  }
  if (/network|dns|connect|timed? ?out|error sending request|offline/i.test(message)) {
    return "Codex can't reach the network.";
  }
  const first = message.trim().split('\n')[0] ?? '';
  return first ? `Codex stopped: ${clip(first, 200)}` : 'Codex ended without an answer.';
}

const TOOLBOX_STATUS: Record<string, string | null> = {
  view: 'Reading the document',
  read_thread: 'Reading the thread',
  str_replace: 'Editing',
  comment: 'Commenting',
  reply: 'Replying',
  // The agent's own status line arrives by the relay, not from here.
  status: null,
};

/**
 * Turns one line of `codex exec --json` into an event, or null for what isn't news. Unknown
 * events and lines that aren't JSON are ignored, and never throw.
 *
 * Don't count on `command_execution` for status lines: the newer models run most commands through
 * a built-in tool that makes no event, so the lines come from toolbox calls and otherwise from
 * "Thinking…".
 */
export function parseCodexLine(line: string, state: CodexState): AgentEvent | null {
  let event: unknown;
  try {
    event = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isRecord(event)) return null;

  switch (event.type) {
    case 'turn.started':
      return { type: 'status', text: 'Thinking…' };
    case 'turn.completed':
      // The last message can be empty (after a successful `reply`): then there is nothing to say.
      return state.lastMessage ? { type: 'done', finalText: state.lastMessage } : { type: 'done' };
    case 'turn.failed': {
      const error = event.error;
      const message = isRecord(error) && typeof error.message === 'string' ? error.message : '';
      return { type: 'error', message: failureFrom(message || state.lastError || '') };
    }
    case 'error':
      // "Reconnecting... 2/5" is a retry, not the end: turn.failed says when it is.
      if (typeof event.message === 'string') state.lastError = event.message;
      return null;
    case 'item.started':
    case 'item.completed': {
      const item = event.item;
      if (!isRecord(item)) return null;
      const started = event.type === 'item.started';
      switch (item.type) {
        case 'agent_message':
          if (!started && typeof item.text === 'string' && item.text.trim()) {
            state.lastMessage = item.text.trim();
          }
          return null;
        case 'mcp_tool_call': {
          if (!started || typeof item.tool !== 'string') return null;
          const text = item.tool in TOOLBOX_STATUS ? TOOLBOX_STATUS[item.tool] : item.tool;
          return text ? { type: 'status', text: clip(text.replace(/_/g, ' '), 40) } : null;
        }
        case 'collab_tool_call':
          return started ? { type: 'status', text: 'Asking a helper' } : null;
        case 'command_execution':
          return started ? { type: 'status', text: 'Running a command' } : null;
        // An item of type "error" is a warning ("ignoring an unrecognized setting"), not a failure.
        default:
          return null;
      }
    }
    default:
      return null;
  }
}

function versionOf(output: string): string | undefined {
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

function dirName(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut <= 0 ? '/' : path.slice(0, cut);
}

export interface CodexProviderOptions {
  /** Makes a fresh, empty folder to run in when the agent may read none. Defaults to `mktemp -d`. */
  emptyFolder?: () => Promise<string>;
  /** Resolves symlinks in the program's path. Defaults to `realpath`. */
  realPath?: (path: string) => Promise<string>;
}

export function createCodexProvider(
  processes: HostProcesses,
  options: CodexProviderOptions = {},
): AgentProvider {
  const emptyFolder =
    options.emptyFolder ??
    (async () =>
      (await processes.exec('/usr/bin/mktemp', ['-d', '-t', 'redlines-run'])).stdout.trim());
  const realPath =
    options.realPath ??
    (async (path: string) => {
      const found = await processes.exec('/bin/realpath', [path]);
      return found.code === 0 && found.stdout.trim() ? found.stdout.trim() : path;
    });

  return {
    id: 'codex',
    name: 'Codex',
    readLimit: 'folder',

    async detect(): Promise<AgentState> {
      const program = await processes.which('codex');
      if (program === null) {
        return {
          found: false,
          help: "Codex isn't installed on this Mac. Install it (brew install --cask codex).",
        };
      }
      const version = versionOf((await processes.exec(program, ['--version'])).stdout);
      if (version !== undefined && !atLeast(version, MIN_VERSION)) {
        return {
          found: true,
          signedIn: false,
          version,
          help: `Codex ${version} is too old. Update it to ${MIN_VERSION} or newer.`,
        };
      }
      // `login status` prints "Logged in using ChatGPT" and exits 0, or "Not logged in" and exits 1.
      const signedIn = (await processes.exec(program, ['login', 'status'])).code === 0;
      return {
        found: true,
        signedIn,
        ...(version === undefined ? {} : { version }),
        ...(signedIn ? {} : { help: SIGNED_OUT_HELP }),
      };
    },

    async *run(request, tools, signal): AsyncGenerator<AgentEvent> {
      const program = await processes.which('codex');
      if (program === null) {
        yield { type: 'error', message: "Codex isn't installed on this Mac." };
        return;
      }
      let handle: ProcessHandle;
      try {
        // A document with no folder is run like This document: nothing but an empty folder.
        const own = request.scope === 'document' || !request.folder;
        const folder = own || !request.folder ? await emptyFolder() : request.folder;
        const asked: AgentRequest = own ? { ...request, scope: 'document' } : request;
        const real = await realPath(program).catch(() => program);
        const programFolders = [...new Set([dirName(program), dirName(real)])];
        handle = await processes.start({
          program,
          args: codexArgs(asked, tools, { folder, programFolders }),
          cwd: folder,
          log: {
            agent: 'codex',
            thread: request.thread,
            ...(request.documentPath === undefined ? {} : { document: request.documentPath }),
          },
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        yield { type: 'error', message: `Codex couldn't be started: ${clip(reason, 200)}` };
        return;
      }
      yield* follow(handle, signal);
    },
  };
}

/** Reads a running program's lines until it says it is done, fails or stops. */
async function* follow(handle: ProcessHandle, signal: AbortSignal): AsyncGenerator<AgentEvent> {
  let over = false;
  void handle.ended.then(() => (over = true));
  const stop = () => handle.stop();
  if (signal.aborted) stop();
  else signal.addEventListener('abort', stop, { once: true });

  const state = newCodexState();
  try {
    for await (const line of handle.lines) {
      const event = parseCodexLine(line, state);
      if (event === null) continue;
      yield event;
      if (event.type !== 'status') return;
    }
    // The stream ended with no turn.completed or turn.failed: truncated, or the program was killed.
    const end = await handle.ended;
    if (signal.aborted) {
      yield { type: 'error', message: 'Stopped.' };
    } else if (state.lastError !== undefined) {
      yield { type: 'error', message: failureFrom(state.lastError) };
    } else {
      const last = end.stderr
        .split('\n')
        .map((text) => text.trim())
        .filter((text) => text && !text.startsWith('Reading additional input'))
        .at(-1);
      yield {
        type: 'error',
        message: last ? `Codex stopped: ${clip(last, 200)}` : 'Codex ended without an answer.',
      };
    }
  } finally {
    signal.removeEventListener('abort', stop);
    if (!over) handle.stop();
  }
}

/**
 * Providers are built by the host from its `processes` capability (`createCodexProvider`), so
 * activating the plugin adds nothing to the editor.
 */
export const plugin: Plugin = definePlugin<Plugin>({
  manifest: {
    id: 'redlines.agent-codex',
    name: 'Codex',
    version: '0.0.0',
    needs: ['agents'],
  },
  activate() {
    return () => {};
  },
});
