// The prompts Redlines writes for the person to send to their OpenClaw agent
// (docs/research/openclaw-connection.md, screen 4). They are the one place that words the request,
// and they hold **no secret**: no token, no password, no setup code, no path to a file that holds
// one. The agent does its side of the work and answers with a setup code, which the person pastes
// into the sheet's secure field; the prompt only says how to make one.
//
// What it asks is what the node needs and no more: the Gateway on the private Tailscale network
// only (never Funnel), auth left on, one command allowed (`mcp.tools.call.v1`) and never
// `system.run`, and the tools given to one agent only.
//
// A paragraph is one line: the box that shows the prompt, and the chat it is pasted into, wrap it.

/** What the prompt names. */
interface PromptInput {
  /** This Mac as its owner calls it: "Ada’s MacBook". */
  mac: string;
  /** This Mac's name on the Tailscale network: `ada-mbp.yak-bebop.ts.net`, when it is known. */
  macAddress?: string | null;
  /** The agent's name, as the person writes it after an @: "Moby". */
  agent: string;
}

const where = ({ mac, macAddress }: PromptInput) =>
  macAddress ? `("${mac}", ${macAddress})` : `("${mac}")`;

/**
 * The whole setup, for a Gateway on another computer, reached over Tailscale. Six numbered steps,
 * each one a thing the agent can do or say it can't.
 */
export function setupPrompt(input: PromptInput): string {
  return [
    `I’m connecting the Redlines editor on my Mac ${where(input)} to you, so that you can suggest edits in my documents. Please set up your side of it. Tell me before you change anything that opens access, and never send me a password or token in the chat, except the setup code in step 4.`,
    '',
    '1. Check that Tailscale is running on this computer, signed in to the same Tailscale network as my Mac, and that HTTPS is enabled for the network. If not, tell me what to do.',
    '2. Make the Gateway reachable on that network only: keep gateway.bind on loopback and set gateway.tailscale.mode to serve. Do not use funnel. Keep Gateway auth on.',
    '3. Redlines will connect as a node and offer tools named by an MCP server. Make sure gateway.nodes.pluginTools.enabled is not false and mcp.tools.call.v1 is not denied. Never approve system.run or any command other than mcp.tools.call.v1 for it.',
    '4. Make a setup code for a full-access, non-limited device with `openclaw qr --remote --setup-code-only` (or Devices > Connect a device in the Control UI) and send it to me as the only thing in a message by itself. It works once.',
    '5. When Redlines connects, tell me the pending device request’s id and the code I’ll see (the first characters of its device id), wait for my yes, then run `openclaw devices approve <id>` and `openclaw nodes approve <id>`.',
    `6. Make the Redlines tools available to ${input.agent} only, and only for runs I start from Redlines; tell me how you did that. Then tell me the name I should type after @, and what you changed.`,
  ].join('\n');
}

/**
 * The same for a Gateway on this Mac: nothing to reach, so no Tailscale, and the first pairing from
 * the same machine is approved by OpenClaw itself.
 */
export function localPrompt(input: PromptInput): string {
  return [
    `I’m connecting the Redlines editor on this Mac ${where(input)} to you, so that you can suggest edits in my documents. Please set up your side of it. Tell me before you change anything that opens access, and never send me a password or token in the chat, except the setup code in step 2.`,
    '',
    '1. Redlines will connect as a node and offer tools named by an MCP server. Make sure gateway.nodes.pluginTools.enabled is not false and mcp.tools.call.v1 is not denied. Never approve system.run or any command other than mcp.tools.call.v1 for it.',
    '2. Make a setup code for a full-access, non-limited device with `openclaw qr --setup-code-only` (or Devices > Connect a device in the Control UI) and send it to me as the only thing in a message by itself. It works once.',
    '3. If Redlines’ request needs an approval, tell me its id, wait for my yes, then run `openclaw devices approve <id>` and `openclaw nodes approve <id>`.',
    `4. Make the Redlines tools available to ${input.agent} only, and only for runs I start from Redlines; tell me how you did that. Then tell me the name I should type after @, and what you changed.`,
  ].join('\n');
}

/** Steps 1 and 2 of the setup alone: for a computer where no Gateway answered. */
export function gatewayPrompt(input: PromptInput): string {
  return [
    `I’m connecting the Redlines editor on my Mac ${where(input)} to you, but no OpenClaw Gateway answers on this computer’s Tailscale name. Please make it reachable. Tell me before you change anything that opens access, and never send me a password or token in the chat.`,
    '',
    '1. Check that Tailscale is running on this computer, signed in to the same Tailscale network as my Mac, and that HTTPS is enabled for the network. If not, tell me what to do.',
    '2. Make the Gateway reachable on that network only: keep gateway.bind on loopback and set gateway.tailscale.mode to serve. Do not use funnel. Keep Gateway auth on.',
    '',
    'Then tell me what you changed.',
  ].join('\n');
}

/** A new setup code, for one that was used or has run out. */
export function codeRequestPrompt(): string {
  return 'The setup code you made for Redlines has been used or has run out. Please make a new one with `openclaw qr --remote --setup-code-only` (or Devices > Connect a device in the Control UI) and send it to me as the only thing in a message by itself. It works once, for about 10 minutes.';
}

/** For a Redlines that is connected but whose tools the Gateway won't offer the agent. */
export function toolsPrompt(input: Pick<PromptInput, 'agent'>): string {
  return [
    `Redlines is connected to you as a node, but ${input.agent} can’t use its tools. Please check, and tell me before you change anything that opens access:`,
    '',
    '1. gateway.nodes.pluginTools.enabled is not false, and mcp.tools.call.v1 is not in gateway.nodes.commands.deny.',
    '2. The pending node request from Redlines is approved (`openclaw nodes pending`, then `openclaw nodes approve <id>`), for mcp.tools.call.v1 only. Never approve system.run.',
    `3. The Redlines tools are available to ${input.agent} only.`,
    '',
    'Then tell me what you changed.',
  ].join('\n');
}

/** Words that would make a prompt carry a secret: checked by the tests, for every prompt. */
export const SECRET_SHAPES: readonly RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{8,}/,
  /\bBearer\s+\S+/i,
  /\b[A-Za-z0-9+/_-]{40,}={0,2}(?![A-Za-z0-9+/_-])/,
  /(?:token|password|secret|passphrase)\s*[:=]\s*\S+/i,
  /\/Users\/[^\s]+\/\.openclaw/,
  /~\/\.openclaw/,
];
