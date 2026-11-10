import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

/**
 * The brand mark: the app's icon, a sheet of warm paper with gray lines of
 * text and a red caret drawn by hand, in the same proportions (the caret is
 * src/app/icon.svg, the favicon). Its colors are fixed, so it reads as the
 * same sheet in light and dark mode. Decorative: the name always stands next
 * to it.
 */
export function BrandMark(props: IconProps) {
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true" focusable="false" {...props}>
      <rect
        x="1"
        y="1"
        width="98"
        height="98"
        rx="22"
        fill="#fbf9f4"
        stroke="#e2ded5"
        strokeWidth="0.6"
      />
      <g fill="#cdc9c1">
        <rect x="22" y="26" width="56" height="6" rx="3" />
        <rect x="22" y="45" width="21" height="6" rx="3" />
        <rect x="57" y="45" width="21" height="6" rx="3" />
      </g>
      <g fill="#d42a1e">
        <path d="M42.3,76.3 43.2,76 43.6,75.4 45.8,71.5 49.9,62.2 51.7,57 51.8,56.4 51.5,55.5 47.9,53.6 47,53.9 46.2,54.8 44.7,56.9 43.1,59.7 40.4,65.7 38.5,71.4 38,74 38.5,74.9Z" />
        <circle cx="40.4" cy="75.6" r="2" />
        <circle cx="49.7" cy="54.6" r="2" />
        <path d="M48.3,55.3 47.9,56.1 48.1,57.3 50,62.5 51.6,66.1 53.4,69.7 56.3,74.3 57.7,75.9 58.6,76.2 62.2,74.2 62.5,73.3 62.4,72.6 60.5,67.7 56.8,60 53.6,54.7 52.8,53.8 51.9,53.5Z" />
        <circle cx="50.1" cy="54.4" r="2" />
        <circle cx="60.4" cy="75.2" r="2" />
      </g>
    </svg>
  );
}

/** Two pause bars. Decorative: put the meaning in text or an aria-label. */
export function PauseIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" {...props}>
      <rect x="3.5" y="2.5" width="3.2" height="11" rx="1" fill="currentColor" />
      <rect x="9.3" y="2.5" width="3.2" height="11" rx="1" fill="currentColor" />
    </svg>
  );
}

/** A play triangle. Decorative: put the meaning in text or an aria-label. */
export function PlayIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" {...props}>
      <path
        d="M5 3.3v9.4a.9.9 0 0 0 1.37.77l7.37-4.7a.9.9 0 0 0 0-1.53L6.37 2.53A.9.9 0 0 0 5 3.3Z"
        fill="currentColor"
      />
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
 * The comparison table's check, cross and dashed ring, drawn once and used by
 * reference from every cell (<use href="#…">), which keeps the page small.
 */
export function MarkSymbols() {
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
      <symbol id="icon-planned" viewBox="0 0 20 20">
        <circle
          cx="10"
          cy="10"
          r="6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeDasharray="2.6 2.4"
        />
      </symbol>
    </svg>
  );
}

const markColors = { yes: 'text-yes', no: 'text-red', planned: 'text-ink-3' } as const;

/** A check, a cross or a dashed ring, named for screen readers by its label. */
export function Mark({ mark, label }: { mark: 'yes' | 'no' | 'planned'; label: string }) {
  return (
    <svg
      role="img"
      aria-label={label}
      className={`inline-block size-4.5 align-[-4px] ${markColors[mark]}`}
    >
      <use href={`#icon-${mark}`} />
    </svg>
  );
}
