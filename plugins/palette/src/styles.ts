// The palette's look (design §5.1): a card in the interface's grays on the card color, with small
// line icons and no labels, and a hint after the title bar's delay. Everything is through the
// theme's tokens. It is a control like the review bar, not part of the page, so it keeps the
// interface's own sizes and doesn't follow the text size.

const STYLE_ID = 'rl-palette-style';

export const PALETTE_STYLE = `
/* The handle at the bottom center of the window: a short bar that is nearly not there. */
.rl-palette-handle {
  position: fixed;
  bottom: 0;
  left: 50%;
  z-index: 5;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  box-sizing: border-box;
  width: 140px;
  height: 20px;
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--rl-ink-3);
  cursor: default;
  transform: translateX(-50%);
  -webkit-user-select: none;
  user-select: none;
}
.rl-palette-grip {
  width: 36px;
  height: 4px;
  margin-bottom: 6px;
  border-radius: 2px;
  background: currentColor;
  opacity: 0.45;
  transition: opacity 160ms ease;
}
.rl-palette-handle:hover .rl-palette-grip,
.rl-palette-handle[aria-expanded='true'] .rl-palette-grip {
  opacity: 0.9;
}
/* While you write, it is out of the way, until the pointer moves. */
.rl-palette-handle[data-writing] .rl-palette-grip {
  opacity: 0;
}
.rl-palette-handle:focus-visible {
  outline: 2px solid var(--rl-ink-3);
  outline-offset: -2px;
  border-radius: 8px;
}

/* The palette. */
.rl-palette {
  position: fixed;
  z-index: 310;
  box-sizing: border-box;
  width: max-content;
  max-width: calc(100vw - 16px);
  padding: 6px;
  border: 1px solid var(--rl-rule);
  border-radius: 12px;
  background-color: var(--rl-card, Canvas);
  box-shadow: var(--rl-shadow);
  color: var(--rl-ink, CanvasText);
  font-family: var(--rl-font-ui);
  font-size: var(--rl-size-ui);
  line-height: 1;
  cursor: default;
  -webkit-user-select: none;
  user-select: none;
  animation: rl-palette-appear 100ms ease-out;
}
.rl-palette[hidden] { display: none; }
.rl-palette-row {
  display: flex;
  gap: 2px;
}
.rl-palette-rule {
  height: 1px;
  margin: 4px 6px;
  background: var(--rl-rule);
}
.rl-palette-item {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 30px;
  padding: 0;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--rl-ink-2);
  cursor: default;
}
.rl-palette-item:enabled:hover,
.rl-palette-item:focus-visible {
  background: color-mix(in srgb, var(--rl-pressed) 55%, transparent);
  color: var(--rl-ink);
}
.rl-palette-item[aria-pressed='true'] {
  background: var(--rl-pressed);
  color: var(--rl-ink);
}
.rl-palette-item:focus-visible {
  outline: none;
  box-shadow: inset 0 0 0 1px var(--rl-ink-3);
}
.rl-palette-item:disabled {
  color: var(--rl-ink-3);
  opacity: 0.55;
}

/* Spelling suggestions, when the right-click is on a misspelled word: the only words in it. */
.rl-palette-spelling {
  display: flex;
  flex-direction: column;
  min-width: 190px;
}
.rl-palette-word {
  display: block;
  box-sizing: border-box;
  width: 100%;
  height: 30px;
  padding: 0 10px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--rl-ink);
  font: inherit;
  text-align: left;
  cursor: default;
}
.rl-palette-suggestion { font-weight: 700; }
.rl-palette-learn { color: var(--rl-ink-2); }
.rl-palette-word:enabled:hover,
.rl-palette-word:focus-visible {
  background: color-mix(in srgb, var(--rl-pressed) 55%, transparent);
}
.rl-palette-word:focus-visible {
  outline: none;
  box-shadow: inset 0 0 0 1px var(--rl-ink-3);
}
.rl-palette-word:disabled { color: var(--rl-ink-3); }

/* The hint: an item's name and its keys, under the pointer, after the title bar's delay. */
.rl-palette-tip {
  position: fixed;
  z-index: 311;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 7px 10px;
  border-radius: 8px;
  background: var(--rl-tip, #1d1d1f);
  color: #ffffff;
  font-family: var(--rl-font-ui);
  font-size: var(--rl-size-ui-small);
  line-height: 1;
  white-space: nowrap;
  pointer-events: none;
  transform: translateX(-50%);
  animation: rl-palette-appear 90ms ease-out;
}
.rl-palette-tip[hidden] { display: none; }
.rl-palette-tip-keys {
  color: rgb(255 255 255 / 0.62);
  letter-spacing: 0.04em;
}

@keyframes rl-palette-appear {
  from { opacity: 0; transform: translateY(2px); }
}
.rl-palette-tip { animation-name: rl-palette-tip-appear; }
@keyframes rl-palette-tip-appear {
  from { opacity: 0; }
}

@media (prefers-reduced-motion: reduce) {
  .rl-palette, .rl-palette-tip { animation: none; }
  .rl-palette-grip { transition: none; }
}

@media print {
  .rl-palette, .rl-palette-handle, .rl-palette-tip { display: none !important; }
}
`;

/** Puts the style in the page, once. */
export function installStyle(doc: Document): () => void {
  if (doc.getElementById(STYLE_ID)) return () => {};
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = PALETTE_STYLE;
  doc.head.append(style);
  return () => style.remove();
}
