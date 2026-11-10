// @vitest-environment happy-dom
import {
  type AgentStep,
  createEditor,
  type Author,
  type Editor,
  redo,
  undo,
} from '@redlines/editor';
import { isId, parse } from '@redlines/format';
import type { AgentScope, AgentState, ProjectRoot } from '@redlines/plugin-api';
import { createReview, type PostedComment, type ReviewController } from '@redlines/review';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  events,
  fakeProvider,
  fakeRelay,
  replies,
  type FakeProvider,
  type FakeRelay,
  type FakeRun,
  type FakeScript,
  type ToolAnswer,
} from './fake-provider.ts';
import { createMacAgents } from './mac-agents.ts';
import { createRuns, type RunController } from './runs.ts';

const me: Author = { handle: 'ada', name: 'Ada Lovelace' };

const PLAN = 'The importer ships in April.\n\nThe tests run in CI.\n';
const REPO: ProjectRoot = { folder: '/repo', isRepo: true, tooBroad: false };

interface Options {
  doc?: string;
  path?: string | null;
  root?: ProjectRoot;
  scope?: 'folder' | 'document';
  consent?: Record<string, AgentScope | 'no'>;
  claude?: FakeScript;
  codex?: FakeScript;
  claudeReads?: 'folder' | 'machine';
  /** How Claude is detected, for a test that holds detection. */
  detect?: () => Promise<AgentState>;
  claudeState?: AgentState;
  /** Holds each save until it opens. */
  saving?: Promise<void>;
  /** Holds each project lookup until it opens. */
  lookup?: Promise<void>;
  /**
   * Whether the editor's changes reach `documentChanged`, as in the app; off, only the run's own
   * checks after each await and before each tool call find a post gone.
   */
  wired?: boolean;
}

interface Setup {
  editor: Editor;
  review: ReviewController;
  runs: RunController;
  relay: FakeRelay;
  claude: FakeProvider;
  codex: FakeProvider;
  posted: PostedComment[];
  /** What the document was asked to do, and what the test makes it answer. */
  doc: {
    path: string | null;
    generation: number;
    saveAnswer: boolean;
    saves: number;
    edits: string[];
    /** The step each edit was handed over as. */
    steps: AgentStep[];
  };
  consent: Record<string, AgentScope | 'no'>;
  ended: () => number;
  /** How many times the project was looked up. */
  lookups: () => number;
}

const mounted: Editor[] = [];

afterEach(() => {
  for (const editor of mounted.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

function setup(options: Options = {}): Setup {
  const parent = document.createElement('div');
  document.body.append(parent);
  // As the app does: each change to the document tells the runs.
  let changed = () => {};
  const editor = createEditor(parent, {
    doc: options.doc ?? PLAN,
    author: me,
    onChange: () => changed(),
  });
  // happy-dom fires `selectionchange` while CodeMirror writes a focused editor's selection; the
  // tests keep the editor unfocused, as the review interface's tests do.
  editor.view.focus = () => {};
  editor.view.contentDOM.focus = () => {};
  mounted.push(editor);

  const relay = fakeRelay();
  const claude = fakeProvider({
    relay,
    script: options.claude ?? replies('Done.'),
    readLimit: options.claudeReads ?? 'folder',
    ...(options.detect ? { detect: options.detect } : {}),
    ...(options.claudeState ? { state: options.claudeState } : {}),
  });
  const codex = fakeProvider({
    relay,
    id: 'codex',
    name: 'Codex',
    script: options.codex ?? replies('Done.'),
  });
  const doc: Setup['doc'] = {
    path: options.path === undefined ? '/repo/plan.md' : options.path,
    generation: 0,
    saveAnswer: true,
    saves: 0,
    edits: [],
    steps: [],
  };
  const consent = options.consent ?? { 'claude|/repo': 'folder', 'codex|/repo': 'folder' };
  let ended = 0;
  let lookups = 0;
  const runs = createRuns({
    agents: createMacAgents([claude, codex], relay),
    author: me,
    document: {
      path: () => doc.path,
      generation: () => doc.generation,
      read: () => editor.getDoc(),
      parsed: () => editor.getParsed(),
      save: async () => {
        doc.saves++;
        await options.saving;
        return doc.saveAnswer;
      },
      applyAgentEdit: (next, step) => {
        doc.edits.push(next);
        doc.steps.push(step);
        editor.applyAgentEdit(next, step);
        return Promise.resolve();
      },
    },
    projectRoot: async () => {
      lookups++;
      await options.lookup;
      return options.root ?? REPO;
    },
    settings: {
      defaultScope: () => options.scope ?? 'folder',
      consent: (agent, folder) => consent[`${agent}|${folder}`],
      setConsent: (agent, folder, answer) => {
        consent[`${agent}|${folder}`] = answer;
      },
    },
    onEnded: () => ended++,
  });
  if (options.wired !== false) changed = () => runs.documentChanged();
  const posted: PostedComment[] = [];
  const review = createReview(editor, {
    author: me,
    onPosted: (comment) => {
      posted.push(comment);
      runs.posted(comment);
    },
  });
  return {
    editor,
    review,
    runs,
    relay,
    claude,
    codex,
    posted,
    doc,
    consent,
    ended: () => ended,
    lookups: () => lookups,
  };
}

/** The box a comment is being written in, when one shows. */
const field = (editor: Editor) =>
  [...editor.view.dom.querySelectorAll<HTMLTextAreaElement>('.rl-note textarea')].find(
    (box) => !box.closest<HTMLElement>('.rl-note-box')?.hidden,
  );

/** Writes `text` in the box that shows, and posts it with ⌘↩. */
function postInBox(editor: Editor, text: string): void {
  const box = field(editor);
  if (!box) throw new Error('No comment box shows');
  box.value = text;
  box.dispatchEvent(new Event('input', { bubbles: true }));
  box.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true, cancelable: true }),
  );
}

/** Comments on `word` with `text` through the comment box, and returns the thread. */
function ask(s: Setup, text: string, word = 'importer'): string {
  const from = s.editor.view.state.doc.toString().indexOf(word);
  expect(from).toBeGreaterThanOrEqual(0);
  s.editor.view.dispatch({ selection: { anchor: from, head: from + word.length } });
  expect(s.review.startComment()).toBe(true);
  postInBox(s.editor, text);
  const posted = s.posted.at(-1);
  if (!posted) throw new Error('Nothing was posted');
  return posted.thread;
}

/** Replies to the only thread in the document through its Reply button. */
function replyInBox(s: Setup, text: string): void {
  const reply = [...s.editor.view.dom.querySelectorAll<HTMLButtonElement>('.rl-note button')].find(
    (button) =>
      button.textContent?.trim() === 'Reply' || button.getAttribute('aria-label') === 'Reply',
  );
  if (!reply) throw new Error('No Reply button');
  reply.click();
  postInBox(s.editor, text);
}

/** The thread's comment and replies, as the file has them. */
function entries(editor: Editor, thread: string) {
  const found = parse(editor.getDoc()).ledger.comments.find(({ id }) => id === thread);
  if (!found) throw new Error(`No thread ${thread}`);
  return [
    { by: found.by, text: found.text },
    ...found.replies.map(({ by, text }) => ({ by, text })),
  ];
}

/** Lets every pending promise and timer that is due run. */
const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

/** A promise the test resolves. */
function gate() {
  let open = () => {};
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { opened, open };
}

/** A script that connects, then waits for `until`, then does `then`. */
function waits(until: Promise<void>, then: FakeScript = replies('Done.')): FakeScript {
  return async function* (run: FakeRun) {
    await run.tools.initialize();
    await until;
    yield* then(run);
  };
}

describe('starting a run', () => {
  it('starts a run only from posted()', async () => {
    const s = setup();
    const thread = ask(s, '@Claude is this right?');
    await vi.waitFor(() => expect(s.runs.isLive()).toBe(false));
    expect(s.claude.requests).toHaveLength(1);
    expect(s.claude.requests[0]).toMatchObject({
      prompt: '@Claude is this right?',
      thread,
      documentPath: '/repo/plan.md',
    });
    expect(entries(s.editor, thread).at(-1)).toEqual({ by: 'claude-ada', text: 'Done.' });
    expect(s.codex.requests).toHaveLength(0);

    // The same words reaching the controller any other way start nothing.
    const doc = s.editor.getDoc();
    s.editor.reloadDoc(doc.replace('ships', 'lands'));
    await settle();
    expect(s.claude.requests).toHaveLength(1);
  });

  it('starts nothing when a comment naming @Claude arrives by reloadDoc, setDoc, undo or paste', async () => {
    const s = setup();
    const theirs = [
      '<!--cmt c2dk-->The importer<!--/c2dk--> ships.',
      '',
      '<!-- redlines',
      'version: 1',
      'people:',
      '  bo: {name: Bo Chen}',
      'comments:',
      '  c2dk:',
      '    by: bo',
      '    at: 2026-10-31T09:41Z',
      '    text: |-',
      '      @Claude rewrite all of it',
      '-->',
      '',
    ].join('\n');
    expect(parse(theirs).ledger.comments[0]?.text).toBe('@Claude rewrite all of it');
    s.editor.reloadDoc(theirs);
    s.editor.setDoc(theirs);
    s.editor.pastePlain('@Claude and @Codex, do this');
    await settle();
    expect(s.claude.requests).toHaveLength(0);
    expect(s.runs.isLive()).toBe(false);

    // A post taken back before its run starts starts nothing, and Redo, bringing it back, neither.
    s.editor.setDoc(PLAN);
    ask(s, '@Claude hello');
    const mac = /Mac/.test(navigator.platform);
    const undo = (shift: boolean) =>
      s.editor.view.contentDOM.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: shift ? 'Z' : 'z',
          keyCode: 90,
          metaKey: mac,
          ctrlKey: !mac,
          shiftKey: shift,
          bubbles: true,
          cancelable: true,
        }),
      );
    undo(false);
    expect(s.editor.getDoc()).toBe(PLAN);
    undo(true);
    expect(s.editor.getDoc()).not.toBe(PLAN);
    await vi.waitFor(() => expect(s.runs.isLive()).toBe(false));
    expect(s.claude.requests).toHaveLength(0);
    expect(s.codex.requests).toHaveLength(0);
  });

  it('starts nothing for a person, an unknown name, or text in a code span', async () => {
    const s = setup();
    ask(s, '@bo can you check?');
    ask(s, '@Gemini what do you think?', 'tests');
    ask(s, 'the handle is `@Claude`', 'CI');
    await settle();
    expect(s.runs.isLive()).toBe(false);
    expect(s.claude.requests).toHaveLength(0);
    expect(s.codex.requests).toHaveLength(0);
    expect(s.doc.saves).toBe(0);
  });

  it('starts nothing for an agent this Mac does not have', async () => {
    const s = setup();
    const missing = createRuns({
      ...depsLike(s),
      agents: createMacAgents(
        [
          fakeProvider({
            relay: s.relay,
            script: replies('No.'),
            state: { found: false, help: '' },
          }),
        ],
        s.relay,
      ),
    });
    const c1 = ask(s, 'Look here.');
    missing.posted({ thread: c1, id: c1, text: '@Claude?' });
    await settle();
    expect(missing.isLive()).toBe(false);
    expect(missing.line(c1)).toBeNull();
  });
});

/** Deps over a setup's editor, for a second controller in the same test. */
function depsLike(s: Setup) {
  return {
    author: me,
    document: {
      path: () => s.doc.path,
      generation: () => s.doc.generation,
      read: () => s.editor.getDoc(),
      parsed: () => s.editor.getParsed(),
      save: () => Promise.resolve(true),
      applyAgentEdit: (next: string, step: AgentStep) => {
        s.editor.applyAgentEdit(next, step);
        return Promise.resolve();
      },
    },
    projectRoot: () => Promise.resolve(REPO),
    settings: {
      defaultScope: () => 'folder' as const,
      consent: () => 'folder' as const,
      setConsent: () => {},
    },
    onEnded: () => {},
  };
}

describe('what an agent may read', () => {
  it('asks once per agent and folder, and remembers the answer in settings', async () => {
    const s = setup({ consent: {} });
    const thread = ask(s, '@Claude does it handle CRLF?');
    await vi.waitFor(() =>
      expect(s.runs.line(thread)).toEqual({
        kind: 'asking',
        agent: 'claude',
        agentName: 'Claude',
        folder: '/repo',
        readLimit: 'folder',
      }),
    );
    expect(s.claude.requests).toHaveLength(0);
    expect(s.runs.isLive()).toBe(true);

    s.runs.answerConsent(thread, 'folder');
    await vi.waitFor(() => expect(s.runs.isLive()).toBe(false));
    expect(s.consent).toEqual({ 'claude|/repo': 'folder' });
    expect(s.claude.requests[0]).toMatchObject({ scope: 'folder', folder: '/repo' });

    // Not again for Claude in this folder.
    replyInBox(s, '@Claude and the tests?');
    await vi.waitFor(() => expect(s.claude.requests).toHaveLength(2));
    expect(s.claude.requests[1]).toMatchObject({ scope: 'folder', folder: '/repo' });
    await vi.waitFor(() => expect(s.runs.isLive()).toBe(false));

    // Codex is asked for itself.
    replyInBox(s, '@Codex you too');
    await vi.waitFor(() =>
      expect(s.runs.line(thread)).toMatchObject({ kind: 'asking', agent: 'codex' }),
    );
    // Not now ends the run quietly, and isn't remembered: the question comes again next time.
    s.runs.answerConsent(thread, 'no');
    await vi.waitFor(() => expect(s.runs.isLive()).toBe(false));
    expect(s.runs.line(thread)).toBeNull();
    expect(s.codex.requests).toHaveLength(0);
    expect(s.consent).toEqual({ 'claude|/repo': 'folder' });
    replyInBox(s, '@Codex please?');
    await vi.waitFor(() =>
      expect(s.runs.line(thread)).toMatchObject({ kind: 'asking', agent: 'codex' }),
    );
    s.runs.answerConsent(thread, 'folder');
    await vi.waitFor(() => expect(s.codex.requests).toHaveLength(1));
    expect(s.consent).toEqual({ 'claude|/repo': 'folder', 'codex|/repo': 'folder' });
  });

  it('asks again where an earlier version stored a no', async () => {
    const s = setup({ consent: { 'claude|/repo': 'no' } });
    const thread = ask(s, '@Claude look');
    await vi.waitFor(() =>
      expect(s.runs.line(thread)).toMatchObject({ kind: 'asking', agent: 'claude' }),
    );
  });

  it('reads the project that holds the document, its repository, not its own folder', async () => {
    const s = setup();
    const asked: string[] = [];
    const runs = createRuns({
      ...depsLike(s),
      document: { ...depsLike(s).document, path: () => '/repo/docs/design/plan.md' },
      agents: createMacAgents([s.claude], s.relay),
      projectRoot: (path) => {
        asked.push(path);
        return Promise.resolve(REPO);
      },
      settings: { defaultScope: () => 'folder', consent: () => undefined, setConsent: () => {} },
    });
    const c1 = ask(s, 'Look here.');
    runs.posted({ thread: c1, id: c1, text: '@Claude look' });
    await vi.waitFor(() =>
      expect(runs.line(c1)).toMatchObject({ kind: 'asking', folder: '/repo' }),
    );
    expect(asked).toEqual(['/repo/docs/design/plan.md']);
    runs.answerConsent(c1, 'folder');
    await vi.waitFor(() => expect(s.claude.requests).toHaveLength(1));
    expect(s.claude.requests[0]).toMatchObject({
      scope: 'folder',
      folder: '/repo',
      documentPath: '/repo/docs/design/plan.md',
    });
    expect(s.claude.requests[0]?.systemPrompt).toContain('"/repo"');
  });

  it('fails on the line, guessing no folder, when the project can’t be found', async () => {
    const s = setup();
    const runs = createRuns({
      ...depsLike(s),
      agents: createMacAgents([s.claude], s.relay),
      projectRoot: () => Promise.reject(new Error('The app could not be reached.')),
    });
    const c1 = ask(s, 'Look here.');
    runs.posted({ thread: c1, id: c1, text: '@Claude look' });
    await vi.waitFor(() =>
      expect(runs.line(c1)).toMatchObject({
        kind: 'failed',
        message: "Claude didn't start: The app could not be reached.",
      }),
    );
    expect(s.claude.requests).toHaveLength(0);
  });

  it('runs at This document and passes no folder when told so', async () => {
    const s = setup({ consent: {} });
    const thread = ask(s, '@Claude check this');
    await vi.waitFor(() => expect(s.runs.line(thread)?.kind).toBe('asking'));
    s.runs.answerConsent(thread, 'document');
    await vi.waitFor(() => expect(s.runs.isLive()).toBe(false));
    expect(s.consent).toEqual({ 'claude|/repo': 'document' });
    const [request] = s.claude.requests;
    expect(request?.scope).toBe('document');
    expect(request).not.toHaveProperty('folder');
    expect(request?.systemPrompt).toContain('Read only this document.');

    // Preferences can say This document for every folder, and then nothing asks.
    const t = setup({ consent: {}, scope: 'document' });
    ask(t, '@Claude check this');
    await vi.waitFor(() => expect(t.claude.requests).toHaveLength(1));
    expect(t.claude.requests[0]?.scope).toBe('document');
    expect(t.claude.requests[0]).not.toHaveProperty('folder');

    // A document with no file has no folder: nothing asks, and nothing is saved.
    const u = setup({ consent: {}, path: null });
    ask(u, '@Claude check this');
    await vi.waitFor(() => expect(u.claude.requests).toHaveLength(1));
    expect(u.claude.requests[0]).toMatchObject({ scope: 'document' });
    expect(u.claude.requests[0]).not.toHaveProperty('folder');
    expect(u.claude.requests[0]).not.toHaveProperty('documentPath');
    expect(u.doc.saves).toBe(0);
  });

  it('falls back to This document for a too-broad folder and says so on the line', async () => {
    const release = gate();
    const s = setup({
      consent: {},
      root: { folder: '/Users/ada', isRepo: false, tooBroad: true },
      claude: waits(release.opened),
    });
    const thread = ask(s, '@Claude look');
    await vi.waitFor(() => expect(s.claude.requests).toHaveLength(1));
    expect(s.claude.requests[0]?.scope).toBe('document');
    expect(s.claude.requests[0]).not.toHaveProperty('folder');
    const line = s.runs.line(thread);
    expect(line?.kind).toBe('running');
    expect(line?.kind === 'running' && line.status).toMatch(/this document/i);
    expect(s.consent).toEqual({});
    release.open();
    await vi.waitFor(() => expect(s.runs.isLive()).toBe(false));
  });

  it('asks a machine-wide agent "Let it read files on this Mac?" and offers no Just this document', async () => {
    // A fake provider: Claude and Codex both hold their reads to the folder.
    const s = setup({ consent: {}, scope: 'document', claudeReads: 'machine' });
    const thread = ask(s, '@Claude look');
    await vi.waitFor(() =>
      expect(s.runs.line(thread)).toEqual({
        kind: 'asking',
        agent: 'claude',
        agentName: 'Claude',
        folder: '/repo',
        readLimit: 'machine',
      }),
    );
    // Just this document can't be held to, so it isn't an answer.
    s.runs.answerConsent(thread, 'document');
    await settle();
    expect(s.runs.line(thread)?.kind).toBe('asking');
    expect(s.claude.requests).toHaveLength(0);
    s.runs.answerConsent(thread, 'folder');
    await vi.waitFor(() => expect(s.runs.isLive()).toBe(false));
    expect(s.consent).toEqual({ 'claude|/repo': 'folder' });
    expect(s.claude.requests[0]).toMatchObject({ scope: 'folder', folder: '/repo' });
  });
});

describe('a run', () => {
  it('fails the run out loud when the program ends and the toolbox never connected', async () => {
    const s = setup({
      // Both agents carry on without their tools, and end well.
      claude: events(
        { type: 'status', text: 'Thinking…' },
        { type: 'done', finalText: "Redlines tools aren't available." },
      ),
    });
    const thread = ask(s, '@Claude hi');
    const posted = s.editor.getDoc();
    await vi.waitFor(() =>
      expect(s.runs.line(thread)).toEqual({
        kind: 'failed',
        agent: 'claude',
        agentName: 'Claude',
        message: "Claude couldn't start Redlines' tools. Try again, or restart Redlines.",
      }),
    );
    expect(s.editor.getDoc()).toBe(posted);
    await vi.waitFor(() => expect(s.relay.counts()).toEqual({ opened: 1, closed: 1 }));
  });

  it('saves before starting, and shows why on the line when saving is cancelled', async () => {
    let savesAtStart = -1;
    const s = setup({
      async *claude(run) {
        savesAtStart = s.doc.saves;
        yield* replies('Done.')(run);
      },
    });
    ask(s, '@Claude hi');
    await vi.waitFor(() => expect(s.runs.isLive()).toBe(false));
    expect(savesAtStart).toBe(1);

    s.doc.saveAnswer = false;
    const thread = ask(s, '@Claude again', 'tests');
    await vi.waitFor(() =>
      expect(s.runs.line(thread)).toMatchObject({
        kind: 'failed',
        agent: 'claude',
        message: "Claude didn't start, because the document wasn't saved.",
      }),
    );
    expect(s.claude.requests).toHaveLength(1);
    expect(s.runs.isLive()).toBe(false);
  });

  it('gives every provider the rule for a reply, and keeps a reply that holds the new text', async () => {
    const edit = 'Show progress for slow Word imports.';
    const s = setup({
      claude: replies(`Shortened to: “${edit}”`),
      codex: replies(`Shortened to: “${edit}”`),
    });
    const first = ask(s, '@Claude shorten this');
    await vi.waitFor(() => expect(s.runs.isLive()).toBe(false));
    const second = ask(s, '@Codex shorten this');
    await vi.waitFor(() => expect(s.codex.requests).toHaveLength(1));
    await vi.waitFor(() => expect(s.runs.isLive()).toBe(false));
    for (const request of [s.claude.requests[0], s.codex.requests[0]]) {
      expect(request?.systemPrompt).toContain('what you did, in a few words');
      expect(request?.systemPrompt).toContain('"Cut it from 40 to 18 words."');
    }
    // The rule is the model's to follow: a reply is not filtered for repeating the edit.
    expect(entries(s.editor, first).at(-1)?.text).toBe(`Shortened to: “${edit}”`);
    expect(entries(s.editor, second).at(-1)?.text).toBe(`Shortened to: “${edit}”`);
  });

  it('writes the reply with the agent as author, handle claude-<me>, for <me>', async () => {
    const s = setup({ claude: replies('CRLF handled in importer.ts:42.') });
    const thread = ask(s, '@Claude does it handle CRLF?');
    await vi.waitFor(() => expect(s.runs.isLive()).toBe(false));
    expect(s.claude.requests[0]?.author).toEqual({
      handle: 'claude-ada',
      name: 'Claude',
      for: 'ada',
    });
    expect(entries(s.editor, thread)).toEqual([
      { by: 'ada', text: '@Claude does it handle CRLF?' },
      { by: 'claude-ada', text: 'CRLF handled in importer.ts:42.' },
    ]);
    const person = parse(s.editor.getDoc()).ledger.people.find((p) => p.handle === 'claude-ada');
    expect(person).toMatchObject({ name: 'Claude', agent: true, for: 'ada' });
    expect(s.runs.line(thread)).toBeNull();
    expect(s.ended()).toBe(1);
  });

  it('keeps typing: a typed edit and an agent edit both survive, and the caret stays', async () => {
    const release = gate();
    const s = setup({
      claude: waits(release.opened, async function* ({ tools }) {
        await tools.call('str_replace', { old_str: 'run in CI', new_str: 'run nightly' });
        await tools.call('reply', { text: 'Changed to nightly.' });
        yield { type: 'done' };
      }),
    });
    ask(s, '@Claude make it nightly');
    await vi.waitFor(() => expect(s.claude.requests).toHaveLength(1));
    // The person types at the start of the first line while the agent works.
    s.editor.view.dispatch({
      changes: { from: 0, insert: 'Today ' },
      selection: { anchor: 'Today '.length },
      userEvent: 'input.type',
    });
    release.open();
    await vi.waitFor(() => expect(s.runs.isLive()).toBe(false));
    const doc = s.editor.getDoc();
    expect(doc.startsWith('Today The ')).toBe(true);
    expect(parse(doc).text).toContain('nightly');
    expect(parse(doc).marks.some((mark) => mark.entry.by === 'claude-ada')).toBe(true);
    expect(s.editor.view.state.selection.main.head).toBe('Today '.length);
  });

  it('hands each agent edit to the document, in order', async () => {
    const s = setup({
      async *claude({ tools }) {
        await tools.initialize();
        await tools.call('str_replace', { old_str: 'April', new_str: 'May' });
        await tools.call('str_replace', { old_str: 'CI', new_str: 'the nightly build' });
        await tools.call('reply', { text: 'Two edits.' });
        yield { type: 'done' };
      },
    });
    ask(s, '@Claude edit');
    await vi.waitFor(() => expect(s.runs.isLive()).toBe(false));
    expect(s.doc.edits).toHaveLength(3);
    expect(s.doc.edits[0]).toContain('May');
    expect(s.doc.edits[0]).not.toContain('nightly');
    expect(s.doc.edits[1]).toContain('nightly');
    expect(s.doc.edits[2]).toBe(s.editor.getDoc());
  });

  it('writes each edit of a run as a step of its run, by its agent', async () => {
    const s = setup({
      async *claude({ tools }) {
        await tools.initialize();
        await tools.call('str_replace', { old_str: 'April', new_str: 'May' });
        await tools.call('str_replace', { old_str: 'CI', new_str: 'the nightly build' });
        await tools.call('reply', { text: 'Two edits.' });
        yield { type: 'done' };
      },
    });
    ask(s, '@Claude edit');
    await vi.waitFor(() => expect(s.runs.isLive()).toBe(false));
    expect(s.doc.steps).toEqual([
      { group: 'run-1', agent: 'Claude' },
      { group: 'run-1', agent: 'Claude' },
      { group: 'run-1', agent: 'Claude' },
    ]);
  });

  it('gives each run its group, also two agents named in one comment', async () => {
    const s = setup();
    ask(s, '@Claude @Codex have a look');
    await vi.waitFor(() => expect(s.codex.requests).toHaveLength(1));
    await vi.waitFor(() => expect(s.runs.isLive()).toBe(false));
    expect(s.doc.steps).toEqual([
      { group: 'run-1', agent: 'Claude' },
      { group: 'run-2', agent: 'Codex' },
    ]);
  });

  it('takes back a whole run, its reply included, with one undo', async () => {
    const s = setup({
      async *claude({ tools }) {
        await tools.initialize();
        await tools.call('str_replace', { old_str: 'April', new_str: 'May' });
        await tools.call('reply', { text: 'Moved it.' });
        yield { type: 'done' };
      },
    });
    ask(s, '@Claude move it');
    const posted = s.editor.getDoc();
    await vi.waitFor(() => expect(s.runs.isLive()).toBe(false));
    expect(s.editor.getDoc()).not.toBe(posted);
    expect(undo(s.editor.view)).toBe(true);
    expect(s.editor.getDoc()).toBe(posted);
  });

  it('runs one at a time in a thread, and two named agents one after the other', async () => {
    const first = gate();
    const second = gate();
    const s = setup({ claude: waits(first.opened), codex: waits(second.opened) });
    const thread = ask(s, '@Claude and @Codex, both of you');
    await vi.waitFor(() => expect(s.claude.requests).toHaveLength(1));
    // Another mention in the same thread waits too.
    replyInBox(s, '@Claude one more');
    await settle();
    expect(s.codex.requests).toHaveLength(0);
    expect(s.claude.requests).toHaveLength(1);
    expect(s.runs.line(thread)).toMatchObject({ kind: 'running', agent: 'claude' });

    first.open();
    await vi.waitFor(() => expect(s.codex.requests).toHaveLength(1));
    expect(s.runs.line(thread)).toMatchObject({ kind: 'running', agent: 'codex' });
    expect(s.claude.requests).toHaveLength(1);
    second.open();
    await vi.waitFor(() => expect(s.runs.isLive()).toBe(false));
    expect(s.claude.requests).toHaveLength(2);
    expect(entries(s.editor, thread).map(({ by }) => by)).toEqual([
      'ada',
      'ada',
      'claude-ada',
      'codex-ada',
      'claude-ada',
    ]);
  });

  it('puts back the first agent’s failure when the next one named in the post ends well', async () => {
    const release = gate();
    const s = setup({
      claude: events({
        type: 'error',
        message: 'Claude has hit its usage limit. Try again later.',
      }),
      codex: waits(release.opened),
    });
    const thread = ask(s, '@Claude and @Codex, both');
    const failed = {
      kind: 'failed',
      agent: 'claude',
      agentName: 'Claude',
      message: 'Claude has hit its usage limit. Try again later.',
    };
    // While Codex runs, its line takes the failure's place.
    await vi.waitFor(() =>
      expect(s.runs.line(thread)).toMatchObject({ kind: 'running', agent: 'codex' }),
    );
    release.open();
    await vi.waitFor(() => expect(s.runs.isLive()).toBe(false));
    expect(entries(s.editor, thread).at(-1)).toEqual({ by: 'codex-ada', text: 'Done.' });
    expect(s.runs.line(thread)).toEqual(failed);

    // Not a failure from an earlier post: a later post that ends well shows nothing.
    s.runs.dismiss(thread);
    s.claude.script = replies('Fine now.');
    replyInBox(s, '@Claude again');
    await vi.waitFor(() => expect(s.runs.isLive()).toBe(false));
    expect(s.runs.line(thread)).toBeNull();
  });

  it('shows the later failure when both agents named in the post fail', async () => {
    const s = setup({
      claude: events({ type: 'error', message: 'Claude failed.' }),
      codex: events({ type: 'error', message: 'Codex failed.' }),
    });
    const thread = ask(s, '@Claude @Codex');
    await vi.waitFor(() => expect(s.runs.isLive()).toBe(false));
    expect(s.runs.line(thread)).toMatchObject({ kind: 'failed', message: 'Codex failed.' });
  });

  it('uses the last message as the reply when the agent never called reply', async () => {
    const long = `${'Handled in importer.ts:42, and in the tests. '.repeat(6)}\n\nThe rest is here.`;
    const s = setup({
      async *claude({ tools }) {
        await tools.initialize();
        yield { type: 'done', finalText: long };
      },
    });
    const thread = ask(s, '@Claude CRLF?');
    await vi.waitFor(() => expect(s.runs.isLive()).toBe(false));
    const reply = entries(s.editor, thread).at(-1);
    expect(reply?.by).toBe('claude-ada');
    const [shown, more] = reply?.text.split('\n\n') ?? [];
    expect(Array.from(shown ?? '').length).toBeLessThanOrEqual(200);
    expect(shown?.endsWith('…')).toBe(true);
    expect(more).toContain('The rest is here.');
    expect(s.runs.line(thread)).toBeNull();
  });

  it('says so on the line when the agent ends with nothing to say', async () => {
    const s = setup({
      async *claude({ tools }) {
        await tools.initialize();
        yield { type: 'done' };
      },
    });
    const thread = ask(s, '@Claude anything?');
    const posted = s.editor.getDoc();
    await vi.waitFor(() =>
      expect(s.runs.line(thread)).toMatchObject({
        kind: 'failed',
        message: 'Claude ended with nothing to say.',
      }),
    );
    expect(s.editor.getDoc()).toBe(posted);
  });

  it('shows a failure on the line until dismissed or the next post, and writes nothing about it', async () => {
    const failing: FakeScript = async function* ({ tools }) {
      await tools.initialize();
      yield { type: 'error', message: "Claude isn't signed in. Run `claude auth login`." };
    };
    const s = setup({ claude: failing });
    const thread = ask(s, '@Claude hi');
    const posted = s.editor.getDoc();
    const failed = {
      kind: 'failed',
      agent: 'claude',
      agentName: 'Claude',
      message: "Claude isn't signed in. Run `claude auth login`.",
    };
    await vi.waitFor(() => expect(s.runs.line(thread)).toEqual(failed));
    expect(s.editor.getDoc()).toBe(posted);
    expect(s.editor.getDoc()).not.toContain('signed in');
    await settle();
    expect(s.runs.line(thread)).toEqual(failed);
    s.runs.dismiss(thread);
    expect(s.runs.line(thread)).toBeNull();

    // Again, and then a post in the thread puts it away.
    replyInBox(s, '@Claude again');
    await vi.waitFor(() => expect(s.runs.line(thread)).toEqual(failed));
    replyInBox(s, 'Never mind.');
    expect(s.runs.line(thread)).toBeNull();
    expect(s.editor.getDoc()).not.toContain('signed in');
  });

  it('says a signed-out agent is signed out before running it', async () => {
    const s = setup();
    const signedOut = createRuns({
      ...depsLike(s),
      agents: createMacAgents(
        [
          fakeProvider({
            relay: s.relay,
            script: replies('No.'),
            state: {
              found: true,
              signedIn: false,
              reason: 'signed-out',
              version: '2.1.318',
              help: 'Run `claude auth login`.',
            },
          }),
        ],
        s.relay,
      ),
    });
    const c1 = ask(s, 'Look here.');
    signedOut.posted({ thread: c1, id: c1, text: '@Claude?' });
    await vi.waitFor(() =>
      expect(signedOut.line(c1)).toMatchObject({
        kind: 'failed',
        message: "Claude isn't signed in. Run `claude auth login`.",
      }),
    );
  });

  it('says a program that is too old is too old, by the reason detection gives', async () => {
    const s = setup();
    const tooOld = createRuns({
      ...depsLike(s),
      agents: createMacAgents(
        [
          fakeProvider({
            relay: s.relay,
            script: replies('No.'),
            // The help need not name the version for the reason to count.
            state: {
              found: true,
              signedIn: false,
              reason: 'too-old',
              version: '2.1.201',
              help: 'Update Claude Code to 2.1.318 or newer.',
            },
          }),
        ],
        s.relay,
      ),
    });
    const c1 = ask(s, 'Look here.');
    tooOld.posted({ thread: c1, id: c1, text: '@Claude?' });
    await vi.waitFor(() =>
      expect(tooOld.line(c1)).toMatchObject({
        kind: 'failed',
        message: 'Update Claude Code to 2.1.318 or newer.',
      }),
    );
  });

  it('asks the host to look for agents again after a run fails for sign-in', async () => {
    const s = setup();
    const agents = createMacAgents(
      [
        fakeProvider({
          relay: s.relay,
          script: replies('No.'),
          state: { found: true, signedIn: false, reason: 'signed-out', help: 'Sign in.' },
        }),
      ],
      s.relay,
    );
    const forget = vi.spyOn(agents, 'forget');
    const runs = createRuns({ ...depsLike(s), agents });
    const c1 = ask(s, 'Look here.');
    runs.posted({ thread: c1, id: c1, text: '@Claude?' });
    await vi.waitFor(() => expect(runs.line(c1)?.kind).toBe('failed'));
    expect(forget).toHaveBeenCalled();
  });

  it('names the run’s log on a failure, once the program has said where it is', async () => {
    const s = setup({
      claude: events(
        { type: 'started', logPath: '/logs/claude.jsonl' },
        { type: 'error', message: 'Claude has hit its usage limit. Try again later.' },
      ),
    });
    const thread = ask(s, '@Claude hi');
    await vi.waitFor(() =>
      expect(s.runs.line(thread)).toEqual({
        kind: 'failed',
        agent: 'claude',
        agentName: 'Claude',
        message: 'Claude has hit its usage limit. Try again later.',
        logPath: '/logs/claude.jsonl',
      }),
    );

    // Also for a failure the app finds, such as tools that never started.
    s.claude.script = events(
      { type: 'started', logPath: '/logs/claude-2.jsonl' },
      { type: 'done', finalText: 'No tools.' },
    );
    replyInBox(s, '@Claude again');
    await vi.waitFor(() =>
      expect(s.runs.line(thread)).toMatchObject({
        kind: 'failed',
        message: "Claude couldn't start Redlines' tools. Try again, or restart Redlines.",
        logPath: '/logs/claude-2.jsonl',
      }),
    );
  });

  it('keeps tracked edits made before a failure', async () => {
    const s = setup({
      async *claude({ tools }) {
        await tools.initialize();
        await tools.call('str_replace', { old_str: 'April', new_str: 'May' });
        yield { type: 'error', message: 'Claude has hit its usage limit. Try again later.' };
      },
    });
    const thread = ask(s, '@Claude move it');
    await vi.waitFor(() => expect(s.runs.line(thread)?.kind).toBe('failed'));
    const parsed = parse(s.editor.getDoc());
    expect(parsed.text).toContain('May');
    expect(parsed.marks.some((mark) => mark.entry.by === 'claude-ada')).toBe(true);
  });

  it('stops the run when the window closes, and no later tool call changes anything', async () => {
    const release = gate();
    let signal: AbortSignal | undefined;
    let late: ToolAnswer | Error | undefined;
    const s = setup({
      async *claude({ tools, signal: given }) {
        signal = given;
        await tools.initialize();
        await release.opened;
        late = await tools
          .call('str_replace', { old_str: 'April', new_str: 'May' })
          .catch((error: unknown) => error as Error);
        yield { type: 'done' };
      },
    });
    const thread = ask(s, '@Claude move it');
    await vi.waitFor(() => expect(s.claude.requests).toHaveLength(1));
    const before = s.editor.getDoc();
    s.runs.stopAll();
    expect(signal?.aborted).toBe(true);
    expect(s.runs.isLive()).toBe(false);
    release.open();
    await vi.waitFor(() => expect(late).toBeDefined());
    expect(late instanceof Error || late?.isError).toBe(true);
    expect(s.editor.getDoc()).toBe(before);
    expect(s.doc.edits).toEqual([]);
    expect(s.runs.line(thread)).toMatchObject({ kind: 'failed', message: 'Stopped.' });
  });

  it('starts nothing after stopAll while a post is still being looked at', async () => {
    const s = setup();
    const agents = createMacAgents([s.claude], s.relay);
    type Found = Awaited<ReturnType<typeof agents.list>>;
    let found: ((list: Found) => void) | undefined;
    const slow = {
      ...agents,
      list: () => new Promise<Found>((resolve) => (found = resolve)),
    };
    const runs = createRuns({ ...depsLike(s), agents: slow });
    const c1 = ask(s, 'Look here.');
    runs.posted({ thread: c1, id: c1, text: '@Claude go' });
    expect(runs.isLive()).toBe(true);
    // The window closes while the agents are being looked for.
    await vi.waitFor(() => expect(found).toBeDefined());
    runs.stopAll();
    found?.(await agents.list());
    await settle();
    expect(s.claude.requests).toHaveLength(0);
    expect(runs.isLive()).toBe(false);
    expect(runs.line(c1)).toBeNull();
  });

  it('asks nothing for a run stopped while its folder was being found', async () => {
    const s = setup();
    let root: (root: ProjectRoot) => void = () => {};
    const runs = createRuns({
      ...depsLike(s),
      agents: createMacAgents([s.claude], s.relay),
      projectRoot: () => new Promise<ProjectRoot>((resolve) => (root = resolve)),
      settings: { defaultScope: () => 'folder', consent: () => undefined, setConsent: () => {} },
    });
    const c1 = ask(s, 'Look here.');
    runs.posted({ thread: c1, id: c1, text: '@Claude go' });
    await vi.waitFor(() => expect(runs.line(c1)?.kind).toBe('running'));
    runs.stop(c1);
    root(REPO);
    await settle();
    expect(runs.line(c1)).toMatchObject({ kind: 'failed', message: 'Stopped.' });
    expect(s.claude.requests).toHaveLength(0);
  });

  it('is live from the post until the run ends, for the sidebar and File ▸ Open to go around', async () => {
    const release = gate();
    const s = setup({ consent: {}, claude: waits(release.opened) });
    expect(s.runs.isLive()).toBe(false);
    const thread = ask(s, '@Claude go');
    expect(s.runs.isLive()).toBe(true);
    await vi.waitFor(() => expect(s.runs.line(thread)?.kind).toBe('asking'));
    expect(s.runs.isLive()).toBe(true);
    s.runs.answerConsent(thread, 'folder');
    await vi.waitFor(() => expect(s.claude.requests).toHaveLength(1));
    expect(s.runs.isLive()).toBe(true);
    release.open();
    await vi.waitFor(() => expect(s.runs.isLive()).toBe(false));
  });

  it('refuses a tool call that arrives after the document changed under it', async () => {
    const release = gate();
    let signal: AbortSignal | undefined;
    let late: ToolAnswer | undefined;
    const s = setup({
      async *claude({ tools, signal: given }) {
        signal = given;
        await tools.initialize();
        await release.opened;
        late = await tools.call('str_replace', { old_str: 'April', new_str: 'May' });
        yield { type: 'done' };
      },
    });
    ask(s, '@Claude move it');
    await vi.waitFor(() => expect(s.claude.requests).toHaveLength(1));
    // Another document takes this one's place.
    const other = 'Another file, shipping in April.\n';
    s.doc.generation++;
    s.editor.setDoc(other);
    release.open();
    await vi.waitFor(() => expect(late).toBeDefined());
    expect(late?.isError).toBe(true);
    expect(late?.text).toMatch(/document changed/i);
    expect(s.editor.getDoc()).toBe(other);
    expect(s.doc.edits).toEqual([]);
    expect(signal?.aborted).toBe(true);
    expect(s.runs.isLive()).toBe(false);
  });

  it('ends a replaced document’s runs when told, and isLive only looks', async () => {
    const s = setup({ claude: waits(new Promise(() => {})) });
    const thread = ask(s, '@Claude wait');
    await vi.waitFor(() => expect(s.claude.requests).toHaveLength(1));
    s.doc.generation++;
    // Asking changes nothing, however often.
    expect(s.runs.isLive()).toBe(true);
    expect(s.runs.isLive()).toBe(true);
    expect(s.ended()).toBe(0);
    s.runs.documentReplaced();
    expect(s.runs.isLive()).toBe(false);
    expect(s.ended()).toBe(1);
    // Its line went with its document.
    expect(s.runs.line(thread)).toBeNull();
  });

  it('tells its listeners of every line that went with a replaced document', async () => {
    const s = setup({ claude: events({ type: 'error', message: 'Claude stopped: no network.' }) });
    const failed = ask(s, '@Claude one');
    await vi.waitFor(() => expect(s.runs.line(failed)?.kind).toBe('failed'));
    // A failure, which no run holds any more, and nothing else in the document.
    const told: [string, unknown][] = [];
    s.runs.subscribe((thread) => told.push([thread, s.runs.line(thread)]));
    s.doc.generation++;
    s.runs.documentReplaced();
    expect(told).toEqual([[failed, null]]);
    // Told once: the next document's lines are its own.
    told.length = 0;
    s.runs.documentReplaced();
    expect(told).toEqual([]);
  });

  it('gives a fresh group to each edit that makes several marks', async () => {
    const edit = (from: string, to: string): FakeScript =>
      async function* ({ tools }) {
        await tools.initialize();
        await tools.call('str_replace', { old_str: from, new_str: to });
        await tools.call('reply', { text: 'Done.' });
        yield { type: 'done' };
      };
    const s = setup({ claude: edit('importer ships in April', 'new importer will ship in May') });
    ask(s, '@Claude one');
    await vi.waitFor(() => expect(s.runs.isLive()).toBe(false));
    s.claude.script = edit('tests run in CI', 'unit tests will run in the nightly build');
    ask(s, '@Claude two', 'tests');
    await vi.waitFor(() => expect(s.runs.isLive()).toBe(false));
    const groups = parse(s.editor.getDoc())
      .marks.filter((mark) => mark.entry.by === 'claude-ada')
      .map((mark) => mark.entry.group);
    expect(groups.length).toBeGreaterThan(2);
    expect(groups.every((group) => group !== undefined && isId(group))).toBe(true);
    expect(new Set(groups).size).toBe(2);
  });

  it('leaves a run with a hung agent stoppable, and says nothing is wrong until it is stopped', async () => {
    const s = setup({
      async *claude({ tools }) {
        await tools.initialize();
        await tools.call('status', { text: 'Reading the importer' });
        yield { type: 'status', text: 'Thinking…' };
        // It never ends, and doesn't listen for Stop.
        await new Promise(() => {});
      },
    });
    const thread = ask(s, '@Claude hang');
    await vi.waitFor(() =>
      expect(s.runs.line(thread)).toEqual({
        kind: 'running',
        agent: 'claude',
        agentName: 'Claude',
        status: 'Thinking…',
      }),
    );
    await settle();
    expect(s.runs.line(thread)?.kind).toBe('running');
    expect(s.runs.isLive()).toBe(true);

    s.runs.stop(thread);
    expect(s.runs.line(thread)).toMatchObject({ kind: 'failed', message: 'Stopped.' });
    expect(s.runs.isLive()).toBe(false);
    expect(s.ended()).toBe(1);

    // The thread is free for the next run.
    s.claude.script = replies('Back.');
    replyInBox(s, '@Claude try again');
    await vi.waitFor(() => expect(entries(s.editor, thread).at(-1)?.text).toBe('Back.'));
  });

  it('shows the status the agent sets, and what its program says', async () => {
    const release = gate();
    const s = setup({
      async *claude({ tools }) {
        await tools.initialize();
        await tools.call('status', { text: 'Reading the importer' });
        await release.opened;
        yield { type: 'status', text: 'Editing' };
        await tools.call('reply', { text: 'Done.' });
        yield { type: 'done' };
      },
    });
    const thread = ask(s, '@Claude go');
    await vi.waitFor(() =>
      expect(s.runs.line(thread)).toMatchObject({
        kind: 'running',
        status: 'Reading the importer',
      }),
    );
    const heard: string[] = [];
    const stop = s.runs.subscribe((t) => heard.push(t));
    release.open();
    await vi.waitFor(() => expect(s.runs.isLive()).toBe(false));
    stop();
    expect(heard.every((t) => t === thread)).toBe(true);
    expect(heard.length).toBeGreaterThan(0);
  });
});

describe('a run whose comment is gone', () => {
  it('starts nothing for a comment taken back while the agents are looked up', async () => {
    const detected = gate();
    const s = setup({
      detect: () => detected.opened.then(() => ({ found: true, signedIn: true })),
    });
    const thread = ask(s, '@Claude is this right?');
    expect(undo(s.editor.view)).toBe(true);
    detected.open();
    await settle();
    expect(s.runs.isLive()).toBe(false);
    expect(s.doc.saves).toBe(0);
    expect(s.claude.requests).toHaveLength(0);
    expect(s.runs.line(thread)).toBeNull();
  });

  it('stops a run whose comment is taken back while it saves, asks or runs, with no line', async () => {
    // While it saves.
    const saved = gate();
    const saving = setup({ saving: saved.opened });
    const one = ask(saving, '@Claude look');
    await vi.waitFor(() => expect(saving.doc.saves).toBe(1));
    undo(saving.editor.view);
    saved.open();
    await settle();
    expect(saving.runs.line(one)).toBeNull();
    expect(saving.runs.isLive()).toBe(false);
    expect(saving.claude.requests).toHaveLength(0);

    // While it asks.
    const asking = setup({ consent: {} });
    const two = ask(asking, '@Claude look');
    await vi.waitFor(() => expect(asking.runs.line(two)?.kind).toBe('asking'));
    undo(asking.editor.view);
    await settle();
    expect(asking.runs.line(two)).toBeNull();
    expect(asking.runs.isLive()).toBe(false);
    expect(asking.claude.requests).toHaveLength(0);
    expect(asking.consent).toEqual({});

    // While it runs.
    const go = gate();
    let signal: AbortSignal | undefined;
    let late: ToolAnswer | undefined;
    const running = setup({
      async *claude({ tools, signal: given }) {
        signal = given;
        await tools.initialize();
        await go.opened;
        late = await tools.call('str_replace', { old_str: 'April', new_str: 'May' });
        yield { type: 'done' };
      },
    });
    const three = ask(running, '@Claude look');
    await vi.waitFor(() => expect(running.claude.requests).toHaveLength(1));
    await settle();
    undo(running.editor.view);
    await settle();
    expect(running.runs.line(three)).toBeNull();
    expect(signal?.aborted).toBe(true);
    go.open();
    await settle();
    expect(late?.isError).toBe(true);
    expect(running.editor.getDoc()).not.toContain('May');
  });

  it('stops a reply’s run in an older thread when the reply is taken back, and answers nothing there', async () => {
    const go = gate();
    let late: ToolAnswer | undefined;
    const s = setup({
      async *claude({ tools }) {
        await tools.initialize();
        await go.opened;
        late = await tools.call('reply', { text: 'An answer to the older request.' });
        yield { type: 'done' };
      },
    });
    const thread = ask(s, 'Is April right?');
    replyInBox(s, '@Claude what do you think?');
    await vi.waitFor(() => expect(s.claude.requests).toHaveLength(1));
    await settle();
    undo(s.editor.view);
    await settle();
    expect(s.runs.line(thread)).toBeNull();
    go.open();
    await settle();
    expect(late?.isError).toBe(true);
    expect(entries(s.editor, thread)).toEqual([{ by: 'ada', text: 'Is April right?' }]);
  });

  it('puts no earlier failure of the post back on the line when its run stops for its post', async () => {
    const go = gate();
    const s = setup({
      claudeState: { found: true, signedIn: false, reason: 'signed-out' },
      codex: waits(go.opened),
    });
    const thread = ask(s, '@Claude @Codex look');
    await vi.waitFor(() => expect(s.codex.requests).toHaveLength(1));
    expect(s.runs.line(thread)).toMatchObject({ kind: 'running', agent: 'codex' });
    undo(s.editor.view);
    await settle();
    expect(s.runs.line(thread)).toBeNull();
    go.open();
    await settle();
    expect(s.runs.line(thread)).toBeNull();
  });

  it('starts nothing when the comment comes back with Redo', async () => {
    // Taken back and brought back while the agents are looked up.
    const detected = gate();
    const s = setup({
      detect: () => detected.opened.then(() => ({ found: true, signedIn: true })),
    });
    ask(s, '@Claude look');
    undo(s.editor.view);
    expect(redo(s.editor.view)).toBe(true);
    detected.open();
    await settle();
    expect(s.claude.requests).toHaveLength(0);
    expect(s.doc.saves).toBe(0);

    // Taken back while it runs, and brought back.
    const go = gate();
    const t = setup({ claude: waits(go.opened) });
    const thread = ask(t, '@Claude look');
    await vi.waitFor(() => expect(t.claude.requests).toHaveLength(1));
    undo(t.editor.view);
    redo(t.editor.view);
    go.open();
    await settle();
    expect(t.claude.requests).toHaveLength(1);
    expect(t.runs.isLive()).toBe(false);
    expect(t.runs.line(thread)).toBeNull();
  });

  it('reads nothing while nothing is live', () => {
    const s = setup();
    const parsed = vi.fn(() => s.editor.getParsed());
    const runs = createRuns({
      ...depsLike(s),
      agents: createMacAgents([s.claude], s.relay),
      document: { ...depsLike(s).document, parsed },
    });
    runs.documentChanged();
    s.editor.view.dispatch({ changes: { from: 0, insert: 'A ' } });
    runs.documentChanged();
    expect(parsed).not.toHaveBeenCalled();
  });

  it('reads the document while a run is live, and stops the run whose post is gone', async () => {
    const go = gate();
    const s = setup({ claude: waits(go.opened), wired: false });
    const parsed = vi.fn(() => s.editor.getParsed());
    const runs = createRuns({
      ...depsLike(s),
      agents: createMacAgents([s.claude], s.relay),
      document: { ...depsLike(s).document, parsed },
    });
    const thread = ask(s, 'Look here.');
    runs.posted({ thread, id: thread, text: '@Claude look' });
    await vi.waitFor(() => expect(s.claude.requests).toHaveLength(1));
    parsed.mockClear();
    runs.documentChanged();
    expect(parsed).toHaveBeenCalledTimes(1);
    expect(runs.isLive()).toBe(true);
    undo(s.editor.view);
    runs.documentChanged();
    expect(runs.isLive()).toBe(false);
    expect(runs.line(thread)).toBeNull();
    go.open();
  });
});

describe('a run whose comment is gone, found by the run itself', () => {
  // The editor's changes don't reach `documentChanged` here: each check after an await, and the
  // one before each tool call, is all that stops the run, and each test fails without its own.

  it('starts nothing for a waiting post taken back while the run before it worked', async () => {
    const go = gate();
    const s = setup({ claude: waits(go.opened), wired: false });
    const thread = ask(s, '@Claude look');
    await vi.waitFor(() => expect(s.claude.requests).toHaveLength(1));
    replyInBox(s, '@Codex and you');
    await settle();
    undo(s.editor.view);
    const saves = s.doc.saves;
    go.open();
    await vi.waitFor(() => expect(s.runs.isLive()).toBe(false));
    expect(s.doc.saves).toBe(saves);
    expect(s.codex.requests).toHaveLength(0);
    expect(s.runs.line(thread)).toBeNull();
  });

  it('stops after the save when the post was taken back meanwhile, and looks nothing up', async () => {
    const saved = gate();
    const s = setup({ saving: saved.opened, wired: false });
    const thread = ask(s, '@Claude look');
    await vi.waitFor(() => expect(s.doc.saves).toBe(1));
    undo(s.editor.view);
    saved.open();
    await settle();
    expect(s.lookups()).toBe(0);
    expect(s.claude.requests).toHaveLength(0);
    expect(s.runs.isLive()).toBe(false);
    expect(s.runs.line(thread)).toBeNull();
  });

  it('stops after the project lookup when the post was taken back meanwhile, and asks nothing', async () => {
    const looked = gate();
    const s = setup({ lookup: looked.opened, consent: {}, wired: false });
    const lines: (string | undefined)[] = [];
    const thread = ask(s, '@Claude look');
    s.runs.subscribe(() => lines.push(s.runs.line(thread)?.kind));
    await vi.waitFor(() => expect(s.lookups()).toBe(1));
    undo(s.editor.view);
    looked.open();
    await settle();
    expect(lines).not.toContain('asking');
    expect(s.claude.requests).toHaveLength(0);
    expect(s.runs.isLive()).toBe(false);
    expect(s.runs.line(thread)).toBeNull();
  });

  it('stops after the question when the post was taken back while it was up, and remembers nothing', async () => {
    const s = setup({ consent: {}, wired: false });
    const thread = ask(s, '@Claude look');
    await vi.waitFor(() => expect(s.runs.line(thread)?.kind).toBe('asking'));
    undo(s.editor.view);
    s.runs.answerConsent(thread, 'folder');
    await settle();
    expect(s.consent).toEqual({});
    expect(s.claude.requests).toHaveLength(0);
    expect(s.runs.isLive()).toBe(false);
    expect(s.runs.line(thread)).toBeNull();
  });

  it('refuses the tool call of a run whose post was taken back, and stops it with no line', async () => {
    const go = gate();
    let late: ToolAnswer | undefined;
    let signal: AbortSignal | undefined;
    const s = setup({
      wired: false,
      async *claude({ tools, signal: given }) {
        signal = given;
        await tools.initialize();
        await go.opened;
        late = await tools.call('str_replace', { old_str: 'April', new_str: 'May' });
        yield { type: 'done' };
      },
    });
    const thread = ask(s, '@Claude look');
    await vi.waitFor(() => expect(s.claude.requests).toHaveLength(1));
    await settle();
    undo(s.editor.view);
    expect(s.runs.isLive()).toBe(true);
    go.open();
    await settle();
    expect(late?.isError).toBe(true);
    expect(late?.text).toMatch(/comment that started this run is gone/);
    expect(signal?.aborted).toBe(true);
    expect(s.editor.getDoc()).not.toContain('May');
    expect(s.runs.isLive()).toBe(false);
    expect(s.runs.line(thread)).toBeNull();
  });
});
