// The bubble's three actions, as line icons on the interface's 16 × 16 grid with round 1.3 strokes.

const ICONS = {
  /** Make Comment: a speech bubble. */
  comment:
    '<path d="M3.6 2.6h8.8a1.6 1.6 0 0 1 1.6 1.6v5a1.6 1.6 0 0 1-1.6 1.6H8.2L5.2 13.4v-2.6H3.6A1.6 1.6 0 0 1 2 9.2v-5a1.6 1.6 0 0 1 1.6-1.6z"/>',
  /** Open in New Window: a window, and an arrow leaving it. */
  window:
    '<path d="M7.5 3.5h-3a1.6 1.6 0 0 0-1.6 1.6v6.4a1.6 1.6 0 0 0 1.6 1.6h6.4a1.6 1.6 0 0 0 1.6-1.6v-3"/><path d="M9.6 2.5h3.9v3.9M13.5 2.5L8 8"/>',
  /** Copy: two sheets. */
  copy: '<rect x="5.6" y="5.6" width="8" height="8" rx="1.6"/><path d="M10.4 5.6V4.1a1.6 1.6 0 0 0-1.6-1.6H4.1A1.6 1.6 0 0 0 2.5 4.1v4.7a1.6 1.6 0 0 0 1.6 1.6h1.5"/>',
} as const;

export type AskIconName = keyof typeof ICONS;

/** An icon as an inline SVG, `size` pixels square, hidden from assistive technology. */
export function askIcon(name: AskIconName, size = 14): SVGSVGElement {
  const template = document.createElement('template');
  template.innerHTML =
    `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" ` +
    `stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ` +
    `focusable="false">${ICONS[name]}</svg>`;
  const svg = template.content.firstElementChild;
  if (!(svg instanceof SVGSVGElement)) throw new Error(`Couldn't draw the ${name} icon`);
  return svg;
}
