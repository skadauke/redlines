// What the OpenClaw setup window and the agent's card show in a plain page in development
// (`pnpm dev`, openclaw-setup.html and preferences.html), where there is no app to ask: every answer is scripted from the
// address, so that each screen and each failure can be looked at, in light and dark, and the
// journeys can be walked. Never in a release build, and never in the app.
//
//   openclaw-setup.html?oc=<screen>&ts=<tailscale>&probe=<gateway>&node=<connection>&dark
//
//   oc     start | mac | computer | prompt | approve | test | failures (every failure card), or
//          card, on preferences.html: the agent's card in Preferences › Agents
//   ts     missing | off | signed-out | no-peers | blocked | no-https | ready (the default)
//   discover=1  with no `oc`: look around first, as the app does (then `probe=` says what answers)
//   mac    what the setup has done about Tailscale, for the waits: installing | app-store |
//          install-failed | waiting | allow | signing-in | hung | still-hung
//   probe  found (default) | silent | none
//   node   connecting | pairing (default) | connected | code-used | not-approved | tools | newer
//   test   1: the test screen can run (otherwise the app's own, which can't yet)

import {
  FAILURE_IDS,
  failure,
  type GuidedDeps,
  type SheetDeps,
  type MacSetup,
  type NodeStatus,
  type OpenClawConnection,
  type TailscaleStatus,
} from '@redlines/agents';

const peer = (name: string, os: string, online: boolean) => ({
  name,
  dns_name: `${name}.yak-bebop.ts.net`,
  os,
  online,
  shared_in: false,
  last_seen: online ? null : '2026-10-25T10:00:00Z',
});

function tailscaleFor(kind: string): TailscaleStatus {
  const ready: TailscaleStatus = {
    state: 'ready',
    program: '/Applications/Tailscale.app/Contents/MacOS/Tailscale',
    account: 'ada@example.com',
    tailnet: 'yak-bebop.ts.net',
    this_mac: 'ada-mbp.yak-bebop.ts.net',
    auth_url: null,
    peers: [
      peer('studio-mini', 'macOS', true),
      peer('home-server', 'linux', true),
      peer('old-laptop', 'windows', false),
    ],
    blocked: false,
    health: [],
    https: true,
    allow_in: 'System Settings › General › Login Items & Extensions › Network Extensions',
  };
  switch (kind) {
    case 'missing':
      return {
        ...ready,
        state: 'missing',
        program: null,
        account: null,
        tailnet: null,
        this_mac: null,
        peers: [],
      };
    case 'off':
      return { ...ready, state: 'off', account: null, tailnet: null, this_mac: null, peers: [] };
    case 'signed-out':
      return {
        ...ready,
        state: 'signed-out',
        auth_url: 'https://login.tailscale.com/a/1',
        account: null,
        peers: [],
      };
    case 'no-peers':
      return { ...ready, state: 'no-peers', peers: [] };
    case 'no-https':
      return { ...ready, https: false };
    case 'blocked':
      return {
        ...ready,
        blocked: true,
        peers: ready.peers.map((one) => ({ ...one, online: false })),
        health: ["Tailscale can't reach the control server"],
      };
    default:
      return ready;
  }
}

function nodeFor(kind: string): NodeStatus {
  switch (kind) {
    case 'connecting':
      return { state: 'connecting' };
    case 'connected':
      return { state: 'connected', tools: 6 };
    case 'code-used':
      return { state: 'failed', why: 'code-used' };
    case 'not-approved':
      return { state: 'failed', why: 'not-approved' };
    case 'tools':
      return { state: 'failed', why: 'tools-refused', message: 'plugin tools are off' };
    case 'newer':
      return { state: 'failed', why: 'too-new', protocol: 4 };
    default:
      return { state: 'pairing', request_id: 'req-7', code: '7QF-2K9' };
  }
}

/**
 * What the setup has already done about Tailscale on this Mac, for a look at the screens that
 * depend on a wait (`?mac=`): times in the past, so that the wait is over.
 */
export function macSetupFor(query: URLSearchParams): Partial<MacSetup> {
  const past = Date.now() - 60_000;
  switch (query.get('mac')) {
    case 'installing':
      return {
        install: {
          phase: 'working',
          step: 'Downloading Tailscale 1.80.2 (about 29 MB) from pkgs.tailscale.com…',
        },
      };
    case 'app-store':
      return {
        install: {
          phase: 'app-store',
          step: 'You aren’t an administrator of this Mac, so Redlines can’t install Tailscale’s package. The App Store is open on Tailscale: install it there, and Redlines notices.',
        },
      };
    case 'install-failed':
      return {
        install: {
          phase: 'failed',
          step: 'The download isn’t signed by Tailscale, so it wasn’t installed.',
        },
      };
    case 'waiting':
      return { openedAt: Date.now() };
    case 'allow':
      return { openedAt: past };
    case 'signing-in':
      return { signInAt: Date.now() };
    case 'hung':
      return { signInAt: past, restarts: 1 };
    default:
      return {};
  }
}

/** The scripted answers for `query`, as the sheet and the card ask for them. */
export function devGuided(query: URLSearchParams): GuidedDeps & SheetDeps {
  const ts = query.get('ts') ?? 'ready';
  const probe = query.get('probe') ?? 'found';
  const node = query.get('node') ?? 'pairing';
  let list: OpenClawConnection[] =
    query.get('oc') === 'card'
      ? [
          {
            handle: 'moby-ada',
            name: 'Moby',
            computer: 'studio-mini',
            url: 'wss://studio-mini.yak-bebop.ts.net',
            level: 'suggest',
            folders: ['/Users/ada/Documents/Work', '/Users/ada/Notes'],
            created: Math.round(Date.now() / 1000) - 86400,
            last_used: Math.round(Date.now() / 1000) - 5,
            node_token: true,
            operator_token: true,
            device_key: true,
          },
        ]
      : [];
  const where = (handle: string) => list.find((one) => one.handle === handle);
  return {
    owner: 'ada',
    openSetup: () => void window.open(`/openclaw-setup.html${location.search}`, '_blank'),
    taken: () => ['claude-ada', 'codex-ada', ...list.map((one) => one.handle)],
    thisMac: () => Promise.resolve('Ada’s MacBook'),
    tailscale: {
      // A sign-in that hangs is one for which Tailscale gave no page.
      status: () =>
        Promise.resolve({
          ...tailscaleFor(ts),
          ...(query.get('mac') === 'hung' ? { auth_url: null } : {}),
        }),
      openApp: () => Promise.resolve(),
      openHttpsSettings: () => Promise.resolve(),
      install: () => Promise.resolve(),
      installState: () =>
        Promise.resolve(macSetupFor(query).install ?? { phase: 'idle', step: '' }),
      openAppStore: () => Promise.resolve(),
      restartApp: () => Promise.resolve(),
      signIn: () => Promise.resolve(),
    },
    probe: (address) => {
      const host = address.replace(/^wss?:\/\//, '').replace(/[:/].*$/, '');
      const at = { url: `wss://${host}`, host };
      if (probe === 'silent') {
        return Promise.resolve({ kind: 'not-answering', ...at, detail: 'No answer in time.' });
      }
      if (probe === 'none') {
        return Promise.resolve({ kind: 'no-gateway', ...at, detail: 'Connection refused.' });
      }
      return Promise.resolve({ kind: 'found', ...at });
    },
    copy: () => Promise.resolve(),
    paste: () => Promise.resolve('setup-code-from-your-agent'),
    connections: {
      list: () => Promise.resolve(list),
      add: (input) => {
        list = [
          ...list,
          {
            ...input,
            level: 'suggest',
            created: Math.round(Date.now() / 1000),
            node_token: false,
            operator_token: false,
            device_key: false,
          },
        ];
        return Promise.resolve(list);
      },
      change: (handle, change) => {
        list = list.map((one) => (one.handle === handle ? { ...one, ...change } : one));
        return Promise.resolve(list);
      },
      remove: (handle) => {
        list = list.filter((one) => one.handle !== handle);
        return Promise.resolve(list);
      },
      useToken: () => Promise.resolve(list),
    },
    node: {
      connect: () => Promise.resolve(),
      status: (handle) =>
        Promise.resolve(where(handle) || query.get('oc') === 'approve' ? nodeFor(node) : null),
      stop: () => Promise.resolve(),
    },
    chooseFolder: () => Promise.resolve('/Users/ada/Projects'),
    ...(query.get('test') === '1'
      ? {
          test: {
            run: () =>
              Promise.resolve({
                answered: true,
                usedTools: true,
                line: 'Fixed the typo (“teh” to “the”). Nothing else needed changing.',
              }),
          },
        }
      : {}),
  };
}

/** Every failure card of the setup sheet, in one frame, for a look in development (`?oc=failures`). */
export function failureGallery(): HTMLElement {
  const frame = document.createElement('section');
  frame.className = 'rl-oc-sheet';
  const body = document.createElement('div');
  body.className = 'rl-oc-body';
  const grid = document.createElement('div');
  grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:10px';
  for (const id of FAILURE_IDS) {
    const card = failure(id, { computer: 'studio-mini', agent: 'Moby' });
    const box = document.createElement('div');
    box.className = 'rl-oc-fail';
    const title = document.createElement('b');
    title.textContent = card.title;
    const text = document.createElement('p');
    text.textContent = card.body;
    const key = document.createElement('span');
    key.className = 'rl-oc-key';
    key.textContent = card.step;
    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'rl-pref-button rl-oc-primary';
    action.textContent = card.label;
    box.append(title, text, key, action);
    grid.append(box);
  }
  body.append(grid);
  frame.append(body);
  return frame;
}
