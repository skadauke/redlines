import { describe, expect, it } from 'vitest';
import {
  codeRequestPrompt,
  gatewayPrompt,
  localPrompt,
  SECRET_SHAPES,
  setupPrompt,
  toolsPrompt,
} from './prompt.ts';

const input = {
  mac: 'Ada’s MacBook',
  macAddress: 'ada-mbp.yak-bebop.ts.net',
  agent: 'Moby',
};

const all = () => ({
  setup: setupPrompt(input),
  local: localPrompt(input),
  gateway: gatewayPrompt(input),
  code: codeRequestPrompt(),
  tools: toolsPrompt(input),
});

describe('the prompts', () => {
  it('name this Mac, its Tailscale name and the agent', () => {
    const text = setupPrompt(input);
    expect(text).toContain('Ada’s MacBook');
    expect(text).toContain('ada-mbp.yak-bebop.ts.net');
    expect(text).toContain('available to Moby only');
    expect(setupPrompt({ ...input, macAddress: null })).not.toContain('null');
  });

  it('hold no secret, no token, no setup code and no path to either', () => {
    for (const [name, text] of Object.entries(all())) {
      for (const shape of SECRET_SHAPES) {
        expect(text, `${name} matches ${shape}`).not.toMatch(shape);
      }
    }
    // A prompt that someone filled with a secret as a name is caught by the same shapes.
    expect(setupPrompt({ ...input, agent: 'sk-live-abcdefgh12345678' })).toMatch(SECRET_SHAPES[0]!);
  });

  it('asks for the private road only, auth on, and one command, never system.run', () => {
    const text = setupPrompt(input);
    expect(text).toContain('gateway.tailscale.mode to serve');
    expect(text).toContain('Do not use funnel');
    expect(text).toContain('Keep Gateway auth on');
    expect(text).toContain('Never');
    expect(text).toContain('approve system.run or any command other than mcp.tools.call.v1');
    expect(text).not.toMatch(/mode to funnel|bind (to )?(lan|0\.0\.0\.0)/i);
  });

  it('asks for a setup code that is the only thing in its message, and approvals only on a yes', () => {
    // The text is wrapped for reading: a command may sit across two lines.
    const text = setupPrompt(input).replace(/\s+/g, ' ');
    expect(text).toContain('openclaw qr --remote --setup-code-only');
    expect(text).toContain('only thing in a message by itself');
    expect(text).toContain('wait for my yes');
  });

  it('the one for this Mac leaves Tailscale out, and the Gateway one stops at step 2', () => {
    expect(localPrompt(input)).not.toMatch(/tailscale/i);
    const gateway = gatewayPrompt(input);
    expect(gateway).toContain('gateway.tailscale.mode to serve');
    expect(gateway).not.toContain('setup code');
  });

  it('never use words the person has not seen, in the lines meant for them', () => {
    // The prompts are for an agent, so they name the Gateway's own settings; what the person reads
    // around them is checked in the sheet's tests.
    expect(codeRequestPrompt()).toContain('new one');
    expect(toolsPrompt(input)).toContain('Moby can’t use its tools');
  });
});
