// The Default agent row of Preferences › Agents (#528): which agent answers an Ask that names none.
// It is there only while more than one agent is set up (found on this Mac, or an OpenClaw agent),
// and lists them by the names they are shown as (their handles, capitalized).

import { el, row } from './pane-dom.ts';

/** An agent the person can choose. */
export interface DefaultChoice {
  id: string;
  /** What the agent is shown as. */
  name: string;
}

interface DefaultAgentRow {
  row: HTMLElement;
  /** Gives the row the agents that are set up now, and draws it (hidden when there are fewer than two). */
  show(choices: readonly DefaultChoice[]): void;
}

/**
 * The row. `chosen` is the id the person chose, if any; without a choice, the first agent listed
 * is shown, which is also the one Ask asks first (a ready agent, in the host's order).
 */
export function defaultAgentRow(deps: {
  chosen(): string | null | undefined;
  save(id: string): void;
}): DefaultAgentRow {
  const select = el('select');
  select.setAttribute('aria-label', 'Default agent');
  const note = el('div', 'rl-pref-note', 'Answers an Ask that doesn’t name an agent.');
  const root = row('Default agent', select, note);
  root.dataset['defaultAgent'] = '';
  root.hidden = true;
  select.addEventListener('change', () => deps.save(select.value));
  return {
    row: root,
    show(choices) {
      select.replaceChildren(
        ...choices.map(({ id, name }) => {
          const option = el('option', undefined, name);
          option.value = id;
          return option;
        }),
      );
      const wanted = deps.chosen();
      select.value = choices.some(({ id }) => id === wanted)
        ? (wanted as string)
        : (choices[0]?.id ?? '');
      root.hidden = choices.length < 2;
    },
  };
}
