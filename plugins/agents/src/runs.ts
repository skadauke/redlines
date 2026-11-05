// Runs (spec: Agents, What happens; Where the tools run; Scope). A comment posted in this app's box
// that names an agent found on this Mac starts a run in its thread, and nothing else does: not a
// reload, an undo, a paste or `setDoc`, which never reach `posted`. A run saves the document, asks
// once per agent and folder what it may read, starts the agent with the toolbox, and ends in the
// file: a reply and tracked edits in the agent's name. What it is doing meanwhile, the first-run
// question and a failure are its live line, which is never written and goes with the document.
//
// The tools act on the live editor. Each run is bound to the document it was posted in: a tool call
// that arrives after another document took its place is refused, and stops the run.

import { agentPrompt, answerMcp, callTool, fitReply } from '@redlines/agent-tools';
import type { ToolContext, ToolDocument } from '@redlines/agent-tools';
import type { Author } from '@redlines/editor';
import { idsIn, newId, parse } from '@redlines/format';
import type { Person } from '@redlines/format';
import type {
  AgentEvent,
  AgentInfo,
  AgentRequest,
  AgentScope,
  HostAgents,
  ProjectRoot,
  ToolLines,
} from '@redlines/plugin-api';
import type { PostedComment } from '@redlines/review';
import { mentionedAgents } from './mentions.ts';

/** What a thread shows of its run, for now: never written to the file. */
export type LiveLine =
  | {
      kind: 'asking';
      agent: string;
      agentName: string;
      folder: string;
      readLimit: 'folder' | 'machine';
    }
  | { kind: 'running'; agent: string; agentName: string; status: string }
  | { kind: 'failed'; agent: string; agentName: string; message: string; logPath?: string };

export interface RunController {
  /** The only way a run starts. */
  posted(comment: PostedComment): void;
  /** The answer to the first-run question: read the folder, just this document, or not at all. */
  answerConsent(thread: string, answer: 'folder' | 'document' | 'no'): void;
  /** Stops the thread's run, and drops the runs waiting behind it. */
  stop(thread: string): void;
  /** Puts away a failure on the thread's line. */
  dismiss(thread: string): void;
  /** Stops every run, as when the window closes. Nothing posted before starts after it. */
  stopAll(): void;
  /** Whether a run is starting, asking, running or waiting: the document mustn't be replaced. */
  isLive(): boolean;
  /** Another document took this one's place: its runs stop, and their lines go with it. */
  documentReplaced(): void;
  line(thread: string): LiveLine | null;
  /** Called with a thread whenever its line changes. Returns a function that stops it. */
  subscribe(listener: (thread: string) => void): () => void;
}

export interface RunDeps {
  agents: HostAgents;
  author: Author;
  document: {
    path(): string | null;
    /** Bumped whenever another document replaces this one. */
    generation(): number;
    read(): string;
    save(): Promise<boolean>;
    applyAgentEdit(next: string): Promise<void>;
  };
  projectRoot(path: string): Promise<ProjectRoot>;
  settings: {
    defaultScope(): 'folder' | 'document';
    consent(agent: string, folder: string): AgentScope | 'no' | undefined;
    setConsent(agent: string, folder: string, answer: AgentScope | 'no'): void;
  };
  /** A run ended: the sidebar refreshes. */
  onEnded(): void;
}

/** The line a run starts with, until the agent says what it is doing. */
const STARTING = 'Starting…';
/** Said on the line when the folder is the home folder or the disk's root. */
const TOO_BROAD = 'Folder too broad: this document only';

/** One agent named in one post, waiting for its turn in the thread. */
interface Job {
  agent: AgentInfo;
  thread: string;
  /** The person's words. */
  text: string;
  /** The document it was posted in. */
  generation: number;
  /** The post that named it, told apart from the thread's other posts. */
  post: number;
}

interface Run {
  job: Job;
  abort: AbortController;
  over: boolean;
  /** It got as far as starting the agent. */
  started: boolean;
  /** The agent called `reply`. */
  replied: boolean;
  /** While the first-run question is up: answers it, or with null when the run stops. */
  answer?: (answer: 'folder' | 'document' | 'no' | null) => void;
  /** What the agent reports, let go of when the run ends early. */
  events?: AsyncIterator<AgentEvent>;
  /** Where the program's log is, once it has started. */
  logPath?: string;
}

interface ThreadState {
  queue: Job[];
  run: Run | null;
  line: LiveLine | null;
  /** The document the line belongs to. */
  generation: number;
  /**
   * The last failure of a run from the post being worked through. A later run named in the same
   * post shows its own line while it runs, and puts this back when it ends well.
   */
  failure: { post: number; line: LiveLine } | null;
}

/** Where a run may read, once that is settled. */
interface Reach {
  scope: 'document' | 'folder';
  folder?: string;
  /** Said on the line as the run starts. */
  note?: string;
}

/** A mention of anyone at all: a post without one isn't looked at further. */
const ANY_MENTION = /@[\p{L}\p{N}]/u;

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function basename(path: string): string {
  return path.split('/').filter(Boolean).at(-1) ?? path;
}

/** Why an agent found on this Mac can't run, in one line: it isn't signed in, or it is too old. */
function cannotRun(agent: AgentInfo, reason: 'signed-out' | 'too-old'): string {
  const help = agent.state.help ?? '';
  if (reason === 'too-old') return help || `${agent.name} is too old to run here.`;
  return `${agent.name} isn't signed in.${help ? ` ${help}` : ''}`;
}

/** A JSON-RPC error for a refused line, or null for a notification, which has no one to answer. */
function refuse(line: string, message: string): string | null {
  let id: unknown = null;
  try {
    const parsed: unknown = JSON.parse(line);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      if (!('id' in parsed)) return null;
      id = parsed.id;
    }
  } catch {
    // Not JSON: there is no id to answer to.
  }
  return JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32000, message } });
}

export function createRuns(deps: RunDeps): RunController {
  const threads = new Map<string, ThreadState>();
  const listeners = new Set<(thread: string) => void>();
  /** Posts whose mentions are being looked up. */
  let examining = 0;
  let posts = Promise.resolve();
  /** Bumped by `stopAll`, so that a post looked up before it starts nothing after it. */
  let epoch = 0;
  /** Counts posts, so that a thread can tell its runs from one post from another's. */
  let postCount = 0;

  const generation = () => deps.document.generation();

  function stateOf(thread: string): ThreadState {
    let state = threads.get(thread);
    if (!state) {
      state = { queue: [], run: null, line: null, generation: generation(), failure: null };
      threads.set(thread, state);
    }
    return state;
  }

  function notify(thread: string): void {
    for (const listener of [...listeners]) {
      try {
        listener(thread);
      } catch (error) {
        console.error('A live line listener failed', error);
      }
    }
  }

  function show(thread: string, line: LiveLine | null, of: number): void {
    const state = stateOf(thread);
    state.line = line;
    state.generation = of;
    notify(thread);
  }

  const who = (run: Run) => ({ agent: run.job.agent.id, agentName: run.job.agent.name });
  const failed = (run: Run, message: string): LiveLine => ({
    kind: 'failed',
    ...who(run),
    message,
    ...(run.logPath === undefined ? {} : { logPath: run.logPath }),
  });

  /** Shows what a run that is still going is doing. */
  function running(run: Run, status: string): void {
    if (run.over) return;
    show(run.job.thread, { kind: 'running', ...who(run), status }, run.job.generation);
  }

  /** Ends a run with what its line says then, and lets the next one in its thread start. */
  function finish(run: Run, line: LiveLine | null): void {
    if (run.over) return;
    run.over = true;
    run.answer?.(null);
    const { thread } = run.job;
    const state = stateOf(thread);
    if (state.run === run) state.run = null;
    // Let go of the agent, which closes its relay once it is let go of. Not awaited: an agent that
    // hangs is let go of when it stops hanging.
    run.events?.return?.(undefined).catch(() => {});
    let shown = line;
    if (line?.kind === 'failed') state.failure = { post: run.job.post, line };
    // An earlier agent named in the same post failed: this one ending well doesn't hide that.
    else if (line === null && state.failure?.post === run.job.post) shown = state.failure.line;
    show(thread, shown, run.job.generation);
    if (run.started) {
      try {
        deps.onEnded();
      } catch (error) {
        console.error('Could not tell that a run ended', error);
      }
    }
    pump(thread);
  }

  /** Stops a run, also one whose agent never listens. */
  function halt(run: Run, line: LiveLine | null): void {
    if (run.over) return;
    run.abort.abort();
    finish(run, line);
  }

  /** Why a run's tools must not act now, or null when they may. A run whose document was replaced
   * stops here. */
  function refusal(run: Run): string | null {
    if (run.over) return 'This run has stopped.';
    if (generation() !== run.job.generation) {
      halt(run, failed(run, `The document changed, so ${run.job.agent.name} stopped.`));
      return 'The document changed under this run, so it has stopped.';
    }
    return null;
  }

  /** The live document, as the tools of `run` see it. */
  function toolDocument(run: Run): ToolDocument {
    const check = () => {
      const why = refusal(run);
      if (why !== null) throw new Error(why);
    };
    return {
      read() {
        check();
        return deps.document.read();
      },
      write(next) {
        check();
        return deps.document.applyAgentEdit(next);
      },
    };
  }

  /** Answers the agent's MCP lines, while the run may still act. */
  function toolLines(run: Run, answer: ToolLines): ToolLines {
    return async (line) => {
      const why = refusal(run);
      return why === null ? answer(line) : refuse(line, why);
    };
  }

  /** Starts the next run waiting in the thread, if none is going. */
  function pump(thread: string): void {
    const state = stateOf(thread);
    if (state.run) return;
    const job = state.queue.shift();
    if (!job) return;
    const run: Run = {
      job,
      abort: new AbortController(),
      over: false,
      started: false,
      replied: false,
    };
    state.run = run;
    void start(run);
  }

  async function start(run: Run): Promise<void> {
    const { agent } = run.job;
    try {
      // Posted in a document that has gone since: there is no thread to show anything in.
      if (generation() !== run.job.generation) return finish(run, null);
      running(run, STARTING);
      if (agent.state.found && !agent.state.signedIn) {
        // What detection found is kept for a while: the next post looks again, for a person who
        // has signed in or updated meanwhile.
        deps.agents.forget?.();
        return finish(run, failed(run, cannotRun(agent, agent.state.reason)));
      }
      const path = deps.document.path();
      // Posting a comment that starts a run saves the document, if it has a file.
      if (path !== null && !(await deps.document.save())) {
        return finish(
          run,
          failed(run, `${agent.name} didn't start, because the document wasn't saved.`),
        );
      }
      if (run.over) return;
      const reach = await reachOf(run, path);
      if (run.over) return;
      if (reach === null) return finish(run, null);
      if (generation() !== run.job.generation) return finish(run, null);
      await go(run, path, reach);
    } catch (error) {
      finish(run, failed(run, `${agent.name} stopped: ${reasonOf(error)}`));
    }
  }

  /**
   * What the run may read: This document for a document with no file, a folder that is too broad
   * or Preferences saying so; otherwise what the person allowed for this agent and folder, asked
   * until they allow something. An agent that can't be held to less than the machine is always
   * asked, and has no This document. Null when the person said Not now, which isn't remembered, or
   * the run stopped meanwhile.
   */
  async function reachOf(run: Run, path: string | null): Promise<Reach | null> {
    const { agent } = run.job;
    const root = path === null ? null : await deps.projectRoot(path);
    if (run.over) return null;
    const folder = root && !root.tooBroad ? root.folder : undefined;
    const atDocument: Reach = root?.tooBroad
      ? { scope: 'document', note: TOO_BROAD }
      : { scope: 'document' };
    const machine = agent.readLimit === 'machine';
    if (!machine && (folder === undefined || deps.settings.defaultScope() === 'document')) {
      return atDocument;
    }
    const asked = folder ?? root?.folder ?? '';
    let answer = deps.settings.consent(agent.id, asked);
    // Only Allow and Just this document are remembered; a no an earlier version stored asks again.
    if (answer === 'no' || (machine && answer === 'document')) answer = undefined;
    if (answer === undefined) {
      const given = await ask(run, asked);
      if (given === null || given === 'no') return null;
      deps.settings.setConsent(agent.id, asked, given);
      answer = given;
    }
    return answer === 'document' || folder === undefined ? atDocument : { scope: 'folder', folder };
  }

  /** Puts the first-run question on the line, and waits for the answer: null if the run stops. */
  function ask(run: Run, folder: string): Promise<'folder' | 'document' | 'no' | null> {
    return new Promise((resolve) => {
      if (run.over) return resolve(null);
      run.answer = (answer) => {
        run.answer = undefined;
        resolve(answer);
      };
      show(
        run.job.thread,
        { kind: 'asking', ...who(run), folder, readLimit: run.job.agent.readLimit },
        run.job.generation,
      );
    });
  }

  async function go(run: Run, path: string | null, reach: Reach): Promise<void> {
    const { job } = run;
    const { agent } = job;
    const me = deps.author.handle;
    const text = deps.document.read();
    const thread = parse(text).ledger.comments.find(({ id }) => id === job.thread);
    const author: Person = { handle: `${agent.id}-${me}`, name: agent.name, agent: true, for: me };
    const ctx: ToolContext = {
      doc: toolDocument(run),
      author,
      thread: job.thread,
      // A fresh group for each run, so its marks are decided together (design §8.3).
      group: newId(idsIn(text)),
      now: () => new Date(),
      requestedBy: me,
      onStatus: (status) => running(run, status),
      onReply: () => {
        run.replied = true;
      },
    };
    const request: AgentRequest = {
      prompt: job.text,
      systemPrompt: agentPrompt({
        documentName: path === null ? 'Untitled' : basename(path),
        quote: thread?.quote,
        scope: reach.scope,
        folder: reach.folder,
      }),
      thread: job.thread,
      ...(path === null ? {} : { documentPath: path }),
      ...(reach.folder === undefined ? {} : { folder: reach.folder }),
      scope: reach.scope,
      author: { handle: author.handle, name: author.name, for: me },
    };
    running(run, reach.note ?? STARTING);
    run.started = true;
    const reported = deps.agents.run(
      agent.id,
      request,
      toolLines(run, answerMcp(ctx)),
      run.abort.signal,
    );
    const events = reported[Symbol.asyncIterator]();
    run.events = events;
    for (;;) {
      const next = await events.next();
      if (run.over) return;
      if (next.done === true) {
        return finish(run, failed(run, `${agent.name} ended without an answer.`));
      }
      const event = next.value;
      if (event.type === 'started') {
        run.logPath = event.logPath;
      } else if (event.type === 'status') {
        running(run, event.text);
      } else if (event.type === 'error') {
        return finish(run, failed(run, event.message));
      } else {
        return ended(run, ctx, event.finalText);
      }
    }
  }

  /** The agent is done: its last message is the reply when it never called `reply`. */
  async function ended(run: Run, ctx: ToolContext, finalText: string | undefined): Promise<void> {
    const { agent } = run.job;
    if (!run.replied) {
      const last = finalText?.trim() ?? '';
      if (last === '') return finish(run, failed(run, `${agent.name} ended with nothing to say.`));
      const written = await callTool(ctx, 'reply', fitReply(last));
      if (run.over) return;
      if (written.isError) {
        return finish(
          run,
          failed(run, `${agent.name}'s answer couldn't be written: ${written.text}`),
        );
      }
    }
    finish(run, null);
  }

  async function examine(
    comment: PostedComment,
    posted: { generation: number; post: number },
    at: number,
  ): Promise<void> {
    const agents = await deps.agents.list();
    if (at !== epoch || generation() !== posted.generation) return;
    const state = stateOf(comment.thread);
    for (const id of mentionedAgents(comment.text, agents)) {
      const agent = agents.find((candidate) => candidate.id === id);
      if (agent) state.queue.push({ agent, thread: comment.thread, text: comment.text, ...posted });
    }
    pump(comment.thread);
  }

  return {
    posted(comment) {
      const state = stateOf(comment.thread);
      // Posting again puts a failure away, also one an earlier post's next run would put back.
      state.failure = null;
      if (state.line?.kind === 'failed') show(comment.thread, null, generation());
      if (!ANY_MENTION.test(comment.text)) return;
      const posted = { generation: generation(), post: ++postCount };
      const at = epoch;
      examining++;
      posts = posts
        .then(() => examine(comment, posted, at))
        .catch((error: unknown) => console.error('Could not look at a posted comment', error))
        .finally(() => {
          examining--;
          notify(comment.thread);
        });
    },

    answerConsent(thread, answer) {
      const run = threads.get(thread)?.run;
      if (!run?.answer) return;
      // An agent that reads the whole machine can't be held to this document.
      if (answer === 'document' && run.job.agent.readLimit === 'machine') return;
      run.answer(answer);
    },

    stop(thread) {
      const state = threads.get(thread);
      if (!state) return;
      state.queue = [];
      if (state.run) halt(state.run, failed(state.run, 'Stopped.'));
    },

    dismiss(thread) {
      const state = threads.get(thread);
      if (!state) return;
      state.failure = null;
      if (state.line?.kind === 'failed') show(thread, null, state.generation);
    },

    stopAll() {
      epoch++;
      for (const [thread, state] of threads) {
        state.queue = [];
        if (state.run) halt(state.run, failed(state.run, 'Stopped.'));
        else notify(thread);
      }
    },

    isLive() {
      return (
        examining > 0 ||
        [...threads.values()].some((state) => state.run !== null || state.queue.length > 0)
      );
    },

    documentReplaced() {
      const now = generation();
      for (const state of threads.values()) {
        state.queue = state.queue.filter((job) => job.generation === now);
        if (state.run && state.run.job.generation !== now) halt(state.run, null);
      }
    },

    line(thread) {
      const state = threads.get(thread);
      return state && state.generation === generation() ? state.line : null;
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
