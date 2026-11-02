// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNotifications, PASSING_MS } from './notifications.ts';

function setup() {
  // A stand-in for the editor, which has the keyboard while a notification comes and goes.
  const editor = document.createElement('textarea');
  document.body.append(editor);
  editor.focus();
  const notifications = createNotifications(document.body);
  const stack = () => {
    const found = document.querySelector<HTMLElement>('.rl-notifications');
    if (!found) throw new Error('no notification stack');
    return found;
  };
  const cards = () => [...stack().querySelectorAll<HTMLElement>('.rl-notification')];
  const texts = () =>
    cards().map((card) => card.querySelector('.rl-notification-text')?.textContent);
  return { editor, notifications, stack, cards, texts };
}

function button(card: HTMLElement | undefined, label: string): HTMLButtonElement {
  const found = [...(card?.querySelectorAll('button') ?? [])].find(
    (b) => (b.getAttribute('aria-label') ?? b.textContent) === label,
  );
  if (!found) throw new Error(`no ${label} button`);
  return found;
}

const press = (el: Element, key: string) =>
  el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('notifications', () => {
  it('stack in one labeled place, the newest last, nearest the corner', () => {
    const { notifications, stack, texts } = setup();
    notifications.show({ text: 'Track Changes is on' });
    notifications.show({ text: 'Redlines 0.2.0 is ready to install.' });
    expect(texts()).toEqual(['Track Changes is on', 'Redlines 0.2.0 is ready to install.']);
    expect(stack().getAttribute('aria-label')).toBe('Notifications');
    // Read out as they come, without taking the focus.
    expect(stack().getAttribute('aria-live')).toBe('polite');
  });

  it('never take the focus, but their buttons are on the keyboard’s way', () => {
    const { editor, notifications, cards } = setup();
    notifications.show({ text: 'Ready', action: { label: 'Restart to update', run: vi.fn() } });
    expect(document.activeElement).toBe(editor);
    for (const b of cards()[0]?.querySelectorAll('button') ?? []) {
      expect(b.type).toBe('button');
      expect(b.tabIndex).toBe(0);
    }
  });

  it('dismiss with a cross, or with a word of their own', () => {
    const { notifications, cards, texts } = setup();
    const onDismiss = vi.fn();
    notifications.show({ text: 'Plain', onDismiss });
    notifications.show({ text: 'Worded', dismissLabel: 'Later' });
    expect(button(cards()[0], 'Dismiss').textContent).toBe('');
    expect(button(cards()[1], 'Later').getAttribute('aria-label')).toBeNull();
    button(cards()[0], 'Dismiss').click();
    expect(onDismiss).toHaveBeenCalledOnce();
    expect(texts()).toEqual(['Worded']);
  });

  it('put the action last, where the Mac puts the default button', () => {
    const { notifications, cards } = setup();
    notifications.show({
      text: 'Ready',
      action: { label: 'Restart to update', run: vi.fn() },
      dismissLabel: 'Later',
    });
    notifications.show({ text: 'Redlines is up to date.' });
    const [offer, plain] = cards();
    expect([...(offer?.querySelectorAll('button') ?? [])].map((b) => b.textContent)).toEqual([
      'Later',
      'Restart to update',
    ]);
    // A card that only says something has its cross beside the text.
    expect(offer?.classList.contains('rl-notification-compact')).toBe(false);
    expect(plain?.classList.contains('rl-notification-compact')).toBe(true);
  });

  it('stay until their action handles them', () => {
    const { notifications, cards, texts } = setup();
    const run = vi.fn();
    const shown = notifications.show({
      text: 'Ready',
      action: { label: 'Restart to update', run },
    });
    button(cards()[0], 'Restart to update').click();
    expect(run).toHaveBeenCalledWith(shown);
    vi.advanceTimersByTime(60 * 60 * 1000);
    expect(texts()).toEqual(['Ready']);
    shown.close();
    expect(texts()).toEqual([]);
  });

  it('turn their buttons off while their action is under way', () => {
    const { notifications, cards } = setup();
    const shown = notifications.show({
      text: 'Ready',
      action: { label: 'Restart to update', run: vi.fn() },
      dismissLabel: 'Later',
    });
    shown.setBusy(true);
    expect(button(cards()[0], 'Restart to update').disabled).toBe(true);
    expect(button(cards()[0], 'Later').disabled).toBe(true);
    shown.setBusy(false);
    expect(button(cards()[0], 'Later').disabled).toBe(false);
  });

  it('replace the one with the same key', () => {
    const { notifications, texts } = setup();
    notifications.show({ text: 'Checking', key: 'updates' });
    notifications.show({ text: 'Track Changes is on' });
    notifications.show({ text: 'Redlines is up to date.', key: 'updates' });
    expect(texts()).toEqual(['Track Changes is on', 'Redlines is up to date.']);
  });

  it('pass by after a while, but not while the pointer or the keyboard is on them', () => {
    const { notifications, cards, texts } = setup();
    notifications.show({ text: 'Redlines is up to date.', timeout: PASSING_MS });
    vi.advanceTimersByTime(PASSING_MS - 1);
    expect(texts()).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(texts()).toHaveLength(0);

    notifications.show({ text: 'Redlines is up to date.', timeout: PASSING_MS });
    const card = cards()[0];
    card?.dispatchEvent(new PointerEvent('pointerenter'));
    vi.advanceTimersByTime(PASSING_MS * 3);
    expect(texts()).toHaveLength(1);
    card?.dispatchEvent(new PointerEvent('pointerleave'));
    vi.advanceTimersByTime(PASSING_MS);
    expect(texts()).toHaveLength(0);
  });

  it('close with Esc when they have the keyboard, and give it back', () => {
    const { editor, notifications, cards, texts } = setup();
    const onDismiss = vi.fn();
    notifications.show({ text: 'Ready', dismissLabel: 'Later', onDismiss });
    const later = button(cards()[0], 'Later');
    later.focus();
    expect(document.activeElement).toBe(later);
    expect(press(later, 'Escape')).toBe(false);
    expect(onDismiss).toHaveBeenCalledOnce();
    expect(texts()).toEqual([]);
    expect(document.activeElement).toBe(editor);
  });

  it('give the keyboard back when one closes under it by itself', () => {
    const { editor, notifications, cards } = setup();
    const shown = notifications.show({ text: 'Ready', dismissLabel: 'Later' });
    button(cards()[0], 'Later').focus();
    shown.close();
    expect(document.activeElement).toBe(editor);
  });

  it('leave other keys alone', () => {
    const { notifications, cards, texts } = setup();
    notifications.show({ text: 'Ready', dismissLabel: 'Later' });
    expect(press(button(cards()[0], 'Later'), 'a')).toBe(true);
    expect(texts()).toEqual(['Ready']);
  });

  it('all go at once', () => {
    const { notifications, stack, texts } = setup();
    notifications.show({ text: 'One' });
    notifications.show({ text: 'Two', timeout: PASSING_MS });
    notifications.clear();
    expect(texts()).toEqual([]);
    vi.advanceTimersByTime(PASSING_MS);
    notifications.destroy();
    expect(stack.bind(null)).toThrow();
  });
});
