// What the toolbar is doing, apart from the page (issue #504): whether it shows and how it came to
// show, which says what puts it away. Pure functions on a small state, so that the rules are tested
// without a page, and `index.ts` only draws.
//
// The toolbar is shown only when summoned, by default (Stephan, 2026-11-15). There are three ways:
//
// - `docked`: the title bar's wrench, or the preference that keeps it at the bottom of the window.
//   It sits at the bottom center and stays until the wrench turns it off (or the preference does).
//   Nothing else puts it away: a press elsewhere, a scroll, a resize or typing leave it be, and Esc
//   only gives the keyboard back to the document.
// - `keyboard`: ⌘⇧P, at the caret. A press elsewhere, a scroll, a resize, leaving the window and Esc
//   put it away; typing does not (the keyboard is in it).
// - `context`: right-click, at the pointer. Like `keyboard`, and typing puts it away too, since the
//   person went back to writing.

export type Summoned = 'docked' | 'keyboard' | 'context';

export interface ToolbarState {
  /** How the toolbar was summoned; null while it is away. */
  how: Summoned | null;
  /** The preference: the toolbar is at the bottom of the window, shown without being summoned. */
  atBottom: boolean;
}

/** Why the toolbar might go away. */
export type Dismissal = 'escape' | 'press' | 'scroll' | 'resize' | 'blur' | 'writing' | 'zoom';

/** The state of a window that has just opened. */
export function start(atBottom: boolean): ToolbarState {
  return { how: atBottom ? 'docked' : null, atBottom };
}

export const isShown = (state: ToolbarState): boolean => state.how !== null;

/** The wrench: shows the toolbar docked, or puts it away, whichever way it was shown. */
export function wrench(state: ToolbarState): ToolbarState {
  return { ...state, how: state.how === null ? 'docked' : null };
}

/** A right-click, or the key, shows it at the pointer or the caret. */
export function summon(state: ToolbarState, how: 'keyboard' | 'context'): ToolbarState {
  return { ...state, how };
}

/** The preference changed: at the bottom it shows, and off it a docked toolbar goes. */
export function setAtBottom(state: ToolbarState, atBottom: boolean): ToolbarState {
  if (atBottom === state.atBottom) return state;
  if (atBottom) return { atBottom, how: 'docked' };
  return { atBottom, how: state.how === 'docked' ? null : state.how };
}

/** What a press of the toolbar's key (⌘⇧P) does. */
export type KeyAction = 'show-at-caret' | 'hide' | 'focus-toolbar' | 'focus-document';

/**
 * ⌘⇧P: away, it shows at the caret; shown at the caret or the pointer, it goes. Docked, it can't
 * go, so the key moves the keyboard between the document and the toolbar.
 */
export function keyAction(state: ToolbarState, focusInToolbar: boolean): KeyAction {
  if (state.how === null) return 'show-at-caret';
  if (state.how !== 'docked') return 'hide';
  return focusInToolbar ? 'focus-document' : 'focus-toolbar';
}

/**
 * What a reason to go away does: the state after it. A docked toolbar stays, whatever happens in
 * the page; the others go, but a toolbar at the caret keeps going while the person types in it.
 */
export function dismiss(state: ToolbarState, why: Dismissal): ToolbarState {
  if (state.how === null || state.how === 'docked') return state;
  if (why === 'writing' && state.how === 'keyboard') return state;
  return { ...state, how: null };
}

/**
 * Whether the toolbar fades while the person types: the docked one, which typing doesn't put away.
 * It comes back when the pointer moves. The others go (at the pointer) or stay for the keyboard
 * (at the caret), where the keyboard is in them.
 */
export function fades(state: ToolbarState): boolean {
  return state.how === 'docked';
}
