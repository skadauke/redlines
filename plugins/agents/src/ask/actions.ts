// What an answer can be kept as (issue #324, "Keeping an answer"): a comment thread on the selection,
// a document of its own, or text on the clipboard. Nothing is kept unless the person asks.

import { ChangeSet } from '@codemirror/state';
import type { Author, Editor } from '@redlines/editor';
import { addComment, applyChanges, type EditContext, type Person, reply } from '@redlines/format';
import { fitReply, joinReply } from '@redlines/agent-tools';
import { agentHandle } from '../runs.ts';
import { EXPLAIN, type AskTurn } from './session.ts';

/** A time as the ledger writes it: UTC, to the minute. */
const ledgerTime = (date: Date) => `${date.toISOString().slice(0, 16)}Z`;

function personOf(author: Author): Person {
  const person: Person = { handle: author.handle, name: author.name };
  if (author.email !== undefined) person.email = author.email;
  if (author.agent !== undefined) person.agent = author.agent;
  if (author.for !== undefined) person.for = author.for;
  return person;
}

/** What a question says in a thread: what was typed, or what an empty one means. */
const questionText = (question: string) => (question.trim() === '' ? EXPLAIN : question.trim());

/**
 * An answer as an agent's reply is kept: its first paragraph, and the rest after a blank line, cut
 * to the limits that the toolbox puts on a reply (`fitReply`), as when an agent ends without one.
 */
function replyText(answer: string): string {
  const { text, details } = fitReply(answer);
  return joinReply(text, details);
}

/** An agent as the ledger knows it: `<agent>-<you>`, acting for the person who asked. */
function personOfAgent(agent: { id: string; name: string }, me: Author): Person {
  return {
    handle: agentHandle(agent.id, me.handle),
    name: agent.name,
    agent: true,
    for: me.handle,
  };
}

export interface KeepAsComment {
  /** What the questions are about: the range of the document, as the bubble tracked it. */
  range: { from: number; to: number };
  /** The exchange: each answer is written as the reply of the agent that gave it. */
  turns: readonly AskTurn[];
  author: Author;
  now?: () => Date;
}

/**
 * Makes a comment of the exchange, as one step to undo: the first question is the person's comment
 * on the range, its answer is the reply of the agent that gave it, in its name, and each follow-up
 * is a reply of the person's and an answer of the agent that gave it after it, which may be another
 * agent. Every agent that wrote a reply is among the people of the ledger, as in any thread. From
 * then on it is an ordinary thread. It is made without anything that would start a run: the agents
 * have answered.
 *
 * @returns the thread's id.
 * @throws EditError when the comment can't be anchored there (in code, in front matter), or the
 *   ledger can't be read.
 */
export function keepAsComment(editor: Editor, keep: KeepAsComment): string {
  const { view } = editor;
  const [first, ...rest] = keep.turns;
  if (!first) throw new Error('There is no answer to keep');
  const me = personOf(keep.author);
  const time = ledgerTime((keep.now ?? (() => new Date()))());
  const by = (author: Person): EditContext => ({ author, time });

  const start = view.state.doc.toString();
  let text = start;
  let total = ChangeSet.empty(start.length);
  const apply = (changes: { from: number; to: number; insert: string }[]) => {
    const step = ChangeSet.of(changes, text.length);
    total = total.compose(step);
    text = applyChanges(text, changes);
  };
  const made = addComment(text, keep.range, questionText(first.question), by(me));
  apply(made.changes);
  apply(reply(text, made.id, replyText(first.answer), by(personOfAgent(first.agent, keep.author))));
  for (const turn of rest) {
    apply(reply(text, made.id, questionText(turn.question), by(me)));
    apply(reply(text, made.id, replyText(turn.answer), by(personOfAgent(turn.agent, keep.author))));
  }
  // Not typing, so Track Changes leaves it alone; Undo takes the whole thread back at once.
  view.dispatch({ changes: total, userEvent: 'review.comment' });
  return made.id;
}

/** `text` on one line, for a title. */
const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();

/** The selected text as a block quote, cut short: it is a reminder, not the document. */
function quoted(quote: string): string {
  const shown = quote.length > 600 ? `${quote.slice(0, 600).trimEnd()}…` : quote;
  return shown
    .split(/\r\n?|\n/)
    .map((line) => `> ${line}`)
    .join('\n');
}

/** Text that is shown as the person's and the agent's, and no mark of a change or a comment. */
const plain = (text: string) => text.replaceAll('<!--', '&lt;!--');

/**
 * The exchange as a document of its own, for Open in New Window: the first question as its title,
 * the text it was about as a quote, the answer, and each follow-up with its answer under it. It is
 * Markdown, and never holds the markers of a change or a comment, even if the text the agent
 * quoted did.
 */
export function exchangeAsMarkdown(quote: string, turns: readonly AskTurn[]): string {
  const [first, ...rest] = turns;
  if (!first) return '';
  const parts = [
    `# ${plain(oneLine(questionText(first.question)))}`,
    plain(quoted(quote)),
    plain(first.answer.trim()),
  ];
  for (const turn of rest) {
    parts.push(`## ${plain(oneLine(questionText(turn.question)))}`, plain(turn.answer.trim()));
  }
  return `${parts.join('\n\n')}\n`;
}

/** Puts `text` on the clipboard, from a press of a button (a gesture the page's clipboard allows). */
export async function copyText(text: string): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const field = document.createElement('textarea');
  field.value = text;
  field.style.position = 'fixed';
  field.style.opacity = '0';
  document.body.append(field);
  field.select();
  const done = document.execCommand('copy');
  field.remove();
  if (!done) throw new Error("The page wouldn't copy");
}
