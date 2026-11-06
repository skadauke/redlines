// The review interface's line icons, drawn as the app's own are: on a 16 × 16 grid with round 1.3
// strokes in the current text color, so a control's color is its icon's color.

const ICONS = {
  /** Accept a change: a check mark. */
  accept: '<path d="M3.2 8.6l3.1 3.1 6.5-7.4"/>',
  /** Reject a change: a cross. */
  reject: '<path d="M4.2 4.2l7.6 7.6M11.8 4.2l-7.6 7.6"/>',
  /** The previous change: a chevron pointing back. */
  previous: '<path d="M9.75 4.5L6.25 8l3.5 3.5"/>',
  /** The next change: a chevron pointing on. */
  next: '<path d="M6.25 4.5L9.75 8l-3.5 3.5"/>',
  /** Reply to a thread: an arrow turning back. */
  reply: '<path d="M6.3 4L2.3 8l4 4"/><path d="M2.9 8h6.9a4 4 0 0 1 4 4v1.5"/>',
  /** Resolve a thread: a check mark, as for accepting a change. */
  resolve: '<path d="M3.4 8.6l3 3 6.2-6.9"/>',
  /** Reopen a resolved thread: an arrow turning back on itself, opposite to the check. */
  reopen: '<path d="M3.2 6.2V3M3.2 6.2h3.2"/><path d="M3.6 6.2A5 5 0 1 1 3 8.6"/>',
  /** Close, smaller than Reject's cross. */
  close: '<path d="M5 5l6 6M11 5l-6 6"/>',
} as const;

export type IconName = keyof typeof ICONS;

/** An icon as an inline SVG, `size` pixels square, hidden from assistive technology. */
export function icon(name: IconName, size = 16): SVGSVGElement {
  const template = document.createElement('template');
  template.innerHTML =
    `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" ` +
    `stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ` +
    `focusable="false">${ICONS[name]}</svg>`;
  const svg = template.content.firstElementChild;
  if (!(svg instanceof SVGSVGElement)) throw new Error(`Couldn't draw the ${name} icon`);
  return svg;
}
