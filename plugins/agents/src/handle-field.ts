// The Handle field on an agent's card (Preferences › Agents, #558): what is written after an @ to
// name the agent, and what it is shown as, which is the handle with a capital. A handle another
// agent has is refused with a note, and the old one comes back when the field is left.

import { displayName, handleOf, handleProblem } from './handles.ts';
import { el, uniqueId } from './pane-dom.ts';

export interface HandleFieldDeps {
  /** The handles the person gave, by agent id. */
  handles(): Readonly<Record<string, string>>;
  /** Keeps `handles` as the person's. */
  save(handles: Record<string, string>): void;
  /** The handles every agent has now, by id, the ones Preferences doesn't list included. */
  taken(): Promise<Readonly<Record<string, string>>>;
  alive(): boolean;
}

/** The label, field and notes of one agent's handle. */
export function handleField(id: string, deps: HandleFieldDeps): HTMLElement {
  const root = el('div', 'rl-pref-agent-handle');
  root.dataset['handleOf'] = id;
  const fieldId = uniqueId();
  const label = el('label', 'rl-pref-note', 'Handle');
  label.htmlFor = fieldId;
  const at = el('span', 'rl-pref-note', '@');
  const input = el('input', 'rl-pref-text');
  input.id = fieldId;
  input.type = 'text';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.autocapitalize = 'off';
  const shown = el('div', 'rl-pref-note');
  shown.id = uniqueId();
  input.setAttribute('aria-describedby', shown.id);
  const problem = el('div', 'rl-pref-note rl-pref-failure');
  problem.setAttribute('role', 'status');

  const current = () => handleOf(id, deps.handles());
  const showShown = (handle: string) => {
    shown.textContent = `Shown as ${displayName(handle)}`;
  };
  input.value = current();
  showShown(current());

  input.addEventListener('input', () => {
    problem.textContent = '';
    const typed = input.value.trim();
    if (typed !== '' && handleProblem(typed, id, {}) === null) showShown(typed);
  });

  let committing = 0;
  const commit = async () => {
    const typed = input.value.trim();
    if (typed === current()) {
      problem.textContent = '';
      input.value = typed;
      showShown(typed);
      return;
    }
    const mine = ++committing;
    const taken = await deps.taken().catch(() => ({}));
    if (!deps.alive() || mine !== committing) return;
    const why = handleProblem(typed, id, taken);
    if (why !== null) {
      // The old handle comes back, and the note says why.
      problem.textContent = why;
      input.value = current();
      showShown(current());
      return;
    }
    problem.textContent = '';
    deps.save({ ...deps.handles(), [id]: typed });
    input.value = typed;
    showShown(typed);
  };
  input.addEventListener('change', () => void commit());
  input.addEventListener('blur', () => void commit());
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') void commit();
  });

  const line = el('div', 'rl-pref-inline');
  line.append(label, at, input);
  root.append(line, shown, problem);
  return root;
}
