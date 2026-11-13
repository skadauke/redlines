// The bubble's look (issue #324): in the comment rail's style, a thin border and no shadow, in the
// interface font at the size of a note's text, which follows the text size above 100%: every length
// is px times the note scale, and no font size is anything but the theme's. The review interface's
// own styles (`rl-note-box`, `rl-note-icon`, `rl-hint`, `rl-note-button`) and the live line's
// (`rl-live-line`, the first-run question) do the rest, so that the bubble looks as a note does.

import { EditorView } from '@codemirror/view';

const STYLE_ID = 'rl-qa-style';

const px = (n: number) => `calc(${n}px * var(--rl-note-scale, 1))`;

/** The width of the rail's notes, which the bubble has too, at the theme's own size. */
export const BUBBLE_WIDTH = 248;

export const ASK_STYLE = `
.rl-qa {
  position: absolute;
  z-index: 5;
  box-sizing: border-box;
  width: ${px(BUBBLE_WIDTH)};
  max-width: calc(100vw - ${px(32)});
  padding: ${px(6)} ${px(10)} ${px(9)};
  border: 1px solid var(--rl-rule);
  border-radius: ${px(8)};
  background-color: var(--rl-page);
  color: var(--rl-ink);
  font-family: var(--rl-font-ui);
  font-size: var(--rl-size-ui-scaled);
  line-height: 1.38;
  cursor: default;
}
.rl-qa-question {
  margin: ${px(2)} 0 ${px(4)};
  color: var(--rl-ink-2);
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
.rl-qa-turn + .rl-qa-turn { margin-top: ${px(8)}; padding-top: ${px(6)}; border-top: 1px solid var(--rl-rule); }
.rl-qa-answer p { margin: 0 0 ${px(6)}; overflow-wrap: anywhere; }
.rl-qa-answer ul, .rl-qa-answer ol { margin: 0 0 ${px(6)}; overflow-wrap: anywhere; }
.rl-qa-answer ul { padding-left: ${px(16)}; }
.rl-qa-answer ol { padding-left: ${px(20)}; }
.rl-qa-answer p:last-child, .rl-qa-answer ul:last-child, .rl-qa-answer ol:last-child { margin-bottom: 0; }
.rl-qa-answer code { font-family: var(--rl-font-mono); }
.rl-qa-cite {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--rl-ink-2);
  font: inherit;
  text-decoration: underline;
  text-decoration-color: var(--rl-ink-3);
  text-underline-offset: ${px(2)};
  cursor: default;
}
.rl-qa-cite:hover { color: var(--rl-ink); text-decoration-color: var(--rl-ink-2); }
.rl-qa-cite:focus-visible { outline: 2px solid var(--rl-ink-3); outline-offset: 1px; }
.rl-qa-lost { color: var(--rl-ink-3); }
.rl-qa-sources {
  margin-top: ${px(6)};
  padding-top: ${px(5)};
  border-top: 1px solid var(--rl-rule);
  color: var(--rl-ink-2);
  font-size: var(--rl-size-ui-small-scaled);
}
.rl-qa-source { display: block; overflow-wrap: anywhere; }
.rl-qa-source button { text-align: left; }
.rl-qa-actions {
  display: flex;
  align-items: center;
  gap: ${px(1)};
  margin: ${px(6)} ${px(-5)} 0 ${px(-5)};
}
.rl-qa-actions .rl-note-icon { flex: none; }
.rl-qa-live { margin-top: ${px(2)}; }
.rl-qa-composer[hidden] { display: none; }
.rl-qa-composer textarea { min-height: ${px(24)}; }
.rl-qa-composer-follow { margin-top: ${px(6)}; }
@media print { .rl-qa { display: none !important; } }
`;

/** Puts the style in the page, once. */
export function addStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = ASK_STYLE;
  document.head.append(style);
}

/** The tint of the text the question is about, while the bubble is open. */
export const askTheme = EditorView.baseTheme({
  '.rl-qa-target': { backgroundColor: 'color-mix(in srgb, var(--rl-ink) 14%, transparent)' },
});
