// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  reportWelcome,
  requestWelcome,
  takeWelcomeRequest,
  watchWelcomeRequests,
  watchWelcomeResult,
  WELCOME_REQUEST_KEY,
  WELCOME_REQUEST_MS,
  WELCOME_RESULT_KEY,
} from './welcome-request.ts';

beforeEach(() => localStorage.clear());

/** What another window's `setItem` tells this one. */
function told(key: string, newValue: string | null): void {
  window.dispatchEvent(new StorageEvent('storage', { key, newValue }));
}

describe('asking the Preferences window for its Welcome mode (#1206)', () => {
  it('is taken by a window that opens, once', () => {
    requestWelcome();
    expect(takeWelcomeRequest()).toBe(true);
    expect(takeWelcomeRequest()).toBe(false);
  });

  it('is no request when it waited too long for a window that never opened', () => {
    requestWelcome(1000);
    expect(takeWelcomeRequest(1000 + WELCOME_REQUEST_MS + 1)).toBe(false);
  });

  it('reaches a window that is open, which takes it away', () => {
    const asked = vi.fn();
    const stop = watchWelcomeRequests(asked);
    localStorage.setItem(WELCOME_REQUEST_KEY, JSON.stringify({ at: Date.now() }));
    told(WELCOME_REQUEST_KEY, localStorage.getItem(WELCOME_REQUEST_KEY));
    expect(asked).toHaveBeenCalledOnce();
    expect(localStorage.getItem(WELCOME_REQUEST_KEY)).toBeNull();
    stop();
  });
});

describe('how the Welcome mode ended', () => {
  it('is told once to the window that asked, and taken away', () => {
    const ended = vi.fn();
    watchWelcomeResult(ended);
    reportWelcome('finished');
    told(WELCOME_RESULT_KEY, localStorage.getItem(WELCOME_RESULT_KEY));
    told(WELCOME_RESULT_KEY, JSON.stringify({ result: 'skipped', at: Date.now() }));
    expect(ended).toHaveBeenCalledExactlyOnceWith('finished');
    expect(localStorage.getItem(WELCOME_RESULT_KEY)).toBeNull();
  });
});
