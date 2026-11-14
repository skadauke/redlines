// The four panes of the Preferences window (design, Preferences): a few rows each, a label and a
// control, which apply at once. A pane holds only what the table in the design lists, and what the
// installed plugins contribute to it (`SettingContribution`); the Agents pane is filled by the
// agents' own code (`deps.agentsPane`).

import type { SettingContribution } from '@redlines/plugin-api';
import { THEMES, type ThemeName } from '@redlines/themes';
import { iconRotationLabel } from '../dock-icon.ts';
import { deriveHandle, toHandle } from '../handle.ts';
import {
  imageFolderNameOf,
  imageFolderNameProblem,
  type AppearanceChoice,
  type ImagePlace,
  type Settings,
} from '../settings.ts';
import { stepSize, ZOOM_LADDER } from '../text-size.ts';

export type PaneId = 'general' | 'appearance' | 'editor' | 'agents';

/** The panes, left to right along the top, with the hint each icon shows. */
export const PANES: readonly { id: PaneId; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'editor', label: 'Editor' },
  { id: 'agents', label: 'Agents' },
];

/** Where the command line's link is, and whether its folder is on the shell's PATH. */
export interface CommandLineLink {
  linked: string;
  onPath: boolean;
}

/**
 * What installing the command line in /usr/local/bin did: linked it; or not, because macOS got no
 * administrator's password (the person cancelled, or couldn't give one), or for another reason that
 * `why` says. Either way the home folder is offered then.
 */
export type CommandLineInstall =
  | ({ outcome: 'linked' } & CommandLineLink)
  | { outcome: 'cancelled' }
  | { outcome: 'failed'; why: string };

/**
 * Which app opens Markdown files, as macOS says: Redlines (whichever copy), another app by its
 * name, or none; or nobody can tell, on an older macOS, Windows or Linux.
 */
export type DefaultApp =
  { status: 'redlines' } | { status: 'other'; app: string | null } | { status: 'unknown' };

/**
 * What asking macOS to open Markdown files in Redlines did: it does now, or macOS kept the app that
 * opens them (by its name, if any), as when the person said no.
 */
export type DefaultAppChange = { outcome: 'made' } | { outcome: 'kept'; app: string | null };

export interface PaneDeps {
  /** The settings as stored now. */
  settings: () => Settings;
  /** Changes some settings, at once. */
  update: (change: Partial<Settings>) => void;
  /** Zooms every window of the app to a level of the window zoom's ladder, and keeps it (zoom.ts). */
  setZoom: (level: number) => void;
  /** Who git says the person is, shown in the name and handle fields until they are set. */
  gitIdentity?: { name: string; handle: string };
  /**
   * Links the `redlines` command line in /usr/local/bin, where every shell finds it, and macOS asks
   * for an administrator if that folder needs one; rejects with a sentence that says why it
   * couldn't, as when somebody else's `redlines` is there.
   */
  installCommandLine: () => Promise<CommandLineInstall>;
  /** Links it in the home folder instead, which needs no administrator; rejects as above. */
  installCommandLineAtHome: () => Promise<CommandLineLink>;
  /** Which app opens Markdown files now; rejects where the app can't be asked. */
  defaultApp: () => Promise<DefaultApp>;
  /**
   * Asks macOS to open Markdown files in Redlines; rejects with a sentence that says why it wasn't
   * asked or couldn't, as for a copy of the app on its disk image.
   */
  makeDefaultApp: () => Promise<DefaultAppChange>;
  /**
   * Opens the Mac's System Settings at the Quick Look extensions, where Redlines' preview of
   * Markdown files can be turned off; rejects with a sentence that says why it couldn't. Given only
   * where there is a Quick Look to turn off: the row is not drawn without it.
   */
  openQuickLookSettings?: () => Promise<void>;
  /**
   * Asks for a folder with the system's panel, which opens in `start` when there is one: its full
   * path, or null when the person cancels; rejects with a sentence that says why it couldn't ask,
   * as in a plain browser.
   */
  chooseFolder: (start: string | null) => Promise<string | null>;
  /** Settings that plugins contribute, and where their values are kept. */
  contributions?: readonly SettingContribution[];
  pluginValue?: (id: string) => boolean | number | string | undefined;
  setPluginValue?: (id: string, value: boolean | number | string) => void;
  /** Fills the Agents pane; supplied with the agents. Returns a function that tidies it up. */
  agentsPane?: (container: HTMLElement) => void | (() => void);
}

type Control = HTMLElement;

let nextId = 0;

/** What a stepper hears when its size is set from outside (`showZoom`). */
const SHOW_SIZE = 'rl-show-size';

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

/** A row: its label on the left, its control on the right, and a quiet line under it if any. */
function row(label: string, control: Control, note?: HTMLElement): HTMLElement {
  const id = `rl-pref-${nextId++}`;
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

function toggle(checked: boolean, change: (value: boolean) => void): HTMLInputElement {
  const input = el('input');
  input.type = 'checkbox';
  input.checked = checked;
  input.addEventListener('change', () => change(input.checked));
  return input;
}

function choice<T extends string>(
  options: readonly { value: T; label: string }[],
  value: T,
  change: (value: T) => void,
): HTMLSelectElement {
  const select = el('select');
  for (const option of options) {
    const item = el('option', undefined, option.label);
    item.value = option.value;
    select.append(item);
  }
  select.value = value;
  select.addEventListener('change', () => change(select.value as T));
  return select;
}

/** Choices side by side, one of them taken: the system's radio buttons, each before its name. */
function choices<T extends string>(
  options: readonly { value: T; label: string }[],
  value: T,
  change: (value: T) => void,
): HTMLElement {
  const group = el('div', 'rl-pref-choices');
  group.setAttribute('role', 'radiogroup');
  // One name, so that they are one group, which the arrow keys move in.
  const name = `rl-pref-choices-${nextId++}`;
  for (const option of options) {
    const input = el('input');
    input.type = 'radio';
    input.name = name;
    input.value = option.value;
    input.checked = option.value === value;
    input.addEventListener('change', () => change(option.value));
    const label = el('label', 'rl-pref-choice');
    label.append(input, option.label);
    group.append(label);
  }
  return group;
}

function line(text: string, className = 'rl-pref-note'): HTMLElement {
  return el('div', className, text);
}

function general(deps: PaneDeps): HTMLElement[] {
  const { settings, update } = deps;
  const current = settings();
  const name = el('input', 'rl-pref-text');
  name.type = 'text';
  name.value = current.identity?.name ?? '';
  name.placeholder = deps.gitIdentity?.name ?? 'Your name';
  name.autocomplete = 'off';
  name.spellcheck = false;
  const handle = el('input', 'rl-pref-text rl-pref-handle');
  handle.type = 'text';
  handle.value = current.identity?.handle ?? '';
  handle.placeholder = deps.gitIdentity?.handle ?? 'handle';
  handle.autocomplete = 'off';
  handle.spellcheck = false;
  handle.setAttribute('aria-label', 'Handle');
  name.setAttribute('aria-label', 'Name');
  // Both fields empty go back to git's. A handle is what the format allows (it is written back to
  // the field when the person leaves it); one that isn't, or none, comes from the name. A handle
  // typed with no name goes with git's name.
  const save = () => {
    const typedName = name.value.trim();
    const typedHandle = handle.value.trim();
    if (!typedName && !typedHandle) return update({ identity: null });
    const who = typedName || deps.gitIdentity?.name || typedHandle;
    update({ identity: { name: who, handle: toHandle(typedHandle) || deriveHandle(who) } });
  };
  name.addEventListener('input', save);
  handle.addEventListener('input', save);
  handle.addEventListener('blur', () => {
    const saved = settings().identity;
    if (saved && handle.value.trim()) handle.value = saved.handle;
  });
  const identity = el('div', 'rl-pref-pair');
  identity.append(name, handle);

  const onLaunch = choice(
    [
      { value: 'new', label: 'Show a new document' },
      { value: 'reopen', label: 'Reopen the last document' },
    ],
    current.onLaunch,
    (value) => update({ onLaunch: value }),
  );

  // Install links the command line in /usr/local/bin. Where that can't be, other than for somebody
  // else's `redlines` there, a second button offers the home folder.
  const status = el('div', 'rl-pref-note');
  status.setAttribute('role', 'status');
  const install = el('button', 'rl-pref-button', 'Install');
  install.type = 'button';
  const atHome = el('button', 'rl-pref-button', 'Install in Your Home Folder');
  atHome.type = 'button';
  atHome.hidden = true;
  const say = (text: string, failed: boolean) => {
    status.classList.toggle('rl-pref-failure', failed);
    status.textContent = text;
  };
  const sayLinked = ({ linked, onPath }: CommandLineLink) =>
    say(
      onPath
        ? `Linked at ${linked}, so redlines now works in a new Terminal window.`
        : `Linked at ${linked}. Its folder isn’t on your PATH yet.`,
      false,
    );
  /** Runs one of the two with both buttons off. Says a refusal; gives back what it did otherwise. */
  const attempt = async <T>(linking: () => Promise<T>): Promise<T | undefined> => {
    install.disabled = atHome.disabled = true;
    say('', false);
    try {
      return await linking();
    } catch (error) {
      say(error instanceof Error ? error.message : String(error), true);
      return undefined;
    } finally {
      install.disabled = atHome.disabled = false;
    }
  };
  /**
   * Gives the focus back once a wait is over. A button loses it while it is disabled, as both are
   * while one waits, and when it is hidden. It goes back to the button that was pressed, or to
   * Install once that is gone, and never away from where the person put it meanwhile.
   */
  const refocus = (pressed: HTMLButtonElement) => {
    const active = document.activeElement;
    if (active && active !== document.body && active !== pressed) return;
    (pressed.hidden ? install : pressed).focus();
  };
  install.addEventListener('click', () => {
    void attempt(deps.installCommandLine).then((result) => {
      atHome.hidden = result?.outcome !== 'cancelled' && result?.outcome !== 'failed';
      switch (result?.outcome) {
        case 'linked':
          sayLinked(result);
          break;
        case 'cancelled':
          say(
            'The command line wasn’t installed: /usr/local/bin needs an administrator’s password.',
            true,
          );
          break;
        case 'failed':
          say(result.why, true);
          break;
      }
      refocus(install);
    });
  });
  atHome.addEventListener('click', () => {
    void attempt(deps.installCommandLineAtHome).then((linked) => {
      if (linked) {
        atHome.hidden = true;
        sayLinked(linked);
      }
      refocus(atHome);
    });
  });
  const command = el('div', 'rl-pref-inline');
  command.append(install, atHome);

  return [
    row('Name and handle', identity, line('As they appear on your changes.')),
    row('On launch', onLaunch),
    newDocumentFolderRow(deps),
    row(
      'Check for updates automatically',
      toggle(current.checkForUpdates, (value) => update({ checkForUpdates: value })),
    ),
    row(
      iconRotationLabel(),
      toggle(current.rotateIcon, (value) => update({ rotateIcon: value })),
    ),
    defaultAppRow(deps),
    ...(deps.openQuickLookSettings ? [quickLookRow(deps.openQuickLookSettings)] : []),
    row('Command line', command, status),
  ];
}

/** The line under the default folder's row, which says what Save does, until something fails. */
const FOLDER_NOTES = {
  unset: 'Save opens where macOS last saved.',
  set: 'Save opens in this folder.',
};

/** A folder's name for the row: the last name in its path, or the whole path for the disk's root. */
function folderName(folder: string): string {
  return (
    folder
      .replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .pop() || folder
  );
}

/**
 * Default folder for new documents: where the Save dialog opens for a document that has no file
 * yet (#309). The row shows the folder by its name, with its whole path as the hint; Choose… asks
 * for another with the system's panel, and Clear, there only while one is set, goes back to leaving
 * it to macOS. A folder that is gone by the time Save looks is no problem for the row: Save falls
 * back to what it did before.
 */
function newDocumentFolderRow(deps: PaneDeps): HTMLElement {
  const status = el('div', 'rl-pref-note');
  status.setAttribute('role', 'status');
  const path = el('span', 'rl-pref-path');
  const choose = el('button', 'rl-pref-button', 'Choose…');
  choose.type = 'button';
  const clear = el('button', 'rl-pref-button', 'Clear');
  clear.type = 'button';
  const control = el('div', 'rl-pref-inline');
  // Its buttons are named for the row, as a stepper's are (`stepper`).
  control.setAttribute('role', 'group');
  control.append(path, choose);
  const say = (text: string, failed: boolean) => {
    status.classList.toggle('rl-pref-failure', failed);
    status.textContent = text;
  };
  /**
   * Shows the folder, with the line that says what Save does, and a Clear button only while there
   * is one. Choose… is never moved.
   */
  const show = (folder: string | null) => {
    path.textContent = folder === null ? 'Not set' : folderName(folder);
    path.title = folder ?? '';
    path.classList.toggle('rl-pref-unset', folder === null);
    if (folder === null) clear.remove();
    else if (!clear.isConnected) control.append(clear);
    say(folder === null ? FOLDER_NOTES.unset : FOLDER_NOTES.set, false);
  };
  show(deps.settings().newDocumentFolder);
  /**
   * The wait is over and the button is back: so is the focus, which it lost while it was disabled,
   * unless the person put it somewhere else meanwhile.
   */
  const back = () => {
    choose.disabled = false;
    delete control.dataset['waiting'];
    const active = document.activeElement;
    if (active && active !== document.body && active !== choose) return;
    choose.focus();
  };
  choose.addEventListener('click', () => {
    choose.disabled = true;
    // The panel is a sheet of this window, over the page: another window's change to the settings
    // meanwhile mustn't draw the pane again (`watchSettings`), which would leave this row to
    // answer into a row that is gone.
    control.dataset['waiting'] = '';
    void deps.chooseFolder(deps.settings().newDocumentFolder).then(
      (folder) => {
        if (folder !== null) {
          deps.update({ newDocumentFolder: folder });
          show(folder);
        }
        back();
      },
      (error: unknown) => {
        say(error instanceof Error ? error.message : String(error), true);
        back();
      },
    );
  });
  clear.addEventListener('click', () => {
    deps.update({ newDocumentFolder: null });
    show(null);
    // The button the person pressed is gone: Choose… is the next stop.
    choose.focus();
  });
  return row('Default folder for new documents', control, status);
}

/**
 * What the line under the Quick Look button says until it has something to say about the button. It
 * names no menu: where the list is in System Settings changes from one macOS to the next.
 */
const QUICK_LOOK_HINT =
  'Redlines’ preview is one of the Quick Look extensions in System Settings, where it can be turned off.';

/**
 * Quick Look previews of Markdown files: the app comes with one, which macOS registers by itself
 * and lists in System Settings, so that is where it is turned off. The button opens that list. If
 * it can't, the line under it says why, with the hint still, and goes back to the hint alone on the
 * next press.
 */
function quickLookRow(open: () => Promise<void>): HTMLElement {
  const status = el('div', 'rl-pref-note', QUICK_LOOK_HINT);
  status.setAttribute('role', 'status');
  const button = el('button', 'rl-pref-button', 'Open System Settings');
  button.type = 'button';
  const say = (text: string, failed: boolean) => {
    status.classList.toggle('rl-pref-failure', failed);
    status.textContent = text;
  };
  // One press at a time: a second while the first is under way would put its answer over the
  // other's, in whichever order they come.
  let opening = false;
  button.addEventListener('click', () => {
    if (opening) return;
    opening = true;
    say(QUICK_LOOK_HINT, false);
    open().then(
      () => {
        opening = false;
      },
      (error: unknown) => {
        opening = false;
        say(`${error instanceof Error ? error.message : String(error)} ${QUICK_LOOK_HINT}`, true);
      },
    );
  });
  const control = el('div', 'rl-pref-inline');
  control.append(button);
  return row('Quick Look previews of Markdown files', control, status);
}

/** What the line under the button says of the app that opens Markdown files. */
function opensMarkdown(app: DefaultApp): string {
  switch (app.status) {
    case 'redlines':
      return 'Markdown files open in Redlines.';
    case 'other':
      return app.app ? `Markdown files open in ${app.app}.` : 'No app opens Markdown files yet.';
    case 'unknown':
      return '';
  }
}

/**
 * Default app for Markdown: Make Redlines the Default asks macOS to open Markdown files in
 * Redlines. The line under it says which app opens them, from when the pane opens, and then what
 * became of the request. Once Redlines opens them, the button has nothing left to do.
 */
function defaultAppRow(deps: PaneDeps): HTMLElement {
  const status = el('div', 'rl-pref-note');
  status.setAttribute('role', 'status');
  const make = el('button', 'rl-pref-button', 'Make Redlines the Default');
  make.type = 'button';
  const say = (text: string, failed: boolean) => {
    status.classList.toggle('rl-pref-failure', failed);
    status.textContent = text;
  };
  let pressed = false;
  void deps.defaultApp().then(
    (app) => {
      // The button's answer is newer than this one.
      if (pressed) return;
      make.disabled = app.status === 'redlines';
      say(opensMarkdown(app), false);
    },
    // Where the app can't be asked, the line says nothing until the button is pressed.
    () => {},
  );
  /**
   * The wait is over and the button is back: so is the focus, which it lost while it was disabled,
   * unless the person put it somewhere else meanwhile.
   */
  const failed = (text: string) => {
    make.disabled = false;
    say(text, true);
    const active = document.activeElement;
    if (active && active !== document.body && active !== make) return;
    make.focus();
  };
  make.addEventListener('click', () => {
    pressed = true;
    make.disabled = true;
    say('', false);
    void deps.makeDefaultApp().then(
      (change) => {
        if (change.outcome === 'made') return say('Markdown files now open in Redlines.', false);
        failed(
          change.app
            ? `Markdown files still open in ${change.app}.`
            : 'Markdown files still don’t open in Redlines.',
        );
      },
      (error: unknown) => failed(error instanceof Error ? error.message : String(error)),
    );
  });
  const control = el('div', 'rl-pref-inline');
  control.append(make);
  return row('Default app for Markdown', control, status);
}

function appearance(deps: PaneDeps): HTMLElement[] {
  const { settings, update } = deps;
  const current = settings();
  // Light or dark for every window, and one theme for both (design §6.6).
  const lightOrDark = choices<AppearanceChoice>(
    [
      { value: 'system', label: 'Match System' },
      { value: 'light', label: 'Light' },
      { value: 'dark', label: 'Dark' },
    ],
    current.appearance,
    (value) => update({ appearance: value }),
  );
  const themes = THEMES.map(({ name, label }) => ({ value: name, label }));
  const theme = choice<ThemeName>(themes, current.theme, (value) => update({ theme: value }));

  // They walk the ladders of text-size.ts: the zoom of every window, which stops at 200%, and the
  // text alone, which goes on to 400%.
  const zoom = stepper(current.zoom, (level) => deps.setZoom(level), ZOOM_LADDER);
  const text = stepper(current.textSize, (textSize) => update({ textSize }));

  return [
    row('Appearance', lightOrDark),
    row('Theme', theme),
    row('Zoom', zoom, line('Everything in Redlines’ windows')),
    row('Text size', text),
  ];
}

/**
 * A − 100% + control that steps `start` along the ladder and calls `change` with each size. The
 * value is a live region, so that VoiceOver reads it as it changes.
 */
function stepper(
  start: number,
  change: (size: number) => void,
  ladder?: readonly number[],
): HTMLElement {
  // Another level lands from outside (`showZoom`): shown in place, so that the button pressed
  // keeps the focus and the live region is read.
  let size = start;
  const value = el('span', 'rl-pref-size');
  value.setAttribute('aria-live', 'polite');
  const smaller = el('button', 'rl-pref-button rl-pref-step', '−');
  const larger = el('button', 'rl-pref-button rl-pref-step', '+');
  smaller.type = larger.type = 'button';
  smaller.setAttribute('aria-label', 'Smaller');
  larger.setAttribute('aria-label', 'Larger');
  const show = () => {
    value.textContent = `${Math.round(size * 100)}%`;
    smaller.disabled = stepSize(size, -1, ladder) === size;
    larger.disabled = stepSize(size, 1, ladder) === size;
  };
  const move = (by: number) => {
    size = stepSize(size, by, ladder);
    show();
    change(size);
  };
  smaller.addEventListener('click', () => move(-1));
  larger.addEventListener('click', () => move(1));
  show();
  const group = el('div', 'rl-pref-inline');
  group.setAttribute('role', 'group');
  group.addEventListener(SHOW_SIZE, (event) => {
    size = (event as CustomEvent<number>).detail;
    show();
  });
  group.append(smaller, value, larger);
  return group;
}

/** Where images can be saved (#308), as the Images row offers them. */
const IMAGE_PLACES: readonly { value: ImagePlace; label: string }[] = [
  { value: 'folder', label: 'In a folder beside the document' },
  { value: 'assets', label: 'In a folder named for the document' },
  { value: 'same', label: 'In the document’s folder' },
];

/** What the Images row says of where images go, for the settings as they are. */
function whereImagesGo(settings: Settings): string {
  switch (settings.imagePlace) {
    case 'folder':
      return `Saved in “${settings.imageFolderName}” next to the document.`;
    case 'assets':
      return 'Saved in a folder like “plan.assets” next to the document.';
    case 'same':
      return 'Saved next to the document.';
  }
}

/**
 * Images: where an image dropped or pasted into a document is saved (#308), always inside the
 * document's folder, where the preview loads images from: in a folder beside it, called `images`
 * unless the name is changed, in one named for the document, or in the document's own folder. The
 * name is saved as it is typed, as long as a folder can have it; one that it can't is said so under
 * the row, kept in the field while it is typed, and replaced by the saved name when the field is left.
 */
function imagesRow(deps: PaneDeps): HTMLElement {
  const place = choice(IMAGE_PLACES, deps.settings().imagePlace, (value) => {
    deps.update({ imagePlace: value });
    show();
  });
  place.setAttribute('aria-label', 'Where images are saved');
  const name = el('input', 'rl-pref-text');
  name.type = 'text';
  name.value = deps.settings().imageFolderName;
  name.autocomplete = 'off';
  name.spellcheck = false;
  name.setAttribute('aria-label', 'Folder name');
  const status = el('div', 'rl-pref-note');
  status.setAttribute('role', 'status');
  const stack = el('div', 'rl-pref-stack');
  stack.setAttribute('role', 'group');
  stack.append(place, status);
  /** The line, and the field for the folder's name where one is used, for the settings as they are. */
  const show = () => {
    const current = deps.settings();
    if (current.imagePlace !== 'folder') name.remove();
    else if (!name.isConnected) stack.insertBefore(name, status);
    status.classList.remove('rl-pref-failure');
    status.textContent = whereImagesGo(current);
  };
  name.addEventListener('input', () => {
    const typed = imageFolderNameOf(name.value);
    if (typed === null) {
      // What is wrong with it, which is not always a slash.
      status.classList.add('rl-pref-failure');
      status.textContent = imageFolderNameProblem(name.value);
      return;
    }
    deps.update({ imageFolderName: typed });
    show();
  });
  name.addEventListener('blur', () => {
    name.value = deps.settings().imageFolderName;
    show();
  });
  show();
  return row('Images', stack);
}

function editing(deps: PaneDeps): HTMLElement[] {
  const { settings, update } = deps;
  const current = settings();
  return [
    row(
      'Spell check',
      toggle(current.spellCheck, (value) => update({ spellCheck: value })),
    ),
    row(
      'Smart quotes and dashes',
      toggle(current.smartPunctuation, (value) => update({ smartPunctuation: value })),
    ),
    row(
      'Close brackets and Markdown pairs',
      toggle(current.closePairs, (value) => update({ closePairs: value })),
    ),
    row(
      'Track Changes on for new documents',
      toggle(current.trackNewDocuments, (value) => update({ trackNewDocuments: value })),
    ),
    row(
      'Show line break marks (¶)',
      toggle(current.showLineBreakMarks, (value) => update({ showLineBreakMarks: value })),
    ),
    row(
      'Show word count',
      toggle(current.showWordCount, (value) => update({ showWordCount: value })),
    ),
    imagesRow(deps),
  ];
}

/** The rows that installed plugins contribute to a pane. */
function contributed(pane: PaneId, deps: PaneDeps): HTMLElement[] {
  const { pluginValue, setPluginValue } = deps;
  if (!pluginValue || !setPluginValue) return [];
  return (deps.contributions ?? [])
    .filter((setting) => setting.pane === pane)
    .map((setting) => {
      const stored = pluginValue(setting.id) ?? setting.default;
      const note = setting.description ? line(setting.description) : undefined;
      if (typeof setting.default === 'boolean') {
        return row(
          setting.title,
          toggle(stored === true, (value) => setPluginValue(setting.id, value)),
          note,
        );
      }
      const input = el('input', 'rl-pref-text');
      const numeric = typeof setting.default === 'number';
      input.type = numeric ? 'number' : 'text';
      input.value = String(stored);
      input.addEventListener('input', () => {
        if (!numeric) return setPluginValue(setting.id, input.value);
        if (input.value !== '' && Number.isFinite(input.valueAsNumber)) {
          setPluginValue(setting.id, input.valueAsNumber);
        }
      });
      return row(setting.title, input, note);
    });
}

/**
 * Draws a pane in `container`, replacing what it held. Returns a function that tidies up what the
 * pane started, such as the agents' own.
 */
export function renderPane(pane: PaneId, container: HTMLElement, deps: PaneDeps): () => void {
  container.replaceChildren();
  container.dataset['pane'] = pane;
  const rows = { general, appearance, editor: editing, agents: () => [] }[pane](deps);
  container.append(...rows, ...contributed(pane, deps));
  if (pane !== 'agents') return () => {};
  if (deps.agentsPane) {
    const tidy = deps.agentsPane(container);
    return typeof tidy === 'function' ? tidy : () => {};
  }
  // Until the agents are found, there is nothing to show.
  container.append(line('No agents found.', 'rl-pref-empty'));
  return () => {};
}

/** The labels of the rows a pane holds, in order. */
/** Shows `level` in the Zoom stepper where it is, without drawing the pane again. */
export function showZoom(container: HTMLElement, level: number): void {
  container
    .querySelector('[data-row="Zoom"] [role="group"]')
    ?.dispatchEvent(new CustomEvent(SHOW_SIZE, { detail: level }));
}

export function rowLabels(container: HTMLElement): string[] {
  return [...container.querySelectorAll<HTMLElement>('.rl-pref-row')].map(
    (found) => found.dataset['row'] ?? '',
  );
}
