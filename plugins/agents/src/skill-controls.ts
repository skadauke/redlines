// The Redlines skill, as a row of the Agents pane shows it: where the agent's copy is and how it
// compares with the app's, the button that installs or updates it, and what installing said. The
// host writes the skill and looks at its folder; this only asks, and draws. An agent's row and the
// OpenClaw section both use it.

import { button, el, reasonOf } from './pane-dom.ts';

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

/** What `skillControls` hands to the row that draws it. */
export interface SkillControls {
  /** The state line, the button and what installing said, in the order they go. */
  nodes: HTMLElement[];
  /** Looks at the skill's folder where the agent is found; says nothing of it where it isn't. */
  look(found: boolean): void;
}

export function skillControls(options: {
  agent: { name: string; skill?: PaneSkill };
  alive: () => boolean;
  /** Shows the General pane, where the command line is installed. */
  showGeneral: () => void;
  /** Whether the host has one: without it, there is no button to General. */
  canGeneral: boolean;
  /** Where the focus goes when the button that had it goes, if no button of the controls is left. */
  fallbackFocus: () => HTMLElement | null;
}): SkillControls {
  const { agent, alive } = options;
  const skillLine = el('div', 'rl-pref-note');
  skillLine.setAttribute('role', 'status');
  const skillActions = el('div', 'rl-pref-inline rl-pref-actions');
  const skillSaid = el('div', 'rl-pref-note');
  skillSaid.setAttribute('role', 'status');

  /** A button that waits while the skill is being written (`busy`). */
  const make = (text: string, label: string, run: () => void, busy: boolean) => {
    const made = button(text, label);
    made.disabled = busy;
    made.addEventListener('click', () => run());
    return made;
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
    if (commandLine.found !== 'onPath' && options.canGeneral) {
      const open = button('Open General', 'Open General, where the redlines command is installed');
      open.addEventListener('click', () => options.showGeneral());
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
    (skillActions.querySelector('button') ?? options.fallbackFocus())?.focus();
  };

  return { nodes: [skillLine, skillActions, skillSaid], look: lookAtSkill };
}
