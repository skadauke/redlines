// What the window shows of updates (#34), in notifications: nothing while it checks and downloads;
// once an update is ready, a card that offers Restart to update or Later, and stays until one of
// them is chosen; and the answer to Check for Updates…, in a card that passes by. Failures of the
// automatic checks show nothing at all (updates.ts tries again later).

import { PASSING_MS, type Notification, type Notifications } from './ui/notifications.ts';
import type { CheckResult, Unavailable, Updates } from './updates.ts';

/** The key of every update card: a new one replaces the one before. */
const KEY = 'update';

/** Why this copy can't update itself, for Check for Updates…. */
export function unavailableText(reason: Unavailable): string {
  switch (reason) {
    case 'development':
      return 'This is a development build of Redlines. It doesn’t update itself.';
    case 'not-set-up':
      return 'Updates aren’t set up in this build of Redlines.';
    case 'disk-image':
      return 'Redlines updates itself once it’s in your Applications folder.';
    case 'read-only':
      return 'Redlines can’t update itself where it’s installed. Ask an administrator to update it.';
    case 'unsupported':
      return 'Redlines doesn’t update itself on this system yet.';
  }
}

export interface UpdatePresenter {
  /** Check for Updates…: checks now and says what it found. */
  checkForUpdates(): Promise<void>;
}

export function presentUpdates(options: {
  updates: Updates;
  notifications: Notifications;
  /**
   * Installs the update and starts the new version, which reopens the document. Resolves to false
   * when it doesn't go on, because the person kept their unsaved edits.
   */
  restart: () => Promise<boolean>;
}): UpdatePresenter {
  const { updates, notifications, restart } = options;

  const pass = (text: string) => notifications.show({ key: KEY, text, timeout: PASSING_MS });

  const restartFrom = async (card: Notification) => {
    card.setBusy(true);
    try {
      if (!(await restart())) card.setBusy(false);
    } catch (error) {
      console.warn('Could not install the update', error);
      card.close();
      pass('Redlines couldn’t update itself. It will try again later.');
    }
  };

  const showReady = (version: string) =>
    notifications.show({
      key: KEY,
      text: `Redlines ${version} is ready to install.`,
      action: { label: 'Restart to update', run: (card) => void restartFrom(card) },
      dismissLabel: 'Later',
    });

  let phase = updates.state.phase;
  updates.subscribe((state) => {
    if (state.phase === 'ready' && phase !== 'ready' && state.version !== null) {
      showReady(state.version);
    }
    phase = state.phase;
  });

  const answer = (result: CheckResult) => {
    switch (result.kind) {
      case 'up-to-date':
        return pass('Redlines is up to date.');
      case 'downloading':
        return pass(`Downloading Redlines ${result.version}…`);
      case 'ready':
        return showReady(result.version);
      case 'failed':
        return pass('Redlines couldn’t check for updates. Try again later.');
      case 'unavailable':
        return pass(unavailableText(result.reason));
    }
  };

  return {
    async checkForUpdates() {
      answer(await updates.checkNow());
    },
  };
}
