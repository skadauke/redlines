// The desktop app: the title bar, the editor under it in a scroller, the file sidebar, the menu bar
// and the document controller, wired together, with the theme applied.

import { createEditor, type Author, type EditorUiState } from '@redlines/editor';
import { createReview } from '@redlines/review';
import { applyTheme, type Appearance, type ThemeName } from '@redlines/themes';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { reportIconRotation } from './dock-icon.ts';
import { DocumentController, TRACKING_FOR_EVERYONE, type DocumentState } from './document.ts';
import { createHost } from './host.ts';
import {
  createNativeMenu,
  installShortcuts,
  type MenuCommands,
  type MenuState,
} from './native-menu.ts';
import {
  currentAppearance,
  loadSettings,
  saveSettings,
  themeFor,
  watchAppearance,
} from './settings.ts';
import { createNotice } from './ui/notice.ts';
import { createSidebar } from './ui/sidebar.ts';
import { createTitleBar } from './ui/titlebar.ts';
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

let doc: DocumentState | null = null;
let ui: EditorUiState | null = null;

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
  render();
});

const sidebar = createSidebar(app, {
  host,
  openFile: (path) => void controller.open(path).then(() => editor.focus()),
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

const closeWindow = async () => {
  if (await controller.confirmDiscard()) await getCurrentWindow().destroy();
};

const commands: MenuCommands = {
  create: () => void controller.create().then(() => editor.focus()),
  open: () => void controller.openWithDialog().then(() => editor.focus()),
  save: () => void controller.save(),
  saveAs: () => void controller.saveAs(),
  quit: () => void closeWindow(),
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
};

let nativeMenu: { update(state: MenuState): void } | null = null;

function render(): void {
  if (!doc || !ui) return;
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
  });
}

if (isTauri) {
  // The window's close button, File › Close and ⌘W all ask about unsaved edits first.
  void getCurrentWindow().onCloseRequested(async (event) => {
    if (!(await controller.confirmDiscard())) event.preventDefault();
  });
  nativeMenu = await createNativeMenu(commands).catch((error: unknown) => {
    // Without a menu bar, the shortcuts still work as key presses.
    console.error('Could not build the menu bar', error);
    installShortcuts(commands);
    return null;
  });
  // The app keeps a copy of this setting, to know it at the next start, before there is a window.
  reportIconRotation(settings.rotateIcon);
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
  installShortcuts(commands);
  await controller.open('sample.md');
}

// Pick up files added to the folder while the app was in the background.
window.addEventListener('focus', () => void sidebar.refresh());
render();
editor.focus();
