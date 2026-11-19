// The setup sheet of Preferences › Agents › Connect OpenClaw
// (docs/research/openclaw-connection.md, "The journey", and its mockups): Start, Check this Mac,
// Choose the computer, Ask your agent, Approval, Test and Done, with a gray card for every way it
// can fail. It draws from what its `deps` give, so that the same screens run in the app, in a plain
// browser with scripted answers, and in the tests.
//
// What it never does: show a secret. The setup code is typed or pasted into a secure field once,
// handed to `deps.node.connect` and cleared; the sheet keeps no copy and the prompt it writes has
// none (prompt.ts).

import { authorHandle, type NewOpenClawConnection } from './connection.ts';
import { failure, type FailureAction, type FailureId } from './failures.ts';
import { gatewayView, type GatewayProbe } from './gateway.ts';
import { failureOf, type NodeStatus } from './node.ts';
import {
  codeRequestPrompt,
  gatewayPrompt,
  localPrompt,
  setupPrompt,
  toolsPrompt,
} from './prompt.ts';
import { tailscaleView, type TailscaleStatus } from './tailscale.ts';

export type Step = 'start' | 'mac' | 'computer' | 'prompt' | 'approve' | 'test';

/** What the sheet asks of the app. Every call may reject, with a sentence to show. */
export interface SheetDeps {
  /** The person's handle, which the agent's author handle ends with (`moby-ada`). */
  owner: string;
  /** The handles taken now: the agents Redlines runs, and the connections made. */
  taken(): readonly string[];
  /** This Mac as its owner calls it. */
  thisMac(): Promise<string>;
  tailscale: {
    status(): Promise<TailscaleStatus>;
    openApp(): Promise<void>;
    download(): Promise<void>;
    /** Opens Tailscale's sign-in page, an address Tailscale gave. */
    signIn(url: string): Promise<void>;
  };
  probe(address: string, suffix: string | null): Promise<GatewayProbe>;
  /** Copies text to the clipboard. */
  copy(text: string): Promise<void>;
  /** Reads the clipboard, for Paste; absent where a page may not. */
  paste?: () => Promise<string>;
  connections: {
    /** Adds the connection, after the question of the system's; rejects when the person says no. */
    add(connection: NewOpenClawConnection): Promise<unknown>;
    remove(handle: string): Promise<unknown>;
    useToken(handle: string, token: string): Promise<unknown>;
  };
  node: {
    /** Connects with the setup code, or with the token kept when the code is null. */
    connect(handle: string, setupCode: string | null): Promise<void>;
    status(handle: string): Promise<NodeStatus | null>;
    stop(handle: string): Promise<void>;
  };
  /**
   * Asks the agent to fix a typo in a practice note through the connection. Absent where the app
   * can't yet: the last screen then says the agent is connected and finishes.
   */
  test?: {
    run(handle: string): Promise<{ answered: boolean; usedTools: boolean; line: string }>;
  };
  /** Waits, in milliseconds; the tests make them short. */
  poll?: { tailscale?: number; node?: number };
}

export interface SheetOptions {
  /** False once the pane is gone: late answers are dropped. */
  alive(): boolean;
  /** The sheet is finished or was cancelled. */
  onClose(): void;
  /** A connection was made or removed: the list is drawn again. */
  onChanged(): void;
  /** For screenshots and tests: the screen to open at, and what it knows. */
  start?: {
    step: Step;
    where?: 'this-mac' | 'other';
    tailscale?: TailscaleStatus;
    computer?: string;
    url?: string;
    agent?: string;
  };
}

/** A running sheet: its element, and a way to take it down. */
export interface Sheet {
  element: HTMLElement;
  dispose(): void;
}

type Where = 'this-mac' | 'other';

const LOCAL_URL = 'ws://127.0.0.1:18789';

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(
  label: string,
  onClick: () => void,
  options: { primary?: boolean; disabled?: boolean; ariaLabel?: string } = {},
): HTMLButtonElement {
  const node = el('button', `rl-pref-button${options.primary ? ' rl-oc-primary' : ''}`, label);
  node.type = 'button';
  node.disabled = options.disabled === true;
  if (options.ariaLabel) node.setAttribute('aria-label', options.ariaLabel);
  node.addEventListener('click', onClick);
  return node;
}

const MARKS = { ok: '✓', no: '–', wait: '' } as const;

/** A row of a checklist or a list of choices. */
function row(options: {
  mark?: 'ok' | 'no' | 'wait';
  radio?: 'on' | 'off';
  dot?: 'on' | 'off';
  title: string;
  detail?: string;
  dim?: boolean;
  selected?: boolean;
  action?: HTMLElement;
  onPick?: () => void;
}): HTMLElement {
  const root = el('div', 'rl-oc-row');
  if (options.dim) root.classList.add('rl-oc-dim');
  if (options.selected) root.classList.add('rl-oc-selected');
  if (options.mark) {
    const mark = el('span', `rl-oc-mark rl-oc-mark-${options.mark}`, MARKS[options.mark]);
    mark.setAttribute('aria-hidden', 'true');
    root.append(mark);
  }
  if (options.radio) {
    const radio = el('span', `rl-oc-radio${options.radio === 'on' ? ' rl-oc-radio-on' : ''}`);
    radio.setAttribute('aria-hidden', 'true');
    root.append(radio);
  }
  if (options.dot) {
    const dot = el('span', `rl-oc-dot${options.dot === 'off' ? ' rl-oc-dot-off' : ''}`);
    dot.setAttribute('aria-hidden', 'true');
    root.append(dot);
  }
  const text = el('div', 'rl-oc-row-text');
  text.append(el('b', undefined, options.title));
  if (options.detail) text.append(el('span', 'rl-oc-small', options.detail));
  root.append(text);
  if (options.action) root.append(options.action);
  if (options.onPick) {
    root.tabIndex = 0;
    root.setAttribute('role', 'radio');
    root.setAttribute('aria-checked', String(options.selected === true));
    root.setAttribute('aria-label', options.title);
    const pick = options.onPick;
    root.addEventListener('click', pick);
    root.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        pick();
      }
    });
  }
  return root;
}

/** The first label of a computer's name: `studio-mini.yak-bebop.ts.net` is `studio-mini`. */
function shortName(address: string): string {
  const bare = address.replace(/^wss?:\/\//i, '').replace(/[/:].*$/, '');
  return bare.split('.')[0] || bare;
}

/** The sheet. Append `element` where it should show. */
export function openSheet(deps: SheetDeps, options: SheetOptions): Sheet {
  const root = el('section', 'rl-oc-sheet');
  root.setAttribute('aria-label', 'Connect an OpenClaw agent');
  const body = el('div', 'rl-oc-body');
  root.append(body);

  const begin = options.start;
  let step: Step = begin?.step ?? 'start';
  let where: Where = begin?.where ?? 'other';
  let tailscale: TailscaleStatus | null = begin?.tailscale ?? null;
  let checkedAt = 0;
  let picked: string | null = begin?.computer ?? null;
  let typed = '';
  let probe: GatewayProbe | null = null;
  let probing = false;
  let url: string | null = begin?.url ?? null;
  let computer = begin?.computer ? shortName(begin.computer) : '';
  let mac = 'this Mac';
  let agentName = begin?.agent ?? '';
  let usingToken = false;
  let problem: string | null = null;
  let handle: string | null = null;
  let created = false;
  let node: NodeStatus | null = null;
  let pairingSince: number | null = null;
  let testing:
    { answered: boolean; usedTools: boolean; line: string } | 'running' | 'failed' | null = null;
  let probingConnect = false;
  /** The connection has been made and shown to work, or the sheet was finished: it stays. */
  let settled = false;
  /** Refreshes the prompt's text, which this Mac's name changes. */
  let refreshPrompt: (() => void) | null = null;
  let copied: string | null = null;
  let alive = true;
  const timers = new Set<ReturnType<typeof setTimeout>>();

  const live = () => alive && options.alive();
  const later = (run: () => void, ms: number) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      if (live()) run();
    }, ms);
    timers.add(timer);
  };

  void deps.thisMac().then(
    (name) => {
      if (!live()) return;
      mac = name;
      if (step === 'prompt') refreshPrompt?.();
    },
    () => {},
  );

  const stepsOf = (): Step[] =>
    where === 'this-mac'
      ? ['prompt', 'approve', 'test']
      : ['mac', 'computer', 'prompt', 'approve', 'test'];

  /** "Step 2 of 5" and a pip for each. */
  function stepLine(label: string): HTMLElement {
    const steps = stepsOf();
    const at = steps.indexOf(step);
    const line = el('div', 'rl-oc-steps');
    line.append(
      el('b', undefined, `Step ${at + 1} of ${steps.length}`),
      el('span', undefined, label),
    );
    const pips = el('span', 'rl-oc-pips');
    pips.setAttribute('aria-hidden', 'true');
    steps.forEach((_, index) => pips.append(el('i', index <= at ? 'rl-oc-pip-done' : undefined)));
    line.append(pips);
    return line;
  }

  function foot(hint: string | HTMLElement, ...buttons: HTMLElement[]): HTMLElement {
    const bar = el('div', 'rl-oc-foot');
    const left = el('div', 'rl-oc-small');
    left.append(hint);
    const right = el('div', 'rl-oc-foot-buttons');
    right.append(...buttons);
    bar.append(left, right);
    return bar;
  }

  function link(label: string, onClick: () => void): HTMLButtonElement {
    const node = el('button', 'rl-oc-link', label);
    node.type = 'button';
    node.addEventListener('click', onClick);
    return node;
  }

  /** The gray card of a failure: what happened, the one button, and Details when there is some. */
  function card(id: FailureId, detail: string | null = null): HTMLElement {
    const found = failure(id, { computer: computer || undefined, agent: agentName || undefined });
    const box = el('div', 'rl-oc-fail');
    box.dataset['failure'] = id;
    box.setAttribute('role', 'status');
    box.append(el('b', undefined, found.title), el('p', undefined, found.body));
    box.append(el('span', 'rl-oc-key', found.step));
    const action = button(
      copied === found.action ? 'Copied' : found.label,
      () => void act(found.action),
      {
        primary: true,
      },
    );
    box.append(action);
    if (detail) {
      const more = el('details', 'rl-oc-details');
      more.append(el('summary', undefined, 'Details'), el('p', 'rl-oc-small', detail));
      box.append(more);
    }
    return box;
  }

  async function copy(action: FailureAction, text: string): Promise<void> {
    try {
      await deps.copy(text);
      copied = action;
      problem = null;
    } catch {
      problem = 'Redlines couldn’t copy that.';
    }
    if (live()) draw();
    later(() => {
      if (copied === action) {
        copied = null;
        draw();
      }
    }, 1500);
  }

  const promptInput = () => ({
    mac,
    macAddress: tailscale?.this_mac ?? null,
    agent: agentName.trim() || 'your agent',
  });

  /** What each card's button does. */
  async function act(action: FailureAction): Promise<void> {
    switch (action) {
      case 'open-tailscale':
        await deps.tailscale.openApp().catch(() => {});
        return;
      case 'download-tailscale':
        await deps.tailscale.download().catch(() => {});
        return;
      case 'check-again':
        if (step === 'mac') return void checkTailscale();
        return void lookAt(picked ?? typed);
      case 'copy-setup-prompt':
        return copy(action, gatewayPrompt(promptInput()));
      case 'copy-code-request':
        await copy(action, codeRequestPrompt());
        // A new code is pasted where the first one was.
        step = 'prompt';
        node = null;
        draw();
        return;
      case 'copy-tools-prompt':
        return copy(action, toolsPrompt(promptInput()));
      case 'ask-again':
      case 'try-again':
      case 'reconnect':
        return void reconnect();
    }
  }

  // ---- Start

  function drawStart(): HTMLElement[] {
    const choose = (next: Where) => {
      where = next;
      draw();
    };
    const mine = row({
      radio: where === 'this-mac' ? 'on' : 'off',
      title: 'On this Mac',
      detail: 'OpenClaw is installed here. Redlines will find it.',
      selected: where === 'this-mac',
      onPick: () => choose('this-mac'),
    });
    const other = row({
      radio: where === 'other' ? 'on' : 'off',
      title: 'On another computer',
      detail: 'A Mac, a Linux machine or a server. Redlines reaches it privately, over Tailscale.',
      selected: where === 'other',
      onPick: () => choose('other'),
    });
    const choices = el('div', 'rl-oc-choices');
    choices.setAttribute('role', 'radiogroup');
    choices.setAttribute('aria-label', 'Where your agent runs');
    choices.append(mine, other);
    return [
      el('h1', undefined, 'Add an OpenClaw agent'),
      el(
        'p',
        'rl-oc-sub',
        'Your agent writes in your documents as tracked changes, in its own name. You decide which folders it may touch.',
      ),
      choices,
      el(
        'p',
        'rl-oc-small rl-oc-gap',
        'Not sure? If you talk to your agent in Telegram, Slack or the OpenClaw app, and it runs on a different machine than this one, choose “On another computer”.',
      ),
      foot(
        'About 5 minutes. You can stop at any step.',
        button('Cancel', close),
        button(
          'Continue',
          () => {
            step = where === 'this-mac' ? 'prompt' : 'mac';
            if (where === 'this-mac') {
              url = LOCAL_URL;
              computer = 'this Mac';
            }
            draw();
          },
          { primary: true },
        ),
      ),
    ];
  }

  // ---- Check this Mac

  function checkTailscale(): void {
    void deps.tailscale.status().then(
      (status) => {
        if (!live()) return;
        tailscale = status;
        checkedAt = Date.now();
        if (step === 'mac' || step === 'computer') draw();
      },
      () => {},
    );
  }

  function pollTailscale(): void {
    if (!live() || step !== 'mac') return;
    checkTailscale();
    later(pollTailscale, deps.poll?.tailscale ?? 3000);
  }

  function drawMac(): HTMLElement[] {
    const nodes: HTMLElement[] = [stepLine('This Mac')];
    if (tailscale === null) {
      nodes.push(el('h1', undefined, 'Checking Tailscale…'));
      nodes.push(
        foot(
          'Looking at this Mac.',
          button('Back', () => go('start')),
          button('Continue', () => {}, { disabled: true }),
        ),
      );
      return nodes;
    }
    const view = tailscaleView(tailscale);
    nodes.push(el('h1', undefined, view.title));
    nodes.push(
      el(
        'p',
        'rl-oc-sub',
        view.ready
          ? 'Redlines can see your other computers. It never changes Tailscale’s settings.'
          : 'Tailscale makes a private network between your own computers. Nothing is opened to the internet, and the free plan is enough.',
      ),
    );
    for (const check of view.checks) {
      nodes.push(
        row({
          mark: check.mark,
          title: check.title,
          ...(check.detail ? { detail: check.detail } : {}),
          dim: check.mark === 'wait',
        }),
      );
    }
    if (view.failure) {
      nodes.push(card(view.failure));
    } else if (view.action) {
      const status = tailscale;
      const label = {
        download: 'Download Tailscale',
        open: 'Open Tailscale',
        'sign-in': 'Sign in to Tailscale',
        again: 'Check again',
      }[view.action];
      const run = () => {
        if (view.action === 'sign-in' && status.auth_url)
          void deps.tailscale.signIn(status.auth_url).catch(() => {});
        else if (view.action === 'open') void deps.tailscale.openApp().catch(() => {});
        else if (view.action === 'download') void deps.tailscale.download().catch(() => {});
        else checkTailscale();
      };
      nodes.push(button(label, run, { primary: true }));
    }
    if (view.note && !view.failure) nodes.push(el('div', 'rl-oc-note', view.note));
    const hint = el('span');
    hint.append(checkedAt ? 'Checked just now · ' : '', link('Check again', checkTailscale));
    const manual = link('Enter an address instead', () => {
      picked = null;
      go('computer');
    });
    const left = el('span');
    left.append(hint, el('span', undefined, ' · '), manual);
    nodes.push(
      foot(
        left,
        button('Back', () => go('start')),
        button('Continue', () => go('computer'), { primary: true, disabled: !view.ready }),
      ),
    );
    return nodes;
  }

  // ---- Choose the computer

  async function lookAt(address: string): Promise<void> {
    const text = address.trim();
    if (!text) return;
    probing = true;
    probe = null;
    draw();
    const result = await deps
      .probe(text, tailscale?.tailnet ?? null)
      .catch((error: unknown): GatewayProbe => ({
        kind: 'bad-address',
        message: error instanceof Error ? error.message : String(error),
      }));
    if (!live()) return;
    probing = false;
    probe = result;
    if (result.kind === 'found') {
      url = result.url;
      computer = shortName(result.host);
    } else {
      url = null;
    }
    draw();
  }

  function drawComputer(): HTMLElement[] {
    const peers = tailscale?.peers ?? [];
    const nodes: HTMLElement[] = [
      stepLine('The computer'),
      el('h1', undefined, 'Which computer runs your agent?'),
    ];
    if (peers.length > 0) {
      const list = el('div', 'rl-oc-list');
      list.setAttribute('role', 'radiogroup');
      list.setAttribute('aria-label', 'Computers on your Tailscale network');
      for (const peer of peers) {
        const detail = [
          peer.dns_name,
          peer.os,
          peer.online
            ? 'on now'
            : peer.last_seen
              ? `last seen ${peer.last_seen.slice(0, 10)}`
              : 'off',
        ]
          .filter(Boolean)
          .join(' · ');
        list.append(
          row({
            radio: picked === peer.dns_name ? 'on' : 'off',
            dot: peer.online ? 'on' : 'off',
            title: peer.name,
            detail,
            dim: !peer.online,
            selected: picked === peer.dns_name,
            ...(peer.online
              ? {
                  onPick: () => {
                    picked = peer.dns_name;
                    typed = '';
                    void lookAt(peer.dns_name);
                  },
                }
              : {}),
          }),
        );
      }
      nodes.push(list);
    }
    nodes.push(
      el(
        'p',
        'rl-oc-small rl-oc-gap',
        peers.length > 0
          ? 'Not listed? Type its Tailscale name or address'
          : 'Type its Tailscale name or address',
      ),
    );
    const field = el('input', 'rl-pref-text rl-oc-field');
    field.type = 'text';
    field.placeholder = `name.${tailscale?.tailnet ?? 'your-network.ts.net'}`;
    field.value = typed;
    field.autocomplete = 'off';
    field.spellcheck = false;
    field.setAttribute('aria-label', 'Tailscale name or address');
    field.addEventListener('input', () => {
      typed = field.value;
    });
    field.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        picked = null;
        void lookAt(field.value);
      }
    });
    const look = button('Look', () => {
      picked = null;
      void lookAt(field.value);
    });
    const inline = el('div', 'rl-oc-inline');
    inline.append(field, look);
    nodes.push(inline);

    const status = el('div', 'rl-oc-status');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    if (probing) {
      status.append(el('div', 'rl-oc-note', 'Looking for OpenClaw…'));
    } else if (probe) {
      const view = gatewayView(probe, computer || shortName(picked ?? typed));
      if (view.found) {
        const note = el('div', 'rl-oc-note');
        note.append(el('span', 'rl-oc-mark rl-oc-mark-ok', '✓'));
        const text = el('span');
        text.append(el('b', undefined, view.title), ` ${view.line}`);
        note.append(text);
        status.append(note);
      } else if (view.failure) {
        status.append(card(view.failure, view.detail));
      } else {
        status.append(el('div', 'rl-oc-note', `${view.title} ${view.line}`));
      }
    }
    nodes.push(status);
    nodes.push(
      foot(
        'Redlines asks only the computer you pick.',
        button('Back', () => go('mac')),
        button('Continue', () => go('prompt'), {
          primary: true,
          disabled: probe?.kind !== 'found',
        }),
      ),
    );
    return nodes;
  }

  // ---- Ask your agent

  function drawPrompt(): HTMLElement[] {
    const nodes: HTMLElement[] = [stepLine('Your agent')];
    nodes.push(el('h1', undefined, 'Ask your agent to set up its side'));
    nodes.push(
      el(
        'p',
        'rl-oc-sub',
        where === 'this-mac'
          ? 'Send this to your OpenClaw in the chat you usually use. It answers with a short code.'
          : `Send this to your OpenClaw in the chat you usually use. It does the work on ${computer || 'the other computer'} and answers with a short code.`,
      ),
    );

    const name = el('input', 'rl-pref-text rl-oc-field');
    name.type = 'text';
    name.placeholder = 'What do you call your agent? For example Moby';
    name.value = agentName;
    name.autocomplete = 'off';
    name.spellcheck = false;
    name.setAttribute('aria-label', 'Your agent’s name');
    const writes = el('div', 'rl-oc-small');
    const pre = el('pre', 'rl-oc-pre');
    pre.tabIndex = 0;
    pre.setAttribute('aria-label', 'The prompt for your agent');
    const connect = button('Connect', () => void connectNow(), { primary: true, disabled: true });
    const secret = el('input', 'rl-pref-text rl-oc-field rl-oc-secret');
    secret.type = 'password';
    secret.placeholder = usingToken ? 'Token' : 'Setup code';
    secret.autocomplete = 'off';
    secret.spellcheck = false;
    secret.setAttribute('aria-label', usingToken ? 'Token' : 'Setup code');
    const refresh = () => {
      const trimmed = agentName.trim();
      const text = where === 'this-mac' ? localPrompt(promptInput()) : setupPrompt(promptInput());
      pre.textContent = text;
      const made = trimmed ? authorHandle(trimmed, deps.owner) : '';
      const clash = made && deps.taken().includes(made) && made !== handle;
      writes.textContent = trimmed
        ? clash
          ? `Another agent already writes as ${made}. Choose another name.`
          : `It will write as ${made}.`
        : '';
      connect.disabled = !trimmed || Boolean(clash) || secret.value.trim() === '' || probingConnect;
    };
    refreshPrompt = refresh;
    name.addEventListener('input', () => {
      agentName = name.value;
      refresh();
    });
    secret.addEventListener('input', refresh);
    secret.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !connect.disabled) void connectNow();
    });

    async function connectNow(): Promise<void> {
      const trimmed = agentName.trim();
      const code = secret.value.trim();
      if (!trimmed || !code) return;
      probingConnect = true;
      problem = null;
      refresh();
      const made = handle ?? authorHandle(trimmed, deps.owner);
      try {
        if (!created) {
          await deps.connections.add({
            handle: made,
            name: trimmed,
            computer: computer || 'this Mac',
            url: url ?? LOCAL_URL,
            folders: [],
          });
          created = true;
          handle = made;
          options.onChanged();
          // Cancelled while the question was up: what it just made goes again.
          if (!alive) return void undo(made);
        }
        if (usingToken) {
          await deps.connections.useToken(made, code);
          secret.value = '';
          await deps.node.connect(made, null);
        } else {
          const given = code;
          secret.value = '';
          await deps.node.connect(made, given);
        }
      } catch (error) {
        probingConnect = false;
        if (!live()) return;
        problem = error instanceof Error ? error.message : String(error);
        draw();
        return;
      }
      probingConnect = false;
      if (!alive) return void undo(made);
      if (!live()) return;
      node = { state: 'connecting' };
      pairingSince = null;
      step = 'approve';
      draw();
    }

    nodes.push(name, writes);
    nodes.push(pre);
    const copyRow = el('div', 'rl-oc-between');
    const copyButton = button('Copy prompt', () => {
      if (!agentName.trim()) {
        problem = 'Give your agent a name first: the prompt uses it.';
        draw();
        return;
      }
      // The button changes its own label: drawing the screen again would empty the code's field.
      void deps.copy(pre.textContent ?? '').then(
        () => {
          copyButton.textContent = 'Copied';
          later(() => {
            copyButton.textContent = 'Copy prompt';
          }, 1500);
        },
        () => {
          copyButton.textContent = 'Couldn’t copy';
        },
      );
    });
    copyRow.append(
      el('span', 'rl-oc-small', 'Nothing changes until your agent does it.'),
      copyButton,
    );
    nodes.push(copyRow);

    const section = el('div', 'rl-oc-section');
    section.append(
      el(
        'h2',
        undefined,
        usingToken
          ? 'Paste the token from your Gateway'
          : 'When your agent answers with a setup code, paste it here',
      ),
    );
    const inline = el('div', 'rl-oc-inline');
    inline.append(secret);
    if (deps.paste) {
      const paste = deps.paste;
      inline.append(
        button('Paste', () => {
          void paste().then(
            (text) => {
              secret.value = text.trim();
              refresh();
              secret.focus();
            },
            () => {},
          );
        }),
      );
    }
    section.append(inline);
    section.append(
      el(
        'p',
        'rl-oc-small',
        usingToken
          ? 'Redlines keeps it in a private file and never shows it again.'
          : 'Works once, for about 10 minutes. Redlines keeps what it gets in a private file and never shows it again.',
      ),
    );
    nodes.push(section);
    if (problem) {
      const line = el('div', 'rl-oc-problem', problem);
      line.setAttribute('role', 'status');
      nodes.push(line);
    }
    const alt = el('span');
    alt.append(
      link(usingToken ? 'I have a setup code' : 'I have a token instead', () => {
        usingToken = !usingToken;
        draw();
      }),
    );
    nodes.push(
      foot(
        alt,
        button('Cancel', () => void cancel()),
        button('Back', () => go(where === 'this-mac' ? 'start' : 'computer')),
        connect,
      ),
    );
    refresh();
    queueMicrotask(() => (agentName ? secret : name).focus());
    return nodes;
  }

  // ---- Approval

  function pollNode(): void {
    if (!live() || step !== 'approve' || !handle) return;
    const asked = handle;
    void deps.node.status(asked).then(
      (status) => {
        if (!live() || step !== 'approve') return;
        const changed = JSON.stringify(status) !== JSON.stringify(node);
        node = status;
        if (status?.state === 'pairing' && pairingSince === null) pairingSince = Date.now();
        if (status?.state === 'connected') {
          settled = true;
          step = 'test';
          draw();
          return;
        }
        // Drawn again when it changed, and each second while it waits, for "Asked 40 seconds ago".
        if (changed || status?.state === 'pairing') draw();
        // A connection that failed stays failed: nothing more to look at.
        if (status?.state === 'failed') return;
        later(pollNode, deps.poll?.node ?? 1000);
      },
      () => later(pollNode, deps.poll?.node ?? 1000),
    );
  }

  /** Connects again with what was kept; with nothing kept, asks for a new code. */
  async function reconnect(): Promise<void> {
    if (!handle) return;
    problem = null;
    try {
      await deps.node.connect(handle, null);
      node = { state: 'connecting' };
      pairingSince = null;
      step = 'approve';
      draw();
    } catch (error) {
      const said = error instanceof Error ? error.message : String(error);
      step = 'prompt';
      problem = /no setup code or token/i.test(said)
        ? 'Redlines needs a new setup code for this.'
        : said;
      draw();
    }
  }

  function drawApprove(): HTMLElement[] {
    const nodes: HTMLElement[] = [stepLine('Approve')];
    const failed = node ? failureOf(node) : null;
    if (failed) {
      nodes.push(el('h1', undefined, 'The connection stopped'));
      nodes.push(card(failed.id, failed.detail));
      nodes.push(
        foot(
          'Nothing was changed in any document.',
          button('Cancel', () => void cancel()),
        ),
      );
      return nodes;
    }
    const pairing = node?.state === 'pairing' ? node : null;
    const reached = node !== null && node.state !== 'connecting';
    nodes.push(
      el(
        'h1',
        undefined,
        pairing?.again
          ? 'Waiting for your agent to approve this Mac again'
          : pairing
            ? 'Waiting for your agent to approve this Mac'
            : 'Connecting…',
      ),
    );
    nodes.push(
      el(
        'p',
        'rl-oc-sub',
        pairing?.again
          ? 'This Mac was connected before, and its details changed. Approving it replaces the sign-in Redlines kept, so afterwards you will need a new setup code.'
          : pairing
            ? 'Your agent sees a request from “Redlines on ' +
              mac +
              '”. It should show you the code below. If the codes match, tell it yes.'
            : 'Redlines is reaching the Gateway with your setup code.',
      ),
    );
    const code = el('div', 'rl-oc-code', pairing?.code ?? '···-···');
    code.setAttribute('aria-label', pairing ? `Approval code ${pairing.code}` : 'No code yet');
    const wrap = el('div', 'rl-oc-center');
    wrap.append(code);
    nodes.push(wrap);
    const seconds =
      pairingSince === null ? 0 : Math.max(0, Math.round((Date.now() - pairingSince) / 1000));
    nodes.push(
      row({ mark: reached ? 'ok' : 'wait', title: 'This Mac reached the Gateway' }),
      row({
        mark: 'wait',
        title: 'Approve this Mac',
        dim: !pairing,
        ...(pairing
          ? {
              detail: `Asked ${seconds} ${seconds === 1 ? 'second' : 'seconds'} ago. The request lasts 5 minutes.`,
            }
          : {}),
      }),
      row({
        mark: 'wait',
        title: 'Approve the Redlines tools',
        detail: 'One kind of tool: read, and suggest changes in, your documents',
        dim: true,
      }),
    );
    nodes.push(
      foot(
        'Nothing to type here. Waiting…',
        button('Cancel', () => void cancel()),
        button('Ask again', () => void reconnect()),
      ),
    );
    return nodes;
  }

  /** Takes a connection that was not finished away again: stops it, and removes its record. */
  async function undo(made: string): Promise<void> {
    await deps.node.stop(made).catch(() => {});
    await deps.connections.remove(made).catch(() => {});
    options.onChanged();
  }

  /** Cancel: the sheet goes, and taking it down undoes what it began (`dispose`). */
  function cancel(): void {
    close();
  }

  // ---- Test and Done

  function runTest(): void {
    if (!deps.test || !handle) return;
    testing = 'running';
    draw();
    void deps.test.run(handle).then(
      (result) => {
        if (!live()) return;
        testing = result;
        draw();
      },
      () => {
        if (!live()) return;
        testing = 'failed';
        draw();
      },
    );
  }

  function drawTest(): HTMLElement[] {
    const nodes: HTMLElement[] = [stepLine('Test')];
    const name = agentName.trim() || 'Your agent';
    if (!deps.test) {
      nodes.push(el('h1', undefined, `${name} is connected.`));
      nodes.push(
        el(
          'p',
          'rl-oc-sub',
          `${name} can see the Redlines tools on its Gateway. Asking ${name} from a comment through this connection comes in a later version of Redlines.`,
        ),
      );
      nodes.push(
        row({
          mark: 'ok',
          title: `${name} is connected`,
          detail: 'Redlines connects again by itself if the connection drops.',
        }),
      );
      nodes.push(
        foot(
          'Folders and the level can be changed in Preferences › Agents.',
          button('Finish', finish, { primary: true }),
        ),
      );
      return nodes;
    }
    nodes.push(el('h1', undefined, `${name} is connected. One quick test.`));
    nodes.push(
      el(
        'p',
        'rl-oc-sub',
        `Redlines made a practice note and asked ${name} to fix one typo in it. That uses the road your real requests will use.`,
      ),
    );
    if (testing === null) {
      nodes.push(button('Run the test', runTest, { primary: true }));
    } else if (testing === 'running') {
      nodes.push(el('div', 'rl-oc-note', `Waiting for ${name}…`));
    } else if (testing === 'failed') {
      nodes.push(card('agent-silent'));
    } else {
      nodes.push(
        row({
          mark: testing.answered ? 'ok' : 'no',
          title: `${name} answered`,
          detail: testing.line,
        }),
        row({
          mark: testing.usedTools ? 'ok' : 'no',
          title: `${name} used the Redlines tools`,
          ...(testing.usedTools
            ? { detail: 'Suggested one change, as a tracked change in its name' }
            : {}),
        }),
      );
      if (!testing.usedTools) nodes.push(card('tools-unavailable'));
    }
    nodes.push(
      foot(
        'The practice note is deleted when you finish.',
        button('Run again', runTest, { disabled: testing === 'running' }),
        button('Finish', finish, { primary: true }),
      ),
    );
    return nodes;
  }

  function finish(): void {
    settled = true;
    options.onChanged();
    close();
  }

  // ---- The frame

  function go(next: Step): void {
    step = next;
    problem = null;
    draw();
  }

  function close(): void {
    dispose();
    options.onClose();
  }

  function dispose(): void {
    // A sheet taken down before the connection reached its test leaves no half-made agent.
    if (alive && created && !settled && handle) void undo(handle);
    alive = false;
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    root.remove();
  }

  function draw(): void {
    if (!live()) return;
    const hadFocus = body.contains(document.activeElement);
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // What had the focus, by its label or its words: the screen is drawn again, new elements.
    const keep = focused
      ? (focused.getAttribute('aria-label') ?? `${focused.tagName}:${focused.textContent ?? ''}`)
      : null;
    let content: HTMLElement[];
    switch (step) {
      case 'start':
        content = drawStart();
        break;
      case 'mac':
        content = drawMac();
        break;
      case 'computer':
        content = drawComputer();
        break;
      case 'prompt':
        content = drawPrompt();
        break;
      case 'approve':
        content = drawApprove();
        break;
      case 'test':
        content = drawTest();
        break;
    }
    body.replaceChildren(...content);
    body.dataset['step'] = step;
    if (hadFocus && keep) {
      const again = [
        ...body.querySelectorAll<HTMLElement>('button, input, [role="radio"], summary'),
      ].find(
        (node) =>
          (node.getAttribute('aria-label') ?? `${node.tagName}:${node.textContent ?? ''}`) === keep,
      );
      again?.focus();
    }
    enter();
  }

  /** The first time a screen is drawn, what it polls or runs starts. */
  let lastEntered: Step | null = null;
  function enter(): void {
    if (lastEntered === step) return;
    lastEntered = step;
    if (step === 'mac') pollTailscale();
    if (step === 'computer' && tailscale === null) checkTailscale();
    if (step === 'approve') pollNode();
    if (step === 'test' && deps.test) runTest();
  }

  if (step === 'approve' || step === 'test') {
    handle ??= authorHandle(agentName || 'agent', deps.owner);
    created = true;
  }
  draw();

  return {
    element: root,
    dispose,
  };
}
