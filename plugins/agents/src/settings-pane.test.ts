// @vitest-environment happy-dom
import type { AgentState } from '@redlines/plugin-api';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  renderAgentsPane,
  type AgentsPaneDeps,
  type AgentsPaneSettings,
  type OtherAgent,
  type PaneSkill,
  type SetupResult,
  type SetupUnderWay,
  type SkillInstalled,
  type SkillState,
} from './settings-pane.ts';

afterEach(() => document.body.replaceChildren());

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** What a finished update or sign-in says. */
const done: SetupResult = { ok: true, message: '' };

function setup(
  states: Record<string, AgentState | Error | Promise<AgentState>>,
  start: Partial<AgentsPaneSettings> = {},
  skills: Record<string, PaneSkill> = {},
) {
  let settings: AgentsPaneSettings = { agentScope: 'folder', consent: {}, ...start };
  const detect = vi.fn<(id: string, fresh?: boolean) => Promise<AgentState>>((id) => {
    const state = states[id];
    if (state instanceof Error) return Promise.reject(state);
    return Promise.resolve(state!);
  });
  const update = vi.fn((change: Partial<AgentsPaneSettings>) => {
    settings = { ...settings, ...change };
  });
  const openLogs = vi.fn<() => Promise<void>>(() => Promise.resolve());
  const updater = vi.fn<(id: string) => Promise<SetupResult>>(() => Promise.resolve(done));
  const signer = vi.fn<(id: string) => Promise<SetupResult>>(() => Promise.resolve(done));
  const terminal = vi.fn<(id: string) => Promise<void>>(() => Promise.resolve());
  const copy = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve());
  const stopper = vi.fn<(id: string) => Promise<void>>(() => Promise.resolve());
  const homeAccess = vi.fn<() => Promise<{ name: string; folder: string }[]>>(() =>
    Promise.resolve([]),
  );
  const openSettings = vi.fn<() => Promise<void>>(() => Promise.resolve());
  const showGeneral = vi.fn<() => void>();
  /** What the host says is under way, by agent. */
  const under: Record<string, SetupUnderWay | undefined> = {};
  const deps: AgentsPaneDeps = {
    agents: ['claude', 'codex'].map((id) => ({
      id,
      name: id === 'claude' ? 'Claude' : 'Codex',
      detect: (fresh) => detect(id, fresh),
      update: () => updater(id),
      signIn: () => signer(id),
      signInInTerminal: () => terminal(id),
      stop: () => stopper(id),
      running: () => under[id],
      ...(skills[id] ? { skill: skills[id] } : {}),
    })),
    copy,
    showGeneral,
    homeAccess,
    openFilesAndFoldersSettings: openSettings,
    settings: () => settings,
    update,
    openLogs,
  };
  const container = document.createElement('div');
  document.body.append(container);
  return {
    deps,
    container,
    detect,
    update,
    openLogs,
    updater,
    signer,
    terminal,
    copy,
    stopper,
    homeAccess,
    openSettings,
    showGeneral,
    under,
    now: () => settings,
  };
}

const row = (container: HTMLElement, label: string) => {
  const found = container.querySelector<HTMLElement>(`[data-row="${label}"]`);
  if (!found) throw new Error(`no row ${label}`);
  return found;
};

describe('the Agents pane', () => {
  it('asks the agents nothing until it is drawn', async () => {
    const { deps, container, detect } = setup({});
    expect(detect).not.toHaveBeenCalled();
    detect.mockImplementation(() => Promise.resolve({ found: false, help: 'x' }));
    renderAgentsPane(container, deps);
    await settle();
    expect(detect).toHaveBeenCalledTimes(2);
  });

  /** The buttons of one agent's row, by their words. */
  const buttons = (container: HTMLElement, label: string) =>
    [...row(container, label).querySelectorAll('button')].map((button) => button.textContent);

  const buttonOf = (container: HTMLElement, label: string, text: string) => {
    const found = [...row(container, label).querySelectorAll('button')].find(
      (button) => button.textContent === text,
    );
    if (!found) throw new Error(`no button ${text} in ${label}`);
    return found;
  };

  const statusOf = (container: HTMLElement, label: string) =>
    row(container, label).querySelector('[role="status"]')?.textContent;

  const claude = '/Users/me/.local/bin/claude';

  it('lists Claude and Codex with their state, version and where the program is', async () => {
    const { deps, container } = setup({
      claude: { found: true, signedIn: true, version: '2.1.400', path: claude },
      codex: {
        found: true,
        signedIn: false,
        reason: 'signed-out',
        version: '0.170.0',
        path: '/opt/homebrew/bin/codex',
        help: 'Run `codex login`.',
      },
    });
    renderAgentsPane(container, deps);
    expect(statusOf(container, 'Claude')).toBe('Checking…');
    await settle();
    expect(statusOf(container, 'Claude')).toBe('Signed in');
    expect(row(container, 'Claude').textContent).toContain(`2.1.400 · ${claude}`);
    expect(statusOf(container, 'Codex')).toBe('Signed out');
    expect(row(container, 'Codex').textContent).toContain('0.170.0 · /opt/homebrew/bin/codex');
  });

  it('offers the next step as a button: nothing but Check Again for a program that is fine', async () => {
    const { deps, container } = setup({
      claude: { found: true, signedIn: true, version: '2.1.400', path: claude },
      codex: {
        found: true,
        signedIn: false,
        reason: 'signed-out',
        version: '0.170.0',
        path: '/opt/homebrew/bin/codex',
        help: 'Run `codex login`.',
      },
    });
    renderAgentsPane(container, deps);
    await settle();
    expect(buttons(container, 'Claude')).toEqual(['Check Again']);
    expect(buttons(container, 'Codex')).toEqual(['Sign In', 'Check Again']);
    // The button says it, so the help that told the person what to type is left out.
    expect(row(container, 'Codex').textContent).not.toContain('Run `codex login`.');
  });

  it('says an update is needed for a program that is too old, and not that it is signed out', async () => {
    const { deps, container } = setup({
      claude: {
        found: true,
        signedIn: false,
        reason: 'too-old',
        version: '2.1.201',
        path: claude,
        help: 'Claude Code 2.1.201 is too old. Update it to 2.1.318 or newer.',
      },
      codex: {
        found: true,
        signedIn: false,
        reason: 'too-old',
        version: '0.150.2',
        path: '/opt/homebrew/bin/codex',
        help: 'Codex 0.150.2 is too old. Update it to 0.166.0 or newer.',
        account: 'signed-in',
      },
    });
    renderAgentsPane(container, deps);
    await settle();
    // Sign-in is reported only once the program has been asked, and said what it said.
    expect(statusOf(container, 'Claude')).toBe('Needs an update');
    expect(statusOf(container, 'Codex')).toBe('Needs an update · signed in');
    for (const label of ['Claude', 'Codex']) {
      expect(row(container, label).textContent).not.toMatch(/Not signed in|Signed out/);
      expect(buttons(container, label)).toEqual(['Update', 'Check Again']);
    }
    expect(row(container, 'Claude').textContent).toContain('Update it to 2.1.318 or newer.');
    expect(row(container, 'Claude').textContent).toContain(`2.1.201 · ${claude}`);
  });

  it('offers only an update to a program too old that says it is signed out', async () => {
    const { deps, container } = setup({
      claude: {
        found: true,
        signedIn: false,
        reason: 'too-old',
        version: '2.1.201',
        path: claude,
        account: 'signed-out',
      },
      codex: { found: true, signedIn: true },
    });
    renderAgentsPane(container, deps);
    await settle();
    expect(statusOf(container, 'Claude')).toBe('Needs an update · signed out');
    expect(buttons(container, 'Claude')).toEqual(['Update', 'Check Again']);
  });

  it('says how to install a program that is not found, with the command to copy', async () => {
    const { deps, container, copy } = setup({
      claude: {
        found: false,
        help: "Claude Code isn't installed on this Mac.",
        install: 'curl -fsSL https://claude.ai/install.sh | bash',
      },
      codex: { found: false, help: "Codex isn't installed on this Mac." },
    });
    renderAgentsPane(container, deps);
    await settle();
    expect(statusOf(container, 'Claude')).toBe('Not installed');
    expect(row(container, 'Claude').textContent).toContain("Claude Code isn't installed");
    expect(row(container, 'Claude').querySelector('code')?.textContent).toBe(
      'curl -fsSL https://claude.ai/install.sh | bash',
    );
    expect(buttons(container, 'Claude')).toEqual(['Copy', 'Check Again']);
    expect(statusOf(container, 'Codex')).toBe('Not installed');
    // Without a command to give, no Copy.
    expect(buttons(container, 'Codex')).toEqual(['Check Again']);
    expect(row(container, 'Codex').querySelector('code')).toBeNull();

    buttonOf(container, 'Claude', 'Copy').click();
    expect(copy).toHaveBeenCalledWith('curl -fsSL https://claude.ai/install.sh | bash');
    await settle();
    expect(buttons(container, 'Claude')).toContain('Copied');
  });

  it('offers no Copy where the host cannot copy', async () => {
    const { deps, container } = setup({
      claude: { found: false, help: 'x', install: 'curl x | bash' },
      codex: { found: true, signedIn: true },
    });
    delete deps.copy;
    renderAgentsPane(container, deps);
    await settle();
    expect(buttons(container, 'Claude')).toEqual(['Check Again']);
    expect(row(container, 'Claude').querySelector('code')?.textContent).toBe('curl x | bash');
  });

  it('offers no Update or Sign In where the host cannot run them, only Check Again', async () => {
    const { deps, container } = setup({
      claude: { found: true, signedIn: false, reason: 'too-old', version: '2.1.201' },
      codex: { found: true, signedIn: false, reason: 'signed-out', help: 'Run `codex login`.' },
    });
    deps.agents = deps.agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      detect: (fresh) => agent.detect(fresh),
    }));
    renderAgentsPane(container, deps);
    await settle();
    expect(buttons(container, 'Claude')).toEqual(['Check Again']);
    expect(buttons(container, 'Codex')).toEqual(['Check Again']);
    // With no button to say it, the help is the way to fix it.
    expect(row(container, 'Codex').textContent).toContain('Run `codex login`.');
  });

  it('checks again from Check Again, asking fresh', async () => {
    const { deps, container, detect } = setup({
      claude: { found: true, signedIn: true },
      codex: { found: true, signedIn: true },
    });
    renderAgentsPane(container, deps);
    await settle();
    expect(detect.mock.calls.map(([, fresh]) => fresh)).toEqual([undefined, undefined]);
    detect.mockImplementationOnce(() =>
      Promise.resolve({ found: true, signedIn: true, version: '9.9.9' }),
    );
    buttonOf(container, 'Claude', 'Check Again').click();
    expect(statusOf(container, 'Claude')).toBe('Checking…');
    await settle();
    expect(detect).toHaveBeenLastCalledWith('claude', true);
    expect(row(container, 'Claude').textContent).toContain('9.9.9');
    expect(statusOf(container, 'Claude')).toBe('Signed in');
  });

  describe('Update', () => {
    const tooOld: AgentState = {
      found: true,
      signedIn: false,
      reason: 'too-old',
      version: '2.1.201',
      path: claude,
    };
    const updated: AgentState = { found: true, signedIn: true, version: '2.1.400', path: claude };

    it('runs the updater, says so while it runs, then checks again', async () => {
      const { deps, container, updater, detect } = setup({
        claude: tooOld,
        codex: { found: true, signedIn: true },
      });
      let finish: (result: SetupResult) => void = () => {};
      updater.mockImplementationOnce(
        () => new Promise<SetupResult>((resolve) => (finish = resolve)),
      );
      renderAgentsPane(container, deps);
      await settle();
      buttonOf(container, 'Claude', 'Update').click();
      expect(updater).toHaveBeenCalledWith('claude');
      expect(statusOf(container, 'Claude')).toBe('Updating…');
      for (const button of row(container, 'Claude').querySelectorAll('button')) {
        // Everything waits but Cancel, which stops it.
        expect(button.disabled).toBe(button.textContent !== 'Cancel');
      }
      // Asking twice at once would run the updater twice.
      buttonOf(container, 'Claude', 'Update').click();
      expect(updater).toHaveBeenCalledTimes(1);

      detect.mockImplementation((id) =>
        Promise.resolve(id === 'claude' ? updated : { found: true, signedIn: true }),
      );
      finish(done);
      await settle();
      expect(detect).toHaveBeenLastCalledWith('claude', true);
      expect(statusOf(container, 'Claude')).toBe('Signed in');
      expect(row(container, 'Claude').textContent).toContain('2.1.400');
      expect(buttons(container, 'Claude')).toEqual(['Check Again']);
    });

    it('says in a line why an update failed, and checks again all the same', async () => {
      const { deps, container, updater, detect } = setup({
        claude: tooOld,
        codex: { found: true, signedIn: true },
      });
      updater.mockResolvedValueOnce({ ok: false, message: 'Error: EACCES: permission denied' });
      renderAgentsPane(container, deps);
      await settle();
      buttonOf(container, 'Claude', 'Update').click();
      await settle();
      expect(row(container, 'Claude').textContent).toContain(
        'The update didn’t finish: Error: EACCES: permission denied',
      );
      expect(detect).toHaveBeenLastCalledWith('claude', true);
      // Still too old, so still offered.
      expect(buttons(container, 'Claude')).toEqual(['Update', 'Check Again']);
    });

    it('does not open Terminal for an update that failed at once, as it does for a login', async () => {
      const { deps, container, updater, terminal } = setup({
        claude: tooOld,
        codex: { found: true, signedIn: true },
      });
      updater.mockResolvedValueOnce({ ok: false, message: 'EACCES', needsTerminal: true });
      renderAgentsPane(container, deps);
      await settle();
      buttonOf(container, 'Claude', 'Update').click();
      await settle();
      expect(terminal).not.toHaveBeenCalled();
      expect(row(container, 'Claude').textContent).toContain('The update didn’t finish: EACCES');
    });

    it('says in a line when the update could not even start', async () => {
      const { deps, container, updater } = setup({
        claude: tooOld,
        codex: { found: true, signedIn: true },
      });
      updater.mockRejectedValueOnce(new Error('Redlines didn’t find brew.'));
      renderAgentsPane(container, deps);
      await settle();
      buttonOf(container, 'Claude', 'Update').click();
      await settle();
      expect(row(container, 'Claude').textContent).toContain('Redlines didn’t find brew.');
    });

    it('draws nothing late once the pane is tidied up', async () => {
      const { deps, container, updater } = setup({
        claude: tooOld,
        codex: { found: true, signedIn: true },
      });
      let finish: (result: SetupResult) => void = () => {};
      updater.mockImplementationOnce(
        () => new Promise<SetupResult>((resolve) => (finish = resolve)),
      );
      const tidy = renderAgentsPane(container, deps);
      await settle();
      buttonOf(container, 'Claude', 'Update').click();
      tidy();
      finish(done);
      await settle();
      expect(statusOf(container, 'Claude')).toBe('Updating…');
    });
  });

  describe('Sign In', () => {
    const signedOut: AgentState = {
      found: true,
      signedIn: false,
      reason: 'signed-out',
      version: '0.170.0',
      path: '/opt/homebrew/bin/codex',
    };

    it('runs the login, says so while it runs, then checks again', async () => {
      const { deps, container, signer, detect } = setup({
        claude: { found: true, signedIn: true },
        codex: signedOut,
      });
      let finish: (result: SetupResult) => void = () => {};
      signer.mockImplementationOnce(
        () => new Promise<SetupResult>((resolve) => (finish = resolve)),
      );
      renderAgentsPane(container, deps);
      await settle();
      buttonOf(container, 'Codex', 'Sign In').click();
      expect(signer).toHaveBeenCalledWith('codex');
      expect(statusOf(container, 'Codex')).toBe('Signing in…');
      expect(row(container, 'Codex').textContent).toContain('Finish in your browser.');

      detect.mockImplementation(() =>
        Promise.resolve({ found: true, signedIn: true, version: '0.170.0' }),
      );
      finish(done);
      await settle();
      expect(statusOf(container, 'Codex')).toBe('Signed in');
      expect(row(container, 'Codex').textContent).not.toContain('Finish in your browser.');
    });

    it('opens Terminal with the command when the login needs one, and checks again when the person comes back', async () => {
      const { deps, container, signer, terminal, detect } = setup({
        claude: { found: true, signedIn: true },
        codex: signedOut,
      });
      signer.mockResolvedValueOnce({
        ok: false,
        message: 'stdin is not a TTY',
        needsTerminal: true,
      });
      renderAgentsPane(container, deps);
      await settle();
      buttonOf(container, 'Codex', 'Sign In').click();
      await settle();
      expect(terminal).toHaveBeenCalledWith('codex');
      expect(row(container, 'Codex').textContent).toContain(
        'Sign-in needs a terminal, so Redlines opened one.',
      );

      // Back from Terminal, the window is the app's again: it looks.
      const calls = detect.mock.calls.length;
      detect.mockImplementation(() => Promise.resolve({ found: true, signedIn: true }));
      window.dispatchEvent(new Event('focus'));
      await settle();
      expect(detect.mock.calls.length).toBe(calls + 1);
      expect(statusOf(container, 'Codex')).toBe('Signed in');
      // Signed in: the next focus asks nothing.
      window.dispatchEvent(new Event('focus'));
      await settle();
      expect(detect.mock.calls.length).toBe(calls + 1);
    });

    it('says in a line why a login failed that did not need a terminal', async () => {
      const { deps, container, signer, terminal } = setup({
        claude: { found: true, signedIn: true },
        codex: signedOut,
      });
      signer.mockResolvedValueOnce({ ok: false, message: 'Timed out waiting for the browser.' });
      renderAgentsPane(container, deps);
      await settle();
      buttonOf(container, 'Codex', 'Sign In').click();
      await settle();
      expect(terminal).not.toHaveBeenCalled();
      expect(row(container, 'Codex').textContent).toContain(
        'Sign-in didn’t finish: Timed out waiting for the browser.',
      );
    });

    it('does not look when the window is focused and nothing waits on Terminal', async () => {
      const { deps, container, detect } = setup({
        claude: { found: true, signedIn: true },
        codex: signedOut,
      });
      renderAgentsPane(container, deps);
      await settle();
      const calls = detect.mock.calls.length;
      window.dispatchEvent(new Event('focus'));
      await settle();
      expect(detect.mock.calls.length).toBe(calls);
    });
  });

  describe('while something is under way', () => {
    const tooOld: AgentState = {
      found: true,
      signedIn: false,
      reason: 'too-old',
      version: '2.1.201',
      path: claude,
    };
    const signedOut: AgentState = {
      found: true,
      signedIn: false,
      reason: 'signed-out',
      version: '0.170.0',
      path: '/opt/homebrew/bin/codex',
    };

    it('follows an update the host already runs when the pane is drawn again, and looks when it ends', async () => {
      const { deps, container, under, updater, detect } = setup({
        claude: tooOld,
        codex: { found: true, signedIn: true },
      });
      let finish: (result: SetupResult) => void = () => {};
      const first = renderAgentsPane(container, deps);
      await settle();
      updater.mockImplementationOnce(
        () => new Promise<SetupResult>((resolve) => (finish = resolve)),
      );
      buttonOf(container, 'Claude', 'Update').click();
      under['claude'] = {
        doing: 'update',
        ended: new Promise<SetupResult>((resolve) => (finish = resolve)),
      };

      // Another window changes a setting: the pane is tidied up and drawn again.
      first();
      container.replaceChildren();
      renderAgentsPane(container, deps);
      expect(statusOf(container, 'Claude')).toBe('Updating…');
      // Not offered again, and not asked about while it runs.
      expect(buttons(container, 'Claude')).toEqual(['Check Again', 'Cancel']);
      for (const button of row(container, 'Claude').querySelectorAll('button')) {
        expect(button.textContent === 'Cancel' ? false : button.disabled).toBe(
          button.textContent !== 'Cancel',
        );
      }
      const asked = detect.mock.calls.filter(([id]) => id === 'claude').length;
      await settle();
      expect(detect.mock.calls.filter(([id]) => id === 'claude').length).toBe(asked);

      detect.mockImplementation((id) =>
        Promise.resolve(
          id === 'claude'
            ? { found: true as const, signedIn: true as const, version: '2.1.400' }
            : { found: true as const, signedIn: true as const },
        ),
      );
      finish(done);
      await settle();
      expect(detect).toHaveBeenLastCalledWith('claude', true);
      expect(statusOf(container, 'Claude')).toBe('Signed in');
      expect(row(container, 'Claude').textContent).toContain('2.1.400');
    });

    it('offers Cancel while an update or a sign-in runs, and nothing is said of one that was stopped', async () => {
      const { deps, container, updater, stopper, detect } = setup({
        claude: tooOld,
        codex: signedOut,
      });
      let finish: (result: SetupResult) => void = () => {};
      updater.mockImplementationOnce(
        () => new Promise<SetupResult>((resolve) => (finish = resolve)),
      );
      renderAgentsPane(container, deps);
      await settle();
      expect(buttons(container, 'Claude')).not.toContain('Cancel');
      buttonOf(container, 'Claude', 'Update').click();
      expect(buttons(container, 'Claude')).toContain('Cancel');
      // The others wait, and Cancel doesn't.
      expect(buttonOf(container, 'Claude', 'Cancel').disabled).toBe(false);
      buttonOf(container, 'Claude', 'Cancel').click();
      expect(stopper).toHaveBeenCalledWith('claude');

      finish({ ok: false, message: '', stopped: true });
      await settle();
      expect(row(container, 'Claude').textContent).not.toContain('didn’t finish');
      expect(row(container, 'Claude').textContent).not.toContain('Stopped');
      expect(buttons(container, 'Claude')).toEqual(['Update', 'Check Again']);
      expect(detect).toHaveBeenLastCalledWith('claude', true);
    });

    it('offers no Cancel where the host cannot stop', async () => {
      const { deps, container, updater } = setup({ claude: tooOld, codex: signedOut });
      deps.agents = deps.agents.map((agent) => ({
        id: agent.id,
        name: agent.name,
        detect: (fresh) => agent.detect(fresh),
        update: () => agent.update!(),
      }));
      updater.mockImplementationOnce(() => new Promise<SetupResult>(() => {}));
      renderAgentsPane(container, deps);
      await settle();
      buttonOf(container, 'Claude', 'Update').click();
      expect(buttons(container, 'Claude')).not.toContain('Cancel');
    });

    it('says what an update said when it ended well and left the program as old as it was', async () => {
      const { deps, container, updater } = setup({
        claude: tooOld,
        codex: { found: true, signedIn: true },
      });
      updater.mockResolvedValueOnce({ ok: true, message: 'Already up to date.' });
      renderAgentsPane(container, deps);
      await settle();
      buttonOf(container, 'Claude', 'Update').click();
      await settle();
      expect(row(container, 'Claude').textContent).toContain(
        'The update ran, but Claude 2.1.201 is still too old. It said: Already up to date.',
      );
      // With nothing said, nothing is quoted.
      updater.mockResolvedValueOnce({ ok: true, message: '' });
      buttonOf(container, 'Claude', 'Update').click();
      await settle();
      expect(row(container, 'Claude').textContent).toContain(
        'The update ran, but Claude 2.1.201 is still too old.',
      );
      expect(row(container, 'Claude').textContent).not.toContain('It said');
    });

    it('puts away what failed before once a look finds the agent ready', async () => {
      const { deps, container, updater, detect } = setup({
        claude: tooOld,
        codex: { found: true, signedIn: true },
      });
      updater.mockResolvedValueOnce({ ok: false, message: 'EACCES' });
      renderAgentsPane(container, deps);
      await settle();
      buttonOf(container, 'Claude', 'Update').click();
      await settle();
      expect(row(container, 'Claude').textContent).toContain('EACCES');
      detect.mockImplementation(() => Promise.resolve({ found: true, signedIn: true }));
      buttonOf(container, 'Claude', 'Check Again').click();
      await settle();
      expect(row(container, 'Claude').textContent).not.toContain('EACCES');
    });

    it('does not look when the window comes back while a sign-in runs, and stops looking after one look that finds it signed out', async () => {
      const { deps, container, signer, terminal, detect } = setup({
        claude: { found: true, signedIn: true },
        codex: signedOut,
      });
      signer.mockResolvedValueOnce({ ok: false, message: 'no tty', needsTerminal: true });
      renderAgentsPane(container, deps);
      await settle();
      buttonOf(container, 'Codex', 'Sign In').click();
      await settle();
      expect(terminal).toHaveBeenCalledOnce();

      // A second sign-in, whose browser hands the focus back while it runs.
      let finish: (result: SetupResult) => void = () => {};
      signer.mockImplementationOnce(
        () => new Promise<SetupResult>((resolve) => (finish = resolve)),
      );
      buttonOf(container, 'Codex', 'Sign In').click();
      const calls = detect.mock.calls.length;
      window.dispatchEvent(new Event('focus'));
      await settle();
      expect(detect.mock.calls.length).toBe(calls);
      expect(statusOf(container, 'Codex')).toBe('Signing in…');
      finish({ ok: false, message: 'cancelled' });
      await settle();

      // Back from Terminal: one look, and still signed out, so no more until Check Again.
      const before = detect.mock.calls.length;
      window.dispatchEvent(new Event('focus'));
      await settle();
      const looked = detect.mock.calls.length - before;
      window.dispatchEvent(new Event('focus'));
      await settle();
      expect(detect.mock.calls.length - before).toBe(looked);
    });
  });

  it('says it could not check what could not be checked, which is not the same as not installed', async () => {
    const { deps, container } = setup({
      claude: { found: false, help: "Claude Code couldn't be checked: boom", unchecked: true },
      codex: { found: false, help: "Codex isn't installed on this Mac." },
    });
    renderAgentsPane(container, deps);
    await settle();
    expect(statusOf(container, 'Claude')).toBe('Couldn’t check');
    expect(row(container, 'Claude').textContent).toContain("couldn't be checked: boom");
    expect(statusOf(container, 'Codex')).toBe('Not installed');
  });

  it('shows one failed check as a line and carries on with the others', async () => {
    const { deps, container } = setup({
      claude: new Error('boom'),
      codex: { found: true, signedIn: true },
    });
    renderAgentsPane(container, deps);
    await settle();
    expect(row(container, 'Claude').textContent).toContain('Couldn’t check');
    expect(row(container, 'Codex').textContent).toContain('Signed in');
    // It can be tried again.
    expect(buttons(container, 'Claude')).toEqual(['Check Again']);
  });

  it('draws nothing late once it is tidied up', async () => {
    const { deps, container } = setup({
      claude: { found: true, signedIn: true },
      codex: { found: true, signedIn: true },
    });
    const tidy = renderAgentsPane(container, deps);
    tidy();
    await settle();
    expect(container.textContent).not.toContain('Signed in');
  });

  it('sets what agents may read, to one of three, and keeps This folder as the default', () => {
    const { deps, container, update, now } = setup({});
    renderAgentsPane(container, deps);
    const select = row(container, 'What agents may read').querySelector('select')!;
    expect([...select.options].map((option) => [option.value, option.textContent])).toEqual([
      ['document', 'This document'],
      ['folder', 'This folder'],
      ['everything', 'This folder and my home folder'],
    ]);
    expect(select.value).toBe('folder');
    select.value = 'document';
    select.dispatchEvent(new Event('change'));
    expect(update).toHaveBeenCalledWith({ agentScope: 'document' });
    expect(now().agentScope).toBe('document');
    select.value = 'everything';
    select.dispatchEvent(new Event('change'));
    expect(update).toHaveBeenLastCalledWith({ agentScope: 'everything' });
    expect(now().agentScope).toBe('everything');
  });

  describe('the note under What agents may read', () => {
    const noteOf = (container: HTMLElement) =>
      row(container, 'What agents may read').querySelector('.rl-pref-note')?.textContent ?? '';

    it('says nothing for the narrower choices', () => {
      for (const agentScope of ['document', 'folder'] as const) {
        const { deps, container } = setup({}, { agentScope });
        renderAgentsPane(container, deps);
        expect(noteOf(container)).toBe('');
      }
    });

    it('is what a screen reader says with the choice, and says again when the choice changes', async () => {
      const { deps, container } = setup({}, { agentScope: 'folder' });
      renderAgentsPane(container, deps);
      const select = row(container, 'What agents may read').querySelector('select')!;
      const note = row(container, 'What agents may read').querySelector('.rl-pref-note')!;
      // The note is the select's description, and a live region, which a change is heard from.
      expect(note.id).not.toBe('');
      expect(select.getAttribute('aria-describedby')).toBe(note.id);
      expect(note.getAttribute('role')).toBe('status');
      select.value = 'everything';
      select.dispatchEvent(new Event('change'));
      await settle();
      expect(note.textContent).toContain('macOS may ask');
    });

    it('says plainly what the home folder choice opens, leaves out, risks and asks of macOS', () => {
      const { deps, container } = setup({}, { agentScope: 'everything' });
      renderAgentsPane(container, deps);
      const note = noteOf(container);
      // What it opens.
      expect(note).toContain('anywhere in your home folder');
      // What it leaves out, and the exception.
      expect(note).toContain('Hidden files and folders and ~/Library are left out');
      expect(note).toContain('cloud folders');
      // Writes don't change.
      expect(note).toContain('change only the document');
      // The risk, in words: text someone else wrote, a private file, a comment that travels.
      expect(note).toContain('someone else wrote');
      expect(note).toContain('private file');
      expect(note).toContain('travels with the document');
      // macOS's questions, expected.
      expect(note).toContain('macOS may ask');
      expect(note).toContain('Documents');
    });

    describe('what macOS is holding back', () => {
      const choose = (container: HTMLElement, value: string) => {
        const select = row(container, 'What agents may read').querySelector('select')!;
        select.value = value;
        select.dispatchEvent(new Event('change'));
      };
      const accessOf = (container: HTMLElement) =>
        row(container, 'What agents may read').textContent;

      it('is looked for when the person picks the home folder, and said with a way to System Settings', async () => {
        const { deps, container, homeAccess, openSettings } = setup({});
        homeAccess.mockResolvedValueOnce([
          { name: 'Documents', folder: '/Users/ada/Documents' },
          { name: 'iCloud Drive', folder: '/Users/ada/Library/Mobile Documents' },
        ]);
        renderAgentsPane(container, deps);
        // Not at the draw: nothing in the pane makes macOS ask until the person chooses.
        expect(homeAccess).not.toHaveBeenCalled();
        choose(container, 'everything');
        expect(homeAccess).toHaveBeenCalledOnce();
        await settle();
        expect(accessOf(container)).toContain(
          'macOS isn’t letting Redlines read your Documents folder.',
        );
        expect(accessOf(container)).toContain('macOS isn’t letting Redlines read iCloud Drive.');
        const open = [...row(container, 'What agents may read').querySelectorAll('button')].find(
          (button) => button.textContent === 'Open System Settings',
        )!;
        open.click();
        expect(openSettings).toHaveBeenCalledOnce();
      });

      it('says nothing when macOS lets Redlines read every folder, or cannot be asked', async () => {
        const { deps, container, homeAccess } = setup({});
        renderAgentsPane(container, deps);
        choose(container, 'everything');
        await settle();
        expect(accessOf(container)).not.toContain('macOS isn’t letting');
        homeAccess.mockRejectedValueOnce(new Error('no app'));
        choose(container, 'folder');
        choose(container, 'everything');
        await settle();
        expect(accessOf(container)).not.toContain('macOS isn’t letting');
        const bare = setup({});
        delete bare.deps.homeAccess;
        renderAgentsPane(bare.container, bare.deps);
        choose(bare.container, 'everything');
        await settle();
        expect(bare.container.textContent).not.toContain('macOS isn’t letting');
      });

      it('is not looked for at the narrower choices, and goes with the choice, also when it comes late', async () => {
        const { deps, container, homeAccess } = setup({});
        let answer: (refused: { name: string; folder: string }[]) => void = () => {};
        homeAccess.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
        renderAgentsPane(container, deps);
        choose(container, 'document');
        choose(container, 'folder');
        expect(homeAccess).not.toHaveBeenCalled();
        choose(container, 'everything');
        // The person picks another choice before macOS has been answered.
        choose(container, 'folder');
        answer([{ name: 'Documents', folder: '/Users/ada/Documents' }]);
        await settle();
        expect(accessOf(container)).not.toContain('macOS isn’t letting');
      });

      it('says in a line when System Settings could not be opened', async () => {
        const { deps, container, homeAccess, openSettings } = setup({});
        homeAccess.mockResolvedValueOnce([{ name: 'Desktop', folder: '/Users/ada/Desktop' }]);
        openSettings.mockRejectedValueOnce(new Error('no'));
        renderAgentsPane(container, deps);
        choose(container, 'everything');
        await settle();
        [...container.querySelectorAll('button')]
          .find((button) => button.textContent === 'Open System Settings')!
          .click();
        await settle();
        expect(accessOf(container)).toContain('Couldn’t open System Settings.');
      });
    });

    it('comes and goes as the choice changes, without drawing the pane again', () => {
      const { deps, container } = setup({});
      renderAgentsPane(container, deps);
      const select = row(container, 'What agents may read').querySelector('select')!;
      expect(noteOf(container)).toBe('');
      select.value = 'everything';
      select.dispatchEvent(new Event('change'));
      expect(noteOf(container)).toContain('anywhere in your home folder');
      expect(row(container, 'What agents may read').querySelector('select')).toBe(select);
      select.value = 'folder';
      select.dispatchEvent(new Event('change'));
      expect(noteOf(container)).toBe('');
    });
  });

  it('forgets one folder’s answer and keeps the rest', () => {
    const { deps, container, update, now } = setup(
      {},
      {
        consent: {
          'claude|/Users/me/notes': 'folder',
          'codex|/Users/me/notes': 'no',
          'claude|/Users/me/a|b': 'document',
        },
      },
    );
    renderAgentsPane(container, deps);
    const remembered = row(container, 'Remembered answers');
    expect(remembered.textContent).toContain('/Users/me/notes');
    expect(remembered.textContent).toContain('/Users/me/a|b');
    const forget = [...remembered.querySelectorAll('button')].find((button) =>
      button.closest('[data-key="claude|/Users/me/notes"]'),
    )!;
    forget.click();
    expect(update).toHaveBeenCalledWith({
      consent: { 'codex|/Users/me/notes': 'no', 'claude|/Users/me/a|b': 'document' },
    });
    expect(now().consent['claude|/Users/me/notes']).toBeUndefined();
    expect(container.querySelector('[data-key="claude|/Users/me/notes"]')).toBeNull();
    expect(container.querySelector('[data-key="codex|/Users/me/notes"]')).not.toBeNull();
  });

  it('names each remembered answer, the home folder one too', () => {
    const { deps, container } = setup(
      {},
      {
        consent: {
          'claude|/Users/me/a': 'folder',
          'claude|/Users/me/b': 'document',
          'codex|/Users/me/c': 'everything',
          'codex|/Users/me/d': 'no',
        },
      },
    );
    renderAgentsPane(container, deps);
    const said = (key: string) =>
      row(container, 'Remembered answers').querySelector(`[data-key="${key}"]`)?.textContent;
    expect(said('claude|/Users/me/a')).toContain('Claude · May read the folder');
    expect(said('claude|/Users/me/b')).toContain('Claude · This document only');
    expect(said('codex|/Users/me/c')).toContain('Codex · May read the folder and the home folder');
    expect(said('codex|/Users/me/d')).toContain('Codex · Not allowed');
  });

  it('has no remembered-answers row when nothing is remembered', () => {
    const { deps, container } = setup({});
    renderAgentsPane(container, deps);
    expect(container.querySelector('[data-row="Remembered answers"]')).toBeNull();
  });

  it('opens the logs from a button, and says in a line when it cannot', async () => {
    const { deps, container, openLogs } = setup({});
    renderAgentsPane(container, deps);
    const button = row(container, 'Agent logs').querySelector('button')!;
    expect(button.textContent).toBe('Show Agent Logs');
    button.click();
    expect(openLogs).toHaveBeenCalledOnce();
    await settle();
    expect(container.textContent).not.toContain('Couldn’t open');
    openLogs.mockRejectedValueOnce(new Error('no'));
    button.click();
    await settle();
    expect(row(container, 'Agent logs').textContent).toContain('Couldn’t open the logs.');
  });

  it('holds the rows in order', () => {
    const { deps, container } = setup({}, { consent: { 'claude|/f': 'folder' } });
    renderAgentsPane(container, deps);
    expect(
      [...container.querySelectorAll<HTMLElement>('.rl-pref-row')].map((r) => r.dataset['row']),
    ).toEqual(['Claude', 'Codex', 'What agents may read', 'Remembered answers', 'Agent logs']);
  });

  describe('other agents', () => {
    const gemini: OtherAgent = {
      id: 'gemini',
      name: 'Gemini',
      command: '/opt/homebrew/bin/gemini --experimental-acp',
    };

    function withOthers(list: OtherAgent[]) {
      const base = setup({});
      let now = list;
      const others = {
        list: vi.fn(() => Promise.resolve(now)),
        add: vi.fn((name: string, command: string): Promise<OtherAgent[]> => {
          now = [...now, { id: name.toLowerCase(), name, command: `/bin/${command}` }];
          return Promise.resolve(now);
        }),
        remove: vi.fn((id: string): Promise<OtherAgent[]> => {
          now = now.filter((agent) => agent.id !== id);
          return Promise.resolve(now);
        }),
      };
      return { ...base, deps: { ...base.deps, others }, others };
    }

    const buttonNamed = (container: HTMLElement, name: string) => {
      const found = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
        (button) => button.textContent === name || button.getAttribute('aria-label') === name,
      );
      if (!found) throw new Error(`no button ${name}`);
      return found;
    };

    const field = (container: HTMLElement, label: string) => {
      const found = container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
      if (!found) throw new Error(`no field ${label}`);
      return found;
    };

    const type = (input: HTMLInputElement, text: string) => {
      input.value = text;
      input.dispatchEvent(new Event('input'));
    };

    it('has no row where the host keeps no list', () => {
      const { deps, container } = setup({});
      renderAgentsPane(container, deps);
      expect(container.querySelector('[data-row="Other agents"]')).toBeNull();
    });

    it('lists each with its command, after Claude and Codex, and says what adding one means', async () => {
      const { deps, container } = withOthers([gemini]);
      renderAgentsPane(container, deps);
      await settle();
      expect(
        [...container.querySelectorAll<HTMLElement>('.rl-pref-row')].map((r) => r.dataset['row']),
      ).toEqual(['Claude', 'Codex', 'Other agents', 'What agents may read', 'Agent logs']);
      const text = row(container, 'Other agents').textContent;
      expect(text).toContain('Gemini');
      expect(text).toContain('/opt/homebrew/bin/gemini --experimental-acp');
      expect(text).toContain('act on its own');
      expect(text).toContain('outside what it asks Redlines');
      expect(text).toContain('follow settings it finds in the folders it works in');
      expect(text).toContain('Stop ends the agent and what it started');
      expect(text).toContain('detaches on its own may outlive it');
    });

    it('removes one, once the app has asked', async () => {
      const { deps, container, others } = withOthers([gemini]);
      renderAgentsPane(container, deps);
      await settle();
      buttonNamed(container, 'Remove Gemini').click();
      await settle();
      expect(others.remove).toHaveBeenCalledWith('gemini');
      expect(row(container, 'Other agents').textContent).not.toContain('/opt/homebrew/bin/gemini');
    });

    it('adds one from a name and a command, and says in a line when the person said no', async () => {
      const { deps, container, others } = withOthers([]);
      renderAgentsPane(container, deps);
      await settle();
      buttonNamed(container, 'Add Agent…').click();
      const add = buttonNamed(container, 'Add');
      expect(add.disabled).toBe(true);
      type(field(container, 'Name'), 'Goose');
      expect(add.disabled).toBe(true);
      type(field(container, 'Command'), 'goose acp');
      expect(add.disabled).toBe(false);

      others.add.mockImplementationOnce(() => Promise.reject(new Error('Goose wasn’t added.')));
      add.click();
      await settle();
      expect(row(container, 'Other agents').textContent).toContain('Goose wasn’t added.');
      // What was typed stays, to try again.
      expect(field(container, 'Command').value).toBe('goose acp');

      buttonNamed(container, 'Add').click();
      await settle();
      expect(others.add).toHaveBeenLastCalledWith('Goose', 'goose acp');
      const text = row(container, 'Other agents').textContent;
      expect(text).toContain('/bin/goose acp');
      expect(text).not.toContain('wasn’t added');
      expect(container.querySelector('input[aria-label="Name"]')).toBeNull();
    });

    it('cancels adding, and draws nothing late once it is tidied up', async () => {
      const { deps, container, others } = withOthers([gemini]);
      const tidy = renderAgentsPane(container, deps);
      buttonNamed(container, 'Add Agent…').click();
      buttonNamed(container, 'Cancel').click();
      expect(container.querySelector('input[aria-label="Name"]')).toBeNull();
      tidy();
      await settle();
      expect(others.list).toHaveBeenCalled();
      expect(row(container, 'Other agents').textContent).not.toContain('Gemini');
    });
  });
});

describe('the Redlines skill', () => {
  const claudeState: AgentState = {
    found: true,
    signedIn: true,
    version: '2.1.400',
    path: '/Users/me/.local/bin/claude',
  };
  const folder = '~/.claude/skills/redlines';
  const skillState = (state: SkillState['state'], message: string | null = null): SkillState => ({
    folder,
    state,
    message,
  });
  const onPath: SkillInstalled = { folder, commandLine: { found: 'onPath' } };

  /** A host that looks at the skill and installs it. */
  function host(initial: SkillState, installed: SkillInstalled = onPath, alsoReadBy?: string) {
    const status = vi.fn<() => Promise<SkillState>>(() => Promise.resolve(initial));
    const install = vi.fn<() => Promise<SkillInstalled>>(() => Promise.resolve(installed));
    const skill: PaneSkill = { status, install, ...(alsoReadBy ? { alsoReadBy } : {}) };
    return { status, install, skill };
  }

  const words = (container: HTMLElement, label = 'Claude') => row(container, label).textContent;
  const buttons = (container: HTMLElement, label = 'Claude') =>
    [...row(container, label).querySelectorAll('button')].map((button) => button.textContent);
  const press = (container: HTMLElement, text: string, label = 'Claude') => {
    const found = [...row(container, label).querySelectorAll('button')].find(
      (button) => button.textContent === text,
    );
    if (!found) throw new Error(`no button ${text} in ${label}`);
    found.click();
  };

  it('says nothing of a skill where the host has none', async () => {
    const { deps, container } = setup({ claude: claudeState, codex: claudeState });
    renderAgentsPane(container, deps);
    await settle();
    expect(words(container)).not.toMatch(/skill/i);
    expect(buttons(container)).toEqual(['Check Again']);
  });

  it('offers to install it for an agent that is found, and for no other', async () => {
    const claude = host(skillState('missing'));
    const codex = host(skillState('missing'));
    const { deps, container } = setup(
      { claude: claudeState, codex: { found: false, help: 'Install Codex.' } },
      {},
      { claude: claude.skill, codex: codex.skill },
    );
    renderAgentsPane(container, deps);
    await settle();
    expect(words(container)).toContain('Redlines skill: not installed.');
    expect(buttons(container)).toEqual(['Check Again', 'Install Skill']);
    expect(
      row(container, 'Claude').querySelector(
        'button[aria-label="Install the Redlines skill for Claude"]',
      ),
    ).not.toBeNull();
    expect(words(container, 'Codex')).not.toMatch(/skill/i);
    expect(codex.status).not.toHaveBeenCalled();
    // Looking changes nothing.
    expect(claude.install).not.toHaveBeenCalled();
  });

  it('installs it, says where it went, and shows it as installed', async () => {
    const claude = host(skillState('missing'));
    const { deps, container } = setup(
      { claude: claudeState, codex: claudeState },
      {},
      {
        claude: claude.skill,
      },
    );
    renderAgentsPane(container, deps);
    await settle();
    press(container, 'Install Skill');
    expect(claude.install).toHaveBeenCalledTimes(1);
    // While it writes: said so, and the button waits.
    expect(words(container)).toContain('Installing the Redlines skill…');
    const waiting = row(container, 'Claude').querySelector(
      'button[aria-label^="Install the Redlines"]',
    );
    expect((waiting as HTMLButtonElement).disabled).toBe(true);
    await settle();
    expect(words(container)).toContain('Redlines skill installed in ~/.claude/skills/redlines.');
    expect(words(container)).not.toContain('Installing');
    // Nothing more to say: where it went is said once.
    expect(words(container)?.match(/~\/\.claude\/skills\/redlines/g)).toHaveLength(1);
    expect(buttons(container)).toEqual(['Check Again']);
    // Nothing else is asked of the host: the app knows what it wrote.
    expect(claude.status).toHaveBeenCalledTimes(1);
  });

  it('updates an older copy, and says it did', async () => {
    const claude = host(skillState('older'));
    const { deps, container } = setup(
      { claude: claudeState, codex: claudeState },
      {},
      {
        claude: claude.skill,
      },
    );
    renderAgentsPane(container, deps);
    await settle();
    expect(words(container)).toContain(
      'Redlines skill installed in ~/.claude/skills/redlines, and this app has a newer one.',
    );
    expect(buttons(container)).toEqual(['Check Again', 'Update Skill']);
    press(container, 'Update Skill');
    await settle();
    expect(claude.install).toHaveBeenCalledTimes(1);
    expect(words(container)).toContain('Redlines skill updated in ~/.claude/skills/redlines.');
    expect(buttons(container)).toEqual(['Check Again']);
  });

  it('leaves a copy that is current, newer or somebody else’s, and says why', async () => {
    const cases: [SkillState, string][] = [
      [skillState('current'), 'Redlines skill installed in ~/.claude/skills/redlines.'],
      [
        skillState(
          'newer',
          'The skill in ~/.claude/skills/redlines is newer than this app’s, so it stays as it is.',
        ),
        'is newer than this app’s, so it stays as it is.',
      ],
      [
        skillState(
          'other',
          '~/.claude/skills/redlines is a link, and Redlines leaves links as they are.',
        ),
        'is a link, and Redlines leaves links as they are.',
      ],
    ];
    for (const [state, said] of cases) {
      const claude = host(state);
      const { deps, container } = setup(
        { claude: claudeState, codex: claudeState },
        {},
        {
          claude: claude.skill,
        },
      );
      renderAgentsPane(container, deps);
      await settle();
      expect(words(container), state.state).toContain(said);
      expect(buttons(container), state.state).toEqual(['Check Again']);
      expect(claude.install).not.toHaveBeenCalled();
      container.remove();
    }
  });

  it('says why installing failed, and offers it again', async () => {
    const claude = host(skillState('missing'));
    claude.install.mockImplementationOnce(() =>
      Promise.reject(
        new Error('Couldn’t write ~/.claude/skills/redlines/SKILL.md: Permission denied.'),
      ),
    );
    const { deps, container } = setup(
      { claude: claudeState, codex: claudeState },
      {},
      {
        claude: claude.skill,
      },
    );
    renderAgentsPane(container, deps);
    await settle();
    press(container, 'Install Skill');
    await settle();
    expect(words(container)).toContain('Permission denied.');
    expect(words(container)).toContain('Redlines skill: not installed.');
    expect(buttons(container)).toEqual(['Check Again', 'Install Skill']);
    // Again, and it works: the failure is gone.
    press(container, 'Install Skill');
    await settle();
    expect(words(container)).not.toContain('Permission denied.');
    expect(words(container)).toContain('Redlines skill installed in ~/.claude/skills/redlines.');
  });

  it('says when it could not even start', async () => {
    const claude = host(skillState('missing'));
    claude.install.mockImplementationOnce(() => {
      throw new Error('Not in the app.');
    });
    const { deps, container } = setup(
      { claude: claudeState, codex: claudeState },
      {},
      {
        claude: claude.skill,
      },
    );
    renderAgentsPane(container, deps);
    await settle();
    press(container, 'Install Skill');
    await settle();
    expect(words(container)).toContain('Not in the app.');
    expect(buttons(container)).toEqual(['Check Again', 'Install Skill']);
  });

  it('says the redlines command is missing, and opens General for it', async () => {
    const claude = host(skillState('missing'), { folder, commandLine: { found: 'missing' } });
    const { deps, container, showGeneral } = setup(
      { claude: claudeState, codex: claudeState },
      {},
      {
        claude: claude.skill,
      },
    );
    renderAgentsPane(container, deps);
    await settle();
    press(container, 'Install Skill');
    await settle();
    expect(words(container)).toContain(
      'The skill runs the redlines command, which isn’t installed yet. Install it in General › Command line.',
    );
    expect(buttons(container)).toEqual(['Check Again', 'Open General']);
    press(container, 'Open General');
    expect(showGeneral).toHaveBeenCalledTimes(1);
  });

  it('says the redlines command is off the PATH, and names where it is', async () => {
    const claude = host(skillState('missing'), {
      folder,
      commandLine: { found: 'offPath', linked: '~/.local/bin/redlines' },
    });
    const { deps, container } = setup(
      { claude: claudeState, codex: claudeState },
      {},
      {
        claude: claude.skill,
      },
    );
    renderAgentsPane(container, deps);
    await settle();
    press(container, 'Install Skill');
    await settle();
    expect(words(container)).toContain(
      'which is linked at ~/.local/bin/redlines, but that folder isn’t on your PATH.',
    );
    expect(buttons(container)).toContain('Open General');
  });

  it('offers no way to General where the host has none', async () => {
    const claude = host(skillState('missing'), { folder, commandLine: { found: 'missing' } });
    const { deps, container } = setup(
      { claude: claudeState, codex: claudeState },
      {},
      {
        claude: claude.skill,
      },
    );
    const without: AgentsPaneDeps = { ...deps };
    delete without.showGeneral;
    renderAgentsPane(container, without);
    await settle();
    press(container, 'Install Skill');
    await settle();
    expect(words(container)).toContain('Install it in General › Command line.');
    expect(buttons(container)).toEqual(['Check Again']);
  });

  it('names another agent that reads the same folder', async () => {
    const codex = host(
      { folder: '~/.agents/skills/redlines', state: 'missing', message: null },
      { folder: '~/.agents/skills/redlines', commandLine: { found: 'onPath' } },
      'OpenClaw',
    );
    const { deps, container } = setup(
      { claude: claudeState, codex: claudeState },
      {},
      {
        codex: codex.skill,
      },
    );
    renderAgentsPane(container, deps);
    await settle();
    press(container, 'Install Skill', 'Codex');
    await settle();
    expect(words(container, 'Codex')).toContain(
      'Redlines skill installed in ~/.agents/skills/redlines.',
    );
    expect(words(container, 'Codex')).toContain('OpenClaw reads that folder too.');
  });

  it('installs once, however often the button is pressed while it writes', async () => {
    const claude = host(skillState('missing'));
    let finish: (done: SkillInstalled) => void = () => {};
    claude.install.mockImplementationOnce(
      () =>
        new Promise<SkillInstalled>((resolve) => {
          finish = resolve;
        }),
    );
    const { deps, container } = setup(
      { claude: claudeState, codex: claudeState },
      {},
      {
        claude: claude.skill,
      },
    );
    renderAgentsPane(container, deps);
    await settle();
    const install = [...row(container, 'Claude').querySelectorAll('button')].find(
      (button) => button.textContent === 'Install Skill',
    )!;
    install.click();
    install.click();
    expect(claude.install).toHaveBeenCalledTimes(1);
    finish(onPath);
    await settle();
    expect(words(container)).toContain('Redlines skill installed in ~/.claude/skills/redlines.');
  });

  it('keeps the focus in the row when the button that was pressed goes', async () => {
    const claude = host(skillState('missing'));
    const { deps, container } = setup(
      { claude: claudeState, codex: claudeState },
      {},
      {
        claude: claude.skill,
      },
    );
    renderAgentsPane(container, deps);
    await settle();
    const install = [...row(container, 'Claude').querySelectorAll('button')].find(
      (button) => button.textContent === 'Install Skill',
    )!;
    install.focus();
    install.click();
    await settle();
    expect(row(container, 'Claude').contains(document.activeElement)).toBe(true);
    expect(document.activeElement?.textContent).toBe('Check Again');
  });

  it('says so when the skill folder could not be looked at, and offers nothing', async () => {
    const claude = host(skillState('missing'));
    claude.status.mockImplementation(() => Promise.reject(new Error('no home')));
    const { deps, container } = setup(
      { claude: claudeState, codex: claudeState },
      {},
      {
        claude: claude.skill,
      },
    );
    renderAgentsPane(container, deps);
    await settle();
    expect(words(container)).toContain('Couldn’t look at the Redlines skill.');
    expect(buttons(container)).toEqual(['Check Again']);
  });

  it('looks again with Check Again, and forgets it when the agent goes', async () => {
    const claude = host(skillState('missing'));
    const { deps, container, detect } = setup(
      { claude: claudeState, codex: claudeState },
      {},
      {
        claude: claude.skill,
      },
    );
    renderAgentsPane(container, deps);
    await settle();
    press(container, 'Check Again');
    await settle();
    expect(claude.status).toHaveBeenCalledTimes(2);
    // The agent is gone from the machine: nothing of its skill is shown.
    detect.mockImplementation((id) =>
      Promise.resolve(
        id === 'claude' ? { found: false, help: 'Install Claude Code.' } : claudeState,
      ),
    );
    press(container, 'Check Again');
    await settle();
    expect(words(container)).not.toMatch(/skill/i);
  });

  it('draws nothing late once it is tidied up', async () => {
    const claude = host(skillState('missing'));
    const { deps, container } = setup(
      { claude: claudeState, codex: claudeState },
      {},
      {
        claude: claude.skill,
      },
    );
    const tidy = renderAgentsPane(container, deps);
    tidy();
    await settle();
    expect(words(container)).not.toMatch(/skill/i);
  });
});
