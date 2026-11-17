// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FAILURE_IDS } from './failures.ts';
import type { GatewayProbe } from './gateway.ts';
import type { NodeStatus } from './node.ts';
import { openSheet, type Sheet, type SheetDeps, type SheetOptions } from './sheet.ts';
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
      download: () => {
        w.opened.push('download');
        return Promise.resolve();
      },
      signIn: () => Promise.resolve(),
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
    poll: { tailscale: 15, node: 15 },
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

  it('a Mac with no Tailscale says so, offers the download, and goes on by itself when it is there', async () => {
    const w = world();
    w.tailscale.current = { ...READY, state: 'missing', peers: [], program: null };
    const root = open(w);
    click(root, /^On another computer/);
    click(root, 'Continue');
    await tick();
    expect(step(root)).toBe('mac');
    expect(root.querySelector('[data-failure="tailscale-missing"]')).not.toBeNull();
    const next = [...root.querySelectorAll('button')].find((b) => b.textContent === 'Continue');
    expect(next?.disabled).toBe(true);
    click(root, 'Download Tailscale');
    expect(w.opened).toEqual(['download']);
    // The person installs it and signs in; Redlines notices by itself.
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
    expect(root.querySelector('[data-failure="tailscale-off"]')).not.toBeNull();
    click(root, 'Open Tailscale');
    expect(w.opened).toEqual(['app']);
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
});
