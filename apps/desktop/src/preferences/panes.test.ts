// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { iconRotationLabel } from '../dock-icon.ts';
import { DEFAULT_SETTINGS, type Settings } from '../settings.ts';
import {
  type CommandLineInstall,
  type CommandLineLink,
  type DefaultApp,
  type DefaultAppChange,
  PANES,
  type PaneDeps,
  type PaneId,
  renderPane,
  rowLabels,
} from './panes.ts';

afterEach(() => document.body.replaceChildren());

/** Deps over a settings object the test can read back. */
function setup(extra: Partial<PaneDeps> = {}) {
  let settings: Settings = { ...DEFAULT_SETTINGS };
  const update = vi.fn((change: Partial<Settings>) => {
    settings = { ...settings, ...change };
  });
  const setZoom = vi.fn((level: number) => {
    settings = { ...settings, zoom: level };
  });
  const deps: PaneDeps = {
    settings: () => settings,
    update,
    setZoom,
    installCommandLine: () =>
      Promise.resolve({ outcome: 'linked', linked: '/usr/local/bin/redlines', onPath: true }),
    installCommandLineAtHome: () =>
      Promise.resolve({ linked: '/h/.local/bin/redlines', onPath: true }),
    defaultApp: () => Promise.resolve({ status: 'other', app: 'TextEdit' }),
    makeDefaultApp: () => Promise.resolve({ outcome: 'made' }),
    ...extra,
  };
  const container = document.createElement('div');
  document.body.append(container);
  return { deps, container, update, setZoom, now: () => settings };
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

/** A promise that the test settles when it chooses. */
const later = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((settle, refuse) => {
    resolve = settle;
    reject = refuse;
  });
  return { promise, resolve, reject };
};

/**
 * Takes the focus from a button that waits, as a WebView does to one that is disabled: it goes back
 * to the page. (happy-dom blurs no disabled button, so a field that goes away takes it there.)
 */
const loseFocus = () => {
  const elsewhere = document.createElement('input');
  document.body.append(elsewhere);
  elsewhere.focus();
  elsewhere.remove();
  expect(document.activeElement).toBe(document.body);
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
      'Default app for Markdown',
      'Command line',
    ]);
    expect(rowLabels(draw('appearance').container)).toEqual([
      'Appearance',
      'Theme',
      'Zoom',
      'Text size',
    ]);
    expect(rowLabels(draw('editor').container)).toEqual([
      'Spell check',
      'Smart quotes and dashes',
      'Close brackets and Markdown pairs',
      'Track Changes on for new documents',
      'Show line break marks (¶)',
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

    // Line break marks start hidden, and show at once.
    const marks = control<HTMLInputElement>(container, 'Show line break marks (¶)', 'input');
    expect(marks.checked).toBe(false);
    marks.checked = true;
    marks.dispatchEvent(new Event('change'));
    expect(update).toHaveBeenLastCalledWith({ showLineBreakMarks: true });
    expect(now().showLineBreakMarks).toBe(true);
  });

  it('starts each control at the stored setting', () => {
    const made = setup();
    made.deps.settings = () => ({
      ...DEFAULT_SETTINGS,
      theme: 'book',
      appearance: 'dark',
      onLaunch: 'reopen',
      closePairs: false,
      showLineBreakMarks: true,
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
    expect(
      control<HTMLInputElement>(made.container, 'Show line break marks (¶)', 'input').checked,
    ).toBe(true);
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

  it('steps the zoom through the ladder, asks for it, and stops at its ends', () => {
    const { container, now, setZoom, update } = draw('appearance');
    expect(rowLabels(container)).toEqual(['Appearance', 'Theme', 'Zoom', 'Text size']);
    const [smaller, larger] = [
      ...container.querySelectorAll<HTMLButtonElement>('[data-row="Zoom"] .rl-pref-step'),
    ];
    const shown = () => container.querySelector('[data-row="Zoom"] .rl-pref-size')?.textContent;
    expect(shown()).toBe('100%');
    expect(container.querySelector('[data-row="Zoom"]')?.textContent).toContain(
      'Everything in Redlines’ windows',
    );
    larger?.click();
    expect(setZoom).toHaveBeenLastCalledWith(1.1);
    expect(now().zoom).toBe(1.1);
    expect(shown()).toBe('110%');
    for (let i = 0; i < 10; i++) smaller?.click();
    expect(now().zoom).toBe(0.8);
    expect(shown()).toBe('80%');
    expect(smaller?.disabled).toBe(true);
    for (let i = 0; i < 10; i++) larger?.click();
    expect(now().zoom).toBe(2);
    expect(larger?.disabled).toBe(true);
    // The zoom is the app's to keep: it never goes through the settings' update.
    expect(update).not.toHaveBeenCalled();
  });

  it('steps the text size through the ladder and stops at its ends', () => {
    const { container, now } = draw('appearance');
    const [smaller, larger] = [
      ...container.querySelectorAll<HTMLButtonElement>('[data-row="Text size"] .rl-pref-step'),
    ];
    const shown = () =>
      container.querySelector('[data-row="Text size"] .rl-pref-size')?.textContent;
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
        /** Presses Install as from the keyboard: it has the focus. */
        install: () => {
          button('Install').focus();
          button('Install').click();
        },
        /** Presses the home folder's button as from the keyboard. */
        atHome: () => {
          button('Install in Your Home Folder').focus();
          button('Install in Your Home Folder').click();
        },
        /** Where the focus is: a button by its words, or else what it is. */
        focused: () => {
          const active = document.activeElement;
          return active instanceof HTMLButtonElement ? active.textContent : active?.tagName;
        },
        loseFocus,
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

    it('gives the focus back once a wait ends: to the button pressed, or else to Install', async () => {
      const installing = [later<CommandLineInstall>(), later<CommandLineInstall>()];
      const refusing = later<CommandLineInstall>();
      const atHome = later<CommandLineLink>();
      const waits = [...installing, refusing];
      const { container } = draw('general', {
        installCommandLine: () => waits.shift()!.promise,
        installCommandLineAtHome: () => atHome.promise,
      });
      const row = commandLine(container);

      // Cancelled: the focus, lost while Install waited, comes back to it.
      row.install();
      row.loseFocus();
      installing[0]!.resolve({ outcome: 'cancelled' });
      await vi.waitFor(() => expect(row.focused()).toBe('Install'));

      // Refused at home: back to the home folder's button, which is still there.
      row.atHome();
      row.loseFocus();
      atHome.reject(new Error('/h/.local/bin/redlines is a file of its own, so Redlines left it.'));
      await vi.waitFor(() => expect(row.focused()).toBe('Install in Your Home Folder'));

      // Failed, and refused: back to Install.
      row.install();
      row.loseFocus();
      installing[1]!.resolve({
        outcome: 'failed',
        why: 'Couldn’t make /usr/local/bin: Not a directory',
      });
      await vi.waitFor(() => expect(row.focused()).toBe('Install'));
      row.install();
      row.loseFocus();
      refusing.reject(new Error('The redlines program isn’t here.'));
      await vi.waitFor(() => expect(row.focused()).toBe('Install'));
      expect(row.shown()).toEqual(['Install']);
    });

    it('leaves the focus where the person put it while a button waited', async () => {
      const installing = later<CommandLineInstall>();
      const { container } = draw('general', { installCommandLine: () => installing.promise });
      const row = commandLine(container);
      row.install();
      const name = container.querySelector<HTMLInputElement>('[aria-label="Name"]')!;
      name.focus();
      installing.resolve({ outcome: 'cancelled' });
      await vi.waitFor(() => expect(row.shown()).toContain('Install in Your Home Folder'));
      expect(document.activeElement).toBe(name);
    });
  });

  describe('the Default app for Markdown row', () => {
    /** The row's button, and the line under it, which says which app opens Markdown files. */
    const defaultApp = (container: HTMLElement) => {
      const row = container.querySelector<HTMLElement>('[data-row="Default app for Markdown"]');
      const status = row?.querySelector<HTMLElement>('[role="status"]');
      const button = row?.querySelector('button');
      if (!status || !button) throw new Error('no Default app for Markdown row');
      return {
        button,
        said: () => status.textContent,
        /** Whether the line says that something didn't happen. */
        failed: () => status.classList.contains('rl-pref-failure'),
        /** Presses the button as from the keyboard: it has the focus. */
        press: () => {
          button.focus();
          button.click();
        },
      };
    };

    /** What the app refuses a copy on its disk image or translocated with (default_app.rs). */
    const moveFirst =
      'Redlines wasn’t made the default app: this copy of Redlines won’t stay where it is. Move ' +
      'Redlines to your Applications folder, and open it from there.';

    it('says which app opens Markdown files, and offers to make it Redlines', async () => {
      const row = defaultApp(draw('general').container);
      expect(row.button.textContent).toBe('Make Redlines the Default');
      await vi.waitFor(() => expect(row.said()).toBe('Markdown files open in TextEdit.'));
      expect(row.failed()).toBe(false);
      expect(row.button.disabled).toBe(false);
    });

    it('has nothing to do once Redlines opens them', async () => {
      const row = defaultApp(
        draw('general', { defaultApp: () => Promise.resolve({ status: 'redlines' }) }).container,
      );
      await vi.waitFor(() => expect(row.said()).toBe('Markdown files open in Redlines.'));
      expect(row.failed()).toBe(false);
      expect(row.button.disabled).toBe(true);
    });

    it('says so when no app opens them, and nothing where nobody can tell', async () => {
      const none = defaultApp(
        draw('general', { defaultApp: () => Promise.resolve({ status: 'other', app: null }) })
          .container,
      );
      await vi.waitFor(() => expect(none.said()).toBe('No app opens Markdown files yet.'));
      expect(none.button.disabled).toBe(false);

      // An older macOS, Windows or Linux: the button stays, and says why when it is pressed.
      const unknown = later<DefaultApp>();
      const unknownRow = defaultApp(
        draw('general', { defaultApp: () => unknown.promise }).container,
      );
      unknown.resolve({ status: 'unknown' });
      await unknown.promise;
      expect(unknownRow.said()).toBe('');
      expect(unknownRow.button.disabled).toBe(false);

      // Nor does a question the app can't answer, as in a plain browser.
      const failing = later<DefaultApp>();
      const failingRow = defaultApp(
        draw('general', { defaultApp: () => failing.promise }).container,
      );
      failing.reject(new Error('The default app is set from the app.'));
      await failing.promise.catch(() => {});
      expect(failingRow.said()).toBe('');
      expect(failingRow.failed()).toBe(false);
      expect(failingRow.button.disabled).toBe(false);
    });

    it('makes Redlines the default, and says so', async () => {
      const answer = later<DefaultAppChange>();
      const make = vi.fn(() => answer.promise);
      const row = defaultApp(draw('general', { makeDefaultApp: make }).container);
      await vi.waitFor(() => expect(row.said()).toBe('Markdown files open in TextEdit.'));
      row.press();
      expect(make).toHaveBeenCalledOnce();
      // While macOS answers, the button can't be pressed again.
      expect(row.button.disabled).toBe(true);
      expect(row.said()).toBe('');
      answer.resolve({ outcome: 'made' });
      await vi.waitFor(() => expect(row.said()).toBe('Markdown files now open in Redlines.'));
      expect(row.failed()).toBe(false);
      expect(row.button.disabled).toBe(true);
    });

    it('says which app macOS kept', async () => {
      const kept = defaultApp(
        draw('general', {
          makeDefaultApp: () => Promise.resolve({ outcome: 'kept', app: 'TextEdit' }),
        }).container,
      );
      kept.press();
      await vi.waitFor(() => expect(kept.said()).toBe('Markdown files still open in TextEdit.'));
      expect(kept.failed()).toBe(true);
      expect(kept.button.disabled).toBe(false);

      const none = defaultApp(
        draw('general', {
          makeDefaultApp: () => Promise.resolve({ outcome: 'kept', app: null }),
        }).container,
      );
      none.press();
      await vi.waitFor(() =>
        expect(none.said()).toBe('Markdown files still don’t open in Redlines.'),
      );
      expect(none.failed()).toBe(true);
    });

    it('says why it was refused, as the app says it', async () => {
      const row = defaultApp(
        draw('general', { makeDefaultApp: () => Promise.reject(new Error(moveFirst)) }).container,
      );
      row.press();
      await vi.waitFor(() => expect(row.said()).toBe(moveFirst));
      expect(row.failed()).toBe(true);
      expect(row.button.disabled).toBe(false);
    });

    it('keeps what it said when the first answer comes after the button’s', async () => {
      const first = later<DefaultApp>();
      const row = defaultApp(draw('general', { defaultApp: () => first.promise }).container);
      row.press();
      await vi.waitFor(() => expect(row.said()).toBe('Markdown files now open in Redlines.'));
      first.resolve({ status: 'other', app: 'TextEdit' });
      await first.promise;
      expect(row.said()).toBe('Markdown files now open in Redlines.');
      expect(row.button.disabled).toBe(true);
    });

    it('gives the focus back to the button once a refusal ends the wait, unless it was moved', async () => {
      const refusing = later<DefaultAppChange>();
      const kept = later<DefaultAppChange>();
      const waits = [refusing, kept];
      const { container } = draw('general', { makeDefaultApp: () => waits.shift()!.promise });
      const row = defaultApp(container);

      row.press();
      loseFocus();
      refusing.reject(new Error(moveFirst));
      await vi.waitFor(() => expect(document.activeElement).toBe(row.button));

      // Moved meanwhile, it stays where the person put it.
      row.press();
      const name = container.querySelector<HTMLInputElement>('[aria-label="Name"]')!;
      name.focus();
      kept.resolve({ outcome: 'kept', app: 'TextEdit' });
      await vi.waitFor(() => expect(row.said()).toBe('Markdown files still open in TextEdit.'));
      expect(document.activeElement).toBe(name);
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
