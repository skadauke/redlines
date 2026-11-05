// A window of the desktop app: the title bar, the editor under it in a scroller, the file sidebar,
// the menu bar and the document controller, wired together, with the theme applied; and in the app,
// quiet updates, which notifications tell of. Each window runs all of this for its own document, and
// `windows.ts` is what they do together.

import { createEditor, type Author, type EditorTyping, type EditorUiState } from '@redlines/editor';
import { newestView } from '@redlines/format';
import { createReview } from '@redlines/review';
import { applyTheme } from '@redlines/themes';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { loadAbout } from './about.ts';
import { reportIconRotation } from './dock-icon.ts';
import { DocumentController, TRACKING_FOR_EVERYONE, type DocumentState } from './document.ts';
import { createHost, dirname, type ProjectRoot } from './host.ts';
import { appMenuModel, drawnCommandsCheck, type MenuCommands } from './menu-model.ts';
import { createNativeMenu, installShortcuts, type NativeMenu } from './native-menu.ts';
import { activatePlugins, DESKTOP_PLUGINS } from './plugins.ts';
import { holdWholeDocument, printPage } from './print.ts';
import { addRecent, dropRecent, stillThere } from './recent.ts';
import {
  authorFrom,
  currentAppearance,
  DEFAULT_SETTINGS,
  loadSettings,
  reopenLastDocument,
  themeFor,
  updateSettings,
  watchAppearance,
  watchSettings,
  type Settings,
} from './settings.ts';
import { applyTextSize, sizeIndex, stepSize, watchPinch } from './text-size.ts';
import { createNotice } from './ui/notice.ts';
import { createNotifications } from './ui/notifications.ts';
import { createSidebar } from './ui/sidebar.ts';
import { createTitleBar } from './ui/titlebar.ts';
import { presentUpdates } from './update-notifications.ts';
import { relaunch, tauriUpdateSource } from './update-source.ts';
import { createUpdates } from './updates.ts';
import { connectWindow, followFocus, restartAfterAsking, tauriWindowLink } from './windows.ts';
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

const gitAuthor: Author = await host.identity().catch(() => ({ handle: 'me', name: 'Me' }));
// Who makes the changes: the name from Preferences, or git's until it is set. One object, changed
// in place when Preferences change it, because the review plugin keeps hold of it.
const author: Author = { ...authorFrom(settings, gitAuthor) };
const setAuthor = (next: Author) => {
  for (const key of Object.keys(author)) delete (author as unknown as Record<string, unknown>)[key];
  Object.assign(author, next);
};

/** How typing helps, as Preferences say. */
const typingOf = (from: Settings): EditorTyping => ({
  spellCheck: from.spellCheck,
  smartPunctuation: from.smartPunctuation,
  closePairs: from.closePairs,
});

// The text size is the document's and its notes', not the title bar's (text-size.ts).
const showTextSize = () => applyTextSize(document.documentElement, settings.textSize);
showTextSize();

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
  typing: typingOf(settings),
  onChange: (text) => controller.markEdited(text),
  // An edit the editor refuses, such as a tracked change inside code, says why.
  onNotice: (message) => notice.flash(message),
  onUiState: (state) => {
    ui = state;
    render();
  },
});
ui = editor.getUiState();
// A menu lists its commands in the order they are registered, and Add Comment comes last in Format:
// a plugin with commands in that menu registers before this one.
const review = createReview(editor, { author });

const controller = new DocumentController(host, editor, (state) => {
  const renamed = state.name !== doc?.name;
  const moved = state.path !== doc?.path;
  doc = state;
  if (renamed && isTauri) void getCurrentWindow().setTitle(state.name);
  if (moved) void showInSidebar(state.path);
  // The next launch can reopen it (Preferences, General).
  if (moved && state.path) {
    const recent = addRecent(loadSettings().recent, state.path);
    updateSettings({ lastDocument: state.path, recent });
    settings = { ...settings, recent };
    void refreshRecent();
  }
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
  notice: (message) => notice.flash(message),
});

/** Shows the project of the document at `path` in the sidebar, once it is found. */
async function showInSidebar(path: string | null): Promise<void> {
  if (path === null) return sidebar.setDocument(null);
  const root = await host.projectRoot(path).catch((error: unknown): ProjectRoot => {
    console.warn('Could not find the project of the document', error);
    // Its own folder, as outside a repository.
    return { folder: dirname(path), isRepo: false, tooBroad: false };
  });
  // Another document may have opened meanwhile.
  if (doc?.path === path) sidebar.setDocument({ path, root });
}

const toggleTracking = () => {
  const on = !editor.getUiState().tracking;
  editor.setTracking(on);
  // The notice that a file asking for tracking opened with has done its work: the choice is made.
  controller.dismissNotice(TRACKING_FOR_EVERYONE);
  // Every switch says so (design §5.4).
  notice.flash(on ? 'Track Changes is on' : 'Track Changes is off');
};

/**
 * Saves a change to the settings. Each window keeps its own file sidebar, whatever another saved:
 * what is stored for it is only what a new window starts with.
 */
const changeSettings = (change: Partial<Settings>) => {
  settings = {
    ...updateSettings(change),
    sidebarOpen: change.sidebarOpen ?? settings.sidebarOpen,
  };
};

const NO_CLIPBOARD_TEXT = 'The clipboard has no text to paste.';

const stepTextSize = (by: number) => {
  const textSize = stepSize(settings.textSize, by);
  const moved = sizeIndex(textSize) - sizeIndex(settings.textSize);
  if (textSize === settings.textSize) return 0;
  changeSettings({ textSize });
  showTextSize();
  // The lines are taller or shorter now, and the editor must measure them again.
  editor.view.requestMeasure();
  // The steps taken, which at an end of the ladder are fewer than asked.
  return moved;
};
const resetTextSize = () => {
  changeSettings({ textSize: DEFAULT_SETTINGS.textSize });
  showTextSize();
  editor.view.requestMeasure();
};
// A pinch on the trackpad steps the same ladder.
watchPinch(window, stepTextSize);

const toggleSidebar = () => {
  changeSettings({ sidebarOpen: !settings.sidebarOpen });
  render();
};

// The review bar (@redlines/review). These menu items are enabled only for documents with redlines.
const openReview = () => review.openBar();

const titleBar = createTitleBar(element('#titlebar'), {
  setView: (mode) => editor.setViewMode(mode),
  toggleTracking,
  openReview,
  toggleSidebar,
  rename: async (newName) => {
    const from = controller.state.path;
    const renamed = await controller.rename(newName);
    // The file is under its new name in the list (it took the top when the document moved).
    if (from && controller.state.path !== from) {
      const recent = dropRecent(loadSettings().recent, from);
      settings = { ...settings, recent: updateSettings({ recent }).recent };
      void refreshRecent();
    }
    return renamed;
  },
  documentFacts: () => ({
    newestText: newestView(editor.getDoc()).text,
    savedAt: controller.savedAt,
  }),
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
    restart: () =>
      windows
        ? restartAfterAsking(windows, () => updates.install(), relaunch)
        : Promise.resolve(false),
  });

const commands: MenuCommands = {
  create: () => void openInNewWindow(),
  open: () => void controller.openWithDialog().then(() => editor.focus()),
  // Opens as Open does: in this window while it is untouched, else in a new one.
  openRecent: (path) =>
    controller.untouched
      ? void controller.open(path).then(() => editor.focus())
      : void openInNewWindow(path),
  clearRecent: () => {
    settings = { ...settings, recent: updateSettings({ recent: [] }).recent };
    void refreshRecent();
  },
  save: () => void controller.save(),
  saveAs: () => void controller.saveAs(),
  // A document with no file has no name to change: Save As asks for one.
  rename: () => (doc?.path ? titleBar.beginRename() : void controller.saveAs()),
  revealInFinder: () => {
    if (doc?.path) {
      void host.reveal(doc.path).catch((error: unknown) => {
        console.error('Could not show the file in Finder', error);
        notice.flash('Couldn’t show the file in Finder.');
      });
    }
  },
  print: () =>
    void printPage({
      print: () => host.print(),
      hold: () => holdWholeDocument(editor.view),
      back: [editor.view.dom, element('#titlebar')],
    }).catch((error: unknown) => {
      console.error('Could not print', error);
      notice.flash('Couldn’t print.');
    }),
  quit: () => void windows?.quit(),
  setView: (mode) => editor.setViewMode(mode),
  toggleSidebar,
  toggleTracking,
  openReview,
  pastePlain: () =>
    void host.readClipboardText().then(
      (text) => (text ? editor.pastePlain(text) : notice.flash(NO_CLIPBOARD_TEXT)),
      () => notice.flash(NO_CLIPBOARD_TEXT),
    ),
  biggerText: () => stepTextSize(1),
  smallerText: () => stepTextSize(-1),
  actualTextSize: resetTextSize,
  nextChange: () => review.next(),
  previousChange: () => review.previous(),
  checkForUpdates: () => void updateNotifications?.checkForUpdates(),
  openPreferences: () => {
    if (isTauri) void invoke('open_preferences');
    else notice.flash('Preferences are in the app.');
  },
  showAgentLogs: () => {
    if (!isTauri) return notice.flash('The agent logs are in the app.');
    invoke('agent_logs_open').catch((error: unknown) => {
      console.error('Could not open the agent logs', error);
      notice.flash('Couldn’t open the agent logs.');
    });
  },
};

// The plugins register their commands here, before the menus are drawn from the registry. The
// first plugin, find, needs nothing from the host: the app's host doesn't yet fit the plugin API's.
activatePlugins(editor, {}, DESKTOP_PLUGINS, {
  author,
  notice: (message) => notice.flash(message),
});

// The menus show the commands registered by now: plugins register theirs above this line.
const menuModel = appMenuModel(commands, editor.commands);
const checkDrawnCommands = drawnCommandsCheck(editor.commands);

let nativeMenu: NativeMenu | null = null;

/** The files of Open Recent that are still there: the list the menu shows. */
let recentShown: readonly string[] = [];

/**
 * Looks again at which of the recent files are still there, and redraws the menu if that changed.
 * Called when the list changes, anywhere, and when the window gets focus.
 */
async function refreshRecent(): Promise<void> {
  const asked = settings.recent;
  const found = await stillThere(asked, (path) => host.exists(path));
  // The list changed while it was being looked at: the change asked again.
  if (asked.join('\n') !== settings.recent.join('\n')) return;
  if (found.join('\n') === recentShown.join('\n')) return;
  recentShown = found;
  render();
}

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
    hasFile: doc.path !== null,
    recent: recentShown,
    activeCommands: ui.activeCommands,
    enabledCommands: ui.enabledCommands,
  });
}

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
  // A launch with no file to open: the document that was open last, when Preferences ask for it.
  // New is always empty, so this is for the first window alone.
  if (controller.untouched && getCurrentWindow().label === 'main') {
    await reopenLastDocument(settings, async (path) => {
      await host.read(path);
      await controller.open(path);
    });
  }
  // A new document, with Track Changes on if Preferences ask for it.
  if (controller.untouched && settings.trackNewDocuments) editor.setTracking(true);
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

// Preferences are a window of their own. Their changes arrive here as they are made, and so do
// those made in another window of the app. The file sidebar is each window's own.
watchSettings((changed) => {
  settings = { ...changed, sidebarOpen: settings.sidebarOpen };
  showTheme();
  showTextSize();
  editor.view.requestMeasure();
  editor.setTyping(typingOf(settings));
  const next = authorFrom(settings, gitAuthor);
  if (next.handle !== author.handle || next.name !== author.name) {
    setAuthor(next);
    editor.setAuthor({ ...author });
  }
  updates?.setAutomatic(settings.checkForUpdates);
  // Another window may have opened a file.
  void refreshRecent();
  render();
});

// Debug only (print-check.ts): the first thing a person would try, without the dialog.
if (import.meta.env.DEV && import.meta.env['VITE_PRINT_CHECK']) {
  void import('./print-check.ts').then(({ runPrintCheck }) => runPrintCheck(editor));
}

// Pick up files added to the project while the app was in the background.
window.addEventListener('focus', () => {
  void sidebar.refresh();
  void refreshRecent();
});
void refreshRecent();
render();
editor.focus();
