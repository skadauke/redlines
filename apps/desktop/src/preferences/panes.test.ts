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
    installCommandLine: () =>
      Promise.resolve({ outcome: 'linked', linked: '/usr/local/bin/redlines', onPath: true }),
    installCommandLineAtHome: () =>
      Promise.resolve({ linked: '/h/.local/bin/redlines', onPath: true }),
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
    expect(rowLabels(draw('appearance').container)).toEqual([
      'Light theme',
      'Dark theme',
      'Text size',
    ]);
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
      lightTheme: 'book',
      darkTheme: 'editorial',
      onLaunch: 'reopen',
      closePairs: false,
    });
    renderPane('appearance', made.container, made.deps);
    expect(control<HTMLSelectElement>(made.container, 'Light theme', 'select').value).toBe('book');
    expect(control<HTMLSelectElement>(made.container, 'Dark theme', 'select').value).toBe(
      'editorial',
    );
    renderPane('general', made.container, made.deps);
    expect(control<HTMLSelectElement>(made.container, 'On launch', 'select').value).toBe('reopen');
    renderPane('editor', made.container, made.deps);
    expect(
      control<HTMLInputElement>(made.container, 'Close brackets and Markdown pairs', 'input')
        .checked,
    ).toBe(false);
  });

  it('changes the themes and the launch choice', () => {
    const appearance = draw('appearance');
    const dark = control<HTMLSelectElement>(appearance.container, 'Dark theme', 'select');
    dark.value = 'editorial';
    dark.dispatchEvent(new Event('change'));
    expect(appearance.now().darkTheme).toBe('editorial');

    const general = draw('general');
    const launch = control<HTMLSelectElement>(general.container, 'On launch', 'select');
    launch.value = 'reopen';
    launch.dispatchEvent(new Event('change'));
    expect(general.now().onLaunch).toBe('reopen');
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

  describe('the Command line row', () => {
    /** The row's line under its buttons, and its buttons, by their words. */
    const commandLine = (container: HTMLElement) => {
      const row = container.querySelector<HTMLElement>('[data-row="Command line"]');
      if (!row) throw new Error('no Command line row');
      const status = row.querySelector<HTMLElement>('[role="status"]');
      const buttons = [...row.querySelectorAll('button')];
      const button = (words: string) => {
        const found = buttons.find((each) => each.textContent === words);
        if (!found) throw new Error(`no ${words} button`);
        return found;
      };
      return {
        said: () => status?.textContent,
        /** Whether the line says that something didn't happen. */
        failed: () => status?.classList.contains('rl-pref-failure'),
        /** The words of the buttons that are shown, in order. */
        shown: () => buttons.filter((each) => !each.hidden).map((each) => each.textContent),
        waiting: () => buttons.every((each) => each.disabled),
        install: () => button('Install').click(),
        /** Presses it as from the keyboard: it has the focus. */
        atHome: () => {
          button('Install in Your Home Folder').focus();
          button('Install in Your Home Folder').click();
        },
        focused: () => document.activeElement?.textContent,
      };
    };

    it('links in /usr/local/bin, and says redlines now works in a new Terminal window', async () => {
      const row = commandLine(draw('general').container);
      expect(row.shown()).toEqual(['Install']);
      row.install();
      expect(row.waiting()).toBe(true);
      await vi.waitFor(() =>
        expect(row.said()).toBe(
          'Linked at /usr/local/bin/redlines, so redlines now works in a new Terminal window.',
        ),
      );
      expect(row.failed()).toBe(false);
      expect(row.waiting()).toBe(false);
      expect(row.shown()).toEqual(['Install']);
    });

    it('says when the folder of the link is not on the PATH', async () => {
      const row = commandLine(
        draw('general', {
          installCommandLine: () =>
            Promise.resolve({
              outcome: 'linked',
              linked: '/usr/local/bin/redlines',
              onPath: false,
            }),
        }).container,
      );
      row.install();
      await vi.waitFor(() =>
        expect(row.said()).toBe(
          'Linked at /usr/local/bin/redlines. Its folder isn’t on your PATH yet.',
        ),
      );
    });

    it('offers the home folder when no administrator’s password was given', async () => {
      const atHome = vi.fn(() =>
        Promise.resolve({ linked: '/h/.local/bin/redlines', onPath: false }),
      );
      const row = commandLine(
        draw('general', {
          installCommandLine: () => Promise.resolve({ outcome: 'cancelled' }),
          installCommandLineAtHome: atHome,
        }).container,
      );
      row.install();
      await vi.waitFor(() =>
        expect(row.said()).toBe(
          'The command line wasn’t installed: /usr/local/bin needs an administrator’s password.',
        ),
      );
      expect(row.failed()).toBe(true);
      expect(row.shown()).toEqual(['Install', 'Install in Your Home Folder']);
      expect(atHome).not.toHaveBeenCalled();

      row.atHome();
      expect(atHome).toHaveBeenCalledOnce();
      expect(row.waiting()).toBe(true);
      await vi.waitFor(() =>
        expect(row.said()).toBe(
          'Linked at /h/.local/bin/redlines. Its folder isn’t on your PATH yet.',
        ),
      );
      expect(row.failed()).toBe(false);
      expect(row.waiting()).toBe(false);
      expect(row.shown()).toEqual(['Install']);
      // The button that had the focus is gone, and Install has it.
      expect(row.focused()).toBe('Install');
    });

    it('says the home folder link works in a new Terminal window when it is on the PATH', async () => {
      const row = commandLine(
        draw('general', {
          installCommandLine: () => Promise.resolve({ outcome: 'cancelled' }),
        }).container,
      );
      row.install();
      await vi.waitFor(() => expect(row.shown()).toContain('Install in Your Home Folder'));
      row.atHome();
      await vi.waitFor(() =>
        expect(row.said()).toBe(
          'Linked at /h/.local/bin/redlines, so redlines now works in a new Terminal window.',
        ),
      );
    });

    it('says why /usr/local/bin could not be used, and offers the home folder', async () => {
      const row = commandLine(
        draw('general', {
          installCommandLine: () =>
            Promise.resolve({
              outcome: 'failed',
              why: 'Couldn’t make /usr/local/bin: File exists (os error 17)',
            }),
        }).container,
      );
      row.install();
      await vi.waitFor(() =>
        expect(row.said()).toBe('Couldn’t make /usr/local/bin: File exists (os error 17)'),
      );
      expect(row.failed()).toBe(true);
      expect(row.shown()).toEqual(['Install', 'Install in Your Home Folder']);
    });

    it('says what is there when it is somebody else’s, and offers nothing more', async () => {
      const row = commandLine(
        draw('general', {
          installCommandLine: () =>
            Promise.reject(
              new Error(
                '/usr/local/bin/redlines is a link to /opt/node/bin/redlines, so Redlines left it.',
              ),
            ),
        }).container,
      );
      row.install();
      await vi.waitFor(() =>
        expect(row.said()).toBe(
          '/usr/local/bin/redlines is a link to /opt/node/bin/redlines, so Redlines left it.',
        ),
      );
      expect(row.failed()).toBe(true);
      expect(row.waiting()).toBe(false);
      expect(row.shown()).toEqual(['Install']);
    });

    it('keeps the home folder on offer when linking there fails too', async () => {
      let tries = 0;
      const row = commandLine(
        draw('general', {
          installCommandLine: () =>
            tries++ === 0
              ? Promise.resolve({ outcome: 'cancelled' })
              : Promise.reject(new Error('The redlines program isn’t here.')),
          installCommandLineAtHome: () =>
            Promise.reject(
              new Error('/h/.local/bin/redlines is a file of its own, so Redlines left it.'),
            ),
        }).container,
      );
      row.install();
      await vi.waitFor(() => expect(row.shown()).toContain('Install in Your Home Folder'));
      row.atHome();
      await vi.waitFor(() =>
        expect(row.said()).toBe(
          '/h/.local/bin/redlines is a file of its own, so Redlines left it.',
        ),
      );
      expect(row.failed()).toBe(true);
      expect(row.waiting()).toBe(false);
      expect(row.shown()).toEqual(['Install', 'Install in Your Home Folder']);
      // Trying /usr/local/bin again, and failing otherwise, takes the offer away.
      row.install();
      await vi.waitFor(() => expect(row.said()).toBe('The redlines program isn’t here.'));
      expect(row.shown()).toEqual(['Install']);
    });

    it('says what to do when a link to this copy would not last, whichever button it was', async () => {
      // What the app says to a copy on its disk image, or translocated (command_line.rs).
      const wontLast =
        'The command line wasn’t installed: a link to this copy of Redlines wouldn’t last. Move ' +
        'Redlines to your Applications folder, and open it from there.';
      const installRow = commandLine(
        draw('general', { installCommandLine: () => Promise.reject(new Error(wontLast)) })
          .container,
      );
      installRow.install();
      await vi.waitFor(() => expect(installRow.said()).toBe(wontLast));
      expect(installRow.failed()).toBe(true);
      expect(installRow.shown()).toEqual(['Install']);

      // The home folder's button, offered after a cancel, is refused alike.
      const homeRow = commandLine(
        draw('general', {
          installCommandLine: () => Promise.resolve({ outcome: 'cancelled' }),
          installCommandLineAtHome: () => Promise.reject(new Error(wontLast)),
        }).container,
      );
      homeRow.install();
      await vi.waitFor(() => expect(homeRow.shown()).toContain('Install in Your Home Folder'));
      homeRow.atHome();
      await vi.waitFor(() => expect(homeRow.said()).toBe(wontLast));
      expect(homeRow.failed()).toBe(true);
    });
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
