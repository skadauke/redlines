// @vitest-environment happy-dom
import type { AgentState } from '@redlines/plugin-api';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  renderAgentsPane,
  type AgentsPaneDeps,
  type AgentsPaneSettings,
  type OtherAgent,
  type SetupResult,
} from './settings-pane.ts';

afterEach(() => document.body.replaceChildren());

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** What a finished update or sign-in says. */
const done: SetupResult = { ok: true, message: '' };

function setup(
  states: Record<string, AgentState | Error | Promise<AgentState>>,
  start: Partial<AgentsPaneSettings> = {},
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
  const deps: AgentsPaneDeps = {
    agents: ['claude', 'codex'].map((id) => ({
      id,
      name: id === 'claude' ? 'Claude' : 'Codex',
      detect: (fresh) => detect(id, fresh),
      update: () => updater(id),
      signIn: () => signer(id),
      signInInTerminal: () => terminal(id),
    })),
    copy,
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
        expect(button.disabled).toBe(true);
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

  it('sets what agents may read', () => {
    const { deps, container, update, now } = setup({});
    renderAgentsPane(container, deps);
    const select = row(container, 'What agents may read').querySelector('select')!;
    expect([...select.options].map((option) => option.textContent)).toEqual([
      'This document',
      'This folder',
    ]);
    expect(select.value).toBe('folder');
    select.value = 'document';
    select.dispatchEvent(new Event('change'));
    expect(update).toHaveBeenCalledWith({ agentScope: 'document' });
    expect(now().agentScope).toBe('document');
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
