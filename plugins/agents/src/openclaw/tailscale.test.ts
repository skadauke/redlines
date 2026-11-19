import { describe, expect, it } from 'vitest';
import { tailscaleView, type TailscalePeer, type TailscaleStatus } from './tailscale.ts';

const peer = (name: string, os: string, online: boolean): TailscalePeer => ({
  name,
  dns_name: `${name}.yak-bebop.ts.net`,
  os,
  online,
  shared_in: false,
  last_seen: null,
});

const base: TailscaleStatus = {
  state: 'ready',
  program: '/Applications/Tailscale.app/Contents/MacOS/Tailscale',
  account: 'ada@example.com',
  tailnet: 'yak-bebop.ts.net',
  this_mac: 'ada-mbp.yak-bebop.ts.net',
  auth_url: null,
  peers: [peer('mini', 'macOS', true), peer('old', 'windows', false), peer('srv', 'linux', true)],
  blocked: false,
  health: [],
  allow_in: 'System Settings',
};
const of = (change: Partial<TailscaleStatus>) => tailscaleView({ ...base, ...change });

describe('tailscaleView', () => {
  it('a ready Mac passes three checks, and counts the computers on now', () => {
    const view = of({});
    expect(view.ready).toBe(true);
    expect(view.checks.map((check) => check.mark)).toEqual(['ok', 'ok', 'ok']);
    expect(view.checks[1].detail).toBe('ada@example.com, on the network yak-bebop.ts.net');
    expect(view.checks[2].title).toBe('Can see 3 other computers');
    expect(view.checks[2].detail).toBe('2 are on now');
    const one = of({ peers: [peer('mini', 'macOS', true)] });
    expect(one.checks[2].title).toBe('Can see 1 other computer');
    expect(one.checks[2].detail).toBe('1 is on now');
  });

  it('a Mac with no Tailscale offers to install it, and the others wait', () => {
    const view = of({ state: 'missing', peers: [], program: null });
    expect(view.ready).toBe(false);
    expect(view.failure).toBe('tailscale-missing');
    expect(view.action).toBe('install');
    expect(view.checks.map((check) => check.mark)).toEqual(['no', 'wait', 'wait']);
  });

  it('a Tailscale that is off offers to open it', () => {
    const view = of({ state: 'off', peers: [] });
    expect(view.failure).toBe('tailscale-off');
    expect(view.action).toBe('open');
    expect(view.checks[0].mark).toBe('ok');
  });

  it('a sign-in is offered only where Tailscale gave an address', () => {
    const address = 'https://login.tailscale.com/a/1';
    expect(of({ state: 'signed-out', auth_url: address }).action).toBe('sign-in');
    expect(of({ state: 'signed-out', auth_url: null }).action).toBe('open');
  });

  it('a network that blocks Tailscale says so, and a computer alone says that', () => {
    expect(of({ blocked: true }).failure).toBe('network-blocks');
    const alone = of({ state: 'no-peers', peers: [] });
    expect(alone.ready).toBe(false);
    expect(alone.checks[2].mark).toBe('no');
  });

  it('never says node, tailnet, backend or gateway', () => {
    const states = [
      'missing',
      'off',
      'signed-out',
      'needs-approval',
      'starting',
      'no-peers',
      'ready',
    ] as const;
    for (const state of states) {
      const words = JSON.stringify(of({ state })).toLowerCase();
      for (const word of ['node', 'tailnet', 'backend', 'gateway'])
        expect(words).not.toContain(word);
    }
  });
});
