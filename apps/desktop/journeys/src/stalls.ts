// What a long document costs while it is scrolled (#695): the longest stall of the page's main
// thread, the frame times, and the memory of the browser's page process.
//
// WebKit has no Long Tasks API and no `performance.memory`, so a stall is what a heartbeat sees
// (a timer every 8 ms: the gap beyond that is a task that held the thread), the frames are the
// gaps between animation frames, and the memory is the resident size of the Playwright WebKit
// processes, read with `ps`.

import { execFileSync } from 'node:child_process';
import type { Page } from '@playwright/test';

export interface Phase {
  name: string;
  /** The longest time the main thread was held, in ms. */
  longestStall: number;
  /** The frames drawn in the phase, and the 95th percentile and the longest gap between them. */
  frames: number;
  frameP95: number;
  frameMax: number;
  /** The browser's resident memory after the phase, in MB. */
  memoryMB: number | null;
  /** How long the phase took, in ms. */
  elapsed: number;
}

/** Starts the heartbeat and the frame clock in the page. */
export async function startMonitor(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __monitor?: unknown };
    if (w.__monitor) return;
    const m = { stall: 0, frames: [] as number[], last: performance.now(), lastFrame: 0 };
    const beat = () => {
      const now = performance.now();
      m.stall = Math.max(m.stall, now - m.last - 8);
      m.last = now;
    };
    setInterval(beat, 8);
    const frame = (t: number) => {
      if (m.lastFrame) m.frames.push(t - m.lastFrame);
      m.lastFrame = t;
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    w.__monitor = m;
  });
}

/**
 * The resident size, in MB, of the Playwright WebKit processes, when they are this test run's alone:
 * WebKit's page processes are services, not children of the test, so they are found by their path,
 * and when another browser of another run is on the machine (another worktree's journeys) the
 * number would be theirs too, and the answer is null. Null as well where `ps` can't say.
 */
function webkitMemoryMB(): number | null {
  try {
    const out = execFileSync('ps', ['-axo', 'pid=,ppid=,rss=,command='], { encoding: 'utf8' });
    let kb = 0;
    for (const line of out.split('\n')) {
      const [, ppid, rss, ...command] = line.trim().split(/\s+/);
      const text = command.join(' ');
      if (!/ms-playwright\/webkit/.test(text)) continue;
      // Another run's browser: the launcher script of a browser that is not ours.
      if (/pw_run\.sh/.test(text) && Number(ppid) !== process.pid) {
        return null;
      }
      kb += Number(rss) || 0;
    }
    return kb ? Math.round(kb / 1024) : null;
  } catch {
    return null;
  }
}

/** Runs `body`, and reports the stalls and frames the page had while it ran. */
export async function measure(page: Page, name: string, body: () => Promise<void>): Promise<Phase> {
  await page.evaluate(() => {
    const m = (window as unknown as { __monitor: { stall: number; frames: number[] } }).__monitor;
    m.stall = 0;
    m.frames = [];
  });
  const started = Date.now();
  await body();
  const elapsed = Date.now() - started;
  const seen = await page.evaluate(() => {
    const m = (window as unknown as { __monitor: { stall: number; frames: number[] } }).__monitor;
    return { stall: m.stall, frames: [...m.frames] };
  });
  const sorted = [...seen.frames].sort((a, b) => a - b);
  return {
    name,
    longestStall: Math.round(seen.stall),
    frames: sorted.length,
    frameP95: Math.round(sorted[Math.floor(sorted.length * 0.95)] ?? 0),
    frameMax: Math.round(sorted.at(-1) ?? 0),
    memoryMB: webkitMemoryMB(),
    elapsed,
  };
}

/** A person drags the scrollbar: the scroll position moves in steps, one a frame, to a fraction. */
export async function dragScrollbarTo(page: Page, fraction: number, steps = 18): Promise<void> {
  await page.evaluate(
    ([target, count]) =>
      new Promise<void>((resolve) => {
        const scroller = document.querySelector('.rl-scroller') as HTMLElement;
        const from = scroller.scrollTop;
        const to = target! * (scroller.scrollHeight - scroller.clientHeight);
        let n = 0;
        // The heights of lines not yet drawn are estimates: at the end, the editor measures what it
        // drew and the document gets longer or shorter, so a person drags on until it holds still.
        const settle = (round: number) => {
          const end = scroller.scrollHeight - scroller.clientHeight;
          if (target! < 1 || round >= 8 || Math.abs(scroller.scrollTop - end) < 2) return resolve();
          scroller.scrollTop = end;
          requestAnimationFrame(() => requestAnimationFrame(() => settle(round + 1)));
        };
        const step = () => {
          n++;
          scroller.scrollTop = from + ((to - from) * n) / count!;
          if (n < count!) requestAnimationFrame(step);
          else requestAnimationFrame(() => requestAnimationFrame(() => settle(0)));
        };
        requestAnimationFrame(step);
      }),
    [fraction, steps],
  );
}

export function formatPhases(label: string, phases: readonly Phase[]): string {
  const rows = phases.map(
    (p) =>
      `${label} | ${p.name.padEnd(14)} | stall ${String(p.longestStall).padStart(5)} ms | ` +
      `frames ${String(p.frames).padStart(4)}, p95 ${String(p.frameP95).padStart(4)} ms, ` +
      `max ${String(p.frameMax).padStart(5)} ms | mem ${p.memoryMB ?? '?'} MB | ${p.elapsed} ms`,
  );
  return rows.join('\n');
}
