// A window of the desktop app: the title bar, the editor under it in a scroller, the file sidebar,
// the menu bar and the document controller, wired together, with the theme applied; in the app,
// quiet updates, which notifications tell of; and the agents a comment can ask, whose runs act on
// this window's document. Each window runs all of this for its own document, and `windows.ts` is
// what they do together; the updates are the app's, and the window shows them (`updates.ts`).

import { createAcpProvider } from '@redlines/agent-acp';
import { createClaudeProvider } from '@redlines/agent-claude';
import { createCodexProvider } from '@redlines/agent-codex';
import {
  attachPicker,
  blockedMessage,
  createLiveLines,
  createMacAgents,
  createRuns,
  renderCommentText,
} from '@redlines/agents';
import { codeLanguages } from '@redlines/code';
import { createEditor, type Author, type EditorTyping, type EditorUiState } from '@redlines/editor';
import { newestView } from '@redlines/format';
import { createFormatting } from '@redlines/formatting';
import { createPalette, pageClipboard } from '@redlines/palette';
import { createTables } from '@redlines/tables';
import type { AgentInfo } from '@redlines/plugin-api';
import { createReview, manifest as reviewManifest } from '@redlines/review';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { watchAgentsChanged } from './agent-changes.ts';
import { acpAgents, createProcesses, createRelay, homeAccess, homeReach } from './agent-host.ts';
import { openCitation, opensFromLink } from './citation-open.ts';
import { reportIconRotation } from './dock-icon.ts';
import { createDocumentData, createShelf, memoryStorage } from './document-data.ts';
import { DocumentController, TRACKING_FOR_EVERYONE, type DocumentState } from './document.ts';
import { createHost, dirname, NOT_A_DOCUMENT, type Host, type ProjectRoot } from './host.ts';
import { localImageUrl } from './images.ts';
import {
  appMenuModel,
  drawnCommandsCheck,
  type MenuCommands,
  type MenuState,
} from './menu-model.ts';
import {
  createNativeMenu,
  installPlusKeys,
  installShortcuts,
  type NativeMenu,
} from './native-menu.ts';
import { activatePlugins, DESKTOP_PLUGINS } from './plugins.ts';
import { requestPane } from './preferences/pane-request.ts';
import { holdWholeDocument, printPage } from './print.ts';
import { addRecent, dropRecent, shownRecent } from './recent.ts';
import { placeBack, readingPlace, topRoom, type ReadingPlace } from './reading-place.ts';
import {
  authorFrom,
  meetPeopleInSettings,
  loadSettings,
  reopenLastDocument,
  updateSettings,
  watchSettings,
  type Settings,
} from './settings.ts';
import { followScrollbar } from './scrollbar.ts';
import { checkSpellingAgain, systemSpelling } from './system-spelling.ts';
import { applyTextSize } from './text-size.ts';
import { followTextZoom } from './text-zoom.ts';
import { historyIsDocuments, routeHistory, type HistoryRoute } from './undo-target.ts';
import { createNotice } from './ui/notice.ts';
import { createNotifications } from './ui/notifications.ts';
import { createSidebar, SIDEBAR_COVERS } from './ui/sidebar.ts';
import { createTitleBar, TOOLTIP_MS } from './ui/titlebar.ts';
import { relaunch, tauriUpdateLink } from './update-link.ts';
import { presentUpdates } from './update-notifications.ts';
import { windowUpdates } from './updates.ts';
import {
  applyZoom,
  followZoom,
  initialZoom,
  nextZoom,
  tauriZoomLink,
  type PageZoom,
} from './zoom.ts';
import { setAppearance } from './appearance-command.ts';
import { followTheme } from './window-theme.ts';
import { connectWindow, followFocus, restartAfterAsking, tauriWindowLink } from './windows.ts';
import '@redlines/themes/fonts.css';
import '@redlines/themes/tokens.css';
import './zoom.css';
import './styles.css';

const isTauri = '__TAURI_INTERNALS__' in window;
const host = createHost();

function element(selector: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(selector);
  if (!found) throw new Error(`index.html has no ${selector}`);
  return found;
}

// The theme first, so the window never shows unstyled, and the window itself in its appearance;
// both follow every window's changes to them, and the system's (window-theme.ts).
let settings = loadSettings();
followTheme(document.documentElement, settings, { ...(isTauri ? { setAppearance } : {}) });
// The window zoom the app handed this page, before anything draws (zoom.ts); 1 in a browser.
applyZoom(document.documentElement, initialZoom() ?? 1);

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
const scroller = element('.rl-scroller');
const notice = createNotice(main);
const notifications = createNotifications(app);

let doc: DocumentState | null = null;
/** Tells the runs that the document changed; set once they are made. */
let runsSawChange = () => {};
let ui: EditorUiState | null = null;
/** The window zoom: the app's, followed in the app (zoom.ts), and none in a browser. */
let zoom: PageZoom | null = null;
/** What the menu bar was last told, which ⌘+ typed as "+" asks whether its row is enabled. */
let menuState: MenuState | null = null;
/** Whether comments being written wait a moment to be kept (`ReviewOptions.onDraftsPending`). */
let draftsPending = false;

// The app's other windows, which this one asks about unsaved edits, and is asked by.
const windows = isTauri ? await connectWindow(tauriWindowLink(), askAboutThisWindow) : null;

/**
 * Before the app quits: waits for an agent's edits being written, then, if this window has unsaved
 * edits, comes to the front and asks.
 */
function askAboutThisWindow(): Promise<boolean> {
  // The comments being written are kept now, rather than in a moment the app may not have.
  review.saveDrafts();
  return controller.confirmQuit(async () => {
    const here = getCurrentWindow();
    await here.unminimize();
    await here.setFocus();
  });
}

const openInNewWindow = (path?: string, line?: number) =>
  host.openWindow(path, line).catch((error: unknown) => {
    console.error('Could not open a new window', error);
    notice.flash('Couldn’t open a new window.');
  });

/**
 * The folder whose images the preview loads: the sidebar's folder for the document, once the app
 * has allowed the page to load from it (`showImages`). Null until then, and in a browser tab.
 */
let imageFolder: string | null = null;
/** The path of the document the preview is drawing, which its relative images are found from. */
let imageDocument: string | null = null;

/** The system's beep, as the Mac makes it for a key or an item that does nothing. */
function beep(): void {
  if (isTauri) void invoke('beep').catch(() => {});
}

/**
 * Whether the app can hand the document's file to another app by a drag: the Mac's, which draws the
 * title bar's document icon for it (src-tauri/src/drag.rs). A plain browser has no file to hand
 * over, and Windows and Linux no drag to hand it by.
 */
const canDragFile = isTauri && /Macintosh/.test(navigator.userAgent);

/**
 * Starts dragging the document's file out of the window, once the title bar's document icon has
 * been dragged: the app does it, as a native title bar's proxy icon would, and a drop in Finder,
 * Mail or Terminal hands over the file.
 */
function dragFile(): void {
  const path = doc?.path;
  if (!path || !canDragFile) return;
  invoke<boolean>('start_file_drag', { path }).catch((error: unknown) => {
    console.error('Could not drag the file', error);
  });
}

const editor = createEditor(element('#editor'), {
  doc: '',
  author,
  // Track Changes is the document's, as Word's is: turning it on or off is written to its ledger
  // (format §5.6), and the file is edited until it is saved.
  saveTracking: true,
  people: settings.people,
  // The first time a document shows someone, they are recorded with their color, for every window.
  onNewPeople: (handles) => {
    settings = { ...settings, people: meetPeopleInSettings(handles, settings.people) };
    editor.setPeople(settings.people);
  },
  codeLanguages,
  // ⌘-click on a link opens its address (http, https or mailto: the editor lets no other through)
  // in the default browser or mail app, which only the app can run; a browser tab opens it itself.
  openLink: (address) => {
    if (!isTauri) {
      window.open(address, '_blank', 'noopener,noreferrer');
      return;
    }
    invoke('open_link', { url: address }).catch((error: unknown) => {
      console.error('Could not open the link', error);
      notice.flash('Couldn’t open the link.');
    });
  },
  resolveImage: (src) => {
    const path = imageDocument;
    if (!path || imageFolder === null) return null;
    return localImageUrl(src, path, imageFolder, (file) => host.imageUrl(file));
  },
  typing: typingOf(settings),
  // A word ended with Return gets the system's correction, which only the app can ask for; a plain
  // browser has none. Asked only while Preferences' spell check is on (the editor sees to that).
  correctWord: isTauri
    ? (word, before) => invoke<string | null>('correct_word', { word, before })
    : undefined,
  showLineBreakMarks: settings.showLineBreakMarks,
  markupView: settings.markupView,
  viewKeys: { simple: '⌥⌘2', redlines: '⌥⌘3' },
  onChange: (text) => {
    controller.markEdited(text);
    // A run whose comment is gone, taken back with Undo or however, stops.
    runsSawChange();
  },
  // An edit the editor refuses, such as a tracked change inside code, says why.
  onNotice: (message) => notice.flash(message),
  // An Undo or Redo with nothing to take: the Mac's beep.
  onNothingToUndo: () => beep(),
  onUiState: (state) => {
    ui = state;
    // The markup view chosen last is kept for every window, for what each opens next.
    if (state.markupView !== settings.markupView) changeSettings({ markupView: state.markupView });
    render();
  },
});
ui = editor.getUiState();
// The agents on this Mac, run through their own programs; a plain browser has none. Claude and
// Codex have providers of their own, and the agents the person added, which the app keeps (Preferences
// doesn't offer adding one for now), are each run through the Agent Client Protocol provider.
const processes = createProcesses();
const agents = createMacAgents(
  isTauri ? [createClaudeProvider(processes), createCodexProvider(processes)] : [],
  createRelay(),
  isTauri
    ? {
        more: async () =>
          (await acpAgents.list()).map(({ id, name, program, args, bridge }) =>
            createAcpProvider(processes, {
              id,
              name,
              command: program,
              args,
              ...(bridge === undefined ? {} : { bridge }),
            }),
          ),
      }
    : {},
);
// An agent added or removed by another window, or one that Preferences has updated, signed in or
// found changed, is looked for again at the next comment box.
if (isTauri) acpAgents.watch(() => agents.forget());
watchAgentsChanged(() => agents.forget());
/**
 * The agents found when a comment box last opened, for its @ picker, which can't wait for them.
 * `agents` keeps what detection found for a minute, so a box opening doesn't run it each time.
 */
let knownAgents: AgentInfo[] = [];
const lookForAgents = () =>
  agents.list().then(
    (found) => (knownAgents = found),
    (error: unknown) => console.warn('Could not look for agents', error),
  );

// What plugins keep of each document, such as the comments being written, which outlast the window:
// in the page's storage in the app, and in memory in a plain browser, as its saves are. It is bound
// to this window's document by its real path, with any link followed, so that the file is the same
// whichever way it was opened, and it moves with the document on Rename and Save As.
const documentData = createDocumentData(
  createShelf(isTauri ? localStorage : memoryStorage()),
  (path) => (isTauri ? invoke<string>('real_path', { path }) : Promise.resolve(path)),
);

// The formatting commands are the Format and Paragraph menus. They register before the review
// interface, so that its Add Comment comes last in Format.
createFormatting(editor, { author, notice: (message) => notice.flash(message) });
createTables(editor);

// A menu lists its commands in the order they are registered, and Add Comment comes last in Format:
// a plugin with commands in that menu registers before this one.
const review = createReview(editor, {
  author,
  showResolved: settings.showResolved,
  // The comments being written are kept for their document, and come back when it opens again.
  documentData: documentData.forPlugin(reviewManifest),
  // While they wait to be written, quitting asks this window, which writes them first.
  onDraftsPending: (pending) => {
    draftsPending = pending;
    reportWindow();
  },
  // The only way a run starts: a comment posted in this window's box.
  onPosted: (comment) => runs.posted(comment),
  attachToField: (field) => {
    void lookForAgents();
    return attachPicker(field, {
      getParsed: () => editor.getParsed(),
      getMet: () => settings.people,
      me: author.handle,
      agents: () => knownAgents,
    });
  },
  extras: {
    renderText: (entry, person) =>
      renderCommentText(entry, person, {
        documentPath: () => controller.state.path,
        projectFolder: async (path) => {
          const root = await projectOf(path);
          // As for images: a repository too broad to read all of is not the place to look.
          return root.tooBroad ? dirname(path) : root.folder;
        },
        realPath: (path) => invoke<string>('real_path', { path }),
        // A document opens in a window, and an image or a PDF in its default app; any other
        // file, which could be a program or an archive, opens nothing, and says so.
        opensIn: opensFromLink,
        open: (path, line) =>
          void openCitation(
            {
              allowDocument: (file) => host.allowDocument(file),
              openInNewWindow,
              notice: (message) => notice.flash(message),
            },
            path,
            line,
          ),
        openDefault: (path, root) => {
          host.openDefault(path, root).catch((error: unknown) => {
            notice.flash(error instanceof Error ? error.message : String(error));
          });
        },
        cannotOpen: () => notice.flash(NOT_A_DOCUMENT),
      }),
    // A run's live line: never in the file.
    footer: (thread) => liveLines.footer(thread),
    // A resolved thread's note stays while its run asks, so that Show has a note to show.
    keepShown: (thread) => liveLines.keepsShown(thread),
  },
});

// The formatting palette: hidden while writing, it opens from a handle at the bottom center and on
// right-click, in place of WebKit's own menu. Its items are commands of the registry, so it
// registers after the plugins whose commands it shows, and, like them, before the menus are drawn.
// A spelling suggestion comes from the system's checker (spelling.rs); a plain page has none.
const palette = createPalette(editor, {
  container: main,
  tooltipMs: TOOLTIP_MS,
  notice: (message) => notice.flash(message),
  clipboard: pageClipboard(editor, () => host.readClipboardText()),
  ...(isTauri
    ? {
        spelling: systemSpelling({
          enabled: () => settings.spellCheck,
          learned: () => checkSpellingAgain(editor.view.contentDOM),
        }),
      }
    : {}),
});

const documentHost: Host = {
  ...host,
  // Drafts discarded to open another document are forgotten, not kept for the next time it opens.
  askToDiscardDraft: async () => {
    const discard = await host.askToDiscardDraft();
    if (discard) review.discardDrafts();
    return discard;
  },
};

// A run's document is the editor's: only another document in the editor stops it
// (`documentReplaced`).
const controller = new DocumentController(documentHost, editor, showDocument, {
  // A run's tools act on this document: while one is live, a file opens in a new window.
  isRunLive: () => runs.isLive(),
  // A comment or reply with text in its box would go with the document: ask first.
  hasDraft: () => review.hasDraft(),
  // The editor draws a new document before `showDocument` hears of it: until then its images
  // would be looked for in the folder of the document it replaces.
  onLoading: (path) => {
    if (path === imageDocument) return;
    imageDocument = path;
    imageFolder = null;
  },
  // A change on disk that is nothing but the work of this person's agents is a step to undo.
  author: () => author.handle,
  // Save for a document with no file opens its dialog in the folder Preferences name, if any.
  newDocumentFolder: () => loadSettings().newDocumentFolder,
});

/** The document the runs were last told of. */
let shownGeneration = controller.generation;

/**
 * Puts the keyboard in the document, unless it is in the editor already, as in a comment box that
 * a draft came back in.
 */
const focusEditor = () => {
  if (!editor.view.dom.contains(document.activeElement)) editor.focus();
};

function showDocument(state: DocumentState): void {
  if (controller.generation !== shownGeneration) {
    shownGeneration = controller.generation;
    // Another document took this one's place: the old one's runs have nothing to act on.
    runs.documentReplaced();
  }
  const renamed = state.name !== doc?.name;
  const moved = state.path !== doc?.path;
  doc = state;
  imageDocument = state.path;
  if (renamed && isTauri) void getCurrentWindow().setTitle(state.name);
  if (moved) void showInSidebar(state.path);
  if (moved) void showImages(state.path);
  // The next launch can reopen it (Preferences, General).
  if (moved && state.path) {
    const recent = addRecent(loadSettings().recent, state.path);
    updateSettings({ lastDocument: state.path, recent });
    settings = { ...settings, recent };
    void refreshRecent();
  }
  notice.setStanding(state.notice, () => controller.dismissNotice());
  // The plugins' data is the document's: another document, or the same at another path.
  documentData.follow(controller.generation, state.path);
  reportWindow();
  render();
}

/**
 * Tells the app what this window holds. A window writing an agent's edits counts as having edits,
 * so that quitting asks it, and waits; so does one with comments waiting to be kept, which it keeps
 * before it answers, with no question for a clean document.
 */
function reportWindow(): void {
  if (doc) windows?.reportDocument(doc.path, doc.dirty || doc.writing || draftsPending);
}

const sidebar = createSidebar(app, {
  host,
  openFile: (path, { newWindow }) => {
    if (newWindow) void openInNewWindow(path);
    else {
      void openHere(path).then(() => {
        // A sidebar that covers the page has done its work once a document is chosen.
        if (matchMedia(SIDEBAR_COVERS).matches && settings.sidebarOpen && doc?.path === path) {
          changeSettings({ sidebarOpen: false });
          render();
        }
      });
    }
  },
  isRunLive: () => runs.isLive(),
  notice: (message) => notice.flash(message),
});

/**
 * The project of the document at `path` (spec: Scope): its repository, or else its own folder.
 * The sidebar shows it, and it is the folder an agent may read, so the two are always the same.
 */
const projectOf = (path: string) => host.projectRoot(path);

/**
 * Lets the preview load the images in the project of the document at `path`: its sidebar folder,
 * which the app allows the page to load from. The images are drawn again once that is so.
 */
async function showImages(path: string | null): Promise<void> {
  imageFolder = null;
  editor.refreshImages();
  if (path === null) return;
  try {
    const [root, allowed] = await Promise.all([projectOf(path), host.allowImages(path)]);
    // Another file may have opened meanwhile.
    if (!allowed || doc?.path !== path) return;
    imageFolder = root.tooBroad ? dirname(path) : root.folder;
    editor.refreshImages();
  } catch (error) {
    console.warn('Could not allow the images of the document', error);
  }
}

/** Shows the project of the document at `path` in the sidebar, once it is found. */
async function showInSidebar(path: string | null): Promise<void> {
  if (path === null) return sidebar.setDocument(null);
  const root = await projectOf(path).catch((error: unknown): ProjectRoot => {
    console.warn('Could not find the project of the document', error);
    // Its own folder, as outside a repository.
    return { folder: dirname(path), isRepo: false, tooBroad: false };
  });
  // Another file may have opened meanwhile.
  if (doc?.path === path) sidebar.setDocument({ path, root });
}

/** Opens the document at `path` in the editor, in place of the one it shows. */
async function openHere(path: string): Promise<void> {
  await controller.open(path);
  focusEditor();
}

const consentKey = (agent: string, folder: string) => `${agent}|${folder}`;

const runs = createRuns({
  agents,
  author,
  document: {
    path: () => controller.state.path,
    generation: () => controller.generation,
    read: () => editor.getDoc(),
    parsed: () => editor.getParsed(),
    save: () => controller.save(),
    applyAgentEdit: (next, step) => controller.applyAgentEdit(next, step),
  },
  // A project that can't be found fails the run on its line, rather than guessing a folder.
  projectRoot: projectOf,
  // What an agent may read at This folder and my home folder, and what macOS is holding back of
  // it; a browser has none.
  ...(isTauri ? { homeReach, homeAccess } : {}),
  settings: {
    defaultScope: () => settings.agentScope,
    consent: (agent, folder) => loadSettings().consent[consentKey(agent, folder)],
    setConsent: (agent, folder, answer) =>
      changeSettings({
        consent: {
          ...loadSettings().consent,
          [consentKey(agent, folder)]: answer,
        },
      }),
  },
  // An agent that couldn't read a file inside what it may read: which file, why and what to do.
  onBlocked: (notice) => {
    const { text, action } = blockedMessage(notice);
    notifications.show({
      key: `blocked ${notice.thread} ${notice.cause} ${notice.place ?? ''}`,
      text,
      ...(action
        ? {
            action: {
              label: action.label,
              run: (card) => {
                if (action.do === 'log') showAgentLogs();
                else openFilesAndFoldersSettings();
                card.close();
              },
            },
          }
        : {}),
    });
  },
  // The agent may have changed files the sidebar lists.
  onEnded: () => void sidebar.refresh(),
});
runsSawChange = () => runs.documentChanged();
// Each thread's live line, drawn again in its note whenever it changes. A failure the person
// can't see, or a question waiting where nobody sees it, in a thread scrolled away, is also told of
// in the lower-right corner.
const liveLines = createLiveLines({
  runs,
  author,
  getParsed: () => editor.getParsed(),
  getMet: () => settings.people,
  refresh: (thread) => review.refreshThread(thread),
  showLog: () => showAgentLogs(),
  openPreferences: () => openAgentPreferences(),
  showThread: (thread) => review.showThread(thread),
  focusDocument: () => editor.focus(),
  notify: ({ key, text, action }) =>
    notifications.show({
      key,
      text,
      ...(action
        ? {
            action: {
              label: action.label,
              run: (card) => {
                // Show that showed nothing leaves the card, which goes when the question does.
                if (action.run() !== false) card.close();
              },
            },
          }
        : {}),
    }),
});

/** Opens System Settings where the person lets Redlines read a folder macOS protects. */
function openFilesAndFoldersSettings(): void {
  if (!isTauri) return notice.flash('System Settings are on the Mac.');
  invoke('open_files_and_folders_settings').catch((error: unknown) => {
    console.error('Could not open System Settings', error);
    notice.flash('Couldn’t open System Settings.');
  });
}

/**
 * Opens Preferences on the Agents pane, where an agent is updated or signed in: what a failed
 * run's line offers when the agent is too old or signed out. The window can't update or sign in an
 * agent itself; it asks for the pane, and Preferences shows it.
 */
function openAgentPreferences(): void {
  if (!isTauri) return notice.flash('Preferences are in the app.');
  requestPane('agents');
  invoke('open_preferences').catch((error: unknown) => {
    console.error('Could not open Preferences', error);
    notice.flash('Couldn’t open Preferences.');
  });
}

/** Opens the folder of agent logs in Finder (Help ▸ Show Agent Logs, and a failed run's line). */
function showAgentLogs(): void {
  if (!isTauri) return notice.flash('The agent logs are in the app.');
  invoke('agent_logs_open').catch((error: unknown) => {
    console.error('Could not open the agent logs', error);
    notice.flash('Couldn’t open the agent logs.');
  });
}

const toggleTracking = () => {
  const on = !editor.getUiState().tracking;
  // A file that can't take the setting says why, and Track Changes stays as it was.
  if (!editor.setTracking(on)) return;
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

/** "125%", for the notices that say a level. */
const percent = (level: number) => `${Math.round(level * 100)}%`;

/** Zooms every window `by` steps of the ladder, or back to 100% with `to`, and says so. */
const changeZoom = (change: { by: number } | { to: number }) => {
  if (!zoom) return;
  const from = zoom.level();
  const level = nextZoom(from, change);
  if (level === from) return;
  void zoom.ask(level).catch((error: unknown) => {
    console.error('Could not zoom the windows', error);
    notice.flash('Couldn’t zoom the windows.');
  });
  notice.flash(`Zoom ${percent(level)}`);
  // The menu follows at once, so that a key pressed again at an end finds its row disabled.
  render();
};

// The text size: the keys, a pinch on the trackpad and another window's change, each keeping the
// reading place (text-zoom.ts). The pinch holds the rail until the fingers lift.
const textZoom = followTextZoom(window, {
  view: editor.view,
  scroller,
  root: document.documentElement,
  size: () => settings.textSize,
  save: (textSize) => changeSettings({ textSize }),
  holdRail: (held) => review.holdRail(held),
  say: (text) => notice.flash(text),
});

const toggleSidebar = () => {
  changeSettings({ sidebarOpen: !settings.sidebarOpen });
  render();
};

// The review bar (@redlines/review). These menu items are enabled only for documents with redlines.
const openReview = () => review.openBar();
// Resolved comments in the rail: a choice kept with the settings, like the text size, so that the
// windows and the next launch follow it.
const toggleResolved = () => {
  changeSettings({ showResolved: !settings.showResolved });
  review.setShowResolved(settings.showResolved);
  render();
};

/**
 * File › Rename, and a double-click on the file name: a document with a file gets a field for its
 * name, and an Untitled one, which has no name to change, Save As, which asks for one.
 */
function renameDocument(): void {
  if (doc?.path) titleBar.beginRename();
  else void controller.saveAs();
}

const titleBar = createTitleBar(element('#titlebar'), {
  setView: (mode) => editor.setViewMode(mode),
  toggleTracking,
  openReview,
  toggleResolved,
  toggleSidebar,
  renameDocument: () => renameDocument(),
  dragFile,
  scrollPage: (dx, dy) => scroller.scrollBy({ left: dx, top: dy, behavior: 'instant' }),
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

// The title bar floats over the top of the scroller, and the text passes under it (styles.css): the
// editor keeps what it scrolls to clear of it, as of the find bar, and the bar stops short of a
// classic scrollbar.
editor.addExtension(topRoom(() => titleBar.room()));
followScrollbar(scroller, main);

// Updates (#34), in the app only: checked soon after it starts and every few hours, unless turned
// off, and downloaded in the background. Restarting into the new version asks each window about its
// unsaved edits first, as quitting does, and the new version reopens the documents. The app checks,
// downloads and installs for all the windows (#122); this one shows what it says, and asks.
const updates = isTauri ? windowUpdates(tauriUpdateLink()) : null;
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
  open: () => void controller.openWithDialog().then(focusEditor),
  // Opens as Open does: in this window while it is untouched, else in a new one.
  openRecent: (path) => (controller.untouched ? void openHere(path) : void openInNewWindow(path)),
  clearRecent: () => {
    settings = { ...settings, recent: updateSettings({ recent: [] }).recent };
    void refreshRecent();
    // Nor does the next launch let the windows use them again, but for the documents still open.
    void host.forgetDocuments().catch((error: unknown) => {
      console.error('Could not forget the recent documents', error);
    });
  },
  save: () => void controller.save(),
  saveAs: () => void controller.saveAs(),
  rename: renameDocument,
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
  toggleResolved,
  undo: () => undoOrRedo(false),
  redo: () => undoOrRedo(true),
  pastePlain: () =>
    void host.readClipboardText().then(
      (text) => (text ? editor.pastePlain(text) : notice.flash(NO_CLIPBOARD_TEXT)),
      () => notice.flash(NO_CLIPBOARD_TEXT),
    ),
  zoomIn: () => changeZoom({ by: 1 }),
  zoomOut: () => changeZoom({ by: -1 }),
  actualSize: () => changeZoom({ to: 1 }),
  biggerText: () => textZoom.step(1),
  smallerText: () => textZoom.step(-1),
  actualTextSize: () => textZoom.reset(),
  nextChange: () => review.next(),
  previousChange: () => review.previous(),
  checkForUpdates: () => void updateNotifications?.checkForUpdates(),
  openAbout: () => {
    if (isTauri) void invoke('open_about');
    else notice.flash('About is in the app.');
  },
  openPreferences: () => {
    if (isTauri) void invoke('open_preferences');
    else notice.flash('Preferences are in the app.');
  },
  showAgentLogs,
};

// The plugins register their commands here, before the menus are drawn from the registry. Of the
// app's host they get only what fits the plugin API's yet: each its own document data, if it asks.
activatePlugins(editor, {}, DESKTOP_PLUGINS, {
  author,
  notice: (message) => notice.flash(message),
  documentData: (manifest) => documentData.forPlugin(manifest),
});

// The menus show the commands registered by now: plugins register theirs above this line.
const menuModel = appMenuModel(commands, editor.commands, { browser: !isTauri });
const checkDrawnCommands = drawnCommandsCheck(editor.commands);

let nativeMenu: NativeMenu | null = null;

/** The documents of Open Recent that are still there: the list the menu shows. */
let recentShown: readonly string[] = [];

/**
 * Looks again at which of the recent documents are still there, and redraws the menu if that
 * changed. Called when the list changes, anywhere, and when the window gets focus.
 */
async function refreshRecent(): Promise<void> {
  const asked = settings.recent;
  const found = await shownRecent(asked, (path) => host.exists(path));
  // The list changed while it was being looked at: the change asked again.
  if (asked.join('\n') !== settings.recent.join('\n')) return;
  if (found.join('\n') === recentShown.join('\n')) return;
  recentShown = found;
  render();
}

/**
 * The Edit menu's Undo and Redo (`undo-target.ts`). The keys themselves never get here from the
 * document or from a field the page handles: the page sees them first.
 */
const historyRoute: HistoryRoute = {
  editor: {
    dom: editor.view.dom,
    undo: () => editor.undo(),
    redo: () => editor.redo(),
  },
  active: () => document.activeElement,
  windowHasKeys: () => document.hasFocus(),
  askApp: isTauri ? (redo) => invoke<boolean>('undo_in_field', { redo }) : null,
  pageUndo: (redo) => void document.execCommand(redo ? 'redo' : 'undo'),
  beep,
  fail: (error) => console.error('Could not undo in the field', error),
};
const historyIsTheDocuments = () =>
  historyIsDocuments(editor.view.dom, document.activeElement, document.hasFocus());
const undoOrRedo = (redo: boolean) => routeHistory(historyRoute, redo);

function render(): void {
  if (!doc || !ui) return;
  checkDrawnCommands();
  app.dataset['sidebar'] = settings.sidebarOpen ? 'open' : 'closed';
  sidebar.setOpen(settings.sidebarOpen);
  titleBar.update({
    name: doc.name,
    dirty: doc.dirty,
    fileDraggable: doc.path !== null && canDragFile,
    view: ui.view,
    tracking: ui.tracking,
    hasRedlines: ui.hasRedlines,
    sidebarOpen: settings.sidebarOpen,
    showResolved: settings.showResolved,
  });
  menuState = {
    view: ui.view,
    tracking: ui.tracking,
    hasRedlines: ui.hasRedlines,
    sidebarOpen: settings.sidebarOpen,
    showResolved: settings.showResolved,
    zoom: zoom?.level() ?? null,
    textSize: settings.textSize,
    hasFile: doc.path !== null,
    recent: recentShown,
    activeCommands: ui.activeCommands,
    enabledCommands: ui.enabledCommands,
    commandTitles: ui.commandTitles,
    undo: ui.undo,
    redo: ui.redo,
    canUndo: ui.canUndo,
    canRedo: ui.canRedo,
    inDocument: historyIsTheDocuments(),
  };
  nativeMenu?.update(menuState);
}

if (isTauri) {
  // The window's close button, File › Close and ⌘W all ask about unsaved edits first.
  void getCurrentWindow().onCloseRequested(async (event) => {
    // The comments being written outlast the window: they are kept now.
    review.saveDrafts();
    if (!(await controller.confirmDiscard())) event.preventDefault();
    // Closing the window stops its runs: nothing after this acts on its document.
    else runs.stopAll();
  });
  // The document first: drawing the menu bar takes a moment, and a new window shouldn't wait for it
  // to show what it was opened for.
  const start = await host.windowStart().catch((error: unknown) => {
    console.error('Could not ask what this window was opened for', error);
    return { path: null, line: null, text: null };
  });
  if (start.path === null) {
    // A window opened for text starts with an Untitled document that holds it, unsaved.
    await (start.text ? controller.createWith(start.text) : controller.create());
  } else {
    await controller.open(start.path);
    if (start.line !== null && controller.state.path === start.path) {
      editor.scrollToLine(start.line);
      // The line asked for stays in view: drafts that come back don't scroll away from it.
      review.keepPlace();
    }
  }
  // The window zoom is the app's: this page follows it, and asks it for another (zoom.ts). Before
  // WebKit's zoom changes it takes its reading place and puts away what was placed for the old
  // layout; once `--rl-zoom` is the new level it puts the place back (reading-place.ts).
  let kept: ReadingPlace | null = null;
  zoom = await followZoom(tauriZoomLink(), {
    root: document.documentElement,
    win: window,
    level: initialZoom() ?? 1,
    settings: () => settings.zoom,
    save: (level) => changeSettings({ zoom: level }),
    before: () => {
      kept = readingPlace(editor.view, scroller);
      titleBar.closeMenus();
      review.closePopovers();
      palette.hide();
    },
    after: (level, from) => {
      if (kept) {
        editor.view.dispatch({ effects: placeBack(editor.view, scroller, kept, from / level) });
        kept = null;
      }
      render();
    },
  }).catch((error: unknown) => {
    console.error('Could not follow the window zoom', error);
    return null;
  });
  // The zoom rows were disabled until now.
  render();
  // ⌘+ typed as "+" reaches Zoom In through the page: the menu bar's keys have no plus key.
  if (/Macintosh/.test(navigator.userAgent)) installPlusKeys(menuModel, () => menuState);
  // A file the app gives this window, from its command line, the system (`open -a Redlines
  // plan.md`) or a drop on a window, opens in place of the empty document. Should the window have
  // been used by the time it opens, it takes a window of its own. The app gives documents alone.
  await host
    .listenForFiles(
      (path) => (controller.untouched ? openHere(path) : openInNewWindow(path)),
      // A file the window may not use, or that isn't a document, is told to the person, not
      // dropped. This comes after the files that could be opened, which clear the notice that is
      // showing.
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
  // A new document, empty or opened for text, with Track Changes on if Preferences ask for it: the
  // person's own preference, not the document's, so nothing is written to it. A window opened for
  // text isn't untouched (it holds the text, unsaved), but it is as new as any.
  if (controller.state.path === null && settings.trackNewDocuments) {
    editor.setTracking(true, { inFile: false });
  }
  windows?.ready();
  nativeMenu = await createNativeMenu(menuModel).catch((error: unknown) => {
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
  // A text size another window saved takes the reading place before it is applied.
  textZoom.follow(settings.textSize);
  review.setShowResolved(settings.showResolved);
  editor.view.requestMeasure();
  editor.setTyping(typingOf(settings));
  editor.setShowLineBreakMarks(settings.showLineBreakMarks);
  // The markup view another window chose reaches this one's next switches, not the view it shows.
  editor.setMarkupView(settings.markupView);
  editor.setPeople(settings.people);
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

// Debug only (block-check.ts): block editing's keys and inputs, in WebKit.
if (import.meta.env.DEV && import.meta.env['VITE_BLOCK_CHECK']) {
  void import('./block-check.ts').then(({ runBlockCheck }) => runBlockCheck(editor));
}

// Debug only (table-check.ts): tables' layout, pointer, keys and typing, in WebKit.
if (import.meta.env.DEV && import.meta.env['VITE_TABLE_CHECK']) {
  void import('./table-check.ts').then(({ runTableCheck }) => runTableCheck(editor));
}

// Debug only (simple-check.ts): the click on a change bar and Simple's drawing, in WebKit.
if (import.meta.env.DEV && import.meta.env['VITE_SIMPLE_CHECK']) {
  void import('./simple-check.ts').then(({ runSimpleCheck }) => runSimpleCheck(editor));
}

// Debug only (struck-check.ts): deleted and replaced blocks, the caret over them and their cards, in
// WebKit.
if (import.meta.env.DEV && import.meta.env['VITE_STRUCK_CHECK']) {
  void import('./struck-check.ts').then(({ runStruckCheck }) => runStruckCheck(editor));
}

// Debug only (zoom-check.ts): the column, the rail and the window zoom, in WebKit.
if (import.meta.env.DEV && import.meta.env['VITE_ZOOM_CHECK']) {
  void import('./zoom-check.ts').then(({ runZoomCheck }) =>
    runZoomCheck({
      editor,
      scroller,
      zoom,
      textZoom,
      textSize: {
        get: () => settings.textSize,
        save: (size) => changeSettings({ textSize: size }),
      },
      surfaces: {
        review,
        setSidebar: (open) => {
          changeSettings({ sidebarOpen: open });
          render();
        },
        notice,
        notifications,
      },
      mode: String(import.meta.env['VITE_ZOOM_CHECK']),
    }),
  );
}

// Pick up files added to the project while the app was in the background.
window.addEventListener('focus', () => {
  void sidebar.refresh();
  void refreshRecent();
});
// Undo and Redo are the document's or a field's, by where the keys are: the menu follows them,
// also when they go to another window, Preferences.
for (const type of ['focus', 'blur', 'focusin', 'focusout']) window.addEventListener(type, render);
void refreshRecent();
render();
focusEditor();
