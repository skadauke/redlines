import type { ReactNode } from 'react';
import { demos } from '../lib/demos';
import { demoText, type Segment } from '../lib/demo-text';
import { Badge, Caption, DocTitle, Dot, docText } from './sheet';

// The demo panels' fallback: what the editor shows when it opens, drawn from data
// (lib/demo-text.json) as plain server-rendered markup. It is what a visitor without JavaScript,
// a crawler and the moment before the editor loads see. A test in apps/website-embed holds its
// words to the sample document.

/** Tracked-change marks, in their author's color. */
const ins = 'underline decoration-2 underline-offset-3';
const del = 'line-through decoration-2';

const color = { ada: 'text-ada', bo: 'text-bo', 'claude-ada': 'text-claude' } as const;
const dot = { ada: 'ada', bo: 'bo', 'claude-ada': 'claude' } as const;
const names = { ada: 'Ada', bo: 'Bo', 'claude-ada': 'Claude' } as const;

type Who = keyof typeof color;
const who = (handle: string): Who => (handle in color ? (handle as Who) : 'ada');

function Marks({ segments }: { segments: Segment[] }): ReactNode {
  return segments.map((segment, i) => {
    switch (segment.t) {
      case 'text':
        return segment.s;
      case 'ins':
        return (
          <ins key={i} className={`${ins} ${color[who(segment.by)]}`}>
            {segment.s}
          </ins>
        );
      case 'del':
        return (
          <del key={i} className={`${del} ${color[who(segment.by)]}`}>
            {segment.s}
          </del>
        );
      case 'sub':
        return (
          <span key={i}>
            <del className={`${del} ${color[who(segment.by)]}`}>{segment.old}</del>
            <ins className={`${ins} ${color[who(segment.by)]}`}>{segment.s}</ins>
          </span>
        );
      case 'cmt':
        return (
          <mark key={i} className="rounded-[3px] bg-note px-0.5 text-inherit">
            <Marks segments={segment.children} />
          </mark>
        );
    }
  });
}

/** A card in the margin: who, and what they did. */
function Card({ handle, children }: { handle: string; children: ReactNode }) {
  const person = who(handle);
  return (
    <div className="rounded-[10px] border border-rule bg-sheet px-3 py-2.5 text-13 leading-[1.45]">
      <div className="flex items-center gap-1.75 font-semibold">
        <Dot who={dot[person]} />
        {names[person]}
        {person === 'claude-ada' ? <Badge>for Ada</Badge> : null}
      </div>
      <div className="mt-1 text-ink-2">{children}</div>
      {person === 'claude-ada' ? (
        <div aria-hidden="true" className="mt-2 flex gap-1.5">
          <span className="rounded-md border border-rule px-2 py-0.75 font-semibold text-ink-2">
            Accept
          </span>
          <span className="rounded-md border border-rule px-2 py-0.75 font-semibold text-ink-2">
            Reject
          </span>
        </div>
      ) : null}
    </div>
  );
}

/** The plan's fallback: the Launch plan in Redlines, with a card for each substitution and comment. */
export function PlanFallback() {
  const { title, segments } = demoText.plan;
  const cards = segments.flatMap((segment, i) =>
    segment.t === 'sub'
      ? [
          <Card key={i} handle={segment.by}>
            Replaced “{segment.old}” with “{segment.s}”
          </Card>,
        ]
      : segment.t === 'cmt' && segment.thread[0]
        ? [
            <Card key={i} handle={segment.thread[0].by}>
              {segment.thread[0].text}
            </Card>,
          ]
        : [],
  );
  return (
    <>
      <div className="grid items-start gap-5 sm:grid-cols-[minmax(0,1fr)_210px]">
        <div className={docText}>
          <DocTitle>{title}</DocTitle>
          <p>
            <Marks segments={segments} />
          </p>
        </div>
        <div className="grid gap-2.5">{cards}</div>
      </div>
      <Caption>{demos.plan.fallbackCaption}</Caption>
    </>
  );
}

/** One line of a comment thread: an author's dot, then their name and words. */
function ThreadLine({ handle, children }: { handle: string; children: ReactNode }) {
  const person = who(handle);
  return (
    <p className="grid grid-cols-[8px_minmax(0,1fr)] gap-1.75">
      <span className="mt-[0.55em] flex">
        <Dot who={dot[person]} />
      </span>
      <span>
        <span className="font-semibold text-ink">{names[person]}</span> {children}
      </span>
    </p>
  );
}

/**
 * The design note's fallback: the note with Claude's substitution, the thread under it with Ada's
 * question and Claude's reply, and Claude's suggestion with Accept and Reject drawn (not buttons).
 */
export function DesignFallback() {
  const { title, segments } = demoText.design;
  const thread = segments.flatMap((segment) => (segment.t === 'cmt' ? segment.thread : []));
  return (
    <>
      <div className={docText}>
        <DocTitle>{title}</DocTitle>
        <p>
          <Marks segments={segments} />
        </p>
      </div>
      <div className="mt-5 grid gap-1.5 border-t border-rule pt-4 text-14 text-ink-2">
        {thread.map((entry, i) => (
          <ThreadLine key={i} handle={entry.by}>
            {entry.text}
          </ThreadLine>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2.5 text-14 text-ink-2">
        <span className="mr-auto flex items-center gap-1.75 font-semibold max-sm:w-full">
          <Dot who="claude" />
          Claude suggested this <Badge>for Ada</Badge>
        </span>
        <span
          aria-hidden="true"
          className="rounded-lg border border-ink bg-ink px-3 py-2 text-13 leading-none font-semibold text-paper"
        >
          Accept
        </span>
        <span
          aria-hidden="true"
          className="rounded-lg border border-rule bg-sheet px-3 py-2 text-13 leading-none font-semibold text-ink"
        >
          Reject
        </span>
      </div>
      <Caption>{demos.design.caption}</Caption>
    </>
  );
}
