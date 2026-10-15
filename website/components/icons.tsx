import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

/**
 * The brand mark: three lines of text on a dark square, the last one red. In
 * dark mode the square turns light and the lines dark. Decorative: the name
 * always stands next to it.
 */
export function BrandMark(props: IconProps) {
  return (
    <svg viewBox="0 0 26 26" aria-hidden="true" focusable="false" {...props}>
      <rect width="26" height="26" rx="7" className="fill-ink" />
      <rect x="6" y="7" width="11" height="2" className="fill-paper" />
      <rect x="6" y="12" width="14" height="2" className="fill-paper" />
      <rect x="6" y="17" width="9" height="2" className="fill-red" />
    </svg>
  );
}

/** A download arrow. Decorative: put the meaning in text. */
export function DownloadIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19.5h14" />
    </svg>
  );
}

/**
 * The comparison table's check and cross, drawn once and used by reference
 * from every cell (<use href="#…">), which keeps the page small.
 */
export function YesNoSymbols() {
  return (
    <svg width="0" height="0" className="absolute" aria-hidden="true" focusable="false">
      <symbol id="icon-yes" viewBox="0 0 20 20">
        <path
          d="M4.5 10.5l3.5 3.5 7.5-8"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </symbol>
      <symbol id="icon-no" viewBox="0 0 20 20">
        <path
          d="M5.5 5.5l9 9M14.5 5.5l-9 9"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
      </symbol>
    </svg>
  );
}

/** A check or a cross, named "Yes" or "No" for screen readers. */
export function YesNo({ yes, label }: { yes: boolean; label: string }) {
  return (
    <svg
      role="img"
      aria-label={label}
      className={`inline-block size-4.5 align-[-4px] ${yes ? 'text-yes' : 'text-red'}`}
    >
      <use href={yes ? '#icon-yes' : '#icon-no'} />
    </svg>
  );
}
