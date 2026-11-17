// The oracle: what must hold after every confirmed state of a session.
//
// State checks, on every text a session confirms:
// - the markup and the ledger are valid: `parse` has no warnings, and the body reads, in
//   micromark, as the newest view does;
// - no text is duplicated, and every typed word still pending stands in a change of its author;
// - every comment and reply that was made is in the ledger once, in its thread.
//
// Event checks, on the step from one confirmed state to the next, which the Summary of the update
// says what it was meant to do:
// - nothing lost or swallowed: the words of the newest view are the ones before, plus the ones
//   typed, minus the ones deleted;
// - nothing left untracked: an edit that isn't a decision leaves the original view as it was, to
//   the character;
// - nothing revived: no deleted word comes back, and none that a decision removed;
// - a decision changes only its own mark: accepting leaves the newest view as it was, rejecting the
//   original view, and each moves only the words of its mark.
//
// Convergence is checked by the session: every copy has the text of the authority's version.

import { newestView, originalView, parse } from '@redlines/format';
import { readsAsNewest } from '@redlines/format/oracle';
import type { MarkRange } from '@redlines/format';
import type { Summary } from './intents.ts';
import {
  handleOfLetter,
  joined,
  newestTokens,
  originalTokens,
  tokenRanges,
  typistOf,
} from './text.ts';

export type Code =
  | 'markup'
  | 'render'
  | 'duplicated'
  /** Two words with no space between them in some view: the text is all there, but reads as one
   * word. Counted on its own, not as corruption. */
  | 'joined'
  | 'lost'
  | 'swallowed'
  | 'dropped'
  | 'revived'
  | 'untracked'
  | 'misattributed'
  | 'decision'
  | 'ledger'
  | 'diverged'
  | 'stuck'
  | 'crash';

/** Violations that mean the markup, as other people saw it, was invalid, as against text that was
 * lost or misplaced. */
export const INVALID_MARKUP: ReadonlySet<Code> = new Set(['markup', 'render']);

export interface Violation {
  version: number;
  code: Code;
  detail: string;
}

export interface OracleOptions {
  /** Also check that the body reads as the newest view does (micromark). */
  render: boolean;
}

const keys = (m: Map<string, number>): Set<string> => new Set(m.keys());

function difference(a: Set<string>, b: Set<string>): string[] {
  return [...a].filter((x) => !b.has(x));
}

export class Oracle {
  /** The comments made, by their text, and the replies to each. */
  private readonly threads = new Map<string, { by: string; replies: Map<string, string> }>();
  private readonly decided = new Set<string>();

  private readonly options: OracleOptions;

  constructor(options: OracleOptions) {
    this.options = options;
  }

  /** The checks of the step from `before` to `after`, the `version`th. */
  step(version: number, before: string, after: string, summary: Summary): Violation[] {
    const found: Violation[] = [];
    const add = (code: Code, detail: string) => found.push({ version, code, detail });

    if (summary.kind === 'comment' && summary.note) {
      this.threads.set(summary.note, { by: summary.author, replies: new Map() });
    }
    if (summary.kind === 'reply' && summary.note && summary.replyBody) {
      this.threads.get(summary.note)?.replies.set(summary.replyBody, summary.author);
    }
    if (summary.mark) this.decided.add(summary.mark.id);

    const preN = keys(newestTokens(before));
    const postN = keys(newestTokens(after));
    const preO = keys(originalTokens(before));
    const postO = keys(originalTokens(after));
    const adds = new Set(summary.adds);
    const removes = new Set(summary.removes);

    if (summary.kind === 'decide') {
      const mark = summary.mark;
      if (summary.decision === 'accept') {
        if (newestView(before).text !== newestView(after).text) {
          add('decision', 'accepting changed the newest view');
        }
        const gained = difference(postO, preO).filter((t) => !mark?.ins.includes(t));
        const lost = difference(preO, postO).filter((t) => !mark?.old.includes(t));
        if (gained.length > 0) add('decision', `accepting added to the original: ${gained.join()}`);
        if (lost.length > 0) add('decision', `accepting took from the original: ${lost.join()}`);
      } else {
        if (originalView(before).text !== originalView(after).text) {
          add('decision', 'rejecting changed the original view');
        }
        const gained = difference(postN, preN).filter((t) => !mark?.old.includes(t));
        const lost = difference(preN, postN).filter((t) => !mark?.ins.includes(t));
        if (gained.length > 0) add('decision', `rejecting brought back: ${gained.join()}`);
        if (lost.length > 0) add('decision', `rejecting took from the newest: ${lost.join()}`);
      }
      return found;
    }

    // The newest view: before, plus typed, minus deleted.
    for (const t of preN) {
      if (removes.has(t) || postN.has(t)) continue;
      add(summary.kind === 'delete' || summary.kind === 'sub' ? 'swallowed' : 'lost', t);
    }
    for (const t of adds) if (!postN.has(t)) add('lost', `typed ${t}`);
    for (const t of postN) {
      if (preN.has(t) || adds.has(t)) continue;
      add('revived', t);
    }
    for (const t of removes) if (postN.has(t)) add('dropped', `still there: ${t}`);

    // The original view doesn't change under an edit.
    if (originalView(before).text !== originalView(after).text) {
      const gained = difference(postO, preO);
      const lost = difference(preO, postO);
      add('untracked', `original changed; gained ${gained.join()}, lost ${lost.join()}`);
    }
    return found;
  }

  /** The checks of one confirmed text, whatever step made it. */
  state(version: number, text: string): Violation[] {
    const found: Violation[] = [];
    const add = (code: Code, detail: string) => found.push({ version, code, detail });
    const parsed = parse(text);
    for (const warning of parsed.warnings) add('markup', `${warning.code}: ${warning.message}`);
    if (this.options.render) {
      let reads = true;
      try {
        reads = readsAsNewest(text);
      } catch (error) {
        add('render', `the check threw: ${(error as Error).message}`);
      }
      if (!reads) add('render', 'the body does not read as the newest view does');
    }

    const newest = newestView(text).text;
    for (const [view, name] of [
      [newest, 'newest'],
      [originalView(text).text, 'original'],
    ] as const) {
      const seen = new Set<string>();
      for (const { token } of tokenRanges(view)) {
        if (seen.has(token)) add('duplicated', `${token} twice in the ${name} view`);
        seen.add(token);
      }
      for (const pair of joined(view))
        add('joined', `${pair} read as one word in the ${name} view`);
    }
    for (const id of this.decided) {
      if (parsed.marks.some((m) => m.id === id)) add('revived', `decided mark ${id} is back`);
    }
    for (const found2 of misattributed(text, parsed.marks)) add('misattributed', found2);

    for (const [note, thread] of this.threads) {
      const entries = parsed.ledger.comments.filter((c) => c.text === note);
      if (entries.length !== 1) {
        add('ledger', `thread ${note} is in the ledger ${entries.length} times`);
        continue;
      }
      const entry = entries[0];
      if (!entry) continue;
      if (entry.by !== thread.by) add('misattributed', `thread ${note} is by ${entry.by}`);
      for (const [body, by] of thread.replies) {
        const matches = entry.replies.filter((r) => r.text === body);
        if (matches.length !== 1)
          add('ledger', `reply ${body} is in its thread ${matches.length} times`);
        else if (matches[0]?.by !== by)
          add('misattributed', `reply ${body} is by ${matches[0]?.by}`);
      }
      if (entry.replies.length !== thread.replies.size) {
        add(
          'ledger',
          `thread ${note} has ${entry.replies.length} replies, not ${thread.replies.size}`,
        );
      }
    }
    return found;
  }
}

/** Typed words that are still pending, and stand in a change of someone else. */
function misattributed(text: string, marks: readonly MarkRange[]): string[] {
  const out: string[] = [];
  // Where the old text of a deletion is written, which is no text of the document.
  const old = marks
    .filter((m) => m.kind === 'del' || m.kind === 'sub')
    .flatMap((m) => m.segments.map((s) => s.open));
  const insertions = marks
    .filter((m) => m.kind === 'ins' || m.kind === 'sub')
    .flatMap((m) => m.segments.map((s) => ({ ...s.content, by: m.entry.by })));
  for (const { token, from } of tokenRanges(text)) {
    const typist = typistOf(token);
    if (!typist || old.some((r) => from >= r.from && from < r.to)) continue;
    const inside = insertions
      .filter((r) => from >= r.from && from < r.to)
      .sort((a, b) => a.to - a.from - (b.to - b.from))[0];
    if (!inside) continue;
    const want = handleOfLetter(typist);
    if (inside.by !== want) out.push(`${token} typed by ${want}, in ${inside.by}'s change`);
  }
  return out;
}
