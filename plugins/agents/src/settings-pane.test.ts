// @vitest-environment happy-dom
import type { AgentState } from '@redlines/plugin-api';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderAgentsPane, type AgentsPaneDeps, type AgentsPaneSettings } from './settings-pane.ts';

afterEach(() => document.body.replaceChildren());

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function setup(
  states: Record<string, AgentState | Error | Promise<AgentState>>,
  start: Partial<AgentsPaneSettings> = {},
) {
  let settings: AgentsPaneSettings = { agentScope: 'folder', consent: {}, ...start };
  const detect = vi.fn((id: string) => {
    const state = states[id];
    if (state instanceof Error) return Promise.reject(state);
    return Promise.resolve(state!);
  });
  const update = vi.fn((change: Partial<AgentsPaneSettings>) => {
    settings = { ...settings, ...change };
  });
  const openLogs = vi.fn<() => Promise<void>>(() => Promise.resolve());
  const deps: AgentsPaneDeps = {
    agents: [
      { id: 'claude', name: 'Claude', detect: () => detect('claude') },
      { id: 'codex', name: 'Codex', detect: () => detect('codex') },
    ],
    settings: () => settings,
    update,
    openLogs,
  };
  const container = document.createElement('div');
  document.body.append(container);
  return { deps, container, detect, update, openLogs, now: () => settings };
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

  it('lists Claude and Codex with their state and what to do', async () => {
    const { deps, container } = setup({
      claude: { found: true, signedIn: true, version: '2.1.400' },
      codex: { found: true, signedIn: false, reason: 'signed-out', help: 'Run `codex login`.' },
    });
    renderAgentsPane(container, deps);
    expect(row(container, 'Claude').textContent).toContain('Checking');
    await settle();
    expect(row(container, 'Claude').textContent).toContain('Signed in');
    expect(row(container, 'Claude').textContent).not.toContain('Not');
    expect(row(container, 'Codex').textContent).toContain('Not signed in');
    expect(row(container, 'Codex').textContent).toContain('Run `codex login`.');
  });

  it('says how to install a program that is not found', async () => {
    const { deps, container } = setup({
      claude: {
        found: false,
        help: 'Install it with: curl -fsSL https://claude.ai/install.sh | bash',
      },
      codex: { found: false, help: 'Install it (brew install --cask codex).' },
    });
    renderAgentsPane(container, deps);
    await settle();
    expect(row(container, 'Claude').textContent).toContain('Not found');
    expect(row(container, 'Claude').textContent).toContain('claude.ai/install.sh');
    expect(row(container, 'Codex').textContent).toContain('Not found');
    expect(row(container, 'Codex').textContent).toContain('brew install --cask codex');
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
});
