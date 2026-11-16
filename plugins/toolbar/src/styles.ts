// The toolbar's look (design §5.1): a card in the interface's grays on the card color, with small
// line icons and no labels, in one row, docked at the bottom center or at the pointer or caret, and
// a hint after the title bar's delay. Everything is through the theme's tokens. It is a control like the review bar, not part of the page, so it keeps the
// interface's own sizes and doesn't follow the text size.

const STYLE_ID = 'rl-toolbar-style';

export const TOOLBAR_STYLE = `
/* The toolbar. */
.rl-toolbar {
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
  animation: rl-toolbar-appear 100ms ease-out;
}
.rl-toolbar[hidden] { display: none; }
/* Docked: the bottom center, above the word count's corner. It has no left or top of its own. */
.rl-toolbar-docked {
  left: 0;
  right: 0;
  bottom: 16px;
  margin: 0 auto;
}
/* The bar: Ask, a rule, and a button for each menu, side by side. */
.rl-toolbar-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 2px;
}
.rl-toolbar-rule {
  flex: none;
  align-self: stretch;
  width: 1px;
  margin: 3px 4px;
  background: var(--rl-rule);
}
/* Under the spelling rows: across the card. */
.rl-toolbar-rule-under {
  width: auto;
  height: 1px;
  margin: 4px 6px;
}
.rl-toolbar-menubox { position: relative; display: flex; }
.rl-toolbar-top {
  display: flex;
  flex: none;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 9px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--rl-ink-2);
  font: inherit;
  cursor: default;
}
.rl-toolbar-top:hover,
.rl-toolbar-top-open,
.rl-toolbar-top:focus-visible {
  background: color-mix(in srgb, var(--rl-pressed) 55%, transparent);
  color: var(--rl-ink);
}
.rl-toolbar-top-open { background: var(--rl-pressed); }
.rl-toolbar-top:focus-visible {
  outline: none;
  box-shadow: inset 0 0 0 1px var(--rl-ink-3);
}
.rl-toolbar-top[aria-disabled='true'] { color: var(--rl-ink-3); opacity: 0.55; }
.rl-toolbar-top svg { flex: none; }

/* A menu: opaque, on its own card, over or under the bar (never on it), scrolling when taller than
   the room. */
.rl-toolbar-menu {
  position: absolute;
  z-index: 1;
  top: calc(100% + 10px);
  left: 0;
  box-sizing: border-box;
  width: max-content;
  min-width: 232px;
  max-width: calc(100vw - 16px);
  overflow-y: auto;
  padding: 4px;
  border: 1px solid var(--rl-rule);
  border-radius: 10px;
  background-color: var(--rl-card, Canvas);
  box-shadow: var(--rl-shadow);
}
.rl-toolbar-menu[hidden] { display: none; }
.rl-toolbar-menu-up { top: auto; bottom: calc(100% + 10px); }
.rl-toolbar-menu-head {
  padding: 6px 10px 5px;
  color: var(--rl-ink-2);
  font-size: var(--rl-size-ui-small);
  line-height: 1.2;
}
.rl-toolbar-line { display: flex; gap: 2px; }
.rl-toolbar-item {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 10px;
  min-width: 0;
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
.rl-toolbar-item svg { flex: none; color: var(--rl-ink-2); }
.rl-toolbar-label { flex: 1; white-space: nowrap; }
.rl-toolbar-keys {
  flex: none;
  color: var(--rl-ink-2);
  font-size: var(--rl-size-ui-small);
  letter-spacing: 0.04em;
}
.rl-toolbar-item:hover:not([aria-disabled='true']),
.rl-toolbar-item:focus-visible {
  background: color-mix(in srgb, var(--rl-pressed) 55%, transparent);
}
.rl-toolbar-item[aria-checked='true'] { background: var(--rl-pressed); }
.rl-toolbar-item:focus-visible {
  outline: none;
  box-shadow: inset 0 0 0 1px var(--rl-ink-3);
}
/* Grayed: dimmed, and its hint says why. */
.rl-toolbar-item[aria-disabled='true'] { opacity: 0.5; }

/* The palette: the search box and its lines take the bar's place in the card. */
.rl-toolbar[data-search] .rl-toolbar-bar,
.rl-toolbar[data-search] .rl-toolbar-spelling,
.rl-toolbar[data-search] .rl-toolbar-rule-under { display: none; }
.rl-toolbar[data-search] { width: min(440px, calc(100vw - 16px)); }
.rl-toolbar-search { display: flex; flex-direction: column; gap: 4px; }
.rl-toolbar-field {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 30px;
  padding: 0 8px;
  color: var(--rl-ink-2);
}
.rl-toolbar-field svg { flex: none; }
.rl-toolbar-input {
  flex: 1;
  min-width: 0;
  height: 100%;
  padding: 0;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--rl-ink);
  font: inherit;
  -webkit-user-select: text;
  user-select: text;
}
.rl-toolbar-input::placeholder { color: var(--rl-ink-3); }
.rl-toolbar-results {
  display: flex;
  flex-direction: column;
  max-height: 264px;
  overflow-y: auto;
  padding-top: 4px;
  border-top: 1px solid var(--rl-rule);
}
.rl-toolbar-result {
  display: flex;
  flex: none;
  align-items: center;
  gap: 10px;
  height: 30px;
  padding: 0 10px;
  border-radius: 7px;
  color: var(--rl-ink);
  cursor: default;
}
.rl-toolbar-result svg { flex: none; color: var(--rl-ink-2); }
.rl-toolbar-result[aria-selected='true'] {
  background: color-mix(in srgb, var(--rl-pressed) 55%, transparent);
}
.rl-toolbar-result-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rl-toolbar-result-state { display: flex; flex: none; align-items: center; }
/* The keys have a column of their own, whether the line has any or not. */
.rl-toolbar-result-keys { min-width: 56px; text-align: right; }
.rl-toolbar-none-found { padding: 8px 10px; color: var(--rl-ink-2); }

/* A switch, as the app's others: a mid gray when on and a pale one when off, never black. */
.rl-toolbar-switch {
  position: relative;
  width: 30px;
  height: 18px;
  border-radius: 9px;
  background: var(--rl-rule);
}
.rl-toolbar-switch[aria-checked='true'] { background: var(--rl-ink-3); }
.rl-toolbar-knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--rl-card, Canvas);
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.25);
}
.rl-toolbar-switch[aria-checked='true'] .rl-toolbar-knob { left: 14px; }
.rl-toolbar-segments {
  display: flex;
  gap: 2px;
  padding: 2px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--rl-pressed) 55%, transparent);
}
.rl-toolbar-segment {
  height: 22px;
  padding: 0 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--rl-ink-2);
  font: inherit;
  font-size: var(--rl-size-ui-small);
  cursor: default;
}
.rl-toolbar-segment[aria-checked='true'] {
  background: var(--rl-card, Canvas);
  color: var(--rl-ink);
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.2);
}
.rl-toolbar-slider { display: flex; align-items: center; gap: 8px; }
.rl-toolbar-range { width: 96px; accent-color: var(--rl-ink-3); }
.rl-toolbar-value { min-width: 40px; color: var(--rl-ink-2); font-size: var(--rl-size-ui-small); text-align: right; }

/* The bar goes while the person types, and comes back when the pointer moves. */
.rl-toolbar[data-writing] {
  opacity: 0;
  pointer-events: none;
  transition: opacity 120ms ease-out;
}
.rl-toolbar[data-writing]:focus-within { opacity: 1; pointer-events: auto; }
.rl-toolbar:not([data-writing]) { transition: opacity 120ms ease-out; }

/* Spelling suggestions, when the right-click is on a misspelled word: the only words in it. */
.rl-toolbar-spelling {
  display: flex;
  flex-direction: column;
  min-width: 190px;
}
.rl-toolbar-word {
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
.rl-toolbar-suggestion { font-weight: 700; }
.rl-toolbar-learn { color: var(--rl-ink-2); }
.rl-toolbar-word:enabled:hover,
.rl-toolbar-word:focus-visible {
  background: color-mix(in srgb, var(--rl-pressed) 55%, transparent);
}
.rl-toolbar-word:focus-visible {
  outline: none;
  box-shadow: inset 0 0 0 1px var(--rl-ink-3);
}
.rl-toolbar-word:disabled { color: var(--rl-ink-3); }

/* The hint: an item's name and its keys, under the pointer, after the title bar's delay. */
.rl-toolbar-tip {
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
  animation: rl-toolbar-appear 90ms ease-out;
}
.rl-toolbar-tip[hidden] { display: none; }
.rl-toolbar-tip-keys {
  color: rgb(255 255 255 / 0.62);
  letter-spacing: 0.04em;
}

@keyframes rl-toolbar-appear {
  from { opacity: 0; transform: translateY(2px); }
}
.rl-toolbar-tip { animation-name: rl-toolbar-tip-appear; }
@keyframes rl-toolbar-tip-appear {
  from { opacity: 0; }
}

@media (prefers-reduced-motion: reduce) {
  .rl-toolbar, .rl-toolbar-tip { animation: none; }
}

@media print {
  .rl-toolbar, .rl-toolbar-tip { display: none !important; }
}
`;

/** Puts the style in the page, once. */
export function installStyle(doc: Document): () => void {
  if (doc.getElementById(STYLE_ID)) return () => {};
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = TOOLBAR_STYLE;
  doc.head.append(style);
  return () => style.remove();
}
