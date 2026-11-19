// What Preferences and the OpenClaw setup window both ask of the app's Rust side about OpenClaw
// connections (src-tauri/src/agents/connections.rs, openclaw_nodes.rs): the list the person made,
// removing one, and the node's connection to its Gateway. The commands that only
// the setup window needs (adding a connection, Tailscale, the Gateway probe) are in
// openclaw-setup/commands.ts, so that Preferences, which never imports them, is never granted them
// (command-permissions.node.test.ts).

import type { NodeStatus, OpenClawConnection } from '@redlines/agents';
import { invoke } from '@tauri-apps/api/core';

/**
 * The OpenClaw connections the person made: their records, and a flag for each secret that is kept,
 * never a secret.
 */
export const openClawConnections = {
  list: () => invoke<OpenClawConnection[]>('openclaw_connections'),
  remove: (handle: string) =>
    invoke<OpenClawConnection[]>('openclaw_connection_remove', { handle }),
};

/**
 * The connection of an OpenClaw agent to its Gateway: started with the setup code the person
 * pasted, which goes to the app and is never kept or shown, or with the token the app kept; its
 * status is polled; stopping it leaves the agent in the list.
 */
export const openClawNode = {
  connect: (handle: string, setupCode: string | null) =>
    invoke<void>('openclaw_node_connect', { handle, setupCode }),
  status: (handle: string) => invoke<NodeStatus | null>('openclaw_node_status', { handle }),
  stop: (handle: string) => invoke<void>('openclaw_node_stop', { handle }),
};
