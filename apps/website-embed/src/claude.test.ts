// @vitest-environment happy-dom
import { undo } from '@redlines/editor';
import { newestView, parse, threadEntries } from '@redlines/format';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SAY } from './claude.ts';
import { DOCS } from './docs.ts';
import {
  advance,
  buttonNamed,
  click,
  mountForTest,
  post,
  pressMod,
  typeAt,
  write,
} from './test-helpers.ts';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

type Mount = ReturnType<typeof mountForTest>;

/** Asks Claude, posts, and lets the run finish. */
async function ask(mounted: Mount): Promise<void> {
  expect(mounted.handle.askClaude()).toBe(true);
  post(mounted.root);
  await advance(3000);
}

const subs = (doc: string) => parse(doc).marks.filter((mark) => mark.kind === 'sub');

describe('the scripted Claude', () => {
  it('answers a post that names Claude with a tracked edit in its name, a note and a reply', async () => {
    const { handle, root, notices } = mountForTest('design');
    expect(handle.askClaude()).toBe(true);
    post(root);
    await advance(3000);
    const parsed = parse(handle.getDoc());
    const sub = parsed.marks.find((mark) => mark.kind === 'sub')!;
    expect(sub.entry).toMatchObject({ by: 'claude-ada', note: SAY.note });
    expect(newestView(handle.getDoc()).text).toContain('Uploads retry 5 times with backoff');
    expect(threadEntries(parsed, parsed.ledger.comments[0]!.id).map((e) => e.text)).toEqual([
      SAY.question,
      SAY.fixed,
    ]);
    expect(notices).toEqual(
      expect.arrayContaining([`Claude: ${SAY.reading}`, `Claude: ${SAY.editing}`]),
    );
  });

  it('tells the page whether Claude runs', async () => {
    const mounted = mountForTest('design');
    expect(mounted.states.at(-1)!.claudeRunning).toBe(false);
    mounted.handle.askClaude();
    post(mounted.root);
    await advance(500);
    expect(mounted.states.at(-1)!.claudeRunning).toBe(true);
    await advance(3000);
    expect(mounted.states.at(-1)!.claudeRunning).toBe(false);
  });

  it('cannot be undone: Undo says so, and the file stays as Claude left it', async () => {
    const mounted = mountForTest('design');
    const { handle, view, notices } = mounted;
    await ask(mounted);
    const left = handle.getDoc();
    pressMod(view, 'z');
    expect(handle.getDoc()).toBe(left);
    expect(notices.at(-1)).toBe('Undo isn’t available after Claude’s edit.');
  });

  it('Accept makes "5 times"; Undo takes the Accept back, not the edit', async () => {
    const mounted = mountForTest('design');
    const { handle, root, view, notices } = mounted;
    await ask(mounted);
    handle.openReviewBar();
    click(buttonNamed(root, 'Accept'));
    expect(handle.getDoc()).toContain('retry 5 times');
    expect(subs(handle.getDoc())).toHaveLength(0);
    undo(view);
    expect(subs(handle.getDoc())).toHaveLength(1);
    const kept = handle.getDoc();
    // Nothing is left to undo: the history began again with Claude's edit. The editor is silent
    // here, so the demo says so.
    pressMod(view, 'z');
    expect(handle.getDoc()).toBe(kept);
    expect(notices.at(-1)).toBe('There is nothing to undo.');
  });

  it('asked again with its edit pending, replies Already 5 and edits nothing', async () => {
    const mounted = mountForTest('design');
    await ask(mounted);
    await ask(mounted);
    const parsed = parse(mounted.handle.getDoc());
    expect(subs(mounted.handle.getDoc())).toHaveLength(1);
    const texts = parsed.ledger.comments.flatMap((thread) =>
      threadEntries(parsed, thread.id).map((entry) => entry.text),
    );
    expect(texts).toContain(SAY.already);
  });

  it('after Reject, asked again, edits again', async () => {
    const mounted = mountForTest('design');
    const { handle, root } = mounted;
    await ask(mounted);
    handle.openReviewBar();
    click(buttonNamed(root, 'Reject'));
    expect(subs(handle.getDoc())).toHaveLength(0);
    expect(handle.getDoc()).toContain('retry 3 times');
    await ask(mounted);
    expect(subs(handle.getDoc())).toHaveLength(1);
  });

  it('without a retry count in the note, replies so and edits nothing', async () => {
    const mounted = mountForTest('design');
    const { handle, view } = mounted;
    handle.setTracking(false);
    const at = view.state.doc.toString().indexOf('3 times');
    view.dispatch({ changes: { from: at, to: at + '3 times'.length, insert: 'a few times' } });
    handle.setTracking(true);
    await ask(mounted);
    const parsed = parse(handle.getDoc());
    expect(subs(handle.getDoc())).toHaveLength(0);
    expect(threadEntries(parsed, parsed.ledger.comments[0]!.id).map((entry) => entry.text)).toEqual(
      [SAY.question, SAY.missing],
    );
  });

  it('Stop applies nothing, and the line says Stopped.', async () => {
    const { handle, root } = mountForTest('design');
    handle.askClaude();
    post(root);
    await advance(500);
    click(buttonNamed(root, 'Stop'));
    await advance(3000);
    expect(subs(handle.getDoc())).toHaveLength(0);
    expect(root.textContent).toContain('Stopped.');
  });

  describe('the live region at the end of a run', () => {
    it('says it replied, after the last status', async () => {
      const mounted = mountForTest('design');
      await ask(mounted);
      expect(mounted.notices.at(-1)).toBe('Claude: replied.');
    });

    it('says it stopped, when the visitor stops it', async () => {
      const { handle, root, notices } = mountForTest('design');
      handle.askClaude();
      post(root);
      await advance(500);
      click(buttonNamed(root, 'Stop'));
      await advance(3000);
      expect(notices.at(-1)).toBe('Claude: Stopped.');
    });

    it('says it replied when its edit was refused, and edits nothing', async () => {
      const mounted = mountForTest('design');
      const { handle, view } = mounted;
      // The count is found twice, so the edit can't be placed.
      handle.setTracking(false);
      const end = view.state.doc.length;
      view.dispatch({ changes: { from: end, insert: '\nAgain: retry 3 times.\n' } });
      handle.setTracking(true);
      await ask(mounted);
      expect(subs(handle.getDoc())).toHaveLength(0);
      expect(mounted.root.textContent).toContain(SAY.refused);
      expect(mounted.notices.at(-1)).toBe('Claude: replied.');
    });
  });

  it('opens the thread note on the first status, so the reply needs no click', async () => {
    const { handle, root } = mountForTest('design');
    handle.askClaude();
    post(root);
    await advance(500);
    expect(root.querySelector('.rl-note-open, .rl-note-selected')).not.toBeNull();
    expect(buttonNamed(root, 'Stop')).toBeTruthy();
  });

  it('Reset while it runs refuses the late call', async () => {
    const { handle, root } = mountForTest('design');
    handle.askClaude();
    post(root);
    await advance(500);
    handle.reset();
    await advance(3000);
    expect(handle.getDoc()).toBe(DOCS.design.text);
  });

  it('starts nothing from a mention already in the file, a post without one, or one in code', async () => {
    const mounted = mountForTest('design');
    const { handle, root, view, states } = mounted;
    const filed = `${DOCS.design.text
      .trimEnd()
      .replace('Uploads retry', '<!--cmt c1d2-->Uploads retry')
      .replace('then fail.', 'then fail.<!--/c1d2-->')}

<!-- redlines
version: 1
people:
  ada: {name: Ada Lovelace}
  bo: {name: Bo Chen}
comments:
  c1d2:
    by: bo
    at: 2026-10-13T22:40Z
    text: |-
      @Claude fix it
-->
`;
    handle.setView('raw');
    handle.setTracking(false);
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: filed } });
    handle.setView('redlines');
    for (const [word, text] of [
      ['Each', 'Is this right?'],
      ['logged', '`@Claude` is this right?'],
    ] as const) {
      const at = view.state.doc.toString().indexOf(word);
      view.dispatch({ selection: { anchor: at, head: at + word.length } });
      expect(handle.startComment()).toBe(true);
      write(root, text);
      post(root);
      await advance(3000);
    }
    expect(handle.getDoc()).not.toContain(SAY.fixed);
    expect(handle.getDoc()).not.toContain(SAY.already);
    expect(handle.getDoc()).not.toContain(SAY.missing);
    expect(states.every((state) => !state.claudeRunning)).toBe(true);
  });

  it('makes no request and writes nothing, through a whole session', async () => {
    const trap = (name: string) => () => {
      throw new Error(`${name} was used`);
    };
    const spies = [
      vi.spyOn(globalThis, 'fetch').mockImplementation(trap('fetch')),
      vi.spyOn(navigator, 'sendBeacon').mockImplementation(trap('sendBeacon')),
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(trap('storage')),
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(trap('storage')),
    ];
    const Original = { xhr: globalThis.XMLHttpRequest, ws: globalThis.WebSocket };
    globalThis.XMLHttpRequest = trap('XMLHttpRequest') as unknown as typeof XMLHttpRequest;
    globalThis.WebSocket = trap('WebSocket') as unknown as typeof WebSocket;
    const cookie = vi.spyOn(document, 'cookie', 'set').mockImplementation(trap('cookie'));
    try {
      const mounted = mountForTest('design');
      await ask(mounted);
      mounted.handle.openReviewBar();
      click(buttonNamed(mounted.root, 'Accept'));
      mounted.handle.reset();
      mounted.handle.destroy();
      for (const spy of [...spies, cookie]) expect(spy).not.toHaveBeenCalled();
    } finally {
      globalThis.XMLHttpRequest = Original.xhr;
      globalThis.WebSocket = Original.ws;
    }
  });

  it('waits 300 ms a step when the visitor asks for less motion', async () => {
    const real = window.matchMedia.bind(window);
    vi.spyOn(window, 'matchMedia').mockImplementation((query) =>
      query.includes('prefers-reduced-motion') ? { ...real(query), matches: true } : real(query),
    );
    const { handle, root } = mountForTest('design');
    handle.askClaude();
    post(root);
    await advance(800);
    expect(subs(handle.getDoc())).toHaveLength(1);
    expect(root.textContent).toContain(SAY.fixed);
  });

  // Review Focus 5.
  it('two panels keep to themselves', async () => {
    const plan = mountForTest('plan');
    const design = mountForTest('design');
    design.handle.askClaude();
    post(design.root);
    await advance(500);
    plan.handle.reset();
    await advance(3000);
    expect(subs(design.handle.getDoc())).toHaveLength(1);
    expect(plan.handle.getDoc()).toBe(DOCS.plan.text);

    const at = plan.view.state.doc.toString().indexOf('importer') + 'importer'.length;
    typeAt(plan.view, at, 'x');
    const typed = plan.handle.getDoc();
    design.handle.reset();
    expect(plan.handle.getDoc()).toBe(typed);
    expect(design.handle.getDoc()).toBe(DOCS.design.text);
  });
});
