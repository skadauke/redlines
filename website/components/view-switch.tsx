'use client';

import { useState, type ReactNode } from 'react';
import { SheetBar } from './sheet';

export type View = { id: string; label: string; content: ReactNode };

/**
 * One document in several views, with the editor's view switch: a group of
 * toggle buttons, one pressed. The panes are rendered on the server and
 * passed in. Without JavaScript the `initial` view shows and the switch
 * stays put.
 */
export function ViewSwitch({
  file,
  label,
  views,
  initial,
}: {
  file: string;
  /** What the switch chooses, for screen readers. */
  label: string;
  views: readonly View[];
  initial: string;
}) {
  const [current, setCurrent] = useState(initial);
  return (
    <figure className="sheet">
      <SheetBar file={file}>
        <div
          role="group"
          aria-label={label}
          className="inline-flex gap-0.5 rounded-[9px] border border-rule bg-paper p-0.5"
        >
          {views.map((view) => (
            <button
              key={view.id}
              type="button"
              aria-pressed={view.id === current}
              onClick={() => setCurrent(view.id)}
              className="cursor-pointer rounded-[7px] px-2.75 py-1.75 text-13 leading-none font-semibold text-ink-2 aria-pressed:bg-sheet aria-pressed:text-ink aria-pressed:shadow-[0_1px_2px_rgb(0_0_0/0.12)]"
            >
              {view.label}
            </button>
          ))}
        </div>
      </SheetBar>
      {views.map((view) => (
        <div
          key={view.id}
          hidden={view.id !== current}
          className="px-4.5 py-5 sm:px-6.5 sm:pt-6.5 sm:pb-6"
        >
          {view.content}
        </div>
      ))}
    </figure>
  );
}
