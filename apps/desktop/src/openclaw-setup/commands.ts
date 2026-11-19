// What only the OpenClaw setup window asks of the app's Rust side: this Mac's Tailscale, whether a
// Gateway answers at an address, this Mac's name, and adding a connection or giving it its token.
// Preferences never imports this file, and its capability grants none of these commands.

import type {
  GatewayProbe,
  NewOpenClawConnection,
  OpenClawConnection,
  TailscaleStatus,
} from '@redlines/agents';
import { invoke } from '@tauri-apps/api/core';

/**
 * This Mac's Tailscale (agents/tailscale.rs): looking changes nothing; the app and the download
 * page only open.
 */
export const tailscale = {
  status: () => invoke<TailscaleStatus>('tailscale_status'),
  openApp: () => invoke<void>('tailscale_open_app'),
  download: () => invoke<void>('tailscale_download'),
};

/**
 * Whether an OpenClaw Gateway answers at an address, which the person typed or picked (agents/
 * gateway.rs): the app opens its WebSocket, reads its greeting and closes, and sends nothing.
 * `suffix` completes a bare computer name with the Tailscale network's name.
 */
export const gateway = {
  probe: (address: string, suffix: string | null) =>
    invoke<GatewayProbe>('gateway_probe', { address, suffix }),
};

/**
 * Adding a connection is a question of the system's, which this window can neither draw nor
 * answer, and fails with a line to show when the person says no. A token the person typed goes to
 * files only this user can read, and is never shown or returned.
 */
export const openClawSetup = {
  add: (connection: NewOpenClawConnection) =>
    invoke<OpenClawConnection[]>('openclaw_connection_add', { new: connection }),
  useToken: (handle: string, token: string) =>
    invoke<OpenClawConnection[]>('openclaw_use_token', { handle, token }),
  /** This Mac's name as its owner knows it. */
  thisMac: () => invoke<string>('openclaw_this_mac'),
};
