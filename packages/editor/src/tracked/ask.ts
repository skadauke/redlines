// The alert (design: widen, alert or disable, §3): an edit that no mark can hold is asked about, and
// made without tracking when the person says so, as Word does. An edit in the YAML front matter, and
// typing in Raw while Track Changes is on, are the cases that never reach a widened replacement.
//
// The edit is held: the transaction filter swallows it and says what it was (`heldEditEffect`); the
// host's sheet asks; Make Edit applies the same edit again with the answer on it, which the filter
// lets through without tracking, if the document is still the one it was made against, and Cancel
// (or a document that changed) drops it. A key, a paste, a drop and a menu command are all one
// transaction and held alike; an input method's composition is held when it ends (`typing.ts`).

import {
  Annotation,
  type ChangeSet,
  type EditorSelection,
  type EditorState,
  Facet,
  StateEffect,
  StateField,
  type Text,
  type Transaction,
} from '@codemirror/state';
import { type EditorView, ViewPlugin } from '@codemirror/view';

/**
 * Why an edit is asked about: it can't be tracked (`front-matter`, `raw`), or, with Track Changes
 * off, it can't be made without accepting other changes first (`accept-pending`, design §3.4).
 */
export type UntrackedReason = 'front-matter' | 'raw' | 'accept-pending';

/** The title and buttons of the sheet are fixed; the detail line says why (design §3.1). */
export const UNTRACKED_TITLE = "This edit can't be tracked. Make it without tracking?";
export const UNTRACKED_DETAILS: Record<Exclude<UntrackedReason, 'accept-pending'>, string> = {
  'front-matter':
    "Front matter is data that other tools read, so Redlines can't mark a change in it.",
  raw: "Raw shows the file's own text, where Redlines can't mark changes.",
};

export type UntrackedAnswer = 'make' | 'cancel';

/**
 * The words of a question that is not one of the fixed two: its own title, no detail line, and no
 * "Don't ask again", since it decides other people's changes and is asked every time.
 */
export interface UntrackedWords {
  title: string;
}

/**
 * What the host gives for the alert. `ask` shows the sheet and answers; the host keeps "Don't ask
 * again in this document" itself, and `skip` says it is set, so that the edit is made at once.
 */
export interface UntrackedAsker {
  ask(reason: UntrackedReason, words?: UntrackedWords): Promise<UntrackedAnswer>;
  skip(reason: UntrackedReason): boolean;
}

export const untrackedAskFacet = Facet.define<UntrackedAsker, UntrackedAsker | null>({
  combine: (askers) => askers[0] ?? null,
});

/** An edit that waits for the answer: what it did, to the document it was made against. */
export interface HeldEdit {
  reason: UntrackedReason;
  /** Its own words, for `accept-pending`. */
  words?: UntrackedWords;
  doc: Text;
  changes: ChangeSet;
  selection: EditorSelection | undefined;
  annotations: readonly Annotation<unknown>[];
  scrollIntoView: boolean;
}

export const heldEditEffect = StateEffect.define<HeldEdit>();

/** Put on the edit that Make Edit makes: the filter lets it through without tracking. */
export const untrackedAnswerAnnotation = Annotation.define<boolean>();

/** How long an answer of Make Edit holds for the edits that follow in the same run (design §3.1). */
export const UNTRACKED_RUN_MS = 5000;

const ranEffect = StateEffect.define<{ reason: UntrackedReason; at: number }>();

/** The last Make Edit, so that typing a word in Raw is one alert, not one for each letter. */
export const untrackedRunField = StateField.define<{ reason: UntrackedReason; at: number } | null>({
  create: () => null,
  update(run, tr) {
    for (const effect of tr.effects) if (effect.is(ranEffect)) return effect.value;
    return run;
  },
});

/** Whether an edit of `reason` is made at once: the person chose "Don't ask again", or answered
 * Make Edit for this run not long ago. */
export function answeredAlready(state: EditorState, reason: UntrackedReason, now: number): boolean {
  const asker = state.facet(untrackedAskFacet);
  // Accepting what others proposed is asked every time: no answer stands for the next edit.
  if (!asker || reason === 'accept-pending') return false;
  if (asker.skip(reason)) return true;
  const run = state.field(untrackedRunField, false);
  return (
    run !== null && run !== undefined && run.reason === reason && now - run.at < UNTRACKED_RUN_MS
  );
}

/** The effect that records that an edit was made without tracking, which starts or keeps the run. */
export const runOf = (reason: UntrackedReason, at: number) => ranEffect.of({ reason, at });

/** The held edit of a transaction, as the filter swallows it. */
export function holdEdit(
  tr: Transaction,
  reason: UntrackedReason,
  annotations: readonly Annotation<unknown>[],
  words?: UntrackedWords,
): { effects: StateEffect<HeldEdit> } {
  return {
    effects: heldEditEffect.of({
      reason,
      ...(words ? { words } : {}),
      doc: tr.startState.doc,
      changes: tr.changes,
      selection: tr.selection,
      annotations,
      scrollIntoView: tr.scrollIntoView,
    }),
  };
}

/** Whether a transaction was held, which a key plan that has another form takes as a refusal. */
export const wasHeld = (tr: Transaction) => tr.effects.some((effect) => effect.is(heldEditEffect));

/** Asks, then makes the held edit without tracking, or drops it. One at a time: the sheet is modal. */
class Resolver {
  private waiting = false;
  private readonly queue: HeldEdit[] = [];

  private readonly view: EditorView;

  constructor(view: EditorView) {
    this.view = view;
  }

  take(held: HeldEdit): void {
    this.queue.push(held);
    // After the update that carried the effect: a plugin may not dispatch from inside one.
    queueMicrotask(() => void this.next());
  }

  private async next(): Promise<void> {
    if (this.waiting) return;
    const held = this.queue.shift();
    if (!held) return;
    this.waiting = true;
    try {
      const asker = this.view.state.facet(untrackedAskFacet);
      const answer = asker ? await asker.ask(held.reason, held.words) : 'cancel';
      const { view } = this;
      if (answer === 'make' && view.dom.isConnected) {
        // The sheet is modal, so the document is the one the edit was made against; if it isn't, the
        // edit would land somewhere else, and is dropped.
        if (view.state.doc.eq(held.doc)) {
          view.dispatch({
            changes: held.changes,
            selection: held.selection,
            annotations: [...held.annotations, untrackedAnswerAnnotation.of(true)],
            effects: held.reason === 'accept-pending' ? [] : runOf(held.reason, Date.now()),
            scrollIntoView: held.scrollIntoView,
          });
        }
      }
    } finally {
      this.waiting = false;
      this.queue.length = 0;
    }
  }
}

/** Takes the held edits that the filter and the composition's end make, and asks about them. */
export const untrackedAsking = ViewPlugin.fromClass(
  class {
    private readonly resolver: Resolver;
    constructor(view: EditorView) {
      this.resolver = new Resolver(view);
    }
    update(update: { transactions: readonly Transaction[] }): void {
      for (const tr of update.transactions) {
        for (const effect of tr.effects)
          if (effect.is(heldEditEffect)) this.resolver.take(effect.value);
      }
    }
  },
);

/** The annotations of a transaction, which CodeMirror reads by type and keeps in a list. */
export function annotationsOfTransaction(tr: Transaction): readonly Annotation<unknown>[] {
  return (tr as unknown as { annotations?: readonly Annotation<unknown>[] }).annotations ?? [];
}
