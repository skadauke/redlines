import { describe, expect, it } from 'vitest';
import { MAC_TIMES, NEW_MAC_SETUP, macPlan, type MacSetup } from './mac-setup.ts';
import type { TailscaleStatus } from './tailscale.ts';

const base: TailscaleStatus = {
  state: 'ready',
  program: '/Applications/Tailscale.app/Contents/MacOS/Tailscale',
  account: null,
  tailnet: null,
  this_mac: null,
  auth_url: null,
  peers: [],
  blocked: false,
  health: [],
  allow_in: 'System Settings › General › Login Items & Extensions › Network Extensions',
};
const NOW = 1_000_000;
const of = (status: Partial<TailscaleStatus>, setup: Partial<MacSetup> = {}, now = NOW) =>
  macPlan({ ...base, ...status }, { ...NEW_MAC_SETUP, ...setup }, now);
const ids = (plan: ReturnType<typeof of>) => plan.buttons.map((button) => button.id);

describe('what the setup does about Tailscale on this Mac', () => {
  it('offers the install first and the App Store second, and runs neither by itself', () => {
    const plan = of({ state: 'missing' });
    expect(ids(plan)).toEqual(['install', 'app-store']);
    expect(plan.buttons[0]?.primary).toBe(true);
    expect(plan.autoRestart).toBe(false);
    expect(plan.notes.join(' ')).toMatch(/Tailscale signed it and Apple notarized it/);
    expect(plan.notes.join(' ')).toMatch(/never sees the password/);
  });

  it('follows the install, the App Store page and a failure with the app’s own words', () => {
    const working = of(
      { state: 'missing' },
      { install: { phase: 'working', step: 'Downloading…' } },
    );
    expect(working.waiting).toBe('Downloading…');
    expect(working.buttons).toEqual([]);
    const store = of(
      { state: 'missing' },
      { install: { phase: 'app-store', step: 'Not an admin.' } },
    );
    expect(store.notes).toEqual(['Not an admin.']);
    expect(ids(store)).toEqual(['app-store']);
    const failed = of({ state: 'missing' }, { install: { phase: 'failed', step: 'It stopped.' } });
    expect(failed.notes).toEqual(['It stopped.']);
    expect(ids(failed)).toEqual(['install', 'app-store']);
    expect(failed.buttons[0]?.label).toBe('Try again');
  });

  it('opens an installed app that is off, waits for it, and then says where to allow it', () => {
    expect(ids(of({ state: 'off' }))).toEqual(['open']);
    const opened = { openedAt: NOW };
    const soon = of({ state: 'off' }, opened, NOW + MAC_TIMES.extension - 1);
    expect(soon.waiting).toBe('Waiting for Tailscale to start…');
    const late = of({ state: 'off' }, opened, NOW + MAC_TIMES.extension);
    expect(late.notes.join(' ')).toContain('Login Items & Extensions › Network Extensions');
    expect(late.notes.join(' ')).toContain('network extension');
    expect(ids(late)).toEqual(['open', 'restart']);
    // An older macOS has another place, which the app names.
    const old = macPlan(
      { ...base, state: 'off', allow_in: 'System Settings › Privacy & Security' },
      { ...NEW_MAC_SETUP, ...opened },
      NOW + MAC_TIMES.extension,
    );
    expect(old.notes.join(' ')).toContain('System Settings › Privacy & Security');
  });

  it('restarts the app once after a fresh install, when it answers and asks to sign in', () => {
    const fresh = { installedHere: true };
    const plan = of({ state: 'signed-out' }, fresh);
    expect(plan.autoRestart).toBe(true);
    expect(plan.waiting).toContain('Restarting Tailscale');
    // Once: after it, the sign-in is the person’s to start.
    const after = of({ state: 'signed-out' }, { ...fresh, restarts: 1 });
    expect(after.autoRestart).toBe(false);
    expect(ids(after)).toEqual(['sign-in']);
    // An install from the App Store, or a Tailscale that was there, is not restarted.
    expect(of({ state: 'signed-out' }).autoRestart).toBe(false);
  });

  it('follows a sign-in, and restarts the app when it hangs: once by itself, then by the button', () => {
    const started = { signInAt: NOW };
    const given = of({ state: 'signed-out', auth_url: 'https://login.tailscale.com/a/1' }, started);
    expect(given.waiting).toContain('finish signing in');
    expect(ids(given)).toEqual(['sign-in']);
    expect(given.buttons[0]?.label).toBe('Open the sign-in page again');
    // No page yet: it is only starting.
    expect(of({ state: 'signed-out' }, started, NOW + MAC_TIMES.signIn - 1).waiting).toBe(
      'Starting the sign-in…',
    );
    // No page for too long: Log in does nothing (the app missed its extension).
    const hung = of({ state: 'signed-out' }, started, NOW + MAC_TIMES.signIn);
    expect(hung.autoRestart).toBe(true);
    // After that restart it still hangs: it says what to do and offers the button.
    const still = of({ state: 'signed-out' }, { ...started, restarts: 1 }, NOW + MAC_TIMES.signIn);
    expect(still.autoRestart).toBe(false);
    expect(ids(still)).toEqual(['restart', 'sign-in']);
    expect(still.notes.join(' ')).toContain('still doesn’t start');
  });

  it('has nothing to do for a Mac that is signed in, and never says backend, node or daemon', () => {
    expect(of({ state: 'ready' })).toEqual({
      waiting: null,
      notes: [],
      buttons: [],
      autoRestart: false,
    });
    const every = [
      of({ state: 'missing' }),
      of({ state: 'off' }, { openedAt: NOW }, NOW + MAC_TIMES.extension),
      of({ state: 'signed-out' }, { signInAt: NOW }, NOW + MAC_TIMES.signIn),
      of({ state: 'signed-out' }, { signInAt: NOW, restarts: 1 }, NOW + MAC_TIMES.signIn),
    ];
    for (const plan of every) {
      const said = [plan.waiting, ...plan.notes, ...plan.buttons.map((b) => b.label)].join(' ');
      expect(said).not.toMatch(/backend|\bnode\b|daemon|tailnet|sentinel/i);
    }
  });
});
