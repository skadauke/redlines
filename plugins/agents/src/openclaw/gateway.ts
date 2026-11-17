// Whether a Gateway answers at the computer the person picked, in the setup sheet's third screen
// (docs/research/openclaw-connection.md, screen 3). The app does the looking (src-tauri/src/agents/
// gateway.rs: it opens the WebSocket, reads the greeting and closes, sending nothing); this turns
// its answer into the line under the list.

import type { FailureId } from './failures.ts';

/** What `gateway_probe` returns (`Probe` in agents/gateway.rs). */
export type GatewayProbe =
  | { kind: 'found'; url: string; host: string }
  | { kind: 'not-answering'; url: string; host: string; detail: string }
  | { kind: 'no-gateway'; url: string; host: string; detail: string }
  | { kind: 'bad-address'; message: string };

export interface GatewayView {
  /** A Gateway was found: Continue is open. */
  found: boolean;
  /** The bold line, and the sentence after it. */
  title: string;
  line: string;
  /** The failure card to show, if any. */
  failure: FailureId | null;
  /** For Details: what the app saw, which a person might send to someone. */
  detail: string | null;
}

/** What the screen says of a probe of the computer called `computer`. */
export function gatewayView(probe: GatewayProbe, computer: string): GatewayView {
  switch (probe.kind) {
    case 'found':
      return {
        found: true,
        title: `Found an OpenClaw Gateway on ${computer}.`,
        line:
          'It answers over Tailscale and asks for a login, which the next steps set up. ' +
          'Redlines only said hello; nothing was sent to it.',
        failure: null,
        detail: null,
      };
    case 'not-answering':
      return {
        found: false,
        title: `${computer} isn’t answering.`,
        line: 'It may be asleep, or off your Tailscale network.',
        failure: 'computer-not-answering',
        detail: probe.detail,
      };
    case 'no-gateway':
      return {
        found: false,
        title: `No OpenClaw found on ${computer}.`,
        line: 'The computer is there, but no Gateway answered.',
        failure: 'no-gateway',
        detail: probe.detail,
      };
    case 'bad-address':
      return {
        found: false,
        title: 'That address can’t be used.',
        line: probe.message,
        failure: null,
        detail: null,
      };
  }
}
