// The page's side of the window zoom (design §5.1). The app (src-tauri/src/zoom.rs) is the only
// writer of WebKit's page zoom: it keeps the level, hands each new page its level in an
// initialization script, and on a change tells every window with the `zoom` event and then sets
// the window's page zoom. A page asks for a level with the app's `set_zoom` command, takes its
// reading place on the event (the layout is still the old one), and sets `--rl-zoom`, which the
// frame's units are worked out from (zoom.css), on the `resize` that the new zoom brings.

import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { LADDER } from './text-size.ts';

/** The event the app sends a window with the level, just before it sets the window's zoom. */
export const ZOOM_EVENT = 'zoom';

/** How long the page waits for the app's answer to its report before it starts without it. */
export const REPORT_WAIT_MS = 3000;

/** How long after the event the page waits for the `resize` before it sets `--rl-zoom` anyway. */
export const RESIZE_WAIT_MS = 500;

/** The level the app's initialization script handed this page (`window.__REDLINES_ZOOM__`), if a rung. */
export function initialZoom(): number | null {
  const level = (window as unknown as { __REDLINES_ZOOM__?: unknown }).__REDLINES_ZOOM__;
  return typeof level === 'number' && LADDER.includes(level) ? level : null;
}

/** Sets `--rl-zoom` on `root`. */
export function applyZoom(root: HTMLElement, level: number): void {
  root.style.setProperty('--rl-zoom', String(level));
}

/** What the page and the app say to each other. */
export interface ZoomLink {
  /** The app's `set_zoom` command. */
  set: (level: number) => Promise<void>;
  /** The app's `zoom_level` command: its level, or, while it has none, the report taken. */
  report: (level: number) => Promise<number>;
  /** The `zoom` event, to this window. */
  listen: (handler: (level: number) => void) => Promise<unknown>;
}

export function tauriZoomLink(): ZoomLink {
  return {
    set: (level) => invoke('set_zoom', { level }),
    report: (reported) => invoke<number>('zoom_level', { reported }),
    listen: (handler) =>
      getCurrentWebviewWindow().listen<number>(ZOOM_EVENT, (event) => handler(event.payload)),
  };
}

export interface ZoomOptions {
  root: HTMLElement;
  win: Window;
  /** The level `--rl-zoom` has now: what `initialZoom()` gave, or 1. */
  level: number;
  /** The level in this window's settings, and how to save another there. */
  settings: () => number;
  save: (level: number) => void;
  /** On the event, before WebKit's zoom changes; `from` is the level the page is laid out at. */
  before?: (level: number, from: number) => void;
  /** Once `--rl-zoom` is `level`: in the first frame at it, or at once after the report. */
  after?: (level: number, from: number) => void;
}

export interface PageZoom {
  /** The level asked for last, or else the one the page is at. */
  level(): number;
  /** Saves `level` and asks the app for it; nothing for the level it has. */
  ask(level: number): Promise<void>;
}

/**
 * Follows the app's zoom: listens for its event, then reports this window's setting and takes the
 * app's answer, which is the truth once the app has a level.
 */
export async function followZoom(link: ZoomLink, options: ZoomOptions): Promise<PageZoom> {
  const { root, win } = options;
  // The level the page is laid out at (what `--rl-zoom` says), the level that the events since
  // then have named (with the level the page was at when the first came), and the one asked last.
  let applied = options.level;
  let pending = null as { level: number; from: number } | null;
  let asked = options.level;
  let wait: ReturnType<typeof setTimeout> | undefined;

  const land = () => {
    if (!pending) return;
    clearTimeout(wait);
    const { level, from } = pending;
    pending = null;
    applied = level;
    applyZoom(root, level);
    options.after?.(level, from);
  };

  const heard = (level: number) => {
    asked = level;
    if (!pending) {
      if (level === applied) return;
      pending = { level, from: applied };
      options.before?.(level, applied);
    } else {
      pending.level = level;
    }
    clearTimeout(wait);
    wait = setTimeout(land, RESIZE_WAIT_MS);
  };

  win.addEventListener('resize', land);
  await link.listen(heard);

  // The app's answer is the truth once it has a level. A hung command must not hold the window
  // up: after `REPORT_WAIT_MS` the page starts as it is, and takes the answer whenever it comes.
  const take = (answer: number) => {
    if (answer !== (pending?.level ?? applied)) {
      // A change made while the page loaded, before it listened, or a reloaded page's older script.
      const from: number = pending?.from ?? applied;
      pending = { level: answer, from };
      asked = answer;
      land();
    }
    if (answer !== options.settings()) options.save(answer);
  };
  const reported = link.report(options.settings());
  let timer: ReturnType<typeof setTimeout> | undefined;
  const answer = await Promise.race([
    reported,
    new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), REPORT_WAIT_MS);
    }),
  ]);
  clearTimeout(timer);
  if (answer === null) {
    console.error('The app has not answered the zoom report; the page goes on without it');
    void reported.then(take, () => {});
  } else take(answer);

  return {
    level: () => asked,
    async ask(level) {
      if (level === asked) return;
      const before = asked;
      asked = level;
      options.save(level);
      try {
        await link.set(level);
      } catch (error) {
        // The app did not take it: the page is not at a level it never reached.
        if (asked === level) asked = before;
        throw error;
      }
    },
  };
}
