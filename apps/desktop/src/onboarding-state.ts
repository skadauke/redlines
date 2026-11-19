// Whether the first-launch onboarding (#1206, design §5.11a) is to be shown. The app notes that it
// began and that it finished, in the page's storage and apart from the settings, which any change
// writes: an app that has settings and never noted either is an earlier build's, not a first launch.

import { SETTINGS_KEY } from './settings.ts';

export const ONBOARDING_KEY = 'redlines.onboarding';

type Reader = Pick<Storage, 'getItem'>;
type Writer = Pick<Storage, 'setItem'>;

/** Whether this launch shows the onboarding: never started, with no settings from before; or started and never finished. */
export function shouldOnboard(storage: Reader): boolean {
  const noted = storage.getItem(ONBOARDING_KEY);
  if (noted === 'done') return false;
  if (noted === 'started') return true;
  return storage.getItem(SETTINGS_KEY) === null;
}

export function noteStarted(storage: Writer): void {
  try {
    storage.setItem(ONBOARDING_KEY, 'started');
  } catch {
    // Without storage the onboarding is shown again: harmless.
  }
}

export function noteFinished(storage: Writer): void {
  try {
    storage.setItem(ONBOARDING_KEY, 'done');
  } catch {
    // As above.
  }
}
