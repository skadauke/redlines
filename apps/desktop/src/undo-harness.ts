// The window of the undo suites (undo-agents.node.test.ts, undo-random.node.test.ts): a document
// open in an editor with the review interface, the controller over files in memory, and runs of
// fake agents through the real toolbox, wired as main.ts wires them. Not part of the app, and with
// no Node API in it, since the app's program checks it.

import {
  createLiveLines,
  createMacAgents,
  createRuns,
  type LiveLines,
  type RunController,
} from '@redlines/agents';
import {
  fakeProvider,
  fakeRelay,
  type FakeProvider,
  type FakeScript,
  type ToolAnswer,
} from '@redlines/agents/fake-provider';
import { createEditor, type Editor } from '@redlines/editor';
import type { AgentEvent } from '@redlines/plugin-api';
import { createReview, type PostedComment, type ReviewController } from '@redlines/review';
import { DocumentController } from './document.ts';
import { dirname, type Host } from './host.ts';

export const PATH = '/docs/welcome.md';
export const ada = { handle: 'ada', name: 'Ada Lovelace', email: 'ada@example.org' };

/** A promise the test opens. */
export function gate(): { opened: Promise<void>; open: () => void } {
  let open = () => {};
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { opened, open };
}

/** Lets every pending promise and timer that is due run. */
export async function settle(): Promise<void> {
  for (let i = 0; i < 8; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

/** A tool call of a script: the tool's name and its arguments. */
export type Call = [tool: 'str_replace' | 'comment' | 'reply', args: Record<string, string>];

export const replace = (old_str: string, new_str: string): Call => [
  'str_replace',
  { old_str, new_str },
];
export const comment = (quote: string, text: string): Call => ['comment', { quote, text }];
export const reply = (text: string): Call => ['reply', { text }];

/**
 * A script that makes `calls`, and between the stretches of `then`, waits for each gate in turn:
 * `script(first, gate1, second)` makes the calls of `first`, waits for `gate1`, makes `second`.
 * The answers go in `answers`. It ends with `end`, by default done.
 */
export function script(
  ...parts: (readonly Call[] | Promise<void> | AgentEvent)[]
): FakeScript & { answers: ToolAnswer[] } {
  const answers: ToolAnswer[] = [];
  const run: FakeScript = async function* ({ tools }) {
    await tools.initialize();
    let ended = false;
    for (const part of parts) {
      if (part instanceof Promise) await part;
      else if (Array.isArray(part)) {
        for (const [tool, args] of part as readonly Call[])
          answers.push(await tools.call(tool, args));
      } else {
        ended = true;
        yield part as AgentEvent;
      }
    }
    if (!ended) yield { type: 'done' };
  };
  return Object.assign(run, { answers });
}

export interface Window {
  editor: Editor;
  review: ReviewController;
  controller: DocumentController;
  runs: RunController;
  claude: FakeProvider;
  codex: FakeProvider;
  files: Map<string, string>;
  /** Every text the editor reported, in order, the opened one first. */
  texts: string[];
  /** What the window's notice line said. */
  notices: string[];
  /** How many times Save asked whether to overwrite the file. */
  overwriteAsked: () => number;
  /** Holds the host's writes until the returned function lets them go. */
  holdWrites(): () => void;
  /** Another app writes `text` to the file, and the watcher fires. */
  changeOnDisk(text: string): Promise<void>;
  /** Comments on `word` through the comment box, posted with ⌘↩; returns the thread. */
  post(word: string, text: string): string;
  /** Replies in `thread` through its note's Reply box, posted with ⌘↩. */
  replyIn(thread: string, text: string): void;
  /** Types `text` at `at` in the document, as the keyboard does. */
  type(at: number, text: string): void;
  undoKey(): void;
  redoKey(): void;
  menuUndo(): void;
  menuRedo(): void;
  /** Waits until no run is live, and the writes of its edits are done. */
  runsEnd(): Promise<void>;
}

const mac = () => /Mac/.test(navigator.platform);

/** The box a comment is being written in, when one shows. */
export function field(editor: Editor): HTMLTextAreaElement | undefined {
  return [...editor.view.dom.querySelectorAll<HTMLTextAreaElement>('.rl-note textarea')].find(
    (box) => !box.closest<HTMLElement>('.rl-note-box')?.hidden,
  );
}

/** Writes in the box that shows. */
export function write(box: HTMLTextAreaElement, text: string): void {
  box.value = text;
  box.dispatchEvent(new Event('input', { bubbles: true }));
}

function postBox(editor: Editor, text: string): void {
  const box = field(editor);
  if (!box) throw new Error('No comment box shows');
  write(box, text);
  box.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true, cancelable: true }),
  );
}

/** The welcome document, or `doc`, open in a window. */
export async function openWindow(doc: string): Promise<Window> {
  const files = new Map([[PATH, doc]]);
  const watchers = new Map<string, () => void>();
  let held: Promise<void> | null = null;
  let overwrites = 0;
  const host: Host = {
    identity: () => Promise.resolve(ada),
    open: () => Promise.resolve(null),
    read: (path) => {
      const text = files.get(path);
      return text === undefined ? Promise.reject(new Error('not found')) : Promise.resolve(text);
    },
    write: async (path, text) => {
      if (held) await held;
      files.set(path, text);
    },
    rename: () => Promise.reject(new Error('not renamed here')),
    exists: (path) => Promise.resolve(files.has(path)),
    reveal: () => Promise.resolve(),
    print: () => Promise.resolve(),
    saveAs: () => Promise.resolve(null),
    watch: (path, onChange) => {
      watchers.set(path, onChange);
      return Promise.resolve(() => watchers.delete(path));
    },
    projectRoot: (path) =>
      Promise.resolve({ folder: dirname(path), isRepo: false, tooBroad: false }),
    list: () => Promise.resolve([]),
    openDefault: () => Promise.resolve(),
    allowDocument: () => Promise.resolve(),
    allowImages: () => Promise.resolve(false),
    imageUrl: () => null,
    forgetDocuments: () => Promise.resolve(),
    askToSave: () => Promise.resolve('cancel'),
    askToOverwrite: () => {
      overwrites++;
      return Promise.resolve('cancel');
    },
    askToDiscardDraft: () => Promise.resolve(false),
    askToSaveForImage: () => Promise.resolve(false),
    chooseImages: () => Promise.resolve(null),
    addImages: () => Promise.resolve({ paths: [], refused: [] }),
    listenForImageDrops: () => Promise.resolve(() => {}),
    openWindow: () => Promise.resolve(),
    windowStart: () => Promise.resolve({ path: null, line: null, text: null }),
    readClipboardText: () => Promise.resolve(''),
    listenForFiles: () => Promise.resolve(),
  };

  const texts: string[] = [];
  const notices: string[] = [];
  const parent = document.createElement('div');
  document.body.append(parent);
  // Assigned before the editor reports its first change.
  // eslint-disable-next-line prefer-const
  let controller: DocumentController;
  // eslint-disable-next-line prefer-const
  let runs: RunController;
  const editor = createEditor(parent, {
    doc: '',
    author: ada,
    // As main.ts does.
    onChange: (text) => {
      texts.push(text);
      controller.markEdited(text);
      runs.documentChanged();
    },
    onNotice: (message) => notices.push(message),
  });
  // happy-dom fires `selectionchange` while CodeMirror writes a focused editor's selection; the
  // suites keep the editor unfocused, as the review interface's tests do.
  editor.view.focus = () => {};
  editor.view.contentDOM.focus = () => {};

  const relay = fakeRelay();
  const claude = fakeProvider({ relay, script: script([reply('Done.')]) });
  const codex = fakeProvider({ relay, id: 'codex', name: 'Codex', script: script([reply('Ok.')]) });
  runs = createRuns({
    agents: createMacAgents([claude, codex], relay),
    author: ada,
    document: {
      path: () => controller.state.path,
      generation: () => controller.generation,
      read: () => editor.getDoc(),
      parsed: () => editor.getParsed(),
      save: () => controller.save(),
      applyAgentEdit: (next, step) => controller.applyAgentEdit(next, step),
    },
    projectRoot: (path) => host.projectRoot(path),
    settings: { defaultScope: () => 'folder', consent: () => 'folder', setConsent: () => {} },
    onEnded: () => {},
  });
  // eslint-disable-next-line prefer-const
  let liveLines: LiveLines;
  const review = createReview(editor, {
    author: ada,
    onPosted: (posted: PostedComment) => runs.posted(posted),
    // As main.ts does: each thread's live line, drawn in its note, which a run stopped from inside
    // an update of the editor (`documentChanged`) draws again then.
    extras: {
      footer: (thread) => liveLines.footer(thread),
      keepShown: (thread) => liveLines.keepsShown(thread),
    },
  });
  liveLines = createLiveLines({
    runs,
    author: ada,
    getParsed: () => editor.getParsed(),
    refresh: (thread) => review.refreshThread(thread),
    showThread: (thread) => review.showThread(thread),
    inView: () => true,
  });
  // As main.ts does: a change on disk that is Ada's agents' work alone is a step.
  controller = new DocumentController(host, editor, () => {}, {
    isRunLive: () => runs.isLive(),
    author: () => ada.handle,
  });
  await controller.open(PATH);
  await settle();
  texts.splice(0, texts.length, editor.getDoc());

  const key = (shift: boolean, name = 'z') =>
    editor.view.contentDOM.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: name,
        metaKey: mac(),
        ctrlKey: !mac(),
        shiftKey: shift,
        bubbles: true,
        cancelable: true,
      }),
    );
  const menu = (inputType: string) =>
    editor.view.contentDOM.dispatchEvent(
      new InputEvent('beforeinput', { inputType, bubbles: true, cancelable: true }),
    );

  return {
    editor,
    review,
    controller,
    runs,
    claude,
    codex,
    files,
    texts,
    notices,
    overwriteAsked: () => overwrites,
    holdWrites() {
      const { opened, open } = gate();
      held = opened;
      return () => {
        held = null;
        open();
      };
    },
    async changeOnDisk(text) {
      files.set(PATH, text);
      watchers.get(PATH)?.();
      await settle();
    },
    post(word, text) {
      const from = editor.view.state.doc.toString().indexOf(word);
      if (from < 0) throw new Error(`No ${word} in the document`);
      editor.view.dispatch({
        selection: { anchor: from, head: from + word.length },
        userEvent: 'select',
      });
      if (!review.startComment()) throw new Error('No comment can start there');
      const before = new Set(editor.getParsed().ledger.comments.map(({ id }) => id));
      postBox(editor, text);
      const thread = editor.getParsed().ledger.comments.find(({ id }) => !before.has(id));
      if (!thread) throw new Error('Nothing was posted');
      return thread.id;
    },
    replyIn(thread, text) {
      const quote = editor.getParsed().ledger.comments.find(({ id }) => id === thread)?.text;
      const note = [...editor.view.dom.querySelectorAll<HTMLElement>('.rl-note')].find(
        (el) => quote !== undefined && el.textContent?.includes(quote),
      );
      const button = note?.querySelector<HTMLButtonElement>('button[aria-label="Reply"]');
      if (!button) throw new Error(`No Reply button in ${thread}`);
      button.click();
      postBox(editor, text);
    },
    type(at, text) {
      editor.view.dispatch({
        changes: { from: at, insert: text },
        selection: { anchor: at + text.length },
        userEvent: 'input.type',
      });
    },
    undoKey: () => key(false),
    redoKey: () => (mac() ? key(true) : key(false, 'y')),
    menuUndo: () => menu('historyUndo'),
    menuRedo: () => menu('historyRedo'),
    async runsEnd() {
      for (let i = 0; i < 200 && runs.isLive(); i++) await settle();
      if (runs.isLive()) throw new Error('A run is still live');
      await settle();
    },
  };
}
