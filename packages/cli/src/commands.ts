// The commands of the `redlines` command line (design §8.3). Each takes the text of a file and what
// the command line said, and gives back what to print and, when the file changed, its new text. The
// file itself is read and written by `main.ts`.

import {
  EditError,
  UNTRUSTED_NOTE,
  accept,
  applyChanges,
  commentOnQuote,
  describeEdits,
  idsIn,
  newestView,
  newId,
  originalView,
  parse,
  reject,
  reply,
  reviewView,
  suggestReplace,
  warningNotes,
} from '@redlines/format';
import type { EditContext, Person, TextChange, TrackedEdits } from '@redlines/format';

/** A command line that can't be understood: an option or an argument is wrong or missing. */
export class UsageError extends Error {
  override name = 'UsageError';
}

/** What a command is given. */
export interface Input {
  /** The arguments after the file, in the order the command names them. */
  args: readonly string[];
  /** The options that were given. An option without a value, such as `--review`, has an empty one. */
  flags: ReadonlyMap<string, string>;
  now: Date;
}

/** What a command gives back. */
export interface Outcome {
  /** The new text of the file; absent when the command left it as it was. */
  text?: string;
  /** What the command prints. */
  output: string;
  /** Lines for stderr, which come before the output. */
  notes?: string[];
}

export interface Command {
  /** How the command is written after its name, for the usage text. */
  usage: string;
  /** The arguments after the file name. */
  args: readonly string[];
  /** The options that take a value. */
  flags: readonly string[];
  /** The options among them that hold a text, which can be given as a file instead: `--old` and
   * `--old-file`. */
  texts: readonly string[];
  /** The options that stand alone. */
  switches: readonly string[];
  run(text: string, input: Input): Outcome;
}

/** The value of an option the command can't do without. */
function need(input: Input, name: string): string {
  const value = input.flags.get(name);
  if (value === undefined) throw new UsageError(`Missing --${name}`);
  return value;
}

/** The value of an option that may be left out. An empty value counts as left out. */
function optional(input: Input, name: string): string | undefined {
  return input.flags.get(name) || undefined;
}

/** A time as the ledger has it: UTC, to the minute (format §2.4). */
function minute(date: Date): string {
  return `${date.toISOString().slice(0, 16)}Z`;
}

/** A handle uses lowercase letters, digits, `-` and `_`, starts with a letter, and is never a word
 * that YAML 1.1 readers turn into a boolean, nor `unknown` (format §2.4). */
const HANDLE = /^[a-z][a-z0-9_-]*$/;
const RESERVED = new Set(['y', 'n', 'yes', 'no', 'on', 'off', 'true', 'false', 'null', 'unknown']);

function handleOf(value: string): string {
  if (!HANDLE.test(value) || RESERVED.has(value)) {
    throw new EditError(
      `"${value}" can't be a handle. A handle uses lowercase letters, digits, - and _, starts with a letter, and isn't y, n, yes, no, on, off, true, false, null or unknown.`,
    );
  }
  return value;
}

/** An agent has a handle of its own for each person it works for (format §2.4): `claude-ada` is
 * Claude working for Ada. A handle that the file has for someone else can't be used for it. */
function checkAgent(people: readonly Person[], handle: string, person: string): void {
  const known = people.find((candidate) => candidate.handle === handle);
  const own = `An agent that works for "${person}" needs a handle of its own, such as claude-${person}.`;
  if (known && !known.agent) {
    throw new EditError(`"${handle}" is a person in this file, not an agent. ${own}`);
  }
  if (known?.for !== undefined && known.for !== person) {
    throw new EditError(
      `"${handle}" works for "${known.for}" in this file, not for "${person}". ${own}`,
    );
  }
}

/** Who makes the edit, and when. `--for` marks an agent that works for that person. */
function contextOf(text: string, input: Input): EditContext {
  const handle = handleOf(need(input, 'as'));
  const author: Person = { handle, name: optional(input, 'name') ?? handle };
  const person = optional(input, 'for');
  if (person !== undefined) {
    author.agent = true;
    author.for = handleOf(person);
    checkAgent(parse(text).ledger.people, handle, author.for);
  }
  return { author, time: minute(input.now), note: optional(input, 'note') };
}

/** The text of a comment or a reply, which can't be empty. */
function bodyOf(input: Input, what: 'comment' | 'reply'): string {
  const body = need(input, 'text');
  if (body.trim() === '') throw new EditError(`The ${what} is empty.`);
  return body;
}

function view(text: string, input: Input): Outcome {
  const review = input.flags.has('review');
  const original = input.flags.has('original');
  if (review && original) throw new UsageError('Use --review or --original, not both');
  const parsed = parse(text);
  // Every view says that the text is not from the agent's person: deleted text, comments and HTML
  // comments are hidden from people but not from agents, and a prompt injection hides there.
  const notes = [...warningNotes(parsed), UNTRUSTED_NOTE];
  if (review) return { output: reviewView(text), notes };
  return { output: original ? originalView(text).text : newestView(text).text, notes };
}

/**
 * One `str_replace` is compared word by word, so it can make several marks. They are one
 * suggestion, so they get a group of their own (format §6) and a person decides them together,
 * as the marks of an agent run in the app are. A single mark has none.
 */
function suggestAsOne(text: string, old: string, added: string, ctx: EditContext): TrackedEdits {
  const edits = suggestReplace(text, old, added, ctx);
  if (edits.markIds.length < 2) return edits;
  // An id that nothing in the file or in the new marks has.
  const taken = idsIn(applyChanges(text, edits.changes));
  for (;;) {
    const group = newId(taken);
    const grouped = suggestReplace(text, old, added, { ...ctx, group });
    if (!grouped.markIds.includes(group)) return grouped;
    taken.add(group);
  }
}

function strReplace(text: string, input: Input): Outcome {
  const { changes, markIds, extendedIds } = suggestAsOne(
    text,
    need(input, 'old'),
    need(input, 'new'),
    contextOf(text, input),
  );
  if (changes.length === 0) return { output: 'Suggested 0 changes.\n' };
  return {
    text: applyChanges(text, changes),
    output: `${describeEdits({ markIds, extendedIds }).join('\n')}\n`,
  };
}

function commentOn(text: string, input: Input): Outcome {
  const quote = need(input, 'quote');
  const body = bodyOf(input, 'comment');
  const { changes, id } = commentOnQuote(text, quote, body, contextOf(text, input));
  return { text: applyChanges(text, changes), output: `Added comment ${id}\n` };
}

function replyTo(text: string, input: Input): Outcome {
  const [thread = ''] = input.args;
  const changes = reply(text, thread, bodyOf(input, 'reply'), contextOf(text, input));
  return { text: applyChanges(text, changes), output: `Replied to ${thread}\n` };
}

/** A command that accepts or rejects the change with the id it is given. */
function decision(
  decide: (text: string, id: string) => TextChange[],
  done: string,
): (text: string, input: Input) => Outcome {
  return (text, input) => {
    const [id = ''] = input.args;
    return { text: applyChanges(text, decide(text, id)), output: `${done} ${id}\n` };
  };
}

export const COMMANDS: Record<string, Command> = {
  view: {
    usage: '<file> [--review | --original]',
    args: [],
    flags: [],
    texts: [],
    switches: ['review', 'original'],
    run: view,
  },
  'str-replace': {
    usage:
      '<file> (--old <text> | --old-file <path>) (--new <text> | --new-file <path>) --as <handle> [--name <name>] [--for <handle>] [--note <text>]',
    args: [],
    flags: ['old', 'new', 'as', 'name', 'for', 'note'],
    texts: ['old', 'new'],
    switches: [],
    run: strReplace,
  },
  comment: {
    usage:
      '<file> (--quote <text> | --quote-file <path>) (--text <text> | --text-file <path>) --as <handle> [--name <name>] [--for <handle>]',
    args: [],
    flags: ['quote', 'text', 'as', 'name', 'for'],
    texts: ['quote', 'text'],
    switches: [],
    run: commentOn,
  },
  reply: {
    usage:
      '<file> <thread> (--text <text> | --text-file <path>) --as <handle> [--name <name>] [--for <handle>]',
    args: ['thread'],
    flags: ['text', 'as', 'name', 'for'],
    texts: ['text'],
    switches: [],
    run: replyTo,
  },
  accept: {
    usage: '<file> <id>',
    args: ['id'],
    flags: [],
    texts: [],
    switches: [],
    run: decision(accept, 'Accepted'),
  },
  reject: {
    usage: '<file> <id>',
    args: ['id'],
    flags: [],
    texts: [],
    switches: [],
    run: decision(reject, 'Rejected'),
  },
};
