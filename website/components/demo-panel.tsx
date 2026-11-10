'use client';

import { type ReactNode, useEffect, useRef, useState } from 'react';
import type { DemoHandle, DemoState, MountDemo } from '../../apps/website-embed/src/api';
import { demos, type PanelName } from '../lib/demos';
import type { EmbedFiles } from '../lib/embed';
import { DemoControls, GhostControls } from './demo-controls';
import { Caption, SheetBar } from './sheet';

// The sheet around a demo panel. It renders the fallback on the server, so the HTML and the page
// without JavaScript are what they are. In an effect it waits for the page's `load`, then for the
// sheet to come within 600 px of the viewport, then for idle; then it imports the bundle (one
// module for the page), adds its stylesheet, waits for the body face (1 s at most) and mounts the
// editor in place of the fallback. If anything fails, the fallback stays, no control appears and
// the visitor sees nothing: the console says why.

/** How near the viewport a panel loads. */
const NEAR = '600px';

type Loaded = { mountDemo: MountDemo };
let loading: Promise<Loaded> | null = null;

/** The bundle, once for the page: its stylesheet in the head, then its module. */
function loadEmbed({ js, css }: EmbedFiles): Promise<Loaded> {
  loading ??= (async () => {
    performance.mark('redlines-embed-requested');
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = css;
    const styled = new Promise<void>((resolve) => {
      link.addEventListener('load', () => resolve(), { once: true });
      link.addEventListener('error', () => resolve(), { once: true });
    });
    document.head.append(link);
    const url = new URL(js, location.href).href;
    const [loaded] = await Promise.all([
      import(/* webpackIgnore: true */ /* turbopackIgnore: true */ url) as Promise<Loaded>,
      styled,
    ]);
    // The body face, so that the editor doesn't reflow when it arrives: 1 s at most.
    await Promise.race([
      document.fonts.load('17.5px Carlito').catch(() => []),
      new Promise((resolve) => setTimeout(resolve, 1000)),
    ]);
    return loaded;
  })();
  // A failed load may be tried again by the next panel, not cached.
  loading.catch(() => {
    loading = null;
  });
  return loading;
}

/** After the page's `load`, when the callback has the browser's idle time. */
function whenIdle(callback: () => void): () => void {
  let cancelled = false;
  const run = () => {
    const go = () => !cancelled && callback();
    if ('requestIdleCallback' in window) window.requestIdleCallback(go, { timeout: 2000 });
    else setTimeout(go, 200);
  };
  if (document.readyState === 'complete') run();
  else window.addEventListener('load', run, { once: true });
  return () => {
    cancelled = true;
    window.removeEventListener('load', run);
  };
}

/** How long a notice stays on the line under the sheet. */
const NOTICE_MS = 6000;

export function DemoPanel({
  demo,
  embed,
  children,
}: {
  demo: PanelName;
  embed: EmbedFiles | null;
  /** The fallback, rendered on the server. */
  children: ReactNode;
}) {
  const copy = demos[demo];
  const sheet = useRef<HTMLElement>(null);
  const fallback = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState<{ handle: DemoHandle; state: DemoState } | null>(null);
  const [notice, setNotice] = useState('');
  const [minHeight, setMinHeight] = useState<number | null>(null);
  // A visitor whose browser asks to save data loads the editors on request: `offer` shows the
  // button, `asked` is its click.
  const [offer, setOffer] = useState(false);
  const [asked, setAsked] = useState(false);

  useEffect(() => {
    const sheetEl = sheet.current;
    const hostEl = host.current;
    if (!embed || !sheetEl || !hostEl || !('IntersectionObserver' in window)) return;
    let cancelled = false;
    let handle: DemoHandle | null = null;
    let noticeTimer: ReturnType<typeof setTimeout> | undefined;
    let stopIdle: (() => void) | undefined;

    const start = async () => {
      try {
        const { mountDemo } = await loadEmbed(embed);
        if (cancelled) return;
        // The sheet keeps the fallback's height, so nothing below it moves.
        setMinHeight(fallback.current?.offsetHeight ?? null);
        let latest: DemoState | null = null;
        const made = mountDemo(hostEl, {
          demo,
          onState: (next) => {
            latest = next;
            setMounted((now) => (now ? { ...now, state: next } : now));
          },
          onNotice: (message) => {
            setNotice(message);
            clearTimeout(noticeTimer);
            noticeTimer = setTimeout(() => setNotice(''), NOTICE_MS);
          },
        });
        handle = made;
        performance.mark('redlines-embed-mounted');
        if (latest) setMounted({ handle: made, state: latest });
      } catch (error) {
        console.warn('The demo did not load; the page keeps its fallback.', error);
      }
    };

    const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
      ?.saveData;
    let observer: IntersectionObserver | undefined;
    if (asked) {
      void start();
    } else if (saveData) {
      setOffer(true);
    } else {
      observer = new IntersectionObserver(
        (entries) => {
          if (!entries.some((entry) => entry.isIntersecting)) return;
          observer?.disconnect();
          stopIdle = whenIdle(() => void start());
        },
        { rootMargin: NEAR },
      );
      observer.observe(sheetEl);
    }

    return () => {
      cancelled = true;
      observer?.disconnect();
      stopIdle?.();
      clearTimeout(noticeTimer);
      handle?.destroy();
      setMounted(null);
      setNotice('');
      setOffer(false);
    };
  }, [demo, embed, asked]);

  return (
    <figure ref={sheet} className="sheet relative" role="group" aria-label={copy.label}>
      <SheetBar file={copy.file}>
        {mounted ? (
          <DemoControls demo={demo} state={mounted.state} handle={mounted.handle} />
        ) : (
          // The controls' room: the same row, invisible, so that the real controls take its
          // place whatever the fonts make of it. No control is drawn that could be dead.
          <div className="relative">
            <GhostControls demo={demo} />
            {offer && !asked ? (
              // Over the invisible row, which keeps the room: nothing moves when the editor comes.
              <button
                type="button"
                onClick={() => setAsked(true)}
                className="absolute top-0 left-0 inline-flex cursor-pointer items-center justify-center rounded-[7px] border border-rule bg-sheet px-2.75 py-1.75 text-13 leading-none font-semibold text-ink-2 hover:border-ink-3 hover:text-ink pointer-coarse:min-h-11 pointer-coarse:min-w-11"
              >
                {demos.controls.tryIt}
              </button>
            ) : null}
          </div>
        )}
      </SheetBar>
      <div style={minHeight === null ? undefined : { minHeight }}>
        <div
          ref={fallback}
          hidden={mounted !== null}
          className="px-4.5 py-5 sm:px-6.5 sm:pt-6.5 sm:pb-6"
        >
          {children}
        </div>
        <div ref={host} />
      </div>
      {mounted ? (
        <div className="px-4.5 pb-4 sm:px-6.5">
          <Caption>
            {demo === 'plan'
              ? demos.plan.caption[mounted.state.tracking ? 'tracking' : 'plain']
              : demos.design.caption}
          </Caption>
          <p aria-live="polite" className="mt-2 min-h-5 text-13 text-ink-2">
            {notice}
          </p>
        </div>
      ) : null}
    </figure>
  );
}
