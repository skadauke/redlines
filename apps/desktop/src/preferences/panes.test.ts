// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { iconRotationLabel } from '../dock-icon.ts';
import { DEFAULT_SETTINGS, type Settings } from '../settings.ts';
import { PANES, type PaneDeps, type PaneId, renderPane, rowLabels } from './panes.ts';

afterEach(() => document.body.replaceChildren());

/** Deps over a settings object the test can read back. */
function setup(extra: Partial<PaneDeps> = {}) {
  let settings: Settings = { ...DEFAULT_SETTINGS };
  const update = vi.fn((change: Partial<Settings>) => {
    settings = { ...settings, ...change };
  });
  const deps: PaneDeps = {
    settings: () => settings,
    update,
    installCommandLine: () => Promise.resolve({ linked: '/h/.local/bin/redlines', onPath: true }),
    ...extra,
  };
  const container = document.createElement('div');
  document.body.append(container);
  return { deps, container, update, now: () => settings };
}

const draw = (pane: PaneId, extra: Partial<PaneDeps> = {}) => {
  const made = setup(extra);
  renderPane(pane, made.container, made.deps);
  return made;
};

const control = <T extends HTMLElement>(
  container: HTMLElement,
  label: string,
  selector: string,
) => {
  const found = container.querySelector<T>(`[data-row="${label}"] ${selector}`);
  if (!found) throw new Error(`no ${selector} in ${label}`);
  return found;
};

describe('the panes', () => {
  it('has four panes, General first', () => {
    expect(PANES.map((pane) => pane.label)).toEqual(['General', 'Appearance', 'Editor', 'Agents']);
  });

  it('holds exactly the rows of the design, each pane', () => {
    expect(rowLabels(draw('general').container)).toEqual([
      'Name and handle',
      'On launch',
      'Check for updates automatically',
      iconRotationLabel(),
      'Command line',
    ]);
    expect(rowLabels(draw('appearance').container)).toEqual(['Appearance', 'Theme', 'Text size']);
    expect(rowLabels(draw('editor').container)).toEqual([
      'Spell check',
      'Smart quotes and dashes',
      'Close brackets and Markdown pairs',
      'Track Changes on for new documents',
    ]);
    expect(rowLabels(draw('agents').container)).toEqual([]);
  });

  it('applies a change at once with no Save button', () => {
    const { container, update, now } = draw('editor');
    expect(container.querySelector('button')).toBeNull();
    const spell = control<HTMLInputElement>(container, 'Spell check', 'input');
    spell.checked = false;
    spell.dispatchEvent(new Event('change'));
    expect(update).toHaveBeenCalledWith({ spellCheck: false });
    expect(now().spellCheck).toBe(false);

    const track = control<HTMLInputElement>(
      container,
      'Track Changes on for new documents',
      'input',
    );
    track.checked = true;
    track.dispatchEvent(new Event('change'));
    expect(now().trackNewDocuments).toBe(true);
  });

  it('starts each control at the stored setting', () => {
    const made = setup();
    made.deps.settings = () => ({
      ...DEFAULT_SETTINGS,
      theme: 'book',
      appearance: 'dark',
      onLaunch: 'reopen',
      closePairs: false,
    });
    renderPane('appearance', made.container, made.deps);
    expect(control<HTMLSelectElement>(made.container, 'Theme', 'select').value).toBe('book');
    expect(control<HTMLInputElement>(made.container, 'Appearance', 'input:checked').value).toBe(
      'dark',
    );
    renderPane('general', made.container, made.deps);
    expect(control<HTMLSelectElement>(made.container, 'On launch', 'select').value).toBe('reopen');
    renderPane('editor', made.container, made.deps);
    expect(
      control<HTMLInputElement>(made.container, 'Close brackets and Markdown pairs', 'input')
        .checked,
    ).toBe(false);
  });

  it('changes the theme and the launch choice', () => {
    const appearance = draw('appearance');
    const theme = control<HTMLSelectElement>(appearance.container, 'Theme', 'select');
    theme.value = 'editorial';
    theme.dispatchEvent(new Event('change'));
    expect(appearance.update).toHaveBeenLastCalledWith({ theme: 'editorial' });
    expect(appearance.now().theme).toBe('editorial');

    const general = draw('general');
    const launch = control<HTMLSelectElement>(general.container, 'On launch', 'select');
    launch.value = 'reopen';
    launch.dispatchEvent(new Event('change'));
    expect(general.now().onLaunch).toBe('reopen');
  });

  it('offers Match System, Light and Dark in a row, and one theme under them', () => {
    const { container, update, now } = draw('appearance');
    const group = control(container, 'Appearance', '.rl-pref-control > *');
    // One group of the system's radio buttons, named by its row, which the arrow keys move in.
    expect(group.getAttribute('role')).toBe('radiogroup');
    const label = container.querySelector('[data-row="Appearance"] .rl-pref-label');
    expect(group.getAttribute('aria-labelledby')).toBe(label?.id);
    const choices = [...group.querySelectorAll<HTMLInputElement>('input')];
    expect(choices.map((choice) => choice.type)).toEqual(['radio', 'radio', 'radio']);
    expect(new Set(choices.map((choice) => choice.name)).size).toBe(1);
    expect(choices.map((choice) => choice.closest('label')?.textContent)).toEqual([
      'Match System',
      'Light',
      'Dark',
    ]);
    expect(choices.map((choice) => choice.value)).toEqual(['system', 'light', 'dark']);
    // Match System is the default.
    expect(choices.map((choice) => choice.checked)).toEqual([true, false, false]);

    const [system, light, dark] = choices;
    dark?.click();
    expect(update).toHaveBeenLastCalledWith({ appearance: 'dark' });
    expect(now().appearance).toBe('dark');
    light?.click();
    expect(now().appearance).toBe('light');
    system?.click();
    expect(now().appearance).toBe('system');
    expect(update).toHaveBeenCalledTimes(3);

    // The theme: one picker of the built-in themes, for light and dark alike.
    expect(container.querySelectorAll('select')).toHaveLength(1);
    const theme = control<HTMLSelectElement>(container, 'Theme', 'select');
    expect([...theme.options].map((option) => [option.value, option.textContent])).toEqual([
      ['default', 'Default'],
      ['book', 'Book'],
      ['editorial', 'Editorial'],
    ]);
    expect(theme.value).toBe('default');
    theme.value = 'book';
    theme.dispatchEvent(new Event('change'));
    expect(update).toHaveBeenLastCalledWith({ theme: 'book' });
    expect(now()).toMatchObject({ theme: 'book', appearance: 'system' });
  });

  it('steps the text size through the ladder and stops at its ends', () => {
    const { container, now } = draw('appearance');
    const [smaller, larger] = [...container.querySelectorAll<HTMLButtonElement>('.rl-pref-step')];
    const shown = () => container.querySelector('.rl-pref-size')?.textContent;
    expect(shown()).toBe('100%');
    larger?.click();
    expect(now().textSize).toBe(1.1);
    expect(shown()).toBe('110%');
    for (let i = 0; i < 10; i++) smaller?.click();
    expect(now().textSize).toBe(0.8);
    expect(smaller?.disabled).toBe(true);
    for (let i = 0; i < 10; i++) larger?.click();
    expect(now().textSize).toBe(2);
    expect(larger?.disabled).toBe(true);
  });

  it('names you by what you type: a handle from the name, git’s until then', () => {
    const { container, now, update } = draw('general', {
      gitIdentity: { name: 'Stephan Kadauke', handle: 'stephan' },
    });
    const [name, handle] = [...container.querySelectorAll<HTMLInputElement>('.rl-pref-text')];
    expect(name?.placeholder).toBe('Stephan Kadauke');
    expect(handle?.placeholder).toBe('stephan');
    name!.value = 'Ada Lovelace';
    name!.dispatchEvent(new Event('input'));
    expect(now().identity).toEqual({ name: 'Ada Lovelace', handle: 'ada-lovelace' });
    handle!.value = 'ada';
    handle!.dispatchEvent(new Event('input'));
    expect(now().identity).toEqual({ name: 'Ada Lovelace', handle: 'ada' });
    // Emptied, it goes back to git's.
    name!.value = '';
    handle!.value = '';
    name!.dispatchEvent(new Event('input'));
    expect(now().identity).toBeNull();
    // A handle alone goes with git's name.
    handle!.value = 'zed';
    handle!.dispatchEvent(new Event('input'));
    expect(now().identity).toEqual({ name: 'Stephan Kadauke', handle: 'zed' });
    // One the format doesn't allow comes from the name instead, and the field shows what was kept.
    name!.value = 'Ada Lovelace';
    handle!.value = 'no';
    handle!.dispatchEvent(new Event('input'));
    expect(now().identity).toEqual({ name: 'Ada Lovelace', handle: 'ada-lovelace' });
    handle!.dispatchEvent(new Event('blur'));
    expect(handle!.value).toBe('ada-lovelace');
    expect(update).toHaveBeenCalled();
  });

  it('installs the command line, and says where it linked or why it could not', async () => {
    const ok = draw('general');
    control<HTMLButtonElement>(ok.container, 'Command line', 'button').click();
    await vi.waitFor(() =>
      expect(ok.container.querySelector('[role="status"]')?.textContent).toBe(
        'Linked at /h/.local/bin/redlines',
      ),
    );

    const off = draw('general', {
      installCommandLine: () =>
        Promise.resolve({ linked: '/h/.local/bin/redlines', onPath: false }),
    });
    control<HTMLButtonElement>(off.container, 'Command line', 'button').click();
    await vi.waitFor(() =>
      expect(off.container.querySelector('[role="status"]')?.textContent).toContain(
        'isn’t on your PATH',
      ),
    );

    const missing = draw('general', {
      installCommandLine: () => Promise.reject(new Error('The redlines program isn’t here.')),
    });
    const button = control<HTMLButtonElement>(missing.container, 'Command line', 'button');
    button.click();
    await vi.waitFor(() =>
      expect(missing.container.querySelector('[role="status"]')?.textContent).toBe(
        'The redlines program isn’t here.',
      ),
    );
    expect(button.disabled).toBe(false);
  });

  it('shows a quiet empty state for Agents until the agents fill it', () => {
    const empty = draw('agents');
    expect(empty.container.textContent).toBe('No agents found.');
    const tidy = vi.fn();
    const filled = draw('agents', {
      agentsPane: (container) => {
        container.append('Claude: Signed in');
        return tidy;
      },
    });
    expect(filled.container.textContent).toBe('Claude: Signed in');
  });

  it('adds the settings that plugins contribute to their pane, and nothing else', () => {
    const values = new Map<string, boolean | number | string>();
    const { container } = draw('editor', {
      contributions: [
        { pane: 'editor', id: 'wrap', title: 'Wrap code', default: true },
        { pane: 'editor', id: 'width', title: 'Column width', default: 72 },
        { pane: 'general', id: 'other', title: 'Elsewhere', default: 'x' },
      ],
      pluginValue: (id) => values.get(id),
      setPluginValue: (id, value) => void values.set(id, value),
    });
    expect(rowLabels(container).slice(-2)).toEqual(['Wrap code', 'Column width']);
    expect(rowLabels(container)).not.toContain('Elsewhere');
    const wrap = control<HTMLInputElement>(container, 'Wrap code', 'input');
    expect(wrap.checked).toBe(true);
    wrap.checked = false;
    wrap.dispatchEvent(new Event('change'));
    const width = control<HTMLInputElement>(container, 'Column width', 'input');
    expect(width.value).toBe('72');
    width.value = '80';
    width.dispatchEvent(new Event('input'));
    expect([...values]).toEqual([
      ['wrap', false],
      ['width', 80],
    ]);
  });
});
