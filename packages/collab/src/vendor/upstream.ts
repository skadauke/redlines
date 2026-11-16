// The two functions of @codemirror/collab 6.1.1 that were changed, as upstream has them (MIT, see
// LICENSE), for the reproduction in collab.test.ts. Nothing else imports this.

import type { ChangeDesc, EditorState } from '@codemirror/state';
import type { ChangeSet } from '@codemirror/state';
import { StateEffect, Transaction } from '@codemirror/state';
import type { LoggedUpdate, Update } from './collab.ts';
import { collabConfig, collabField, collabReceive, CollabState, LocalUpdate } from './collab.ts';

export function upstreamReceiveUpdates(state: EditorState, updates: readonly Update[]) {
  const field = state.field(collabField);
  let unconfirmed: readonly LocalUpdate[] = field.unconfirmed;
  const { clientID } = state.facet(collabConfig);
  const version = field.version + updates.length;
  let effects: readonly StateEffect<unknown>[] = [];
  let changes: ChangeSet | null = null;
  let own = 0;
  for (const update of updates) {
    const ours = own < unconfirmed.length ? unconfirmed[own] : null;
    if (ours && ours.clientID === update.clientID) {
      if (changes) changes = changes.map(ours.changes, true);
      effects = StateEffect.mapEffects(effects, update.changes);
      own++;
    } else {
      effects = StateEffect.mapEffects(effects, update.changes);
      if (update.effects) effects = effects.concat(update.effects);
      changes = changes ? changes.compose(update.changes) : update.changes;
    }
  }
  if (own) unconfirmed = unconfirmed.slice(own);
  if (unconfirmed.length && changes) {
    let all: ChangeSet = changes;
    unconfirmed = unconfirmed.map((update) => {
      const updateChanges = update.changes.map(all);
      all = all.map(update.changes, true);
      return new LocalUpdate(
        update.origin,
        updateChanges,
        StateEffect.mapEffects(update.effects, all),
        clientID,
      );
    });
  }
  const next = new CollabState(version, unconfirmed);
  if (!changes) return state.update({ annotations: [collabReceive.of(next)] });
  return state.update({
    changes,
    effects: effects as StateEffect<unknown>[],
    annotations: [
      Transaction.addToHistory.of(false),
      Transaction.remote.of(true),
      collabReceive.of(next),
    ],
    filter: false,
  });
}

export function upstreamRebaseUpdates(
  updates: readonly Update[],
  over: readonly LoggedUpdate[],
): Update[] {
  if (!over.length || !updates.length) return updates.slice();
  let changes: ChangeDesc | null = null;
  let skip = 0;
  for (const update of over) {
    const other = skip < updates.length ? updates[skip] : null;
    if (other && other.clientID === update.clientID) {
      if (changes) changes = changes.mapDesc(other.changes, true);
      skip++;
    } else {
      changes = changes ? changes.composeDesc(update.changes) : update.changes;
    }
  }
  const rest = skip ? updates.slice(skip) : updates.slice();
  let all = changes;
  if (!all) return rest;
  return rest.map((update) => {
    const updateChanges = update.changes.map(all as ChangeDesc);
    all = (all as ChangeDesc).mapDesc(update.changes, true);
    return {
      changes: updateChanges,
      effects: update.effects && StateEffect.mapEffects(update.effects, all),
      clientID: update.clientID,
    };
  });
}
