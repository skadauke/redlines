import { describe, expect, it } from 'vitest';
import {
  type Dismissal,
  dismiss,
  isShown,
  keyAction,
  setAtBottom,
  start,
  summon,
  wrench,
} from './model.ts';

const WHYS: Dismissal[] = ['escape', 'press', 'scroll', 'resize', 'blur', 'writing', 'zoom'];

describe('the toolbar’s model', () => {
  it('is away at first, and docked at first with the preference', () => {
    expect(isShown(start(false))).toBe(false);
    expect(start(true).how).toBe('docked');
  });

  it('is shown docked by the wrench, and away by the wrench again', () => {
    const shown = wrench(start(false));
    expect(shown.how).toBe('docked');
    expect(isShown(wrench(shown))).toBe(false);
  });

  it('is put away by the wrench however it was shown', () => {
    expect(wrench(summon(start(false), 'context')).how).toBeNull();
    expect(wrench(summon(start(false), 'keyboard')).how).toBeNull();
  });

  it('stays docked whatever happens in the page', () => {
    const docked = wrench(start(false));
    for (const why of WHYS) expect(dismiss(docked, why)).toBe(docked);
  });

  it('is put away by every reason when it came from the keyboard, but typing', () => {
    const state = summon(start(false), 'keyboard');
    for (const why of WHYS) expect(isShown(dismiss(state, why))).toBe(why === 'writing');
  });

  it('is put away by every reason when it came from a right-click, typing too', () => {
    const state = summon(start(false), 'context');
    for (const why of WHYS) expect(isShown(dismiss(state, why))).toBe(false);
  });

  it('follows the preference: shown when it is on, and the docked one goes when it is off', () => {
    const on = setAtBottom(start(false), true);
    expect(on).toEqual({ atBottom: true, how: 'docked' });
    expect(setAtBottom(on, false)).toEqual({ atBottom: false, how: null });
    // A toolbar at the caret is not the preference's to put away.
    expect(setAtBottom(summon(start(true), 'keyboard'), false).how).toBe('keyboard');
  });

  it('leaves a toolbar the wrench put away alone while the preference stays', () => {
    const hidden = wrench(start(true));
    expect(hidden.how).toBeNull();
    expect(setAtBottom(hidden, true)).toBe(hidden);
  });

  it('gives ⌘⇧P its meaning from the state', () => {
    expect(keyAction(start(false), false)).toBe('show-at-caret');
    expect(keyAction(summon(start(false), 'keyboard'), true)).toBe('hide');
    expect(keyAction(summon(start(false), 'context'), false)).toBe('hide');
    expect(keyAction(wrench(start(false)), false)).toBe('focus-toolbar');
    expect(keyAction(wrench(start(false)), true)).toBe('focus-document');
  });
});
