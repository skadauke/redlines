// Every failure of connecting an OpenClaw agent, as the gray card the setup sheet shows
// (docs/research/openclaw-connection.md, screen 8, and its table): what is said, and the one
// thing that fixes it. Failures are gray, as the app's notifications are, never red, and avoid
// "node", "bootstrap", "token" and "Gateway" except where the person has seen the word (their
// agent's reply names the Gateway). What a person might send to someone, the Gateway's own error
// text and the step, goes under Details.

export type FailureId =
  | 'tailscale-off'
  | 'tailscale-missing'
  | 'computer-not-answering'
  | 'network-blocks'
  | 'no-gateway'
  | 'code-used'
  | 'not-approved'
  | 'tools-unavailable'
  | 'agent-silent'
  | 'token-refused'
  | 'gateway-newer'
  | 'connection-failed'
  | 'not-connected';

/** What the button does, which the sheet carries out. */
export type FailureAction =
  | 'open-tailscale'
  | 'download-tailscale'
  | 'check-again'
  | 'copy-setup-prompt'
  | 'copy-code-request'
  | 'ask-again'
  | 'copy-tools-prompt'
  | 'try-again'
  | 'reconnect';

export interface Failure {
  id: FailureId;
  title: string;
  /** A sentence or two: what happened, and what it does and doesn't mean. */
  body: string;
  /** Where in the journey: "Step 1" … "Step 5", or "Later". */
  step: string;
  /** The one button. */
  action: FailureAction;
  label: string;
}

/** Who the card is about: the computer's name, and the agent's. */
export interface Subject {
  computer?: string;
  agent?: string;
}

export function failure(id: FailureId, subject: Subject = {}): Failure {
  const computer = subject.computer ?? 'The other computer';
  const agent = subject.agent ?? 'Your agent';
  switch (id) {
    case 'tailscale-off':
      return {
        id,
        title: 'Tailscale is turned off on this Mac',
        body: 'Redlines can’t see your other computers until it is on.',
        step: 'Step 1',
        action: 'open-tailscale',
        label: 'Open Tailscale',
      };
    case 'tailscale-missing':
      return {
        id,
        title: 'Tailscale is not on this Mac',
        body: 'Redlines reaches your other computer over Tailscale, a private network between your own computers. Download the app, open it and sign in with the same account as your other computer. Redlines notices by itself.',
        step: 'Step 1',
        action: 'download-tailscale',
        label: 'Download Tailscale',
      };
    case 'computer-not-answering':
      return {
        id,
        title: `${computer} isn’t answering`,
        body: 'It may be asleep, or off your Tailscale network. Wake it, then check again.',
        step: 'Step 2',
        action: 'check-again',
        label: 'Check again',
      };
    case 'network-blocks':
      return {
        id,
        title: 'This network blocks Tailscale',
        body: 'Redlines can’t reach the other computer from here. Try another network, such as a phone’s hotspot.',
        step: 'Step 2',
        action: 'check-again',
        label: 'Try again',
      };
    case 'no-gateway':
      return {
        id,
        title: `No OpenClaw found on ${computer}`,
        body: 'The computer is there, but nothing answered as OpenClaw. Your agent can switch on remote access.',
        step: 'Step 2',
        action: 'copy-setup-prompt',
        label: 'Copy a prompt for your agent',
      };
    case 'code-used':
      return {
        id,
        title: 'That setup code has been used or has run out',
        body: 'A code works once, for about 10 minutes. Ask your agent for a new one.',
        step: 'Step 3',
        action: 'copy-code-request',
        label: 'Copy the request for a new code',
      };
    case 'not-approved':
      return {
        id,
        title: 'Nobody approved this Mac in 5 minutes',
        body: 'Your agent may not have seen the request. Ask again and send it the code.',
        step: 'Step 4',
        action: 'ask-again',
        label: 'Ask again',
      };
    case 'tools-unavailable':
      return {
        id,
        title: `Connected, but ${agent} can’t use the Redlines tools`,
        body: 'OpenClaw may have tools from other computers turned off, or they weren’t approved. Your agent can fix both.',
        step: 'Step 5',
        action: 'copy-tools-prompt',
        label: 'Copy a prompt for your agent',
      };
    case 'agent-silent':
      return {
        id,
        title: `${agent} didn’t answer in a minute`,
        body: 'The connection works, but the agent is busy or its model is unavailable. Nothing was changed.',
        step: 'Step 5',
        action: 'try-again',
        label: 'Try again',
      };
    case 'token-refused':
      return {
        id,
        title: 'The Gateway doesn’t accept that token',
        body: 'It may have been changed or turned off, or replaced when this Mac was approved again. Ask your agent for a new setup code: a new code starts over, whatever this Mac was given before. If that fails too, your agent can remove this Mac from the Gateway first (openclaw devices remove).',
        step: 'Step 3',
        action: 'copy-code-request',
        label: 'Copy the request for a new code',
      };
    case 'gateway-newer':
      return {
        id,
        title: 'This OpenClaw is newer than Redlines knows',
        body: 'Redlines won’t guess how to talk to it. Update Redlines, then try again.',
        step: 'Step 4',
        action: 'try-again',
        label: 'Try again',
      };
    case 'connection-failed':
      return {
        id,
        title: `${computer} refused the connection`,
        body: 'Nothing was changed on either computer. Details has what it said.',
        step: 'Step 4',
        action: 'try-again',
        label: 'Try again',
      };
    case 'not-connected':
      return {
        id,
        title: `${agent} is not connected`,
        body: 'The Gateway may be off, or this Mac is on another network. Redlines tries again by itself.',
        step: 'Later',
        action: 'reconnect',
        label: 'Reconnect',
      };
  }
}

export const FAILURE_IDS: readonly FailureId[] = [
  'tailscale-off',
  'tailscale-missing',
  'computer-not-answering',
  'network-blocks',
  'no-gateway',
  'code-used',
  'not-approved',
  'tools-unavailable',
  'agent-silent',
  'token-refused',
  'gateway-newer',
  'connection-failed',
  'not-connected',
];
