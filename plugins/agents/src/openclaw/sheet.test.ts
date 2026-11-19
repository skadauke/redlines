// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FAILURE_IDS } from './failures.ts';
import type { GatewayProbe } from './gateway.ts';
import type { NodeStatus } from './node.ts';
import { openSheet, type Sheet, type SheetDeps, type SheetOptions } from './sheet.ts';
import type { InstallState } from './mac-setup.ts';
import type { TailscaleStatus } from './tailscale.ts';

const peer = (name: string, online: boolean) => ({
  name,
  dns_name: `${name}.yak-bebop.ts.net`,
  os: 'macOS',
  online,
  shared_in: false,
  last_seen: null,
});

const READY: TailscaleStatus = {
  state: 'ready',
  program: '/Applications/Tailscale.app/Contents/MacOS/Tailscale',
  account: 'ada@example.com',
  tailnet: 'yak-bebop.ts.net',
  this_mac: 'ada-mbp.yak-bebop.ts.net',
  auth_url: null,
  peers: [peer('studio-mini', true), peer('old-laptop', false)],
  blocked: false,
  health: [],
  allow_in: 'System Settings › General › Login Items & Extensions › Network Extensions',
  https: true,
};

const CODE = 'setup-code-1234567890';

interface World {
  deps: SheetDeps;
  copied: string[];
  tailscale: { current: TailscaleStatus };
  probe: { current: GatewayProbe };
  node: { current: NodeStatus | null };
  added: unknown[];
  connected: { handle: string; code: string | null }[];
  removed: string[];
  addFails: { current: string | null };
  opened: string[];
  /** What `installState` says. */
  install: { current: InstallState };
  signedIn: (string | null)[];
}

function world(): World {
  const w: World = {
    copied: [],
    tailscale: { current: READY },
    probe: {
      current: {
        kind: 'found',
        url: 'wss://studio-mini.yak-bebop.ts.net',
        host: 'studio-mini.yak-bebop.ts.net',
      },
    },
    node: { current: { state: 'connecting' } },
    added: [],
    connected: [],
    removed: [],
    addFails: { current: null },
    opened: [],
    install: { current: { phase: 'idle', step: '' } },
    signedIn: [],
    deps: undefined as unknown as SheetDeps,
  };
  w.deps = {
    owner: 'ada',
    taken: () => ['claude-ada', 'codex-ada'],
    thisMac: () => Promise.resolve('Ada’s MacBook'),
    tailscale: {
      status: () => Promise.resolve(w.tailscale.current),
      openApp: () => {
        w.opened.push('app');
        return Promise.resolve();
      },
      openHttpsSettings: () => {
        w.opened.push('https-page');
        return Promise.resolve();
      },
      install: () => {
        w.opened.push('install');
        return Promise.resolve();
      },
      installState: () => Promise.resolve(w.install.current),
      openAppStore: () => {
        w.opened.push('app-store');
        return Promise.resolve();
      },
      restartApp: () => {
        w.opened.push('restart');
        return Promise.resolve();
      },
      signIn: (url) => {
        w.signedIn.push(url);
        return Promise.resolve();
      },
    },
    probe: () => Promise.resolve(w.probe.current),
    copy: (text) => {
      w.copied.push(text);
      return Promise.resolve();
    },
    paste: () => Promise.resolve(CODE),
    connections: {
      add: (connection) =>
        w.addFails.current
          ? Promise.reject(new Error(w.addFails.current))
          : (w.added.push(connection), Promise.resolve([])),
      remove: (handle) => (w.removed.push(handle), Promise.resolve([])),
      useToken: () => Promise.resolve([]),
    },
    node: {
      connect: (handle, code) => (w.connected.push({ handle, code }), Promise.resolve()),
      status: () => Promise.resolve(w.node.current),
      stop: () => Promise.resolve(),
    },
    poll: { tailscale: 15, node: 15, install: 15 },
    macTimes: { extension: 60, signIn: 60 },
  };
  return w;
}

let sheet: Sheet | null = null;
let closed = 0;
let changed = 0;

function open(w: World, options: Partial<SheetOptions> = {}): HTMLElement {
  closed = 0;
  changed = 0;
  sheet = openSheet(w.deps, {
    alive: () => true,
    onClose: () => closed++,
    onChanged: () => changed++,
    ...options,
  });
  document.body.append(sheet.element);
  return sheet.element;
}

afterEach(() => {
  sheet?.dispose();
  sheet = null;
  document.body.replaceChildren();
});

const tick = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));
const step = (root: HTMLElement) => root.querySelector<HTMLElement>('.rl-oc-body')?.dataset['step'];
const click = (root: HTMLElement, label: string | RegExp) => {
  const found = [...root.querySelectorAll<HTMLElement>('button, [role="radio"]')].find((node) =>
    typeof label === 'string' ? node.textContent === label : label.test(node.textContent ?? ''),
  );
  if (!found) throw new Error(`no ${String(label)} in ${root.textContent}`);
  found.click();
  return found;
};
const text = (root: HTMLElement) => root.textContent ?? '';

function fill(root: HTMLElement, label: string, value: string) {
  const field = root.querySelector<HTMLInputElement>(`[aria-label="${label}"]`);
  if (!field) throw new Error(`no field ${label}`);
  field.value = value;
  field.dispatchEvent(new Event('input', { bubbles: true }));
  return field;
}

describe('the setup sheet', () => {
  it('starts with two choices, and On this Mac goes to the agent, with no Tailscale in it', async () => {
    const root = open(world());
    expect(step(root)).toBe('start');
    expect(text(root)).toContain('On this Mac');
    expect(text(root)).toContain('On another computer');
    click(root, /^On this Mac/);
    click(root, 'Continue');
    await tick();
    expect(step(root)).toBe('prompt');
    expect(text(root)).toContain('Step 1 of 3');
    expect(root.querySelector('.rl-oc-pre')?.textContent).not.toMatch(/tailscale/i);
  });

  it('Cancel closes it', () => {
    const root = open(world());
    click(root, 'Cancel');
    expect(closed).toBe(1);
    expect(root.isConnected).toBe(false);
  });

  it('a Mac with no Tailscale offers to install it, and goes on by itself when it is there', async () => {
    const w = world();
    w.tailscale.current = { ...READY, state: 'missing', peers: [], program: null };
    const root = open(w);
    click(root, /^On another computer/);
    click(root, 'Continue');
    await tick();
    expect(step(root)).toBe('mac');
    expect(text(root)).toContain('Tailscale is not on this Mac');
    expect(text(root)).toContain('checks that Tailscale signed it and Apple notarized it');
    expect(text(root)).toContain('Redlines never sees the password');
    const next = [...root.querySelectorAll('button')].find((b) => b.textContent === 'Continue');
    expect(next?.disabled).toBe(true);
    // Nothing is downloaded: there is no Download button, and nothing ran before the click.
    expect(() => click(root, /Download/)).toThrow();
    expect(w.opened).toEqual([]);
    click(root, 'Install Tailscale');
    await tick();
    expect(w.opened).toEqual(['install']);
    // The person signs in; Redlines notices by itself.
    w.tailscale.current = READY;
    await tick(80);
    expect(text(root)).toContain('This Mac is on your Tailscale network');
    expect(text(root)).toContain('Can see 2 other computers');
    expect(
      [...root.querySelectorAll('button')].find((b) => b.textContent === 'Continue')?.disabled,
    ).toBe(false);
  });

  it('Tailscale turned off offers to open it', async () => {
    const w = world();
    w.tailscale.current = { ...READY, state: 'off', peers: [] };
    const root = open(w, { start: { step: 'mac' } });
    await tick();
    expect(text(root)).toContain('Tailscale is turned off on this Mac');
    expect(w.opened).toEqual([]);
    click(root, 'Open Tailscale');
    expect(w.opened).toEqual(['app']);
  });

  describe('looking around when it opens, and the Gateways found', () => {
    const mini = peer('studio-mini', true);
    const phone = { ...peer('pixel', true), os: 'android' };
    const asleep = peer('old-laptop', false);
    const asked: string[] = [];
    const onlyMini = (w: World) => {
      asked.length = 0;
      w.deps.probe = (address) => {
        asked.push(address);
        return Promise.resolve(
          address.startsWith('studio-mini')
            ? { kind: 'found', url: 'wss://studio-mini.yak-bebop.ts.net', host: address }
            : { kind: 'no-gateway', url: `wss://${address}`, host: address, detail: 'refused' },
        );
      };
    };

    it('opens on the Gateways it found when everything passes, and Connect goes on to the agent', async () => {
      const w = world();
      w.tailscale.current = { ...READY, peers: [mini, phone, asleep, peer('home-server', true)] };
      onlyMini(w);
      const root = open(w, { discover: true });
      expect(step(root)).toBe('looking');
      expect(text(root)).toContain('Looking for your OpenClaw');
      await tick(60);
      expect(step(root)).toBe('gateways');
      expect(text(root)).toContain('Found your OpenClaw');
      expect(text(root)).toContain('studio-mini');
      expect(text(root)).not.toContain('home-server');
      // Only computers that are on, and not a phone, are asked, at their Tailscale names.
      expect(asked.sort()).toEqual([
        'home-server.yak-bebop.ts.net',
        'studio-mini.yak-bebop.ts.net',
      ]);
      click(root, 'Connect');
      await tick();
      expect(step(root)).toBe('prompt');
      expect(text(root)).toContain('studio-mini');
      expect(w.connected).toEqual([]);
    });

    it('opens on the choice when no Gateway answers, Tailscale is not ready, or the network blocks it', async () => {
      const none = world();
      none.tailscale.current = { ...READY, peers: [mini] };
      none.deps.probe = () =>
        Promise.resolve({ kind: 'no-gateway', url: 'wss://x', host: 'x', detail: 'refused' });
      let root = open(none, { discover: true });
      await tick(60);
      expect(step(root)).toBe('start');
      sheet?.dispose();

      const off = world();
      off.tailscale.current = { ...READY, state: 'off', peers: [] };
      onlyMini(off);
      root = open(off, { discover: true });
      await tick(60);
      expect(step(root)).toBe('start');
      expect(asked).toEqual([]);
      sheet?.dispose();

      const blocked = world();
      blocked.tailscale.current = { ...READY, blocked: true, peers: [mini] };
      onlyMini(blocked);
      root = open(blocked, { discover: true });
      await tick(60);
      expect(step(root)).toBe('start');
      expect(asked).toEqual([]);
    });

    it('lets the person set up by hand while it looks', async () => {
      const w = world();
      w.tailscale.current = { ...READY, peers: [mini] };
      onlyMini(w);
      const root = open(w, { discover: true });
      click(root, 'Set up by hand');
      expect(step(root)).toBe('start');
      await tick(60);
      expect(step(root)).toBe('start');
    });

    it('does not look unless asked to: a plain sheet opens on the choice', () => {
      expect(step(open(world()))).toBe('start');
    });

    it('says when HTTPS certificates are off, and opens the admin page that turns them on', async () => {
      const w = world();
      w.tailscale.current = { ...READY, https: false };
      const root = open(w, { start: { step: 'mac' } });
      await tick();
      expect(text(root)).toContain('HTTPS certificates are off for your network');
      expect(text(root)).toContain('Tailscale Serve needs them');
      // It does not stop the person.
      const next = [...root.querySelectorAll('button')].find((b) => b.textContent === 'Continue');
      expect(next?.disabled).toBe(false);
      click(root, 'Open the DNS page');
      expect(w.opened).toEqual(['https-page']);
      w.tailscale.current = READY;
      await tick(60);
      expect(text(root)).toContain('HTTPS certificates are on for your network');
    });

    it('where no Gateway answers and certificates are off, says Serve needs them, beside the prompt', async () => {
      const w = world();
      w.tailscale.current = { ...READY, https: false, peers: [mini] };
      w.probe.current = { kind: 'no-gateway', url: 'wss://x', host: 'x', detail: 'refused' };
      const root = open(w, {
        start: { step: 'computer', tailscale: { ...READY, https: false, peers: [mini] } },
      });
      click(root, /studio-mini/);
      await tick();
      expect(root.querySelector('[data-failure="no-gateway"]')).not.toBeNull();
      expect(text(root)).toContain('Tailscale Serve needs them');
      expect(text(root)).toContain('Copy a prompt for your agent');
      click(root, 'Open the DNS page');
      expect(w.opened).toEqual(['https-page']);
    });
  });

  describe('Tailscale on this Mac, done by the setup when the person asks', () => {
    const missing: TailscaleStatus = { ...READY, state: 'missing', peers: [], program: null };
    const signedOut: TailscaleStatus = { ...READY, state: 'signed-out', peers: [], account: null };

    it('installs, says each step, restarts the app once that opened too early, and signs in', async () => {
      const w = world();
      w.tailscale.current = missing;
      const root = open(w, { start: { step: 'mac' } });
      await tick();
      click(root, 'Install Tailscale');
      w.install.current = {
        phase: 'working',
        step: 'Downloading Tailscale 1.80.2 (about 29 MB) from pkgs.tailscale.com…',
      };
      await tick();
      expect(text(root)).toContain('Downloading Tailscale 1.80.2');
      expect(() => click(root, 'Install Tailscale')).toThrow();
      w.install.current = { phase: 'done', step: 'Tailscale is installed.' };
      // The installer opened the app, which answers but is signed out: it is restarted, once.
      w.tailscale.current = signedOut;
      await tick(80);
      expect(w.opened).toEqual(['install', 'restart']);
      await tick(80);
      expect(w.opened).toEqual(['install', 'restart']);
      expect(text(root)).toContain('Sign in with the same account as your other computer');
      expect(w.signedIn).toEqual([]);
      click(root, 'Sign in to Tailscale');
      expect(w.signedIn).toEqual([null]);
    });

    it('sends a person who is not an administrator to the App Store, and waits for it', async () => {
      const w = world();
      w.tailscale.current = missing;
      const root = open(w, { start: { step: 'mac' } });
      await tick();
      click(root, 'Install Tailscale');
      w.install.current = {
        phase: 'app-store',
        step: 'You aren’t an administrator of this Mac. The App Store is open on Tailscale.',
      };
      await tick();
      expect(text(root)).toContain('The App Store is open on Tailscale');
      expect(text(root)).toContain('Waiting for Tailscale to arrive');
      click(root, 'Open the App Store again');
      expect(w.opened).toContain('app-store');
      // Installed from the App Store, it is turned off until opened: not a fresh install here.
      w.tailscale.current = { ...READY, state: 'off', peers: [] };
      await tick(80);
      expect(w.opened).not.toContain('restart');
      expect(text(root)).toContain('Open Tailscale');
    });

    it('says plainly why an install stopped, and offers to try again or the App Store', async () => {
      const w = world();
      w.tailscale.current = missing;
      const root = open(w, { start: { step: 'mac' } });
      await tick();
      click(root, 'Install Tailscale');
      w.install.current = {
        phase: 'failed',
        step: 'The download isn’t signed by Tailscale, so it wasn’t installed.',
      };
      await tick();
      expect(text(root)).toContain('isn’t signed by Tailscale, so it wasn’t installed');
      click(root, 'Get it from the App Store instead');
      expect(w.opened).toContain('app-store');
      click(root, 'Try again');
      await tick();
      expect(w.opened.filter((one) => one === 'install')).toHaveLength(2);
    });

    it('says where to allow the network extension when Tailscale, opened, still does not answer', async () => {
      const w = world();
      w.tailscale.current = { ...READY, state: 'off', peers: [] };
      const root = open(w, { start: { step: 'mac' } });
      await tick();
      click(root, 'Open Tailscale');
      await tick(20);
      expect(text(root)).toContain('Waiting for Tailscale to start');
      await tick(100);
      expect(text(root)).toContain('Login Items & Extensions › Network Extensions');
      click(root, 'Restart Tailscale');
      await tick();
      expect(w.opened).toEqual(['app', 'restart']);
    });

    it('starts the sign-in with the page Tailscale gave, and restarts the app when none comes', async () => {
      const w = world();
      w.tailscale.current = { ...signedOut, auth_url: 'https://login.tailscale.com/a/1' };
      const root = open(w, { start: { step: 'mac' } });
      await tick();
      click(root, 'Sign in to Tailscale');
      expect(w.signedIn).toEqual(['https://login.tailscale.com/a/1']);
      await tick();
      expect(text(root)).toContain('Waiting for you to finish signing in');
      expect(w.opened).toEqual([]);

      // Another Mac's app, which Log in does nothing in: no page ever comes.
      const hung = world();
      hung.tailscale.current = signedOut;
      const second = open(hung, { start: { step: 'mac' } });
      await tick();
      click(second, 'Sign in to Tailscale');
      expect(hung.signedIn).toEqual([null]);
      await tick(150);
      // Restarted by itself, once; then it says what to do and offers the button.
      expect(hung.opened).toEqual(['restart']);
      await tick(150);
      expect(hung.opened).toEqual(['restart']);
      click(second, 'Sign in to Tailscale');
      await tick(150);
      expect(text(second)).toContain('The sign-in still doesn’t start');
      click(second, 'Restart Tailscale');
      await tick();
      expect(hung.opened).toEqual(['restart', 'restart']);
    });
  });

  it('lists the computers, dims the ones that are off, and finds the Gateway on the one picked', async () => {
    const w = world();
    const root = open(w, { start: { step: 'computer', tailscale: READY } });
    await tick();
    const rows = [...root.querySelectorAll<HTMLElement>('.rl-oc-row')];
    expect(rows.map((row) => row.querySelector('b')?.textContent)).toEqual([
      'studio-mini',
      'old-laptop',
    ]);
    expect(rows[1]?.classList.contains('rl-oc-dim')).toBe(true);
    expect(rows[1]?.getAttribute('role')).toBeNull();
    const next = () =>
      [...root.querySelectorAll('button')].find((b) => b.textContent === 'Continue');
    expect(next()?.disabled).toBe(true);
    rows[0]?.click();
    await tick();
    expect(text(root)).toContain('Found an OpenClaw Gateway on studio-mini.');
    expect(next()?.disabled).toBe(false);
  });

  it('a computer with no Gateway shows its card, and the card’s button copies the prompt', async () => {
    const w = world();
    w.probe.current = {
      kind: 'no-gateway',
      url: 'wss://x',
      host: 'studio-mini.yak-bebop.ts.net',
      detail: 'refused',
    };
    const root = open(w, { start: { step: 'computer', tailscale: READY } });
    await tick();
    root.querySelectorAll<HTMLElement>('.rl-oc-row')[0]?.click();
    await tick();
    expect(root.querySelector('[data-failure="no-gateway"]')).not.toBeNull();
    expect(text(root)).toContain('refused');
    click(root, 'Copy a prompt for your agent');
    await tick();
    expect(w.copied).toHaveLength(1);
    expect(w.copied[0]).toContain('gateway.tailscale.mode to serve');
    expect(
      [...root.querySelectorAll('button')].find((b) => b.textContent === 'Continue')?.disabled,
    ).toBe(true);
  });

  it('a computer that does not answer, and a typed address that is no good, say so', async () => {
    const w = world();
    w.probe.current = { kind: 'not-answering', url: 'wss://x', host: 'h', detail: 'No answer.' };
    const root = open(w, { start: { step: 'computer', tailscale: READY } });
    await tick();
    fill(root, 'Tailscale name or address', 'studio-mini');
    click(root, 'Look');
    await tick();
    expect(root.querySelector('[data-failure="computer-not-answering"]')).not.toBeNull();
    w.probe.current = { kind: 'bad-address', message: 'Nope.' };
    click(root, 'Look');
    await tick();
    expect(text(root)).toContain('That address can’t be used.');
    expect(text(root)).toContain('Nope.');
  });

  it('the prompt names the agent and this Mac, Copy copies it, and Connect needs a name and a code', async () => {
    const w = world();
    const root = open(w, {
      start: {
        step: 'prompt',
        computer: 'studio-mini.yak-bebop.ts.net',
        tailscale: READY,
        url: 'wss://studio-mini.yak-bebop.ts.net',
      },
    });
    await tick();
    const connect = () =>
      [...root.querySelectorAll('button')].find((b) => b.textContent === 'Connect');
    expect(connect()?.disabled).toBe(true);
    fill(root, 'Your agent’s name', 'Moby');
    expect(text(root)).toContain('It will write as moby-ada.');
    expect(root.querySelector('.rl-oc-pre')?.textContent).toContain('available to Moby only');
    expect(root.querySelector('.rl-oc-pre')?.textContent).toContain('Ada’s MacBook');
    expect(connect()?.disabled).toBe(true);
    const field = root.querySelector<HTMLInputElement>('.rl-oc-secret');
    expect(field?.type).toBe('password');
    fill(root, 'Setup code', CODE);
    expect(connect()?.disabled).toBe(false);
    click(root, 'Copy prompt');
    await tick();
    expect(w.copied[0]).toContain('Moby');
    expect(w.copied[0]).not.toContain(CODE);
  });

  it('a name another agent has is refused before anything is asked', async () => {
    const w = world();
    w.deps.taken = () => ['moby-ada'];
    const root = open(w, {
      start: { step: 'prompt', url: 'ws://127.0.0.1:18789', where: 'this-mac' },
    });
    await tick();
    fill(root, 'Your agent’s name', 'Moby');
    fill(root, 'Setup code', CODE);
    expect(text(root)).toContain('Another agent already writes as moby-ada.');
    expect(
      [...root.querySelectorAll('button')].find((b) => b.textContent === 'Connect')?.disabled,
    ).toBe(true);
  });

  it('Connect adds the connection, gives the code to the node once, clears the field and shows nothing of it', async () => {
    const w = world();
    const root = open(w, {
      start: {
        step: 'prompt',
        computer: 'studio-mini.yak-bebop.ts.net',
        tailscale: READY,
        url: 'wss://studio-mini.yak-bebop.ts.net',
      },
    });
    await tick();
    fill(root, 'Your agent’s name', 'Moby');
    const field = fill(root, 'Setup code', CODE);
    click(root, 'Connect');
    await tick();
    expect(w.added).toEqual([
      {
        handle: 'moby-ada',
        name: 'Moby',
        computer: 'studio-mini',
        url: 'wss://studio-mini.yak-bebop.ts.net',
        folders: [],
      },
    ]);
    expect(w.connected).toEqual([{ handle: 'moby-ada', code: CODE }]);
    expect(field.value).toBe('');
    expect(step(root)).toBe('approve');
    expect(text(root)).not.toContain(CODE);
    expect(root.innerHTML).not.toContain(CODE);
  });

  it('a no to the question keeps the sheet where it was, with the reason', async () => {
    const w = world();
    w.addFails.current = 'Not added: you said no.';
    const root = open(w, {
      start: { step: 'prompt', url: 'ws://127.0.0.1:18789', where: 'this-mac' },
    });
    await tick();
    fill(root, 'Your agent’s name', 'Moby');
    fill(root, 'Setup code', CODE);
    click(root, 'Connect');
    await tick();
    expect(step(root)).toBe('prompt');
    expect(text(root)).toContain('Not added: you said no.');
    expect(w.connected).toEqual([]);
  });

  it('approval shows the code to compare, then the test, then Finish closes and tells the pane', async () => {
    const w = world();
    w.node.current = { state: 'pairing', request_id: 'req-7', code: '7QF-2K9' };
    const root = open(w, {
      start: { step: 'approve', agent: 'Moby', computer: 'studio-mini.yak-bebop.ts.net' },
    });
    await tick(60);
    expect(step(root)).toBe('approve');
    expect(root.querySelector('.rl-oc-code')?.textContent).toBe('7QF-2K9');
    expect(text(root)).toContain('The request lasts 5 minutes.');
    w.node.current = { state: 'connected', tools: 6 };
    await tick(80);
    expect(step(root)).toBe('test');
    expect(text(root)).toContain('Moby is connected.');
    click(root, 'Finish');
    expect(closed).toBe(1);
    expect(changed).toBeGreaterThan(0);
  });

  it('with a test to run, the test screen runs it and reports the two checks', async () => {
    const w = world();
    w.deps.test = {
      run: () => Promise.resolve({ answered: true, usedTools: true, line: 'Fixed the typo.' }),
    };
    w.node.current = { state: 'connected', tools: 6 };
    const root = open(w, { start: { step: 'approve', agent: 'Moby' } });
    await tick(100);
    expect(step(root)).toBe('test');
    expect(text(root)).toContain('Moby answered');
    expect(text(root)).toContain('Moby used the Redlines tools');
    expect(text(root)).toContain('Fixed the typo.');
  });

  it('every way a connection can fail shows its card, and its button does the one thing', async () => {
    const cases: [NodeStatus, string, RegExp][] = [
      [{ state: 'failed', why: 'code-used' }, 'code-used', /new code/],
      [{ state: 'failed', why: 'not-approved' }, 'not-approved', /Ask again/],
      [
        { state: 'failed', why: 'tools-refused', message: 'off' },
        'tools-unavailable',
        /Copy a prompt/,
      ],
      [{ state: 'failed', why: 'too-new', protocol: 9 }, 'gateway-newer', /Try again/],
      [{ state: 'failed', why: 'bad-token' }, 'token-refused', /new code/],
      [{ state: 'failed', why: 'other', message: 'odd' }, 'connection-failed', /Try again/],
    ];
    for (const [status, id, button] of cases) {
      const w = world();
      w.node.current = status;
      const root = open(w, { start: { step: 'approve', agent: 'Moby' } });
      await tick(50);
      const card = root.querySelector(`[data-failure="${id}"]`);
      expect(card, id).not.toBeNull();
      expect(card?.textContent).toMatch(button);
      sheet?.dispose();
    }
  });

  it('a used code copies the request for a new one and returns to where it is pasted', async () => {
    const w = world();
    w.node.current = { state: 'failed', why: 'code-used' };
    const root = open(w, { start: { step: 'approve', agent: 'Moby' } });
    await tick(50);
    click(root, 'Copy the request for a new code');
    await tick();
    expect(w.copied[0]).toContain('setup-code-only');
    expect(step(root)).toBe('prompt');
  });

  it('Ask again connects with what was kept, and falls back to the prompt when there is nothing', async () => {
    const w = world();
    w.node.current = { state: 'failed', why: 'not-approved' };
    const root = open(w, { start: { step: 'approve', agent: 'Moby' } });
    await tick(50);
    click(root, 'Ask again');
    await tick();
    expect(w.connected).toEqual([{ handle: 'moby-ada', code: null }]);
    w.deps.node.connect = () => Promise.reject(new Error('no code'));
    w.node.current = { state: 'failed', why: 'not-approved' };
    await tick(50);
    click(root, 'Ask again');
    await tick();
    expect(step(root)).toBe('prompt');
  });

  it('Cancel on the approval screen stops the connection and takes the agent away again', async () => {
    const w = world();
    const root = open(w, { start: { step: 'approve', agent: 'Moby' } });
    await tick(30);
    click(root, 'Cancel');
    await tick();
    expect(w.removed).toEqual(['moby-ada']);
    expect(closed).toBe(1);
  });

  it('every screen draws at 13 pixels or more: it sets no font size of its own', () => {
    const root = open(world());
    expect(root.innerHTML).not.toMatch(/font-size/i);
  });

  it('knows a card for every failure the design lists', () => {
    expect(FAILURE_IDS.length).toBeGreaterThanOrEqual(10);
  });

  it('stops polling once the pane is gone', async () => {
    const w = world();
    const status = vi.spyOn(w.deps.tailscale, 'status');
    let alive = true;
    open(w, { start: { step: 'mac' }, alive: () => alive });
    await tick(50);
    alive = false;
    const seen = status.mock.calls.length;
    await tick(80);
    expect(status.mock.calls.length).toBe(seen);
  });

  it('Copy prompt leaves the code the person pasted where it is', async () => {
    const w = world();
    const root = open(w, {
      start: { step: 'prompt', url: 'ws://127.0.0.1:18789', where: 'this-mac' },
    });
    await tick();
    fill(root, 'Your agent’s name', 'Moby');
    const field = fill(root, 'Setup code', CODE);
    click(root, 'Copy prompt');
    await tick();
    expect(root.querySelector<HTMLInputElement>('.rl-oc-secret')).toBe(field);
    expect(field.value).toBe(CODE);
    expect(text(root)).toContain('Copied');
  });

  it('a sheet cancelled while the question is up leaves no connection and no node behind', async () => {
    const w = world();
    let allow: (value: unknown) => void = () => {};
    w.deps.connections.add = (connection) => {
      w.added.push(connection);
      return new Promise((resolve) => {
        allow = resolve;
      });
    };
    const root = open(w, {
      start: { step: 'prompt', url: 'ws://127.0.0.1:18789', where: 'this-mac' },
    });
    await tick();
    fill(root, 'Your agent’s name', 'Moby');
    fill(root, 'Setup code', CODE);
    click(root, 'Connect');
    await tick();
    // The person closes the sheet, the pane's way, while the question waits.
    sheet?.dispose();
    allow([]);
    await tick();
    expect(w.removed).toEqual(['moby-ada']);
    expect(w.connected).toEqual([]);
    expect(root.isConnected).toBe(false);
  });

  it('Cancel on the prompt screen closes the sheet, and takes away a connection it began', async () => {
    const w = world();
    w.deps.node.connect = () => Promise.reject(new Error('The Gateway isn’t reachable.'));
    const root = open(w, {
      start: { step: 'prompt', url: 'ws://127.0.0.1:18789', where: 'this-mac' },
    });
    await tick();
    fill(root, 'Your agent’s name', 'Moby');
    fill(root, 'Setup code', CODE);
    click(root, 'Connect');
    await tick();
    expect(text(root)).toContain('The Gateway isn’t reachable.');
    click(root, 'Cancel');
    await tick();
    expect(w.removed).toEqual(['moby-ada']);
    expect(closed).toBe(1);
  });

  it('a finished sheet leaves its connection, and a failed one is not asked about again', async () => {
    const w = world();
    w.node.current = { state: 'failed', why: 'code-used' };
    const status = vi.spyOn(w.deps.node, 'status');
    open(w, { start: { step: 'approve', agent: 'Moby' } });
    await tick(120);
    expect(status.mock.calls.length).toBe(1);
    sheet?.dispose();
    await tick();
    // It never reached a test: what it began is undone.
    expect(w.removed).toEqual(['moby-ada']);
    // A sheet that reached the test keeps what it made.
    const kept = world();
    kept.node.current = { state: 'connected', tools: 6 };
    const root = open(kept, { start: { step: 'approve', agent: 'Moby' } });
    await tick(80);
    click(root, 'Finish');
    await tick();
    expect(kept.removed).toEqual([]);
  });
});
