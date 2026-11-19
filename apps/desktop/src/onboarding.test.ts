// @vitest-environment happy-dom

/* eslint-disable @typescript-eslint/unbound-method -- the deps are vi.fn mocks, read for their calls */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runTour, runWelcome, type TourDeps, type WelcomeDeps } from './onboarding.ts';

afterEach(() => document.body.replaceChildren());

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup(over: Partial<WelcomeDeps> = {}) {
  const container = document.createElement('div');
  document.body.append(container);
  const deps: WelcomeDeps = {
    container,
    identity: { name: 'Ada Lovelace', handle: 'ada' },
    saveIdentity: vi.fn(),
    agents: () =>
      Promise.resolve([
        { id: 'claude', name: 'Claude Code' },
        { id: 'codex', name: 'Codex' },
      ]),
    defaultAgent: null,
    saveDefaultAgent: vi.fn(),
    quickLook: true,
    install: {
      skills: vi.fn(() => Promise.resolve({ ok: true, line: 'Installed for both.' })),
      quickLook: vi.fn(() => Promise.resolve({ ok: true, line: 'Opened.' })),
      commandLine: vi.fn(() => Promise.resolve({ ok: false, line: 'Not installed: no.' })),
    },
    restoreFocus: vi.fn(),
    ...over,
  };
  const click = (text: string) => {
    const found = [...container.querySelectorAll('button')].find((b) => b.textContent === text);
    if (!found) throw new Error(`no button ${text}`);
    found.click();
  };
  const step = () => container.querySelector<HTMLElement>('.rl-onb')?.dataset['step'];
  return { container, deps, click, step };
}

describe('the Welcome mode: the first three screens of the onboarding (#1206)', () => {
  it('goes through the three screens, saving and installing what was chosen', async () => {
    const { container, deps, click, step } = setup();
    const ended = runWelcome(deps);
    expect(step()).toBe('1');
    const name = container.querySelector<HTMLInputElement>('input[aria-label="Name"]')!;
    name.value = 'Grace Hopper';
    name.dispatchEvent(new Event('input'));
    click('Continue');
    expect(deps.saveIdentity).toHaveBeenCalledWith('Grace Hopper', 'ada');
    await tick();
    expect(step()).toBe('2');
    container.querySelector<HTMLSelectElement>('select')!.value = 'codex';
    click('Continue');
    expect(deps.saveDefaultAgent).toHaveBeenCalledWith('codex');
    expect(step()).toBe('3');
    // Quick Look is left out; the other two are installed, and what each said is shown.
    container.querySelector<HTMLInputElement>('input[aria-label="Quick Look preview"]')!.click();
    click('Install and Continue');
    await tick();
    await tick();
    expect(deps.install.skills).toHaveBeenCalledOnce();
    expect(deps.install.quickLook).not.toHaveBeenCalled();
    expect(deps.install.commandLine).toHaveBeenCalledOnce();
    expect(container.textContent).toContain('Not installed: no.');
    click('Continue');
    expect(await ended).toBe('finished');
    expect(container.querySelector('.rl-sheet-backdrop')).toBeNull();
    expect(deps.restoreFocus).toHaveBeenCalled();
  });

  it('installs nothing on Skip, and saves nothing the person skipped', async () => {
    const { deps, click, step } = setup();
    const ended = runWelcome(deps);
    click('Skip');
    await tick();
    click('Skip');
    expect(step()).toBe('3');
    click('Skip');
    expect(await ended).toBe('finished');
    expect(deps.saveIdentity).not.toHaveBeenCalled();
    expect(deps.saveDefaultAgent).not.toHaveBeenCalled();
    expect(deps.install.skills).not.toHaveBeenCalled();
    expect(deps.install.commandLine).not.toHaveBeenCalled();
  });

  it('ends from any screen with Skip Setup', async () => {
    const { container, deps, click } = setup();
    const ended = runWelcome(deps);
    click('Continue');
    await tick();
    click('Skip Setup');
    expect(await ended).toBe('skipped');
    expect(container.querySelector('.rl-sheet-backdrop')).toBeNull();
  });

  it('says so when no agent is found, and leaves the Quick Look row out when there is no preview', async () => {
    const { container, deps, click, step } = setup({
      agents: () => Promise.resolve([]),
      quickLook: false,
    });
    void runWelcome(deps);
    click('Continue');
    await tick();
    expect(container.textContent).toContain('No agent was found on this Mac');
    click('Skip');
    expect(step()).toBe('3');
    expect(container.textContent).not.toContain('Quick Look');
  });
});

describe('the tour (#1206)', () => {
  it('opens the Welcome document and points at the pen, the views button and the palette', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    for (const key of ['pen', 'views']) {
      const anchor = document.createElement('button');
      anchor.dataset['tour'] = key;
      container.append(anchor);
    }
    const deps: TourDeps = {
      container,
      openWelcome: vi.fn(() => Promise.resolve()),
      anchors: {
        pen: () => container.querySelector('[data-tour="pen"]'),
        views: () => container.querySelector('[data-tour="views"]'),
        palette: () => null,
      },
      restoreFocus: vi.fn(),
    };
    const click = (text: string) =>
      [...container.querySelectorAll('button')].find((b) => b.textContent === text)!.click();
    const ended = runTour(deps);
    await tick();
    expect(deps.openWelcome).toHaveBeenCalledOnce();
    const titles = ['The Redlines pen', 'Views', 'The command palette'];
    for (const [at, title] of titles.entries()) {
      expect(container.querySelector('.rl-tour-card')?.getAttribute('aria-label')).toBe(title);
      expect(container.querySelectorAll('.rl-tour-target')).toHaveLength(at < 2 ? 1 : 0);
      click(at === titles.length - 1 ? 'Done' : 'Next');
    }
    await ended;
    expect(container.querySelector('.rl-tour-card')).toBeNull();
    expect(container.querySelector('.rl-tour-target')).toBeNull();
    expect(deps.restoreFocus).toHaveBeenCalled();
  });
});
