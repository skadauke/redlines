// The Codex provider (design: Routes to the agents). It starts the person's own `codex exec`,
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
import type { FolderOptions } from '@redlines/agent-process';
import { TOOLBOX_STATUS, clip, detectAgent, isRecord, runAgent } from '@redlines/agent-process';

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
 * The prompt comes last, after `--`, so a comment that starts with `-` (a Markdown bullet) is not
 * taken for a flag.
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
    '--',
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
    case 'thread.started':
      // Early news, because the model's first move can be seconds away.
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
          // Only the last message counts, and an empty one means nothing to say: narration such as
          // "I'll check that" must not become the reply.
          if (!started && typeof item.text === 'string') {
            const text = item.text.trim();
            if (text) state.lastMessage = text;
            else delete state.lastMessage;
          }
          return null;
        case 'mcp_tool_call': {
          if (!started || typeof item.tool !== 'string') return null;
          const text = TOOLBOX_STATUS.has(item.tool) ? TOOLBOX_STATUS.get(item.tool) : item.tool;
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

export interface CodexProviderOptions extends FolderOptions {
  /** Resolves symlinks in the program's path. Defaults to `realpath`. */
  realPath?: (path: string) => Promise<string>;
}

function dirName(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut <= 0 ? '/' : path.slice(0, cut);
}

export function createCodexProvider(
  processes: HostProcesses,
  options: CodexProviderOptions = {},
): AgentProvider {
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

    detect() {
      return detectAgent(processes, {
        name: 'Codex',
        binary: 'codex',
        notFoundHelp: "Codex isn't installed on this Mac. Install it (brew install --cask codex).",
        minVersion: MIN_VERSION,
        signedOutHelp: SIGNED_OUT_HELP,
        // Prints "Logged in using ChatGPT" and exits 0, or "Not logged in" and exits 1.
        statusArgs: ['login', 'status'],
        isSignedIn: (status) => status.code === 0,
      });
    },

    run(request, tools, signal) {
      return runAgent<CodexState>(
        processes,
        {
          id: 'codex',
          name: 'Codex',
          binary: 'codex',
          async args({ request: asked, folder, program }) {
            const real = await realPath(program).catch(() => program);
            const programFolders = [...new Set([dirName(program), dirName(real)])];
            return codexArgs(asked, tools, { folder, programFolders });
          },
          newState: newCodexState,
          parse: parseCodexLine,
          failure: (state) =>
            state.lastError === undefined ? undefined : failureFrom(state.lastError),
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
