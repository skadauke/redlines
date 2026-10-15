import { Fragment, type ReactNode } from 'react';

/**
 * Copy from lib/site.ts, with text between backticks set as code. `chip`
 * draws the code in a small box, as in running text and the cards; the point
 * lists set it plain.
 */
export function Rich({ text, chip = false }: { text: string; chip?: boolean }) {
  return text.split(/`([^`]+)`/).map((part, i) =>
    i % 2 === 0 ? (
      <Fragment key={i}>{part}</Fragment>
    ) : (
      <code
        key={i}
        className={
          chip
            ? 'rounded-[5px] border border-rule bg-paper px-1.25 py-px text-13 leading-none'
            : undefined
        }
      >
        {part}
      </code>
    ),
  );
}

/** A section heading. Its id labels the section. */
export function SectionTitle({
  id,
  className = '',
  children,
}: {
  id: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <h2 id={id} className={`font-display text-title font-bold text-balance ${className}`}>
      {children}
    </h2>
  );
}

/** The paragraph under a section heading. */
export function SectionBody({ text, className = 'mt-4.5' }: { text: string; className?: string }) {
  return (
    <p className={`max-w-[33rem] text-pretty text-ink-2 ${className}`}>
      <Rich text={text} chip />
    </p>
  );
}

/** A list of short points, each after a small red dot. */
export function Points({ points }: { points: readonly string[] }) {
  return (
    <ul className="mt-5.5 grid max-w-[33rem] gap-2.5">
      {points.map((point) => (
        <li
          key={point}
          className="grid grid-cols-[14px_minmax(0,1fr)] gap-2.5 text-[0.9875rem] text-ink-2 before:mt-[0.62em] before:size-1.5 before:rounded-full before:bg-red before:content-['']"
        >
          <span>
            <Rich text={point} />
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * A section with its heading, paragraph and points beside an illustration:
 * two columns from 921px, one below. The text comes first, on the left, or
 * on the right with `flip`; in one column it always leads.
 */
export function Part({
  id,
  title,
  body,
  points,
  flip = false,
  children,
}: {
  id: string;
  title: string;
  body: string;
  points: readonly string[];
  flip?: boolean;
  /** The illustration. */
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="grid items-center gap-9 border-t border-rule py-16 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:gap-14"
    >
      <div className={flip ? 'lg:order-2' : undefined}>
        <SectionTitle id={`${id}-title`}>{title}</SectionTitle>
        <SectionBody text={body} />
        <Points points={points} />
      </div>
      {children}
    </section>
  );
}

/** Cards on one sheet, split by hairlines: the rule color shows through the 1px gaps. */
export const cardGrid =
  'grid gap-px overflow-hidden rounded-sheet border border-rule bg-rule *:min-w-0 *:bg-sheet *:p-5.5';
