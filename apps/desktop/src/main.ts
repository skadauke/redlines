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
  createAltDescriber,
  createAltText,
  createAsk,
  createLiveLines,
  createMacAgents,
  createRuns,
  defaultFirst,
  renderCommentText,
} from '@redlines/agents';
import { codeFileHighlight, codeLanguagesFor } from '@redlines/code';
import {
  createEditor,
  editorDocumentHtml,
  PLAIN_ONLY_TRACKING,
  type Author,
  type CropRect,
  type EditorTyping,
  type EditorUiState,
  type ImageSpot,
} from '@redlines/editor';
import { EditError, newestView } from '@redlines/format';
import { createEmoji } from '@redlines/emoji';
import { createFormatting } from '@redlines/formatting';
import { type AppCommand, createToolbar, pageClipboard } from '@redlines/toolbar';
import { createTables } from '@redlines/tables';
import type { AgentInfo, AgentScope } from '@redlines/plugin-api';
import { createReview, manifest as reviewManifest } from '@redlines/review';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { watchAgentsChanged } from './agent-changes.ts';
import {
  acpAgents,
  createProcesses,
  createRelay,
  homeAccess,
  homeReach,
  listedAcpAgents,
} from './agent-host.ts';
import { openCitation, opensFromLink } from './citation-open.ts';
import { reportIconRotation } from './dock-icon.ts';
import { createDocumentData, createShelf, memoryStorage } from './document-data.ts';
import { DocumentController, TRACKING_FOR_EVERYONE, type DocumentState } from './document.ts';
import { joinSession, type Session } from './session.ts';
import type { SyncState } from '@redlines/sync';
import { tauriSessionPorts } from './session-tauri.ts';
import { browserSessionPorts, tabsCanShare } from './session-browser.ts';
import { documentKind } from './file-names.ts';
import { createHost, dirname, NOT_A_DOCUMENT, type Host, type ProjectRoot } from './host.ts';
import { addImages, type ImageAdding } from './image-add.ts';
import { croppedFile } from './image-crop.ts';
import { createImageWatch } from './image-watch.ts';
import { createImageSizes } from './image-sizes.ts';
import { localImagePath, localImageUrl, relativeImagePath } from './images.ts';
import { exposeForJourneys } from './journey-hook.ts';
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
import { requestPane, type RequestedPane } from './preferences/pane-request.ts';
import { menuPaletteCommands } from './menu-palette.ts';
import { fillPrintPage, plainPageHtml, printPage } from './print.ts';
import { exportToWord } from './word-export.ts';
import { openWord } from './word-import.ts';
import { addRecent, dropRecent, shownRecent } from './recent.ts';
import { createShortcutBook, shortcutEntries } from './shortcut-book.ts';
import { publishShortcutEntries } from './shortcuts-published.ts';
import { displayKey } from './shortcuts.ts';
import { placeBack, readingPlace, topRoom, type ReadingPlace } from './reading-place.ts';
import {
  authorFrom,
  meetPeopleInSettings,
  loadSettings,
  reopenLastDocument,
  updateSettings,
  keepWindowOwn,
  watchSettings,
  type Settings,
} from './settings.ts';
import { followScrollbar } from './scrollbar.ts';
import { checkSpellingAgain, systemSpelling } from './system-spelling.ts';
import { applyTextSize } from './text-size.ts';
import { followTextZoom } from './text-zoom.ts';
import { historyIsDocuments, routeHistory, type HistoryRoute } from './undo-target.ts';
import { createNotice } from './ui/notice.ts';
import { createDevLog, tauriDevLogLink } from './dev-log.ts';
import { askDevNote } from './ui/dev-note.ts';
import { createUntrackedAnswers } from './untracked-answers.ts';
import { createUntrackedSheet } from './ui/untracked-sheet.ts';
import { createNotifications } from './ui/notifications.ts';
import { tooBroadNotice } from './project-notice.ts';
import { createRecovery, tauriRecoveryLink, type Recovery } from './recovery.ts';
import { simulateFailure, tauriCrashLink, watchCrashes, type CrashWatch } from './crash.ts';
import { createSidebar, SIDEBAR_COVERS } from './ui/sidebar.ts';
import { installTitleHints } from './ui/title-hints.ts';
import { createTitleBar, TOOLTIP_MS } from './ui/titlebar.ts';
import { createEditorWordCount } from './ui/word-count.ts';
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
import './print.css';
import './ui/title-hints.css';

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
const windowTheme = followTheme(document.documentElement, settings, {
  ...(isTauri ? { setAppearance } : {}),
});
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
// The dev log, in a build that isn't a release (dev-log.ts, #1205): what the person is told, and
// what the editor refuses, is kept in it, and so are errors and agent runs below.
const devLog = await createDevLog(isTauri ? tauriDevLogLink() : null);
if (devLog.enabled) {
  const flash = notice.flash.bind(notice);
  notice.flash = (text) => {
    devLog.log('alert', text);
    flash(text);
  };
  devLog.watchKeys(document);
}
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
const windows = isTauri
  ? await connectWindow(tauriWindowLink(), askAboutThisWindow, {
      // A window opened for text can't be asked about it in its first moments, and its text would go
      // with a quit or a close: the app holds both, and the person tries again.
      held: (what) =>
        notice.flash(
          what === 'quit'
            ? 'A window is still opening. Try again in a moment.'
            : 'This window is still opening. Try closing it again in a moment.',
        ),
    })
  : null;

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

/** This document's session, when it is in several windows (src/session.ts). */
let session: Session | null = null;
let sessionState: SyncState = 'synced';
let sessionPeers = 0;

/** Where the document stands among its windows, for the title bar; nothing for a document alone. */
function sessionStatus(): string | undefined {
  if (!session) return undefined;
  if (sessionState === 'offline') return 'Offline: your edits are kept';
  if (sessionState === 'ended') return 'No longer in the session';
  // Which window this is, as Word numbers the windows of one document ("Window 2").
  if (sessionPeers === 0) return undefined;
  return session.number === null ? `In ${sessionPeers + 1} windows` : `Window ${session.number}`;
}

/** Joins the session of the document at `path`, as its leader when there is none yet. */
async function beginSession(path: string, follow = false): Promise<void> {
  session = await joinSession(isTauri ? tauriSessionPorts() : browserSessionPorts(path), editor, {
    path,
    follow,
    person: { handle: author.handle, name: author.name },
    // The leader writes the file, for every window of the document.
    diskText: () => controller.diskText,
    save: async () => ((await controller.save()) ? controller.diskText : null),
    onSaved: (text) => controller.savedBySession(text),
    onLoaded: () => controller.sessionLoaded(),
    onLead: () => {
      controller.becameLeader();
      if (import.meta.env.DEV) document.documentElement.dataset['session'] = 'leading';
    },
    onState: (state) => {
      sessionState = state;
      render();
    },
    onPeers: (peers) => {
      sessionPeers = peers.length;
      render();
    },
    tracking: () => editor.getUiState().tracking,
    onTracking: (on) => {
      if (editor.getUiState().kind === 'plain-only' || on === editor.getUiState().tracking) return;
      setTrackingHere(on);
    },
    notice: (message) => notice.flash(message),
  });
  controller.enterSession(session);
  // Debug only (two-windows.html): what the journeys wait for.
  if (import.meta.env.DEV) {
    document.documentElement.dataset['session'] = session.leading ? 'leading' : 'following';
  }
}

/** Takes this window out of its session, as when it opens another document. */
async function endSession(): Promise<void> {
  const ended = session;
  session = null;
  sessionPeers = 0;
  sessionState = 'synced';
  controller.leaveSession();
  await ended?.stop();
}

/** Another window with this document's text, kept in step with this one's: a session. */
async function openAnotherWindow(): Promise<void> {
  const path = controller.state.path;
  if ((!isTauri && !tabsCanShare) || path === null) return;
  try {
    if (!session) await beginSession(path);
    await host.openWindow(path, undefined, undefined, true);
  } catch (error) {
    console.error('Could not open another window on this document', error);
    notice.flash('Couldn’t open another window on this document.');
  }
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
/** Settles when the project of the open document is found (`showImages`): what reads beside it waits. */
let projectKnown: Promise<void> = Promise.resolve();
let projectPending = false;
let projectFound: () => void = () => {};

/** From the moment a document starts loading until its project is found, what reads beside it waits. */
function awaitProject(): void {
  if (projectPending) return;
  projectPending = true;
  projectKnown = new Promise<void>((resolve) => {
    projectFound = () => {
      projectPending = false;
      resolve();
    };
  });
}
/** The path of the document the preview is drawing, which its relative images are found from. */
let imageDocument: string | null = null;

/** The file that an include names, as the open document writes it: null where it is none. */
function includedFile(path: string): string | null {
  const document = imageDocument;
  const project = imageFolder ?? (isTauri ? null : '');
  return document && project !== null ? localImagePath(path, document, project) : null;
}

/** The size of each local image file, read from its header once and kept until it is saved again. */
const imageSizes = createImageSizes((paths) => host.imageSizes(paths));
/** The images the preview has drawn, which are looked at again when the window regains the focus. */
const imageWatch = createImageWatch((paths) => host.imageStamps(paths));

/**
 * Opens the local image `src`, as the document writes it, in Preview. The app says no to any file
 * that isn't an image inside the project folder (`open_default`), and its line is shown.
 */
function openImageInPreview(src: string): void {
  const document = imageDocument;
  const root = imageFolder;
  const path = document && root !== null ? localImagePath(src, document, root) : null;
  if (path === null || root === null) {
    notice.flash('Couldn’t open the image.');
    return;
  }
  host.openDefault(path, root).catch((error: unknown) => {
    notice.flash(error instanceof Error ? error.message : String(error));
  });
}

/**
 * Crop… (`image.crop`, #624): writes the part `crop` of the local image `src` as a copy in the
 * project's folder for images, beside the others, and answers with the path the document links the
 * copy by. The original file stays. The app reads the picture (`image_for_crop`), under the rules
 * that hold what the page may load; a plain page in development reads it from its own memory.
 */
async function cropLocalImage(src: string, crop: CropRect): Promise<string> {
  const document = imageDocument;
  const root = imageFolder;
  const path = document && root !== null ? localImagePath(src, document, root) : null;
  if (document === null || path === null) {
    throw new Error('Only an image in this document’s folder can be cropped.');
  }
  let blob: Blob;
  if (isTauri) {
    const read = await invoke<{ mimeType: string; data: string }>('image_for_crop', { path }).catch(
      (error: unknown) => {
        throw new Error(error instanceof Error ? error.message : String(error), { cause: error });
      },
    );
    const bytes = Uint8Array.from(atob(read.data), (char) => char.charCodeAt(0));
    blob = new Blob([bytes], { type: read.mimeType });
  } else {
    const url = host.imageUrl(path);
    const response = url === null ? null : await fetch(url).catch(() => null);
    if (!response?.ok) throw new Error('The image file isn’t there.');
    blob = await response.blob();
  }
  const file = await croppedFile(blob, path, crop);
  const added = await host.addImages(document, loadSettings().imageFolderName, {
    kind: 'files',
    files: [file],
    pasted: false,
  });
  const copy = added.paths[0];
  if (copy === undefined) throw new Error(added.refused[0] ?? 'Couldn’t save the cropped image.');
  return copy;
}

/**
 * The person comes back from Preview, where an image was saved: the images whose files changed are
 * drawn again from the file, the others as they are, and the document's text is not touched.
 */
async function refreshSavedImages(): Promise<void> {
  // Drawn again first, so that the images the text shows now are the ones looked at.
  imageWatch.begin();
  editor.refreshImages();
  const changed = await imageWatch.check();
  if (changed.length) {
    imageSizes.forget(changed);
    editor.refreshImages();
  }
}

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

// Every command's key, with the person's own over its own (shortcuts.ts): the editor's keys, the
// menu bar and the browser's key handling all ask it. A change is kept in the settings.
const shortcutBook = createShortcutBook(settings.shortcuts, (shortcuts) => {
  settings = { ...settings, shortcuts: updateSettings({ shortcuts }).shortcuts };
});

// Crashes (#692): an error CodeMirror catches goes to the watch, which is made below, once there
// is a document to take the shape of.
let crashes: CrashWatch | null = null;
// Unsaved edits are kept in the app's support folder while there are any (recovery.ts, #693).
let recovery: Recovery | null = null;
const untrackedAnswers = createUntrackedAnswers();

const editor = createEditor(element('#editor'), {
  doc: '',
  commandKeys: shortcutBook.commandKeys,
  onError: (error) => {
    devLog.log('error', error instanceof Error ? error.message : String(error));
    crashes?.caught(error);
  },
  author,
  // An edit no mark can hold (front matter, typing in Raw) asks first, and is made untracked on a yes.
  askUntracked: createUntrackedSheet({
    container: app,
    path: () => controller.state.path,
    answers: untrackedAnswers,
    restoreFocus: () => editor.focus(),
  }),
  // Track Changes is the document's, as Word's is: the ledger records it when the file is saved for
  // another reason (format §5.6); turning it on or off never edits the file.
  saveTracking: true,
  people: settings.people,
  // The first time a document shows someone, they are recorded with their color, for every window.
  onNewPeople: (handles) => {
    settings = { ...settings, people: meetPeopleInSettings(handles, settings.people) };
    editor.setPeople(settings.people);
  },
  // A chunk's `{r}` in a .qmd or .Rmd file is read for its language.
  codeLanguages: codeLanguagesFor(() => {
    try {
      return controller.state.path;
    } catch {
      return null; // the controller is made after the editor
    }
  }),
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
    // The URL of an image saved again carries a version, so that it loads from the file again.
    return localImageUrl(src, path, imageFolder, (file) => {
      const url = host.imageUrl(file);
      return url === null ? null : imageWatch.url(file, url);
    });
  },
  // A copy embeds the bytes of the selection's local images, read as an agent's are: only inside the
  // document's folder, as PNG, JPEG, GIF or WebP, up to 3.5 MB; any other keeps its address.
  imageData: (src) => readImageForAgent(src).catch(() => null),
  imageSize: (src) => {
    const path = imageDocument;
    const file = path && imageFolder !== null ? localImagePath(src, path, imageFolder) : null;
    return file === null ? null : imageSizes.of(file);
  },
  // An include of a Quarto document (`{{< include _part.qmd >}}`) is read and opened as a file of
  // its own, as a local image is found: relative to the document, and only inside its project (a
  // browser tab's one folder in memory has no path of its own).
  includes: {
    read: async (path) => {
      // The project is found a moment after the document opens: an include asked for before that
      // waits for it, and isn't "not found" for being early (#1175).
      await projectKnown;
      const file = includedFile(path);
      if (file === null) return null;
      try {
        // The file plugin reads only the files the person opened or saved: the app allows this one
        // as it allows a document that the sidebar lists, if it is inside the document's project.
        await host.allowDocument(file);
        return await host.read(file);
      } catch {
        return null;
      }
    },
    open: (path) => {
      const file = includedFile(path);
      if (file === null) return;
      host
        .allowDocument(file)
        .then(() => controller.open(file))
        .catch((error: unknown) => {
          notice.flash(typeof error === 'string' ? error : 'Couldn’t open the included file.');
        });
    },
  },
  // A double-click on a local image opens its file in Preview, which the app does, and a browser
  // tab has no such app (the development page has a stand-in, for the journeys).
  openImage: isTauri || import.meta.env.DEV ? (src) => openImageInPreview(src) : undefined,
  // Crop… (#624): a cropped copy of the picture goes in the project's folder for images.
  cropImage: isTauri || import.meta.env.DEV ? (src, crop) => cropLocalImage(src, crop) : undefined,
  typing: typingOf(settings),
  // A word ended with Return gets the system's correction, which only the app can ask for; a plain
  // browser has none. Asked only while Preferences' spell check is on (the editor sees to that).
  correctWord: isTauri
    ? (word, before) => invoke<string | null>('correct_word', { word, before })
    : undefined,
  showLineBreakMarks: settings.showLineBreakMarks,
  markupView: settings.markupView,
  onChange: (text) => {
    controller.markEdited(text);
    crashes?.documentChanged();
    recovery?.changed();
    // Images the text shows now are watched once the typing pauses.
    imageWatch.settle();
    // A run whose comment is gone, taken back with Undo or however, stops.
    runsSawChange();
  },
  // An edit the editor refuses, such as a tracked change inside code, says why.
  onNotice: (message) => {
    devLog.log('refusal', message);
    notice.flash(message);
  },
  // Image files pasted into the document, or dropped on it where the page gets the drop itself (a
  // browser tab): saved in the project’s folder for images, and linked at the place they came to.
  onImageFiles: (files, spot, pasted) =>
    void addImages(imageAdding, spot, { kind: 'files', files, pasted }),
  // The pictures of a paste from Google Docs are at Google's addresses, which the page can't fetch:
  // the app does (`fetch_remote_image`, Google's image hosts only), and the bytes are saved like any
  // pasted picture. A plain browser has none, and the pictures stay linked.
  onFetchImage: isTauri
    ? async (url) => {
        try {
          const read = await invoke<{ mimeType: string; data: string }>('fetch_remote_image', {
            url,
          });
          const extension = {
            'image/jpeg': 'jpg',
            'image/png': 'png',
            'image/gif': 'gif',
            'image/webp': 'webp',
            'image/bmp': 'bmp',
          }[read.mimeType];
          if (!extension) return null;
          const bytes = Uint8Array.from(atob(read.data), (char) => char.charCodeAt(0));
          return { bytes, type: read.mimeType, extension };
        } catch {
          return null;
        }
      }
    : undefined,
  // An image dragged from the sidebar is the project's own file: linked by its path, not copied.
  projectImageLink: (dragged) => relativeImagePath(controller.state.path, dragged),
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
let webAsks = 0;
const webAccess = {
  web: () => loadSettings().webAccess,
  allowWeb: () => void updateSettings({ webAccess: true }),
  askWeb: (_agent: string, name: string, signal: AbortSignal) =>
    new Promise<'once' | 'always' | 'no'>((resolve) => {
      const done = (answer: 'once' | 'always' | 'no') => (card: { close(): void }) => {
        signal.removeEventListener('abort', stopped);
        card.close();
        resolve(answer);
      };
      // Its own key: another run's card doesn't take this one's place.
      const card = notifications.show({
        key: `web-access ${++webAsks}`,
        text: `${name} wants to use the web, to look something up or check a source.`,
        dismissLabel: 'Don’t Allow',
        onDismiss: () => done('no')(card),
        secondaryAction: { label: 'Allow Once', run: done('once') },
        action: { label: 'Allow Always', run: done('always') },
      });
      const stopped = () => done('no')(card);
      signal.addEventListener('abort', stopped, { once: true });
    }),
};
const agents =
  !isTauri && import.meta.env.DEV
    ? // A plain page has no agent programs: in development a scripted one stands in, which answers
      // an Ask with a canned answer, so that the bubble can be seen and checked in a browser.
      await import('./dev-agents.ts').then(({ createDevAgents }) => createDevAgents(webAccess))
    : createMacAgents(
        isTauri ? [createClaudeProvider(processes), createCodexProvider(processes)] : [],
        createRelay(),
        {
          // What the person named each agent in Preferences, read at every look.
          handles: () => loadSettings().agentHandles,
          // The model the person chose for each agent, read at every run.
          models: () => loadSettings().agentModels,
          // The web (#529): one switch for every agent. An agent that reaches for it with the
          // switch off asks here: Allow Once, or Allow Always, which turns the switch on.
          ...webAccess,
          ...(isTauri
            ? {
                more: async () =>
                  (await listedAcpAgents()).map(({ id, name, program, args, bridge, gateway }) =>
                    createAcpProvider(processes, {
                      id,
                      name,
                      command: program,
                      args,
                      ...(bridge === undefined ? {} : { bridge }),
                      ...(gateway === true ? { gateway: true as const } : {}),
                    }),
                  ),
              }
            : {}),
        },
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

/** The @ picker for a box that asks an agent: a comment's, and the question of an Ask. */
const attachAgentPicker = (field: HTMLTextAreaElement, agentsOnly = false) => {
  void lookForAgents();
  return attachPicker(field, {
    getParsed: () => editor.getParsed(),
    getMet: () => settings.people,
    me: author.handle,
    // The default agent comes first in the list (#528).
    agents: () => defaultFirst(knownAgents, loadSettings().defaultAgent),
    agentsOnly,
  });
};

// The formatting commands are the Insert, Format and Paragraph menus.
createFormatting(editor, { author, notice: (message) => notice.flash(message) });
createTables(editor, { tooltipMs: TOOLTIP_MS });
// Emoji shortcodes: the ones in a file are drawn as their emoji, and a colon with two letters lists
// matching emoji, as Preferences allow (asked each time).
createEmoji(editor, { enabled: () => settings.emojiSuggestions });

/**
 * What adding images to this window's document needs of it (image-add.ts): its file, which a
 * document with no file is saved to first, after asking; where the settings say images go, as
 * they are when the images arrive; and the host, which saves them (src-tauri/src/image_files.rs).
 */
const imageAdding: ImageAdding = {
  document: () => ({ path: controller.state.path, name: controller.state.name }),
  folderName: () => loadSettings().imageFolderName,
  saveFirst: async () => (await host.askToSaveForImage()) && (await controller.saveAs()),
  addImages: (path, folder, source) => host.addImages(path, folder, source),
  notice: (message) => notice.flash(message),
};

/**
 * Insert Image… (`image.insert`, #308): chooses image files in the system's panel and adds them as
 * a drop or a paste does, at the caret. The app's own command, not a plugin's, since the panel is.
 * A document with no file is saved first, before the panel: there is no folder for them until then.
 */
async function insertChosenImages(spot: ImageSpot): Promise<void> {
  try {
    if (controller.state.path === null && !(await imageAdding.saveFirst())) return spot.release();
    const source = await host.chooseImages();
    if (!source) return spot.release();
    await addImages(imageAdding, spot, source);
  } catch (error) {
    spot.release();
    notice.flash(error instanceof Error ? error.message : String(error));
  }
}

editor.commands.register([
  {
    id: 'image.insert',
    title: 'Image…',
    menu: 'insert',
    group: 'insert',
    run: () => {
      const spot = editor.imageSpot();
      if (!spot) return false;
      void insertChosenImages(spot);
      return true;
    },
  },
]);

// A menu lists its commands in the order they are registered: Add Comment and Ask… come last in the Review menu, after its own rows: its
// commands, and Ask… follows it (createAsk, below).
const review = createReview(editor, {
  author,
  // Why the toolbar's Accept or Reject was refused: a line that doesn't interrupt.
  notice: (message) => notice.flash(message),
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
  attachToField: attachAgentPicker,
  extras: {
    renderText: (entry, person) =>
      renderCommentText(entry, person, {
        documentPath: () => controller.state.path,
        projectFolder: async (path) => {
          const root = await projectOf(path);
          // As for images: a folder too broad to be a project is no place to look (#451).
          return root.tooBroad ? null : root.folder;
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

// The toolbar: shown only when summoned (the title bar's wrench, ⇧⌘P at the caret, a right-click at
// the pointer, in place of WebKit's own menu), or at the bottom of the window by preference
// (settings.toolbarAtBottom, below). Its items are commands of the registry, so it
// registers after the plugins whose commands it shows, and, like them, before the menus are drawn.
// A spelling suggestion comes from the system's checker (spelling.rs); a plain page has none.
const toolbar = createToolbar(editor, {
  container: main,
  // A right-click on a change, a comment or a highlight, and ⇧⌘P there, stack its review card above
  // the bar, as one widget (#1190).
  bubbleAt: (at) => review.bubbleAt(at),
  // The palette (type with the toolbar open) searches the app's own commands and settings beside
  // the registry's; a setting is a live control in its line (toolbar-commands.ts).
  appCommands: () => toolbarCommands(),
  // Ask has no way yet to start with a question typed: its box opens for the selection.
  askAbout: () => void editor.commands.run('ask.start'),
  // The wrench follows the toolbar, however it came to show or go.
  onChange: () => render(),
  // A bar at the pointer has the place's card in itself: hovering shows no other over the page.
  onFloating: (floating) => review.holdCards(floating),
  tooltipMs: TOOLTIP_MS,
  notice: (message) => notice.flash(message),
  // Paste is the Mac's own where the host has it (the clipboard's HTML is converted as ⌘V does it),
  // and the clipboard's text otherwise.
  clipboard: pageClipboard(
    editor,
    () => host.readClipboardText(),
    // A tab has none, and reads the clipboard in the click that asked, as it did.
    'pasteInDocument' in host
      ? () => host.pasteInDocument?.() ?? Promise.resolve(false)
      : undefined,
  ),
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
    awaitProject();
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

/** The file whose name the editor is colored by, with the extension that does it. */
let coloredAs: { path: string; remove: () => void } | null = null;

/**
 * Colors a text or code file as its name says (`codeFileHighlight`), and takes the colors off when
 * another file, or a Markdown one, takes its place or its name changes.
 */
function colorFile(path: string | null): void {
  const wanted = path !== null && documentKind(path) === 'plain-only' ? path : null;
  if (coloredAs?.path === wanted) return;
  coloredAs?.remove();
  coloredAs = wanted
    ? {
        path: wanted,
        remove: editor.addExtension(codeFileHighlight(wanted, editor.getDoc().length)),
      }
    : null;
}

function showDocument(state: DocumentState): void {
  colorFile(state.path);
  if (controller.generation !== shownGeneration) {
    shownGeneration = controller.generation;
    // Another document took this one's place: the old one's runs have nothing to act on, and its
    // words are not this one's.
    runs.documentReplaced();
    wordCount.refresh();
  }
  // Another document took this window: it leaves the document's session.
  if (session && state.path !== session.path) void endSession();
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
  recovery?.follow(state);
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
  showPlainOnly: () => settings.showPlainOnlyFiles,
  onResize: (sidebarWidth) => changeSettings({ sidebarWidth }),
  onClose: () => {
    changeSettings({ sidebarOpen: false });
    render();
  },
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
function showImages(path: string | null): Promise<void> {
  imageFolder = null;
  imageWatch.forget();
  imageSizes.forget();
  editor.refreshImages();
  if (path === null) {
    projectFound();
    return Promise.resolve();
  }
  awaitProject();
  return findProject(path).finally(() => projectFound());
}

async function findProject(path: string): Promise<void> {
  try {
    const [root, allowed] = await Promise.all([projectOf(path), host.allowImages(path)]);
    // Another file may have opened meanwhile.
    if (!allowed || doc?.path !== path) return;
    // The home folder and what is above it is no project: only the document's own folder loads
    // its images, which paste and crop write there (#451).
    imageFolder = root.tooBroad ? dirname(path) : root.folder;
    editor.refreshImages();
    imageWatch.settle();
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
  if (doc?.path !== path) return;
  sidebar.setDocument({ path, root });
  // The home folder, or a folder above it, is no project (#451): say why there is no folder.
  const notice = tooBroadNotice(root);
  if (notice) notifications.show(notice);
}

/** Opens the document at `path` in the editor, in place of the one it shows. */
async function openHere(path: string): Promise<void> {
  await controller.open(path);
  focusEditor();
}

const consentKey = (agent: string, folder: string) => `${agent}|${folder}`;

/** What an agent may read, as Preferences and the person's answers say: a run's and an Ask's. */
const agentSettings = {
  defaultScope: () => settings.agentScope,
  consent: (agent: string, folder: string) => loadSettings().consent[consentKey(agent, folder)],
  setConsent: (agent: string, folder: string, answer: AgentScope | 'no') =>
    changeSettings({
      consent: {
        ...loadSettings().consent,
        [consentKey(agent, folder)]: answer,
      },
    }),
};

const runs = createRuns({
  agents,
  author,
  document: {
    path: () => controller.state.path,
    plainOnly: () => editor.getUiState().kind === 'plain-only',
    generation: () => controller.generation,
    read: () => editor.getDoc(),
    parsed: () => editor.getParsed(),
    save: () => controller.save(),
    applyAgentEdit: (next, step, base) => controller.applyAgentEdit(next, step, base),
  },
  // A project that can't be found fails the run on its line, rather than guessing a folder.
  projectRoot: projectOf,
  // What an agent may read at This folder and my home folder, and what macOS is holding back of
  // it; a browser has none.
  ...(isTauri ? { homeReach, homeAccess } : {}),
  settings: agentSettings,
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
// Each change of an agent run's line is a line of the dev log: which agent, and how it stands.
if (devLog.enabled) {
  runs.subscribe((thread) => {
    const line = runs.line(thread);
    devLog.log(
      'agent',
      line === null
        ? `thread ${thread} line cleared`
        : `thread ${thread} ${line.agentName} ${line.kind}${line.kind === 'failed' ? `: ${line.message}` : ''}`,
    );
  });
}
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

// Ask: a question about the selection, answered in a bubble beside it, which writes nothing to the
// file. It runs the agents as a comment's run does, with the tools that read; registered here, after
// the review interface, it follows Add Comment and Highlight in the Format menu.
const ask = createAsk(editor, {
  agents,
  author,
  document: {
    path: () => controller.state.path,
    generation: () => controller.generation,
    read: () => editor.getDoc(),
  },
  projectRoot: projectOf,
  settings: agentSettings,
  // An Ask that names no agent goes to the one the person chose in Preferences (#528).
  defaultAgent: () => loadSettings().defaultAgent ?? undefined,
  // The model the bubble's list starts at: Preferences' choice for the agent (#530, #507).
  chosenModel: (agent) => loadSettings().agentModels[agent],
  notice: (message) => notice.flash(message),
  // Only agents: an @ of a person means nothing in a question to an agent.
  attachToField: (field) => attachAgentPicker(field, true),
  showThread: (thread) => review.showThread(thread),
  // Where the rail shows its notes, it lays the bubble out among them, level with the selection,
  // and the notes make room for it; elsewhere (narrow window, Clean, no comments) Ask hangs the
  // bubble by the selection itself.
  pinToRail: (el, anchor, lost) => review.pinToRail(el, anchor, lost),
  showLog: () => showAgentLogs(),
  openPreferences: () => openAgentPreferences(),
  // A long answer worth keeping or editing: an Untitled document in a new window. Ask keeps the
  // bubble until the window is open, and says so in a notice when it can't be (a browser tab is
  // refused text on purpose); this logs why.
  openInNewWindow: (text) =>
    host.openWindow(undefined, undefined, text).catch((error: unknown) => {
      console.error('Could not open a new window', error);
      throw error;
    }),
});

// Alt Text (#553): the Image menu's Alt Text… opens a bubble by the image, with a field for the
// description. It writes nothing until Save, and then as any edit (tracked with Track Changes on).
createAltText(editor, {
  notice: (message) => notice.flash(message),
  generation: () => controller.generation,
  // "Describe with <agent>": the agent is shown the one picture and nothing else (agent.ts).
  describer: createAltDescriber({
    agents,
    author,
    document: { path: () => controller.state.path, generation: () => controller.generation },
    readImage: readImageForAgent,
  }),
});

/**
 * The bytes of the local picture `src` for Export to Word: only one inside the document's project
 * folder (the one its sidebar shows) (`localImagePath`), read by the app under the rules that hold what the page may load
 * (`image_for_crop`). Undefined for any other address or a file the app won't give.
 */
async function readImageForWord(src: string): Promise<Uint8Array | undefined> {
  const document = imageDocument;
  const root = imageFolder ?? (isTauri ? null : '');
  if (/^[a-z][a-z0-9+.-]*:/i.test(src) || document === null || root === null) return undefined;
  let relative: string;
  try {
    relative = decodeURIComponent(src.replace(/[?#].*$/s, ''));
  } catch {
    return undefined;
  }
  const path = localImagePath(relative, document, root);
  if (path === null) return undefined;
  try {
    if (isTauri) {
      const read = await invoke<{ mimeType: string; data: string }>('image_for_crop', { path });
      return Uint8Array.from(atob(read.data), (char) => char.charCodeAt(0));
    }
    const url = host.imageUrl(path);
    const response = url === null ? null : await fetch(url);
    return response?.ok ? new Uint8Array(await response.arrayBuffer()) : undefined;
  } catch {
    return undefined;
  }
}

/** The most bytes of a picture an agent is shown, as the app's own command holds it to. */
const AGENT_IMAGE_BYTES = 3_670_016;

/**
 * The picture `src` of the document, as the bytes an agent is shown (Alt Text, #553): only a local
 * image inside the document's project folder (`localImagePath`), read by the app, which holds it to
 * the folders its sidebars show, to PNG, JPEG, GIF and WebP, and to 3.5 MB (`image_for_agent`). A plain
 * page in development reads it from its own memory, with the same limits.
 */
async function readImageForAgent(src: string): Promise<{ mimeType: string; data: string }> {
  const document = imageDocument;
  const root = imageFolder;
  const path = document && root !== null ? localImagePath(src, document, root) : null;
  if (path === null) throw new Error('Only an image in this document’s folder can be described.');
  if (isTauri) {
    try {
      return await invoke<{ mimeType: string; data: string }>('image_for_agent', { path });
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : String(error), { cause: error });
    }
  }
  const url = host.imageUrl(path);
  if (url === null) throw new Error('The image file isn’t there.');
  const response = await fetch(url).catch(() => null);
  if (!response?.ok) throw new Error('The image file isn’t there.');
  const blob = await response.blob();
  if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(blob.type)) {
    throw new Error('Only PNG, JPEG, GIF and WebP pictures can be described.');
  }
  if (blob.size > AGENT_IMAGE_BYTES)
    throw new Error('That image is larger than 3.5 MB, which is too big to describe.');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let at = 0; at < bytes.length; at += 8192) {
    binary += String.fromCharCode(...bytes.subarray(at, at + 8192));
  }
  return { mimeType: blob.type, data: btoa(binary) };
}

/**
 * Opens Preferences on the Agents pane, where an agent is updated or signed in: what a failed
 * run's line offers when the agent is too old or signed out. The window can't update or sign in an
 * agent itself; it asks for the pane, and Preferences shows it.
 */
function openAgentPreferences(): void {
  openPreferencesPane('agents');
}

/** Opens Preferences on `pane` (the palette's lines for the panes, and the Agents pane above). */
function openPreferencesPane(pane: RequestedPane): void {
  if (!isTauri) return notice.flash('Preferences are in the app.');
  requestPane(pane);
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

/**
 * A window that opens a document finds the copy of its unsaved edits, if the page's process ended or
 * the app crashed meanwhile, and puts the edits back.
 */
async function restoreAfterCrash(): Promise<void> {
  const kept = await recovery?.find();
  if (!kept || !controller.restore(kept.path, kept.text)) return;
  await crashes?.recovered(() => {
    void controller.showSavedVersion();
    recovery?.discard();
  });
}

const toggleTracking = () => {
  // A text or code file has no Track Changes: its menu item and key are disabled; this says why.
  if (editor.getUiState().kind === 'plain-only') return notice.flash(PLAIN_ONLY_TRACKING);
  const on = !editor.getUiState().tracking;
  setTrackingHere(on);
  // Track Changes belongs to the document: every other window of it follows.
  void session?.shareTracking(on);
};

/** Turns Track Changes on or off in this window, and says so (design §5.4). */
const setTrackingHere = (on: boolean) => {
  // The switch writes nothing and edits nothing: the file records it when it is saved (format §5.6).
  editor.setTracking(on);
  // The notice that a file asking for tracking opened with has done its work: the choice is made.
  controller.dismissNotice(TRACKING_FOR_EVERYONE);
  // Every switch says so (design §5.4).
  notice.flash(on ? 'Track Changes is on' : 'Track Changes is off');
};

/** Review ▸ Accept All Changes and Stop Tracking: the selection's changes, or all, then Track Changes off. */
const acceptAllAndStopTracking = () => {
  // The count is the changes at the click: what the notification says it accepted.
  const count = editor.getUiState().acceptAllCount;
  try {
    if (!editor.acceptAllAndStopTracking()) return;
  } catch (error) {
    if (!(error instanceof EditError)) throw error;
    return notice.flash(error.message);
  }
  controller.dismissNotice(TRACKING_FOR_EVERYONE);
  const accepted = editor.getDoc();
  // Said with the count, and with the way back: one Undo gives the changes and Track Changes back.
  notifications.show({
    key: 'accept-all',
    text: `${count === 1 ? '1 change' : `${count} changes`} accepted. Track Changes is off.`,
    action: {
      label: 'Undo',
      run: (shown) => {
        // Only while nothing was written since: a later edit is Edit ▸ Undo's to take back.
        if (editor.getDoc() === accepted) editor.undo();
        else notice.flash('The document changed since. Use Edit ▸ Undo.');
        shown.close();
      },
    },
    timeout: 8000,
  });
};

/**
 * Saves a change to the settings. Each window keeps its own file sidebar and its own text size,
 * whatever another saved: what is stored for the sidebar is what a new window starts with, and the
 * stored text size is the Default text size of Preferences, which only Preferences changes (#557).
 */
const changeSettings = (change: Partial<Settings>) => {
  settings = keepWindowOwn(settings, updateSettings(change), change);
};

/** The panes of the Preferences window, by name, for the palette. */
const PREFERENCE_PANES: readonly (readonly [RequestedPane, string])[] = [
  ['general', 'General'],
  ['editor', 'Editor'],
  ['appearance', 'Appearance'],
  ['agents', 'Agents'],
  ['shortcuts', 'Shortcuts'],
];

/**
 * What the toolbar's palette offers besides the registry's commands: the app's own commands and
 * the settings that are no part of the page's editing, each with the control that fits it. They
 * read the live state when they are asked for, as the palette draws them again after each change.
 */
function toolbarCommands(): AppCommand[] {
  const ui = () => editor.getUiState();
  // The key the person's book gives a row now (none: null), as the palette draws it.
  const keyFor = (row: string, fixed: string) => {
    const key = shortcutBook.keyOf(row);
    return key ? displayKey(key) : shortcutBook.entries().length ? undefined : fixed;
  };
  return [
    {
      id: 'app.tracking',
      title: 'Track Changes',
      keys: keyFor('Review/Track Changes', '⇧⌘E'),
      synonyms: ['suggest', 'suggesting', 'redline'],
      control: {
        kind: 'switch',
        get: () => ui().tracking,
        set: (on) => {
          if (on !== ui().tracking) toggleTracking();
        },
      },
    },
    {
      id: 'app.resolved',
      title: 'Show Resolved Comments',
      synonyms: ['done', 'closed'],
      control: {
        kind: 'switch',
        get: () => settings.showResolved,
        set: (on) => {
          if (on !== settings.showResolved) toggleResolved();
        },
      },
    },
    {
      id: 'app.appearance',
      title: 'Appearance',
      synonyms: ['dark mode', 'light mode', 'theme', 'night'],
      control: {
        kind: 'choice',
        options: [
          { value: 'light', label: 'Light' },
          { value: 'dark', label: 'Dark' },
          { value: 'system', label: 'System' },
        ],
        get: () => settings.appearance,
        set: (value) => {
          if (value !== 'light' && value !== 'dark' && value !== 'system') return;
          changeSettings({ appearance: value });
          windowTheme.show(settings);
        },
      },
    },
    {
      id: 'app.clean',
      title: 'Show Clean View',
      keys: keyFor('View/Clean', '⌥⌘1'),
      synonyms: ['preview', 'read'],
      run: () => editor.showView('clean'),
    },
    {
      id: 'app.redlines',
      title: 'Show Redlines View',
      keys: keyFor('View/Redlines', '⌥⌘2'),
      synonyms: ['changes', 'markup'],
      run: () => editor.showView('redlines'),
    },
    {
      id: 'app.raw',
      title: 'Show Raw View',
      keys: keyFor('View/Plain', '⌥⌘3'),
      synonyms: ['markdown', 'source'],
      run: () => editor.showView('raw'),
    },
    {
      id: 'app.simple',
      title: 'Simple Look',
      keys: keyFor('View/Simple Look', '⌥⌘4'),
      synonyms: ['plain', 'quiet'],
      run: () => editor.switchLook(),
    },
    {
      id: 'app.preferences',
      title: 'Open Preferences',
      keys: keyFor('Redlines/Preferences…', '⌘,'),
      synonyms: ['settings', 'options'],
      run: () => commands.openPreferences(),
    },
    {
      id: 'app.updates',
      title: 'Check for Updates',
      run: () => commands.checkForUpdates(),
      available: () => updateNotifications !== undefined,
    },
    // Each pane of Preferences, to go to it by name (the Preferences window has its own search).
    ...PREFERENCE_PANES.map(([pane, label]): AppCommand => ({
      id: `app.preferences.${pane}`,
      title: `Open ${label} Preferences`,
      synonyms: ['settings', 'options', 'preferences', label.toLowerCase()],
      run: () => openPreferencesPane(pane),
    })),
    // Every other row of the menu bar (About Redlines, New, Open, the exports, zoom, …).
    ...menuPaletteCommands(
      menuModel,
      () => menuState,
      ({ row }) => {
        const key = row.id ? shortcutBook.keyOf(row.id) : null;
        return key ? displayKey(key) : undefined;
      },
    ),
  ];
}

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
  // This window's own: a zoom never changes the default that new windows open at.
  save: (textSize) => {
    settings = { ...settings, textSize };
  },
  holdRail: (held) => review.holdRail(held),
  say: (text) => notice.flash(text),
});

const toggleWordCount = () => {
  changeSettings({ showWordCount: !settings.showWordCount });
  wordCount.setVisible(settings.showWordCount);
  render();
};

const toggleSidebar = () => {
  changeSettings({ sidebarOpen: !settings.sidebarOpen });
  render();
};

// The review bar (@redlines/review). These menu items are enabled only for documents with redlines.
const openReview = () => review.startReview();
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

installTitleHints();

const titleBar = createTitleBar(element('#titlebar'), {
  keyOf: (id) => shortcutBook.keyOf(id),
  toggleToolbar: () => toolbar.toggle(),
  setView: (view) => editor.showView(view),
  switchLook: () => editor.switchLook(),
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

// A key changed here or in Preferences: the title bar's hints and menus show it (#551).
shortcutBook.subscribe(() => titleBar.keysChanged());

// The toolbar is at the bottom of the window from the start when the person wants it there.
toolbar.setAtBottom(settings.toolbarAtBottom);

// The title bar floats over the top of the scroller, and the text passes under it (styles.css): the
// editor keeps what it scrolls to clear of it, as of the find bar, and the bar stops short of a
// classic scrollbar.
editor.addExtension(topRoom(() => titleBar.room()));
followScrollbar(scroller, main);

// The word count in the lower right corner, counted on idle after the text or the selection last
// changed (a document that opens is counted by `showDocument`), and what the editor scrolls to is
// kept clear of its fade (word-count.ts).
const wordCount = createEditorWordCount(main, editor, { visible: settings.showWordCount });

// Updates (#34), in the app only: checked soon after it starts and every few hours, unless turned
// off, and downloaded in the background. Restarting into the new version asks each window about its
// unsaved edits first, as quitting does, and the new version reopens the documents. The app checks,
// downloads and installs for all the windows (#122); this one shows what it says, and asks.
// Failures leave a trace in the app's log and offer a report (crash.ts, #692); the app is where they
// are logged, so a browser tab has none.
if (isTauri) {
  recovery = createRecovery({
    link: tauriRecoveryLink(),
    label: getCurrentWindow().label,
    getText: () => editor.getDoc(),
  });
  const crashLink = tauriCrashLink();
  crashes = watchCrashes({
    link: crashLink,
    notifications,
    getText: () => editor.getDoc(),
    where: () => {
      const room = scroller.scrollHeight - scroller.clientHeight;
      return room > 0 ? `${Math.round((scroller.scrollTop / room) * 100)}% down` : 'at the top';
    },
  });
  if (import.meta.env.DEV) {
    // In a debug build: `__simulateFailure('throw' | 'reject' | 'hang' | 'panic' | 'terminate')`.
    (window as unknown as { __simulateFailure: (kind: string) => void }).__simulateFailure = (
      kind,
    ) => simulateFailure(kind, crashLink);
  }
}

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
  openAnotherWindow: () => void openAnotherWindow(),
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
      prepare: () => fillPrintPage(printableHtml()),
      back: [editor.view.dom, element('#titlebar')],
    }).catch((error: unknown) => {
      console.error('Could not print', error);
      notice.flash('Couldn’t print.');
    }),
  exportPdf: () => {
    const path = controller.state.path;
    void (async () => {
      const release = await fillPrintPage(printableHtml());
      try {
        const folder = path === null ? null : path.slice(0, Math.max(0, path.lastIndexOf('/')));
        const written = await host.exportPdf(controller.state.name, folder);
        if (written) notice.flash('Saved the PDF.');
      } finally {
        release();
      }
    })().catch((error: unknown) => {
      console.error('Could not export the PDF', error);
      notice.flash('Couldn’t export the PDF.');
    });
  },
  openDocx: () =>
    void openWord({
      host,
      // An untouched window takes it; another window is opened for it where the app can (a browser
      // tab can't be given text, and asks before it replaces what it has).
      open: (markdown) =>
        controller.untouched || !isTauri
          ? controller.createWith(markdown)
          : host.openWindow(undefined, undefined, markdown),
      folderName: () => loadSettings().imageFolderName,
      openFile: (path) =>
        controller.untouched || !isTauri
          ? openHere(path)
          : openInNewWindow(path).then(() => undefined),
      show: (options) => void notifications.show(options),
    }).catch((error: unknown) => {
      console.error('Could not open the Word file', error);
      notice.flash('Couldn’t open the Word file.');
    }),
  exportWord: () =>
    void exportToWord({
      host,
      text: editor.getDoc(),
      name: doc?.name ?? 'Untitled',
      path: doc?.path ?? null,
      images: readImageForWord,
      show: (options) => void notifications.show(options),
      canReveal: isTauri,
    }).catch((error: unknown) => {
      console.error('Could not export to Word', error);
      notice.flash('Couldn’t export to Word.');
    }),
  quit: () => void windows?.quit(),
  setView: (view) => editor.showView(view),
  switchLook: () => editor.switchLook(),
  toggleSidebar,
  toggleWordCount,
  toggleTracking,
  acceptAllAndStopTracking,
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
  reportProblem: () => {
    if (crashes) void crashes.reportProblem();
    else notice.flash('Problem reports are in the app.');
  },
  revealCrashLog: () => {
    if (crashes) void crashes.revealLog();
    else notice.flash('The log is in the app.');
  },
  // Dev builds only: a release build has no dev log, and its Help menu has neither row.
  ...(devLog.enabled
    ? {
        writeToLog: () => {
          void askDevNote({ container: app, restoreFocus: () => editor.focus() }).then((note) => {
            if (note === null) return;
            const { from, to } = editor.view.state.selection.main;
            void devLog
              .writeNote(note, {
                text: editor.getDoc(),
                selection: { from, to },
                view: editor.getUiState().view,
                tracking: editor.getUiState().tracking,
              })
              .then(() => notice.flash('Written to the dev log.'));
          });
        },
        revealDevLog: () => devLog.reveal(),
      }
    : {}),
};

// The plugins register their commands here, before the menus are drawn from the registry. Of the
// app's host they get only what fits the plugin API's yet: each its own document data, if it asks.
activatePlugins(editor, {}, DESKTOP_PLUGINS, {
  author,
  notice: (message) => notice.flash(message),
  toast: ({ text, action }) =>
    notifications.show({
      text,
      key: 'plugin toast',
      timeout: 8000,
      ...(action
        ? {
            action: {
              label: action.label,
              run: (card) => {
                action.run();
                card.close();
              },
            },
          }
        : {}),
    }),
  documentData: (manifest) => documentData.forPlugin(manifest),
});

// The menus show the commands registered by now: plugins register theirs above this line.
const menuModel = appMenuModel(commands, editor.commands, { browser: !isTauri });
shortcutBook.setEntries(shortcutEntries(menuModel));
// The Shortcuts pane of Preferences lists them, and has no menu bar of its own to read them from.
publishShortcutEntries(shortcutBook.entries());
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

/**
 * What a printed page holds: the document as it reads now, clean, with no marks (`print.css`), or
 * the Original while the window shows that. A text or code file is its text as it is.
 */
function printableHtml(): string {
  const current = ui ?? editor.getUiState();
  if (current.kind === 'plain-only') return plainPageHtml(editor.getDoc());
  // `view` has no Original yet; a window that shows one prints it.
  return editorDocumentHtml(editor.view, (current.view as string) === 'original');
}

function render(): void {
  if (!doc || !ui) return;
  checkDrawnCommands();
  app.dataset['sidebar'] = settings.sidebarOpen ? 'open' : 'closed';
  sidebar.setWidth(settings.sidebarWidth);
  sidebar.setOpen(settings.sidebarOpen);
  titleBar.update({
    name: doc.name,
    dirty: doc.dirty,
    ...(sessionStatus() ? { sync: sessionStatus()! } : {}),
    fileDraggable: doc.path !== null && canDragFile,
    plainOnly: ui.kind === 'plain-only',
    view: ui.view,
    tracking: ui.tracking,
    hasRedlines: ui.hasRedlines,
    sidebarOpen: settings.sidebarOpen,
    showResolved: settings.showResolved,
    toolbarShown: toolbar.isOpen(),
  });
  menuState = {
    plainOnly: ui.kind === 'plain-only',
    view: ui.view,
    tracking: ui.tracking,
    hasRedlines: ui.hasRedlines,
    canAcceptAll: ui.canAcceptAll,
    sidebarOpen: settings.sidebarOpen,
    showResolved: settings.showResolved,
    showWordCount: settings.showWordCount,
    zoom: zoom?.level() ?? null,
    textSize: settings.textSize,
    hasFile: doc.path !== null,
    recent: recentShown,
    activeCommands: ui.activeCommands,
    enabledCommands: ui.enabledCommands,
    disabledReasons: ui.disabledReasons,
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
    // A window opened for text is held in its first moments: its page can't be asked about the
    // text yet, and Tauri destroys the window when this handler lets it close, whatever the app
    // prevented, so this is what holds it (the app tells the person: `close-held`).
    if (await windows?.starting().catch(() => false)) {
      event.preventDefault();
      return;
    }
    // The comments being written outlast the window: they are kept now.
    review.saveDrafts();
    if (!(await controller.confirmDiscard())) event.preventDefault();
    // Closing the window stops its runs: nothing after this acts on its document.
    else {
      // The others go on: the next window leads the session, and none is left with a stale caret.
      await endSession();
      // Closed without saving, or with nothing unsaved: no copy is kept of it.
      recovery?.discard();
      runs.stopAll();
      ask.close();
    }
  });
  // The document first: drawing the menu bar takes a moment, and a new window shouldn't wait for it
  // to show what it was opened for.
  const start = await host.windowStart().catch((error: unknown) => {
    console.error('Could not ask what this window was opened for', error);
    return { path: null, line: null, text: null, session: false };
  });
  if (start.session && start.path !== null) {
    // Another window on a document: its text is the session's, which the window's leader gives.
    controller.followSession(start.path);
    await beginSession(start.path, true).catch(async (error: unknown) => {
      // The window that showed it closed first: this one holds the file on its own.
      console.error('Could not join the session', error);
      await controller.open(start.path!);
    });
  } else if (start.path === null) {
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
      toolbar.hide();
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
  if (/Macintosh/.test(navigator.userAgent))
    installPlusKeys(menuModel, () => menuState, shortcutBook);
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
  // Image files dropped on the window go to its document, not to the files to open. The app keeps
  // them and says where they landed, in points of the page, which the window zoom scales.
  await host
    .listenForImageDrops((drop) => {
      const level = zoom?.level() ?? 1;
      const spot = editor.imageSpot({ x: drop.x / level, y: drop.y / level });
      if (spot) void addImages(imageAdding, spot, { kind: 'given', id: drop.id });
    })
    .catch((error: unknown) => console.error('Could not listen for images dropped', error));
  // A launch with no file to open: the document that was open last, when Preferences ask for it.
  // New is always empty, so this is for the first window alone.
  if (controller.untouched && getCurrentWindow().label === 'main') {
    await reopenLastDocument(settings, async (path) => {
      await host.read(path);
      await controller.open(path);
    });
  }
  // A new document always starts with Track Changes off (#660): the switch is the document's own,
  // written at save, so no setting and no earlier document decides it.
  // After a crash: the edits the window had, put back, with a card that says so (#693).
  void restoreAfterCrash();
  windows?.ready();
  nativeMenu = await createNativeMenu(menuModel, shortcutBook).catch((error: unknown) => {
    // Without a menu bar, the shortcuts still work as key presses.
    console.error('Could not build the menu bar', error);
    installShortcuts(menuModel, shortcutBook);
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
  installShortcuts(menuModel, shortcutBook);
  const query = new URLSearchParams(location.search);
  const joining = query.get('join');
  if (joining !== null && tabsCanShare) {
    // Another tab on a document: its text is the session's, which the tab that leads gives.
    controller.followSession(joining);
    await beginSession(joining, true).catch(async (error: unknown) => {
      console.error('Could not join the session', error);
      await controller.open('sample.md');
    });
  } else {
    await controller.open('sample.md');
    // Debug only (the two-windows page, src/two-windows.ts): this tab starts the session.
    if (import.meta.env.DEV && query.get('session') === 'host' && tabsCanShare) {
      await beginSession('sample.md').catch((error: unknown) => {
        console.error('Could not start the session', error);
      });
    }
  }
  // Debug only (apps/desktop/journeys): the Playwright journeys start a document and read the
  // editor through this, in the plain page only. Nothing in a release build or the app has it.
  if (import.meta.env.DEV) {
    exposeForJourneys(editor, controller, {
      openFile: async (path, text) => {
        await host.write(path, text);
        await controller.open(path);
      },
      // The menu bar is the app's, and a page has none: a journey chooses a row through this, which
      // runs it only while the menu would have it enabled.
      menuRow: (text) => {
        const rows = menuModel.menus.flatMap((menu) => menu.rows);
        const row = rows.find((r) => 'action' in r && r.text === text);
        if (!row || !('action' in row) || !menuState) return null;
        const enabled = !row.disabled && (row.enabled?.(menuState) ?? true);
        return {
          enabled,
          run: () => {
            if (enabled) row.action();
            return enabled;
          },
        };
      },
    });
  }
}

// Preferences are a window of their own. Their changes arrive here as they are made, and so do
// those made in another window of the app. The file sidebar is each window's own.
watchSettings((changed) => {
  const plainOnlyListed = settings.showPlainOnlyFiles;
  settings = keepWindowOwn(settings, changed);
  shortcutBook.load(settings.shortcuts);
  review.setShowResolved(settings.showResolved);
  wordCount.setVisible(settings.showWordCount);
  if (settings.showPlainOnlyFiles !== plainOnlyListed) void sidebar.refresh();
  toolbar.setAtBottom(settings.toolbarAtBottom);
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

// Debug only (palette-check.ts): the toolbar's right-click and hints, and Ask's
// bubble with the page's scripted agent, in WebKit.
if (import.meta.env.DEV && import.meta.env['VITE_PALETTE_CHECK']) {
  void import('./palette-check.ts').then(({ runPaletteCheck }) =>
    runPaletteCheck(editor, { ask: !isTauri }),
  );
}

// Debug only (sync-check.ts): one document in two windows, side by side, in WebKit.
if (
  import.meta.env.DEV &&
  (import.meta.env['VITE_SYNC_CHECK'] || new URLSearchParams(location.search).has('sync-check'))
) {
  void import('./sync-check.ts').then(({ runSyncCheck }) => runSyncCheck());
}

// Debug only (sheet-check.ts): the sheet of every interface element, for the look sweep.
if (
  import.meta.env.DEV &&
  (import.meta.env['VITE_SHEET_CHECK'] || new URLSearchParams(location.search).has('sheet-check'))
) {
  void import('./sheet-check.ts').then(({ runSheetCheck }) =>
    runSheetCheck(editor, { notify: (options) => notifications.show(options) }),
  );
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
        save: (size) => {
          settings = { ...settings, textSize: size };
        },
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
  void refreshSavedImages();
});
// Undo and Redo are the document's or a field's, by where the keys are: the menu follows them,
// also when they go to another window, Preferences.
for (const type of ['focus', 'blur', 'focusin', 'focusout']) window.addEventListener(type, render);
void refreshRecent();
render();
focusEditor();
