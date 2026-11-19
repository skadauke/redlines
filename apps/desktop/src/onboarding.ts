// The first-launch onboarding (#1206, design §5.11a): a sheet of four screens in the first window.
// You (name and handle), your agent, set up this Mac (three installs, each the app's own command and
// each skippable), and a short tour of the Welcome to Redlines document that points at the pen, the
// views button and the toolbar's command palette. It owns no storage and no command: everything it
// does goes through `OnboardingDeps`, so the page, the app and the tests give it theirs.

import { deriveHandle, toHandle } from './handle.ts';
import './ui/onboarding.css';

export interface OnboardingAgent {
  id: string;
  name: string;
}

/** What an install said: whether it worked, and one line for the row. */
export interface InstallResult {
  ok: boolean;
  line: string;
}

export interface OnboardingDeps {
  /** The window's element the sheet is attached to. */
  container: HTMLElement;
  /** What the fields start with: what Preferences hold, else git's. */
  identity: { name: string; handle: string };
  saveIdentity(name: string, handle: string): void;
  /** The agents found on this Mac. */
  agents(): Promise<OnboardingAgent[]>;
  defaultAgent: string | null;
  saveDefaultAgent(id: string): void;
  /** Whether there is a Quick Look preview to turn on (only the app can say). */
  quickLook: boolean;
  install: {
    skills(agents: readonly OnboardingAgent[]): Promise<InstallResult>;
    quickLook(): Promise<InstallResult>;
    commandLine(): Promise<InstallResult>;
  };
  /** Opens the Welcome to Redlines document in this window. */
  openWelcome(): Promise<void>;
  /** What the tour points at, when it is drawn. */
  anchors: Record<'pen' | 'views' | 'palette', () => HTMLElement | null>;
  /** Gives the keyboard back to the editor. */
  restoreFocus(): void;
  /** Called at each screen, for what the page notes (that it began). */
  onStep?(step: number): void;
}

export type OnboardingEnd = 'finished' | 'skipped';

const STEPS = 4;

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

function button(label: string, primary = false): HTMLButtonElement {
  const b = el('button', `rl-sheet-button${primary ? ' rl-sheet-default' : ''}`, label);
  b.type = 'button';
  return b;
}

/** The three cards of the tour, in order. */
const TOUR = [
  {
    key: 'pen',
    title: 'The Redlines pen',
    text: 'Turns Track Changes on and off. While it is on, every edit you make is a change somebody can accept or reject.',
  },
  {
    key: 'views',
    title: 'Views',
    text: 'Clean shows the text as it will read, Redlines shows every change, and Plain shows the Markdown itself.',
  },
  {
    key: 'palette',
    title: 'The toolbar and its commands',
    text: 'Open it and type to find any command or setting by name: the command palette.',
  },
] as const;

/** Runs the onboarding. Resolves when it ends, finished, or skipped from any screen. */
export function runOnboarding(deps: OnboardingDeps): Promise<OnboardingEnd> {
  return new Promise((resolve) => {
    const backdrop = el('div', 'rl-sheet-backdrop');
    const sheet = el('div', 'rl-sheet rl-onb');
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-labelledby', 'rl-onb-title');
    backdrop.append(sheet);
    deps.container.append(backdrop);
    let tourCard: HTMLElement | null = null;
    let target: HTMLElement | null = null;
    let ended = false;

    const end = (how: OnboardingEnd) => {
      if (ended) return;
      ended = true;
      backdrop.remove();
      tourCard?.remove();
      target?.classList.remove('rl-tour-target');
      deps.restoreFocus();
      resolve(how);
    };

    /** The frame every screen shares: its place, its title, its body, and the buttons. */
    const frame = (
      step: number,
      title: string,
      detail: string,
      body: HTMLElement[],
      buttons: HTMLButtonElement[],
      onSkip: () => void,
    ) => {
      deps.onStep?.(step);
      const place = el('div', 'rl-onb-step', `${step} of ${STEPS}`);
      const heading = el('div', 'rl-sheet-title rl-onb-title', title);
      heading.id = 'rl-onb-title';
      const sub = el('div', 'rl-sheet-detail', detail);
      const row = el('div', 'rl-sheet-buttons');
      row.append(...buttons);
      const skipAll = button('Skip Setup');
      skipAll.classList.add('rl-onb-skip-all');
      skipAll.addEventListener('click', () => end('skipped'));
      sheet.replaceChildren(place, heading, sub, ...body, row, skipAll);
      sheet.dataset['step'] = String(step);
      const field = sheet.querySelector<HTMLElement>('input, select');
      if (field) field.focus();
      else buttons.at(-1)?.focus();
      backdrop.onkeydown = (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onSkip();
        }
      };
    };

    // 1. You.
    const you = () => {
      const name = el('input', 'rl-sheet-field');
      name.type = 'text';
      name.value = deps.identity.name;
      name.setAttribute('aria-label', 'Name');
      name.placeholder = 'Your name';
      const handle = el('input', 'rl-sheet-field');
      handle.type = 'text';
      handle.value = deps.identity.handle;
      handle.setAttribute('aria-label', 'Handle');
      handle.placeholder = 'handle';
      handle.spellcheck = false;
      handle.autocomplete = 'off';
      // The handle follows the name until the person writes one of their own.
      let own = deps.identity.handle !== '' && deps.identity.handle !== deriveHandle(name.value);
      name.addEventListener('input', () => {
        if (!own) handle.value = deriveHandle(name.value);
      });
      handle.addEventListener('input', () => {
        own = true;
      });
      const fields = el('div', 'rl-onb-fields');
      const label = (text: string, input: HTMLElement) => {
        const l = el('label', 'rl-onb-label');
        l.append(el('span', undefined, text), input);
        return l;
      };
      fields.append(label('Name', name), label('Handle', handle));
      const next = button('Continue', true);
      const skip = button('Skip');
      const go = (save: boolean) => {
        if (save && name.value.trim()) {
          deps.saveIdentity(name.value.trim(), toHandle(handle.value) || deriveHandle(name.value));
        }
        agent();
      };
      next.addEventListener('click', () => go(true));
      skip.addEventListener('click', () => go(false));
      frame(
        1,
        'Who are you?',
        'Your name and handle go on the changes and comments you make, so the people you work with can tell who did what.',
        [fields],
        [skip, next],
        () => go(false),
      );
      backdrop.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && sheet.dataset['step'] === '1') {
          event.preventDefault();
          go(true);
        }
      });
    };

    // 2. Your agent.
    const agent = () => {
      const found: { list: OnboardingAgent[] | null } = { list: null };
      const select = el('select', 'rl-sheet-field');
      select.setAttribute('aria-label', 'Default agent');
      const note = el('div', 'rl-onb-note', 'Looking for agents on this Mac…');
      const next = button('Continue', true);
      const skip = button('Skip');
      const go = (save: boolean) => {
        if (save && found.list?.length) deps.saveDefaultAgent(select.value);
        setup();
      };
      next.addEventListener('click', () => go(true));
      skip.addEventListener('click', () => go(false));
      frame(
        2,
        'Your agent',
        'An agent such as Claude Code or Codex answers when you @mention it in a comment or ask it a question.',
        [select, note],
        [skip, next],
        () => go(false),
      );
      select.hidden = true;
      void deps.agents().then(
        (list) => {
          if (ended || sheet.dataset['step'] !== '2') return;
          found.list = list;
          if (list.length === 0) {
            note.textContent =
              'No agent was found on this Mac. You can add one later in Preferences › Agents.';
            next.disabled = true;
            return;
          }
          select.replaceChildren(
            ...list.map((a) => {
              const option = el('option', undefined, a.name);
              option.value = a.id;
              return option;
            }),
          );
          select.value = list.some((a) => a.id === deps.defaultAgent)
            ? (deps.defaultAgent as string)
            : (list[0]?.id ?? '');
          select.hidden = false;
          note.textContent =
            list.length > 1
              ? 'It answers an Ask that names none. Change it any time in Preferences › Agents.'
              : 'Found on this Mac. Preferences › Agents has its settings.';
        },
        () => {
          note.textContent = 'Couldn’t look for agents. Preferences › Agents has them.';
          next.disabled = true;
        },
      );
    };

    // 3. Set up this Mac.
    const setup = () => {
      const rows: { key: 'skills' | 'quickLook' | 'commandLine'; title: string; text: string }[] = [
        {
          key: 'skills',
          title: 'The Redlines skill',
          text: 'Teaches the agents on this Mac to read and write Redlines files. Preferences › Agents has it afterwards.',
        },
        ...(deps.quickLook
          ? [
              {
                key: 'quickLook' as const,
                title: 'Quick Look preview',
                text: 'Shows a document’s changes when you press Space on it in Finder. Opens System Settings, where macOS turns it on.',
              },
            ]
          : []),
        {
          key: 'commandLine',
          title: 'The redlines command',
          text: 'Lets a program or an agent in Terminal work on Redlines files. Preferences › General has it afterwards.',
        },
      ];
      const checks = new Map<string, HTMLInputElement>();
      const results = new Map<string, HTMLElement>();
      const list = el('div', 'rl-onb-installs');
      for (const row of rows) {
        const item = el('label', 'rl-onb-install');
        const box = el('input');
        box.type = 'checkbox';
        box.checked = true;
        box.setAttribute('aria-label', row.title);
        checks.set(row.key, box);
        const words = el('span', 'rl-onb-install-words');
        const result = el('span', 'rl-onb-install-result');
        result.setAttribute('role', 'status');
        results.set(row.key, result);
        words.append(
          el('span', 'rl-onb-install-title', row.title),
          el('span', 'rl-onb-install-text', row.text),
          result,
        );
        item.append(box, words);
        list.append(item);
      }
      const install = button('Install and Continue', true);
      const skip = button('Skip');
      let busy = false;
      skip.addEventListener('click', () => {
        if (!busy) void tour();
      });
      install.addEventListener('click', () => {
        if (busy) return;
        busy = true;
        install.disabled = true;
        skip.disabled = true;
        void (async () => {
          const found = await deps.agents().catch(() => []);
          for (const row of rows) {
            if (!checks.get(row.key)?.checked) continue;
            const result = results.get(row.key)!;
            result.textContent = 'Installing…';
            const done =
              row.key === 'skills'
                ? await deps.install.skills(found).catch(failed)
                : await deps.install[row.key]().catch(failed);
            result.textContent = done.line;
            result.classList.toggle('rl-onb-failed', !done.ok);
          }
          // The results stay in view until the person goes on.
          install.textContent = 'Continue';
          install.disabled = false;
          install.onclick = () => void tour();
          busy = false;
        })();
      });
      frame(
        3,
        'Set up this Mac',
        'Each is optional, and nothing is installed until you choose Install and Continue.',
        [list],
        [skip, install],
        () => !busy && void tour(),
      );
    };

    const failed = (error: unknown): InstallResult => ({
      ok: false,
      line: error instanceof Error ? error.message : String(error),
    });

    // 4. The tour: the Welcome document, and a card for each of the three things.
    const tour = async () => {
      deps.onStep?.(4);
      backdrop.classList.add('rl-onb-clear');
      sheet.replaceChildren();
      sheet.hidden = true;
      await deps.openWelcome().catch(() => {});
      if (ended) return;
      let at = 0;
      const show = () => {
        target?.classList.remove('rl-tour-target');
        tourCard?.remove();
        const item = TOUR[at]!;
        const anchor = deps.anchors[item.key]();
        target = anchor;
        anchor?.classList.add('rl-tour-target');
        const card = el('div', 'rl-tour-card');
        card.setAttribute('role', 'dialog');
        card.setAttribute('aria-label', item.title);
        const place = el('div', 'rl-onb-step', `4 of ${STEPS}, ${at + 1} of ${TOUR.length}`);
        const title = el('div', 'rl-sheet-title', item.title);
        const text = el('div', 'rl-sheet-detail', item.text);
        const buttons = el('div', 'rl-sheet-buttons');
        const last = at === TOUR.length - 1;
        const skip = button('Skip Tour');
        const next = button(last ? 'Done' : 'Next', true);
        skip.addEventListener('click', () => end('finished'));
        next.addEventListener('click', () => {
          if (last) end('finished');
          else {
            at += 1;
            show();
          }
        });
        buttons.append(...(last ? [next] : [skip, next]));
        card.append(place, title, text, buttons);
        deps.container.append(card);
        tourCard = card;
        // Under the anchor, the card's arrow over its middle.
        const rect = anchor?.getBoundingClientRect();
        const width = card.offsetWidth || 300;
        const middle = rect ? rect.left + rect.width / 2 : window.innerWidth - 60;
        const left = Math.max(12, Math.min(middle - width / 2, window.innerWidth - width - 12));
        card.style.left = `${left}px`;
        card.style.top = `${(rect?.bottom ?? 40) + 12}px`;
        card.style.setProperty('--rl-tour-arrow', `${Math.round(middle - left)}px`);
        next.focus();
        card.onkeydown = (event) => {
          if (event.key === 'Escape') end('finished');
        };
      };
      show();
    };

    you();
  });
}
