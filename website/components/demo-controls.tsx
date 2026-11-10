'use client';

import type { ReactNode } from 'react';
import type { DemoHandle, DemoName, DemoState } from '../../apps/website-embed/src/api';
import { demos } from '../lib/demos';
import { PenIcon, TrackingIcon } from './icons';

// The controls the page draws for a panel: the editor supplies state and actions, and the page
// draws them in its own type and tokens. Labels are words. Under a coarse pointer every control is
// at least 44 × 44 px, by padding and not by a larger look; below 641 px the controls wrap in rows.

const button =
  'inline-flex cursor-pointer items-center justify-center gap-1.5 max-sm:gap-1 rounded-[7px] border border-rule bg-sheet px-2.75 py-1.75 max-sm:px-1 text-13 leading-none font-semibold text-ink-2 enabled:hover:border-ink-3 enabled:hover:text-ink disabled:cursor-default disabled:opacity-55 pointer-coarse:min-h-11 pointer-coarse:min-w-11 aria-pressed:text-ink';

/** The editor's view switch, as the page has always drawn it: one pressed button of a group. */
function Views({ state, handle }: { state: DemoState; handle: DemoHandle }) {
  return (
    <div
      role="group"
      aria-label={demos.controls.views}
      className="inline-flex basis-full gap-0.5 rounded-[9px] border border-rule bg-paper p-0.5 sm:basis-auto"
    >
      {state.views.map(({ view, label }) => (
        <button
          key={view}
          type="button"
          aria-pressed={view === state.view}
          onClick={() => handle.setView(view)}
          className="flex-1 cursor-pointer rounded-[7px] px-2.75 py-1.75 text-13 leading-none font-semibold text-ink-2 pointer-coarse:min-h-11 pointer-coarse:min-w-11 aria-pressed:bg-sheet aria-pressed:text-ink aria-pressed:shadow-[0_1px_2px_rgb(0_0_0/0.12)] sm:flex-none"
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function Action({
  disabled,
  onClick,
  children,
}: {
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} className={button}>
      {children}
    </button>
  );
}

export function DemoControls({
  demo,
  state,
  handle,
}: {
  demo: DemoName;
  state: DemoState;
  handle: DemoHandle;
}) {
  const words = demos.controls;
  const review = (
    <Action disabled={state.changes === 0} onClick={() => handle.openReviewBar()}>
      {words.review}
    </Action>
  );
  const reset = <Action onClick={() => handle.reset()}>{words.reset}</Action>;
  if (demo === 'design') {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Action disabled={state.claudeRunning} onClick={() => handle.askClaude()}>
          {words.askClaude}
        </Action>
        {review}
        {reset}
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2 max-sm:gap-1">
      <Views state={state} handle={handle} />
      <button
        type="button"
        aria-pressed={state.tracking}
        onClick={() => handle.setTracking(!state.tracking)}
        className={button}
      >
        {state.tracking ? (
          <TrackingIcon className="size-4 text-red" />
        ) : (
          <PenIcon className="size-4" />
        )}
        {words.trackChanges}
      </button>
      <Action disabled={!state.canComment} onClick={() => handle.startComment()}>
        {words.comment}
      </Action>
      {review}
      {reset}
    </div>
  );
}
