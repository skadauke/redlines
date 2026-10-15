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
}

/** Files next to the document, such as images and the other files in its folder. */
export interface HostFiles {
  /** Reads a file as UTF-8 text. */
  read(path: string): Promise<string>;
  /** Writes UTF-8 text to a file, replacing it. */
  write(path: string, text: string): Promise<void>;
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

/** The AI agents the user has set up, such as Claude through Claude Code. */
export interface HostAgents {
  list(): Promise<{ id: string; name: string }[]>;
  /** Sends a prompt to an agent and resolves with its answer. */
  ask(agent: string, prompt: string): Promise<string>;
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
