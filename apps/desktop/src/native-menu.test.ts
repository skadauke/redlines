// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { installShortcuts, type MenuCommands } from './native-menu.ts';

function commands() {
  return {
    create: vi.fn(),
    open: vi.fn(),
    save: vi.fn(),
    saveAs: vi.fn(),
    quit: vi.fn(),
    setView: vi.fn(),
    toggleSidebar: vi.fn(),
    toggleTracking: vi.fn(),
    openReview: vi.fn(),
    nextChange: vi.fn(),
    previousChange: vi.fn(),
    setTheme: vi.fn(),
    toggleIconRotation: vi.fn(),
  } satisfies MenuCommands;
}

const press = (code: string, modifiers: KeyboardEventInit) => {
  const event = new KeyboardEvent('keydown', { code, cancelable: true, ...modifiers });
  window.dispatchEvent(event);
  return event.defaultPrevented;
};

describe('browser shortcuts', () => {
  it('runs the menu bar’s commands from the keyboard', () => {
    const c = commands();
    const stop = installShortcuts(c);
    expect(press('KeyE', { metaKey: true, shiftKey: true })).toBe(true);
    expect(c.toggleTracking).toHaveBeenCalledOnce();
    // Option changes the character typed, so the key's position decides.
    press('Digit3', { metaKey: true, altKey: true, key: '£' });
    expect(c.setView).toHaveBeenCalledWith('raw');
    press('KeyS', { metaKey: true, ctrlKey: true });
    expect(c.toggleSidebar).toHaveBeenCalledOnce();
    expect(c.save).not.toHaveBeenCalled();
    press('KeyS', { metaKey: true });
    expect(c.save).toHaveBeenCalledOnce();
    press('BracketRight', { metaKey: true, altKey: true });
    expect(c.nextChange).toHaveBeenCalledOnce();
    stop();
  });

  it('leaves other keys alone', () => {
    const c = commands();
    const stop = installShortcuts(c);
    expect(press('KeyE', { metaKey: true })).toBe(false);
    expect(press('KeyS', { ctrlKey: true })).toBe(false);
    expect(press('Digit3', { metaKey: true })).toBe(false);
    expect(c.toggleTracking).not.toHaveBeenCalled();
    expect(c.save).not.toHaveBeenCalled();
    expect(c.setView).not.toHaveBeenCalled();
    stop();
  });
});
