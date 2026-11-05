// The Agent Client Protocol provider (design: Routes to the agents): any agent that speaks the
// protocol, from a name and a command the person added in Preferences ▸ Agents. The host keeps
// that list and starts an agent by its id, so the page never names a program; this speaks
// JSON-RPC to it over its stdin and stdout, one message a line. `initialize`, then `session/new`
// in the run's folder with the toolbox as its one MCP server, then `session/prompt`; its
// `session/update`s become status lines, `end_turn` ends the run, and Stop says `session/cancel`.
//
// The host checks every message this sends, whole (apps/desktop/src-tauri/src/agents/acp_gate.rs),
// so the messages are built in one place below, and `provider-lines.node.test.ts` in apps/desktop
// holds them, and the permission rule, to the copies the Rust side is tested against.
//
// An agent asks before it acts, as its own settings say (`session/request_permission`). Redlines
// allows the six toolbox tools and reads inside the run's folder, and refuses everything else. An
// agent may still act on its own without asking, as its own settings allow: that is the agent's
// trust, which the person gave it by adding it, and why this provider's reads are the machine's.

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
import { TOOLBOX_STATUS, isRecord, reasonOf, runAgent } from '@redlines/agent-process';

/** An agent the person added: what the host's list says of it. */
export interface AcpConfig {
  /** What its handles start with, such as `gemini`. */
  id: string;
  /** What people see, such as `Gemini`. */
  name: string;
  /** The program the host starts, for showing. */
  command: string;
  args: string[];
}

/** The version of the protocol this speaks. */
export const PROTOCOL_VERSION = 1;

/** The ids of this side's requests, one of each per run. */
const INITIALIZE = 0;
const NEW_SESSION = 1;
const PROMPT = 2;

/** JSON-RPC's "Method not found", for what an agent asks that this doesn't do. */
const METHOD_NOT_FOUND = -32601;
/** The protocol's "Authentication required". */
const AUTH_REQUIRED = -32000;

/** No terminal and no files: the agent uses its own, and asks before it does. */
export function initializeMessage(): object {
  return {
    jsonrpc: '2.0',
    id: INITIALIZE,
    method: 'initialize',
    params: {
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
    },
  };
}

/** A session in `folder`, whose one MCP server is the toolbox. */
export function newSessionMessage(folder: string, tools: McpEndpoint): object {
  return {
    jsonrpc: '2.0',
    id: NEW_SESSION,
    method: 'session/new',
    params: {
      cwd: folder,
      mcpServers: [{ name: 'redlines', command: tools.command, args: tools.args, env: [] }],
    },
  };
}

/** The protocol has no system prompt: it goes first, as text, and the person's words after it. */
export function promptMessage(sessionId: string, request: AgentRequest): object {
  return {
    jsonrpc: '2.0',
    id: PROMPT,
    method: 'session/prompt',
    params: {
      sessionId,
      prompt: [
        { type: 'text', text: request.systemPrompt },
        { type: 'text', text: request.prompt },
      ],
    },
  };
}

export function cancelMessage(sessionId: string): object {
  return { jsonrpc: '2.0', method: 'session/cancel', params: { sessionId } };
}

const CANCELLED = { outcome: { outcome: 'cancelled' } } as const;

/** Whether `path` is inside `folder` by its name: absolute, never climbing out, and under it. */
function inside(path: string, folder: string): boolean {
  if (!path.startsWith('/') || path.split('/').includes('..')) return false;
  return path === folder || path.startsWith(folder.endsWith('/') ? folder : `${folder}/`);
}

/** The toolbox tool a call is, by what the agent, not the model, names it, or undefined. */
function toolboxToolNamed(call: Record<string, unknown>, options: unknown[]): string | undefined {
  for (const text of [call['title'], call['name']]) {
    const tool = typeof text === 'string' ? text.replace(/^mcp__redlines__/, '') : '';
    if (tool !== text && TOOLBOX_STATUS.has(tool)) return tool;
  }
  // As Gemini offers it: "Always Allow" for the toolbox's server and for the tool.
  const offered = new Set(
    options.flatMap((option) =>
      isRecord(option) && typeof option['name'] === 'string' ? [option['name']] : [],
    ),
  );
  if (!offered.has('Always Allow redlines')) return undefined;
  return [...TOOLBOX_STATUS.keys()].find((tool) => offered.has(`Always Allow ${tool}`));
}

/** A tool call's kind, `other` when it says none, or null when it isn't a word. */
function kindOf(call: Record<string, unknown>): string | null {
  const kind = call['kind'];
  if (kind === undefined || kind === null) return 'other';
  return typeof kind === 'string' ? kind : null;
}

/** The paths a tool call names, or null when they aren't a list of paths. */
function locationsOf(call: Record<string, unknown>): string[] | null {
  const locations = call['locations'];
  if (locations === undefined || locations === null) return [];
  if (!Array.isArray(locations)) return null;
  const paths = locations.map((location) =>
    isRecord(location) && typeof location['path'] === 'string' ? location['path'] : null,
  );
  return paths.every((path) => path !== null) ? paths : null;
}

/** Whether a permission request is for a toolbox tool, or for reads inside `folder`. */
function allows(params: Record<string, unknown>, folder: string): boolean {
  const call = params['toolCall'];
  if (!isRecord(call)) return false;
  const options = Array.isArray(params['options']) ? params['options'] : [];
  const kind = kindOf(call);
  const paths = locationsOf(call);
  if (paths === null) return false;
  const toolbox =
    kind === 'other' && paths.length === 0 && toolboxToolNamed(call, options) !== undefined;
  const read =
    (kind === 'read' || kind === 'search') &&
    paths.length > 0 &&
    paths.every((path) => inside(path, folder));
  return toolbox || read;
}

/**
 * The answer to `session/request_permission`: `allow_once` for a toolbox tool or a read inside
 * `folder`, and otherwise `reject_once`, or cancelled when the agent offers neither. Never
 * `allow_always`, which an agent may keep. The host allows no other answer (acp_gate.rs).
 */
export function answerPermission(params: unknown, folder: string, mayAllow = true): object {
  return decide(params, folder, mayAllow).answer;
}

function decide(
  params: unknown,
  folder: string,
  mayAllow: boolean,
): { allowed: boolean; answer: object } {
  if (!isRecord(params)) return { allowed: false, answer: CANCELLED };
  const options = Array.isArray(params['options']) ? params['options'].filter(isRecord) : [];
  const offered = (kind: string) =>
    options.find((option) => option['kind'] === kind && typeof option['optionId'] === 'string');
  const allowed = mayAllow && allows(params, folder) ? offered('allow_once') : undefined;
  const chosen = allowed ?? offered('reject_once');
  return {
    allowed: allowed !== undefined,
    answer: chosen ? { outcome: { outcome: 'selected', optionId: chosen['optionId'] } } : CANCELLED,
  };
}

/** What the line says of a request it refused, by what kind of thing was asked. */
function refusedStatus(params: unknown): string {
  const call = isRecord(params) && isRecord(params['toolCall']) ? params['toolCall'] : {};
  switch (kindOf(call)) {
    case 'execute':
      return 'Refused to run a command';
    case 'edit':
    case 'delete':
    case 'move':
      return 'Refused to change a file';
    case 'read':
    case 'search':
      return 'Refused a read outside the folder';
    case 'fetch':
      return 'Refused to fetch from the web';
    default:
      return 'Refused a request';
  }
}

/** A status as the live line takes it: one line, at most 40 characters. */
function statusText(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length <= 40 ? line : `${line.slice(0, 39).trimEnd()}…`;
}

const KIND_STATUS: Record<string, string> = {
  read: 'Reading',
  search: 'Searching',
  edit: 'Editing a file',
  delete: 'Deleting a file',
  move: 'Moving a file',
  execute: 'Running a command',
  fetch: 'Fetching from the web',
  think: 'Thinking…',
};

/**
 * What the line says of a tool call: the toolbox's own words for its tools, else the agent's title
 * when it is words rather than JSON, else what kind of thing it does. The status tool says
 * nothing: its text arrives by the relay.
 */
function toolStatus(call: Record<string, unknown>): string | null {
  // Gemini's ids are the tool's name and the time: `view-1730000000000`.
  const id = typeof call['toolCallId'] === 'string' ? call['toolCallId'] : '';
  const fromId = /^(?:redlines__)?([a-z_]+)-\d+$/.exec(id)?.[1];
  const tool =
    toolboxToolNamed(call, []) ?? (fromId && TOOLBOX_STATUS.has(fromId) ? fromId : undefined);
  if (tool !== undefined) return TOOLBOX_STATUS.get(tool) ?? null;
  const title = typeof call['title'] === 'string' ? call['title'].trim() : '';
  if (title && !/^[[{]/.test(title)) return statusText(title);
  return KIND_STATUS[kindOf(call) ?? ''] ?? 'Working…';
}

/** What a run remembers between lines. */
export interface AcpState {
  name: string;
  /** The folder the run is in, which reads are held to. */
  folder: string;
  request: AgentRequest;
  tools: McpEndpoint;
  /**
   * Sends a message. If the host refuses it, `instead` goes in its place; a refusal of that, or of
   * a message with nothing in its place, ends the run with `failure`.
   */
  send(message: object, instead?: object): void;
  sessionId?: string;
  /** The agent's words since its last tool call, for an agent that never called reply. */
  message: string;
  /** Why the run is failing, once something has said so. */
  failure?: string;
}

function firstLine(text: unknown): string {
  return typeof text === 'string' ? (text.trim().split('\n')[0] ?? '') : '';
}

function errorMessage(error: unknown): string {
  return isRecord(error) ? firstLine(error['message']) : '';
}

function isAuthRequired(error: unknown): boolean {
  return (
    isRecord(error) &&
    (error['code'] === AUTH_REQUIRED || /auth/i.test(firstLine(error['message'])))
  );
}

/** An answer to one of this side's requests. */
function fromAnswer(message: Record<string, unknown>, state: AcpState): AgentEvent | null {
  const { name } = state;
  const error = message['error'];
  const result = isRecord(message['result']) ? message['result'] : {};
  switch (message['id']) {
    case INITIALIZE:
      if (error !== undefined) {
        return { type: 'error', message: `${name} couldn’t start: ${errorMessage(error)}` };
      }
      if (result['protocolVersion'] !== PROTOCOL_VERSION) {
        return {
          type: 'error',
          message: `${name} speaks a version of the Agent Client Protocol that Redlines doesn’t.`,
        };
      }
      state.send(newSessionMessage(state.folder, state.tools));
      return null;
    case NEW_SESSION: {
      if (isAuthRequired(error)) {
        return {
          type: 'error',
          message: `${name} isn’t signed in. Sign in with its own command, then try again.`,
        };
      }
      const sessionId = result['sessionId'];
      if (error !== undefined || typeof sessionId !== 'string') {
        const why = errorMessage(error);
        return {
          type: 'error',
          message: why
            ? `${name} couldn’t open a session: ${why}`
            : `${name} couldn’t open a session.`,
        };
      }
      state.sessionId = sessionId;
      state.send(promptMessage(sessionId, state.request));
      // Early news, because the model's first move can be seconds away.
      return { type: 'status', text: 'Thinking…' };
    }
    case PROMPT: {
      if (error !== undefined) {
        const why = errorMessage(error);
        return { type: 'error', message: why ? `${name} stopped: ${why}` : `${name} stopped.` };
      }
      switch (result['stopReason']) {
        case 'end_turn': {
          const finalText = state.message.trim();
          return finalText ? { type: 'done', finalText } : { type: 'done' };
        }
        case 'cancelled':
          return { type: 'error', message: 'Stopped.' };
        case 'max_tokens':
          return { type: 'error', message: `${name} stopped: it ran out of room.` };
        case 'max_turn_requests':
          return { type: 'error', message: `${name} stopped: it took too many turns.` };
        case 'refusal':
          return { type: 'error', message: `${name} refused.` };
        default:
          return { type: 'error', message: `${name} stopped.` };
      }
    }
    default:
      return null;
  }
}

/** A request of the agent's: a permission is answered by the rule, anything else is not done. */
function fromRequest(
  id: unknown,
  method: string,
  params: unknown,
  state: AcpState,
): AgentEvent | null {
  if (typeof id !== 'string' && typeof id !== 'number') return null;
  if (method !== 'session/request_permission') {
    state.send({
      jsonrpc: '2.0',
      id,
      error: { code: METHOD_NOT_FOUND, message: 'Method not found' },
    });
    return null;
  }
  const ours = isRecord(params) && params['sessionId'] === state.sessionId;
  const { allowed, answer } = decide(params, state.folder, ours);
  // The host holds a read to the folder as it really is, through links: where it won't allow what
  // this would, the agent is refused rather than left waiting.
  const refusal = decide(params, state.folder, false).answer;
  state.send(
    { jsonrpc: '2.0', id, result: answer },
    allowed ? { jsonrpc: '2.0', id, result: refusal } : undefined,
  );
  return allowed ? null : { type: 'status', text: refusedStatus(params) };
}

/** A `session/update`: tool calls become status lines, and the agent's words are kept. */
function fromUpdate(params: unknown, state: AcpState): AgentEvent | null {
  if (!isRecord(params) || !isRecord(params['update'])) return null;
  const update = params['update'];
  switch (update['sessionUpdate']) {
    case 'agent_message_chunk': {
      const content = update['content'];
      if (isRecord(content) && content['type'] === 'text' && typeof content['text'] === 'string') {
        state.message += content['text'];
      }
      return null;
    }
    case 'tool_call': {
      // Only the words after the last tool call can be the answer.
      state.message = '';
      const text = toolStatus(update);
      return text ? { type: 'status', text } : null;
    }
    default:
      return null;
  }
}

/**
 * Takes one line from the agent: answers what it asks, sends the next message when an answer
 * comes, and gives an event, or null for what isn't news. Lines that aren't JSON-RPC are ignored,
 * and never throw.
 */
export function parseAcpLine(line: string, state: AcpState): AgentEvent | null {
  let message: unknown;
  try {
    message = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isRecord(message)) return null;
  const method = message['method'];
  if (typeof method === 'string') {
    if (!('id' in message)) {
      return method === 'session/update' ? fromUpdate(message['params'], state) : null;
    }
    return fromRequest(message['id'], method, message['params'], state);
  }
  return fromAnswer(message, state);
}

export function createAcpProvider(
  processes: HostProcesses,
  config: AcpConfig,
  options: FolderOptions = {},
): AgentProvider {
  const { id, name } = config;
  const cantRunHere = `${name} can’t run here: agents run in the Redlines app.`;
  return {
    id,
    name,
    readLimit: 'machine',

    // The handshake at each run is what shows an agent works; there is no status command to ask.
    detect() {
      return Promise.resolve(
        processes.startAcp ? { found: true, signedIn: true } : { found: false, help: cantRunHere },
      );
    },

    run(request, tools, signal) {
      const startAcp = processes.startAcp?.bind(processes);
      const state: AcpState = { name, folder: '', request, tools, message: '', send: () => {} };
      return runAgent<AcpState>(
        processes,
        {
          id,
          name,
          async start({ request: asked, folder, log }) {
            if (!startAcp) throw new Error('agents run in the Redlines app');
            const handle = await startAcp({ agent: id, cwd: folder, log });
            state.folder = folder;
            state.request = asked;
            state.send = (message, instead) => {
              handle.send(JSON.stringify(message)).catch((error: unknown) => {
                if (instead !== undefined) return state.send(instead);
                state.failure ??= `${name} couldn’t be reached: ${reasonOf(error)}`;
                handle.stop();
              });
            };
            state.send(initializeMessage());
            return handle;
          },
          newState: () => state,
          parse: parseAcpLine,
          failure: (state) => state.failure,
          cancel: (state) => {
            if (state.sessionId !== undefined) state.send(cancelMessage(state.sessionId));
          },
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
 * Providers are built by the host, one for each agent in its list (`createAcpProvider`), so
 * activating the plugin adds nothing to the editor.
 */
export const plugin: Plugin = definePlugin<Plugin>({
  manifest: {
    id: 'redlines.agent-acp',
    name: 'Agent Client Protocol',
    version: '0.0.0',
    needs: ['agents'],
  },
  activate() {
    return () => {};
  },
});
