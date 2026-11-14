// The OpenClaw section of the Agents pane (design §8.6, OpenClaw): the agents of an OpenClaw Gateway
// that the person added, and the form that adds one. An OpenClaw agent answers through its Gateway,
// which may run on another machine, by `openclaw acp`: the person gives its name (what they write
// after an @), the Gateway's address and the path of the file that holds its token. Redlines passes
// the path to `openclaw` and never reads the file, and the app asks the person before it keeps
// anything. The host keeps the list (an Agent Client Protocol agent whose command this writes,
// `openClawCommand`) and says no, with a line to show, to what it won't run.
// Its classes are the Preferences window's (apps/desktop/src/preferences/preferences.css).

import { button, el, reasonOf, row, textField } from './pane-dom.ts';
import { skillControls, type PaneSkill } from './skill-controls.ts';

/** An OpenClaw agent the person added, as the pane shows it. */
export interface OpenClawAgent {
  id: string;
  /** What people see, and write after an @. */
  name: string;
  /** The Gateway's address: `wss://…`, or `ws://` for one on this Mac or its network. */
  url: string;
  /** The path of the file that holds the Gateway's token, which only `openclaw` reads. */
  tokenFile: string;
  /** The agent's id in OpenClaw, when the person named one; else the Gateway's default answers. */
  agent?: string;
}

/** What the person gives to add one. */
export interface OpenClawInput {
  name: string;
  url: string;
  tokenFile: string;
  agent?: string;
}

export interface OpenClawDeps {
  list(): Promise<OpenClawAgent[]>;
  /** The host asks the person first, and rejects with a line to show when they say no. */
  add(input: OpenClawInput): Promise<OpenClawAgent[]>;
  remove(id: string): Promise<OpenClawAgent[]>;
  /**
   * The Redlines skill for OpenClaw on this Mac, which only an agent on a Gateway here can use
   * (an OpenClaw elsewhere reads that machine's folders). Without it, the section offers none.
   */
  skill?: PaneSkill;
}

/** Whether a Gateway's address is on this Mac: its host is the machine's own. */
export function isLocalGateway(url: string): boolean {
  const host = /^wss?:\/\/(\[[0-9a-f:]+\]|[^/:?#]+)/i.exec(url)?.[1]?.toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
}

/** A word of a command as the host reads it: plain, or in the quotes it has none of. */
function word(text: string): string {
  if (/^[\w./:@,+%=-]+$/.test(text)) return text;
  if (!text.includes("'")) return `'${text}'`;
  if (!text.includes('"')) return `"${text}"`;
  throw new Error('A name here can’t hold both kinds of quote.');
}

/**
 * The command the host is asked to allow: `openclaw acp --url <address> --token-file <file>`, and
 * `--session agent:<id>:main` after them when the person names an agent. It holds no token and no
 * password, which the host would refuse.
 */
export function openClawCommand(input: OpenClawInput): string {
  const agent = input.agent?.trim();
  return [
    'openclaw',
    'acp',
    '--url',
    input.url.trim(),
    '--token-file',
    input.tokenFile.trim(),
    ...(agent ? ['--session', `agent:${agent}:main`] : []),
  ]
    .map(word)
    .join(' ');
}

/** The OpenClaw agents among the host's Agent Client Protocol agents, as the pane shows them. */
export function openClawAgents(
  entries: readonly {
    id: string;
    name: string;
    args: readonly string[];
    bridge?: { agent?: string };
  }[],
): OpenClawAgent[] {
  return entries.flatMap(({ id, name, args, bridge }) => {
    const after = (flag: string) => {
      const at = args.indexOf(flag);
      return at < 0 ? undefined : args[at + 1];
    };
    const url = after('--url');
    const tokenFile = after('--token-file');
    if (bridge === undefined || url === undefined || tokenFile === undefined) return [];
    return [
      { id, name, url, tokenFile, ...(bridge.agent === undefined ? {} : { agent: bridge.agent }) },
    ];
  });
}

/**
 * The section: the agents, Add OpenClaw Agent… with its form, and what it means, said plainly. A
 * change shows only once the host has made it. `alive` stops late answers from being drawn once the
 * pane is gone.
 */
export function renderOpenClaw(
  deps: OpenClawDeps,
  options: {
    alive: () => boolean;
    showGeneral?: () => void;
    /** Called with an agent's id once it is removed: what the person allowed it goes with it. */
    forgetAnswers?: (id: string) => void;
  },
): HTMLElement {
  const { alive } = options;
  const control = el('div', 'rl-pref-list');
  const items = el('div', 'rl-pref-list');
  const adding = el('div');
  const problem = el('div', 'rl-pref-note rl-pref-failure');
  problem.setAttribute('role', 'status');
  const note = el(
    'div',
    'rl-pref-note',
    'Agents of an OpenClaw Gateway, reached with the openclaw command, which has to be installed ' +
      'on this Mac. Write @ and the name in a comment: the document and that comment thread go to ' +
      'the Gateway, wherever it runs, and the agent’s last message is posted as a reply. It can’t ' +
      'change the document. Redlines passes the token file’s path to openclaw and never reads ' +
      'the file.',
  );

  // The skill is for an OpenClaw on this Mac: it is looked at only where an agent's Gateway is here.
  const skill = deps.skill
    ? skillControls({
        agent: { name: 'OpenClaw', skill: deps.skill },
        alive,
        showGeneral: () => options.showGeneral?.(),
        canGeneral: options.showGeneral !== undefined,
        fallbackFocus: () => items.querySelector('button') ?? adding.querySelector('button'),
      })
    : undefined;

  // What the skill is for, said where it is offered: an address on this Mac may be the end of a
  // tunnel to a Gateway elsewhere, which this can't tell, and that OpenClaw reads its own folders.
  const skillNote = el(
    'div',
    'rl-pref-note',
    'The skill is for an OpenClaw that runs on this Mac. One on another machine, even one you ' +
      'reach through a tunnel at 127.0.0.1, needs the skill copied there: the command is in ' +
      'Redlines’ README.',
  );
  const skillWhere = el('div');

  const show = (list: OpenClawAgent[]) => {
    if (!alive()) return;
    items.replaceChildren(
      ...list.map((agent) => {
        const item = el('div', 'rl-pref-item');
        item.dataset['agent'] = agent.id;
        const what = el('div', 'rl-pref-item-text');
        what.append(
          el('span', undefined, agent.name),
          el('span', 'rl-pref-note', agent.url),
          el('span', 'rl-pref-note', agent.tokenFile),
          ...(agent.agent === undefined
            ? []
            : [el('span', 'rl-pref-note', `OpenClaw agent: ${agent.agent}`)]),
        );
        const remove = button('Remove', `Remove ${agent.name}`);
        remove.addEventListener('click', () => {
          void change(() => deps.remove(agent.id)).then((done) => {
            if (!done) return;
            options.forgetAnswers?.(agent.id);
            if (alive()) keepFocus('agents');
          });
        });
        item.append(what, remove);
        return item;
      }),
    );
    const local = list.some((agent) => isLocalGateway(agent.url));
    skill?.look(local);
    skillWhere.replaceChildren(...(skill && local ? [skillNote] : []));
  };

  /**
   * A button that has the focus goes when the list or the form is drawn again: the focus goes to
   * another button of the section, the next agent's Remove or Add, and never falls to the page.
   */
  const keepFocus = (prefer: 'agents' | 'add') => {
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected) return;
    const agents = items.querySelector('button');
    const add = adding.querySelector('button');
    (prefer === 'agents' ? (agents ?? add) : (add ?? agents))?.focus();
  };

  /** Makes a change through the host, which asks the person, and shows the list it then has. */
  const change = (making: () => Promise<OpenClawAgent[]>): Promise<boolean> => {
    problem.textContent = '';
    let started: Promise<OpenClawAgent[]>;
    try {
      started = making();
    } catch (error) {
      started = Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
    return started.then(
      (list) => {
        show(list);
        return true;
      },
      (error: unknown) => {
        if (alive()) problem.textContent = reasonOf(error);
        return false;
      },
    );
  };

  const closed = () => {
    const open = button('Add OpenClaw Agent…');
    open.addEventListener('click', () => adding.replaceChildren(...form()));
    return [open];
  };

  const form = () => {
    const name = textField('Name', 'Name, such as Moby');
    const url = textField('Gateway address', 'Gateway, such as wss://gateway.example.org');
    const file = textField('Token file', 'Token file, such as /Users/you/.openclaw/gateway-token');
    const agent = textField(
      'OpenClaw agent',
      'Agent in OpenClaw, if it isn’t the default (optional)',
    );
    const add = button('Add');
    const cancel = button('Cancel');
    const ready = () => {
      add.disabled = !name.value.trim() || !url.value.trim() || !file.value.trim();
    };
    ready();
    for (const field of [name, url, file]) field.addEventListener('input', ready);
    add.addEventListener('click', () => {
      add.disabled = true;
      const input: OpenClawInput = {
        name: name.value.trim(),
        url: url.value.trim(),
        tokenFile: file.value.trim(),
        ...(agent.value.trim() ? { agent: agent.value.trim() } : {}),
      };
      void change(() => deps.add(input)).then((done) => {
        if (!alive()) return;
        if (done) {
          adding.replaceChildren(...closed());
          keepFocus('add');
        } else {
          ready();
        }
      });
    });
    cancel.addEventListener('click', () => {
      problem.textContent = '';
      adding.replaceChildren(...closed());
      keepFocus('add');
    });
    const pairs = el('div', 'rl-pref-list');
    const first = el('div', 'rl-pref-pair');
    first.append(name, agent);
    const second = el('div', 'rl-pref-pair');
    second.append(url, file);
    pairs.append(first, second);
    const buttons = el('div', 'rl-pref-inline');
    buttons.append(add, cancel);
    queueMicrotask(() => name.focus());
    return [pairs, buttons];
  };

  adding.append(...closed());
  control.append(items, adding, problem, note, ...(skill ? [...skill.nodes, skillWhere] : []));
  void deps.list().then(show, (error: unknown) => {
    if (alive()) problem.textContent = `Couldn’t list the OpenClaw agents: ${reasonOf(error)}`;
  });
  return row('OpenClaw', control);
}
