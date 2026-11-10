// Whose work a change is (design: Changes from outside). A change on disk that is nothing but the
// work of agents acting for the window's author, their suggestions, comments and replies, is a step
// that Undo takes back; anything else is a change from outside. The test compares both sides with
// those agents' work taken out: their threads deleted, their marks rejected, their replies, likes
// and people entries removed. What is left must be the same body, byte for byte, and ledgers that
// read the same as values.

import { applyChanges } from './changes.ts';
import { deleteThread } from './comments.ts';
import { rejectMarks } from './decide.ts';
import { EditError } from './errors.ts';
import { parse } from './parse.ts';
import type { Handle, Ledger, MarkRange, Parsed, Person, Thread } from './types.ts';

/** What others wrote in a thread of the agents': it must read the same on both sides. */
interface OthersPart {
  replies: Thread['replies'];
  likes: Thread['likes'];
  resolved?: Thread['resolved'];
}

/** A text with the agents' work taken out. */
interface WithoutWork {
  body: string;
  /** The ledger's marks, threads and settings, read from the text that is left. */
  ledger: Ledger;
  /** By thread id, for each thread of the agents'. */
  others: Map<string, OthersPart>;
  /** The marks of anyone else, as the text had them, with the agents' work still in. */
  marks: Map<string, string>;
  /** The people who aren't the agents, as the text had them. */
  people: Person[];
}

/**
 * The agents acting for `me` whose work alone turns `before` into `after` (design: Changes from
 * outside), named as people read them ("Claude", "Claude and Codex"), or null: for any change of
 * anyone else's, a plain character more, a setting changed, a mark of theirs that can't be
 * rejected, or a change in which nothing of theirs differs, as for a ledger only written again.
 * An agent is a person with `agent: true` and `for: me`. Its revision of its own suggestion and
 * its reply in a resolved thread, which reopens it, are its work; so is a change that only takes
 * its work back, whoever made it.
 */
export function agentWorkOf(before: string, after: string, me: Handle): { agent: string } | null {
  if (before === after) return null;
  const old = parse(before);
  const next = parse(after);
  const agents = new Set(
    [...old.ledger.people, ...next.ledger.people]
      .filter((person) => person.agent === true && person.for === me)
      .map((person) => person.handle),
  );
  if (agents.size === 0) return null;
  let left: WithoutWork;
  let right: WithoutWork;
  try {
    left = withoutWork(old, agents);
    right = withoutWork(next, agents);
  } catch (error) {
    if (error instanceof EditError) return null;
    throw error;
  }
  giveBackResolved(old, next, agents, right);
  if (left.body !== right.body) return null;
  if (canonical(ledgerValue(left)) !== canonical(ledgerValue(right))) return null;
  const changed = [...agents].filter(
    (handle) => canonical(workOf(old, handle)) !== canonical(workOf(next, handle)),
  );
  if (changed.length === 0) return null;
  return { agent: names(changed, next, old) };
}

/** `parsed` with the work of `agents` taken out. */
function withoutWork(parsed: Parsed, agents: ReadonlySet<Handle>): WithoutWork {
  const others = new Map<string, OthersPart>();
  let text = parsed.text;
  for (const thread of parsed.ledger.comments) {
    if (!agents.has(thread.by)) continue;
    const part = othersPart(thread, agents);
    if (!isEmptyPart(part)) others.set(thread.id, part);
    text = applyChanges(text, deleteThread(text, thread.id));
  }
  const theirs = (mark: MarkRange) => agents.has(mark.entry.by) && mark.kind !== 'cmt';
  const ids = parse(text)
    .marks.filter(theirs)
    .map((mark) => mark.id);
  if (ids.length > 0) text = applyChanges(text, rejectMarks(text, ids));
  const left = parse(text);
  const ledger: Ledger = structuredClone(left.ledger);
  ledger.people = [];
  for (const [id, entry] of Object.entries(ledger.marks)) {
    if (agents.has(entry.by)) delete ledger.marks[id];
  }
  ledger.comments = ledger.comments.map((thread) => ({
    ...thread,
    replies: thread.replies.filter((reply) => !agents.has(reply.by)),
    likes: thread.likes.filter((like) => !agents.has(like.by)),
  }));
  // The marks of anyone else, read in the text as it was: a mark of theirs inside an insertion of
  // the agents' goes with it when that is rejected, and must not change unseen.
  const marks = new Map<string, string>();
  for (const mark of parsed.marks) {
    if (agents.has(mark.entry.by)) continue;
    const content = mark.segments.map((segment) =>
      parsed.text.slice(segment.content.from, segment.content.to),
    );
    const inLeft = left.marks.some((kept) => kept.id === mark.id);
    marks.set(
      mark.id,
      canonical({
        kind: mark.kind,
        payload: mark.payload ?? null,
        entry: mark.entry,
        // A mark that is still there is compared by the body; one that went, by its text.
        content: inLeft ? null : content,
      }),
    );
  }
  return {
    body: text.slice(0, left.ledgerRange?.from ?? text.length),
    ledger,
    others,
    marks,
    // People aren't changed by taking work out, and a ledger left with nothing is not written.
    people: parsed.ledger.people.filter((person) => !agents.has(person.handle)),
  };
}

/** What anyone but `agents` wrote in `thread`. */
function othersPart(thread: Thread, agents: ReadonlySet<Handle>): OthersPart {
  const part: OthersPart = {
    replies: thread.replies.filter((reply) => !agents.has(reply.by)),
    likes: thread.likes.filter((like) => !agents.has(like.by)),
  };
  if (thread.resolved && !agents.has(thread.resolved.by)) part.resolved = thread.resolved;
  return part;
}

/** A thread of the agents' in which nobody else wrote: it counts for nothing. */
function isEmptyPart(part: OthersPart): boolean {
  return part.replies.length === 0 && part.likes.length === 0 && !part.resolved;
}

/**
 * A reply of the agents' in `after` that `before` hasn't, in a thread `before` has resolved and
 * `after` hasn't, reopened it: the thread gets `before`'s `resolved` back.
 */
function giveBackResolved(
  before: Parsed,
  after: Parsed,
  agents: ReadonlySet<Handle>,
  right: WithoutWork,
): void {
  for (const thread of after.ledger.comments) {
    const old = before.ledger.comments.find((candidate) => candidate.id === thread.id);
    if (!old?.resolved || thread.resolved) continue;
    const had = new Set(old.replies.map((reply) => reply.id));
    const reopened = thread.replies.some((reply) => agents.has(reply.by) && !had.has(reply.id));
    if (!reopened) continue;
    const resolved = old.resolved;
    if (!agents.has(resolved.by) && agents.has(thread.by)) {
      right.others.set(thread.id, { ...othersPart(thread, agents), resolved });
    }
    right.ledger.comments = right.ledger.comments.map((kept) =>
      kept.id === thread.id ? { ...kept, resolved } : kept,
    );
  }
}

/** What the two sides must agree on: by key, not by order or layout. */
function ledgerValue(side: WithoutWork): unknown {
  const { ledger } = side;
  return {
    version: ledger.version,
    tracking: ledger.tracking ?? null,
    history: ledger.history ?? null,
    extra: ledger.extra ?? {},
    people: Object.fromEntries(side.people.map((person) => [person.handle, person])),
    marks: ledger.marks,
    comments: Object.fromEntries(ledger.comments.map((thread) => [thread.id, thread])),
    others: Object.fromEntries(side.others),
    otherMarks: Object.fromEntries(side.marks),
  };
}

/** Everything of `handle`'s in a text: its marks with their text, its threads, replies and likes. */
function workOf(parsed: Parsed, handle: Handle): unknown {
  const { text, ledger } = parsed;
  const marks = parsed.marks
    .filter((mark) => mark.entry.by === handle)
    .map((mark) => ({
      id: mark.id,
      kind: mark.kind,
      payload: mark.payload ?? null,
      content: mark.segments.map((segment) => text.slice(segment.content.from, segment.content.to)),
    }));
  const entries = Object.entries(ledger.marks).filter(([, entry]) => entry.by === handle);
  const threads = ledger.comments.filter((thread) => thread.by === handle);
  const replies = ledger.comments.flatMap((thread) =>
    thread.replies.filter((reply) => reply.by === handle).map((reply) => [thread.id, reply]),
  );
  const likes = ledger.comments.flatMap((thread) =>
    thread.likes.filter((like) => like.by === handle).map((like) => [thread.id, like]),
  );
  return {
    marks: Object.fromEntries(marks.map((mark) => [mark.id, mark])),
    entries: Object.fromEntries(entries),
    threads: Object.fromEntries(threads.map((thread) => [thread.id, thread])),
    replies,
    likes,
  };
}

/** The names of `handles`, in the order of `after`'s people, then `before`'s: "Claude and Codex". */
function names(handles: readonly Handle[], after: Parsed, before: Parsed): string {
  const people = [...after.ledger.people, ...before.ledger.people];
  const order = (handle: Handle) => people.findIndex((person) => person.handle === handle);
  const named = handles
    .toSorted((a, b) => order(a) - order(b))
    .map((handle) => people[order(handle)]?.name ?? handle);
  const last = named.pop() ?? '';
  return named.length === 0 ? last : `${named.join(', ')} and ${last}`;
}

/** A value as JSON with every object's keys sorted, so that two values compare by key. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) => {
    if (inner === null || typeof inner !== 'object' || Array.isArray(inner)) return inner;
    return Object.fromEntries(
      Object.entries(inner as Record<string, unknown>).toSorted(([a], [b]) =>
        a < b ? -1 : a > b ? 1 : 0,
      ),
    );
  });
}
