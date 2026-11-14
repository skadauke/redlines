// Ask (issue #324): select text, choose Ask, and type a question in a small box at the selection. The
// default agent answers in a bubble beside the selection, citing the passages it used; the @ picks
// another agent, as in a comment. Nothing is written to the file or its ledger: the agent is given
// tools that read, and the document it reads refuses a write (session.ts); the bubble goes on Esc or
// a click elsewhere, and what the person keeps of an answer, as a comment, a document or text, is
// kept only when they ask (actions.ts).

import { EditorSelection } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { type Editor, viewModeField } from '@redlines/editor';
import { EditError } from '@redlines/format';
import type { PinnedElement } from '@redlines/review';
import { copyText, exchangeAsMarkdown, keepAsComment } from './actions.ts';
import { quoteFinder, selectionText } from './answer.ts';
import { type Bubble, createBubble } from './bubble.ts';
import { placeBubble } from './place.ts';
import { type AskDeps, type AskSession, createAskSession } from './session.ts';
import { askTheme, RAILED } from './styles.ts';
import { askTarget, setTarget, targetOf } from './target.ts';

export { exchangeAsMarkdown, keepAsComment } from './actions.ts';
export { findQuote, parseAnswer, quoteFinder, selectionText } from './answer.ts';
export { createAskSession, EXPLAIN, askText } from './session.ts';
export type { AskDeps, AskSession, AskState, AskTurn } from './session.ts';

export interface AskOptions extends AskDeps {
  /** Shows a one-line message that doesn't interrupt, for what can't be done. */
  notice(message: string): void;
  /**
   * Has the comment rail lay the bubble out among its notes, level with the start of the text asked
   * about (`anchor`, a position that follows the text), as it does a new comment's box: the notes
   * around the bubble go up or down to clear it, so that none is hidden. The bubble stays Ask's own
   * element, in the editor's scroller, made, filled and removed by Ask; the rail sets only its
   * `left` and `top`. Returns null where the rail shows no notes in full (a narrow window, Clean,
   * a document with no comments): Ask places the bubble itself then, beside the column or under the
   * selection, over the page. `lost` is called, once, when a rail that held the bubble stops (the
   * window turned narrow): Ask places the bubble itself again at once, asking the rail first, and
   * asks it each time it places the bubble after that (when the text, the layout or the window
   * changes), which is when a rail that is whole again takes the bubble back. Without it, Ask
   * always places the bubble itself. What the rail returns is the review interface's
   * `PinnedElement`.
   */
  pinToRail?: (el: HTMLElement, anchor: () => number, lost: () => void) => PinnedElement | null;
  /** Gives the question's field the @ picker, as a comment's box has. */
  attachToField?: (field: HTMLTextAreaElement) => () => void;
  /** Shows a comment thread's note, once Make Comment has made one. */
  showThread?: (thread: string) => boolean;
  /**
   * Opens `text`, Markdown, as an Untitled document in a new window. Without it, Open in New Window
   * is not offered. The bubble goes once the window is open; if this rejects, it stays, and says
   * so in a notice.
   */
  openInNewWindow?: (text: string) => void | Promise<void>;
  /** Puts text on the clipboard. Default: the page's own. */
  copy?: (text: string) => Promise<void> | void;
  /** Shows a failed run's log. */
  showLog?: (path: string) => void;
  /**
   * Opens Preferences › Agents, where an agent is updated or signed in: what a failed line offers
   * when Preferences can put the failure right. Without it, such a failure offers no way there.
   */
  openPreferences?: () => void;
}

export interface Ask {
  /**
   * Opens the box for a question about the selection, or the word under the caret, and puts the
   * keyboard in it. Returns false when it can't: nothing to ask about, or Raw, which shows markers
   * that no answer could be about; the editor's `onNotice`-style message says why.
   */
  start(): boolean;
  /** Puts the bubble away. */
  close(): void;
  isOpen(): boolean;
  /** Takes the command and the bubble out of the editor. */
  destroy(): void;
}

const RAW = 'Ask works on the text as it reads. Show Clean or Redlines first.';
const NOTHING = 'Select some text to ask about.';

/** A note in the comment rail: the review interface's own classes (`rl-rail` holds the notes). */
const RAIL_NOTE = '.rl-rail .rl-note';

/**
 * How long the bubble waits, after a press in one of the rail's notes, for the click that press
 * makes, before it closes anyway: a press that is dragged, or that the page takes for a scroll,
 * may never click. A press held longer than this closes it too.
 */
const CLICK_WAIT_MS = 1500;

/** The most characters of the selected text the agent is told; it can read the document for the rest. */
const QUOTE_LIMIT = 2000;

/** `quote` cut for the prompt, at a word, with an ellipsis. */
function capped(quote: string): string {
  if (quote.length <= QUOTE_LIMIT) return quote;
  const cut = quote.slice(0, QUOTE_LIMIT);
  const space = cut.lastIndexOf(' ');
  return `${(space > QUOTE_LIMIT / 2 ? cut.slice(0, space) : cut).trimEnd()} …`;
}

/** One open question. */
interface Open {
  session: AskSession;
  bubble: Bubble;
  quote: string;
  generation: number;
  /**
   * What was typed last, and how many answers the session had then: it comes back into the field
   * after a stop or a failure, and not after an answer.
   */
  lastQuestion: { text: string; answers: number };
  /** Whether a new window is being opened for it, so that a second press waits for that. */
  opening: boolean;
  /** The rail's hold on the bubble, while the rail lays it out among its notes. */
  pin: PinnedElement | null;
  unsubscribe: () => void;
}

/**
 * Adds Ask to an editor: the command Ask… (⌥⌘A, in the Format menu beside Add Comment) and the
 * bubble it opens. Register it where the Format menu lists it, after the review interface, and
 * before the menus are drawn.
 */
export function createAsk(editor: Editor, options: AskOptions): Ask {
  const { view } = editor;
  const doc = view.dom.ownerDocument;
  const win = doc.defaultView ?? window;
  let open: Open | null = null;
  /** Takes away what waits for a click to close the bubble (`closeAfterClick`), if anything does. */
  let stopWaiting: (() => void) | null = null;

  /** The finder of the passages in the document as it is now, made once for each text. */
  let finder: { doc: typeof view.state.doc; find: ReturnType<typeof quoteFinder> } | null = null;
  /** Where `quote` is: of several places, the one nearest the text the question is about. */
  const find = (quote: string) => {
    if (!finder || finder.doc !== view.state.doc) {
      finder = { doc: view.state.doc, find: quoteFinder(view.state.doc.toString()) };
    }
    return finder.find(quote, targetOf(view.state)?.from);
  };

  const rangeOf = (): { from: number; to: number } | null => {
    const { main } = view.state.selection;
    if (!main.empty) return { from: main.from, to: main.to };
    const word = view.state.wordAt(main.head);
    return word ? { from: word.from, to: word.to } : null;
  };

  /** What the open bubble shows: the session's state, drawn, and the bubble put in its place. */
  const render = () => {
    if (!open) return;
    const { state } = open.session;
    open.bubble.render({
      turns: state.turns,
      pending: state.pending,
      line: state.line,
      draft: state.turns.length > open.lastQuestion.answers ? '' : open.lastQuestion.text,
      canOpenWindow: options.openInNewWindow !== undefined,
    });
    place();
  };

  /**
   * Whether `place` is running, and whether it was asked to run again meanwhile. Placing the bubble
   * reads the layout, which makes the editor run the measure that waits, and the editor's update
   * listeners after it, among them this one: it would find the rail ready, hold the bubble with it,
   * and the placing that was under way would then write its own place over the rail's.
   */
  let placing = false;
  let placeAgain = false;

  /** Places the bubble: the rail lays it out among its notes, or it hangs by the selection. */
  const placeOnce = () => {
    const range = targetOf(view.state);
    if (!open || !range) return;
    // The rail lays out what it holds, among its notes, and is told that the bubble changed.
    if (open.pin) return open.pin.resized();
    const mine = open;
    const pin = options.pinToRail?.(
      mine.bubble.el,
      () => targetOf(view.state)?.from ?? range.from,
      () => {
        // The rail stopped showing its notes in full: the bubble hangs by the selection again.
        if (open !== mine || !mine.pin) return;
        mine.pin = null;
        mine.bubble.el.classList.remove(RAILED);
        place();
      },
    );
    if (!pin) return placeBubble(view, mine.bubble.el, range);
    mine.pin = pin;
    mine.bubble.el.classList.add(RAILED);
  };

  const place = () => {
    if (placing) {
      placeAgain = true;
      return;
    }
    placing = true;
    try {
      // Again while a call in the middle of it said so, for what it did may have changed what is
      // right now: a few times at the most.
      for (let round = 0; round < 3; round++) {
        placeAgain = false;
        placeOnce();
        if (!placeAgain) break;
      }
    } finally {
      placing = false;
      placeAgain = false;
    }
  };

  const onKey = (event: KeyboardEvent) => {
    // Esc closes the bubble, unless something nearer the key took it: the @ picker, or a text box.
    if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
    event.preventDefault();
    close(true);
  };
  /**
   * Closes the bubble once the click that a press has made is delivered, and not at the press. A
   * bubble the rail lays out has the notes around it make room, and when it goes they slide back to
   * their places within a moment (180 ms): closed at the press, it would leave the press, on Reply,
   * Resolve, Accept or Reject of a note that had been pushed aside, ending over another element,
   * and the click would go nowhere. The click is heard here first (the listener is the document's,
   * in the capture phase, so that a note that stops the click doesn't keep it from the bubble),
   * and the bubble goes in a task of its own after it, when the note has heard it. A press that
   * makes no click closes it after a while.
   */
  const closeAfterClick = (mine: Open) => {
    stopWaiting?.();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const closeNow = () => {
      stopWaiting?.();
      if (open === mine) close();
    };
    const clicked = () => {
      clearTimeout(timer);
      timer = setTimeout(closeNow, 0);
    };
    doc.addEventListener('click', clicked, { capture: true, once: true });
    timer = setTimeout(closeNow, CLICK_WAIT_MS);
    stopWaiting = () => {
      clearTimeout(timer);
      doc.removeEventListener('click', clicked, true);
      stopWaiting = null;
    };
  };

  const onPress = (event: PointerEvent) => {
    const { target } = event;
    if (!open || !(target instanceof Node)) return;
    // The person went back to the bubble: whatever waited for a click leaves it open.
    if (open.bubble.el.contains(target)) return stopWaiting?.();
    // In one of the rail's notes the bubble waits for the click, if the rail holds it: it is the
    // bubble's going that moves the notes. Not held, it moves none, and goes at once.
    if (open.pin && target instanceof Element && target.closest(RAIL_NOTE)) closeAfterClick(open);
    else close();
  };

  function close(refocus = false): void {
    if (!open) return;
    const closing = open;
    open = null;
    stopWaiting?.();
    closing.unsubscribe();
    closing.session.close();
    // The notes go back to their places, if the rail had made room for the bubble.
    closing.pin?.release();
    closing.bubble.destroy();
    doc.removeEventListener('keydown', onKey);
    doc.removeEventListener('pointerdown', onPress, true);
    win.removeEventListener('resize', place);
    if (view.state.field(askTarget, false)) view.dispatch({ effects: setTarget.of(null) });
    if (refocus) view.focus();
  }

  /** Keeps the exchange as a comment on the text it was about. */
  const makeComment = () => {
    const range = targetOf(view.state);
    const { session } = open ?? {};
    if (!open || !range || !session || session.state.turns.length === 0) return;
    try {
      const thread = keepAsComment(editor, {
        range,
        turns: session.state.turns,
        author: options.author,
      });
      close(true);
      options.showThread?.(thread);
    } catch (error) {
      if (!(error instanceof EditError)) throw error;
      options.notice(error.message);
    }
  };

  const start = (): boolean => {
    if (view.state.field(viewModeField) === 'raw') {
      options.notice(RAW);
      return false;
    }
    const range = rangeOf();
    const quote = range ? selectionText(view.state.doc.toString(), range).trim() : '';
    if (!range || quote === '') {
      options.notice(NOTHING);
      return false;
    }
    close();
    const session = createAskSession(options, { quote: capped(quote) });
    const bubble = createBubble({
      submit: (text) => {
        if (open) open.lastQuestion = { text, answers: session.state.turns.length };
        session.ask(text);
      },
      close: () => close(true),
      stop: () => session.stop(),
      consent: (answer) => session.answerConsent(answer),
      dismiss: () => session.dismiss(),
      ...(options.showLog ? { showLog: options.showLog } : {}),
      ...(options.openPreferences ? { openPreferences: options.openPreferences } : {}),
      makeComment,
      openWindow: () => {
        const turns = session.state.turns;
        const mine = open;
        if (!mine || turns.length === 0 || mine.opening) return;
        const text = exchangeAsMarkdown(quote, turns);
        mine.opening = true;
        // The window may take a moment, and may not open: the exchange stays until it has.
        void new Promise<void>((resolve) => resolve(options.openInNewWindow?.(text)))
          .then(
            () => {
              if (open === mine) close(true);
            },
            () => options.notice('Couldn’t open a new window.'),
          )
          .finally(() => {
            mine.opening = false;
          });
      },
      copy: () => {
        const answer = session.state.turns.at(-1)?.answer;
        if (answer === undefined) return;
        void new Promise<void>((resolve) => resolve((options.copy ?? copyText)(answer))).then(
          () => options.notice('Copied the answer.'),
          () => options.notice('Couldn’t copy the answer.'),
        );
      },
      has: (text) => find(text) !== null,
      show: (text) => {
        const found = find(text);
        if (!found) {
          options.notice('That passage is no longer in the document.');
          return;
        }
        const selection = EditorSelection.range(found.from, found.to);
        view.dispatch({
          selection,
          effects: EditorView.scrollIntoView(selection, { y: 'center' }),
          userEvent: 'select.citation',
        });
      },
      resized: place,
      ...(options.attachToField ? { attachToField: options.attachToField } : {}),
      focusDocument: () => view.focus(),
    });
    view.scrollDOM.append(bubble.el);
    view.dispatch({ effects: setTarget.of(range) });
    const opened: Open = {
      session,
      bubble,
      quote,
      generation: options.document.generation(),
      lastQuestion: { text: '', answers: 0 },
      opening: false,
      pin: null,
      unsubscribe: session.subscribe(render),
    };
    open = opened;
    doc.addEventListener('keydown', onKey);
    doc.addEventListener('pointerdown', onPress, true);
    win.addEventListener('resize', place);
    render();
    // A bubble the rail lays out is placed a moment from now, and not where it is yet: the keyboard
    // goes to its field without scrolling there, and the rail scrolls once it has placed it.
    bubble.focusField(opened.pin ? { preventScroll: true } : undefined);
    // The bubble comes into view with its field, where the text it is about is.
    if (opened.pin) opened.pin.reveal();
    else bubble.el.scrollIntoView?.({ block: 'nearest' });
    return true;
  };

  const removeExtension = editor.addExtension([
    askTarget,
    askTheme,
    EditorView.updateListener.of((update) => {
      if (!open) return;
      // Another document took this one's place: its questions are about text that is gone.
      if (options.document.generation() !== open.generation) return close();
      // The target went with its text, or the layout moved: the bubble keeps up.
      if (!targetOf(update.state)) return close();
      if (update.docChanged || update.geometryChanged || update.viewportChanged) place();
    }),
  ]);
  const removeCommand = editor.commands.register([
    {
      id: 'ask.start',
      title: 'Ask…',
      shortcut: 'Mod-Alt-a',
      menu: 'format',
      group: 'comment',
      // The question's own box is a field: choosing Ask again, from the menu, asks about the new
      // selection, whoever has the keyboard.
      runsInFields: true,
      run: start,
    },
  ]);

  return {
    start,
    close: () => close(),
    isOpen: () => open !== null,
    destroy() {
      close();
      removeCommand();
      removeExtension();
    },
  };
}
