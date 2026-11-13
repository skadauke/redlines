// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PANE_REQUEST_KEY,
  REQUEST_MS,
  requestPane,
  takePaneRequest,
  watchPaneRequests,
} from './pane-request.ts';
import { PANES } from './panes.ts';

afterEach(() => localStorage.clear());

/** What another window's `setItem` tells this one. */
function told(newValue: string | null) {
  window.dispatchEvent(new StorageEvent('storage', { key: PANE_REQUEST_KEY, newValue }));
}

describe('a request for a pane', () => {
  it('knows every pane of the window', () => {
    for (const { id } of PANES) {
      requestPane(id);
      expect(takePaneRequest()).toBe(id);
    }
  });

  it('is taken by the window that opens, and only once', () => {
    requestPane('agents', 1000);
    expect(takePaneRequest(1500)).toBe('agents');
    expect(localStorage.getItem(PANE_REQUEST_KEY)).toBeNull();
    expect(takePaneRequest(1500)).toBeNull();
  });

  it('is no request when it waited too long for a window, or comes from the future', () => {
    requestPane('agents', 1000);
    expect(takePaneRequest(1000 + REQUEST_MS + 1)).toBeNull();
    requestPane('agents', 1000 + REQUEST_MS + 1);
    expect(takePaneRequest(1000)).toBeNull();
    // Taken away all the same, so that it is never found later.
    expect(localStorage.getItem(PANE_REQUEST_KEY)).toBeNull();
  });

  it('is no request when it is not one', () => {
    for (const stored of [
      'agents',
      '{',
      'null',
      '[]',
      JSON.stringify({ pane: 'nowhere', at: 1000 }),
      JSON.stringify({ pane: 5, at: 1000 }),
      JSON.stringify({ pane: 'agents' }),
      JSON.stringify({ pane: 'agents', at: 'now' }),
    ]) {
      localStorage.setItem(PANE_REQUEST_KEY, stored);
      expect(takePaneRequest(1000), stored).toBeNull();
    }
    expect(takePaneRequest()).toBeNull();
  });

  it('survives storage that is switched off', () => {
    const broken = () => {
      throw new Error('SecurityError');
    };
    vi.stubGlobal('localStorage', { getItem: broken, setItem: broken, removeItem: broken });
    expect(() => requestPane('agents')).not.toThrow();
    expect(takePaneRequest()).toBeNull();
    vi.unstubAllGlobals();
  });

  it('is a change every time, even for the same pane, so that an open window is told', () => {
    requestPane('agents', 1000);
    const first = localStorage.getItem(PANE_REQUEST_KEY);
    requestPane('agents', 2000);
    expect(localStorage.getItem(PANE_REQUEST_KEY)).not.toBe(first);
  });
});

describe('watching for requests', () => {
  it('shows the pane to a window that is open, and takes the request away', () => {
    const shown: string[] = [];
    const stop = watchPaneRequests((pane) => shown.push(pane));
    requestPane('agents');
    told(localStorage.getItem(PANE_REQUEST_KEY));
    expect(shown).toEqual(['agents']);
    expect(localStorage.getItem(PANE_REQUEST_KEY)).toBeNull();
    stop();
    told(JSON.stringify({ pane: 'editor', at: Date.now() }));
    expect(shown).toEqual(['agents']);
  });

  it('hears nothing of other keys, a request taken away, or one that is not one', () => {
    const shown: string[] = [];
    const stop = watchPaneRequests((pane) => shown.push(pane));
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: 'redlines.settings',
        newValue: JSON.stringify({ pane: 'agents', at: Date.now() }),
      }),
    );
    told(null);
    told('agents');
    told(JSON.stringify({ pane: 'agents', at: Date.now() - REQUEST_MS - 5 }));
    expect(shown).toEqual([]);
    stop();
  });
});
