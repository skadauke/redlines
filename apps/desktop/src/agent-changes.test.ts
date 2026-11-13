// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AGENTS_CHANGED_KEY, announceAgentsChanged, watchAgentsChanged } from './agent-changes.ts';

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('announcing that an agent changed', () => {
  it('is a change every time, so that every other window is told', () => {
    announceAgentsChanged(1000);
    const first = localStorage.getItem(AGENTS_CHANGED_KEY);
    announceAgentsChanged(2000);
    expect(localStorage.getItem(AGENTS_CHANGED_KEY)).not.toBe(first);
  });

  it('is heard by a window that watches, and by no other key', () => {
    const heard: string[] = [];
    const stop = watchAgentsChanged(() => heard.push('changed'));
    window.dispatchEvent(new StorageEvent('storage', { key: AGENTS_CHANGED_KEY, newValue: '1' }));
    window.dispatchEvent(new StorageEvent('storage', { key: 'redlines.settings', newValue: '1' }));
    window.dispatchEvent(new StorageEvent('storage', { key: AGENTS_CHANGED_KEY, newValue: null }));
    expect(heard).toEqual(['changed']);
    stop();
    window.dispatchEvent(new StorageEvent('storage', { key: AGENTS_CHANGED_KEY, newValue: '2' }));
    expect(heard).toEqual(['changed']);
  });

  it('survives storage that is switched off', () => {
    const broken = () => {
      throw new Error('SecurityError');
    };
    vi.stubGlobal('localStorage', { setItem: broken });
    expect(() => announceAgentsChanged()).not.toThrow();
  });
});
