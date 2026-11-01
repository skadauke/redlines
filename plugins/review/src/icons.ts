// The review interface's line icons, drawn as the app's own are: on a 16 × 16 grid with round 1.3
// strokes in the current text color, so a control's color is its icon's color.

const ICONS = {
  /** Accept a change: a check mark. */
  accept: '<path d="M3.2 8.6l3.1 3.1 6.5-7.4"/>',
  /** Reject a change: a cross. */
  reject: '<path d="M4.2 4.2l7.6 7.6M11.8 4.2l-7.6 7.6"/>',
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
