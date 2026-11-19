// The Model field on an agent's card (Preferences › Agents, #530): which model the agent runs for a
// comment and for Ask, from the models its provider lists. "Default" says nothing, and the agent's
// own default runs. An agent that lists none (an OpenClaw agent chooses its own) has no field.

import type { AgentModel } from '@redlines/plugin-api';
import { el, uniqueId } from './pane-dom.ts';

interface ModelFieldDeps {
  models: readonly AgentModel[];
  /** The model chosen for the agent, if any. */
  chosen(): string | undefined;
  /** Keeps the choice; `undefined` is Default. */
  save(model: string | undefined): void;
}

/** The label and list of one agent's model. */
export function modelField(name: string, deps: ModelFieldDeps): HTMLElement {
  const root = el('div', 'rl-pref-agent-model');
  const id = uniqueId();
  const label = el('label', 'rl-pref-note', 'Model');
  label.htmlFor = id;
  const select = el('select');
  select.id = id;
  select.setAttribute('aria-label', `Model for ${name}`);
  for (const [value, text] of [
    ['', 'Default'],
    ...deps.models.map((model) => [model.id, model.name] as const),
  ] as const) {
    const option = el('option', undefined, text);
    option.value = value;
    select.append(option);
  }
  const chosen = deps.chosen();
  select.value = deps.models.some((model) => model.id === chosen) ? (chosen as string) : '';
  select.addEventListener('change', () =>
    deps.save(select.value === '' ? undefined : select.value),
  );
  const line = el('div', 'rl-pref-inline');
  line.append(label, select);
  root.append(line);
  return root;
}
