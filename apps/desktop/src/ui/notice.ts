// Notices: one slim line under the title bar, never a dialog. A standing notice, such as a conflict
// with the file on disk, stays until it is dismissed; a passing one, such as "Track Changes on",
// shows for a moment and then gives the line back.

import { icon } from './icons.ts';

export const PASSING_MS = 2400;

export interface Notice {
  /** Shows a notice that stays until `onDismiss` runs from its close button, or null to clear it. */
  setStanding(text: string | null, onDismiss?: () => void): void;
  /** Shows a notice for a moment. */
  flash(text: string): void;
  destroy(): void;
}

export function createNotice(container: HTMLElement): Notice {
  const box = document.createElement('div');
  box.className = 'rl-notice';
  box.setAttribute('role', 'status');
  box.hidden = true;
  const text = document.createElement('span');
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'rl-notice-close';
  close.setAttribute('aria-label', 'Dismiss');
  close.append(icon('close', 12));
  box.append(text, close);
  container.append(box);

  let standing: { text: string; onDismiss?: () => void } | null = null;
  let passing: string | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const render = () => {
    const shown = passing ?? standing?.text ?? null;
    box.hidden = shown === null;
    text.textContent = shown ?? '';
    close.hidden = passing !== null || !standing?.onDismiss;
  };

  close.addEventListener('click', () => standing?.onDismiss?.());

  return {
    setStanding(next, onDismiss) {
      standing = next === null ? null : { text: next, onDismiss };
      render();
    },
    flash(next) {
      clearTimeout(timer);
      passing = next;
      render();
      timer = setTimeout(() => {
        passing = null;
        render();
      }, PASSING_MS);
    },
    destroy() {
      clearTimeout(timer);
      box.remove();
    },
  };
}
