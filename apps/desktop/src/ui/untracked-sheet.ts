// The alert (design: widen, alert or disable, §3.1): a sheet that drops from the title bar, modal to
// its window, when an edit can't be tracked and the person is asked whether to make it without
// tracking. It is the one place the app interrupts; notices and notifications never do. Return and
// Escape are Cancel, so that a person who types and presses Return doesn't make an untracked edit by
// habit; Make Edit is a click, or ⌘↩.

import { UNTRACKED_DETAILS, UNTRACKED_TITLE } from '@redlines/editor';
import type { UntrackedAnswer, UntrackedAsker, UntrackedReason } from '@redlines/editor';
import type { UntrackedAnswers } from '../untracked-answers.ts';

export interface UntrackedSheetOptions {
  /** The window the sheet is attached to. */
  container: HTMLElement;
  /** The path of the document, which "Don't ask again" is kept for; null before it is saved. */
  path: () => string | null;
  answers: UntrackedAnswers;
  /** Gives the keyboard back to the editor when the sheet closes. */
  restoreFocus: () => void;
}

export function createUntrackedSheet(options: UntrackedSheetOptions): UntrackedAsker {
  const { container, answers } = options;
  let open = false;

  const ask = (reason: UntrackedReason): Promise<UntrackedAnswer> =>
    new Promise((resolve) => {
      open = true;
      const backdrop = document.createElement('div');
      backdrop.className = 'rl-sheet-backdrop';
      const sheet = document.createElement('div');
      sheet.className = 'rl-sheet';
      sheet.setAttribute('role', 'alertdialog');
      sheet.setAttribute('aria-modal', 'true');
      sheet.setAttribute('aria-labelledby', 'rl-sheet-title');
      sheet.setAttribute('aria-describedby', 'rl-sheet-detail');
      const title = document.createElement('div');
      title.id = 'rl-sheet-title';
      title.className = 'rl-sheet-title';
      title.textContent = UNTRACKED_TITLE;
      const detail = document.createElement('div');
      detail.id = 'rl-sheet-detail';
      detail.className = 'rl-sheet-detail';
      detail.textContent = UNTRACKED_DETAILS[reason];
      const label = document.createElement('label');
      label.className = 'rl-sheet-check';
      const check = document.createElement('input');
      check.type = 'checkbox';
      label.append(check, document.createTextNode("Don't ask again in this document"));
      const buttons = document.createElement('div');
      buttons.className = 'rl-sheet-buttons';
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'rl-sheet-button rl-sheet-default';
      cancel.textContent = 'Cancel';
      const make = document.createElement('button');
      make.type = 'button';
      make.className = 'rl-sheet-button';
      make.textContent = 'Make Edit';
      buttons.append(cancel, make);
      sheet.append(title, detail, label, buttons);
      backdrop.append(sheet);
      container.append(backdrop);
      cancel.focus();

      const done = (answer: UntrackedAnswer) => {
        if (answer === 'make' && check.checked) answers.skip(options.path());
        backdrop.remove();
        open = false;
        options.restoreFocus();
        resolve(answer);
      };
      cancel.addEventListener('click', () => done('cancel'));
      make.addEventListener('click', () => done('make'));
      backdrop.addEventListener('keydown', (event) => {
        const focusable = [check, cancel, make];
        if (event.key === 'Escape') {
          event.preventDefault();
          done('cancel');
        } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          done('make');
        } else if (event.key === 'Enter' && event.target !== make) {
          event.preventDefault();
          done('cancel');
        } else if (event.key === 'Tab') {
          // The sheet is modal: the keyboard stays in it.
          event.preventDefault();
          const at = focusable.indexOf(document.activeElement as HTMLInputElement);
          const step = event.shiftKey ? -1 : 1;
          focusable[(at + step + focusable.length) % focusable.length]?.focus();
        }
      });
      // A click outside the sheet is nothing: it doesn't answer.
      backdrop.addEventListener('mousedown', (event) => {
        if (event.target === backdrop) event.preventDefault();
      });
    });

  return {
    ask,
    skip: () => !open && answers.skipped(options.path()),
  };
}
