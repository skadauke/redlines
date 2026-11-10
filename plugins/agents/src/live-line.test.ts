// @vitest-environment happy-dom
import { assignColors, createEditor, type Author, type Editor } from '@redlines/editor';
import { parse } from '@redlines/format';
import { createReview } from '@redlines/review';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { events, fakeProvider, fakeRelay, type FakeScript } from './fake-provider.ts';
import {
  createLiveLines,
  fitStatus,
  renderLiveLine,
  type LiveLineNotice,
  type LiveLineActions,
  type LiveLinesDeps,
} from './live-line.ts';
import { createMacAgents } from './mac-agents.ts';
import { createRuns, type LiveLine } from './runs.ts';

const me: Author = { handle: 'ada', name: 'Ada Lovelace' };

function actions(): LiveLineActions & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    answer: (answer) => calls.push(`answer ${answer}`),
    stop: () => calls.push('stop'),
    dismiss: () => calls.push('dismiss'),
    showLog: (path) => calls.push(`log ${path}`),
  };
}

const buttons = (el: ParentNode) => [...el.querySelectorAll('button')];
const named = (button: HTMLButtonElement) =>
  button.getAttribute('aria-label') ?? button.textContent ?? '';
const press = (el: ParentNode, name: string) => {
  const found = buttons(el).find((button) => named(button) === name);
  if (!found) throw new Error(`No button "${name}"`);
  found.click();
};
/** What the line says, without its buttons. */
const said = (el: HTMLElement) => {
  const copy = el.cloneNode(true) as HTMLElement;
  for (const button of copy.querySelectorAll('button')) button.remove();
  return (copy.textContent ?? '').replace(/\s+/g, ' ').trim();
};

const running = (status: string, agent = 'claude', agentName = 'Claude'): LiveLine => ({
  kind: 'running',
  agent,
  agentName,
  status,
});

/** The line's own style sheet. */
const styleSheet = () => document.getElementById('rl-live-line-style')?.textContent ?? '';

afterEach(() => {
  document.body.replaceChildren();
});

describe('renderLiveLine', () => {
  it('shows the dot, the agent and its status in one line while it runs, with Stop on hover', () => {
    const act = actions();
    const el = renderLiveLine(running('Reading tests'), act, { color: 'rl-author-3' });
    expect(el.classList).toContain('rl-live-line');
    expect(el.classList).toContain('rl-author-3');
    expect(el.querySelector('.rl-live-line-dot')).not.toBeNull();
    expect(said(el)).toBe('Claude Reading tests');
    expect(el.getAttribute('role')).toBe('status');
    expect(buttons(el).map(named)).toEqual(['Stop']);
    // Stop shows on hover, or while the note is selected.
    const stop = el.querySelector('.rl-live-line-stop');
    expect(stop).not.toBeNull();
    expect(styleSheet()).toMatch(/\.rl-note:hover \.rl-live-line-running \.rl-live-line-stop/);
    press(el, 'Stop');
    expect(act.calls).toEqual(['stop']);
  });

  it('keeps Stop in the keyboard’s way while the agent runs, and shows it when it has the keyboard', () => {
    const el = renderLiveLine(running('Reading tests'), actions());
    const stop = el.querySelector<HTMLButtonElement>('.rl-live-line-stop');
    expect(stop?.tabIndex).toBe(0);
    expect(stop?.hidden).toBe(false);
    const sheet = styleSheet();
    // Hidden from sight, not from the keyboard: never display: none or visibility: hidden.
    const rules = [...sheet.matchAll(/([^{}]*\.rl-live-line-stop[^{}]*)\{([^}]*)\}/g)];
    expect(rules.length).toBeGreaterThan(0);
    for (const [, , body] of rules)
      expect(body).not.toMatch(/display:\s*none|visibility:\s*hidden/);
    expect(sheet).toMatch(/\.rl-live-line-running:focus-within \.rl-live-line-stop/);
  });

  it('cuts a status over 40 characters, with an ellipsis', () => {
    const long = 'Reading packages/format/src/importer.test.ts';
    expect(long.length).toBeGreaterThan(40);
    const el = renderLiveLine(running(long), actions());
    const text = el.querySelector('.rl-live-line-text');
    expect(Array.from(text?.textContent ?? '')).toHaveLength(40);
    expect(text?.textContent).toBe(`${long.slice(0, 39)}…`);
    // The whole status is a hover away.
    expect(text?.getAttribute('title')).toBe(long);
    expect(fitStatus('Editing §3')).toBe('Editing §3');
    expect(fitStatus('x'.repeat(40))).toBe('x'.repeat(40));
    // Counted in characters, as the status tool counts them, and on one line.
    expect(fitStatus('😀'.repeat(41))).toBe(`${'😀'.repeat(39)}…`);
    expect(fitStatus('Reading\nimporter.ts')).toBe('Reading importer.ts');
    // No space before the ellipsis.
    expect(fitStatus(`${'a'.repeat(38)} bcd`)).toBe(`${'a'.repeat(38)}…`);
  });

  const ASK: LiveLine = {
    kind: 'asking',
    agent: 'claude',
    agentName: 'Claude',
    folder: '/Users/ada/code/redlines',
    readLimit: 'folder',
  };
  const textOf = (el: HTMLElement, id: string | null) =>
    id === null
      ? null
      : (id.split(' ').map((one) => el.querySelector(`#${one}`)?.textContent) ?? []);

  it('asks as a panel of Redlines’ own: title, folder, what it means, and three buttons in a group', () => {
    const act = actions();
    const el = renderLiveLine(ASK, act);
    expect([...el.classList]).toEqual(['rl-ask']);
    expect(el.querySelector('.rl-live-line-dot')).toBeNull();
    expect(el.getAttribute('role')).toBe('group');
    expect(textOf(el, el.getAttribute('aria-labelledby'))).toEqual([
      'Allow Claude to read this folder?',
    ]);
    expect(textOf(el, el.getAttribute('aria-describedby'))).toEqual([
      '~/code/redlines',
      'Claude reads files here to answer, and changes only this document.',
    ]);
    expect(el.querySelector('.rl-ask-folder')?.getAttribute('title')).toBe(
      '/Users/ada/code/redlines',
    );
    expect(buttons(el).map(named)).toEqual(['Allow', 'Just This Document', 'Not Now']);
    for (const each of buttons(el)) {
      expect(each.type).toBe('button');
      expect(each.tabIndex).toBe(0);
    }
    expect(buttons(el)[0]?.classList).toContain('rl-ask-allow');
    press(el, 'Allow');
    press(el, 'Just This Document');
    press(el, 'Not Now');
    expect(act.calls).toEqual(['answer folder', 'answer document', 'answer no']);
    // Two panels never share ids.
    const other = renderLiveLine(ASK, act);
    expect(other.getAttribute('aria-labelledby')).not.toBe(el.getAttribute('aria-labelledby'));
  });

  it('asks an agent that can’t be kept to a folder about the Mac, with Allow and Not Now', () => {
    const el = renderLiveLine(
      { kind: 'asking', agent: 'gemini', agentName: 'Gemini', folder: '/p', readLimit: 'machine' },
      actions(),
    );
    expect(textOf(el, el.getAttribute('aria-labelledby'))).toEqual([
      'Allow Gemini to read files on this Mac?',
    ]);
    expect(el.querySelector('.rl-ask-note')?.textContent).toBe(
      'Redlines can’t keep Gemini to one folder: its own settings decide what it reads.',
    );
    expect(el.querySelector('.rl-ask-folder')).toBeNull();
    expect(buttons(el).map(named)).toEqual(['Allow', 'Not Now']);
  });

  it('names a deep folder by its start and its end', () => {
    const el = renderLiveLine(
      { ...ASK, folder: '/Volumes/Work/clients/acme/projects/2026/importer-rewrite' },
      actions(),
    );
    expect(el.querySelector('.rl-ask-folder')?.textContent).toBe(
      '/Volumes/…/2026/importer-rewrite',
    );
  });

  it('answers Not Now on Escape from any of its buttons', () => {
    const act = actions();
    const el = renderLiveLine(ASK, act);
    document.body.append(el);
    buttons(el)[1]?.focus();
    const key = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    const outside = vi.fn();
    document.body.addEventListener('keydown', outside);
    buttons(el)[1]?.dispatchEvent(key);
    document.body.removeEventListener('keydown', outside);
    expect(act.calls).toEqual(['answer no']);
    expect(key.defaultPrevented).toBe(true);
    expect(outside).not.toHaveBeenCalled();
  });

  it('gives the keyboard back after an answer from the keyboard: where it was, else to the document', () => {
    const field = document.createElement('textarea');
    document.body.append(field);
    const calls: string[] = [];
    const act = { ...actions(), focusDocument: () => calls.push('document') };
    const el = renderLiveLine(ASK, act);
    document.body.append(el);
    field.focus();
    buttons(el)[0]?.focus();
    buttons(el)[0]?.click();
    expect(act.calls).toEqual(['answer folder']);
    expect(document.activeElement).toBe(field);
    expect(calls).toEqual([]);

    // Came from nowhere else: the document.
    field.remove();
    (document.activeElement as HTMLElement | null)?.blur();
    buttons(el)[1]?.focus();
    buttons(el)[1]?.click();
    expect(calls).toEqual(['document']);

    // A click that never had the keyboard moves nothing.
    (document.activeElement as HTMLElement | null)?.blur();
    buttons(el)[0]?.click();
    expect(calls).toEqual(['document']);
  });

  it('draws its buttons so they look like buttons, wrap at large sizes and keep the 24 px floor', () => {
    renderLiveLine(ASK, actions());
    const sheet = styleSheet();
    const rule = (selector: string) =>
      [...sheet.matchAll(/([^{}]+)\{([^}]*)\}/g)].find(
        ([, name]) => name?.trim() === selector,
      )?.[2] ?? '';
    const buttonRule = rule('.rl-ask-answers button');
    expect(buttonRule).toContain('min-height: max(24px, calc(26px * var(--rl-text-scale, 1)))');
    expect(buttonRule).toContain('white-space: normal');
    expect(buttonRule).toContain('font-size: var(--rl-size-ui-scaled)');
    expect(buttonRule).toMatch(/border:\s*1px solid/);
    expect(rule('.rl-ask-folder, .rl-ask-note')).toContain('var(--rl-size-ui-small-scaled)');
    expect(rule('.rl-ask-answers .rl-ask-allow')).toContain('font-weight: 700');
    for (const [, name, body] of sheet.matchAll(/([^{}]*\.rl-ask[^{}]*)\{([^}]*)\}/g))
      expect(body, name).not.toMatch(/(?:^|[;\s])(?:min-|max-)?width:\s*\d+px/);
  });

  it('shows a failure in one line, which can be dismissed, with its log when it has one', () => {
    const act = actions();
    const el = renderLiveLine(
      {
        kind: 'failed',
        agent: 'claude',
        agentName: 'Claude',
        message: "Claude isn't signed in. Run `claude auth login`.",
        logPath: '/logs/run.jsonl',
      },
      act,
      { color: 'rl-author-4' },
    );
    // The name starts the message, as on the running line; a command reads as code.
    expect(said(el)).toBe("Claude isn't signed in. Run claude auth login.");
    expect(el.querySelector('.rl-live-line-text code')?.textContent).toBe('claude auth login');
    // In the agent's color, never red.
    expect(el.classList).toContain('rl-author-4');
    expect(el.classList).not.toContain('rl-author-1');
    expect(buttons(el).map(named)).toEqual(['Show log', 'Dismiss']);
    press(el, 'Show log');
    press(el, 'Dismiss');
    expect(act.calls).toEqual(['log /logs/run.jsonl', 'dismiss']);
  });

  it('names the agent before a failure that doesn’t, and offers no log without one', () => {
    const el = renderLiveLine(
      { kind: 'failed', agent: 'claude', agentName: 'Claude', message: 'Stopped.' },
      actions(),
    );
    expect(said(el)).toBe('Claude Stopped.');
    expect(buttons(el).map(named)).toEqual(['Dismiss']);
  });

  it('keeps the keyboard in the document when its buttons are pressed', () => {
    const el = renderLiveLine(running('Reading tests'), actions());
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    buttons(el)[0]?.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
  });
});

/** A run controller the test drives by hand. */
function handRuns() {
  const lines = new Map<string, LiveLine>();
  const listeners = new Set<(thread: string) => void>();
  const calls: string[] = [];
  const runs: LiveLinesDeps['runs'] = {
    line: (thread) => lines.get(thread) ?? null,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    answerConsent: (thread, answer) => calls.push(`answer ${thread} ${answer}`),
    stop: (thread) => calls.push(`stop ${thread}`),
    dismiss: (thread) => calls.push(`dismiss ${thread}`),
  };
  const set = (thread: string, line: LiveLine | null) => {
    if (line) lines.set(thread, line);
    else lines.delete(thread);
    for (const listener of [...listeners]) listener(thread);
  };
  return { runs, set, calls };
}

const PLAIN = parse('The importer ships in April.\n');

/** Waits for the next animation frame, when the rail has laid out. */
const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

function liveLines(overrides: Partial<LiveLinesDeps> = {}) {
  const hand = handRuns();
  const refreshed: string[] = [];
  const notices: { notice: LiveLineNotice; closed: boolean }[] = [];
  const logs: string[] = [];
  const lines = createLiveLines({
    runs: hand.runs,
    author: me,
    getParsed: () => PLAIN,
    refresh: (thread) => refreshed.push(thread),
    showLog: (path) => logs.push(path),
    notify: (notice) => {
      const shown = { notice, closed: false };
      notices.push(shown);
      return { close: () => (shown.closed = true) };
    },
    inView: () => true,
    ...overrides,
  });
  return { lines, ...hand, refreshed, notices, logs };
}

const FAILED: LiveLine = {
  kind: 'failed',
  agent: 'claude',
  agentName: 'Claude',
  message: "Claude can't reach the network.",
  logPath: '/logs/run.jsonl',
};

describe('createLiveLines', () => {
  it('draws the thread’s line again whenever it changes, and changes it in place', () => {
    const s = liveLines();
    expect(s.lines.footer('c2dk')).toBeNull();

    s.set('c2dk', running('Thinking…'));
    expect(s.refreshed).toEqual(['c2dk']);
    const el = s.lines.footer('c2dk');
    expect(el && said(el)).toBe('Claude Thinking…');
    const dot = el?.querySelector('.rl-live-line-dot');
    const stop = el?.querySelector('button');

    // The agent's own status replaces the provider's in place: the same line, dot and Stop.
    s.set('c2dk', running('Searching the importer'));
    expect(s.lines.footer('c2dk')).toBe(el);
    expect(el && said(el)).toBe('Claude Searching the importer');
    expect(el?.querySelector('.rl-live-line-dot')).toBe(dot);
    expect(el?.querySelector('button')).toBe(stop);

    // Another kind of line, still in the same place.
    s.set('c2dk', FAILED);
    expect(s.lines.footer('c2dk')).toBe(el);
    expect(el?.classList).toContain('rl-live-line-failed');
    expect(buttons(el!).map(named)).toEqual(['Show log', 'Dismiss']);

    s.set('c2dk', null);
    expect(s.lines.footer('c2dk')).toBeNull();
    expect(s.refreshed).toEqual(['c2dk', 'c2dk', 'c2dk', 'c2dk']);
  });

  it('gives the same element and buttons when asked again for the same line', () => {
    const s = liveLines();
    for (const line of [
      running('Thinking…'),
      {
        kind: 'asking',
        agent: 'claude',
        agentName: 'Claude',
        folder: '/repo',
        readLimit: 'folder',
      } satisfies LiveLine,
      FAILED,
    ]) {
      s.set('c2dk', line);
      const el = s.lines.footer('c2dk');
      const before = el ? buttons(el) : [];
      expect(s.lines.footer('c2dk')).toBe(el);
      // The very same buttons, not new ones like them.
      const after = el ? buttons(el) : [];
      expect(after).toHaveLength(before.length);
      after.forEach((button, i) => expect(button).toBe(before[i]));
    }
  });

  it('sends its buttons to the thread’s run', () => {
    const s = liveLines();
    s.set('c2dk', running('Thinking…'));
    press(s.lines.footer('c2dk')!, 'Stop');
    s.set('c2dk', {
      kind: 'asking',
      agent: 'claude',
      agentName: 'Claude',
      folder: '/repo',
      readLimit: 'folder',
    });
    press(s.lines.footer('c2dk')!, 'Just This Document');
    s.set('c2dk', FAILED);
    press(s.lines.footer('c2dk')!, 'Show log');
    press(s.lines.footer('c2dk')!, 'Dismiss');
    expect(s.calls).toEqual(['stop c2dk', 'answer c2dk document', 'dismiss c2dk']);
    expect(s.logs).toEqual(['/logs/run.jsonl']);
  });

  it('draws the agent in the color it will have once it writes', () => {
    const ledger = (people: string[]) =>
      parse(
        [
          'The importer ships.',
          '',
          '<!-- redlines',
          'version: 1',
          'people:',
          ...people,
          '-->',
          '',
        ].join('\n'),
      );
    const before = ledger(['  ada: {name: Ada Lovelace}', '  bo: {name: Bo Chen}']);
    const after = ledger([
      '  ada: {name: Ada Lovelace}',
      '  bo: {name: Bo Chen}',
      '  claude-ada: {name: Claude, agent: true, for: ada}',
    ]);
    const color = assignColors(after, 'ada').get('claude-ada');
    expect(color).toBeGreaterThanOrEqual(2);
    for (const parsed of [before, after]) {
      const s = liveLines({ getParsed: () => parsed });
      s.set('c2dk', running('Thinking…'));
      expect(s.lines.footer('c2dk')?.classList).toContain(`rl-author-${color}`);
    }
  });

  it('turns into the running line in the same element, a status again', () => {
    const s = liveLines();
    s.set('c2dk', {
      kind: 'asking',
      agent: 'claude',
      agentName: 'Claude',
      folder: '/repo',
      readLimit: 'folder',
    });
    const el = s.lines.footer('c2dk');
    expect([...(el?.classList ?? [])]).toEqual(['rl-ask']);
    s.set('c2dk', running('Starting…'));
    expect(s.lines.footer('c2dk')).toBe(el);
    expect(el?.classList).toContain('rl-live-line');
    expect(el?.classList).toContain('rl-live-line-running');
    expect(el?.getAttribute('role')).toBe('status');
    expect(el?.hasAttribute('aria-labelledby')).toBe(false);
  });

  it('writes in the color of the record of people met', () => {
    const parsed = parse('The importer ships.\n');
    const s = liveLines({
      getParsed: () => parsed,
      getMet: () => [{ handle: 'claude-ada', color: 7 }],
    });
    s.set('c2dk', running('Thinking…'));
    expect(s.lines.footer('c2dk')?.classList).toContain('rl-author-7');
  });

  it('tells of a failure in a notification only when the thread is out of view', async () => {
    let inView = true;
    const s = liveLines({ inView: () => inView });
    s.set('c2dk', running('Thinking…'));
    s.lines.footer('c2dk');
    s.set('c2dk', FAILED);
    s.lines.footer('c2dk');
    await frame();
    expect(s.notices).toEqual([]);

    inView = false;
    const failure: LiveLine = {
      ...FAILED,
      message: "Claude isn't signed in. Run `claude auth login`.",
    };
    s.set('c3fm', running('Thinking…'));
    s.lines.footer('c3fm');
    s.set('c3fm', failure);
    s.lines.footer('c3fm');
    await frame();
    expect(s.notices.map(({ notice }) => notice.text)).toEqual([
      "Claude isn't signed in. Run claude auth login.",
    ]);
    const [shown] = s.notices;
    // The notification offers the log, too.
    expect(shown?.notice.action?.label).toBe('Show log');
    shown?.notice.action?.run();
    expect(s.logs).toEqual(['/logs/run.jsonl']);

    // The same failure, drawn again, isn't told of twice.
    s.set('c3fm', failure);
    s.lines.footer('c3fm');
    await frame();
    expect(s.notices).toHaveLength(1);
    expect(shown?.closed).toBe(false);

    // Dismissing the line takes its notification away.
    s.set('c3fm', null);
    expect(shown?.closed).toBe(true);
  });

  it('names the agent in a notification for a failure that doesn’t, and offers no log without one', async () => {
    const s = liveLines({ inView: () => false });
    s.set('c2dk', { kind: 'failed', agent: 'codex', agentName: 'Codex', message: 'Stopped.' });
    await frame();
    expect(s.notices.map(({ notice }) => [notice.text, notice.action])).toEqual([
      ['Codex: Stopped.', undefined],
    ]);
  });

  describe('a question', () => {
    const ASKING: LiveLine = {
      kind: 'asking',
      agent: 'claude',
      agentName: 'Claude',
      folder: '/repo',
      readLimit: 'folder',
    };
    const region = () => document.querySelector('.rl-live-line-said');

    it('tells of a question out of view in a notification with Show, which shows its thread', async () => {
      const showThread = vi.fn();
      const s = liveLines({ inView: () => false, showThread });
      s.set('c2dk', ASKING);
      s.lines.footer('c2dk');
      await frame();
      expect(s.notices).toHaveLength(1);
      const [shown] = s.notices;
      expect(shown?.notice.text).toBe('Claude is waiting for your answer.');
      expect(shown?.notice.action?.label).toBe('Show');
      shown?.notice.action?.run();
      expect(showThread).toHaveBeenCalledWith('c2dk');
    });

    it('tells of a question whose thread has no note, as in Clean or Raw, at once', async () => {
      const inView = vi.fn(() => true);
      const s = liveLines({ inView });
      s.set('c2dk', ASKING);
      await frame();
      expect(s.notices).toHaveLength(1);
      expect(inView).not.toHaveBeenCalled();
    });

    it('takes the notification away when the question goes', async () => {
      const s = liveLines({ inView: () => false });
      s.set('c2dk', ASKING);
      s.lines.footer('c2dk');
      await frame();
      const [shown] = s.notices;
      expect(shown?.closed).toBe(false);
      s.set('c2dk', running('Starting…'));
      expect(shown?.closed).toBe(true);
    });

    it('empties the live region when the question goes', async () => {
      const s = liveLines({ inView: () => true });
      s.set('c2dk', ASKING);
      s.lines.footer('c2dk');
      await frame();
      s.set('c2dk', running('Starting…'));
      expect(region()?.textContent).toBe('');
    });

    it('says the question once: by its live region in view, by the notification out of view', async () => {
      const inView = vi.fn(() => true);
      const s = liveLines({ inView });
      expect(region()?.getAttribute('aria-live')).toBe('polite');
      expect(region()?.textContent).toBe('');
      s.set('c2dk', ASKING);
      s.lines.footer('c2dk');
      await frame();
      expect(region()?.textContent).toBe(
        'Claude is waiting for your answer: Allow Claude to read this folder?',
      );
      expect(s.notices).toEqual([]);

      const away = liveLines({ inView: () => false });
      away.set('c3fm', ASKING);
      away.lines.footer('c3fm');
      await frame();
      expect(away.notices).toHaveLength(1);
      // The second live lines' own region: nothing said where the notification tells of it.
      expect(document.querySelectorAll('.rl-live-line-said')[1]?.textContent).toBe('');
    });

    it('keeps a resolved thread’s note while its run asks', () => {
      const s = liveLines();
      s.set('c2dk', ASKING);
      expect(s.lines.keepsShown('c2dk')).toBe(true);
      s.set('c2dk', running('Starting…'));
      expect(s.lines.keepsShown('c2dk')).toBe(false);
    });
  });

  it('tells of a failure whose thread has no note, as in Raw', async () => {
    const inView = vi.fn(() => true);
    const s = liveLines({ inView });
    s.set('c2dk', FAILED);
    await frame();
    // The note never asked for its line: there is nothing on screen to look at.
    expect(inView).not.toHaveBeenCalled();
    expect(s.notices).toHaveLength(1);
  });
});

// The line in a real thread, as a real run moves it on.

const PLAN = 'The importer ships in April.\n\nThe tests run in CI.\n';

const mounted: Editor[] = [];
afterEach(() => {
  for (const editor of mounted.splice(0)) editor.destroy();
});

/** A promise the test resolves. */
function gate() {
  let open = () => {};
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { opened, open };
}

function mountRun(
  script: FakeScript,
  consent: Record<string, 'folder' | 'document'> = {},
  { inView = () => true }: { inView?: () => boolean } = {},
) {
  let generation = 0;
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, { doc: PLAN, author: me });
  editor.view.focus = () => {};
  editor.view.contentDOM.focus = () => {};
  mounted.push(editor);
  const relay = fakeRelay();
  const claude = fakeProvider({ relay, script });
  const runs = createRuns({
    agents: createMacAgents([claude], relay),
    author: me,
    document: {
      path: () => '/repo/plan.md',
      generation: () => generation,
      read: () => editor.getDoc(),
      save: () => Promise.resolve(true),
      applyAgentEdit: (next) => {
        editor.reloadDoc(next);
        return Promise.resolve();
      },
    },
    projectRoot: () => Promise.resolve({ folder: '/repo', isRepo: true, tooBroad: false }),
    settings: {
      defaultScope: () => 'folder',
      consent: (agent, folder) => consent[`${agent}|${folder}`],
      setConsent: (agent, folder, answer) => {
        if (answer !== 'no' && answer !== 'everything') consent[`${agent}|${folder}`] = answer;
      },
    },
    onEnded: () => {},
  });
  const posted: string[] = [];
  // Built before the review, which asks for footers as it draws, and wired to it after.
  let refresh: (thread: string) => void = () => {};
  const notices: { notice: LiveLineNotice; closed: boolean }[] = [];
  const lines = createLiveLines({
    runs,
    author: me,
    getParsed: () => editor.getParsed(),
    refresh: (thread) => refresh(thread),
    notify: (notice) => {
      const shown = { notice, closed: false };
      notices.push(shown);
      return { close: () => (shown.closed = true) };
    },
    inView,
  });
  const review = createReview(editor, {
    author: me,
    onPosted: (comment) => {
      posted.push(comment.thread);
      runs.posted(comment);
    },
    extras: { footer: (thread) => lines.footer(thread) },
  });
  refresh = (thread) => review.refreshThread(thread);

  /** Comments on `word` with `text` through the comment box, and returns the thread. */
  const post = (text: string, word: string): string => {
    const from = editor.getDoc().indexOf(word);
    editor.view.dispatch({ selection: { anchor: from, head: from + word.length } });
    expect(review.startComment()).toBe(true);
    const box = [
      ...editor.view.dom.querySelectorAll<HTMLTextAreaElement>('.rl-note textarea'),
    ].find((field) => !field.closest<HTMLElement>('.rl-note-box')?.hidden);
    if (!box) throw new Error('No comment box shows');
    box.value = text;
    box.dispatchEvent(new Event('input', { bubbles: true }));
    box.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    const thread = posted.at(-1);
    if (!thread) throw new Error('Nothing was posted');
    return thread;
  };
  /** The note of the thread whose comment says `text`. */
  const noteWith = (text: string) => {
    const found = [...editor.view.dom.querySelectorAll<HTMLElement>('.rl-note')].find((note) =>
      note.querySelector('.rl-note-text')?.textContent?.includes(text),
    );
    if (!found) throw new Error(`No note says "${text}"`);
    return found;
  };
  /** Another document takes this one's place in the editor, as the desktop app does it. */
  const replace = (text: string) => {
    generation++;
    editor.setDoc(text);
    runs.documentReplaced();
  };
  return { editor, runs, review, lines, post, noteWith, notices, replace };
}

describe('the live line in a thread', () => {
  it('is not in getDoc() at any time', async () => {
    const step = gate();
    const s = mountRun(async function* ({ tools }) {
      yield { type: 'started', logPath: '/logs/run.jsonl' };
      await tools.initialize();
      await tools.call('status', { text: 'Searching the importer' });
      await step.opened;
      yield { type: 'error', message: "Claude can't reach the network." };
    });
    const posted: string[] = [];
    const check = (shown: string) => {
      const doc = s.editor.getDoc();
      posted.push(doc);
      const line = s.editor.view.dom.querySelector<HTMLElement>('.rl-live-line, .rl-ask');
      expect(line && said(line)).toContain(shown);
      expect(doc).not.toContain(shown);
      expect(doc).not.toMatch(/rl-live-line|Allow|Not Now|Starting|Searching|reach the network/);
    };
    const thread = s.post('@Claude does it handle CRLF?', 'importer');

    await vi.waitFor(() => expect(s.runs.line(thread)?.kind).toBe('asking'));
    check('Allow Claude to read this folder?');
    press(s.noteWith('CRLF'), 'Allow');

    await vi.waitFor(() =>
      expect(s.runs.line(thread)).toMatchObject({ status: 'Searching the importer' }),
    );
    check('Searching the importer');

    step.open();
    await vi.waitFor(() => expect(s.runs.line(thread)?.kind).toBe('failed'));
    check("can't reach the network.");
    // The document is the one posted: nothing about the run went in.
    expect(new Set(posted).size).toBe(1);

    press(s.noteWith('CRLF'), 'Dismiss');
    expect(s.editor.view.dom.querySelector('.rl-live-line')).toBeNull();
    expect(s.editor.getDoc()).toBe(posted[0]);
  });

  it('re-measures the rail when the line appears or goes', async () => {
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
    // happy-dom lays nothing out: a note is 60 pixels high, and 30 more with its live line.
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get(this: HTMLElement) {
        if (!this.classList.contains('rl-note')) return 0;
        return this.querySelector('.rl-live-line') ? 90 : 60;
      },
    });
    try {
      const release = gate();
      const s = mountRun(
        async function* ({ tools }) {
          await tools.initialize();
          await release.opened;
          await tools.call('reply', { text: 'The new one.' });
          yield { type: 'done' };
        },
        { 'claude|/repo': 'folder' },
      );
      // Two threads on one line: the second note sits under the first.
      s.post('Or May?', 'April');
      const thread = s.post('@Claude which importer?', 'importer');
      const gap = () =>
        parseFloat(s.noteWith('Or May?').style.top) -
        parseFloat(s.noteWith('which importer?').style.top);

      // The first thread's line pushes the second note down.
      await vi.waitFor(() => expect(s.runs.line(thread)?.kind).toBe('running'));
      await frame();
      expect(gap()).toBe(90 + 8);

      // The line goes as the reply comes, and the second note moves back up.
      release.open();
      await vi.waitFor(() => expect(s.runs.isLive()).toBe(false));
      expect(s.runs.line(thread)).toBeNull();
      await frame();
      expect(gap()).toBe(60 + 8);
    } finally {
      if (original) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', original);
    }
  });

  it('takes a failure’s notification away when another document takes this one’s place', async () => {
    const s = mountRun(
      events({ type: 'error', message: "Claude can't reach the network." }),
      { 'claude|/repo': 'folder' },
      { inView: () => false },
    );
    const thread = s.post('@Claude does it handle CRLF?', 'importer');
    await vi.waitFor(() => expect(s.notices).toHaveLength(1));
    expect(s.notices[0]?.closed).toBe(false);
    s.replace('Another document.\n');
    expect(s.notices[0]?.closed).toBe(true);
    // Nothing of the old line is kept to be drawn again.
    expect(s.runs.line(thread)).toBeNull();
    expect(s.lines.footer(thread)).toBeNull();
  });

  it('leaves the keyboard in a comment box when the question appears', async () => {
    const s = mountRun(async function* () {
      await new Promise(() => {});
      yield { type: 'done' };
    });
    s.post('Or May?', 'April');
    press(s.noteWith('Or May?'), 'Reply');
    const box = s.noteWith('Or May?').querySelector<HTMLTextAreaElement>('textarea');
    box?.focus();
    const thread = s.post('@Claude does it handle CRLF?', 'importer');
    // Back in the reply box, where the person is typing when the question appears.
    box?.focus();
    const active = document.activeElement;
    expect(active).toBe(box);
    await vi.waitFor(() => expect(s.runs.line(thread)?.kind).toBe('asking'));
    await frame();
    const panel = s.noteWith('CRLF').querySelector('.rl-ask');
    expect(panel).not.toBeNull();
    expect(panel?.contains(document.activeElement)).toBe(false);
    expect(document.activeElement).not.toBe(buttons(s.noteWith('CRLF'))[0]);
    expect(document.activeElement).toBe(active);
  });

  it('turns into the running line in place after Allow, and is gone after Not Now, remembering nothing', async () => {
    const consent: Record<string, 'folder' | 'document'> = {};
    const s = mountRun(async function* () {
      await new Promise(() => {});
      yield { type: 'done' };
    }, consent);
    const thread = s.post('@Claude does it handle CRLF?', 'importer');
    await vi.waitFor(() => expect(s.runs.line(thread)?.kind).toBe('asking'));
    const panel = s.noteWith('CRLF').querySelector('.rl-ask');
    press(s.noteWith('CRLF'), 'Allow');
    await vi.waitFor(() => expect(s.runs.line(thread)?.kind).toBe('running'));
    expect(s.lines.footer(thread)).toBe(panel);
    expect(panel?.classList).toContain('rl-live-line-running');
    expect(consent).toEqual({ 'claude|/repo': 'folder' });

    const none: Record<string, 'folder' | 'document'> = {};
    const t = mountRun(async function* () {
      await new Promise(() => {});
      yield { type: 'done' };
    }, none);
    const second = t.post('@Claude and now?', 'importer');
    await vi.waitFor(() => expect(t.runs.line(second)?.kind).toBe('asking'));
    press(t.noteWith('and now?'), 'Not Now');
    await vi.waitFor(() => expect(t.runs.line(second)).toBeNull());
    expect(t.noteWith('and now?').querySelector('.rl-ask, .rl-live-line')).toBeNull();
    expect(none).toEqual({});
  });

  it('keeps its buttons when the note is drawn again with the same line, so a click lands', async () => {
    const s = mountRun(async function* () {
      await new Promise(() => {});
      yield { type: 'done' };
    });
    const thread = s.post('@Claude does it handle CRLF?', 'importer');
    await vi.waitFor(() => expect(s.runs.line(thread)?.kind).toBe('asking'));
    const allow = buttons(s.noteWith('CRLF')).find((button) => named(button) === 'Allow');
    if (!allow) throw new Error('No Allow');
    // Pressed, then the rail draws the note again, as an agent edit elsewhere makes it, then let go.
    const init = { bubbles: true, cancelable: true, button: 0 };
    allow.dispatchEvent(new MouseEvent('mousedown', init));
    s.review.refreshThread(thread);
    allow.dispatchEvent(new MouseEvent('mouseup', init));
    expect(allow.isConnected).toBe(true);
    allow.click();
    await vi.waitFor(() => expect(s.runs.line(thread)?.kind).toBe('running'));
  });
});
