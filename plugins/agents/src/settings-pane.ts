// The Agents pane of Preferences (design, Preferences and The log): the agents found on this Mac
// and their state, what agents may read, the answers remembered per folder, and the logs. The
// window it draws in is the app's; this knows only the rows, and takes what it needs from `deps`.
// Its classes are the Preferences window's (apps/desktop/src/preferences/preferences.css).

import type { AgentState } from '@redlines/plugin-api';

/** The part of the app's settings this pane reads and changes. */
export interface AgentsPaneSettings {
  agentScope: 'folder' | 'document';
  /** What the person allowed each agent, keyed `agent|folder`. */
  consent: Record<string, 'folder' | 'document' | 'no'>;
}

export interface AgentsPaneDeps {
  /** The agents to list. Each is asked when the pane is drawn, never before. */
  agents: readonly { id: string; name: string; detect(): Promise<AgentState> }[];
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
