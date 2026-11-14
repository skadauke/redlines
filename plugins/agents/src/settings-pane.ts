// The Agents pane of Preferences (design, Preferences and The log): the agents found on this Mac,
// their state and the next step for each (Update, Sign In, or the command that installs it, and
// Check Again always), what agents may read, the answers remembered per folder, and the logs.
// Where the host keeps a list of other agents (any agent that speaks the Agent Client Protocol, as
// a name and a command), they are listed too; the app keeps that list out of the pane for now.
// The window it draws in is the app's; this knows only the rows, and takes what it needs from
// `deps`.
// Its classes are the Preferences window's (apps/desktop/src/preferences/preferences.css).

import type { AgentState } from '@redlines/plugin-api';
import { privacyMessage } from './blocked-message.ts';

/** The part of the app's settings this pane reads and changes. */
export interface AgentsPaneSettings {
  agentScope: 'document' | 'folder' | 'everything';
  /** What the person allowed each agent, keyed `agent|folder`. */
  consent: Record<string, 'document' | 'folder' | 'everything' | 'no'>;
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
  /** One line of what it said last: why it failed, or what an update that changed nothing said. */
  message: string;
  /** It ended at once without signing in, as a login that wants a terminal does. */
  needsTerminal?: boolean;
  /** The person stopped it, or the window that asked for it closed. */
  stopped?: true;
}

/** An update or a sign-in under way, which the pane shows and follows to its end. */
export interface SetupUnderWay {
  doing: 'update' | 'sign-in';
  ended: Promise<SetupResult>;
}

/** Where an agent's copy of the Redlines skill is, and how it compares with this app's. */
export interface SkillState {
  /** The skill's folder, as a person writes it: `~/.claude/skills/redlines`. */
  folder: string;
  /**
   * None there; this app's version; an older one, or one made by hand, which Update replaces; a
   * newer one; or something else that is there, which Redlines leaves as it is.
   */
  state: 'missing' | 'current' | 'older' | 'newer' | 'other';
  /** For a newer copy and for something else: the sentence that says why it is left alone. */
  message: string | null;
}

/** What installing or updating the skill did, and where the command it runs is. */
export interface SkillInstalled {
  folder: string;
  /** The skill runs `redlines`, so the pane says when a shell can't find it. */
  commandLine: { found: 'onPath' } | { found: 'offPath'; linked: string } | { found: 'missing' };
}

/** What the host does about an agent's skill. */
export interface PaneSkill {
  /** Looks at the agent's skill folder, and changes nothing. */
  status(): Promise<SkillState>;
  /** Writes this app's copy where the agent reads it, or replaces an older one. */
  install(): Promise<SkillInstalled>;
  /** Another agent that reads the same folder, which the line that says where it went names. */
  alsoReadBy?: string;
}

/** An agent of the pane, and what the host can do about it. */
export interface PaneAgent {
  id: string;
  name: string;
  /** Installs the Redlines skill for the agent. Without it, the row says nothing of a skill. */
  skill?: PaneSkill;
  /** `fresh` asks the program again, where the host keeps what it found. */
  detect(fresh?: boolean): Promise<AgentState>;
  /** Runs the agent's own updater, for the way it was installed, which the host knows. */
  update?(): Promise<SetupResult>;
  /** Runs the agent's own login, which opens the browser; Redlines never sees the credentials. */
  signIn?(): Promise<SetupResult>;
  /** Opens Terminal with the login's command, for a login that needs one. */
  signInInTerminal?(): Promise<void>;
  /** Stops the update or the sign-in under way, which then ends as stopped. */
  stop?(): Promise<void>;
  /**
   * An update or a sign-in already under way for the agent, as the host keeps it: the pane is drawn
   * again when another window changes a setting, and a row drawn then follows what the one before
   * it started, instead of offering to start it again.
   */
  running?(): SetupUnderWay | undefined;
}

export interface AgentsPaneDeps {
  /** The agents to list. Each is asked when the pane is drawn, never before. */
  agents: readonly PaneAgent[];
  /** Puts text on the clipboard, for the install command's Copy. Without it, there is no Copy. */
  copy?(text: string): Promise<void>;
  /**
   * Shows the General pane, where the command line is installed, which the skill needs. Without
   * it, the pane says where the command line is installed and offers no button.
   */
  showGeneral?(): void;
  /**
   * Lists the folders among what an agent may read at This folder and my home folder that macOS
   * isn't letting Redlines read, from the app, which is also what makes macOS ask the person, once:
   * so it is asked when the person picks that choice, a moment they expect, and never before.
   */
  homeAccess?(): Promise<readonly { name: string; folder: string }[]>;
  /** Opens System Settings at Privacy & Security › Files and Folders. */
  openFilesAndFoldersSettings?(): Promise<void>;
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
  everything: 'May read the folder and the home folder',
  document: 'This document only',
  no: 'Not allowed',
} as const;

/**
 * What the home folder choice means, said plainly, as the choice is made: what it opens and leaves
 * out, that writes don't change, the risk of what someone else wrote in a document, and that macOS
 * will ask (Documents, Desktop, Downloads and iCloud Drive are protected folders).
 */
const HOME_NOTE =
  'Agents can read related files anywhere in your home folder, such as a reference document in ' +
  'another project. Hidden files and folders and ~/Library are left out, except the cloud ' +
  'folders in it (iCloud Drive, Dropbox, Google Drive, OneDrive and Box). Agents change only the ' +
  'document. Text in a document that someone else wrote, such as a comment, a reply or deleted ' +
  'text, could try to make an agent read a private file and quote it into a comment or a ' +
  'suggestion, which then travels with the document. macOS may ask whether Redlines can access ' +
  'your Documents, Desktop or Downloads folder or iCloud Drive, because agents read through ' +
  'Redlines: say yes there to let them.';

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
  // back to it, the pane looks again, once, for each agent that waits on that and has nothing
  // under way. One look that still finds it signed out is the last, until Check Again.
  const waiting = new Set<string>();
  const comeBack = () => {
    for (const look of looks) {
      if (waiting.has(look.id) && !look.busy()) look.check(true, { viaFocus: true });
    }
  };
  const looks: { id: string; check: AgentRow['check']; busy: () => boolean }[] = [];
  window.addEventListener('focus', comeBack);

  for (const agent of deps.agents) {
    const drawn = agentRow(agent, deps, () => alive, waiting);
    looks.push({
      id: agent.id,
      check: (fresh, options) => drawn.check(fresh, options),
      busy: () => drawn.busy(),
    });
    container.append(drawn.row);
    // Run now that the pane is open: nothing in the app asks at launch. An update or a sign-in
    // that is already under way is followed instead.
    drawn.start();
  }

  if (deps.others) container.append(otherAgents(deps.others, () => alive));

  const scope = el('select');
  for (const [value, label] of [
    ['document', 'This document'],
    ['folder', 'This folder'],
    ['everything', 'This folder and my home folder'],
  ] as const) {
    const option = el('option', undefined, label);
    option.value = value;
    scope.append(option);
  }
  scope.value = deps.settings().agentScope;
  // The note comes with the widest choice, where the risk is, and goes with it.
  // The risk is said where the choice is made, and a screen reader says it with the choice and
  // again when the choice changes it.
  const scopeNote = el('div', 'rl-pref-note');
  scopeNote.id = `rl-agents-${nextId++}`;
  scopeNote.setAttribute('role', 'status');
  scope.setAttribute('aria-describedby', scopeNote.id);
  const showScopeNote = () => {
    scopeNote.textContent = scope.value === 'everything' ? HOME_NOTE : '';
  };
  showScopeNote();
  // What macOS holds back from Redlines, found when the choice is made: the folders, and a way to
  // System Settings, where Redlines can be turned on.
  const holdingBack = el('div', 'rl-pref-note rl-pref-failure');
  holdingBack.setAttribute('role', 'status');
  let looking = 0;
  const lookForRefusals = () => {
    const mine = ++looking;
    holdingBack.replaceChildren();
    if (scope.value !== 'everything' || !deps.homeAccess) return;
    let asking: Promise<readonly { name: string; folder: string }[]>;
    try {
      asking = deps.homeAccess();
    } catch (error) {
      asking = Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
    asking.then(
      (refused) => {
        if (!alive || mine !== looking || refused.length === 0) return;
        const lines = refused.map(({ name, folder }) =>
          el('div', undefined, privacyMessage(folder, name).text),
        );
        const open = button('Open System Settings');
        open.addEventListener('click', () => {
          const failed = () => {
            if (alive) holdingBack.append(el('div', undefined, 'Couldn’t open System Settings.'));
          };
          try {
            void Promise.resolve(deps.openFilesAndFoldersSettings?.()).catch(failed);
          } catch {
            failed();
          }
        });
        holdingBack.replaceChildren(...lines, open);
      },
      () => {},
    );
  };
  scope.addEventListener('change', () => {
    const chosen = scope.value;
    deps.update({
      agentScope: chosen === 'document' || chosen === 'everything' ? chosen : 'folder',
    });
    showScopeNote();
    lookForRefusals();
  });
  const scopeExtras = el('div');
  scopeExtras.append(scopeNote, holdingBack);
  container.append(row('What agents may read', scope, scopeExtras));

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
  const list = (entries: [string, AgentsPaneSettings['consent'][string]][]): HTMLElement => {
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
  if (!state.found) return state.unchecked === true ? 'Couldn’t check' : 'Not installed';
  if (state.signedIn) return 'Signed in';
  if (state.reason === 'signed-out') return 'Signed out';
  // Sign-in is reported once the program has been asked, and only as it said.
  if (state.account === undefined) return 'Needs an update';
  return `Needs an update · ${state.account === 'signed-in' ? 'signed in' : 'signed out'}`;
}

/** What a row says while an update or a sign-in runs. */
const DOING = { update: 'Updating…', 'sign-in': 'Signing in…' } as const;

/** What the row says of the Redlines skill in the agent's folder; `done` is what was just done. */
function skillText(skill: SkillState, done: 'installed' | 'updated' | null): string {
  switch (skill.state) {
    case 'missing':
      return 'Redlines skill: not installed.';
    case 'current':
      return `Redlines skill ${done ?? 'installed'} in ${skill.folder}.`;
    case 'older':
      return `Redlines skill installed in ${skill.folder}, and this app has a newer one.`;
    case 'newer':
    case 'other':
      // Left as it is, and the sentence says why.
      return skill.message ?? '';
  }
}

/** One agent's row, and how the pane drives it. */
interface AgentRow {
  row: HTMLElement;
  /**
   * Asks the program again, `fresh` when the host keeps an answer. `updated` is an update that
   * just ended well, and `viaFocus` a look made because the window came back to the front.
   */
  check(fresh: boolean, options?: { updated?: SetupResult; viaFocus?: boolean }): void;
  /** Draws the row for the first time: looks, or follows what is under way already. */
  start(): void;
  /** Whether an update or a sign-in is under way in this row. */
  busy(): boolean;
}

/**
 * One agent's row: its state, the version and the path of the program found (so that a stale
 * second copy earlier on the PATH shows), and the next step as a button. The host runs the update
 * and the sign-in, each its own fixed command; the pane only asks, can stop them, and looks again
 * when one ends.
 */
function agentRow(
  agent: PaneAgent,
  deps: AgentsPaneDeps,
  alive: () => boolean,
  waiting: Set<string>,
): AgentRow {
  const status = el('div', 'rl-pref-status', 'Checking…');
  status.setAttribute('role', 'status');
  const where = el('div', 'rl-pref-note');
  const help = el('div', 'rl-pref-note');
  const install = el('div', 'rl-pref-inline rl-pref-actions');
  const actions = el('div', 'rl-pref-inline rl-pref-actions');
  const said = el('div', 'rl-pref-note rl-pref-failure');
  said.setAttribute('role', 'status');
  // The Redlines skill, which teaches the agent what a Redlines file is: its state, the button
  // that installs it, and what installing said.
  const skillLine = el('div', 'rl-pref-note');
  skillLine.setAttribute('role', 'status');
  const skillActions = el('div', 'rl-pref-inline rl-pref-actions');
  const skillSaid = el('div', 'rl-pref-note');
  skillSaid.setAttribute('role', 'status');
  const rest = el('div');
  rest.append(where, help, install, actions, said, skillLine, skillActions, skillSaid);
  const root = row(agent.name, status, rest);

  /** The latest question asked, so that an older answer never draws over a newer one. */
  let asked = 0;
  /** An update or a sign-in is under way: nothing else is started meanwhile. */
  let activity: 'update' | 'sign-in' | null = null;
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
    if (activity === 'sign-in') help.textContent = 'Finish in your browser.';
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
      actions.append(make('Update', `Update ${agent.name}`, () => updateIt(), busy));
    }
    if (canSignIn) {
      actions.append(make('Sign In', `Sign in to ${agent.name}`, () => signInIt(), busy));
    }
    actions.append(make('Check Again', `Check ${agent.name} again`, () => check(true), busy));
    // What is under way can be stopped, which a login the person walked away from needs.
    if (activity !== null && agent.stop) {
      const what = activity === 'update' ? 'update' : 'sign-in';
      actions.append(make('Cancel', `Cancel the ${what} of ${agent.name}`, () => stopIt(), false));
    }
  };

  /** What the skill's folder holds; `failed` when it couldn't be looked at; none until it is. */
  let skill: SkillState | 'failed' | null = null;
  /** The skill is being written: its button waits. */
  let installing = false;
  /** What this row just did to the skill, until the folder is looked at again. */
  let skillDone: 'installed' | 'updated' | null = null;
  let skillAsked = 0;

  const drawSkill = () => {
    skillActions.replaceChildren();
    if (skill === null) {
      skillLine.textContent = '';
      return;
    }
    if (skill === 'failed') {
      skillLine.textContent = 'Couldn’t look at the Redlines skill.';
      return;
    }
    skillLine.textContent = installing
      ? 'Installing the Redlines skill…'
      : skillText(skill, skillDone);
    const next =
      skill.state === 'missing' ? 'Install' : skill.state === 'older' ? 'Update' : undefined;
    if (next !== undefined) {
      const label = `${next} the Redlines skill for ${agent.name}`;
      skillActions.append(make(`${next} Skill`, label, () => installSkill(), installing));
    }
  };

  /** Looks at the skill's folder once the agent is found, and says nothing of it when it isn't. */
  const lookAtSkill = (found: boolean) => {
    const mine = ++skillAsked;
    const host = agent.skill;
    if (!host || !found) {
      // An agent that isn't there has no skill to say anything of, nor a note about the last one.
      skill = null;
      skillDone = null;
      skillSaid.classList.remove('rl-pref-failure');
      skillSaid.replaceChildren();
      drawSkill();
      return;
    }
    void Promise.resolve()
      .then(() => host.status())
      .then(
        (state): SkillState | 'failed' => state ?? 'failed',
        (): 'failed' => 'failed',
      )
      .then((state) => {
        if (!alive() || mine !== skillAsked || installing) return;
        skill = state;
        skillDone = null;
        skillSaid.replaceChildren();
        drawSkill();
      });
  };

  /** What installing said besides where: what else reads the folder, and what the skill needs. */
  const installedNote = (done: SkillInstalled): (string | HTMLElement)[] => {
    const also = agent.skill?.alsoReadBy;
    const sentences = also ? [`${also} reads that folder too.`] : [];
    const { commandLine } = done;
    // The skill runs `redlines`, which the app installs from General.
    if (commandLine.found === 'offPath') {
      sentences.push(
        `The skill runs the redlines command, which is linked at ${commandLine.linked}, but that folder isn’t on your PATH.`,
      );
    } else if (commandLine.found === 'missing') {
      sentences.push(
        'The skill runs the redlines command, which isn’t installed yet. Install it in General › Command line.',
      );
    }
    const parts: (string | HTMLElement)[] = sentences.length > 0 ? [sentences.join(' ')] : [];
    if (commandLine.found !== 'onPath' && deps.showGeneral) {
      const open = button('Open General', 'Open General, where the redlines command is installed');
      open.addEventListener('click', () => deps.showGeneral?.());
      parts.push(' ', open);
    }
    return parts;
  };

  const installSkill = () => {
    const host = agent.skill;
    if (!host || installing) return;
    const updating = skill !== null && skill !== 'failed' && skill.state === 'older';
    // A look that was asked before this and answers after it would draw over what it did.
    skillAsked++;
    installing = true;
    skillSaid.classList.remove('rl-pref-failure');
    skillSaid.replaceChildren();
    drawSkill();
    let started: Promise<SkillInstalled>;
    try {
      started = host.install();
    } catch (error) {
      started = Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
    started.then(
      (done) => {
        if (!alive()) return;
        installing = false;
        // It is what the app carries now, and what is there says so without asking the folder.
        skill = { folder: done.folder, state: 'current', message: null };
        skillDone = updating ? 'updated' : 'installed';
        skillSaid.replaceChildren(...installedNote(done));
        drawSkill();
        keepFocus();
      },
      (error: unknown) => {
        if (!alive()) return;
        installing = false;
        skillSaid.classList.add('rl-pref-failure');
        skillSaid.textContent = reasonOf(error);
        drawSkill();
        keepFocus();
      },
    );
  };

  /** A button the person pressed goes while it works; the focus goes back into the row. */
  const keepFocus = () => {
    const active = document.activeElement;
    if (active && active !== document.body) return;
    (skillActions.querySelector('button') ?? actions.querySelector('button'))?.focus();
  };

  const check: AgentRow['check'] = (fresh, options) => {
    // An update or a sign-in is what the row is about; it looks again by itself when it ends.
    if (activity !== null) return;
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
        lookAtSkill(state?.found === true);
        const ready = state?.found === true && state.signedIn;
        if (ready) {
          waiting.delete(agent.id);
          // What failed before is no longer so.
          said.textContent = '';
        } else if (options?.viaFocus) {
          waiting.delete(agent.id);
        }
        // An update that ran and left the program as old as it was says what it said, as there
        // is nothing else to tell why: a package manager's list may lag the version needed.
        if (options?.updated && state?.found && !state.signedIn && state.reason === 'too-old') {
          const was = state.version === undefined ? agent.name : `${agent.name} ${state.version}`;
          const words = options.updated.message;
          said.textContent = `The update ran, but ${was} is still too old.${words ? ` It said: ${words}` : ''}`;
        }
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
   * Follows an update or a sign-in, as the host runs it, to its end: says how it ended, and looks
   * again. A login that failed at once wants a terminal, and gets one; an update that failed at
   * once doesn't. One the person stopped says nothing.
   */
  const follow = async (doing: 'update' | 'sign-in', started: Promise<SetupResult>) => {
    activity = doing;
    said.textContent = '';
    draw(last, DOING[doing]);
    let note = '';
    let finished: SetupResult | undefined;
    try {
      finished = await started;
      if (finished.stopped === true) {
        note = '';
      } else if (!finished.ok) {
        note =
          doing === 'sign-in' && finished.needsTerminal && agent.signInInTerminal
            ? await openTerminal()
            : `${doing === 'update' ? 'The update didn’t finish' : 'Sign-in didn’t finish'}: ${finished.message}`;
      }
    } catch (error) {
      note = reasonOf(error);
    }
    if (!alive()) return;
    activity = null;
    said.textContent = note;
    check(true, finished?.ok === true && doing === 'update' ? { updated: finished } : undefined);
  };

  /** A login that wants a terminal gets one, with its command, and the pane waits for the person. */
  const openTerminal = async (): Promise<string> => {
    await agent.signInInTerminal?.();
    waiting.add(agent.id);
    return 'Sign-in needs a terminal, so Redlines opened one. Finish there, then come back here.';
  };

  const begin = (doing: 'update' | 'sign-in', running: () => Promise<SetupResult>) => {
    if (activity !== null) return;
    // Asked of the host from here, so that it is the host's, and so is still going if the pane is
    // drawn again before it ends.
    let started: Promise<SetupResult>;
    try {
      started = running();
    } catch (error) {
      started = Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
    void follow(doing, started);
  };
  const updateIt = () => begin('update', () => agent.update!());
  const signInIt = () => begin('sign-in', () => agent.signIn!());
  const stopIt = () => {
    const stopped = (error?: unknown) => {
      if (error !== undefined && alive()) said.textContent = 'Couldn’t stop it.';
    };
    try {
      void Promise.resolve(agent.stop?.()).catch((error: unknown) => stopped(error ?? 'no'));
    } catch (error) {
      stopped(error ?? 'no');
    }
  };

  return {
    row: root,
    check,
    busy: () => activity !== null,
    start() {
      const going = agent.running?.();
      if (going) void follow(going.doing, going.ended);
      else check(false);
    },
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
