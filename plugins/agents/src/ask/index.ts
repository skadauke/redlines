// Ask (issue #324): select text, choose Ask, and type a question in a small box at the selection. The
// default agent answers in a bubble beside the selection, citing the passages it used; the @ picks
// another agent, as in a comment. Nothing is written to the file or its ledger: the agent reads and
// cannot write (session.ts), the bubble goes on Esc or a click elsewhere, and what the person keeps
// of an answer, as a comment, a document or text, is kept only when they ask (actions.ts).

import { EditorSelection } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { type Editor, viewModeField } from '@redlines/editor';
import { EditError } from '@redlines/format';
import { copyText, exchangeAsMarkdown, keepAsComment } from './actions.ts';
import { quoteFinder, selectionText } from './answer.ts';
import { type Bubble, createBubble } from './bubble.ts';
import { placeBubble } from './place.ts';
import { type AskDeps, type AskSession, createAskSession } from './session.ts';
import { askTheme } from './styles.ts';
import { askTarget, setTarget, targetOf } from './target.ts';

export { exchangeAsMarkdown, keepAsComment } from './actions.ts';
export { findQuote, parseAnswer, quoteFinder, selectionText } from './answer.ts';
export { createAskSession, EXPLAIN, askText } from './session.ts';
export type { AskDeps, AskSession, AskState, AskTurn } from './session.ts';

export interface AskOptions extends AskDeps {
  /** Shows a one-line message that doesn't interrupt, for what can't be done. */
  notice(message: string): void;
  /** Gives the question's field the @ picker, as a comment's box has. */
  attachToField?: (field: HTMLTextAreaElement) => () => void;
  /** Shows a comment thread's note, once Make Comment has made one. */
  showThread?: (thread: string) => boolean;
  /**
   * Opens `text`, Markdown, as an Untitled document in a new window. Without it, Open in New Window
   * is not offered.
   */
  openInNewWindow?: (text: string) => void;
  /** Puts text on the clipboard. Default: the page's own. */
  copy?: (text: string) => Promise<void> | void;
  /** Shows a failed run's log. */
  showLog?: (path: string) => void;
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

  /** The finder of the passages in the document as it is now, made once for each text. */
  let finder: { doc: typeof view.state.doc; find: ReturnType<typeof quoteFinder> } | null = null;
  const find = (quote: string) => {
    if (!finder || finder.doc !== view.state.doc) {
      finder = { doc: view.state.doc, find: quoteFinder(view.state.doc.toString()) };
    }
    return finder.find(quote);
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
      agentName: state.agent?.name ?? null,
      draft: state.turns.length > open.lastQuestion.answers ? '' : open.lastQuestion.text,
      canOpenWindow: options.openInNewWindow !== undefined,
    });
    place();
  };

  const place = () => {
    const range = targetOf(view.state);
    if (open && range) placeBubble(view, open.bubble.el, range);
  };

  const onKey = (event: KeyboardEvent) => {
    // Esc closes the bubble, unless something nearer the key took it: the @ picker, or a text box.
    if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
    event.preventDefault();
    close(true);
  };
  const onPress = (event: PointerEvent) => {
    if (open && event.target instanceof Node && !open.bubble.el.contains(event.target)) close();
  };

  function close(refocus = false): void {
    if (!open) return;
    const closing = open;
    open = null;
    closing.unsubscribe();
    closing.session.close();
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
    const agent = session?.state.agent;
    if (!open || !range || !agent || session.state.turns.length === 0) return;
    try {
      const thread = keepAsComment(editor, {
        range,
        turns: session.state.turns,
        agent,
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
      makeComment,
      openWindow: () => {
        const turns = session.state.turns;
        if (turns.length === 0) return;
        options.openInNewWindow?.(exchangeAsMarkdown(quote, turns));
        close(true);
      },
      copy: () => {
        const answer = session.state.turns.at(-1)?.answer;
        if (answer === undefined) return;
        void Promise.resolve((options.copy ?? copyText)(answer)).then(
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
    open = {
      session,
      bubble,
      quote,
      generation: options.document.generation(),
      lastQuestion: { text: '', answers: 0 },
      unsubscribe: session.subscribe(render),
    };
    doc.addEventListener('keydown', onKey);
    doc.addEventListener('pointerdown', onPress, true);
    win.addEventListener('resize', place);
    render();
    bubble.focusField();
    // The bubble comes into view with its field, where the text it is about is.
    bubble.el.scrollIntoView?.({ block: 'nearest' });
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
