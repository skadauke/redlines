// Notifications: small cards stacked in the lower-right corner of the window, for news that must
// not interrupt, such as an update that is ready (#34). They are drawn in the theme's grays, never
// take the focus and never make a sound. Each says one thing, may offer an action, and can be
// dismissed; it stays until it is handled, unless it only passes by. Their buttons are on the
// keyboard's way, Esc dismisses the one that has the keyboard, and the keyboard then goes back to
// where it was.

import { icon } from './icons.ts';

/** How long a notification that passes by stays, unless the pointer or the keyboard is on it. */
export const PASSING_MS = 4000;

export interface NotificationAction {
  label: string;
  /** Does what the notification offers. The notification stays until this closes it. */
  run(notification: Notification): void;
}

export interface NotificationOptions {
  text: string;
  action?: NotificationAction;
  /** The dismiss button's word, such as "Later"; without one, the button is a cross. */
  dismissLabel?: string;
  /** Closes it after this many milliseconds; without it, it stays until it is handled. */
  timeout?: number;
  /** A notification shown with the same key replaces this one. */
  key?: string;
  /** Called when the person dismisses it, not when it closes otherwise. */
  onDismiss?(): void;
}

export interface Notification {
  readonly element: HTMLElement;
  /** Takes it away. */
  close(): void;
  /** Turns its buttons off while its action is under way, or on again. */
  setBusy(busy: boolean): void;
}

export interface Notifications {
  show(options: NotificationOptions): Notification;
  /** Takes every notification away. */
  clear(): void;
  destroy(): void;
}

export function createNotifications(container: HTMLElement): Notifications {
  const stack = document.createElement('section');
  stack.className = 'rl-notifications';
  stack.setAttribute('aria-label', 'Notifications');
  stack.setAttribute('aria-live', 'polite');
  container.append(stack);

  const open = new Set<{ notification: Notification; key?: string }>();
  // Where the keyboard was before it came to a notification, to give it back there.
  let returnTo: HTMLElement | null = null;
  const onFocus = (event: FocusEvent) => {
    const target = event.target;
    if (target instanceof HTMLElement && !stack.contains(target)) returnTo = target;
  };
  document.addEventListener('focusin', onFocus);
  if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) {
    returnTo = document.activeElement;
  }

  function show(options: NotificationOptions): Notification {
    for (const entry of open) {
      if (options.key !== undefined && entry.key === options.key) entry.notification.close();
    }

    const card = document.createElement('div');
    card.className = 'rl-notification';
    const text = document.createElement('p');
    text.className = 'rl-notification-text';
    text.textContent = options.text;
    const buttons = document.createElement('div');
    buttons.className = 'rl-notification-buttons';
    card.append(text, buttons);

    const makeButton = (className: string, label: string | null, onClick: () => void) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = className;
      if (label === null) {
        b.setAttribute('aria-label', 'Dismiss');
        b.append(icon('close', 12));
      } else {
        b.textContent = label;
      }
      b.addEventListener('click', onClick);
      buttons.append(b);
      return b;
    };

    let timer: ReturnType<typeof setTimeout> | undefined;
    let hovered = false;
    let closed = false;
    const notification: Notification = {
      element: card,
      close() {
        if (closed) return;
        closed = true;
        clearTimeout(timer);
        open.delete(entry);
        const hadFocus = card.contains(document.activeElement);
        card.remove();
        if (hadFocus) giveFocusBack();
      },
      setBusy(busy) {
        for (const b of buttons.querySelectorAll('button')) b.disabled = busy;
      },
    };
    const entry = { notification, key: options.key };
    const dismiss = () => {
      notification.close();
      options.onDismiss?.();
    };

    // The action comes last, where the Mac puts the default button. A card with only a cross has
    // it beside the text.
    const { action, dismissLabel } = options;
    if (dismissLabel === undefined) {
      makeButton('rl-notification-close', null, dismiss);
    } else {
      makeButton('rl-notification-dismiss', dismissLabel, dismiss);
    }
    if (action) makeButton('rl-notification-action', action.label, () => action.run(notification));
    if (!action && dismissLabel === undefined) card.classList.add('rl-notification-compact');

    // A notification that passes by waits while the pointer or the keyboard is on it.
    const wait = () => {
      clearTimeout(timer);
      if (options.timeout === undefined || hovered || card.contains(document.activeElement)) return;
      timer = setTimeout(() => notification.close(), options.timeout);
    };
    card.addEventListener('pointerenter', () => {
      hovered = true;
      wait();
    });
    card.addEventListener('pointerleave', () => {
      hovered = false;
      wait();
    });
    card.addEventListener('focusin', wait);
    card.addEventListener('focusout', () => setTimeout(wait));
    card.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      dismiss();
    });

    open.add(entry);
    stack.append(card);
    wait();
    return notification;
  }

  function giveFocusBack() {
    if (returnTo?.isConnected) returnTo.focus();
  }

  return {
    show,
    clear() {
      for (const { notification } of [...open]) notification.close();
    },
    destroy() {
      for (const { notification } of [...open]) notification.close();
      document.removeEventListener('focusin', onFocus);
      stack.remove();
    },
  };
}
