// The interface's line icons: drawn on a 16 × 16 grid with round 1.3 strokes in the current text
// color, so a control's color is its icon's color.

const ICONS = {
  /** Files: a window with a sidebar. */
  files: '<rect x="2" y="3" width="12" height="10" rx="1.8"/><path d="M6 3v10"/>',
  /** The document's own icon beside its name in the title bar: a page with a turned corner. */
  document:
    '<path d="M4.6 1.8h4.2l3.9 3.9v7a1.5 1.5 0 0 1-1.5 1.5H4.6a1.5 1.5 0 0 1-1.5-1.5V3.3a1.5 1.5 0 0 1 1.5-1.5z"/><path d="M8.6 1.9v2.7a1.1 1.1 0 0 0 1.1 1.1h2.9"/>',
  /** The View button in Clean: a page with lines of text. */
  viewClean:
    '<rect x="3.5" y="2" width="9" height="12" rx="1.6"/><path d="M6 5.5h4M6 8h4M6 10.5h2.5"/>',
  /** The View button in Redlines: the same page, with a red bar in its left margin, as the change bars. */
  viewRedlines:
    '<rect x="3.5" y="2" width="9" height="12" rx="1.6"/><path d="M6 5.5h4M6 8h4M6 10.5h2.5"/><path class="rl-view-bar" d="M1.4 5.5v5" stroke-width="1.8"/>',
  /** The View button in Plain: the same page, with a # (the source, in a monospace) in place of the lines. */
  viewPlain:
    '<rect x="3.5" y="2" width="9" height="12" rx="1.6"/><path d="M7 5.2l-.7 5.6M9.7 5.2L9 10.8M5.4 6.9h5.4M5.2 9.1h5.4" stroke-width="1.1"/>',
  /** Resolved comments: a check mark in a circle. */
  resolved: '<circle cx="8" cy="8" r="5.8"/><path d="M5.5 8.3l1.9 1.9 3.2-3.8"/>',
  /** Review while your edits aren't tracked: a pen. */
  pen: '<path d="M10.8 2.7l2.5 2.5-7.6 7.6-3.2.7.7-3.2z"/>',
  /** Review while your edits are tracked: a pen over a line, drawn a little heavier. */
  tracking:
    '<path d="M10.3 2.2l2.3 2.3-6.4 6.4-2.9.6.6-2.9z" stroke-width="1.4"/><path d="M2.5 14h11" stroke-width="1.4"/>',
  /** The toolbar: a wrench, drawn on a 24 grid and scaled to this one. */
  wrench:
    '<path transform="scale(.6667)" stroke-width="1.95" d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  /** The Clean view: a page of text. */
  clean:
    '<rect x="3.5" y="2" width="9" height="12" rx="1.6"/><path d="M6 5.5h4M6 8h4M6 10.5h2.5"/>',
  /** The Redlines view: the page with a change bar in its margin and one mark of markup on it, a line struck through. */
  redlines:
    '<rect x="4.5" y="2" width="9" height="12" rx="1.6"/><path d="M7 5.5h4M7 8h4"/><path d="M7 10.5h4"/><path d="M6.3 12l5.4-3.1" stroke-width="1.1"/><path d="M2 6.2v3.6" stroke-width="1.8"/>',
  /** The simple look: the page of the Redlines view with its change bar and no markup on it. */
  simple:
    '<rect x="4.5" y="2" width="9" height="12" rx="1.6"/><path d="M7 5.5h4M7 8h4M7 10.5h4"/><path d="M2 6.2v3.6" stroke-width="1.8"/>',
  /** The Plain view: angle brackets. */
  raw: '<path d="M5.5 4.5L2.5 8l3 3.5M10.5 4.5l3 3.5-3 3.5"/>',
  /** A list of changes. */
  list: '<path d="M6 4.5h7.5M6 8h7.5M6 11.5h7.5"/><path d="M2.6 4.5h.01M2.6 8h.01M2.6 11.5h.01" stroke-width="2"/>',
  /** Preferences, General: two sliders. */
  general:
    '<path d="M2.5 5h5.5M11.5 5h2M2.5 11h2M8 11h5.5"/><circle cx="9.8" cy="5" r="1.7"/><circle cx="6.2" cy="11" r="1.7"/>',
  /** Preferences, Appearance: a circle, half of it filled. */
  appearance:
    '<circle cx="8" cy="8" r="5.6"/><path d="M8 2.4a5.6 5.6 0 0 1 0 11.2z" fill="currentColor"/>',
  /** Preferences, Editor: the text cursor. */
  editor: '<path d="M5.2 2.5h5.6M5.2 13.5h5.6M8 2.5v11"/>',
  /** Preferences, Agents: a four-pointed spark. */
  agents: '<path d="M8 2l1.5 4.5L14 8l-4.5 1.5L8 14l-1.5-4.5L2 8l4.5-1.5z"/>',
  /** Close or dismiss. */
  close: '<path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/>',
  /** A folder's disclosure arrow, pointing right while closed. */
  chevron: '<path d="M6.5 4.5L10 8l-3.5 3.5"/>',
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
