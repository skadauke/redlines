// This Mac's Tailscale, as the setup sheet's second screen shows it (docs/research/openclaw-connection.md,
// screen 2): the state the app reads (src-tauri/src/agents/tailscale.rs, which only looks), and the
// three checks in plain words. What the setup does about each (install, open, sign in, restart) is
// mac-setup.ts. The words avoid "node", "tailnet" and "backend": a person sees
// "Tailscale", "signed in" and "your other computers".

/** What `tailscale_status` returns (`Status` in agents/tailscale.rs). */
export interface TailscaleStatus {
  state: 'missing' | 'off' | 'signed-out' | 'needs-approval' | 'starting' | 'no-peers' | 'ready';
  program: string | null;
  account: string | null;
  tailnet: string | null;
  this_mac: string | null;
  auth_url: string | null;
  peers: TailscalePeer[];
  blocked: boolean;
  health: string[];
  /** Where in System Settings macOS asks to allow Tailscale's network extension. */
  allow_in: string;
  /** Whether HTTPS certificates are on for the network, which Tailscale Serve needs; null: not said. */
  https: boolean | null;
}

export interface TailscalePeer {
  name: string;
  dns_name: string;
  os: string;
  online: boolean;
  shared_in: boolean;
  last_seen: string | null;
}

/** One of the three rows: done, waiting for the one above it, or the one that needs something. */
export interface Check {
  id: 'installed' | 'signed-in' | 'sees-others' | 'https';
  title: string;
  /** The line under the title, when there is one. */
  detail?: string;
  mark: 'ok' | 'no' | 'wait';
}

/** The one button the screen offers for what it found, when it offers one. */
export type TailscaleAction = 'install' | 'open' | 'sign-in' | 'again';

export interface TailscaleView {
  checks: [Check, Check, Check];
  /** The heading. */
  title: string;
  /** The gray card that says what is wrong and what to do (failures.ts), or null. */
  failure: 'tailscale-off' | 'tailscale-missing' | 'network-blocks' | null;
  /** The note under the checks: what to do, in the person's words. */
  note: string | null;
  action: TailscaleAction | null;
  /** Whether Continue is open. */
  ready: boolean;
}

/**
 * The check of the network's HTTPS certificates, which Tailscale Serve needs to give a Gateway its
 * `https://` address: for a Mac that is signed in, and nothing for one that isn't or when Tailscale
 * doesn't say. It never stops the person (the Gateway may be reached another way).
 */
export function httpsCheck(status: TailscaleStatus): Check | null {
  if ((status.state !== 'ready' && status.state !== 'no-peers') || status.https === null) {
    return null;
  }
  return status.https
    ? { id: 'https', title: 'HTTPS certificates are on for your network', mark: 'ok' }
    : {
        id: 'https',
        title: 'HTTPS certificates are off for your network',
        detail: 'Tailscale Serve needs them to give your agent’s Gateway an https:// address.',
        mark: 'no',
      };
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** What the screen says of a status. */
export function tailscaleView(status: TailscaleStatus): TailscaleView {
  const installed = (mark: Check['mark']): Check => ({
    id: 'installed',
    title: mark === 'ok' ? 'Tailscale is installed' : 'Tailscale is not on this Mac',
    detail:
      mark === 'ok'
        ? 'The Tailscale app'
        : 'Redlines looked in Applications and for the tailscale command.',
    mark,
  });
  const signedIn = (mark: Check['mark'], detail?: string): Check => ({
    id: 'signed-in',
    title: 'Signed in',
    ...(detail ? { detail } : {}),
    mark,
  });
  const sees = (mark: Check['mark'], title: string, detail?: string): Check => ({
    id: 'sees-others',
    title,
    ...(detail ? { detail } : {}),
    mark,
  });
  const others = 'Can see your other computers';

  switch (status.state) {
    case 'missing':
      return {
        checks: [installed('no'), signedIn('wait'), sees('wait', others)],
        title: 'Redlines reaches your other computer over Tailscale',
        failure: 'tailscale-missing',
        note:
          'Redlines installs Tailscale, then you sign in with the same account as your other ' +
          'computer. Redlines notices by itself.',
        action: 'install',
        ready: false,
      };
    case 'off':
      return {
        checks: [
          { ...installed('ok'), detail: 'The Tailscale app, which is turned off' },
          signedIn('wait'),
          sees('wait', others),
        ],
        title: 'Tailscale is turned off on this Mac',
        failure: 'tailscale-off',
        note: 'Open Tailscale and turn it on. Redlines notices by itself.',
        action: 'open',
        ready: false,
      };
    case 'starting':
      return {
        checks: [installed('ok'), signedIn('wait', 'Tailscale is starting…'), sees('wait', others)],
        title: 'Tailscale is starting',
        failure: null,
        note: null,
        action: null,
        ready: false,
      };
    case 'signed-out':
      return {
        checks: [
          installed('ok'),
          { ...signedIn('no'), title: 'Not signed in', detail: 'Tailscale asks you to sign in.' },
          sees('wait', others),
        ],
        title: 'Sign in to Tailscale',
        failure: null,
        note: 'Sign in with the same account as your other computer. Redlines notices by itself.',
        action: status.auth_url ? 'sign-in' : 'open',
        ready: false,
      };
    case 'needs-approval':
      return {
        checks: [
          installed('ok'),
          signedIn('no', 'This Mac waits for the owner of the network to approve it.'),
          sees('wait', others),
        ],
        title: 'This Mac needs approval on your Tailscale network',
        failure: null,
        note:
          'The person who runs the network approves new computers in Tailscale’s admin page. ' +
          'Redlines notices by itself.',
        action: 'again',
        ready: false,
      };
    case 'no-peers':
    case 'ready': {
      const signedInDetail = [status.account, status.tailnet && `on the network ${status.tailnet}`]
        .filter(Boolean)
        .join(', ');
      const online = status.peers.filter((peer) => peer.online).length;
      if (status.state === 'no-peers') {
        return {
          checks: [
            installed('ok'),
            signedIn('ok', signedInDetail),
            sees('no', 'Can’t see any other computer', 'Sign in on the other computer, too.'),
          ],
          title: 'This Mac is on your Tailscale network, alone',
          failure: null,
          note:
            'Install Tailscale on the computer that runs your agent and sign in with the same ' +
            'account. Redlines notices by itself.',
          action: 'again',
          ready: false,
        };
      }
      if (status.blocked) {
        return {
          checks: [
            installed('ok'),
            signedIn('ok', signedInDetail),
            sees('no', 'Can’t reach your other computers', 'Tailscale can’t reach its servers.'),
          ],
          title: 'This network blocks Tailscale',
          failure: 'network-blocks',
          note: 'Try another network, such as a phone’s hotspot.',
          action: 'again',
          ready: false,
        };
      }
      const count = status.peers.length;
      return {
        checks: [
          installed('ok'),
          signedIn('ok', signedInDetail),
          sees(
            'ok',
            `Can see ${count} other ${plural(count, 'computer', 'computers')}`,
            `${online} ${plural(online, 'is', 'are')} on now`,
          ),
        ],
        title: 'This Mac is on your Tailscale network',
        failure: null,
        note: null,
        action: null,
        ready: true,
      };
    }
  }
}
