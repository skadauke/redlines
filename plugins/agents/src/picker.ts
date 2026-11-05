// The @ picker in a comment box (spec: Agents, step 1). Typing `@` opens a small list under the
// field: the agents found on this Mac first, then the people in the document's ledger. Picking one
// puts a plain mention in the text (`@Claude`, `@bo`). Nothing in the file changes, and the mention
// starts nothing by itself: a run starts only when a comment is posted.

import { assignColors } from '@redlines/editor';
import type { Handle, Parsed, Person } from '@redlines/format';
import type { AgentInfo } from '@redlines/plugin-api';

/** One row of the picker. */
export interface PickerEntry {
  /** The handle of the author it stands for; an agent of mine is `claude-<me>`. */
  handle: Handle;
  name: string;
  /** The first name of the person an agent acts for, as in "Claude for Bo". */
  for?: string;
  /** The author color, 1 to 8, or 0 for gray. */
  color: number;
  /** The plain text it puts in the comment, with the space after it. */
  insert: string;
}

const matches = (query: string, ...fields: string[]) =>
  fields.some((field) => field.toLowerCase().includes(query));

/**
 * What the picker lists for `query`: the agents found on this Mac, then the people in the ledger by
 * name. It leaves out me, `unknown`, people who left, and my own agents (`claude-<me>`), which their
 * row among the agents covers. Someone else's agent is listed like a person, named for whom it acts.
 */
export function pickerEntries(
  parsed: Parsed,
  me: Handle,
  agents: readonly AgentInfo[],
  query: string,
): PickerEntry[] {
  const wanted = query.trim().toLowerCase();
  const people = parsed.ledger.people;
  const mine = agents.filter((agent) => agent.state.found);
  const ownHandle = (agent: AgentInfo) => `${agent.id}-${me}`;

  // My agents may not be in the ledger yet; their color is what they will have once they are.
  const missing = mine.filter((agent) => !people.some((p) => p.handle === ownHandle(agent)));
  const colors = assignColors(
    missing.length
      ? {
          ...parsed,
          ledger: {
            ...parsed.ledger,
            people: [
              ...people,
              ...missing.map((agent): Person => ({ handle: ownHandle(agent), name: agent.name })),
            ],
          },
        }
      : parsed,
    me,
  );
  const colorOf = (handle: Handle) => colors.get(handle) ?? 0;

  const entries: PickerEntry[] = mine
    .filter((agent) => matches(wanted, agent.name, agent.id))
    .map((agent) => ({
      handle: ownHandle(agent),
      name: agent.name,
      color: colorOf(ownHandle(agent)),
      insert: `@${agent.name} `,
    }));

  const own = new Set(mine.map(ownHandle));
  const listed = people
    .filter(
      (person) =>
        person.handle !== me &&
        person.handle !== 'unknown' &&
        !person.deleted &&
        !own.has(person.handle) &&
        !(person.agent && person.for === me) &&
        matches(wanted, person.name, person.handle),
    )
    .sort((a, b) => a.name.localeCompare(b.name) || (a.handle < b.handle ? -1 : 1));
  for (const person of listed) {
    const principal = person.agent && person.for ? person.for : undefined;
    const first = principal
      ? people
          .find((p) => p.handle === principal)
          ?.name.trim()
          .split(/\s+/)[0] || principal
      : undefined;
    entries.push({
      handle: person.handle,
      name: person.name || person.handle,
      ...(first ? { for: first } : {}),
      color: colorOf(person.handle),
      insert: `@${person.handle} `,
    });
  }
  return entries;
}

/** What the picker needs from its host. */
export interface PickerDeps {
  /** The document as it is now, for its people. */
  getParsed(): Parsed;
  /** The handle of the person using the app. */
  me: Handle;
  /** The agents the host lists, asked for each time the picker opens. */
  agents(): readonly AgentInfo[];
}

const STYLE_ID = 'rl-picker-style';

/** The picker's look, in the app's tokens: a small card, grays only, a dot in a person's color. */
const STYLE = `
.rl-picker {
  position: fixed;
  z-index: 400;
  box-sizing: border-box;
  max-height: 168px;
  overflow-y: auto;
  padding: 3px;
  border: 1px solid var(--rl-rule);
  border-radius: 8px;
  background-color: var(--rl-card);
  box-shadow: var(--rl-shadow);
  color: var(--rl-ink);
  font-family: var(--rl-font-ui);
  font-size: calc(12.5px * var(--rl-text-scale, 1));
}
.rl-picker-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 7px;
  border-radius: 5px;
  cursor: default;
  white-space: nowrap;
}
.rl-picker-row[aria-selected='true'] { background-color: var(--rl-pressed); }
.rl-picker-name { overflow: hidden; text-overflow: ellipsis; }
.rl-picker-for { color: var(--rl-ink-2); overflow: hidden; text-overflow: ellipsis; }
`;

function addStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = STYLE;
  document.head.append(style);
}

let uid = 0;

/** Where the mention being typed starts, and what is typed of it; null when there isn't one. */
function mentionAt(field: HTMLTextAreaElement): { start: number; query: string } | null {
  const caret = field.selectionStart;
  if (caret !== field.selectionEnd) return null;
  const before = field.value.slice(0, caret);
  const start = before.lastIndexOf('@');
  if (start < 0) return null;
  const query = before.slice(start + 1);
  if (/\s/.test(query)) return null;
  // An @ after a letter or digit is part of something else, such as an email address.
  if (start > 0 && /[\p{L}\p{N}]/u.test(before.charAt(start - 1))) return null;
  return { start, query };
}

/**
 * Gives a comment box's field the picker. While it is open it takes ↑ ↓ to move and Return or Tab
 * to pick, and Escape closes it alone; closed, every key is the box's own, so ⌘↩ still posts.
 * Returns a function that takes it away again.
 */
export function attachPicker(field: HTMLTextAreaElement, deps: PickerDeps): () => void {
  addStyle();
  const host = field.parentElement ?? field;
  const id = `rl-picker-${++uid}`;
  let list: HTMLElement | null = null;
  let entries: PickerEntry[] = [];
  let index = 0;
  let query: string | null = null;
  /** The agents as they were when the picker opened. */
  let agentsNow: readonly AgentInfo[] = [];

  const place = () => {
    if (!list) return;
    const rect = field.getBoundingClientRect();
    list.style.left = `${rect.left}px`;
    list.style.width = `${rect.width}px`;
    const room = window.innerHeight - rect.bottom;
    if (room < list.offsetHeight + 8 && rect.top > room) {
      list.style.top = `${Math.max(4, rect.top - list.offsetHeight - 4)}px`;
    } else {
      list.style.top = `${rect.bottom + 4}px`;
    }
  };

  const close = () => {
    list?.remove();
    list = null;
    query = null;
    field.removeAttribute('aria-activedescendant');
    window.removeEventListener('scroll', place, true);
    window.removeEventListener('resize', place);
  };

  const draw = () => {
    if (!list) return;
    list.replaceChildren(
      ...entries.map((entry, i) => {
        const row = document.createElement('div');
        row.id = `${id}-${i}`;
        row.className = `rl-picker-row rl-author-${entry.color}`;
        row.setAttribute('role', 'option');
        row.setAttribute('aria-selected', String(i === index));
        const dot = document.createElement('span');
        dot.className = 'rl-dot';
        const name = document.createElement('span');
        name.className = 'rl-picker-name';
        name.textContent = entry.name;
        row.append(dot, name);
        if (entry.for) {
          const principal = document.createElement('span');
          principal.className = 'rl-picker-for';
          principal.textContent = `for ${entry.for}`;
          row.append(' ', principal);
        }
        row.addEventListener('click', () => pick(i));
        return row;
      }),
    );
    field.setAttribute('aria-activedescendant', `${id}-${index}`);
    list.children[index]?.scrollIntoView?.({ block: 'nearest' });
  };

  /** Opens, narrows or closes the picker for what is typed at the caret. */
  const refresh = () => {
    const mention = mentionAt(field);
    if (!mention) return close();
    if (mention.query === query && list) return;
    if (!list) agentsNow = deps.agents();
    const found = pickerEntries(deps.getParsed(), deps.me, agentsNow, mention.query);
    if (!found.length) return close();
    entries = found;
    query = mention.query;
    index = 0;
    if (!list) {
      list = document.createElement('div');
      list.className = 'rl-picker';
      list.setAttribute('role', 'listbox');
      // A click on a row must not take the focus from the field.
      list.addEventListener('mousedown', (event) => event.preventDefault());
      host.append(list);
      window.addEventListener('scroll', place, true);
      window.addEventListener('resize', place);
    }
    draw();
    place();
  };

  function pick(i: number): void {
    const entry = entries[i];
    const mention = mentionAt(field);
    if (!entry || !mention) return close();
    const caret = field.selectionStart;
    const after = field.value.slice(caret);
    // Not a second space when one follows already; the caret goes past it.
    const spaced = /^\s/.test(after) && entry.insert.endsWith(' ');
    const text = spaced ? entry.insert.slice(0, -1) : entry.insert;
    close();
    field.value = field.value.slice(0, mention.start) + text + after;
    const end = mention.start + entry.insert.length;
    field.setSelectionRange(end, end);
    // The box sizes itself and enables Post on input.
    field.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // In the capture phase on the box, so that a key the picker takes never reaches the box's own
  // listeners on the field; with the picker closed, nothing here touches a key.
  const onKeyDown = (event: Event) => {
    const key = event as KeyboardEvent;
    if (key.target !== field || key.isComposing || !list) return;
    const plain = !key.metaKey && !key.ctrlKey && !key.altKey && !key.shiftKey;
    if (key.key === 'Escape') {
      key.preventDefault();
      key.stopPropagation();
      close();
    } else if (key.key === 'ArrowDown' || key.key === 'ArrowUp') {
      key.preventDefault();
      index = (index + (key.key === 'ArrowDown' ? 1 : entries.length - 1)) % entries.length;
      draw();
    } else if ((key.key === 'Enter' || key.key === 'Tab') && plain) {
      key.preventDefault();
      key.stopPropagation();
      pick(index);
    }
  };
  const onKeyUp = (event: KeyboardEvent) => {
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) refresh();
  };

  host.addEventListener('keydown', onKeyDown, true);
  field.addEventListener('input', refresh);
  field.addEventListener('keyup', onKeyUp);
  field.addEventListener('click', refresh);
  field.addEventListener('blur', close);
  return () => {
    close();
    host.removeEventListener('keydown', onKeyDown, true);
    field.removeEventListener('input', refresh);
    field.removeEventListener('keyup', onKeyUp);
    field.removeEventListener('click', refresh);
    field.removeEventListener('blur', close);
  };
}
