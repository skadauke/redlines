// An OpenClaw connection, as the window sees it (src-tauri/src/agents/connections.rs): the record the
// person made, and a flag for each secret that is kept. No secret ever reaches the window; the flags
// say only that a file exists.

export type Level = 'read' | 'suggest' | 'edit';

/** What `openclaw_connections` returns for each connection (`View` in agents/connections.rs). */
export interface OpenClawConnection {
  /** The handle it writes as: `moby-ada`. */
  handle: string;
  /** What people see and write after an @: `Moby`. */
  name: string;
  /** The computer its Gateway is on, as the person knows it. */
  computer: string;
  url: string;
  /** The OpenClaw agent the person named, if they did. */
  agent?: string;
  level: Level;
  folders: string[];
  created: number;
  last_used?: number;
  node_token: boolean;
  operator_token: boolean;
  device_key: boolean;
}

/** What the person gives to add one (`NewConnection`). The level starts at Suggest. */
export interface NewOpenClawConnection {
  handle: string;
  name: string;
  computer: string;
  url: string;
  agent?: string;
  folders: string[];
}

/** What can change in one (`Change`). */
export interface OpenClawChange {
  level?: Level;
  folders?: string[];
}

/** The levels as the segmented control shows them, least first. */
export const LEVELS: readonly { level: Level; label: string; hint: string }[] = [
  { level: 'read', label: 'Read', hint: 'Reads documents and answers questions. Changes nothing.' },
  { level: 'suggest', label: 'Suggest', hint: 'Suggests changes, as tracked changes in its name.' },
  { level: 'edit', label: 'Edit', hint: 'Reserved for a later version.' },
];

/** The handle an agent writes as: its name and the person's, `moby-ada`; at most 40 characters. */
export function authorHandle(name: string, owner: string): string {
  const slug = (text: string) =>
    text
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  const first = slug(name) || 'openclaw';
  const second = slug(owner);
  const joined = second ? `${first.slice(0, 24).replace(/-+$/, '')}-${second}` : first;
  return joined.slice(0, 40).replace(/-+$/, '');
}

/** Whether the Gateway gave this Mac everything the connection needs to work. */
export function isSetUp(connection: OpenClawConnection): boolean {
  return connection.node_token && connection.device_key;
}
