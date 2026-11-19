// A document's chat (#1194, design §8.7): one continuous conversation with an agent, kept per
// document in the app's own data. The session is Ask's (the same agents, the same reach and first-run
// question, the same read-only tools), made long-lived: it starts from the history, and each answer
// is kept as it arrives. This file ties the session, the store and the panel together; the panel
// draws, and the host decides where it sits.

import type { AgentInfo } from '@redlines/plugin-api';
import { copyText } from '../ask/actions.ts';
import {
  createAskSession,
  type AskDeps,
  type AskSession,
  type AskState,
  type AskTurn,
} from '../ask/session.ts';
import {
  parseRecord,
  readRecord,
  recordText,
  TURNS_KEPT,
  type ChatRecord,
  type ChatStore,
} from './history.ts';
import { createChatPanel, type ChatPanel } from './panel.ts';

export { memoryStore, parseRecord, recordText } from './history.ts';
export type { ChatRecord, ChatStore } from './history.ts';
export { renderMarkdown } from './markdown.ts';
export type { ChatPanel, ChatView } from './panel.ts';

export interface ChatOptions extends Omit<AskDeps, 'onTurn'> {
  store: ChatStore;
  /** Shows a one-line message that doesn't interrupt. */
  notice(message: string): void;
  showLog?: (path: string) => void;
  openPreferences?: () => void;
  /** Puts text on the clipboard. Default: the page's own. */
  copy?: (text: string) => Promise<void> | void;
  /** Opens a web address in the person's browser. */
  openLink?: (url: string) => void;
}

export interface Chat {
  readonly el: HTMLElement;
  /**
   * The window shows the document at `path` (null for one with no file), `name` for its title, and
   * `generation` counts the documents that have taken the window's place: the same generation at
   * another path is the same document, renamed or saved, and its chat goes with it.
   */
  follow(path: string | null, generation: number, name: string): void;
  focus(): void;
  destroy(): void;
}

export function createChat(options: ChatOptions): Chat {
  /** The chat shown now. */
  let current: {
    path: string | null;
    generation: number;
    name: string;
    record: ChatRecord;
    session: AskSession | null;
    /** The message being answered, until it is answered, stopped or failed. */
    inflight: string | null;
    unsubscribe: () => void;
  } | null = null;
  /** Counts the documents followed, so that a read that finishes late is dropped. */
  let epoch = 0;
  let agents: readonly AgentInfo[] = [];
  let destroyed = false;

  const lookForAgents = () =>
    options.agents.list().then(
      (found) => {
        agents = found;
        draw();
      },
      () => {},
    );

  const panel: ChatPanel = createChatPanel({
    send: (text) => {
      const open = current;
      if (!open?.session) return;
      open.inflight = text;
      open.session.ask(text);
    },
    stop: () => current?.session?.stop(),
    pick: (agent, model) => {
      const open = current;
      if (!open?.session) return;
      open.session.setAgent(agent);
      open.session.setModel(model);
      open.record = {
        ...open.record,
        agent,
        ...(model === undefined ? { model: undefined } : { model }),
      };
      if (model === undefined) delete open.record.model;
      save(open);
    },
    consent: (answer) => current?.session?.answerConsent(answer),
    dismiss: () => current?.session?.dismiss(),
    ...(options.showLog ? { showLog: options.showLog } : {}),
    ...(options.openPreferences ? { openPreferences: options.openPreferences } : {}),
    ...(options.openLink ? { openLink: options.openLink } : {}),
    copy: (text) => {
      void new Promise<void>((resolve) => resolve((options.copy ?? copyText)(text))).then(
        () => options.notice('Copied the answer.'),
        () => options.notice('Couldn’t copy the answer.'),
      );
    },
    refreshAgents: () => {
      options.agents.forget?.();
      void lookForAgents();
    },
  });

  const EMPTY: AskState = { turns: [], pending: null, line: null, choice: null };

  function draw(state: AskState = current?.session?.state ?? EMPTY): void {
    if (destroyed) return;
    panel.render({
      title: current?.name ?? '',
      turns: state.turns,
      pending: state.pending,
      line: state.line,
      choice: state.choice,
      agents,
      defaultAgent: options.defaultAgent?.(),
    });
  }

  function save(open: NonNullable<typeof current>): void {
    // A document with no file keeps its chat in this window until it has one.
    if (open.path === null) return;
    const path = open.path;
    void options.store.write(path, recordText(open.record)).catch((error: unknown) => {
      console.error('Could not keep the chat', error);
      options.notice('Couldn’t keep the chat’s history.');
    });
  }

  function start(
    path: string | null,
    generation: number,
    name: string,
    record: ChatRecord,
  ): NonNullable<typeof current> {
    const open: NonNullable<typeof current> = {
      path,
      generation,
      name,
      record,
      session: null,
      inflight: null,
      unsubscribe: () => {},
    };
    const session = createAskSession(
      {
        ...options,
        document: {
          ...options.document,
          // The chat's own path: what it was started for, until the window follows another.
          path: () => open.path,
        },
        defaultAgent: options.defaultAgent ?? (() => undefined),
        onTurn: (turn) => {
          open.inflight = null;
          open.record = { ...open.record, turns: [...open.record.turns, turn].slice(-TURNS_KEPT) };
          save(open);
        },
      },
      { quote: '', chat: true, turns: record.turns },
    );
    if (record.agent !== undefined) session.setAgent(record.agent);
    if (record.model !== undefined) session.setModel(record.model);
    open.session = session;
    open.unsubscribe = session.subscribe((state) => {
      if (current !== open) return;
      // A message that is over and was not answered stays in the history, as stopped or failed.
      if (state.pending === null && open.inflight !== null) {
        const question = open.inflight;
        open.inflight = null;
        const line = state.line;
        const failed = line?.kind === 'failed' ? line : null;
        keep(open, {
          question,
          answer: failed ? failed.message : 'Stopped.',
          agent: state.choice?.agent ?? { id: '', name: failed?.agentName ?? 'Agent' },
          ended: failed ? 'failed' : 'stopped',
          at: Date.now(),
        });
      }
      draw(session.state);
    });
    return open;
  }

  /** Puts a turn that was answered elsewhere into the chat. */
  function keep(open: NonNullable<typeof current>, turn: AskTurn): void {
    open.session?.addTurn(turn);
    open.record = { ...open.record, turns: [...open.record.turns, turn].slice(-TURNS_KEPT) };
    save(open);
  }

  function end(open: NonNullable<typeof current>): void {
    open.unsubscribe();
    open.session?.close();
  }

  void lookForAgents();
  draw();

  return {
    el: panel.el,
    follow(path, generation, name) {
      if (destroyed) return;
      const was = current;
      if (was && was.generation === generation) {
        // The same document: renamed, or saved for the first time.
        const from = was.path;
        was.name = name;
        if (from !== path) {
          was.path = path;
          if (path !== null) {
            if (from === null) save(was);
            else void options.store.move(from, path).catch(() => {});
          }
        }
        draw();
        return;
      }
      const mine = ++epoch;
      if (was) end(was);
      current = null;
      draw(EMPTY);
      const open = (record: ChatRecord) => {
        if (mine !== epoch || destroyed) return;
        current = start(path, generation, name, record);
        draw();
      };
      if (path === null) return open(parseRecord(null));
      options.store.read(path).then(
        (text) => {
          const record = text === null ? parseRecord(null) : readRecord(text);
          if (record === null && text !== null) {
            // A history that can't be read is kept aside, never written over.
            void options.store.write(`${path}#unreadable`, text).catch(() => {});
            options.notice('This chat’s history couldn’t be read, so the chat starts anew.');
            return open(parseRecord(null));
          }
          open(record ?? parseRecord(null));
        },
        (error: unknown) => {
          console.error('Could not read the chat', error);
          open(parseRecord(null));
        },
      );
    },
    focus: () => panel.focusComposer(),
    destroy() {
      destroyed = true;
      epoch++;
      if (current) end(current);
      current = null;
      panel.destroy();
    },
  };
}
