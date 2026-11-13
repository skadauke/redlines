// The Agents pane of Preferences (design, Preferences and The log): the agents found on this Mac,
// their state and the next step for each (Update, Sign In, or the command that installs it, and
// Check Again always), what agents may read, the answers remembered per folder, and the logs.
// Where the host keeps a list of other agents (any agent that speaks the Agent Client Protocol, as
// a name and a command), they are listed too; the app keeps that list out of the pane for now.
// The window it draws in is the app's; this knows only the rows, and takes what it needs from
// `deps`.
// Its classes are the Preferences window's (apps/desktop/src/preferences/preferences.css).

import type { AgentState } from '@redlines/plugin-api';

/** The part of the app's settings this pane reads and changes. */
export interface AgentsPaneSettings {
  agentScope: 'folder' | 'document';
  /** What the person allowed each agent, keyed `agent|folder`. */
  consent: Record<string, 'folder' | 'document' | 'no'>;
}

/** An agent the person added, as the pane shows it. */
export interface OtherAgent {
  id: string;
  name: string;
  /** The program and its arguments, as the person allowed them. */
  command: string;
}

/** What an update or a sign-in said when it ended. */
export interface SetupResult {
  ok: boolean;
  /** One line of what it said, for the line that tells why it failed. */
  message: string;
  /** It ended at once without signing in, as a login that wants a terminal does. */
  needsTerminal?: boolean;
}

/** An agent of the pane, and what the host can do about it. */
export interface PaneAgent {
  id: string;
  name: string;
  /** `fresh` asks the program again, where the host keeps what it found. */
  detect(fresh?: boolean): Promise<AgentState>;
  /** Runs the agent's own updater, for the way it was installed, which the host knows. */
  update?(): Promise<SetupResult>;
  /** Runs the agent's own login, which opens the browser; Redlines never sees the credentials. */
  signIn?(): Promise<SetupResult>;
  /** Opens Terminal with the login's command, for a login that needs one. */
  signInInTerminal?(): Promise<void>;
}

export interface AgentsPaneDeps {
  /** The agents to list. Each is asked when the pane is drawn, never before. */
  agents: readonly PaneAgent[];
  /** Puts text on the clipboard, for the install command's Copy. Without it, there is no Copy. */
  copy?(text: string): Promise<void>;
  /**
   * The other agents, where the host keeps a list. Adding and removing ask the person first, in
   * the host's own question, and reject with a line to show when they say no.
   */
  others?: {
    list(): Promise<OtherAgent[]>;
    add(name: string, command: string): Promise<OtherAgent[]>;
    remove(id: string): Promise<OtherAgent[]>;
  };
  settings(): AgentsPaneSettings;
  update(change: Partial<AgentsPaneSettings>): void;
  /** Opens the folder of agent logs. */
  openLogs(): Promise<void>;
}

const ANSWERS = {
  folder: 'May read the folder',
  document: 'This document only',
  no: 'Not allowed',
} as const;

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

let nextId = 0;

function row(label: string, control: HTMLElement, note?: HTMLElement): HTMLElement {
  const id = `rl-agents-${nextId++}`;
  const root = el('div', 'rl-pref-row');
  root.dataset['row'] = label;
  const text = el('div', 'rl-pref-label', label);
  text.id = id;
  const field = el('div', 'rl-pref-control');
  field.append(control);
  if (note) field.append(note);
  control.setAttribute('aria-labelledby', id);
  root.append(text, field);
  return root;
}

/**
 * Draws the pane in `container`, after what it holds. Returns a function that stops late answers
 * from being drawn once the pane is gone.
 */
export function renderAgentsPane(container: HTMLElement, deps: AgentsPaneDeps): () => void {
  let alive = true;
  const names = new Map(deps.agents.map(({ id, name }) => [id, name]));

  // A login that needed a terminal ends where the person finishes it, outside this window: coming
  // back to it, the pane looks again, for as long as an agent still waits on that.
  const waiting = new Set<string>();
  const comeBack = () => {
    for (const look of looks) if (waiting.has(look.id)) look.check(true);
  };
  const looks: { id: string; check: (fresh: boolean) => void }[] = [];
  window.addEventListener('focus', comeBack);

  for (const agent of deps.agents) {
    const drawn = agentRow(agent, deps, () => alive, waiting);
    looks.push({ id: agent.id, check: drawn.check });
    container.append(drawn.row);
    // Run now that the pane is open: nothing in the app asks at launch.
    drawn.check(false);
  }

  if (deps.others) container.append(otherAgents(deps.others, () => alive));

  const scope = el('select');
  for (const [value, label] of [
    ['document', 'This document'],
    ['folder', 'This folder'],
  ] as const) {
    const option = el('option', undefined, label);
    option.value = value;
    scope.append(option);
  }
  scope.value = deps.settings().agentScope;
  scope.addEventListener('change', () =>
    deps.update({ agentScope: scope.value === 'document' ? 'document' : 'folder' }),
  );
  container.append(row('What agents may read', scope));

  // The remembered answers: a row only while there are any.
  let remembered: HTMLElement | null = null;
  const drawRemembered = () => {
    const entries = Object.entries(deps.settings().consent);
    const next = entries.length ? row('Remembered answers', list(entries)) : null;
    if (remembered && next) remembered.replaceWith(next);
    else if (remembered) remembered.remove();
    else if (next) logs.before(next);
    remembered = next;
  };
  const list = (entries: [string, 'folder' | 'document' | 'no'][]): HTMLElement => {
    const items = el('div', 'rl-pref-list');
    for (const [key, answer] of entries) {
      const split = key.indexOf('|');
      const agent = split < 0 ? key : key.slice(0, split);
      const folder = split < 0 ? '' : key.slice(split + 1);
      const item = el('div', 'rl-pref-item');
      item.dataset['key'] = key;
      const what = el('div', 'rl-pref-item-text');
      what.append(
        el('span', undefined, `${names.get(agent) ?? agent} · ${ANSWERS[answer]}`),
        el('span', 'rl-pref-note', folder),
      );
      const forget = el('button', 'rl-pref-button', 'Forget');
      forget.type = 'button';
      forget.setAttribute('aria-label', `Forget ${names.get(agent) ?? agent} for ${folder}`);
      forget.addEventListener('click', () => {
        const rest = { ...deps.settings().consent };
        delete rest[key];
        deps.update({ consent: rest });
        drawRemembered();
      });
      item.append(what, forget);
      items.append(item);
    }
    return items;
  };

  const logsButton = el('button', 'rl-pref-button', 'Show Agent Logs');
  logsButton.type = 'button';
  const problem = el('div', 'rl-pref-note');
  logsButton.addEventListener('click', () => {
    problem.textContent = '';
    deps.openLogs().catch(() => {
      if (alive) problem.textContent = 'Couldn’t open the logs.';
    });
  });
  const logs = row('Agent logs', logsButton, problem);
  container.append(logs);
  drawRemembered();

  return () => {
    alive = false;
    window.removeEventListener('focus', comeBack);
  };
}

/** What the row's first line says of an agent. */
function statusOf(state: AgentState): string {
  if (!state.found) return 'Not installed';
  if (state.signedIn) return 'Signed in';
  if (state.reason === 'signed-out') return 'Signed out';
  // Sign-in is reported once the program has been asked, and only as it said.
  if (state.account === undefined) return 'Needs an update';
  return `Needs an update · ${state.account === 'signed-in' ? 'signed in' : 'signed out'}`;
}

/**
 * One agent's row: its state, the version and the path of the program found (so that a stale
 * second copy earlier on the PATH shows), and the next step as a button. The host runs the update
 * and the sign-in, each its own fixed command; the pane only asks, and looks again when one ends.
 */
function agentRow(
  agent: PaneAgent,
  deps: AgentsPaneDeps,
  alive: () => boolean,
  waiting: Set<string>,
): { row: HTMLElement; check: (fresh: boolean) => void } {
  const status = el('div', 'rl-pref-status', 'Checking…');
  status.setAttribute('role', 'status');
  const where = el('div', 'rl-pref-note');
  const help = el('div', 'rl-pref-note');
  const install = el('div', 'rl-pref-inline rl-pref-actions');
  const actions = el('div', 'rl-pref-inline rl-pref-actions');
  const said = el('div', 'rl-pref-note rl-pref-failure');
  said.setAttribute('role', 'status');
  const rest = el('div');
  rest.append(where, help, install, actions, said);
  const root = row(agent.name, status, rest);

  /** The latest question asked, so that an older answer never draws over a newer one. */
  let asked = 0;
  /** An update or a sign-in is running: nothing else is started meanwhile. */
  let activity: string | null = null;
  let last: AgentState | null = null;

  /** A button of the row, which waits while the row says something is happening (`busy`). */
  const make = (text: string, label: string, run: () => void, busy: boolean) => {
    const made = button(text, label);
    made.disabled = busy;
    made.addEventListener('click', () => run());
    return made;
  };

  const draw = (state: AgentState | null, shown?: string) => {
    last = state;
    status.textContent = shown ?? (state === null ? 'Couldn’t check' : statusOf(state));
    where.textContent = state?.found
      ? [state.version, state.path].filter((part) => part !== undefined).join(' · ')
      : '';
    const tooOld = state?.found === true && !state.signedIn && state.reason === 'too-old';
    const signedOut = state?.found === true && !state.signedIn && state.reason === 'signed-out';
    const canUpdate = tooOld && agent.update !== undefined;
    const canSignIn = signedOut && agent.signIn !== undefined;
    // The button says what to do, so help that told the person what to type is left out.
    help.textContent = canSignIn ? '' : (state?.help ?? '');
    if (shown === 'Signing in…') help.textContent = 'Finish in your browser.';
    const command = state !== null && !state.found ? state.install : undefined;
    // While the row says something is happening, its buttons wait.
    const busy = shown !== undefined;
    install.replaceChildren();
    if (command !== undefined) {
      const code = el('code', 'rl-pref-code', command);
      install.append(code);
      if (deps.copy) {
        const label = `Copy the command that installs ${agent.name}`;
        install.append(make('Copy', label, () => copy(command), busy));
      }
    }
    actions.replaceChildren();
    if (canUpdate) {
      actions.append(make('Update', `Update ${agent.name}`, () => void updateIt(), busy));
    }
    if (canSignIn) {
      actions.append(make('Sign In', `Sign in to ${agent.name}`, () => void signInIt(), busy));
    }
    actions.append(make('Check Again', `Check ${agent.name} again`, () => check(true), busy));
  };

  const check = (fresh: boolean): void => {
    const mine = ++asked;
    draw(null, 'Checking…');
    void Promise.resolve()
      .then(() => (fresh ? agent.detect(true) : agent.detect()))
      .then(
        (state): AgentState | null => state ?? null,
        (): null => null,
      )
      .then((state) => {
        if (!alive() || mine !== asked || activity !== null) return;
        draw(state);
        if (state?.found && state.signedIn) waiting.delete(agent.id);
      });
  };

  const copy = (text: string) => {
    void deps.copy?.(text).then(
      () => {
        if (!alive()) return;
        const made = [...install.querySelectorAll('button')].find((b) => b.textContent === 'Copy');
        if (made) made.textContent = 'Copied';
      },
      () => {
        if (alive()) said.textContent = 'Couldn’t copy the command.';
      },
    );
  };

  /**
   * Runs one of the host's fixed commands, says how it ended, and looks again. A login that failed
   * at once wants a terminal (`terminal`), and gets one; an update that failed at once doesn't.
   */
  const run = async (
    doing: string,
    running: () => Promise<SetupResult>,
    failed: string,
    terminal: boolean,
  ) => {
    if (activity !== null) return;
    activity = doing;
    said.textContent = '';
    draw(last, doing);
    let note = '';
    try {
      const result = await running();
      if (!result.ok) {
        note =
          terminal && result.needsTerminal && agent.signInInTerminal
            ? await openTerminal()
            : `${failed}: ${result.message}`;
      }
    } catch (error) {
      note = reasonOf(error);
    }
    if (!alive()) return;
    activity = null;
    said.textContent = note;
    check(true);
  };

  /** A login that wants a terminal gets one, with its command, and the pane waits for the person. */
  const openTerminal = async (): Promise<string> => {
    await agent.signInInTerminal?.();
    waiting.add(agent.id);
    return 'Sign-in needs a terminal, so Redlines opened one. Finish there, then come back here.';
  };

  const updateIt = () => run('Updating…', () => agent.update!(), 'The update didn’t finish', false);
  const signInIt = () => run('Signing in…', () => agent.signIn!(), 'Sign-in didn’t finish', true);

  return { row: root, check };
}

function button(text: string, label?: string): HTMLButtonElement {
  const node = el('button', 'rl-pref-button', text);
  node.type = 'button';
  if (label) node.setAttribute('aria-label', label);
  return node;
}

function textField(label: string, placeholder: string): HTMLInputElement {
  const input = el('input', 'rl-pref-text');
  input.type = 'text';
  input.placeholder = placeholder;
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.setAttribute('aria-label', label);
  return input;
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The other agents: one item each, with its command and Remove, then Add Agent…, which opens a
 * name and a command. The host asks the person before anything changes, so a change shows only
 * once it is made; a refusal is one line.
 */
function otherAgents(others: NonNullable<AgentsPaneDeps['others']>, alive: () => boolean) {
  const control = el('div', 'rl-pref-list');
  const items = el('div', 'rl-pref-list');
  const adding = el('div');
  const problem = el('div', 'rl-pref-note rl-pref-failure');
  problem.setAttribute('role', 'status');
  const note = el(
    'div',
    'rl-pref-note',
    'Any agent that speaks the Agent Client Protocol, from the command that starts it. Redlines ' +
      'lets it use Redlines’ tools and read the folder, and says no to anything else it asks. An ' +
      'agent may also act on its own, outside what it asks Redlines, as its own settings allow, ' +
      'and follow settings it finds in the folders it works in, as its own rules allow. Stop ends ' +
      'the agent and what it started; a command the agent detaches on its own may outlive it.',
  );

  const show = (list: OtherAgent[]) => {
    if (!alive()) return;
    items.replaceChildren(
      ...list.map((agent) => {
        const item = el('div', 'rl-pref-item');
        item.dataset['agent'] = agent.id;
        const what = el('div', 'rl-pref-item-text');
        what.append(el('span', undefined, agent.name), el('span', 'rl-pref-note', agent.command));
        const remove = button('Remove', `Remove ${agent.name}`);
        remove.addEventListener('click', () => void change(() => others.remove(agent.id)));
        item.append(what, remove);
        return item;
      }),
    );
  };

  /** Makes a change through the host, which asks the person, and shows the list it then has. */
  const change = (making: () => Promise<OtherAgent[]>): Promise<boolean> => {
    problem.textContent = '';
    return making().then(
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
    const open = button('Add Agent…');
    open.addEventListener('click', () => adding.replaceChildren(...form()));
    return [open];
  };

  const form = () => {
    const name = textField('Name', 'Name, such as Gemini');
    const command = textField('Command', 'Command, such as gemini --experimental-acp');
    const add = button('Add');
    const cancel = button('Cancel');
    const ready = () => {
      add.disabled = !name.value.trim() || !command.value.trim();
    };
    ready();
    name.addEventListener('input', ready);
    command.addEventListener('input', ready);
    add.addEventListener('click', () => {
      add.disabled = true;
      void change(() => others.add(name.value.trim(), command.value.trim())).then((done) => {
        if (!alive()) return;
        if (done) adding.replaceChildren(...closed());
        else ready();
      });
    });
    cancel.addEventListener('click', () => {
      problem.textContent = '';
      adding.replaceChildren(...closed());
    });
    const fields = el('div', 'rl-pref-pair');
    fields.append(name, command);
    const buttons = el('div', 'rl-pref-inline');
    buttons.append(add, cancel);
    queueMicrotask(() => name.focus());
    return [fields, buttons];
  };

  adding.append(...closed());
  control.append(items, adding, problem, note);
  void others.list().then(show, (error: unknown) => {
    if (alive()) problem.textContent = `Couldn’t list the other agents: ${reasonOf(error)}`;
  });
  return row('Other agents', control);
}
