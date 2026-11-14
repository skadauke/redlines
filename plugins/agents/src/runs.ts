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
import type { AgentStep, Author } from '@redlines/editor';
import { parse } from '@redlines/format';
import type { Parsed, Person } from '@redlines/format';
import type {
  AgentEvent,
  AgentInfo,
  AgentRequest,
  AgentScope,
  BlockedRead,
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
      /**
       * For a question, which asks only for an answer: the panel says it changes nothing, not that
       * it changes this document. That is so for an agent held to reading its folder; one that reads
       * the whole machine (`readLimit` 'machine') can't be held to it, and the panel says so.
       */
      readOnly?: boolean;
      /** The home folder is among the answers: Preferences allow it, and the agent can be held to it. */
      home?: true;
    }
  | { kind: 'running'; agent: string; agentName: string; status: string }
  | {
      kind: 'failed';
      agent: string;
      agentName: string;
      message: string;
      logPath?: string;
      /** Preferences › Agents can put it right (the agent is signed out or too old): offered. */
      setup?: true;
    };

/** A read an agent couldn't make inside what it may read, and whose run it was. */
export interface BlockedNotice extends BlockedRead {
  agent: string;
  agentName: string;
  thread: string;
  /** The run's log, once the program has started. */
  logPath?: string;
}

export interface RunController {
  /** The only way a run starts. */
  posted(comment: PostedComment): void;
  /**
   * The answer to the first-run question: read the folder, the folder and the home folder (only
   * where the question offered it), just this document, or not at all.
   */
  answerConsent(thread: string, answer: AgentScope | 'no'): void;
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
  /**
   * The document changed, as the editor's onChange says: a run whose post is no longer in it stops,
   * with no line, and the jobs of that post waiting in its thread go. Does nothing when nothing is live.
   */
  documentChanged(): void;
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
    /** The document's parse as the editor holds it (`Editor.getParsed`): whether a post is still there. */
    parsed(): Parsed;
    save(): Promise<boolean>;
    /** An edit of a run: a step of the run's (`step.group`), which Undo takes back. */
    applyAgentEdit(next: string, step: AgentStep): Promise<void>;
  };
  projectRoot(path: string): Promise<ProjectRoot>;
  /**
   * What an agent may read at This folder and my home folder, which the host names: the home
   * folder, and the folders of it to grant (`AgentRequest.homeFolder` and `homeRoots`). Without it,
   * or when it gives none, that scope can't be given, and a run at it reads the folder only, and
   * says so.
   */
  homeReach?: () => Promise<{ home: string; roots: readonly string[] } | null | undefined>;
  /**
   * The folders among what an agent may read at that scope that macOS isn't letting Redlines read
   * (Documents, Desktop, Downloads, iCloud Drive, cloud folders, volumes), found by listing each
   * from the app, which is also what makes macOS ask the person, once. Asked before each run at
   * that scope: the run goes on, and the person and the agent are both told which folders are out
   * of reach.
   */
  homeAccess?: () => Promise<readonly { name: string; folder: string }[]>;
  settings: {
    /** What Preferences allow agents to read: the most any answer can give. */
    defaultScope(): AgentScope;
    consent(agent: string, folder: string): AgentScope | 'no' | undefined;
    setConsent(agent: string, folder: string, answer: AgentScope | 'no'): void;
  };
  /**
   * An agent couldn't read a file inside what it may read: the window tells the person which file,
   * why and what to do, in a notification. Called once for each cause and place in a run.
   */
  onBlocked?: (notice: BlockedNotice) => void;
  /** A run ended: the sidebar refreshes. */
  onEnded(): void;
}

/** The line a run starts with, until the agent says what it is doing. */
const STARTING = 'Starting…';
/** Said on the line when the folder is the home folder or the disk's root. */
const TOO_BROAD = 'Folder too broad: this document only';
/** Said on the line when the home folder was allowed and the host could not list it. */
const NO_HOME = 'No home folder found: this folder only';
/** Said on the line while macOS may be asking whether Redlines can read a folder. */
const CHECKING_MACOS = 'Checking what macOS allows…';
/**
 * How long a run waits for macOS to say what it holds back. The listing that finds out waits for
 * the person to answer macOS's question, and for a network volume that has gone it may not end;
 * a run that has waited this long goes on, and a read that is then refused is told of as it happens.
 */
const MACOS_WAIT = 20_000;

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
  /** What the post is in the ledger: the thread's id for a new comment, the reply's for a reply. */
  posted: string;
}

interface Run {
  /** The run's id, `run-<n>`, counting the window's runs from 1: its edits' step group. */
  id: string;
  job: Job;
  abort: AbortController;
  over: boolean;
  /** It got as far as starting the agent. */
  started: boolean;
  /** The agent called `reply`. */
  replied: boolean;
  /** While the first-run question is up: answers it, or with null when the run stops. */
  answer?: (answer: AgentScope | 'no' | null) => void;
  /** What the agent reports, let go of when the run ends early. */
  events?: AsyncIterator<AgentEvent>;
  /** Where the program's log is, once it has started. */
  logPath?: string;
  /** The reads already told of, by cause and place, so that each is told once. */
  told?: Set<string>;
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

/** How wide each scope reads, for holding an answer to what Preferences allow. */
const WIDTH: Record<AgentScope, number> = { document: 0, folder: 1, everything: 2 };

/** The narrower of two scopes. */
function narrower(one: AgentScope, other: AgentScope): AgentScope {
  return WIDTH[one] <= WIDTH[other] ? one : other;
}

/** Where a run may read, once that is settled. */
interface Reach {
  scope: AgentScope;
  folder?: string;
  /** Said on the line as the run starts. */
  note?: string;
}

/** The handle an agent writes as when it acts for `me`, such as `claude-ada` (spec: What happens). */
export function agentHandle(agent: string, me: string): string {
  return `${agent}-${me}`;
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
  /** The window's runs so far, for each run's id. */
  let runCount = 0;
  const threads = new Map<string, ThreadState>();
  const listeners = new Set<(thread: string) => void>();
  /** Posts whose mentions are being looked up; `gone` once the document lost the post meanwhile. */
  const lookingUp = new Set<{ comment: PostedComment; gone: boolean }>();
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
  const failed = (run: Run, message: string, setup = false): LiveLine => ({
    kind: 'failed',
    ...who(run),
    message,
    ...(run.logPath === undefined ? {} : { logPath: run.logPath }),
    ...(setup ? { setup: true as const } : {}),
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

  /**
   * Whether the post that named `job` is still in the document: its thread, and for a reply, the
   * reply. Taken back by Undo, or gone however it went, it asks for nothing any more.
   */
  function postThere(
    job: { thread: string; posted: string },
    parsed: Parsed = deps.document.parsed(),
  ): boolean {
    const thread = parsed.ledger.comments.find(({ id }) => id === job.thread);
    if (!thread) return false;
    return job.posted === job.thread || thread.replies.some(({ id }) => id === job.posted);
  }

  /**
   * Stops `run` when its post is gone, with no line, and with the jobs of that post waiting behind
   * it; a failure an earlier run of the post left goes too, for it answered a request that is gone.
   * Returns whether it stopped.
   */
  function stopIfGone(run: Run, parsed?: Parsed): boolean {
    if (run.over) return true;
    if (postThere(run.job, parsed)) return false;
    const state = stateOf(run.job.thread);
    state.queue = state.queue.filter((job) => job.post !== run.job.post);
    if (state.failure?.post === run.job.post) state.failure = null;
    halt(run, null);
    return true;
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
    if (stopIfGone(run)) return 'The comment that started this run is gone, so it has stopped.';
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
        return deps.document.applyAgentEdit(next, { group: run.id, agent: run.job.agent.name });
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
      id: `run-${++runCount}`,
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
      if (stopIfGone(run)) return;
      running(run, STARTING);
      if (agent.state.found && !agent.state.signedIn) {
        // What detection found is kept for a while: the next post looks again, for a person who
        // has signed in or updated meanwhile.
        deps.agents.forget?.();
        return finish(run, failed(run, cannotRun(agent, agent.state.reason), true));
      }
      const path = deps.document.path();
      // Posting a comment that starts a run saves the document, if it has a file.
      if (path !== null && !(await deps.document.save())) {
        return finish(
          run,
          failed(run, `${agent.name} didn't start, because the document wasn't saved.`),
        );
      }
      if (run.over || stopIfGone(run)) return;
      // `reachOf` looks for the post after each of its awaits, and returns at once after the last.
      const reach = await reachOf(run, path);
      if (run.over) return;
      if (reach === null) return finish(run, null);
      if (generation() !== run.job.generation) return finish(run, null);
      await go(run, path, reach);
    } catch (error) {
      const why = reasonOf(error);
      finish(
        run,
        failed(
          run,
          run.started ? `${agent.name} stopped: ${why}` : `${agent.name} didn't start: ${why}`,
        ),
      );
    }
  }

  /**
   * What the run may read: This document for a document with no file, a folder that is too broad
   * or Preferences saying so; otherwise what the person allowed for this agent and folder, asked
   * until they allow something, and held to what Preferences allow now (an answer is kept, and
   * stands again if Preferences allow more later). The home folder is offered only where
   * Preferences allow it. An agent that can't be held to less than the machine is always asked,
   * and has no This document and no home folder. Null when the person said Not now, which isn't
   * remembered, or the run stopped meanwhile.
   */
  async function reachOf(run: Run, path: string | null): Promise<Reach | null> {
    const { agent } = run.job;
    const root = path === null ? null : await deps.projectRoot(path);
    if (run.over || stopIfGone(run)) return null;
    const folder = root && !root.tooBroad ? root.folder : undefined;
    const atDocument: Reach = root?.tooBroad
      ? { scope: 'document', note: TOO_BROAD }
      : { scope: 'document' };
    const machine = agent.readLimit === 'machine';
    const allowed = deps.settings.defaultScope();
    if (!machine && (folder === undefined || allowed === 'document')) return atDocument;
    const asked = folder ?? root?.folder ?? '';
    let answer = deps.settings.consent(agent.id, asked);
    // Only the answers that allow something are remembered; a no an earlier version stored asks
    // again. A machine-wide agent has no This document, and no home folder to hold it to.
    if (answer === 'no' || (machine && answer !== 'folder')) answer = undefined;
    if (answer === undefined) {
      const home = !machine && allowed === 'everything';
      const given = await ask(run, asked, home);
      if (given === null || given === 'no' || stopIfGone(run)) return null;
      deps.settings.setConsent(agent.id, asked, given);
      answer = given;
      // The question is answered: the line says the run goes on, and not the question.
      running(run, STARTING);
    }
    // Preferences may have been narrowed while the question was up: the setting as it is now holds.
    const scope = machine ? answer : narrower(answer, deps.settings.defaultScope());
    if (scope === 'document' || folder === undefined) return atDocument;
    return { scope, folder };
  }

  /**
   * Puts the first-run question on the line, and waits for the answer: null if the run stops. The
   * home folder is among the answers if `home`.
   */
  function ask(run: Run, folder: string, home: boolean): Promise<AgentScope | 'no' | null> {
    return new Promise((resolve) => {
      if (run.over) return resolve(null);
      run.answer = (answer) => {
        run.answer = undefined;
        resolve(answer);
      };
      show(
        run.job.thread,
        {
          kind: 'asking',
          ...who(run),
          folder,
          readLimit: run.job.agent.readLimit,
          ...(home ? { home: true as const } : {}),
        },
        run.job.generation,
      );
    });
  }

  /**
   * The home folder and the folders of it for a run at that scope, or none where the host can't
   * name them, and then the run reads the folder only.
   */
  async function withHome(
    reach: Reach,
  ): Promise<{ reach: Reach; home?: { home: string; roots: readonly string[] } }> {
    if (reach.scope !== 'everything') return { reach };
    const home = await Promise.resolve()
      .then(() => deps.homeReach?.())
      .catch((): undefined => undefined);
    if (home && home.roots.length > 0) return { reach, home };
    return { reach: { ...reach, scope: 'folder', note: NO_HOME } };
  }

  /**
   * The folders macOS isn't letting Redlines read, or none where it can't be asked or where it
   * doesn't say within `MACOS_WAIT`.
   */
  function macOsRefused(): Promise<readonly { name: string; folder: string }[]> {
    return new Promise((resolve) => {
      const gone = setTimeout(() => resolve([]), MACOS_WAIT);
      void Promise.resolve()
        .then(() => deps.homeAccess?.() ?? [])
        .catch((): never[] => [])
        .then((found) => {
          clearTimeout(gone);
          resolve(found);
        });
    });
  }

  async function go(run: Run, path: string | null, asked: Reach): Promise<void> {
    const { job } = run;
    const { agent } = job;
    let { reach, home } = await withHome(asked);
    if (run.over || stopIfGone(run)) return;
    // Before the run, not in it: what macOS won't let Redlines read is told to the person and to
    // the agent, which would otherwise fail to find a file, and guess why. The wait can be as long
    // as the person takes to answer macOS, so the line says what it is.
    let refused: readonly { name: string; folder: string }[] = [];
    if (home !== undefined) {
      running(run, CHECKING_MACOS);
      refused = await macOsRefused();
      if (run.over || stopIfGone(run)) return;
      // The folders are listed again once macOS has been asked: the app checks the agent's line
      // against the list it makes when the agent starts, and a folder made while a question was up
      // belongs in it.
      ({ reach, home } = await withHome(asked));
      if (run.over || stopIfGone(run)) return;
    }
    for (const { name, folder } of home === undefined ? [] : refused) {
      tellBlocked(run, { path: folder, cause: 'privacy', place: name });
    }
    const me = deps.author.handle;
    const text = deps.document.read();
    const thread = parse(text).ledger.comments.find(({ id }) => id === job.thread);
    const author: Person = {
      handle: agentHandle(agent.id, me),
      name: agent.name,
      agent: true,
      for: me,
    };
    const ctx: ToolContext = {
      doc: toolDocument(run),
      author,
      thread: job.thread,
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
        ...(refused.length > 0 ? { outOfReach: refused.map(({ folder }) => folder) } : {}),
        ...(home === undefined ? {} : { home: { folder: home.home, roots: home.roots } }),
      }),
      thread: job.thread,
      ...(path === null ? {} : { documentPath: path }),
      ...(reach.folder === undefined ? {} : { folder: reach.folder }),
      scope: reach.scope,
      ...(home === undefined ? {} : { homeFolder: home.home, homeRoots: home.roots }),
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
        if (event.blocked) tellBlocked(run, event.blocked);
      } else if (event.type === 'error') {
        return finish(run, failed(run, event.message, event.setup === true));
      } else {
        return ended(run, ctx, event.finalText);
      }
    }
  }

  /** Tells the window of a read the agent couldn't make, once for each cause and place. */
  function tellBlocked(run: Run, read: BlockedRead): void {
    if (!deps.onBlocked) return;
    const told = (run.told ??= new Set());
    const place = read.place ?? read.path.split('/').slice(0, -1).join('/');
    const key = `${read.cause}|${place}`;
    if (told.has(key)) return;
    told.add(key);
    try {
      deps.onBlocked({
        ...who(run),
        thread: run.job.thread,
        ...(run.logPath === undefined ? {} : { logPath: run.logPath }),
        ...read,
      });
    } catch (error) {
      console.error('Could not tell of a read that was refused', error);
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
    looked: { comment: PostedComment; gone: boolean },
    posted: { generation: number; post: number },
    at: number,
  ): Promise<void> {
    const { comment } = looked;
    const agents = await deps.agents.list();
    if (at !== epoch || generation() !== posted.generation || looked.gone) return;
    const job = (agent: AgentInfo): Job => ({
      agent,
      thread: comment.thread,
      text: comment.text,
      posted: comment.id,
      ...posted,
    });
    const named = mentionedAgents(comment.text, agents).flatMap((id) => {
      const agent = agents.find((candidate) => candidate.id === id);
      return agent ? [job(agent)] : [];
    });
    // Taken back while the agents were looked up: nothing is saved, asked or started for it.
    if (!named.length || !postThere(named[0]!)) return;
    const state = stateOf(comment.thread);
    state.queue.push(...named);
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
      const looked = { comment, gone: false };
      lookingUp.add(looked);
      examining++;
      posts = posts
        .then(() => examine(looked, posted, at))
        .catch((error: unknown) => console.error('Could not look at a posted comment', error))
        .finally(() => {
          lookingUp.delete(looked);
          examining--;
          notify(comment.thread);
        });
    },

    answerConsent(thread, answer) {
      const state = threads.get(thread);
      const run = state?.run;
      if (!run?.answer) return;
      // An agent that reads the whole machine can't be held to this document.
      if (answer === 'document' && run.job.agent.readLimit === 'machine') return;
      // The home folder is an answer only where the question offered it.
      const offered = state?.line?.kind === 'asking' && state.line.home === true;
      if (answer === 'everything' && !offered) return;
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
      for (const [thread, state] of threads) {
        state.queue = state.queue.filter((job) => job.generation === now);
        if (state.run && state.run.job.generation !== now) halt(state.run, null);
        // A line the old document still had, such as a failure, went with it: say so once, so that
        // what shows it, a notification too, goes as well.
        if (state.generation !== now && state.line !== null) {
          state.line = null;
          state.failure = null;
          notify(thread);
        }
      }
    },

    documentChanged() {
      let parsed: Parsed | undefined;
      // A post taken back while its agents are looked up starts nothing, also when Redo brings it
      // back.
      for (const looked of lookingUp) {
        parsed ??= deps.document.parsed();
        const { thread, id } = looked.comment;
        if (!postThere({ thread, posted: id }, parsed)) looked.gone = true;
      }
      for (const state of threads.values()) {
        if (!state.run && !state.queue.length) continue;
        // Read once, and only while something is live.
        parsed ??= deps.document.parsed();
        const read = parsed;
        state.queue = state.queue.filter((job) => postThere(job, read));
        if (state.run) stopIfGone(state.run, read);
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
