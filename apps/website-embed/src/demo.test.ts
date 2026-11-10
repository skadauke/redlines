// @vitest-environment happy-dom
import { undo, undoDepth } from '@redlines/editor';
import { accept, applyChanges, parse } from '@redlines/format';
import { describe, expect, it, vi } from 'vitest';
import { mountDemo } from './demo.ts';
import { DOCS } from './docs.ts';
import { buttonNamed, click, mountForTest, post, pressMod, typeAt, write } from './test-helpers.ts';
import { VIEWS } from './views.ts';

const afterImporter = (text: string) => text.indexOf('importer') + 'importer'.length;

describe('mountDemo', () => {
  it('starts the plan in Redlines with Track Changes on', () => {
    const { handle, states } = mountForTest('plan');
    expect(states.at(-1)).toMatchObject({
      view: 'redlines',
      tracking: true,
      changes: 3,
      canComment: true,
      claudeRunning: false,
    });
    expect(states.at(-1)!.views).toEqual(VIEWS);
    expect(handle.getDoc()).toBe(DOCS.plan.text);
  });

  it('reaches every view, and takes no comment in Raw', () => {
    const { handle, states, notices } = mountForTest('plan');
    handle.setView('clean');
    expect(states.at(-1)!.view).toBe('clean');
    handle.setView('raw');
    expect(states.at(-1)!.view).toBe('raw');
    expect(states.at(-1)!.canComment).toBe(false);
    expect(handle.startComment()).toBe(false);
    expect(notices.at(-1)).toBe("A comment can't be added in Raw. Switch to Redlines to add one.");
  });

  it('turns typing into an insertion by Ada while Track Changes is on', () => {
    const { handle, view } = mountForTest('plan');
    const before = parse(handle.getDoc()).marks.length;
    typeAt(view, afterImporter(view.state.doc.toString()), 'x');
    const marks = parse(handle.getDoc()).marks;
    expect(marks.length).toBe(before + 1);
    const added = marks.filter((mark) => mark.entry?.by === 'ada' && mark.kind === 'ins');
    expect(added.length).toBe(2);
  });

  it('types plain text while Track Changes is off', () => {
    const { handle, view } = mountForTest('plan');
    handle.setTracking(false);
    typeAt(view, afterImporter(view.state.doc.toString()), 'x');
    expect(handle.getDoc()).toContain('importerx');
    expect(parse(handle.getDoc()).marks).toHaveLength(4);
  });

  it('refuses typing in Raw while Track Changes is on, in the editor’s words', () => {
    const { handle, view, notices } = mountForTest('plan');
    handle.setView('raw');
    typeAt(view, 3, 'x');
    expect(handle.getDoc()).toBe(DOCS.plan.text);
    expect(notices.at(-1)).toBe(
      'Raw is read-only while Track Changes is on. Turn Track Changes off to edit the source.',
    );
  });

  it('accepts from the review bar what the format accepts', () => {
    const { handle, root, view } = mountForTest('plan');
    handle.openReviewBar();
    click(buttonNamed(root, 'Accept'));
    expect(handle.getDoc()).toBe(applyChanges(DOCS.plan.text, accept(DOCS.plan.text, 'k3x9')));
    undo(view);
    expect(handle.getDoc()).toBe(DOCS.plan.text);
  });

  it('opens the review bar on the first change, with the focus on Accept', () => {
    const { handle, root } = mountForTest('plan');
    handle.openReviewBar();
    const accepting = buttonNamed(root, 'Accept');
    expect(accepting.disabled).toBe(false);
    expect(document.activeElement).toBe(accepting);
    expect(root.querySelector('.rl-bar-count')?.textContent).toBe('Change 1 of 3');
    // Pressed again with the bar open, Review leaves the current change where it is.
    handle.openReviewBar();
    expect(root.querySelector('.rl-bar-count')?.textContent).toBe('Change 1 of 3');
    expect(document.activeElement).toBe(accepting);
    click(accepting);
    expect(handle.getDoc()).toBe(applyChanges(DOCS.plan.text, accept(DOCS.plan.text, 'k3x9')));
  });

  it('opens the review bar when there is no change, with nothing to accept', () => {
    const { handle, root } = mountForTest('design');
    handle.openReviewBar();
    expect(root.querySelector('.rl-review-bar')).not.toBeNull();
    expect(buttonNamed(root, 'Accept').disabled).toBe(true);
  });

  it('resets to the original bytes, Redlines, tracking on and no history', () => {
    const { handle, view, states } = mountForTest('plan');
    typeAt(view, afterImporter(view.state.doc.toString()), 'x');
    handle.setTracking(false);
    handle.setView('raw');
    handle.reset();
    expect(handle.getDoc()).toBe(DOCS.plan.text);
    expect(states.at(-1)).toMatchObject({ view: 'redlines', tracking: true, changes: 3 });
    expect(undoDepth(view.state)).toBe(0);
  });

  it('keeps Mod-z for undo', () => {
    const { handle, view } = mountForTest('plan');
    typeAt(view, afterImporter(view.state.doc.toString()), 'x');
    pressMod(view, 'z');
    expect(handle.getDoc()).toBe(DOCS.plan.text);
  });

  // Review Focus 2.
  it('follows the system’s appearance while it is open', () => {
    const listeners = new Set<(event: MediaQueryListEvent) => void>();
    const list = {
      matches: false,
      addEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) =>
        listeners.add(listener),
      removeEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) =>
        listeners.delete(listener),
    };
    vi.spyOn(window, 'matchMedia').mockReturnValue(list as unknown as MediaQueryList);
    try {
      const { root } = mountForTest('plan');
      expect(root.dataset['rlAppearance']).toBe('light');
      list.matches = true;
      for (const listener of listeners) listener({ matches: true } as MediaQueryListEvent);
      expect(root.dataset['rlAppearance']).toBe('dark');
      list.matches = false;
      for (const listener of listeners) listener({ matches: false } as MediaQueryListEvent);
      expect(root.dataset['rlAppearance']).toBe('light');
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('can be destroyed twice, and takes away what it added', () => {
    const targets: [string, EventTarget][] = [
      ['window', window],
      ['document', document],
    ];
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    targets.push(['media', media]);
    const added: { target: string; type: string; listener: unknown }[] = [];
    const removed: typeof added = [];
    for (const [name, target] of targets) {
      const add = target.addEventListener.bind(target);
      const remove = target.removeEventListener.bind(target);
      vi.spyOn(target, 'addEventListener').mockImplementation((type, listener, opts) => {
        added.push({ target: name, type, listener });
        add(type, listener, opts);
      });
      vi.spyOn(target, 'removeEventListener').mockImplementation((type, listener, opts) => {
        removed.push({ target: name, type, listener });
        remove(type, listener, opts);
      });
    }
    vi.spyOn(window, 'matchMedia').mockReturnValue(media);
    try {
      const parent = document.createElement('div');
      document.body.append(parent);
      const handle = mountDemo(parent, { demo: 'plan', onState: () => {}, onNotice: () => {} });
      handle.destroy();
      handle.destroy();
      expect(parent.childElementCount).toBe(0);
      expect(added.length).toBeGreaterThan(0);
      for (const each of added) {
        expect(
          removed.some(
            (r) => r.target === each.target && r.type === each.type && r.listener === each.listener,
          ),
          `${each.target} ${each.type}`,
        ).toBe(true);
      }
      parent.remove();
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('takes away what it added when the mount throws', () => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const added: unknown[] = [];
    const removed: unknown[] = [];
    vi.spyOn(media, 'addEventListener').mockImplementation(
      (_, listener) => void added.push(listener),
    );
    vi.spyOn(media, 'removeEventListener').mockImplementation(
      (_, listener) => void removed.push(listener),
    );
    vi.spyOn(window, 'matchMedia').mockReturnValue(media);
    try {
      const parent = document.createElement('div');
      document.body.append(parent);
      expect(() =>
        mountDemo(parent, {
          demo: 'plan',
          onState: () => {
            throw new Error('test');
          },
          onNotice: () => {},
        }),
      ).toThrow('test');
      expect(parent.childElementCount).toBe(0);
      expect(added.length).toBeGreaterThan(0);
      for (const listener of added) expect(removed).toContain(listener);
      parent.remove();
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('makes no request and writes nothing', () => {
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
    const idb = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
    Object.defineProperty(globalThis, 'indexedDB', { configurable: true, get: trap('indexedDB') });
    try {
      const { handle, root, view } = mountForTest('plan');
      typeAt(view, afterImporter(view.state.doc.toString()), 'x');
      for (const each of ['clean', 'raw', 'redlines'] as const) handle.setView(each);
      expect(handle.startComment()).toBe(true);
      write(root, 'A question');
      post(root);
      expect(handle.getDoc()).toContain('A question');
      handle.openReviewBar();
      click(buttonNamed(root, 'Next change'));
      click(buttonNamed(root, 'Accept'));
      handle.reset();
      handle.destroy();
      for (const spy of [...spies, cookie]) expect(spy).not.toHaveBeenCalled();
    } finally {
      globalThis.XMLHttpRequest = Original.xhr;
      globalThis.WebSocket = Original.ws;
      if (idb) Object.defineProperty(globalThis, 'indexedDB', idb);
      else delete (globalThis as { indexedDB?: unknown }).indexedDB;
      vi.restoreAllMocks();
    }
  });

  it('labels the editable', () => {
    const { view } = mountForTest('plan');
    expect(view.contentDOM.getAttribute('aria-label')).toBe('Document: plan.md. An editable demo.');
  });
});
