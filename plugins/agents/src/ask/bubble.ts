// The bubble (issue #324): the box the question is typed in, then the question, the agent's live
// line while it works (what it is doing, with Stop, or the first-run question, or why it failed), the
// answer, and under it the actions and a field for a follow-up. It is a note's look: a thin border,
// the interface font, and the review interface's own buttons and hints. It knows nothing of the
// editor: `ask.ts` gives it what the session says, and what each button does.
//
// The exchange is a live region, which says what is added to it: so a turn that is drawn stays the
// same node, and a new question is added after it, and its answer to it, and nothing that was said is
// taken away and put back, which a screen reader would say again.

import { fitStatus, renderLiveLine, type LiveLineActions } from '../live-line.ts';
import type { LiveLine } from '../runs.ts';
import { askIcon, type AskIconName } from './icons.ts';
import { renderAnswer } from './render.ts';
import { EXPLAIN, type AskTurn } from './session.ts';
import { addStyle } from './styles.ts';

/** What the bubble shows. */
export interface BubbleView {
  turns: readonly AskTurn[];
  /** The question being answered, or null. */
  pending: string | null;
  /** What the run shows, or null. */
  line: LiveLine | null;
  /** What the field starts with when it comes back after a stop or a failure. */
  draft: string;
  /** Whether Open in New Window is offered: the host can open a window with text. */
  canOpenWindow: boolean;
}

export interface BubbleHandlers {
  /** The field was submitted: a question, or a follow-up, possibly empty. */
  submit(text: string): void;
  /** Cancel, or Esc in the field. */
  close(): void;
  stop(): void;
  consent(answer: 'folder' | 'document' | 'no'): void;
  dismiss(): void;
  showLog?: (path: string) => void;
  /** Opens Preferences › Agents, for a failure they can put right. */
  openPreferences?: () => void;
  makeComment(): void;
  openWindow(): void;
  copy(): void;
  /** Whether the passage `quote` is in the document now. */
  has(quote: string): boolean;
  /** Shows the passage `quote` in the document. */
  show(quote: string): void;
  /** The bubble changed size: the host places it again. */
  resized(): void;
  /** Gives the field its helpers, such as the @ picker; returns a function that takes them away. */
  attachToField?: (field: HTMLTextAreaElement) => () => void;
  /** Puts the keyboard back in the document. */
  focusDocument(): void;
}

export interface Bubble {
  readonly el: HTMLElement;
  render(view: BubbleView): void;
  /** Puts the keyboard in the field, if it is showing. */
  focusField(): void;
  /** Whether the field has text the person typed. */
  readonly written: boolean;
  destroy(): void;
}

let count = 0;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
): HTMLElementTagNameMap[K] {
  const made = document.createElement(tag);
  if (className) made.className = className;
  return made;
}

/** The question as the bubble shows it: what was typed, or what an empty one means. */
const shownQuestion = (question: string) => (question.trim() === '' ? EXPLAIN : question.trim());

export function createBubble(handlers: BubbleHandlers): Bubble {
  addStyle();
  const root = el('div', 'rl-qa');
  root.id = `rl-qa-${++count}`;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Ask');
  // Nothing in the bubble takes the keyboard from the field by a press of the mouse, and a press
  // in its padding goes nowhere.
  const exchange = el('div', 'rl-qa-exchange');
  // An answer is said when it comes, to VoiceOver as to the eye.
  exchange.setAttribute('aria-live', 'polite');
  const live = el('div', 'rl-qa-live');
  const actions = el('div', 'rl-qa-actions');
  const composer = el('div', 'rl-note-box rl-qa-composer');
  const field = el('textarea');
  field.rows = 1;
  field.setAttribute('aria-label', 'Question');
  const row = el('div', 'rl-note-box-row');
  const button = (label: string, run: () => void, className = 'rl-note-button') => {
    const made = el('button', className);
    made.type = 'button';
    made.textContent = label;
    made.addEventListener('mousedown', (event) => event.preventDefault());
    made.addEventListener('click', run);
    return made;
  };
  const askButton = button('Ask', () => submit());
  askButton.title = 'Ask (Return)';
  row.append(
    button('Cancel', () => handlers.close()),
    askButton,
  );
  composer.append(field, row);
  root.append(exchange, live, actions, composer);

  const submit = () => {
    const text = field.value;
    field.value = '';
    size();
    handlers.submit(text);
  };
  /** As high as the text, with the borders that `scrollHeight` leaves out. */
  const size = () => {
    field.style.height = 'auto';
    field.style.height = `${field.scrollHeight + field.offsetHeight - field.clientHeight}px`;
    handlers.resized();
  };
  field.addEventListener('input', size);
  field.addEventListener('keydown', (event) => {
    // A key during composition belongs to the input method.
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === 'Enter' && !event.shiftKey && !event.altKey) {
      event.preventDefault();
      submit();
    }
    // Escape is the whole bubble's: the document hears it (ask.ts), unless the @ picker took it.
  });
  const detachField = handlers.attachToField?.(field) ?? null;

  const liveActions: LiveLineActions = {
    answer: (answer) => handlers.consent(answer),
    stop: () => handlers.stop(),
    dismiss: () => handlers.dismiss(),
    ...(handlers.showLog ? { showLog: (path) => handlers.showLog?.(path) } : {}),
    ...(handlers.openPreferences ? { openPreferences: () => handlers.openPreferences?.() } : {}),
    focusDocument: () => handlers.focusDocument(),
  };

  /** The icon button of an action, named by a hint on hover as a note's icons are. */
  const action = (label: string, icon: AskIconName, run: () => void) => {
    const made = el('button', 'rl-note-icon');
    made.type = 'button';
    made.setAttribute('aria-label', label);
    const hint = el('span', 'rl-hint');
    hint.textContent = label;
    hint.setAttribute('aria-hidden', 'true');
    made.append(askIcon(icon), hint);
    made.addEventListener('mousedown', (event) => event.preventDefault());
    made.addEventListener('click', run);
    return made;
  };

  /** The agent's name over its answer, and the answer: what a question is answered with. */
  const answerOf = ({ answer, agent }: AskTurn): Node[] => {
    const head = el('div', 'rl-note-head rl-author-0');
    const dot = el('span', 'rl-dot');
    const name = el('span', 'rl-note-name');
    name.textContent = agent.name;
    head.append(dot, name);
    return [
      head,
      renderAnswer(answer, {
        has: (quote) => handlers.has(quote),
        show: (quote) => handlers.show(quote),
      }),
    ];
  };

  /** A turn as it is drawn: its question, and its answer once it has one. */
  interface ShownTurn {
    /** The turn it shows, or null while its question waits for an answer. */
    turn: AskTurn | null;
    /** The question that is waiting, to tell it from another. */
    waiting: string;
    block: HTMLElement;
    asked: HTMLElement;
  }
  const shownTurns: ShownTurn[] = [];

  const drawTurn = (turn: AskTurn | null, question: string): ShownTurn => {
    const block = el('div', 'rl-qa-turn');
    const asked = el('div', 'rl-qa-question');
    asked.textContent = shownQuestion(question);
    block.append(asked);
    if (turn) block.append(...answerOf(turn));
    return { turn, waiting: question, block, asked };
  };

  /**
   * Makes the exchange show `turns` and the question `pending`, changing no more of it than has
   * changed: a turn that is drawn is kept as it is; a question that has its answer now gets the
   * answer added to it; whatever is new is added at the end. Anything else (which the session never
   * does) is drawn again from there on.
   */
  const drawExchange = (turns: readonly AskTurn[], pending: string | null) => {
    const wanted = [
      ...turns.map((turn) => ({ turn, question: turn.question })),
      ...(pending === null ? [] : [{ turn: null, question: pending }]),
    ];
    let at = 0;
    for (const { turn, question } of wanted) {
      const have = shownTurns[at];
      if (have && turn !== null && have.turn === turn) {
        // As it is.
      } else if (have && turn === null && have.turn === null && have.waiting === question) {
        // The same question, still waiting.
      } else if (have && turn !== null && have.turn === null) {
        // The question that was waiting has its answer: the answer is added to it.
        have.turn = turn;
        const asked = shownQuestion(turn.question);
        if (have.asked.textContent !== asked) have.asked.textContent = asked;
        have.block.append(...answerOf(turn));
      } else {
        break;
      }
      at++;
    }
    for (const gone of shownTurns.splice(at)) gone.block.remove();
    for (const { turn, question } of wanted.slice(at)) {
      const made = drawTurn(turn, question);
      shownTurns.push(made);
      exchange.append(made.block);
    }
  };

  /** What `live` shows now, to change a running line in place. */
  let liveLine: LiveLine | null = null;
  let wasComposing = false;

  return {
    el: root,
    get written() {
      return field.value.trim() !== '';
    },
    render(view) {
      // The keyboard was in the bubble, or was lost when the field went away to make room for the
      // answer: it goes back to the field when it returns.
      const active = root.ownerDocument.activeElement;
      const keyboardHere = !active || active === root.ownerDocument.body || root.contains(active);
      const working = view.pending !== null;
      const answered = view.turns.length > 0;
      drawExchange(view.turns, view.pending);

      // The live line: a running one changes its words in place, so its dot keeps its pulse and
      // Stop keeps the keyboard.
      const next = view.line;
      const drawn = live.firstElementChild;
      const text = drawn?.querySelector('.rl-live-line-text');
      if (
        liveLine?.kind === 'running' &&
        next?.kind === 'running' &&
        liveLine.agent === next.agent &&
        text
      ) {
        text.textContent = fitStatus(next.status);
        text.setAttribute('title', next.status.replace(/\s+/g, ' ').trim());
      } else {
        live.replaceChildren(...(next ? [renderLiveLine(next, liveActions)] : []));
      }
      liveLine = next;

      // The actions, once there is an answer to keep and nothing is going on.
      actions.replaceChildren();
      if (answered && !working && next === null) {
        actions.append(
          action('Make Comment', 'comment', () => handlers.makeComment()),
          ...(view.canOpenWindow
            ? [action('Open in New Window', 'window', () => handlers.openWindow())]
            : []),
          action('Copy', 'copy', () => handlers.copy()),
        );
      }
      actions.hidden = actions.childElementCount === 0;

      // The field: for the first question, and a follow-up, whenever nothing is being answered and
      // the first-run question is not up.
      const composing = !working && next?.kind !== 'asking';
      composer.hidden = !composing;
      composer.classList.toggle('rl-qa-composer-follow', answered);
      field.placeholder = answered ? 'Ask a follow-up' : 'Ask about this, or press Return';
      field.setAttribute('aria-label', answered ? 'Follow-up question' : 'Question');
      if (composing && !wasComposing && field.value === '' && view.draft !== '') {
        field.value = view.draft;
        field.setSelectionRange(field.value.length, field.value.length);
      }
      const returned = composing && !wasComposing;
      wasComposing = composing;
      size();
      // After an answer or a failure the keyboard goes back to the field, for the next question.
      if (returned && keyboardHere && (answered || view.draft !== '')) {
        field.focus({ preventScroll: true });
      }
    },
    focusField() {
      if (!composer.hidden) field.focus();
    },
    destroy() {
      detachField?.();
      root.remove();
    },
  };
}
