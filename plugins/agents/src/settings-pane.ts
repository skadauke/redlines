// The Agents pane of Preferences (design, Preferences and The log): the agents found on this Mac
// and their state, the other agents the person added (any agent that speaks the Agent Client
// Protocol, as a name and a command), what agents may read, the answers remembered per folder,
// and the logs. The window it draws in is the app's; this knows only the rows, and takes what it
// needs from `deps`.
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

export interface AgentsPaneDeps {
  /** The agents to list. Each is asked when the pane is drawn, never before. */
  agents: readonly { id: string; name: string; detect(): Promise<AgentState> }[];
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

function showState(control: HTMLElement, note: HTMLElement, state: AgentState): void {
  const status = !state.found ? 'Not found' : state.signedIn ? 'Signed in' : 'Not signed in';
  control.textContent = state.found && state.version ? `${status} · ${state.version}` : status;
  note.textContent = state.help ?? '';
}

/**
 * Draws the pane in `container`, after what it holds. Returns a function that stops late answers
 * from being drawn once the pane is gone.
 */
export function renderAgentsPane(container: HTMLElement, deps: AgentsPaneDeps): () => void {
  let alive = true;
  const names = new Map(deps.agents.map(({ id, name }) => [id, name]));

  for (const agent of deps.agents) {
    const status = el('div', 'rl-pref-status', 'Checking…');
    status.setAttribute('role', 'status');
    const note = el('div', 'rl-pref-note');
    container.append(row(agent.name, status, note));
    // Run now that the pane is open: nothing in the app asks at launch.
    void Promise.resolve()
      .then(() => agent.detect())
      .then(
        (state) => state,
        (): null => null,
      )
      .then((state) => {
        if (!alive) return;
        if (state) showState(status, note, state);
        else status.textContent = 'Couldn’t check';
      });
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
  };
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
