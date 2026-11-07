// What the window shows of updates (#34), in notifications: nothing while it checks and downloads;
// once an update is ready, a card that offers Restart to update or Later, and stays until one of
// them is chosen; and the answer to Check for Updates…, in a card that passes by. Failures of the
// automatic checks show nothing at all (the app tries again later).
//
// The updates are the app's, one check and one download for all the windows (updates.ts, #122):
// each window shows the ready update in a card of its own, and Later in one takes the card away in
// all.

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

  /** The card of the update that is ready, while it shows, and that update's version. */
  let readyCard: { card: Notification; version: string } | null = null;
  const closeReady = () => {
    readyCard?.card.close();
    readyCard = null;
  };

  const showReady = (version: string) => {
    const card = notifications.show({
      key: KEY,
      text: `Redlines ${version} is ready to install.`,
      action: { label: 'Restart to update', run: (card) => void restartFrom(card) },
      dismissLabel: 'Later',
      onDismiss: () => updates.dismiss(version),
    });
    readyCard = { card, version };
  };

  let phase = updates.state.phase;
  updates.subscribe((state) => {
    if (state.phase === 'ready' && phase !== 'ready' && state.version !== null) {
      // Not again once dismissed, in this window or another.
      if (updates.dismissed !== state.version) showReady(state.version);
    } else if (state.phase !== 'ready' && phase === 'ready') {
      // What it offered is gone, as when installing it failed.
      closeReady();
    }
    phase = state.phase;
  });
  // Only the card of the version that was dismissed: a newer one is news of its own.
  updates.onDismissed((version) => {
    if (readyCard?.version === version) closeReady();
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
