// The guided OpenClaw agents in Preferences › Agents: the agents the person connected (the agent's
// card of the design's screen 7), and the button that opens the setup sheet (sheet.ts). A card
// shows who the agent writes as, what it may do (the level), which folders its tools reach, when
// it was last used, and whether it is connected; every control changes the connection through the
// host, which asks the person before it gives an agent more.

import { LEVELS, type OpenClawChange, type OpenClawConnection } from './connection.ts';
import { failure } from './failures.ts';
import { connectionLine, failureOf, type NodeStatus } from './node.ts';
import { openSheet, type Sheet, type SheetDeps } from './sheet.ts';

export interface GuidedDeps extends SheetDeps {
  connections: SheetDeps['connections'] & {
    list(): Promise<OpenClawConnection[]>;
    change(handle: string, change: OpenClawChange): Promise<OpenClawConnection[]>;
  };
  /** The folder panel: a whole path, or null when the person cancels. */
  chooseFolder(): Promise<string | null>;
}

export interface GuidedOptions {
  alive(): boolean;
  /** The connections changed: the picker and the default agent follow. */
  changed?(list: readonly OpenClawConnection[]): void;
  /** For screenshots and tests: open the sheet at once, as `openSheet`'s `start` says. */
  start?: Parameters<typeof openSheet>[1]['start'];
}

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

function button(label: string, onClick: () => void, aria?: string): HTMLButtonElement {
  const node = el('button', 'rl-pref-button', label);
  node.type = 'button';
  if (aria) node.setAttribute('aria-label', aria);
  node.addEventListener('click', onClick);
  return node;
}

/** "just now", "5 minutes ago", or the day, for a time in seconds since the epoch. */
export function ago(seconds: number, now: number = Date.now()): string {
  const passed = Math.max(0, Math.round(now / 1000 - seconds));
  if (passed < 60) return 'just now';
  if (passed < 3600) {
    const minutes = Math.round(passed / 60);
    return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`;
  }
  if (passed < 86400) {
    const hours = Math.round(passed / 3600);
    return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  }
  return new Date(seconds * 1000).toISOString().slice(0, 10);
}

/** The last part of a path, for a chip: `/Users/ada/Documents/Work` is `Work`. */
export function folderName(path: string): string {
  const parts = path.split('/').filter(Boolean);
  return parts.at(-1) ?? path;
}

/** Where the agent's computer is: "on studio-mini, over Tailscale", or on this Mac. */
function whereIs(connection: OpenClawConnection): string {
  if (connection.computer === 'this Mac') return 'on this Mac';
  return `on ${connection.computer}, over Tailscale`;
}

export function renderGuided(deps: GuidedDeps, options: GuidedOptions): HTMLElement {
  const root = el('div', 'rl-oc-guided');
  const cards = el('div', 'rl-pref-list');
  const host = el('div', 'rl-oc-host');
  const problem = el('div', 'rl-pref-note rl-pref-failure');
  problem.setAttribute('role', 'status');
  let list: OpenClawConnection[] = [];
  let statuses = new Map<string, NodeStatus | null>();
  let sheet: Sheet | null = null;
  let removing: string | null = null;
  const alive = () => options.alive();

  const say = (error: unknown) => {
    problem.textContent = error instanceof Error ? error.message : String(error);
  };

  const apply = (next: OpenClawConnection[]) => {
    list = next;
    options.changed?.(next);
    if (alive()) draw();
  };

  const change = (handle: string, edit: OpenClawChange) => {
    problem.textContent = '';
    void deps.connections.change(handle, edit).then(apply, say);
  };

  function card(connection: OpenClawConnection): HTMLElement {
    const box = el('div', 'rl-oc-card');
    box.dataset['agent'] = connection.handle;
    const status = statuses.get(connection.handle) ?? null;

    const head = el('div', 'rl-oc-line');
    const avatar = el('span', 'rl-oc-avatar', connection.name.slice(0, 1).toUpperCase());
    avatar.setAttribute('aria-hidden', 'true');
    const title = el('div', 'rl-oc-row-text');
    title.append(
      el('b', undefined, connection.name),
      el('span', 'rl-oc-small', ` ${whereIs(connection)}`),
    );
    head.append(avatar, title, el('span', 'rl-oc-small rl-oc-state', connectionLine(status)));
    box.append(head);

    const writes = el('div', 'rl-oc-line');
    writes.append(
      el('span', 'rl-oc-label', 'Writes as'),
      el('span', 'rl-oc-chip', connection.handle),
    );
    box.append(writes);

    const level = el('div', 'rl-oc-line');
    const seg = el('div', 'rl-oc-seg');
    seg.setAttribute('role', 'radiogroup');
    seg.setAttribute('aria-label', `What ${connection.name} may do`);
    for (const { level: value, label, hint } of LEVELS) {
      const on = connection.level === value;
      const choice = el('button', `rl-oc-seg-choice${on ? ' rl-oc-seg-on' : ''}`, label);
      choice.type = 'button';
      choice.title = hint;
      choice.setAttribute('role', 'radio');
      choice.setAttribute('aria-checked', String(on));
      // Edit is held back until a later version: shown, and not chosen.
      choice.disabled = value === 'edit';
      choice.addEventListener('click', () => {
        if (!on) change(connection.handle, { level: value });
      });
      seg.append(choice);
    }
    level.append(el('span', 'rl-oc-label', 'Level'), seg);
    box.append(level);

    const folders = el('div', 'rl-oc-line rl-oc-wrap');
    folders.append(el('span', 'rl-oc-label', 'Folders'));
    if (connection.folders.length === 0) {
      folders.append(el('span', 'rl-oc-small', 'Only the document you ask from'));
    }
    for (const folder of connection.folders) {
      const chip = el('span', 'rl-oc-chip');
      chip.title = folder;
      chip.append(folderName(folder));
      const drop = el('button', 'rl-oc-chip-x', '×');
      drop.type = 'button';
      drop.setAttribute(
        'aria-label',
        `Remove ${folderName(folder)} from ${connection.name}’s folders`,
      );
      drop.addEventListener('click', () =>
        change(connection.handle, {
          folders: connection.folders.filter((other) => other !== folder),
        }),
      );
      chip.append(drop);
      folders.append(chip);
    }
    folders.append(
      button(
        'Add…',
        () => {
          problem.textContent = '';
          void deps.chooseFolder().then((picked) => {
            if (picked && !connection.folders.includes(picked)) {
              change(connection.handle, { folders: [...connection.folders, picked] });
            }
          }, say);
        },
        `Add a folder for ${connection.name}`,
      ),
    );
    box.append(folders);

    const used = el('div', 'rl-oc-line');
    used.append(
      el('span', 'rl-oc-label', 'Last used'),
      el('span', 'rl-oc-small', connection.last_used ? ago(connection.last_used) : 'Not yet'),
      el('span', 'rl-oc-grow'),
    );
    if (deps.test) {
      used.append(
        button('Test again', () => {
          problem.textContent = '';
          void deps.test?.run(connection.handle).then((result) => {
            problem.textContent = result.answered
              ? `${connection.name} answered: ${result.line}`
              : `${connection.name} didn’t answer.`;
          }, say);
        }),
      );
    }
    if (removing === connection.handle) {
      used.append(
        button(
          'Remove',
          () => {
            removing = null;
            void deps.node.stop(connection.handle).catch(() => {});
            void deps.connections
              .remove(connection.handle)
              .then((next) => apply(next as OpenClawConnection[]), say);
          },
          `Remove ${connection.name} for good`,
        ),
        button('Keep', () => {
          removing = null;
          draw();
        }),
      );
    } else {
      used.append(
        button(
          'Remove…',
          () => {
            removing = connection.handle;
            draw();
          },
          `Remove ${connection.name}`,
        ),
      );
    }
    box.append(used);
    if (removing === connection.handle) {
      box.append(
        el(
          'p',
          'rl-oc-small',
          `Redlines forgets the connection and what it was given. What ${connection.name} wrote stays in your documents, in its name.`,
        ),
      );
    }

    const problemId = status ? failureOf(status) : null;
    if (problemId) {
      const found = failure(problemId.id, {
        agent: connection.name,
        computer: connection.computer,
      });
      const fail = el('div', 'rl-oc-fail');
      fail.dataset['failure'] = problemId.id;
      fail.append(el('b', undefined, found.title), el('p', undefined, found.body));
      fail.append(
        button('Reconnect', () => {
          void deps.node.connect(connection.handle, null).catch(say);
        }),
      );
      if (problemId.detail) {
        const more = el('details', 'rl-oc-details');
        more.append(el('summary', undefined, 'Details'), el('p', 'rl-oc-small', problemId.detail));
        fail.append(more);
      }
      box.append(fail);
    }

    box.append(
      el(
        'p',
        'rl-oc-small',
        `Redlines limits what ${connection.name} does in your documents, not what ${connection.name} does elsewhere.`,
      ),
    );
    return box;
  }

  function draw(): void {
    cards.replaceChildren(...list.map(card));
  }

  const open = button('Connect OpenClaw…', () => {
    if (sheet) return;
    problem.textContent = '';
    const made = openSheet(deps, {
      alive,
      onClose: () => {
        sheet = null;
        open.hidden = false;
        void refresh();
      },
      onChanged: () => void refresh(),
    });
    sheet = made;
    open.hidden = true;
    host.append(made.element);
  });

  async function refresh(): Promise<void> {
    try {
      const next = await deps.connections.list();
      const asked = await Promise.all(
        next.map(
          async (connection) =>
            [
              connection.handle,
              await deps.node.status(connection.handle).catch(() => null),
            ] as const,
        ),
      );
      if (!alive()) return;
      const before = JSON.stringify([list, [...statuses]]);
      statuses = new Map(asked);
      list = next;
      options.changed?.(next);
      // Drawn again only when something changed: a card the person is using keeps its focus.
      if (JSON.stringify([list, [...statuses]]) !== before || cards.childElementCount === 0) draw();
    } catch (error) {
      if (alive()) say(error);
    }
  }

  // Where each connection is, looked at again every few seconds while the pane is open.
  const every = deps.poll?.node ?? 3000;
  const timer = setInterval(
    () => {
      if (!alive()) {
        clearInterval(timer);
        // The pane is gone: a sheet not finished goes with it, and what it began is undone.
        sheet?.dispose();
      } else if (list.length > 0) void refresh();
    },
    Math.max(every, 1000),
  );

  root.append(cards, open, host, problem);
  void refresh();
  if (options.start) {
    const made = openSheet(deps, {
      alive,
      onClose: () => {
        sheet = null;
        open.hidden = false;
      },
      onChanged: () => void refresh(),
      start: options.start,
    });
    sheet = made;
    open.hidden = true;
    host.append(made.element);
  }
  return root;
}
