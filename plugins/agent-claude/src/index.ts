// The Claude provider (design: Routes to the agents). It starts the person's own `claude -p`,
// hands it the toolbox over MCP and turns its JSON Lines into status lines. The flags and the
// events are in docs/superpowers/plans/2026-11-05-v0.2-spike-findings.md.

import type {
  AgentEvent,
  AgentProvider,
  AgentRequest,
  HostProcesses,
  McpEndpoint,
  Plugin,
} from '@redlines/plugin-api';
import { definePlugin } from '@redlines/plugin-api';
import type { FolderOptions, RunReach } from '@redlines/agent-process';
import {
  TOOLBOX_STATUS,
  blockedRead,
  blockedStatus,
  clip,
  detectAgent,
  homeScope,
  isRecord,
  runAgent,
} from '@redlines/agent-process';

/** The oldest Claude Code tested. 2.1.201 has no `--restricted`. */
export const MIN_VERSION = '2.1.318';

export const SIGNED_OUT_HELP = 'Run `claude auth login`.';

/** What Claude Code's own site says to run to install it. Redlines shows it and never runs it. */
export const INSTALL_COMMAND = 'curl -fsSL https://claude.ai/install.sh | bash';

const TOOLBOX = ['view', 'read_thread', 'str_replace', 'comment', 'reply', 'status'];

/**
 * The whole command line, in one place, so that a correction is a one-line change, here and in the
 * rule that lets only this line through (apps/desktop/src-tauri/src/agents/allowed.rs).
 * `provider-lines.node.test.ts` in apps/desktop fails when the two differ.
 *
 * `--restricted` confines the file tools to the working folder whatever the person's own settings
 * allow, and ignores those settings, the project's settings and `.mcp.json`. It is NOT yet proved
 * to keep a plan sign-in (the sign-in on the Mac that tested it had expired). If it loses it, the
 * fallback is `--setting-sources user` in its place: reads are then held only while the person's
 * `permissions` in `~/.claude/settings.json` don't widen them, so the provider would report
 * `readLimit: 'machine'` for a run when `allow` holds a bare Read, Grep or Glob or
 * `additionalDirectories` isn't empty. `--settings` stays; it is redundant under `--restricted`.
 *
 * The prompt comes last, after `--`, so a comment that starts with `-` (a Markdown bullet) is not
 * taken for a flag. A bare `Read` is never in `--allowedTools`: it would reach outside the
 * folder. At This document there are no read tools at all.
 *
 * At This folder and my home folder each folder of the home folder that the host lists is granted
 * by `--add-dir`, which `--restricted` confines the file tools to (a link is granted by its name,
 * and so is its target), so that what isn't listed, a hidden folder or `~/Library`, is not
 * readable at all, however the agent searches. The settings deny what is left out inside those
 * folders (`.env` files, and hidden files and folders below the home folder), which beats every
 * grant and which Grep and Glob honor. The folders' own skills and commands are turned off: a
 * home folder's folders are no one's to load them from.
 */
export function claudeArgs(request: AgentRequest, tools: McpEndpoint): string[] {
  const wide = homeScope(request);
  return [
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
    '--restricted',
    ...(wide
      ? [...wide.roots.flatMap((root) => ['--add-dir', root]), '--disable-slash-commands']
      : []),
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
    JSON.stringify(
      wide
        ? { disableAllHooks: true, permissions: { deny: claudeDenies(wide.home, wide.roots) } }
        : { disableAllHooks: true },
    ),
    '--append-system-prompt',
    request.systemPrompt,
    '--',
    request.prompt,
  ];
}

/**
 * The permission rules that refuse what This folder and my home folder leaves out: `.env` files
 * anywhere, and hidden files and folders anywhere below the home folder and below each folder a
 * link leads to outside it. `//` is a path from the root of the disk, so a base has no closing
 * slash, which would make `///Users/...`. The rules are also in `claude_denies` of the rule that
 * lets only this line through (apps/desktop/src-tauri/src/agents/allowed.rs).
 */
export function claudeDenies(home: string, roots: readonly string[] = []): string[] {
  const bases = [home.replace(/\/+$/, '')];
  for (const root of roots) {
    const base = root.replace(/\/+$/, '');
    if (!bases.some((known) => base === known || base.startsWith(`${known}/`))) bases.push(base);
  }
  return [
    'Read(//**/.env)',
    'Read(//**/.env.*)',
    'Read(//**/*.env)',
    ...bases.flatMap((base) => [`Read(/${base}/**/.*)`, `Read(/${base}/**/.*/**)`]),
  ];
}

/** What a stream remembers between lines. */
export interface ClaudeState {
  /** The reason the run is failing, once something has said so. */
  failure?: string;
  /** Whether the line just read was a retry, which doesn't end the run. */
  retry: boolean;
  /** What the run may read, to tell a refused read in it from a limit doing its work. */
  reach?: RunReach;
  /** The file the agent's reading tools were asked for, by call, to say which one was refused. */
  reads: Map<string, string>;
}

export function newClaudeState(reach?: RunReach): ClaudeState {
  return { retry: false, reads: new Map(), ...(reach === undefined ? {} : { reach }) };
}

/** The file or folder a Read, Grep or Glob call names. */
function readPath(input: unknown): string | undefined {
  if (!isRecord(input)) return undefined;
  const path = input.file_path ?? input.path;
  return typeof path === 'string' && path.startsWith('/') ? path : undefined;
}

/** What a tool result says, as one text. */
function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => (isRecord(part) && typeof part.text === 'string' ? part.text : ''))
    .join(' ');
}

const FAILURES = new Map([
  ['authentication_failed', `Claude isn't signed in. ${SIGNED_OUT_HELP}`],
  ['rate_limit', 'Claude has hit its usage limit. Try again later.'],
  ['overloaded', 'Claude is overloaded right now. Try again in a minute.'],
  ['server_error', "Claude's service had an error. Try again in a minute."],
  ['network', "Claude can't reach the network."],
]);

function failureNamed(name: string): string {
  return FAILURES.get(name) ?? 'Claude ended without an answer.';
}

/** The failure a retry or an assistant message names, or undefined if it names none. */
function failureFor(kind: unknown, status: unknown): string | undefined {
  if (typeof kind !== 'string' || kind === '') return undefined;
  if (kind === 'no_response') return failureNamed('network');
  const named = FAILURES.get(kind);
  if (named !== undefined) return named;
  // An error with no HTTP status never reached the service.
  return status === null || status === undefined ? failureNamed('network') : undefined;
}

/** Guesses a failure from the words of a result, for a run that didn't name one. */
function failureFromText(text: string): string {
  if (/authenticat|OAuth|not logged in|\/login|\b401\b/i.test(text)) {
    return failureNamed('authentication_failed');
  }
  if (/rate.?limit|usage limit|\b429\b/i.test(text)) return failureNamed('rate_limit');
  if (/overloaded|\b529\b/i.test(text)) return failureNamed('overloaded');
  if (
    /ENOTFOUND|ECONNREFUSED|ECONNRESET|fetch failed|unable to connect|no_response|network/i.test(
      text,
    )
  ) {
    return failureNamed('network');
  }
  if (/server error|\b5\d\d\b/i.test(text)) return failureNamed('server_error');
  const first = text.trim().split('\n')[0] ?? '';
  return first ? `Claude stopped: ${clip(first, 200)}` : 'Claude ended without an answer.';
}

function baseName(path: string): string {
  return path.split('/').filter(Boolean).at(-1) ?? path;
}

function toolStatus(name: string, input: unknown): string | null {
  const file = isRecord(input) && typeof input.file_path === 'string' ? input.file_path : '';
  switch (name) {
    case 'Read':
      return file ? clip(`Reading ${baseName(file)}`, 40) : 'Reading';
    case 'Grep':
      return 'Searching';
    case 'Glob':
      return 'Looking for files';
  }
  const toolbox = /^mcp__redlines__(.+)$/.exec(name)?.[1];
  if (toolbox !== undefined && TOOLBOX_STATUS.has(toolbox))
    return TOOLBOX_STATUS.get(toolbox) ?? null;
  return 'Working…';
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
        // Early news, because the model's first move can be seconds away.
        return { type: 'status', text: 'Thinking…' };
      }
      if (event.subtype === 'api_retry') {
        const message = failureFor(event.error, event.error_status);
        if (message === undefined) return null;
        state.failure = message;
        state.retry = true;
        return { type: 'error', message };
      }
      return null;
    }
    case 'user': {
      // The run is going on, so an earlier retry has recovered.
      delete state.failure;
      const message = event.message;
      const content = isRecord(message) && Array.isArray(message.content) ? message.content : [];
      for (const block of content) {
        if (!isRecord(block) || block.type !== 'tool_result' || block.is_error !== true) continue;
        const path = state.reads.get(String(block.tool_use_id));
        if (path === undefined || state.reach === undefined) continue;
        // A read inside what the agent may read that was refused is news, and says why if it can.
        const blocked = blockedRead(path, resultText(block.content), state.reach);
        if (blocked) return { type: 'status', text: blockedStatus(blocked), blocked };
      }
      return null;
    }
    case 'assistant': {
      const failure = failureFor(event.error, 'ok');
      if (failure !== undefined) {
        // A retry named the failure more exactly (a 529 is `overloaded` there, `server_error` here).
        state.failure ??= failure;
      } else if (event.error === undefined) {
        delete state.failure;
      }
      const message = event.message;
      const content = isRecord(message) && Array.isArray(message.content) ? message.content : [];
      // Each reading call is remembered by its id, so that a refusal can say which file.
      for (const block of content) {
        if (!isRecord(block) || block.type !== 'tool_use' || typeof block.id !== 'string') continue;
        const path = readPath(block.input);
        if (path !== undefined && ['Read', 'Grep', 'Glob'].includes(String(block.name))) {
          state.reads.set(block.id, path);
        }
      }
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
      const text = typeof event.result === 'string' ? event.result.trim() : '';
      // A failure also has subtype "success": is_error tells. Any other subtype is a failure too.
      if (event.is_error === true || event.subtype !== 'success') {
        return { type: 'error', message: state.failure ?? failureFromText(text) };
      }
      return text ? { type: 'done', finalText: text } : { type: 'done' };
    }
    default:
      return null;
  }
}

export type ClaudeProviderOptions = FolderOptions;

/** What the request lets the agent read, for the stream to tell a refused read from a limit. */
function reachOf(request: AgentRequest): RunReach {
  const { scope, folder, documentPath, homeRoots } = request;
  return {
    scope,
    ...(folder === undefined ? {} : { folder }),
    ...(documentPath === undefined ? {} : { documentPath }),
    ...(homeRoots === undefined ? {} : { homeRoots }),
  };
}

export function createClaudeProvider(
  processes: HostProcesses,
  options: ClaudeProviderOptions = {},
): AgentProvider {
  /** What `detect` last found, for the log of a run. */
  let version: string | undefined;

  return {
    id: 'claude',
    name: 'Claude',
    readLimit: 'folder',

    async detect() {
      const state = await detectAgent(processes, {
        name: 'Claude Code',
        binary: 'claude',
        notFoundHelp:
          "Claude Code isn't installed on this Mac. Redlines runs it to work with Claude.",
        installCommand: INSTALL_COMMAND,
        minVersion: MIN_VERSION,
        signedOutHelp: SIGNED_OUT_HELP,
        // `auth status` prints JSON and exits 1 when signed out; a stale token counts as signed out.
        statusArgs: ['auth', 'status'],
        isSignedIn: (status) => status.code === 0 && !/"loggedIn"\s*:\s*false/.test(status.stdout),
        // An older program that doesn't know `auth` fails too, but prints no JSON: that isn't it.
        isSignedOut: (status) => /"loggedIn"\s*:\s*false/.test(status.stdout),
      });
      version = state.found ? state.version : undefined;
      return state;
    },

    run(request, tools, signal) {
      return runAgent<ClaudeState>(
        processes,
        {
          id: 'claude',
          name: 'Claude',
          binary: 'claude',
          ...(version === undefined ? {} : { version }),
          args: ({ request: asked }) => Promise.resolve(claudeArgs(asked, tools)),
          newState: () => newClaudeState(reachOf(request)),
          parse: parseClaudeLine,
          held: (state) => state.retry,
          failure: (state) => state.failure,
          // Signing in again is Preferences' to offer; a usage limit or a network error isn't.
          setup: (message) => message === failureNamed('authentication_failed'),
        },
        options,
        request,
        tools,
        signal,
      );
    },
  };
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
