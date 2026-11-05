// The Claude provider (design: Routes to the agents). It starts the person's own `claude -p`,
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

/** The oldest Claude Code tested. 2.1.201 has no `--restricted`. */
export const MIN_VERSION = '2.1.318';

export const SIGNED_OUT_HELP = 'Run `claude auth login`.';

const TOOLBOX = ['view', 'read_thread', 'str_replace', 'comment', 'reply', 'status'];

/**
 * Variables that turn off the plan sign-in or point the program elsewhere, which an app started
 * from inside a Claude Code session inherits. `CLAUDE_CODE_SIMPLE=1` is `--bare`'s: no plan.
 */
const DROP_ENV = {
  names: ['CLAUDECODE', 'CLAUDE_CODE_*', 'CLAUDE_AGENT_SDK_*', 'ANTHROPIC_BASE_URL'],
  when: 'CLAUDECODE',
};

/**
 * The whole command line, in one place, so that a correction is a one-line change.
 *
 * `--restricted` confines the file tools to the working folder whatever the person's own settings
 * allow, and ignores those settings, the project's settings and `.mcp.json`. It is NOT yet proved
 * to keep a plan sign-in (the sign-in on the Mac that tested it had expired). If it loses it, the
 * fallback is `--setting-sources user` in its place: reads are then held only while the person's
 * `permissions` in `~/.claude/settings.json` don't widen them, so the provider would report
 * `readLimit: 'machine'` for a run when `allow` holds a bare Read, Grep or Glob or
 * `additionalDirectories` isn't empty. `--settings` stays; it is redundant under `--restricted`.
 *
 * The prompt follows `-p`. A bare `Read` is never in `--allowedTools`: it would reach outside the
 * folder. At This document there are no read tools at all.
 */
export function claudeArgs(request: AgentRequest, tools: McpEndpoint): string[] {
  return [
    '-p',
    request.prompt,
    '--output-format',
    'stream-json',
    '--verbose',
    '--restricted',
    '--permission-mode',
    'dontAsk',
    '--tools',
    request.scope === 'document' ? '' : 'Read,Grep,Glob',
    '--allowedTools',
    TOOLBOX.map((tool) => `mcp__redlines__${tool}`).join(','),
    '--mcp-config',
    JSON.stringify({
      mcpServers: { redlines: { command: tools.command, args: tools.args } },
    }),
    '--strict-mcp-config',
    '--settings',
    '{"disableAllHooks":true}',
    '--append-system-prompt',
    request.systemPrompt,
  ];
}

/** What a stream remembers between lines. */
export interface ClaudeState {
  /** The reason the run is failing, once something has said so. */
  failure?: string;
  /** Whether the line just read was a retry, which doesn't end the run. */
  retry: boolean;
}

export function newClaudeState(): ClaudeState {
  return { retry: false };
}

const FAILURES = {
  authentication_failed: `Claude isn't signed in. ${SIGNED_OUT_HELP}`,
  rate_limit: 'Claude has hit its usage limit. Try again later.',
  overloaded: 'Claude is overloaded right now. Try again in a minute.',
  server_error: "Claude's service had an error. Try again in a minute.",
} as const;

function failureFor(kind: unknown): string | undefined {
  return typeof kind === 'string' && kind in FAILURES
    ? FAILURES[kind as keyof typeof FAILURES]
    : undefined;
}

/** Guesses a failure from the words of a result, for a run that didn't name one. */
function failureFromText(text: string): string {
  if (/authenticat|OAuth|not logged in|\/login|\b401\b/i.test(text))
    return FAILURES.authentication_failed;
  if (/rate.?limit|usage limit|\b429\b/i.test(text)) return FAILURES.rate_limit;
  if (/overloaded|\b529\b/i.test(text)) return FAILURES.overloaded;
  if (/server error|\b5\d\d\b/i.test(text)) return FAILURES.server_error;
  const first = text.trim().split('\n')[0] ?? '';
  return first ? `Claude stopped: ${clip(first, 200)}` : 'Claude ended without an answer.';
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function baseName(path: string): string {
  return path.split('/').filter(Boolean).at(-1) ?? path;
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

function toolStatus(name: string, input: unknown): string | null {
  const file =
    typeof input === 'object' && input !== null && 'file_path' in input
      ? String(input.file_path)
      : '';
  switch (name) {
    case 'Read':
      return file ? clip(`Reading ${baseName(file)}`, 40) : 'Reading';
    case 'Grep':
      return 'Searching';
    case 'Glob':
      return 'Looking for files';
  }
  const toolbox = /^mcp__redlines__(.+)$/.exec(name)?.[1];
  if (toolbox !== undefined) return TOOLBOX_STATUS[toolbox] ?? null;
  return 'Working…';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Turns one line of `--output-format stream-json` into an event, or null for what isn't news.
 * Unknown events and lines that aren't JSON are ignored, and never throw.
 */
export function parseClaudeLine(line: string, state: ClaudeState): AgentEvent | null {
  state.retry = false;
  let event: unknown;
  try {
    event = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isRecord(event)) return null;

  switch (event.type) {
    case 'system': {
      if (event.subtype === 'init') {
        const servers: unknown[] = Array.isArray(event.mcp_servers) ? event.mcp_servers : [];
        const toolbox = servers.find((server) => isRecord(server) && server.name === 'redlines');
        // A toolbox that can't start doesn't fail the run: Claude carries on and ends well.
        if (!isRecord(toolbox) || toolbox.status !== 'connected') {
          return {
            type: 'error',
            message: "Claude couldn't start Redlines' tools. Try again, or restart Redlines.",
          };
        }
      }
      if (event.subtype === 'api_retry') {
        const message = failureFor(event.error);
        if (message === undefined) return null;
        state.failure = message;
        state.retry = true;
        return { type: 'error', message };
      }
      return null;
    }
    case 'assistant': {
      const failure = failureFor(event.error);
      // A retry named the failure more exactly (a 529 is `overloaded` there, `server_error` here).
      if (failure !== undefined) state.failure ??= failure;
      const message = event.message;
      const content = isRecord(message) && Array.isArray(message.content) ? message.content : [];
      for (const block of content) {
        if (!isRecord(block)) continue;
        if (block.type === 'thinking') return { type: 'status', text: 'Thinking…' };
        if (block.type === 'tool_use' && typeof block.name === 'string') {
          const text = toolStatus(block.name, block.input);
          if (text !== null) return { type: 'status', text };
        }
      }
      return null;
    }
    case 'result': {
      const text = typeof event.result === 'string' ? event.result : '';
      // A failure also has subtype "success": only is_error tells.
      if (event.is_error === true) {
        return { type: 'error', message: state.failure ?? failureFromText(text) };
      }
      return text ? { type: 'done', finalText: text } : { type: 'done' };
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

export interface ClaudeProviderOptions {
  /** Makes a fresh, empty folder to run in when the agent may read none. Defaults to `mktemp -d`. */
  emptyFolder?: () => Promise<string>;
}

export function createClaudeProvider(
  processes: HostProcesses,
  options: ClaudeProviderOptions = {},
): AgentProvider {
  const emptyFolder =
    options.emptyFolder ??
    (async () =>
      (await processes.exec('/usr/bin/mktemp', ['-d', '-t', 'redlines-run'])).stdout.trim());

  return {
    id: 'claude',
    name: 'Claude',
    readLimit: 'folder',

    async detect(): Promise<AgentState> {
      const program = await processes.which('claude');
      if (program === null) {
        return {
          found: false,
          help: "Claude Code isn't installed on this Mac. Redlines runs it to work with Claude.",
        };
      }
      const version = versionOf((await processes.exec(program, ['--version'])).stdout);
      if (version !== undefined && !atLeast(version, MIN_VERSION)) {
        return {
          found: true,
          signedIn: false,
          version,
          help: `Claude Code ${version} is too old. Update it to ${MIN_VERSION} or newer.`,
        };
      }
      // `auth status` prints JSON and exits 1 when signed out; a stale token counts as signed out.
      const status = await processes.exec(program, ['auth', 'status']);
      const signedIn = status.code === 0 && !/"loggedIn"\s*:\s*false/.test(status.stdout);
      return {
        found: true,
        signedIn,
        ...(version === undefined ? {} : { version }),
        ...(signedIn ? {} : { help: SIGNED_OUT_HELP }),
      };
    },

    async *run(request, tools, signal): AsyncGenerator<AgentEvent> {
      const program = await processes.which('claude');
      if (program === null) {
        yield { type: 'error', message: "Claude Code isn't installed on this Mac." };
        return;
      }
      let handle: ProcessHandle;
      try {
        // A document with no folder is run like This document: nothing but an empty folder.
        const own = request.scope === 'document' || !request.folder;
        const folder = own || !request.folder ? await emptyFolder() : request.folder;
        const asked: AgentRequest = own ? { ...request, scope: 'document' } : request;
        handle = await processes.start({
          program,
          args: claudeArgs(asked, tools),
          cwd: folder,
          dropEnv: DROP_ENV,
          log: {
            agent: 'claude',
            thread: request.thread,
            ...(request.documentPath === undefined ? {} : { document: request.documentPath }),
          },
        });
      } catch (error) {
        yield { type: 'error', message: `Claude couldn't be started: ${reason(error)}` };
        return;
      }
      yield* follow(handle, signal);
    },
  };
}

function reason(error: unknown): string {
  return clip(error instanceof Error ? error.message : String(error), 200);
}

/** Reads a running program's lines until it says it is done, fails or stops. */
async function* follow(handle: ProcessHandle, signal: AbortSignal): AsyncGenerator<AgentEvent> {
  let over = false;
  void handle.ended.then(() => (over = true));
  const stop = () => handle.stop();
  if (signal.aborted) stop();
  else signal.addEventListener('abort', stop, { once: true });

  const state = newClaudeState();
  try {
    for await (const line of handle.lines) {
      const event = parseClaudeLine(line, state);
      // A retry may still work: remember it, and report it only if the run then fails.
      if (event === null || state.retry) continue;
      yield event;
      if (event.type === 'error') handle.stop();
      if (event.type !== 'status') return;
    }
    const end = await handle.ended;
    if (signal.aborted) {
      yield { type: 'error', message: 'Stopped.' };
    } else if (state.failure !== undefined) {
      yield { type: 'error', message: state.failure };
    } else {
      const last = end.stderr.trim().split('\n').at(-1) ?? '';
      yield {
        type: 'error',
        message: last ? `Claude stopped: ${clip(last, 200)}` : 'Claude ended without an answer.',
      };
    }
  } finally {
    signal.removeEventListener('abort', stop);
    if (!over) handle.stop();
  }
}

/**
 * Providers are built by the host from its `processes` capability (`createClaudeProvider`), so
 * activating the plugin adds nothing to the editor.
 */
export const plugin: Plugin = definePlugin<Plugin>({
  manifest: {
    id: 'redlines.agent-claude',
    name: 'Claude',
    version: '0.0.0',
    needs: ['agents'],
  },
  activate() {
    return () => {};
  },
});
