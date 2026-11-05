// The desktop app: the title bar, the editor under it in a scroller, the file sidebar, the menu bar
// and the document controller, wired together, with the theme applied; and in the app, quiet
// updates, which notifications tell of.

import { createEditor, type Author, type EditorUiState } from '@redlines/editor';
import { newestView } from '@redlines/format';
import { createReview } from '@redlines/review';
import { applyTheme, type Appearance, type ThemeName } from '@redlines/themes';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { loadAbout } from './about.ts';
import { reportIconRotation } from './dock-icon.ts';
import { DocumentController, TRACKING_FOR_EVERYONE, type DocumentState } from './document.ts';
import { createHost } from './host.ts';
import {
  appMenuModel,
  drawnCommandsCheck,
  type MenuCommands,
  type MenuState,
} from './menu-model.ts';
import { createNativeMenu, installShortcuts } from './native-menu.ts';
import {
  currentAppearance,
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  themeFor,
  watchAppearance,
} from './settings.ts';
import { applyTextSize, stepSize, watchPinch } from './text-size.ts';
import { createNotice } from './ui/notice.ts';
import { createNotifications } from './ui/notifications.ts';
import { createSidebar } from './ui/sidebar.ts';
import { createTitleBar } from './ui/titlebar.ts';
import { presentUpdates } from './update-notifications.ts';
import { relaunch, tauriUpdateSource } from './update-source.ts';
import { createUpdates } from './updates.ts';
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

// The text size is the document's and its notes', not the title bar's (text-size.ts).
const showTextSize = () => applyTextSize(document.documentElement, settings.textSize);
showTextSize();

const author: Author = await host.identity().catch(() => ({ handle: 'me', name: 'Me' }));

const app = element('.rl-app');
const main = element('.rl-main');
const notice = createNotice(main);
const notifications = createNotifications(app);

let doc: DocumentState | null = null;
let ui: EditorUiState | null = null;
/** When the document was last saved in this window, if it was. */
let savedAt: Date | null = null;

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
  if (moved) {
    savedAt = null;
    sidebar.setDocument(state.path);
  }
  notice.setStanding(state.notice, () => controller.dismissNotice());
  render();
});

const sidebar = createSidebar(app, {
  host,
  openFile: (path) => void controller.open(path).then(() => editor.focus()),
});

const noteSaved = (saved: Promise<unknown>) =>
  void saved.then(() => {
    if (!controller.state.dirty) savedAt = new Date();
  });

const toggleTracking = () => {
  const on = !editor.getUiState().tracking;
  editor.setTracking(on);
  // The notice that a file asking for tracking opened with has done its work: the choice is made.
  controller.dismissNotice(TRACKING_FOR_EVERYONE);
  // Every switch says so (design §5.4).
  notice.flash(on ? 'Track Changes is on' : 'Track Changes is off');
};

const stepTextSize = (by: number) => {
  const textSize = stepSize(settings.textSize, by);
  if (textSize === settings.textSize) return;
  settings = { ...settings, textSize };
  saveSettings(settings);
  showTextSize();
  // The lines are taller or shorter now, and the editor must measure them again.
  editor.view.requestMeasure();
};
const resetTextSize = () => {
  settings = { ...settings, textSize: DEFAULT_SETTINGS.textSize };
  saveSettings(settings);
  showTextSize();
  editor.view.requestMeasure();
};
// A pinch on the trackpad steps the same ladder.
watchPinch(window, stepTextSize);

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
  documentFacts: () => ({ newestText: newestView(editor.getDoc()).text, savedAt }),
});

const closeWindow = async () => {
  if (await controller.confirmDiscard()) await getCurrentWindow().destroy();
};

// Updates (#34), in the app only: checked soon after it starts and every few hours, unless turned
// off, and downloaded in the background. Restarting into the new version asks about unsaved edits
// first, and the new version reopens the document.
const updates = isTauri ? createUpdates(tauriUpdateSource()) : null;
const updateNotifications =
  updates &&
  presentUpdates({
    updates,
    notifications,
    restart: async () => {
      if (!(await controller.confirmDiscard())) return false;
      await updates.install();
      await relaunch(controller.state.path);
      return true;
    },
  });

const commands: MenuCommands = {
  create: () => void controller.create().then(() => editor.focus()),
  open: () => void controller.openWithDialog().then(() => editor.focus()),
  save: () => noteSaved(controller.save()),
  saveAs: () => noteSaved(controller.saveAs()),
  quit: () => void closeWindow(),
  setView: (mode) => editor.setViewMode(mode),
  toggleSidebar,
  toggleTracking,
  openReview,
  pastePlain: () => void editor.pastePlain(),
  biggerText: () => stepTextSize(1),
  smallerText: () => stepTextSize(-1),
  actualTextSize: resetTextSize,
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

let nativeMenu: { update(state: MenuState): void } | null = null;

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

if (isTauri) {
  // The window's close button, File › Close and ⌘W all ask about unsaved edits first.
  void getCurrentWindow().onCloseRequested(async (event) => {
    if (!(await controller.confirmDiscard())) event.preventDefault();
  });
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
  // The app keeps a copy of this setting, to know it at the next start, before there is a window.
  reportIconRotation(settings.rotateIcon);
  updates?.setAutomatic(settings.checkForUpdates);
  await controller.create();
  // A file given on the command line, or by the system (`open -a Redlines plan.md`), opens in
  // place of the empty document, and later ones after asking about unsaved edits.
  await host
    .listenForFiles(
      (path) => controller.open(path).then(() => editor.focus()),
      // A file the window may not use is told to the person, not dropped. This comes after the
      // files that could be opened, which clear the notice that is showing.
      (path, reason) => controller.couldNotOpen(path, reason),
    )
    .catch((error: unknown) => console.error('Could not listen for files to open', error));
} else {
  installShortcuts(menuModel);
  await controller.open('sample.md');
}

// Pick up files added to the folder while the app was in the background.
window.addEventListener('focus', () => void sidebar.refresh());
render();
editor.focus();
