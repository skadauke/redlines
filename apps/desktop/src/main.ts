// A window of the desktop app: the title bar, the editor under it in a scroller, the file sidebar,
// the menu bar and the document controller, wired together, with the theme applied; and in the app,
// quiet updates, which notifications tell of. Each window runs all of this for its own document, and
// `windows.ts` is what they do together.

import { createEditor, type Author, type EditorUiState } from '@redlines/editor';
import { createReview } from '@redlines/review';
import { applyTheme, type Appearance, type ThemeName } from '@redlines/themes';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { loadAbout } from './about.ts';
import { reportIconRotation } from './dock-icon.ts';
import { DocumentController, TRACKING_FOR_EVERYONE, type DocumentState } from './document.ts';
import { createHost } from './host.ts';
import { appMenuModel, drawnCommandsCheck, type MenuCommands } from './menu-model.ts';
import { createNativeMenu, installShortcuts, type NativeMenu } from './native-menu.ts';
import {
  currentAppearance,
  loadSettings,
  saveSettings,
  themeFor,
  watchAppearance,
  watchSettings,
} from './settings.ts';
import { createNotice } from './ui/notice.ts';
import { createNotifications } from './ui/notifications.ts';
import { createSidebar } from './ui/sidebar.ts';
import { createTitleBar } from './ui/titlebar.ts';
import { presentUpdates } from './update-notifications.ts';
import { relaunch, tauriUpdateSource } from './update-source.ts';
import { createUpdates } from './updates.ts';
import { connectWindow, followFocus, tauriWindowLink } from './windows.ts';
import '@redlines/themes/fonts.css';
import '@redlines/themes/tokens.css';
import './styles.css';

const isTauri = '__TAURI_INTERNALS__' in window;
const host = createHost();

function element(selector: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(selector);
  if (!found) throw new Error(`index.html has no ${selector}`);
  return found;
}

// The theme first, so the window never shows unstyled.
let settings = loadSettings();
let appearance = currentAppearance();
const showTheme = () =>
  applyTheme(document.documentElement, themeFor(settings, appearance), appearance);
showTheme();
watchAppearance((next) => {
  appearance = next;
  showTheme();
});

const author: Author = await host.identity().catch(() => ({ handle: 'me', name: 'Me' }));

const app = element('.rl-app');
const main = element('.rl-main');
const notice = createNotice(main);
const notifications = createNotifications(app);

let doc: DocumentState | null = null;
let ui: EditorUiState | null = null;

// The app's other windows, which this one asks about unsaved edits, and is asked by.
const windows = isTauri ? await connectWindow(tauriWindowLink(), askAboutThisWindow) : null;

/** Before the app quits, comes to the front if this window has unsaved edits, and asks. */
async function askAboutThisWindow(): Promise<boolean> {
  if (!controller.state.dirty) return true;
  const here = getCurrentWindow();
  try {
    await here.unminimize();
    await here.setFocus();
  } catch (error) {
    // The question is what matters, and it shows on the window wherever that is.
    console.warn('Could not bring the window to the front', error);
  }
  return controller.confirmDiscard();
}

const openInNewWindow = (path?: string, line?: number) =>
  host.openWindow(path, line).catch((error: unknown) => {
    console.error('Could not open a new window', error);
    notice.flash('Couldn’t open a new window.');
  });

const editor = createEditor(element('#editor'), {
  doc: '',
  author,
  onChange: (text) => controller.markEdited(text),
  // An edit the editor refuses, such as a tracked change inside code, says why.
  onNotice: (message) => notice.flash(message),
  onUiState: (state) => {
    ui = state;
    render();
  },
});
ui = editor.getUiState();
const review = createReview(editor, { author });

const controller = new DocumentController(host, editor, (state) => {
  const renamed = state.name !== doc?.name;
  const moved = state.path !== doc?.path;
  doc = state;
  if (renamed && isTauri) void getCurrentWindow().setTitle(state.name);
  if (moved) sidebar.setDocument(state.path);
  notice.setStanding(state.notice, () => controller.dismissNotice());
  windows?.reportDocument(state.path, state.dirty);
  render();
});

const sidebar = createSidebar(app, {
  host,
  openFile: (path, { newWindow }) => {
    if (newWindow) void openInNewWindow(path);
    else void controller.open(path).then(() => editor.focus());
  },
});

const toggleTracking = () => {
  const on = !editor.getUiState().tracking;
  editor.setTracking(on);
  // The notice that a file asking for tracking opened with has done its work: the choice is made.
  controller.dismissNotice(TRACKING_FOR_EVERYONE);
  // Every switch says so (design §5.4).
  notice.flash(on ? 'Track Changes is on' : 'Track Changes is off');
};

const toggleSidebar = () => {
  settings = { ...settings, sidebarOpen: !settings.sidebarOpen };
  saveSettings(settings);
  render();
};

// The review bar (@redlines/review). These menu items are enabled only for documents with redlines.
const openReview = () => review.openBar();

const titleBar = createTitleBar(element('#titlebar'), {
  setView: (mode) => editor.setViewMode(mode),
  toggleTracking,
  openReview,
  toggleSidebar,
});

// Updates (#34), in the app only: checked soon after it starts and every few hours, unless turned
// off, and downloaded in the background. Restarting into the new version asks each window about its
// unsaved edits first, as quitting does, and the new version reopens the documents.
const updates = isTauri ? createUpdates(tauriUpdateSource()) : null;
const updateNotifications =
  updates &&
  presentUpdates({
    updates,
    notifications,
    restart: async () => {
      if (!windows || !(await windows.askEach())) return false;
      await updates.install();
      await relaunch(await windows.openPaths());
      return true;
    },
  });

const commands: MenuCommands = {
  create: () => void openInNewWindow(),
  open: () => void controller.openWithDialog().then(() => editor.focus()),
  save: () => void controller.save(),
  saveAs: () => void controller.saveAs(),
  quit: () => void windows?.quit(),
  setView: (mode) => editor.setViewMode(mode),
  toggleSidebar,
  toggleTracking,
  openReview,
  nextChange: () => review.next(),
  previousChange: () => review.previous(),
  setTheme: (which: Appearance, theme: ThemeName) => {
    settings = { ...settings, [which === 'dark' ? 'darkTheme' : 'lightTheme']: theme };
    saveSettings(settings);
    showTheme();
    render();
  },
  toggleIconRotation: () => {
    settings = { ...settings, rotateIcon: !settings.rotateIcon };
    saveSettings(settings);
    reportIconRotation(settings.rotateIcon);
    render();
  },
  checkForUpdates: () => void updateNotifications?.checkForUpdates(),
  toggleUpdateChecks: () => {
    settings = { ...settings, checkForUpdates: !settings.checkForUpdates };
    saveSettings(settings);
    updates?.setAutomatic(settings.checkForUpdates);
    render();
  },
};

// The menus show the commands registered by now: plugins register theirs above this line.
const menuModel = appMenuModel(commands, editor.commands);
const checkDrawnCommands = drawnCommandsCheck(editor.commands);

let nativeMenu: NativeMenu | null = null;

function render(): void {
  if (!doc || !ui) return;
  checkDrawnCommands();
  app.dataset['sidebar'] = settings.sidebarOpen ? 'open' : 'closed';
  sidebar.setOpen(settings.sidebarOpen);
  titleBar.update({
    name: doc.name,
    dirty: doc.dirty,
    view: ui.view,
    tracking: ui.tracking,
    hasRedlines: ui.hasRedlines,
    sidebarOpen: settings.sidebarOpen,
  });
  nativeMenu?.update({
    view: ui.view,
    tracking: ui.tracking,
    hasRedlines: ui.hasRedlines,
    sidebarOpen: settings.sidebarOpen,
    lightTheme: settings.lightTheme,
    darkTheme: settings.darkTheme,
    rotateIcon: settings.rotateIcon,
    checkForUpdates: settings.checkForUpdates,
    activeCommands: ui.activeCommands,
    enabledCommands: ui.enabledCommands,
  });
}

// The settings are the same in every window, but for the file sidebar, which each shows or hides.
watchSettings(() => {
  settings = { ...loadSettings(), sidebarOpen: settings.sidebarOpen };
  showTheme();
  updates?.setAutomatic(settings.checkForUpdates);
  render();
});

if (isTauri) {
  // The window's close button, File › Close and ⌘W all ask about unsaved edits first.
  void getCurrentWindow().onCloseRequested(async (event) => {
    if (!(await controller.confirmDiscard())) event.preventDefault();
  });
  // The document first: drawing the menu bar takes a moment, and a new window shouldn't wait for it
  // to show what it was opened for.
  const start = await host.windowStart().catch((error: unknown) => {
    console.error('Could not ask what this window was opened for', error);
    return { path: null, line: null };
  });
  if (start.path === null) {
    await controller.create();
  } else {
    await controller.open(start.path);
    if (start.line !== null && controller.state.path === start.path) {
      editor.scrollToLine(start.line);
    }
  }
  // A file the app gives this window, from its command line or the system (`open -a Redlines
  // plan.md`), opens in place of the empty document. Should the window have been used by the time
  // it opens, it takes a window of its own.
  await host
    .listenForFiles(
      (path) =>
        controller.untouched
          ? controller.open(path).then(() => editor.focus())
          : openInNewWindow(path),
      // A file the window may not use is told to the person, not dropped. This comes after the
      // files that could be opened, which clear the notice that is showing.
      (path, reason) => controller.couldNotOpen(path, reason),
    )
    .catch((error: unknown) => console.error('Could not listen for files to open', error));
  windows?.ready();
  const about = await loadAbout().catch((error: unknown) => {
    console.error('Could not read the build tag for About Redlines', error);
    return null;
  });
  nativeMenu = await createNativeMenu(menuModel, about).catch((error: unknown) => {
    // Without a menu bar, the shortcuts still work as key presses.
    console.error('Could not build the menu bar', error);
    installShortcuts(menuModel);
    return null;
  });
  if (nativeMenu) {
    await followFocus(getCurrentWebviewWindow(), nativeMenu).catch((error: unknown) => {
      console.error('Could not follow the window’s focus', error);
    });
  }
  // The app keeps a copy of this setting, to know it at the next start, before there is a window.
  reportIconRotation(settings.rotateIcon);
  updates?.setAutomatic(settings.checkForUpdates);
} else {
  installShortcuts(menuModel);
  await controller.open('sample.md');
}

// Pick up files added to the folder while the app was in the background.
window.addEventListener('focus', () => void sidebar.refresh());
render();
editor.focus();
