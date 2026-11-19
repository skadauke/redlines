// The review card of a place, for the toolbar (design §5.1, #1190): what a right-click on a change,
// a comment or a highlight, or ⇧⌘P at one, stacks above the toolbar's row in the same card. It says
// who and when and what, and has the buttons the margin note or the change card has: Accept and
// Reject for a change, Resolve and Reply for a comment, Remove for a highlight. The toolbar owns the
// card around it and puts it where it goes; this makes the element, in the toolbar's own grays, and
// tells the toolbar with a bubbling `rl-bubble-done` event that a button has done its work.

import type { EditorView } from '@codemirror/view';
import { parsedField } from '@redlines/editor';
import { type MarkRange, type Thread, rejectReason } from '@redlines/format';
import { highlightsAt, toggleHighlight } from './highlight.ts';
import { icon, type IconName } from './icons.ts';
import { authorLine, byline, colorClass } from './people.ts';
import {
  attempt,
  decideSuggestion,
  describeChanges,
  element,
  errorLine,
  type ReviewContext,
  segmentSpan,
  setReason,
  suggestionIn,
} from './shared.ts';

/** What the card needs of the rail: the comment's text as the note draws it, and the Reply box. */
export interface BubbleHost {
  renderText?(thread: Thread): Node | string;
  /** Opens the thread's note with its reply box, as its Reply button does. */
  reply(thread: string): void;
}

/** Tells the toolbar that this card's work is done, so that it goes away. */
function done(root: HTMLElement): void {
  root.dispatchEvent(new CustomEvent('rl-bubble-done', { bubbles: true }));
}

/** An action of the card: an icon and a word. The keyboard stays where it is, in the document. */
function action(
  card: HTMLElement,
  name: string,
  iconName: IconName,
  error: HTMLElement,
  run: () => void,
  finish = true,
): HTMLButtonElement {
  const button = element('button', 'rl-bubble-action');
  button.type = 'button';
  button.append(icon(iconName, 14), element('span', 'rl-bubble-label', name));
  button.addEventListener('mousedown', (event) => event.preventDefault());
  button.addEventListener('click', () => {
    if (button.getAttribute('aria-disabled') === 'true') return;
    // The toolbar redraws without the card when the text changes (a decision does that), so the
    // event is sent from what holds the card, found before the action runs.
    const root = card.closest<HTMLElement>('.rl-toolbar') ?? card;
    // A refused action changes nothing, says why, and leaves the card.
    if (attempt(error, run) && finish) done(root);
  });
  return button;
}

function frame(view: EditorView, by: string): HTMLElement {
  const card = element('div', 'rl-bubble');
  card.setAttribute('role', 'group');
  // The author's color, as the editor's `rl-author-N` sets it for the notes (that rule is the editor's).
  const color = /\d+$/.exec(colorClass(view.state, by))?.[0] ?? '0';
  card.style.setProperty('--rl-color', `var(--rl-author-${color})`);
  return card;
}

/** The card of change `id`'s suggestion: who, when, what it did, Accept and Reject. */
export function changeBubble(view: EditorView, ctx: ReviewContext, change: MarkRange): HTMLElement {
  const parsed = view.state.field(parsedField);
  const marks = suggestionIn(ctx, change.id);
  const card = frame(view, change.entry.by);
  const what = describeChanges(parsed, marks.length > 1 ? marks : [change]);
  card.setAttribute('aria-label', what);
  const error = errorLine('rl-bubble-error');
  const accept = action(card, 'Accept', 'accept', error, () =>
    decideSuggestion(ctx, 'accept', change.id),
  );
  const reject = action(card, 'Reject', 'reject', error, () =>
    decideSuggestion(ctx, 'reject', change.id),
  );
  // A format change whose text has lost the formatting can only be accepted.
  setReason(
    reject,
    marks.map((mark) => rejectReason(parsed, mark)).find((reason) => reason !== undefined),
  );
  const actions = element('div', 'rl-bubble-actions');
  actions.append(accept, reject);
  card.append(
    authorLine('rl-bubble', byline(parsed, change.entry.by, ctx.author), change.entry.at),
    element('div', 'rl-bubble-what', what),
    actions,
    error,
  );
  return card;
}

/** The card of a comment: who, when, its text and replies, Resolve (or Reopen) and Reply. */
export function threadBubble(
  view: EditorView,
  ctx: ReviewContext,
  thread: Thread,
  host: BubbleHost,
  decide: (how: 'resolve' | 'reopen', thread: string) => void,
): HTMLElement {
  const parsed = view.state.field(parsedField);
  const card = frame(view, thread.by);
  card.setAttribute('aria-label', 'Comment');
  const error = errorLine('rl-bubble-error');
  const text = element('div', 'rl-bubble-text');
  text.append(host.renderText?.(thread) ?? thread.text);
  card.append(authorLine('rl-bubble', byline(parsed, thread.by, ctx.author), thread.at), text);
  for (const reply of thread.replies) {
    const item = element('div', 'rl-bubble-reply');
    item.append(
      authorLine('rl-bubble', byline(parsed, reply.by, ctx.author), reply.at, true),
      element('div', 'rl-bubble-text', reply.text),
    );
    card.append(item);
  }
  const actions = element('div', 'rl-bubble-actions');
  actions.append(
    thread.resolved
      ? action(card, 'Reopen', 'reopen', error, () => decide('reopen', thread.id))
      : action(card, 'Resolve', 'resolve', error, () => decide('resolve', thread.id)),
    // The reply is written in the thread's note: the toolbar goes first, and the note takes the keyboard.
    action(card, 'Reply', 'reply', error, () => {}, false),
  );
  const replyButton = actions.querySelector<HTMLButtonElement>('button:last-child');
  replyButton?.addEventListener('click', () => {
    done(card.closest<HTMLElement>('.rl-toolbar') ?? card);
    host.reply(thread.id);
  });
  card.append(actions, error);
  return card;
}

/** The card of a highlight: who, when, and Remove where the selection is inside it. */
export function highlightBubble(
  view: EditorView,
  ctx: ReviewContext,
  mark: MarkRange,
): HTMLElement {
  const parsed = view.state.field(parsedField);
  const card = frame(view, mark.entry.by);
  card.setAttribute('aria-label', 'Highlight');
  const error = errorLine('rl-bubble-error');
  card.append(
    authorLine('rl-bubble', byline(parsed, mark.entry.by, ctx.author), mark.entry.at),
    element('div', 'rl-bubble-what', 'Highlighted'),
  );
  // Remove acts on the highlight the selection is in (the command's own rule).
  if (highlightsAt(view.state).some((found) => found.id === mark.id)) {
    const actions = element('div', 'rl-bubble-actions');
    actions.append(
      action(card, 'Remove Highlight', 'reject', error, () => {
        toggleHighlight(ctx);
      }),
    );
    card.append(actions);
  }
  card.append(error);
  return card;
}

/** The comment thread whose anchor holds `pos`, the innermost, or null. */
export function threadAt(view: EditorView, pos: number): Thread | null {
  const parsed = view.state.field(parsedField);
  const found = markAt(parsed.marks, 'cmt', pos);
  return found ? (parsed.ledger.comments.find((thread) => thread.id === found.id) ?? null) : null;
}

/** The highlight that holds `pos`, the innermost, or null. */
export function highlightAt(view: EditorView, pos: number): MarkRange | null {
  return markAt(view.state.field(parsedField).marks, 'hl', pos);
}

function markAt(marks: readonly MarkRange[], kind: 'cmt' | 'hl', pos: number): MarkRange | null {
  let found: MarkRange | null = null;
  let size = Infinity;
  for (const mark of marks) {
    if (mark.kind !== kind) continue;
    for (const segment of mark.segments) {
      const { from, to } = segmentSpan(segment);
      if (pos < from || pos > to || to - from >= size) continue;
      found = mark;
      size = to - from;
    }
  }
  return found;
}

const STYLE_ID = 'rl-bubble-style';

const STYLE = `
/* A card on its own, over the page (a click on a highlight): the tooltip's chrome around it. */
.rl-bubble-card {
  border: 1px solid var(--rl-rule);
  border-radius: 10px;
  background-color: var(--rl-card);
  box-shadow: var(--rl-shadow);
}
/* The review card of a place, in the toolbar's card (bubble.ts). */
.rl-bubble {
  box-sizing: border-box;
  width: min(340px, calc(100vw - 48px));
  max-height: min(320px, 50vh);
  overflow-y: auto;
  padding: 10px 12px 6px;
  color: var(--rl-ink);
  font-family: var(--rl-font-ui);
  font-size: var(--rl-size-ui);
  line-height: 1.38;
  -webkit-user-select: text;
  user-select: text;
}
.rl-bubble-head { display: flex; align-items: center; gap: 7px; min-width: 0; margin-bottom: 4px; white-space: nowrap; }
.rl-bubble .rl-dot { flex: none; width: 8px; height: 8px; border-radius: 50%; background-color: var(--rl-color); }
.rl-bubble-name { flex: none; max-width: 100%; overflow: hidden; font-weight: 700; text-overflow: ellipsis; }
.rl-bubble-for { min-width: 0; overflow: hidden; color: var(--rl-ink-2); text-overflow: ellipsis; }
.rl-bubble-time { flex: none; margin-left: auto; color: var(--rl-ink-2); font-size: var(--rl-size-ui-small); }
.rl-bubble-what, .rl-bubble-text { overflow-wrap: anywhere; }
.rl-bubble-text { white-space: pre-wrap; }
.rl-bubble-reply { margin: 8px 0 0 12px; }
.rl-bubble-actions { display: flex; gap: 2px; margin: 8px -4px 0; }
.rl-bubble-action {
  display: flex;
  flex: none;
  align-items: center;
  gap: 5px;
  height: var(--rl-row-h, 30px);
  padding: 0 9px;
  border: 0;
  border-radius: var(--rl-ctl-radius, 7px);
  background: transparent;
  color: var(--rl-ink);
  font: inherit;
  white-space: nowrap;
  cursor: default;
}
.rl-bubble-action svg { color: var(--rl-ink-2); }
.rl-bubble-action:hover,
.rl-bubble-action:focus-visible { background: color-mix(in srgb, var(--rl-pressed) 55%, transparent); }
.rl-bubble-action:focus-visible { outline: none; box-shadow: inset 0 0 0 1px var(--rl-ink-3); }
.rl-bubble-action[aria-disabled='true'] { opacity: 0.5; }
.rl-bubble-error { color: var(--rl-ink-2); font-size: var(--rl-size-ui-small); }
.rl-bubble-error:empty { display: none; }
`;

/** Puts the card's style in the page, once. */
export function installBubbleStyle(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = STYLE;
  doc.head.append(style);
}
