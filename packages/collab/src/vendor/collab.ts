// @codemirror/collab 6.1.1, MIT (Copyright (C) 2018-2021 by Marijn Haverbeke and others; see
// LICENSE). Rewritten as TypeScript from the published dist, with one fix: updates are rebased and
// received one at a time (see README.md).

import type { ChangeDesc, EditorState, Extension, Transaction as Tr } from '@codemirror/state';
import {
  Annotation,
  ChangeSet,
  combineConfig,
  Facet,
  StateEffect,
  StateField,
  Transaction,
} from '@codemirror/state';

/** An update as the authority logs it: a change, the effects shared with it, and who made it. */
export interface Update {
  changes: ChangeSet;
  effects?: readonly StateEffect<unknown>[];
  clientID: string;
}

/** An update known by its change description only (what an authority's log needs to keep). */
export interface LoggedUpdate {
  changes: ChangeDesc;
  clientID: string;
}

export class LocalUpdate implements Update {
  readonly origin: Tr;
  readonly changes: ChangeSet;
  readonly effects: readonly StateEffect<unknown>[];
  readonly clientID: string;
  constructor(
    origin: Tr,
    changes: ChangeSet,
    effects: readonly StateEffect<unknown>[],
    clientID: string,
  ) {
    this.origin = origin;
    this.changes = changes;
    this.effects = effects;
    this.clientID = clientID;
  }
}

export class CollabState {
  // The version up to which changes have been confirmed.
  readonly version: number;
  // The local updates that haven't been successfully sent to the authority yet.
  readonly unconfirmed: readonly LocalUpdate[];
  constructor(version: number, unconfirmed: readonly LocalUpdate[]) {
    this.version = version;
    this.unconfirmed = unconfirmed;
  }
}

interface CollabConfig {
  startVersion: number;
  clientID: string | null;
  sharedEffects: (tr: Tr) => readonly StateEffect<unknown>[];
  generatedID?: string;
}

export const collabConfig = Facet.define<CollabConfig, CollabConfig & { clientID: string }>({
  combine(configs) {
    const combined = combineConfig<CollabConfig>(
      configs,
      { startVersion: 0, clientID: null, sharedEffects: () => [] },
      { generatedID: (a: unknown) => a } as never,
    );
    const first = configs[0];
    return { ...combined, clientID: combined.clientID ?? (first && first.generatedID) ?? '' };
  },
});

export const collabReceive = Annotation.define<CollabState>();

export const collabField = StateField.define<CollabState>({
  create(state) {
    return new CollabState(state.facet(collabConfig).startVersion, []);
  },
  update(collab, tr) {
    const isSync = tr.annotation(collabReceive);
    if (isSync) return isSync;
    const { sharedEffects, clientID } = tr.startState.facet(collabConfig);
    const effects = sharedEffects(tr);
    if (effects.length || !tr.changes.empty) {
      return new CollabState(
        collab.version,
        collab.unconfirmed.concat(new LocalUpdate(tr, tr.changes, effects, clientID)),
      );
    }
    return collab;
  },
});

let idCounter = 0;

/** Create an instance of the collaborative editing plugin. */
export function collab(config: Partial<CollabConfig> = {}): Extension {
  const generatedID = (Math.floor(Math.random() * 1e9) + idCounter++).toString(36);
  return [
    collabField,
    collabConfig.of({
      startVersion: 0,
      clientID: null,
      sharedEffects: () => [],
      generatedID,
      ...config,
    }),
  ];
}

/**
 * Create a transaction that represents a set of new updates received from the authority. Applying
 * it moves the state forward to the authority's view of the document.
 *
 * Upstream composed every remote change into one and mapped the unconfirmed updates over that. Here
 * each received update is taken in turn: the unconfirmed updates are mapped over it, and it is
 * mapped over them, before the next one is looked at.
 */
export function receiveUpdates(state: EditorState, updates: readonly Update[]) {
  const field = state.field(collabField);
  const { clientID } = state.facet(collabConfig);
  const version = field.version + updates.length;
  let unconfirmed: readonly LocalUpdate[] = field.unconfirmed;
  let effects: readonly StateEffect<unknown>[] = [];
  // What to apply to the document, in steps that follow each other.
  let changes: ChangeSet | null = null;
  for (const update of updates) {
    const ours = unconfirmed[0];
    effects = StateEffect.mapEffects(effects, update.changes);
    if (ours && ours.clientID === update.clientID) {
      // Confirmed: the document already holds it, and the updates after it are based on it.
      unconfirmed = unconfirmed.slice(1);
      continue;
    }
    if (update.effects) effects = effects.concat(update.effects);
    let remote: ChangeSet = update.changes;
    unconfirmed = unconfirmed.map((local) => {
      const mapped = local.changes.map(remote);
      remote = remote.map(local.changes, true);
      return new LocalUpdate(
        local.origin,
        mapped,
        StateEffect.mapEffects(local.effects, remote),
        clientID,
      );
    });
    changes = changes ? changes.compose(remote) : remote;
  }
  const first = unconfirmed[0];
  if (first && effects.length) {
    const composed = unconfirmed.reduce(
      (ch, u) => ch.compose(u.changes),
      ChangeSet.empty(first.changes.length),
    );
    effects = StateEffect.mapEffects(effects, composed);
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

/**
 * The locally made updates that still have to be sent to the authority. Each has an `origin` that
 * points at the transaction that made it (the update may have been mapped since).
 */
export function sendableUpdates(state: EditorState): readonly LocalUpdate[] {
  return state.field(collabField).unconfirmed;
}

/** The version up to which the plugin has synced with the authority. */
export function getSyncedVersion(state: EditorState): number {
  return state.field(collabField).version;
}

/** This editor's collaborative editing client ID. */
export function getClientID(state: EditorState): string {
  return state.facet(collabConfig).clientID;
}

/**
 * Rebase and deduplicate client-submitted updates that came in with an out-of-date version number.
 * `over` holds the updates accepted since that version. The result has the updates that were already
 * accepted filtered out, and the rest moved over the others, so that they apply to the current
 * version.
 *
 * Upstream composed `over` into one change. Here each logged update is taken in turn, which is how
 * a client receives them.
 */
export function rebaseUpdates(updates: readonly Update[], over: readonly LoggedUpdate[]): Update[] {
  if (!over.length || !updates.length) return updates.slice();
  let pending: Update[] = updates.slice();
  for (const logged of over) {
    if (!pending.length) break;
    const head = pending[0];
    if (head && head.clientID === logged.clientID) {
      pending = pending.slice(1);
      continue;
    }
    let changes: ChangeDesc = logged.changes;
    pending = pending.map((update) => {
      const mapped = update.changes.map(changes);
      changes = changes.mapDesc(update.changes, true);
      return {
        changes: mapped,
        effects: update.effects && StateEffect.mapEffects(update.effects, changes),
        clientID: update.clientID,
      };
    });
  }
  return pending;
}
