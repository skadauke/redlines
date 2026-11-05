'use client';

import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { changes } from '../lib/site';
import { PauseIcon, PlayIcon } from './icons';
import { Badge, Dot, SheetBar } from './sheet';

// The agent illustration: Ada asks Claude in a comment. Claude says what it's
// doing on one live line, strikes a phrase, types its suggestion and replies in
// the thread; the loop waits a moment at Accept and Reject, accepts it, and
// starts over. It plays from page load, and the button pauses and resumes it.
// Clicking Accept or Reject stops it on the reader's decision. Without
// JavaScript it shows the finished suggestion and the reply.

const before = 'Uploads retry ';
const removed = '3 times';
const added = '5 times';
const after = ' with backoff, then fail.';
const question = '@Claude is this still right? Fix it if not.';
const reading = 'Reading uploader.ts';
const editing = 'Editing this section';
const answer = 'Now 5, per uploader.ts:88. Fixed.';

type State = {
  /** The phrase the agent replaces. */
  removed: 'plain' | 'struck' | 'gone';
  /** The agent's text: still suggested, accepted, or rejected. */
  added: 'suggested' | 'plain' | 'gone';
  /** How much of the agent's text it has typed. */
  typed: number;
  cursor: boolean;
  verdict: boolean;
  /** Accept, shown pressed just before the loop accepts the suggestion. */
  pressed: boolean;
  /** The agent's live line, while it works. */
  status: string | null;
  /** The agent's reply is in the thread. */
  replied: boolean;
};

const suggested: State = {
  removed: 'struck',
  added: 'suggested',
  typed: added.length,
  cursor: false,
  verdict: true,
  pressed: false,
  status: null,
  replied: true,
};
const untouched: State = {
  ...suggested,
  removed: 'plain',
  typed: 0,
  verdict: false,
  replied: false,
};
const accepted: State = { ...suggested, removed: 'gone', added: 'plain', verdict: false };

/**
 * One loop, as steps that each wait `delay` ms after the previous one. The
 * first step's delay is how long the accepted text stays before it starts over.
 */
const steps: { delay: number; change: Partial<State> }[] = [
  { delay: 1800, change: untouched },
  { delay: 700, change: { status: reading } },
  { delay: 1500, change: { status: editing, cursor: true } },
  { delay: 800, change: { removed: 'struck' } },
  ...Array.from({ length: added.length }, (_, i) => ({
    delay: i === 0 ? 670 : 70,
    change: { typed: i + 1 },
  })),
  { delay: 400, change: { cursor: false, status: null, replied: true, verdict: true } },
  { delay: 2500, change: { pressed: true } },
  { delay: 400, change: accepted },
];

/** One line of the comment thread: an author's dot, then their name and words. */
function ThreadLine({
  who,
  name,
  className = '',
  children,
}: {
  who: 'ada' | 'claude';
  name: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <p className={`grid grid-cols-[8px_minmax(0,1fr)] gap-1.75 ${className}`}>
      <span className="mt-[0.55em] flex">
        <Dot who={who} />
      </span>
      <span>
        <span className="font-semibold text-ink">{name}</span> {children}
      </span>
    </p>
  );
}

export function AgentDemo() {
  const [state, setState] = useState<State>(suggested);
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const timer = useRef<number | undefined>(undefined);
  /** The step that runs next. */
  const next = useRef(0);
  const started = useRef(false);

  const halt = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
  }, []);

  const advance = useCallback(function advance() {
    const step = steps[next.current];
    timer.current = window.setTimeout(() => {
      setState((s) => ({ ...s, ...step.change }));
      next.current = (next.current + 1) % steps.length;
      advance();
    }, step.delay);
  }, []);

  // The first time, it starts from the untouched sentence.
  const start = useCallback(() => {
    if (!started.current) {
      started.current = true;
      setState(untouched);
      next.current = 1;
    }
    setPlaying(true);
  }, []);

  useEffect(() => {
    if (!playing) return;
    advance();
    return halt;
  }, [playing, advance, halt]);

  // It starts as soon as the page loads.
  useEffect(() => {
    setReady(true);
    start();
  }, [start]);

  const onToggle = () => {
    if (playing) setPlaying(false);
    else start();
  };

  // A decision stops the loop on its result; the buttons disappear, so the
  // keyboard focus moves to the play button.
  const decide = (yes: boolean) => {
    setPlaying(false);
    started.current = true;
    next.current = 0;
    setState(yes ? accepted : { ...accepted, removed: 'plain', added: 'gone' });
    toggle.current?.focus();
  };

  const typed = added.slice(0, state.typed);
  const label = playing ? changes.pause : changes.play;
  return (
    <figure className="sheet" aria-label="An AI agent answering a comment with a reply and an edit">
      <SheetBar file="design.md">
        {/* Hidden, with its space kept, until it can work. */}
        <button
          ref={toggle}
          type="button"
          onClick={onToggle}
          aria-label={label}
          title={label}
          className={`grid size-7 cursor-pointer place-items-center rounded-full border border-rule text-ink-3 transition-colors hover:border-ink-3 hover:text-ink ${ready ? '' : 'invisible'}`}
        >
          {playing ? <PauseIcon className="size-3" /> : <PlayIcon className="ml-px size-3" />}
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
        {/* The thread. The live line and the reply share a place, so nothing moves. */}
        <div className="mt-5 grid gap-1.5 border-t border-rule pt-4 text-14 text-ink-2">
          <ThreadLine who="ada" name="Ada">
            {question}
          </ThreadLine>
          <div className="grid">
            <ThreadLine
              who="claude"
              name="Claude"
              className={`text-ink-3 [grid-area:1/1] ${state.status ? '' : 'invisible'}`}
            >
              {state.status}
            </ThreadLine>
            <ThreadLine
              who="claude"
              name="Claude"
              className={`[grid-area:1/1] ${state.replied ? '' : 'invisible'}`}
            >
              {answer}
            </ThreadLine>
          </div>
        </div>
        {/* Hidden while the agent types, with its space kept, so nothing moves. */}
        <div
          className={`mt-4 flex flex-wrap items-center gap-2.5 text-14 text-ink-2 ${state.verdict ? '' : 'invisible'}`}
        >
          <span className="mr-auto flex items-center gap-1.75 font-semibold max-sm:w-full">
            <Dot who="claude" />
            Claude suggested this <Badge>for Ada</Badge>
          </span>
          <button
            type="button"
            onClick={() => decide(true)}
            className={`cursor-pointer rounded-lg border border-ink bg-ink px-3 py-2 text-13 leading-none font-semibold text-paper transition-transform ${state.pressed ? 'scale-95 opacity-80' : ''}`}
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
