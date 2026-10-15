import type { ReactNode } from 'react';

// Parts of the editor illustrations, shared by the server-rendered ones and
// the two interactive ones (view-switch.tsx, agent-demo.tsx). Each
// illustration is a page from the editor on a sheet (the .sheet class in
// globals.css). Text inside a document is set in Open Sans, as the editor sets
// it; everything around it, in the interface font.

/** The text of a document inside an illustration. */
export const docText = 'font-doc text-16 leading-[1.75] text-ink';

/** The bar across the top of a sheet: the file's name, and any controls. */
export function SheetBar({ file, children }: { file: string; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule px-3.5 py-2.5">
      <span className="font-mono text-13 leading-none font-medium text-ink-2">{file}</span>
      {children}
    </div>
  );
}

/**
 * A document's title. Styled text, not a heading element, so the samples stay
 * out of the page's outline.
 */
export function DocTitle({ children }: { children: ReactNode }) {
  return (
    <p className="mb-2.5 border-b border-rule pb-1.5 font-doc text-22 leading-[1.3] font-bold">
      {children}
    </p>
  );
}

/** A small label above part of an illustration. */
export function RowLabel({ children }: { children: ReactNode }) {
  return (
    <p className="mb-2.5 font-sans text-12 leading-none font-medium text-ink-3">{children}</p>
  );
}

/** A note under an illustration. */
export function Caption({ children }: { children: ReactNode }) {
  return <p className="mt-4 text-13 text-ink-3">{children}</p>;
}

/** Author colors, for the dot next to a name. */
const authors = {
  bo: 'bg-bo',
  claude: 'bg-claude',
} as const;

/** An author's color, next to their name. */
export function Dot({ who }: { who: keyof typeof authors }) {
  return <span aria-hidden="true" className={`size-2 flex-none rounded-full ${authors[who]}`} />;
}

/** Who an agent works for, next to its name. */
export function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full border border-current px-1.5 py-0.5 text-11 leading-none font-semibold text-claude">
      {children}
    </span>
  );
}
