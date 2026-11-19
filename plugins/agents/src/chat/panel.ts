// The chat panel (#1194, design §8.7): a column of messages, the agent's live line while it works,
// and a rounded composer at the foot with the picker of the agent and its model. It knows nothing of
// the editor or the app: `index.ts` gives it what the session says and what each control does. The
// person's own words are a subtle bubble, the agent's are plain rendered Markdown, and all of it is
// built with `textContent`, so nothing an agent writes is ever markup.

import type { AgentInfo } from '@redlines/plugin-api';
import type { AgentScope } from '@redlines/plugin-api';
import { renderLiveLine, type LiveLineActions } from '../live-line.ts';
import type { LiveLine } from '../runs.ts';
import type { AskChoice, AskTurn } from '../ask/session.ts';
import { renderMarkdown } from './markdown.ts';
import { addChatStyle } from './styles.ts';

export interface ChatView {
  /** What the chat is about, shown at its head: the document's name. */
  title: string;
  turns: readonly AskTurn[];
  /** The message being answered, or null. */
  pending: string | null;
  line: LiveLine | null;
  /** Who answers next, with which model; null before the agents are known. */
  choice: AskChoice | null;
  /** The agents the picker lists, as the host knows them. */
  agents: readonly AgentInfo[];
  /** The agent Preferences chose, by id, which the menu marks. */
  defaultAgent?: string | undefined;
}

export interface ChatHandlers {
  send(text: string): void;
  stop(): void;
  /** An agent was picked, with a model it lists (undefined: its default). */
  pick(agent: string, model: string | undefined): void;
  consent(answer: AgentScope | 'no'): void;
  dismiss(): void;
  showLog?: (path: string) => void;
  openPreferences?: () => void;
  copy(text: string): void;
  openLink?: (url: string) => void;
  /** The panel needs the agents listed again (the menu opened). */
  refreshAgents?: () => void;
}

export interface ChatPanel {
  readonly el: HTMLElement;
  render(view: ChatView): void;
  focusComposer(): void;
  destroy(): void;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const made = document.createElement(tag);
  if (className) made.className = className;
  if (text !== undefined) made.textContent = text;
  return made;
}

const SVG = 'http://www.w3.org/2000/svg';

function glyph(paths: string, size = 14): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.4');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG, 'path');
  path.setAttribute('d', paths);
  svg.append(path);
  return svg;
}

const UP = 'M8 13V3.5M4 7.2L8 3.2l4 4';
const STOP = 'M4.6 4.6h6.8v6.8H4.6z';
const CHEVRON = 'M4.5 6.5L8 10l3.5-3.5';
const RIGHT = 'M6.5 4.5L10 8l-3.5 3.5';
const CHECK = 'M3.5 8.4l3 3 6-6.6';
const COPY = 'M5.5 5.5h7v7h-7zM3.5 10.5v-7h7';

/** The lines the composer grows to before it scrolls. */
const MAX_LINES = 6;

let count = 0;

export function createChatPanel(handlers: ChatHandlers): ChatPanel {
  addChatStyle();
  const id = `rl-chat-${++count}`;
  const root = el('section', 'rl-chat');
  root.setAttribute('aria-label', 'Chat');
  const title = el('div', 'rl-chat-title');
  const log = el('div', 'rl-chat-log');
  log.setAttribute('role', 'log');
  log.setAttribute('aria-label', 'Messages');
  log.tabIndex = 0;
  const empty = el('div', 'rl-chat-empty');
  const live = el('div', 'rl-chat-live');
  live.setAttribute('aria-live', 'polite');
  const jump = el('button', 'rl-chat-jump', 'Jump to latest');
  jump.type = 'button';
  jump.hidden = true;

  const form = el('form', 'rl-chat-composer');
  const field = el('textarea', 'rl-chat-field');
  field.rows = 1;
  field.placeholder = 'Ask about this document';
  field.setAttribute('aria-label', 'Message');
  field.id = `${id}-field`;
  const bar = el('div', 'rl-chat-bar');
  const who = el('button', 'rl-chat-who');
  who.type = 'button';
  who.setAttribute('aria-haspopup', 'menu');
  who.setAttribute('aria-expanded', 'false');
  const whoName = el('span', 'rl-chat-who-name');
  const whoModel = el('span', 'rl-chat-who-model');
  who.append(whoName, whoModel, glyph(CHEVRON, 12));
  const send = el('button', 'rl-chat-send');
  send.type = 'submit';
  bar.append(who, send);
  const menu = el('div', 'rl-chat-menu');
  menu.setAttribute('role', 'menu');
  menu.hidden = true;
  form.append(field, bar, menu);
  root.append(title, log, live, jump, form);

  let view: ChatView = {
    title: '',
    turns: [],
    pending: null,
    line: null,
    choice: null,
    agents: [],
  };
  /** Whether the log follows the newest message: it does while the person is at its end. */
  let following = true;
  /** The agent whose models the menu shows, or null. */
  let opened: string | null = null;

  const atEnd = () => log.scrollHeight - log.scrollTop - log.clientHeight < 24;
  const toEnd = () => {
    log.scrollTop = log.scrollHeight;
    jump.hidden = true;
  };
  log.addEventListener('scroll', () => {
    following = atEnd();
    if (following) jump.hidden = true;
  });
  jump.addEventListener('click', () => {
    following = true;
    toEnd();
  });

  const grow = () => {
    field.style.height = 'auto';
    const style = getComputedStyle(field);
    const line = parseFloat(style.lineHeight) || 20;
    const limit = line * MAX_LINES;
    field.style.height = `${Math.min(field.scrollHeight, limit)}px`;
    field.style.overflowY = field.scrollHeight > limit ? 'auto' : 'hidden';
  };

  const busy = () => view.pending !== null;

  const submit = () => {
    const text = field.value.trim();
    if (text === '' || busy()) return;
    field.value = '';
    grow();
    following = true;
    handlers.send(text);
  };
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (busy()) handlers.stop();
    else submit();
  });
  field.addEventListener('input', () => {
    grow();
    paintSend();
  });
  field.addEventListener('keydown', (event) => {
    // Return sends and Shift-Return starts a line; a Return that picks a composed character doesn't.
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      submit();
    }
  });

  function paintSend(): void {
    send.replaceChildren(glyph(busy() ? STOP : UP, 14));
    const label = busy() ? 'Stop' : 'Send';
    send.setAttribute('aria-label', label);
    send.title = label;
    send.disabled = !busy() && field.value.trim() === '';
    send.classList.toggle('rl-chat-send-stop', busy());
  }

  const actionsOf = (): LiveLineActions => ({
    answer: (answer) => handlers.consent(answer),
    stop: () => handlers.stop(),
    dismiss: () => handlers.dismiss(),
    ...(handlers.showLog ? { showLog: handlers.showLog } : {}),
    ...(handlers.openPreferences ? { openPreferences: handlers.openPreferences } : {}),
  });

  function message(turn: AskTurn): HTMLElement[] {
    const mine = el('div', 'rl-chat-msg rl-chat-mine');
    mine.append(el('div', 'rl-chat-bubble', turn.question));
    const theirs = el('div', 'rl-chat-msg rl-chat-theirs');
    const name = turn.model ? `${turn.agent.name} · ${modelName(turn)}` : turn.agent.name;
    theirs.append(el('div', 'rl-chat-from', name));
    theirs.append(
      renderMarkdown(turn.answer, handlers.openLink ? { openLink: handlers.openLink } : {}),
    );
    const row = el('div', 'rl-chat-hover');
    const copy = el('button', 'rl-chat-act');
    copy.type = 'button';
    copy.title = 'Copy';
    copy.setAttribute('aria-label', 'Copy the answer');
    copy.append(glyph(COPY, 14));
    copy.addEventListener('click', () => handlers.copy(turn.answer));
    row.append(copy);
    theirs.append(row);
    return [mine, theirs];
  }

  function modelName(turn: AskTurn): string {
    const listed = view.agents
      .find((agent) => agent.id === turn.agent.id)
      ?.models?.find((model) => model.id === turn.model);
    return listed?.name ?? turn.model ?? '';
  }

  const SUGGESTIONS = [
    'Summarize this document in a few lines',
    'What is unclear, or missing?',
    'List the open comments, and what each asks',
  ];

  function paintEmpty(): HTMLElement {
    empty.replaceChildren(
      el('div', 'rl-chat-empty-title', 'Talk to your agent about this document'),
      el(
        'div',
        'rl-chat-empty-line',
        'It reads the document as it is now, with its comments and changes. Nothing it says is written into the file.',
      ),
    );
    const list = el('div', 'rl-chat-suggestions');
    for (const text of SUGGESTIONS) {
      const button = el('button', 'rl-chat-suggestion', text);
      button.type = 'button';
      button.addEventListener('click', () => {
        field.value = text;
        grow();
        paintSend();
        field.focus();
      });
      list.append(button);
    }
    empty.append(list);
    return empty;
  }

  function paintMenu(): void {
    menu.replaceChildren();
    const ready = view.agents.filter((agent) => agent.toolbox !== false);
    if (ready.length === 0) {
      menu.append(
        el('div', 'rl-chat-menu-note', 'No agent is set up. Install Claude Code or Codex.'),
      );
      return;
    }
    for (const agent of ready) {
      const usable = agent.state.found && agent.state.signedIn;
      const models = agent.models ?? [];
      const row = el('button', 'rl-chat-item');
      row.type = 'button';
      row.setAttribute('role', models.length > 0 ? 'menuitem' : 'menuitemradio');
      const current = view.choice?.agent.id === agent.id;
      const mark = el('span', 'rl-chat-check');
      if (current) mark.append(glyph(CHECK, 12));
      const name = el('span', 'rl-chat-item-name', agent.name);
      row.append(mark, name);
      if (agent.id === view.defaultAgent) row.append(el('span', 'rl-chat-item-note', 'Default'));
      if (!usable) {
        row.disabled = true;
        const why = !agent.state.found
          ? 'Not installed'
          : !agent.state.signedIn && agent.state.reason === 'too-old'
            ? 'Too old'
            : 'Signed out';
        row.append(el('span', 'rl-chat-item-note', why));
      } else if (models.length > 0) {
        row.setAttribute('aria-expanded', String(opened === agent.id));
        row.append(glyph(opened === agent.id ? CHEVRON : RIGHT, 12));
        row.addEventListener('click', () => {
          opened = opened === agent.id ? null : agent.id;
          paintMenu();
        });
      } else {
        row.setAttribute('aria-checked', String(current));
        row.addEventListener('click', () => choose(agent.id, undefined));
      }
      menu.append(row);
      if (usable && opened === agent.id) {
        const entries: { id: string | undefined; name: string }[] = [
          { id: undefined, name: 'Default' },
          ...models.map(({ id: modelId, name: modelName }) => ({ id: modelId, name: modelName })),
        ];
        for (const entry of entries) {
          const sub = el('button', 'rl-chat-item rl-chat-sub');
          sub.type = 'button';
          sub.setAttribute('role', 'menuitemradio');
          const picked = current && view.choice?.model === entry.id;
          sub.setAttribute('aria-checked', String(picked));
          const subMark = el('span', 'rl-chat-check');
          if (picked) subMark.append(glyph(CHECK, 12));
          sub.append(subMark, el('span', 'rl-chat-item-name', entry.name));
          sub.addEventListener('click', () => choose(agent.id, entry.id));
          menu.append(sub);
        }
      }
    }
  }

  function choose(agent: string, model: string | undefined): void {
    closeMenu();
    handlers.pick(agent, model);
    field.focus();
  }

  function openMenu(): void {
    if (busy()) return;
    handlers.refreshAgents?.();
    opened = view.choice?.models.length ? view.choice.agent.id : null;
    paintMenu();
    menu.hidden = false;
    who.setAttribute('aria-expanded', 'true');
    menu.querySelector<HTMLElement>('button:not(:disabled)')?.focus();
  }

  function closeMenu(): void {
    if (menu.hidden) return;
    menu.hidden = true;
    who.setAttribute('aria-expanded', 'false');
  }

  who.addEventListener('click', () => (menu.hidden ? openMenu() : closeMenu()));
  menu.addEventListener('keydown', (event) => {
    const items = [...menu.querySelectorAll<HTMLElement>('button:not(:disabled)')];
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      closeMenu();
      who.focus();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next = event.key === 'ArrowDown' ? at + 1 : at - 1;
      items[(next + items.length) % items.length]?.focus();
    }
  });
  const away = (event: Event) => {
    if (!menu.hidden && event.target instanceof Node && !form.contains(event.target)) closeMenu();
  };
  document.addEventListener('pointerdown', away, true);
  // Escape closes the menu wherever the keyboard is, before anything else takes it.
  const escape = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || menu.hidden) return;
    event.preventDefault();
    event.stopPropagation();
    closeMenu();
    who.focus();
  };
  document.addEventListener('keydown', escape, true);

  function paintPicker(): void {
    const choice = view.choice;
    if (!choice) {
      whoName.textContent = 'No agent';
      whoModel.textContent = '';
    } else {
      whoName.textContent = choice.agent.name;
      const model = choice.models.find((entry) => entry.id === choice.model);
      whoModel.textContent = model ? `· ${model.name}` : '';
    }
    who.disabled = busy();
    who.setAttribute(
      'aria-label',
      choice
        ? `Agent: ${choice.agent.name}${whoModel.textContent ? `, ${whoModel.textContent.slice(2)}` : ''}. Change`
        : 'Choose an agent',
    );
  }

  function paintLive(): void {
    const line = view.line;
    if (line === null) {
      live.replaceChildren();
      return;
    }
    live.replaceChildren(renderLiveLine(line, actionsOf()));
  }

  return {
    el: root,
    render(next) {
      const was = view;
      view = next;
      title.textContent = next.title;
      const changed =
        was.turns !== next.turns || was.pending !== next.pending || was.title !== next.title;
      if (changed) {
        const rows: HTMLElement[] = [];
        if (next.turns.length === 0 && next.pending === null) rows.push(paintEmpty());
        for (const turn of next.turns) rows.push(...message(turn));
        if (next.pending !== null) {
          const mine = el('div', 'rl-chat-msg rl-chat-mine');
          mine.append(el('div', 'rl-chat-bubble', next.pending));
          rows.push(mine);
        }
        const before = log.scrollTop;
        log.replaceChildren(...rows);
        if (following) toEnd();
        else {
          log.scrollTop = before;
          jump.hidden = false;
        }
      }
      paintLive();
      paintPicker();
      paintSend();
      if (!menu.hidden) paintMenu();
      if (following) toEnd();
    },
    focusComposer() {
      field.focus();
    },
    destroy() {
      document.removeEventListener('pointerdown', away, true);
      document.removeEventListener('keydown', escape, true);
      root.remove();
    },
  };
}
