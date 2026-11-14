// The outline's style sheet (design §6.4). It is a style element of its own, because the outline
// stands beside the editor, in the pane that scrolls, and not inside it, where a theme of the editor
// would reach it. Quiet, as the margin is: gray lines at rest, a small card when it opens, the
// theme's tokens for color and for the interface's text sizes, and no color but ink, which is
// reserved for people's changes.

export const STYLE_ID = 'rl-outline-style';

export const STYLE = `
.rl-outline {
  position: absolute;
  z-index: 1;
  display: flex;
  align-items: center;
  width: 320px;
  font-family: var(--rl-font-ui);
  font-size: var(--rl-size-ui);
  line-height: 1.3;
  /* Nothing of the outline takes a click but its own panel: the margin beside it holds the change bars. */
  pointer-events: none;
}
.rl-outline[hidden] {
  display: none;
}

/* At rest: a column of short lines. Open: a card with the headings' text. */
.rl-outline-panel {
  position: relative;
  box-sizing: border-box;
  flex: none;
  width: 30px;
  max-height: calc(100% - 24px);
  margin-left: 4px;
  padding: 10px 0;
  overflow: hidden;
  border-radius: 10px;
  background: transparent;
  pointer-events: auto;
  transition:
    width 170ms ease,
    padding 170ms ease,
    background-color 170ms ease,
    box-shadow 170ms ease;
}
.rl-outline[data-open='true'] .rl-outline-panel {
  width: 280px;
  padding: 8px;
  overflow-y: auto;
  background: var(--rl-page, Canvas);
  box-shadow: var(--rl-shadow);
}

.rl-outline-ticks {
  display: flex;
  flex-direction: column;
  gap: 9px;
  padding-left: 8px;
  /* Only a picture of the headings: what it covers is the panel's, and the list's when open. */
  pointer-events: none;
  transition: opacity 120ms ease;
}
.rl-outline[data-ticks='false'] .rl-outline-ticks {
  display: none;
}
.rl-outline[data-open='true'] .rl-outline-ticks {
  position: absolute;
  opacity: 0;
}
.rl-outline-tick {
  display: block;
  width: 8px;
  height: 2px;
  border-radius: 1px;
  background: var(--rl-ink-3);
  transition: background-color 120ms ease;
}
.rl-outline-tick[data-level='1'] {
  width: 20px;
}
.rl-outline-tick[data-level='2'] {
  width: 15px;
}
.rl-outline-tick[data-level='3'] {
  width: 11px;
}
.rl-outline-tick[data-current='true'] {
  background: var(--rl-ink);
}

/* The list is always there for a screen reader and the keyboard; the panel clips it at rest. */
.rl-outline-list {
  position: absolute;
  top: 0;
  left: 0;
  width: 264px;
  margin: 0;
  padding: 8px;
  list-style: none;
  opacity: 0;
  /* Its entries, 31 px apart, are not where the lines are: a click on a line before the card opens
     would go to another heading. */
  pointer-events: none;
  transition: opacity 140ms ease 40ms;
}
.rl-outline[data-open='true'] .rl-outline-list {
  position: static;
  width: auto;
  padding: 0;
  opacity: 1;
  pointer-events: auto;
}
.rl-outline-item {
  display: block;
  box-sizing: border-box;
  width: 100%;
  margin: 0;
  padding: 5px 8px 5px calc(8px + (var(--rl-outline-level, 1) - 1) * 14px);
  overflow: hidden;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--rl-ink-2);
  font-family: inherit;
  font-size: var(--rl-size-ui);
  line-height: inherit;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}
.rl-outline-item:hover {
  background: var(--rl-tint);
  color: var(--rl-ink);
}
.rl-outline-item[aria-current='location'] {
  color: var(--rl-ink);
  font-weight: 700;
}
.rl-outline-item:focus-visible {
  outline: 2px solid var(--rl-ink-3);
  outline-offset: -2px;
}

/* The page is what prints. */
@media print {
  .rl-outline {
    display: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .rl-outline-panel,
  .rl-outline-ticks,
  .rl-outline-tick,
  .rl-outline-list {
    transition: none;
  }
}
`;
