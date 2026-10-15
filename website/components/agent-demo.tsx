'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge, Dot, SheetBar } from './sheet';

// The agent illustration: Claude strikes a phrase and types its suggestion,
// then the reader accepts or rejects it. It plays once when it scrolls into
// view, and again on "Play again". With reduced motion, and without
// JavaScript, it shows the finished suggestion.

const before = 'Interim results go to the safety board ';
const removed = 'next quarter';
const added = 'by October 31';
const after = '.';

type State = {
  /** The phrase the agent replaces. */
  removed: 'plain' | 'struck' | 'gone';
  /** The agent's text: still suggested, accepted, or rejected. */
  added: 'suggested' | 'plain' | 'gone';
  /** How much of the agent's text it has typed. */
  typed: number;
  cursor: boolean;
  verdict: boolean;
};

const suggested: State = {
  removed: 'struck',
  added: 'suggested',
  typed: added.length,
  cursor: false,
  verdict: true,
};
const untouched: State = { ...suggested, removed: 'plain', typed: 0, verdict: false };

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function AgentDemo() {
  const [state, setState] = useState<State>(suggested);
  const [ready, setReady] = useState(false);
  const figure = useRef<HTMLElement>(null);
  const replay = useRef<HTMLButtonElement>(null);
  const timers = useRef<number[]>([]);

  const stop = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);

  const play = useCallback(() => {
    stop();
    if (reducedMotion()) {
      setState(suggested);
      return;
    }
    const at = (ms: number, change: Partial<State>) =>
      timers.current.push(window.setTimeout(() => setState((s) => ({ ...s, ...change })), ms));
    setState(untouched);
    at(500, { cursor: true });
    at(1300, { removed: 'struck' });
    for (let n = 1; n <= added.length; n++) at(1900 + n * 70, { typed: n });
    at(1900 + added.length * 70 + 400, { cursor: false, verdict: true });
  }, [stop]);

  useEffect(() => {
    setReady(true);
    const el = figure.current;
    if (!el || reducedMotion()) return;
    // Out of sight, it waits untouched for the reader. In sight, it keeps the
    // finished suggestion until it plays, so a renderer that never reports
    // visibility (a screenshot tool, say) still shows the change.
    const { top, bottom } = el.getBoundingClientRect();
    if (bottom <= 0 || top >= window.innerHeight) setState(untouched);
    // Play once half of it is in view.
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.intersectionRatio >= 0.5)) {
          observer.disconnect();
          play();
        }
      },
      { threshold: 0.5 },
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      stop();
    };
  }, [play, stop]);

  // The verdict's buttons disappear once used; keep the keyboard focus nearby.
  const decide = (accepted: boolean) => {
    stop();
    setState({
      removed: accepted ? 'gone' : 'plain',
      added: accepted ? 'plain' : 'gone',
      typed: added.length,
      cursor: false,
      verdict: false,
    });
    replay.current?.focus();
  };

  const typed = added.slice(0, state.typed);
  return (
    <figure ref={figure} className="sheet" aria-label="An AI agent suggesting an edit">
      <SheetBar file="protocol.md">
        {/* Hidden, with its space kept, until it can work. */}
        <button
          ref={replay}
          type="button"
          onClick={play}
          className={`cursor-pointer py-1.5 text-13 leading-none font-medium text-ink-3 underline underline-offset-3 hover:text-ink ${ready ? '' : 'invisible'}`}
        >
          Play again
        </button>
      </SheetBar>
      <div className="px-4.5 py-5 sm:p-6.5">
        <p className="my-[1em] font-doc text-17 leading-[1.75] text-ink">
          {before}
          {state.removed === 'struck' ? (
            <del className="text-claude line-through decoration-2">{removed}</del>
          ) : state.removed === 'plain' ? (
            removed
          ) : null}
          {state.cursor ? (
            <span
              aria-hidden="true"
              className="relative inline-block h-[1.2em] w-0.5 bg-claude align-[-0.22em] motion-safe:animate-blink"
            >
              <span className="absolute -left-px -top-[1.45em] rounded-[4px_4px_4px_0] bg-claude px-1.25 py-0.75 font-sans text-11 leading-none font-semibold whitespace-nowrap text-sheet">
                Claude
              </span>
            </span>
          ) : null}
          {state.added === 'suggested' ? (
            typed ? (
              <ins className="text-claude underline decoration-2 underline-offset-3">{typed}</ins>
            ) : null
          ) : state.added === 'plain' ? (
            added
          ) : null}
          {after}
        </p>
        {/* Hidden while the agent types, with its space kept, so nothing moves. */}
        <div
          className={`mt-5 flex flex-wrap items-center gap-2.5 border-t border-rule pt-4 text-14 text-ink-2 ${state.verdict ? '' : 'invisible'}`}
        >
          <span className="mr-auto flex items-center gap-1.75 font-semibold">
            <Dot who="claude" />
            Claude suggested this <Badge>for Ada</Badge>
          </span>
          <button
            type="button"
            onClick={() => decide(true)}
            className="cursor-pointer rounded-lg border border-ink bg-ink px-3 py-2 text-13 leading-none font-semibold text-paper"
          >
            Accept
          </button>
          <button
            type="button"
            onClick={() => decide(false)}
            className="cursor-pointer rounded-lg border border-rule bg-sheet px-3 py-2 text-13 leading-none font-semibold text-ink"
          >
            Reject
          </button>
        </div>
      </div>
    </figure>
  );
}
