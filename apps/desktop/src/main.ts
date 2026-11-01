// The desktop app: the title bar, the editor under it in a scroller, the file sidebar, the menu bar
// and the document controller, wired together, with the theme applied.

import { createEditor, type Author, type EditorUiState } from '@redlines/editor';
import { applyTheme, type Appearance, type ThemeName } from '@redlines/themes';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { DocumentController, type DocumentState } from './document.ts';
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
  onUiState: (state) => {
    ui = state;
    render();
  },
});
ui = editor.getUiState();

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
  // Every switch says so (design §5.4).
  notice.flash(on ? 'Track Changes is on' : 'Track Changes is off');
};

const toggleSidebar = () => {
  settings = { ...settings, sidebarOpen: !settings.sidebarOpen };
  saveSettings(settings);
  render();
};

// The review bar arrives with @redlines/review (plan Tasks G and H). These menu items are
// enabled only for documents with redlines.
const openReview = () => {};

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
  nextChange: openReview,
  previousChange: openReview,
  setTheme: (which: Appearance, theme: ThemeName) => {
    settings = { ...settings, [which === 'dark' ? 'darkTheme' : 'lightTheme']: theme };
    saveSettings(settings);
    showTheme();
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
  await controller.create();
} else {
  installShortcuts(commands);
  await controller.open('sample.md');
}

// Pick up files added to the folder while the app was in the background.
window.addEventListener('focus', () => void sidebar.refresh());
render();
editor.focus();
