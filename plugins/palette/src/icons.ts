// The palette's line icons: drawn on a 16 × 16 grid with round 1.3 strokes in the current text
// color, as the interface's others are (apps/desktop/src/ui/icons.ts), so a control's color is its
// icon's color. They have no labels: a hint names each on hover.

const ICONS = {
  /** Add Comment: a speech bubble. */
  comment:
    '<path d="M3.6 2.6h8.8a1.6 1.6 0 0 1 1.6 1.6v5a1.6 1.6 0 0 1-1.6 1.6H8.2L5.2 13.4v-2.6H3.6A1.6 1.6 0 0 1 2 9.2v-5a1.6 1.6 0 0 1 1.6-1.6z"/>',
  /** Highlight: a marker over a stroke of its color. */
  highlight:
    '<path d="M9.6 2.4l4 4-5.2 5.2H5.1V8.3z"/><path d="M2.6 14.2h6.2" stroke-width="2.4" opacity="0.45"/>',
  /** Ask: a four-pointed spark, the agents' mark. */
  ask: '<path d="M8 2l1.5 4.5L14 8l-4.5 1.5L8 14l-1.5-4.5L2 8l4.5-1.5z"/>',
  /** Table: a grid. */
  table:
    '<rect x="2" y="3" width="12" height="10" rx="1.6"/><path d="M2 6.4h12M2 9.7h12M7.9 3v10"/>',
  /** Code Block: angle brackets in a box. */
  'code-block':
    '<rect x="2" y="3" width="12" height="10" rx="1.6"/><path d="M6.4 6.2L4.6 8l1.8 1.8M9.6 6.2L11.4 8 9.6 9.8"/>',
  /** Alert: a callout box with an exclamation mark. */
  alert:
    '<rect x="2" y="3" width="12" height="10" rx="1.8"/><path d="M8 5.8v2.8"/><path d="M8 10.5h.01" stroke-width="1.8"/>',
  /** Image: a frame with a hill and a sun. */
  image:
    '<rect x="2" y="3" width="12" height="10" rx="1.6"/><circle cx="5.8" cy="6.5" r="1.1"/><path d="M2.5 12l3.6-3.4 2.6 2.4 2.1-1.9 2.7 2.3"/>',
  /** Quote: a rule beside lines of text. */
  quote: '<path d="M3 3.5v9"/><path d="M6 5.5h7M6 8h7M6 10.5h4.5"/>',
  /** Link: two links of a chain. */
  link: '<path d="M6.9 9.1a2.4 2.4 0 0 0 3.4 0l2.1-2.1a2.4 2.4 0 0 0-3.4-3.4L8.1 4.5"/><path d="M9.1 6.9a2.4 2.4 0 0 0-3.4 0L3.6 9a2.4 2.4 0 0 0 3.4 3.4l.9-.9"/>',
  /** Bold: a heavy B. */
  bold: '<path d="M5.2 3v10M5.2 3h3.1a2.4 2.4 0 0 1 0 4.8H5.2M5.2 7.8h3.6a2.6 2.6 0 0 1 0 5.2H5.2" stroke-width="1.5"/>',
  /** Italic: a slanted I. */
  italic: '<path d="M9.8 3H7M9 13H6.2M8.9 3l-1.8 10"/>',
  /** Subscript: an x with a small 2 under it. */
  subscript:
    '<path d="M2.5 3.5l5.6 6.6M8.1 3.5L2.5 10.1"/><path d="M10.2 11.4c.2-.8 1.2-1.1 2-.8.8.3.9 1.3.3 1.9l-2.3 2h3.1"/>',
  /** Superscript: an x with a small 2 over it. */
  superscript:
    '<path d="M2.5 5.9l5.6 6.6M8.1 5.9L2.5 12.5"/><path d="M10.2 2.6c.2-.8 1.2-1.1 2-.8.8.3.9 1.3.3 1.9l-2.3 2h3.1"/>',
  /** Clear Formatting: a T struck through. */
  clear: '<path d="M4 3.5h8M8 3.5v6.5"/><path d="M4.5 13.5L12 6.5"/>',
  /** Cut: scissors. */
  cut: '<circle cx="4.8" cy="11.6" r="1.8"/><circle cx="11.2" cy="11.6" r="1.8"/><path d="M6 10.2L12 2.8M10 10.2L4 2.8"/>',
  /** Copy: two sheets. */
  copy: '<rect x="5.6" y="5.6" width="8" height="8" rx="1.6"/><path d="M10.4 5.6V4.1a1.6 1.6 0 0 0-1.6-1.6H4.1A1.6 1.6 0 0 0 2.5 4.1v4.7a1.6 1.6 0 0 0 1.6 1.6h1.5"/>',
  /** Paste: a clipboard. */
  paste:
    '<rect x="3" y="3.6" width="10" height="9.9" rx="1.6"/><path d="M6 3.6v-.5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v.5"/><path d="M5.8 7.8h4.4M5.8 10.3h2.8"/>',
} as const;

export type PaletteIcon = keyof typeof ICONS;

/** An icon as an inline SVG, `size` pixels square, hidden from assistive technology. */
export function paletteIcon(name: PaletteIcon, size = 16): SVGSVGElement {
  const template = document.createElement('template');
  template.innerHTML =
    `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" ` +
    `stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ` +
    `focusable="false">${ICONS[name]}</svg>`;
  const svg = template.content.firstElementChild;
  if (!(svg instanceof SVGSVGElement)) throw new Error(`Couldn't draw the ${name} icon`);
  return svg;
}

/** The names of the icons, for a test that checks every item has one. */
export const ICON_NAMES = Object.keys(ICONS) as PaletteIcon[];
