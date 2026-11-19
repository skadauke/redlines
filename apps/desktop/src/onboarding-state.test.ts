// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from 'vitest';
import { noteFinished, noteStarted, ONBOARDING_KEY, shouldOnboard } from './onboarding-state.ts';
import { SETTINGS_KEY } from './settings.ts';

beforeEach(() => localStorage.clear());

describe('whether the onboarding is shown (#1206)', () => {
  it('is shown on a first launch, which has no settings and has noted nothing', () => {
    expect(shouldOnboard(localStorage)).toBe(true);
  });

  it('is not shown by an app with settings from an earlier build', () => {
    localStorage.setItem(SETTINGS_KEY, '{}');
    expect(shouldOnboard(localStorage)).toBe(false);
  });

  it('starts again when it was begun and not finished, even with settings made meanwhile', () => {
    noteStarted(localStorage);
    localStorage.setItem(SETTINGS_KEY, '{"identity":{"name":"Ada","handle":"ada"}}');
    expect(shouldOnboard(localStorage)).toBe(true);
  });

  it('is not shown again once finished, or skipped', () => {
    noteStarted(localStorage);
    noteFinished(localStorage);
    expect(localStorage.getItem(ONBOARDING_KEY)).toBe('done');
    expect(shouldOnboard(localStorage)).toBe(false);
  });
});
