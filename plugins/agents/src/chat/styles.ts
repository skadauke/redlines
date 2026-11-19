// The chat panel's look (#1194): the sidebar's own grays and the theme's tokens, in the theme's
// interface sizes (never a size of its own). The person's message is a subtle bubble; the agent's is
// plain text on the sidebar's ground; the composer is a rounded box.

const STYLE_ID = 'rl-chat-style';

export const CHAT_STYLE = `
.rl-chat { display: flex; flex: 1; flex-direction: column; position: relative; min-height: 0; width: var(--rl-sidebar-width, 240px); box-sizing: border-box; color: var(--rl-ink); font-family: var(--rl-font-ui); font-size: var(--rl-size-ui); line-height: 1.45; -webkit-user-select: text; user-select: text; }
.rl-chat[hidden] { display: none; }
.rl-chat-title { flex: none; padding: 6px 20px 8px; overflow: hidden; color: var(--rl-ink-2); font-size: var(--rl-size-ui-small); font-weight: 700; letter-spacing: 0.06em; text-overflow: ellipsis; text-transform: uppercase; white-space: nowrap; -webkit-user-select: none; user-select: none; }
.rl-chat-log { flex: 1; min-height: 0; padding: 4px 14px 12px; overflow-y: auto; overflow-x: hidden; box-sizing: border-box; outline: none; }
.rl-chat-msg { margin: 0 0 14px; min-width: 0; overflow-wrap: anywhere; }
.rl-chat-mine { display: flex; justify-content: flex-end; }
.rl-chat-bubble { max-width: 88%; padding: 6px 11px; border-radius: var(--rl-radius-card); background: var(--rl-pressed); white-space: pre-wrap; }
.rl-chat-from { margin: 0 0 2px; color: var(--rl-ink-2); font-size: var(--rl-size-ui-small); }
.rl-chat-theirs { position: relative; }
.rl-chat-md > :first-child { margin-top: 0; }
.rl-chat-md > :last-child { margin-bottom: 0; }
.rl-chat-md p { margin: 0 0 8px; }
.rl-chat-md ul, .rl-chat-md ol { margin: 0 0 8px; padding-left: 20px; }
.rl-chat-md li { margin: 0 0 3px; }
.rl-chat-md code { padding: 0 3px; border-radius: 4px; background: var(--rl-pressed); font-family: var(--rl-font-mono); font-size: var(--rl-size-ui-small); }
.rl-chat-md pre { margin: 0 0 8px; padding: 8px 10px; overflow-x: auto; border-radius: 8px; background: var(--rl-pressed); }
.rl-chat-md pre code { padding: 0; background: transparent; }
.rl-chat-md blockquote { margin: 0 0 8px; padding-left: 10px; border-left: 2px solid var(--rl-rule); color: var(--rl-ink-2); }
.rl-chat-md hr { margin: 10px 0; border: 0; border-top: 1px solid var(--rl-rule); }
.rl-chat-md a { color: inherit; text-decoration: underline; text-decoration-color: var(--rl-ink-3); text-underline-offset: 2px; }
.rl-chat-h { margin: 10px 0 4px; font-weight: 700; }
.rl-chat-md .rl-chat-h:first-child { margin-top: 0; }
.rl-chat-hover { display: flex; gap: 2px; height: 22px; margin-top: 2px; opacity: 0; transition: opacity 120ms ease; }
.rl-chat-theirs:hover .rl-chat-hover, .rl-chat-theirs:focus-within .rl-chat-hover { opacity: 1; }
.rl-chat-act { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 22px; padding: 0; border: 0; border-radius: 6px; background: transparent; color: var(--rl-ink-2); cursor: default; }
.rl-chat-act:hover { background: var(--rl-pressed); color: var(--rl-ink); }
.rl-chat-act:focus-visible, .rl-chat-send:focus-visible, .rl-chat-who:focus-visible, .rl-chat-item:focus-visible, .rl-chat-suggestion:focus-visible, .rl-chat-jump:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--rl-ink-3); }
.rl-chat-empty { padding: 28px 6px 0; color: var(--rl-ink-2); }
.rl-chat-empty-title { margin: 0 0 6px; color: var(--rl-ink); font-weight: 700; }
.rl-chat-empty-line { margin: 0 0 14px; font-size: var(--rl-size-ui-small); }
.rl-chat-suggestions { display: flex; flex-direction: column; gap: 6px; }
.rl-chat-suggestion { padding: 6px 10px; border: 1px solid var(--rl-rule); border-radius: var(--rl-radius-card); background: transparent; color: var(--rl-ink); font: inherit; text-align: left; cursor: default; }
.rl-chat-suggestion:hover { background: var(--rl-pressed); }
.rl-chat-live { flex: none; padding: 0 14px; }
.rl-chat-live:not(:empty) { padding-bottom: 8px; }
.rl-chat-jump { position: absolute; right: 16px; bottom: 96px; padding: 3px 10px; border: 1px solid var(--rl-rule); border-radius: 999px; background: var(--rl-page); color: var(--rl-ink); font: inherit; font-size: var(--rl-size-ui-small); box-shadow: var(--rl-shadow); cursor: default; }
.rl-chat-jump[hidden] { display: none; }
.rl-chat-composer { position: relative; flex: none; margin: 0 10px 10px; padding: 8px 8px 6px 12px; border: 1px solid var(--rl-rule); border-radius: 16px; background: var(--rl-page); box-sizing: border-box; }
.rl-chat-composer:focus-within { border-color: var(--rl-ink-3); }
.rl-chat-field { display: block; width: 100%; min-height: 24px; max-height: 160px; margin: 0; padding: 2px 0; border: 0; outline: none; resize: none; background: transparent; color: var(--rl-ink); font: inherit; line-height: 1.45; box-sizing: border-box; }
.rl-chat-field::placeholder { color: var(--rl-ink-2); }
.rl-chat-bar { display: flex; align-items: center; justify-content: space-between; gap: 6px; margin-top: 4px; }
.rl-chat-who { display: inline-flex; align-items: center; gap: 4px; min-width: 0; height: 24px; padding: 0 6px 0 4px; border: 0; border-radius: 6px; background: transparent; color: var(--rl-ink-2); font: inherit; font-size: var(--rl-size-ui-small); cursor: default; }
.rl-chat-who:hover:not(:disabled), .rl-chat-who[aria-expanded='true'] { background: var(--rl-pressed); color: var(--rl-ink); }
.rl-chat-who:disabled { opacity: 0.6; }
.rl-chat-who-name { font-weight: 700; white-space: nowrap; }
.rl-chat-who-model { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rl-chat-send { display: inline-flex; flex: none; align-items: center; justify-content: center; width: 26px; height: 26px; padding: 0; border: 0; border-radius: 50%; background: var(--rl-ink); color: var(--rl-page); cursor: default; }
.rl-chat-send:disabled { background: var(--rl-off); color: var(--rl-page); }
.rl-chat-menu { position: absolute; right: 0; bottom: calc(100% + 6px); left: 0; z-index: 3; max-height: 280px; padding: 4px; overflow-y: auto; border: 1px solid var(--rl-rule); border-radius: var(--rl-radius-menu); background: var(--rl-page); box-shadow: var(--rl-shadow); box-sizing: border-box; }
.rl-chat-menu[hidden] { display: none; }
.rl-chat-menu-note { padding: 6px 8px; color: var(--rl-ink-2); font-size: var(--rl-size-ui-small); }
.rl-chat-item { display: flex; align-items: center; gap: 6px; width: 100%; height: 28px; padding: 0 8px 0 4px; border: 0; border-radius: 6px; background: transparent; color: var(--rl-ink); font: inherit; text-align: left; cursor: default; }
.rl-chat-item:hover:not(:disabled), .rl-chat-item:focus-visible { background: var(--rl-pressed); }
.rl-chat-item:disabled { color: var(--rl-ink-3); }
.rl-chat-sub { padding-left: 24px; }
.rl-chat-check { display: inline-flex; flex: none; width: 14px; }
.rl-chat-item-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rl-chat-item-note { color: var(--rl-ink-2); font-size: var(--rl-size-ui-small); }
@media print { .rl-chat { display: none !important; } }
`;

/** Puts the style in the page, once. */
export function addChatStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CHAT_STYLE;
  document.head.append(style);
}
