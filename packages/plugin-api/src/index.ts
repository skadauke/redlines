// Provisional: a first sketch of the plugin API. It will change while the first-party plugins are
// written against it, and opens to other plugins once it has carried them without changes. See
// docs/design.md §4.1.

/**
 * Something a plugin needs beyond its own code. The user can see what a plugin needs, and a
 * plugin gets only what its manifest lists.
 *
 * - `document:read`: read the open document, marks and comments included.
 * - `document:edit`: change the open document.
 * - `files`: read and write other files, through the host.
 * - `network`: make network requests.
 * - `clipboard`: read and write the clipboard.
 * - `print`: print, and export to PDF.
 * - `agents`: work with AI agents.
 * - `identity`: know who the user is.
 */
export type Capability =
  | 'document:read'
  | 'document:edit'
  | 'files'
  | 'network'
  | 'clipboard'
  | 'print'
  | 'agents'
  | 'identity';

/** Describes a plugin: what it is, what it needs and what it adds. */
export interface PluginManifest {
  /** A stable, unique id, such as `redlines.tables`. */
  id: string;
  /** The name shown in settings. */
  name: string;
  /** A semver version. */
  version: string;
  /** The capabilities the plugin asks for. */
  needs?: Capability[];
  /** What the plugin adds to the app. */
  contributes?: {
    commands?: CommandContribution[];
    settings?: SettingContribution[];
    views?: ViewContribution[];
  };
}

/** A plugin: its manifest, and the code that puts it into the app. */
export interface Plugin {
  manifest: PluginManifest;
  /** Starts the plugin. Returns a function that takes it out again. */
  activate(context: PluginContext): () => void;
}

/** What a plugin is given when it starts. */
export interface PluginContext {
  /** `@redlines/editor`'s `Editor`; typed loosely because this package has no dependencies. */
  editor: unknown;
  host: Host;
  /** Who is using the app. */
  author: { handle: string; name: string };
  /** Shows a short message that does not interrupt. */
  notice(message: string): void;
}

/** A command, for menus, the command palette and keyboard shortcuts. */
export interface CommandContribution {
  /** Unique within the plugin, such as `insert-table`. */
  id: string;
  /** The label in menus and the palette. */
  title: string;
  /** A default shortcut in CodeMirror's notation, such as `Mod-Alt-t`. */
  shortcut?: string;
}

/** A setting on the plugin's settings page. */
export interface SettingContribution {
  /** The page of the settings window it appears on. */
  pane: 'general' | 'appearance' | 'editor' | 'agents';
  id: string;
  title: string;
  description?: string;
  /** The value until the user changes it. Its type is the setting's type. */
  default: boolean | number | string;
}

/** A view the plugin adds around the document. */
export interface ViewContribution {
  id: string;
  title: string;
  location: 'sidebar' | 'panel' | 'status-bar';
}

/**
 * What the app around the editor provides: the desktop app, the React component inside a host
 * such as Syrus, or the VS Code extension. Every capability is optional, so a plugin checks for
 * the ones it uses and degrades without them.
 */
export interface Host {
  files?: HostFiles;
  clipboard?: HostClipboard;
  print?: HostPrint;
  agents?: HostAgents;
  identity?: HostIdentity;
  processes?: HostProcesses;
  relay?: HostRelay;
}

/** Files next to the document, such as images and the other files in its folder. */
export interface HostFiles {
  /** Reads a file as UTF-8 text. */
  read(path: string): Promise<string>;
  /** Writes UTF-8 text to a file, replacing it. */
  write(path: string, text: string): Promise<void>;
  /** The entries of a folder. */
  list(folder: string): Promise<FileEntry[]>;
  /** Whether a file or folder exists. */
  exists(path: string): Promise<boolean>;
  /** The folder an agent may work in for a document. */
  projectRoot(documentPath: string): Promise<ProjectRoot>;
}

export interface FileEntry {
  name: string;
  path: string;
  isDir: boolean;
}

export interface ProjectRoot {
  folder: string;
  isRepo: boolean;
  /** The home folder or the disk's root: an agent gets only the document. */
  tooBroad: boolean;
}

/** The system clipboard, with every format on it. */
export interface HostClipboard {
  /** The clipboard's contents by media type, such as `text/plain` and `text/html`. */
  read(): Promise<Record<string, string>>;
  /** Replaces the clipboard's contents with these formats, keyed by media type. */
  write(formats: Record<string, string>): Promise<void>;
}

/** Printing and PDF export. */
export interface HostPrint {
  /** Opens the print dialog for an HTML document. */
  print(html: string): Promise<void>;
  /** Renders an HTML document to PDF bytes. */
  pdf(html: string): Promise<Uint8Array>;
}

/** What the host found out about an agent's program on this machine. */
export type AgentState =
  | { found: false; help: string }
  | { found: true; signedIn: boolean; version?: string; help?: string };

/** How much of the machine an agent is told about: the document, its folder, or anything. */
export type AgentScope = 'document' | 'folder' | 'everything';

/** One request to an agent. */
export interface AgentRequest {
  /** The person's words. */
  prompt: string;
  /** `agentPrompt()` from packages/agent-tools. */
  systemPrompt: string;
  thread: string;
  documentPath?: string;
  folder?: string;
  scope: AgentScope;
  author: { handle: string; name: string; for: string };
}

/** What happens during a run. */
export type AgentEvent =
  /** From the event stream; the status tool goes straight to the thread. */
  | { type: 'status'; text: string }
  /** `finalText` is the last message, for an agent that never called reply. */
  | { type: 'done'; finalText?: string }
  | { type: 'error'; message: string };

/** How an agent's program reaches Redlines' tools: a command that speaks MCP. */
export interface McpEndpoint {
  command: string;
  args: string[];
}

/** One agent, such as Claude or Codex: how to find it and how to run it. */
export interface AgentProvider {
  /** `claude`, `codex`. */
  id: string;
  /** `Claude`, shown in the thread. */
  name: string;
  /** Whether reads can be held to the folder. */
  readLimit: 'folder' | 'machine';
  detect(): Promise<AgentState>;
  run(request: AgentRequest, tools: McpEndpoint, signal: AbortSignal): AsyncIterable<AgentEvent>;
}

/** An agent as the host lists it. */
export interface AgentInfo {
  id: string;
  name: string;
  readLimit: 'folder' | 'machine';
  state: AgentState;
}

/** What an agent's MCP messages are answered by: a line in, a line out, or null for a notification. */
export type ToolLines = (line: string) => Promise<string | null>;

/** The AI agents the user has set up, such as Claude through Claude Code. */
export interface HostAgents {
  list(): Promise<AgentInfo[]>;
  /** Runs an agent and streams what happens until it is done. */
  run(
    agent: string,
    request: AgentRequest,
    tools: ToolLines,
    signal: AbortSignal,
  ): AsyncIterable<AgentEvent>;
}

/** A program to start. */
export interface ProcessSpec {
  /** A path that `which` returned. */
  program: string;
  args: string[];
  cwd?: string;
  /** Written as the first lines of the run's log. */
  log: { agent: string; thread: string; document?: string };
}

/** A program that is running. */
export interface ProcessHandle {
  /** Its stdout, line by line. */
  lines: AsyncIterable<string>;
  /** Resolves when the process ends, with its code and the end of its stderr. */
  ended: Promise<{ code: number | null; stderr: string }>;
  /** SIGINT, then SIGTERM, then SIGKILL, to the whole process group. */
  stop(): void;
  /** Where its log is. */
  logPath: string;
}

/** Programs on the user's machine. */
export interface HostProcesses {
  which(program: string): Promise<string | null>;
  exec(program: string, args: string[]): Promise<{ code: number | null; stdout: string }>;
  start(spec: ProcessSpec): Promise<ProcessHandle>;
}

/** A way for a program that was started to call back into Redlines. */
export interface HostRelay {
  open(answer: ToolLines): Promise<{ endpoint: McpEndpoint; close(): void }>;
}

/** Who is using the editor, for authorship of changes and comments. */
export interface HostIdentity {
  current(): Promise<{ handle: string; name: string; email?: string }>;
}

/**
 * Declares a plugin. It returns the plugin unchanged; plugins call it so that, once the plugin
 * interface settles, it can check their shape without changing how they are written.
 */
export function definePlugin<T>(plugin: T): T {
  return plugin;
}
