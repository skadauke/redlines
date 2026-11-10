// The undo history: a copy of the history half of @codemirror/commands 6.11.1, from `fromHistory`
// to `historyKeymap`, in TypeScript. Redlines keeps its own so that its steps can have an owner
// (docs/superpowers/specs/2026-11-10-agents-undo-and-allow-design.md, A history of our own). It
// reads CodeMirror's own `isolateHistory` annotation and `invertedEffects` facet, so what uses
// them works with it unchanged.
//
// MIT License
//
// Copyright (C) 2018-2021 by Marijn Haverbeke <marijn@haverbeke.berlin> and others
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.

import { invertedEffects, isolateHistory } from '@codemirror/commands';
import {
  Annotation,
  ChangeDesc,
  ChangeSet,
  combineConfig,
  EditorSelection,
  type EditorState,
  type Extension,
  Facet,
  type StateCommand,
  StateEffect,
  StateField,
  Transaction,
} from '@codemirror/state';
import { EditorView, type KeyBinding } from '@codemirror/view';

/** The branch a step is popped from: the steps done, or the steps undone. */
const DONE = 0;
const UNDONE = 1;
type BranchName = typeof DONE | typeof UNDONE;

type Branch = readonly HistEvent[];

interface FromHistory {
  side: BranchName;
  rest: Branch;
  selection: EditorSelection;
}

const fromHistory = Annotation.define<FromHistory>();

export interface HistoryConfig {
  /** The minimum depth (amount of events) to store. Defaults to 100. */
  minDepth?: number;
  /**
   * The maximum time (in milliseconds) that adjacent events can be apart and still be grouped
   * together. Defaults to 500.
   */
  newGroupDelay?: number;
  /**
   * By default, when close enough together in time, changes are joined into an existing undo
   * event if they touch any of the changed ranges from that event. A custom predicate here
   * influences that logic.
   */
  joinToEvent?: (tr: Transaction, isAdjacent: boolean) => boolean;
}

const historyConfig = Facet.define<HistoryConfig, Required<HistoryConfig>>({
  combine(configs) {
    return combineConfig<Required<HistoryConfig>>(
      configs,
      {
        minDepth: 100,
        newGroupDelay: 500,
        joinToEvent: (_t: Transaction, isAdjacent: boolean) => isAdjacent,
      },
      {
        minDepth: Math.max,
        newGroupDelay: Math.min,
        joinToEvent:
          (a: Required<HistoryConfig>['joinToEvent'], b: Required<HistoryConfig>['joinToEvent']) =>
          (tr: Transaction, adj: boolean) =>
            a(tr, adj) || b(tr, adj),
      },
    );
  },
});

interface HistoryJSON {
  done: EventJSON[];
  undone: EventJSON[];
}

const historyField_ = StateField.define<HistoryState>({
  create() {
    return HistoryState.empty;
  },
  update(state, tr) {
    const config = tr.state.facet(historyConfig);
    const fromHist = tr.annotation(fromHistory);
    if (fromHist) {
      const item = HistEvent.fromTransaction(tr, fromHist.selection);
      const from = fromHist.side;
      let other = from === DONE ? state.undone : state.done;
      if (item) other = updateBranch(other, other.length, config.minDepth, item);
      else other = addSelection(other, tr.startState.selection);
      return new HistoryState(
        from === DONE ? fromHist.rest : other,
        from === DONE ? other : fromHist.rest,
      );
    }
    const isolate = tr.annotation(isolateHistory);
    if (isolate === 'full' || isolate === 'before') state = state.isolate();
    if (tr.annotation(Transaction.addToHistory) === false) {
      return !tr.changes.empty ? state.addMapping(tr.changes.desc) : state;
    }
    const event = HistEvent.fromTransaction(tr);
    const time = tr.annotation(Transaction.time)!;
    const userEvent = tr.annotation(Transaction.userEvent);
    if (event) state = state.addChanges(event, time, userEvent, config, tr);
    else if (tr.selection) {
      state = state.addSelection(tr.startState.selection, time, userEvent, config.newGroupDelay);
    }
    if (isolate === 'full' || isolate === 'after') state = state.isolate();
    return state;
  },
  toJSON(value): HistoryJSON {
    return {
      done: value.done.map((e) => e.toJSON()),
      undone: value.undone.map((e) => e.toJSON()),
    };
  },
  fromJSON(json: HistoryJSON) {
    return new HistoryState(
      json.done.map((e) => HistEvent.fromJSON(e)),
      json.undone.map((e) => HistEvent.fromJSON(e)),
    );
  },
});

/** The history, with the given configuration, and Undo and Redo from the input events. */
export function history(config: HistoryConfig = {}): Extension {
  return [
    historyField_,
    historyConfig.of(config),
    EditorView.domEventHandlers({
      beforeinput(e, view) {
        const command =
          e.inputType === 'historyUndo' ? undo : e.inputType === 'historyRedo' ? redo : null;
        if (!command) return false;
        e.preventDefault();
        return command(view);
      },
    }),
  ];
}

/** The state field that holds the history. */
export const historyField: StateField<unknown> = historyField_;

function cmd(side: BranchName, selection: boolean): StateCommand {
  return function ({ state, dispatch }) {
    if (!selection && state.readOnly) return false;
    const historyState = state.field(historyField_, false);
    if (!historyState) return false;
    const tr = historyState.pop(side, state, selection);
    if (!tr) return false;
    dispatch(tr);
    return true;
  };
}

/** Undo a single group of history events. Returns false if no group was available. */
export const undo: StateCommand = cmd(DONE, false);
/** Redo a group of history events. Returns false if no group was available. */
export const redo: StateCommand = cmd(UNDONE, false);
/** Undo a change or selection change. */
export const undoSelection: StateCommand = cmd(DONE, true);
/** Redo a change or selection change. */
export const redoSelection: StateCommand = cmd(UNDONE, true);

function depth(side: BranchName) {
  return function (state: EditorState): number {
    const histState = state.field(historyField_, false);
    if (!histState) return 0;
    const branch = side === DONE ? histState.done : histState.undone;
    return branch.length - (branch.length && !branch[0]!.changes ? 1 : 0);
  };
}

/** The amount of undoable change events available in a given state. */
export const undoDepth: (state: EditorState) => number = depth(DONE);
/** The amount of redoable change events available in a given state. */
export const redoDepth: (state: EditorState) => number = depth(UNDONE);

interface EventJSON {
  changes: unknown;
  mapped: unknown;
  startSelection: unknown;
  selectionsAfter: unknown[];
}

// History events store groups of changes or effects that need to be undone/redone together.
class HistEvent {
  // The changes in this event. Normal events hold at least one change or effect. But it may be
  // necessary to store selection events before the first change, in which case a special type of
  // instance is created which doesn't hold any changes, with changes == startSelection ==
  // undefined
  readonly changes: ChangeSet | undefined;
  // The effects associated with this event
  readonly effects: readonly StateEffect<unknown>[];
  // Accumulated mapping (from addToHistory==false) that should be applied to events below this
  // one.
  readonly mapped: ChangeDesc | undefined;
  // The selection before this event
  readonly startSelection: EditorSelection | undefined;
  // Stores selection changes after this event, to be used for selection undo/redo.
  readonly selectionsAfter: readonly EditorSelection[];

  constructor(
    changes: ChangeSet | undefined,
    effects: readonly StateEffect<unknown>[],
    mapped: ChangeDesc | undefined,
    startSelection: EditorSelection | undefined,
    selectionsAfter: readonly EditorSelection[],
  ) {
    this.changes = changes;
    this.effects = effects;
    this.mapped = mapped;
    this.startSelection = startSelection;
    this.selectionsAfter = selectionsAfter;
  }

  setSelAfter(after: readonly EditorSelection[]): HistEvent {
    return new HistEvent(this.changes, this.effects, this.mapped, this.startSelection, after);
  }

  toJSON(): EventJSON {
    return {
      changes: this.changes?.toJSON(),
      mapped: this.mapped?.toJSON(),
      startSelection: this.startSelection?.toJSON(),
      selectionsAfter: this.selectionsAfter.map((s): unknown => s.toJSON()),
    };
  }

  static fromJSON(json: EventJSON): HistEvent {
    return new HistEvent(
      json.changes ? ChangeSet.fromJSON(json.changes) : undefined,
      [],
      json.mapped ? ChangeDesc.fromJSON(json.mapped) : undefined,
      json.startSelection ? EditorSelection.fromJSON(json.startSelection) : undefined,
      json.selectionsAfter.map((s) => EditorSelection.fromJSON(s)),
    );
  }

  // This does not check `addToHistory` and such, it assumes the transaction needs to be converted
  // to an item. Returns null when there are no changes or effects in the transaction.
  static fromTransaction(tr: Transaction, selection?: EditorSelection): HistEvent | null {
    let effects: readonly StateEffect<unknown>[] = none;
    for (const invert of tr.startState.facet(invertedEffects)) {
      const result = invert(tr);
      if (result.length) effects = effects.concat(result);
    }
    if (!effects.length && tr.changes.empty) return null;
    return new HistEvent(
      tr.changes.invert(tr.startState.doc),
      effects,
      undefined,
      selection || tr.startState.selection,
      none,
    );
  }

  static selection(selections: readonly EditorSelection[]): HistEvent {
    return new HistEvent(undefined, none, undefined, undefined, selections);
  }
}

function updateBranch(branch: Branch, to: number, maxLen: number, newEvent: HistEvent): Branch {
  const start = to + 1 > maxLen + 20 ? to - maxLen - 1 : 0;
  const newBranch = branch.slice(start, to);
  newBranch.push(newEvent);
  return newBranch;
}

function isAdjacent(a: ChangeDesc, b: ChangeDesc): boolean {
  const ranges: number[] = [];
  let isAdjacent = false;
  a.iterChangedRanges((f, t) => ranges.push(f, t));
  b.iterChangedRanges((_f, _t, f, t) => {
    for (let i = 0; i < ranges.length;) {
      const from = ranges[i++]!;
      const to = ranges[i++]!;
      if (t >= from && f <= to) isAdjacent = true;
    }
  });
  return isAdjacent;
}

function eqSelectionShape(a: EditorSelection, b: EditorSelection): boolean {
  return (
    a.ranges.length === b.ranges.length &&
    a.ranges.filter((r, i) => r.empty !== b.ranges[i]!.empty).length === 0
  );
}

function conc<T>(a: readonly T[], b: readonly T[]): readonly T[] {
  return !a.length ? b : !b.length ? a : a.concat(b);
}

const none: readonly never[] = [];

const MaxSelectionsPerEvent = 200;

function addSelection(branch: Branch, selection: EditorSelection): Branch {
  if (!branch.length) return [HistEvent.selection([selection])];
  const lastEvent = branch[branch.length - 1]!;
  const sels = lastEvent.selectionsAfter.slice(
    Math.max(0, lastEvent.selectionsAfter.length - MaxSelectionsPerEvent),
  );
  if (sels.length && sels[sels.length - 1]!.eq(selection)) return branch;
  sels.push(selection);
  return updateBranch(branch, branch.length - 1, 1e9, lastEvent.setSelAfter(sels));
}

// Assumes the top item has one or more selectionAfter values
function popSelection(branch: Branch): Branch {
  const last = branch[branch.length - 1]!;
  const newBranch = branch.slice();
  newBranch[branch.length - 1] = last.setSelAfter(
    last.selectionsAfter.slice(0, last.selectionsAfter.length - 1),
  );
  return newBranch;
}

// Add a mapping to the top event in the given branch. If this maps away all the changes and
// effects in that item, drop it and propagate the mapping to the next item.
function addMappingToBranch(branch: Branch, mapping: ChangeDesc): Branch {
  if (!branch.length) return branch;
  let length = branch.length;
  let selections: readonly EditorSelection[] = none;
  while (length) {
    const event = mapEvent(branch[length - 1]!, mapping, selections);
    if ((event.changes && !event.changes.empty) || event.effects.length) {
      // Event survived mapping
      const result = branch.slice(0, length);
      result[length - 1] = event;
      return result;
    } else {
      // Drop this event, since there's no changes or effects left
      mapping = event.mapped!;
      length--;
      selections = event.selectionsAfter;
    }
  }
  return selections.length ? [HistEvent.selection(selections)] : none;
}

function mapEvent(
  event: HistEvent,
  mapping: ChangeDesc,
  extraSelections: readonly EditorSelection[],
): HistEvent {
  const selections = conc(
    event.selectionsAfter.length ? event.selectionsAfter.map((s) => s.map(mapping)) : none,
    extraSelections,
  );
  // Change-less events don't store mappings (they are always the last event in a branch)
  if (!event.changes) return HistEvent.selection(selections);
  const mappedChanges = event.changes.map(mapping);
  const before = mapping.mapDesc(event.changes, true);
  const fullMapping = event.mapped ? event.mapped.composeDesc(before) : before;
  return new HistEvent(
    mappedChanges,
    StateEffect.mapEffects(event.effects, mapping),
    fullMapping,
    event.startSelection!.map(before),
    selections,
  );
}

const joinableUserEvent = /^(input\.type|delete)($|\.)/;

class HistoryState {
  static empty: HistoryState;
  readonly done: Branch;
  readonly undone: Branch;
  readonly prevTime: number;
  readonly prevUserEvent: string | undefined;

  constructor(
    done: Branch,
    undone: Branch,
    prevTime = 0,
    prevUserEvent: string | undefined = undefined,
  ) {
    this.done = done;
    this.undone = undone;
    this.prevTime = prevTime;
    this.prevUserEvent = prevUserEvent;
  }

  isolate(): HistoryState {
    return this.prevTime ? new HistoryState(this.done, this.undone) : this;
  }

  addChanges(
    event: HistEvent,
    time: number,
    userEvent: string | undefined,
    config: Required<HistoryConfig>,
    tr: Transaction,
  ): HistoryState {
    let done = this.done;
    const lastEvent = done[done.length - 1];
    if (
      lastEvent &&
      lastEvent.changes &&
      !lastEvent.changes.empty &&
      event.changes &&
      (!userEvent || joinableUserEvent.test(userEvent)) &&
      ((!lastEvent.selectionsAfter.length &&
        time - this.prevTime < config.newGroupDelay &&
        config.joinToEvent(tr, isAdjacent(lastEvent.changes, event.changes))) ||
        // For compose (but not compose.start) events, always join with previous event
        userEvent === 'input.type.compose')
    ) {
      done = updateBranch(
        done,
        done.length - 1,
        config.minDepth,
        new HistEvent(
          event.changes.compose(lastEvent.changes),
          conc(StateEffect.mapEffects(event.effects, lastEvent.changes), lastEvent.effects),
          lastEvent.mapped,
          lastEvent.startSelection,
          none,
        ),
      );
    } else {
      done = updateBranch(done, done.length, config.minDepth, event);
    }
    return new HistoryState(done, none, time, userEvent);
  }

  addSelection(
    selection: EditorSelection,
    time: number,
    userEvent: string | undefined,
    newGroupDelay: number,
  ): HistoryState {
    const last = this.done.length ? this.done[this.done.length - 1]!.selectionsAfter : none;
    if (
      last.length > 0 &&
      time - this.prevTime < newGroupDelay &&
      userEvent === this.prevUserEvent &&
      userEvent &&
      /^select($|\.)/.test(userEvent) &&
      eqSelectionShape(last[last.length - 1]!, selection)
    ) {
      return this;
    }
    return new HistoryState(addSelection(this.done, selection), this.undone, time, userEvent);
  }

  addMapping(mapping: ChangeDesc): HistoryState {
    return new HistoryState(
      addMappingToBranch(this.done, mapping),
      addMappingToBranch(this.undone, mapping),
      this.prevTime,
      this.prevUserEvent,
    );
  }

  pop(side: BranchName, state: EditorState, onlySelection: boolean): Transaction | null {
    const branch = side === DONE ? this.done : this.undone;
    if (branch.length === 0) return null;
    const event = branch[branch.length - 1]!;
    const selection =
      event.selectionsAfter[0] ||
      (event.startSelection
        ? event.startSelection.map(event.changes!.invertedDesc, 1)
        : state.selection);
    if (onlySelection && event.selectionsAfter.length) {
      return state.update({
        selection: event.selectionsAfter[event.selectionsAfter.length - 1],
        annotations: fromHistory.of({ side, rest: popSelection(branch), selection }),
        userEvent: side === DONE ? 'select.undo' : 'select.redo',
        scrollIntoView: true,
      });
    } else if (!event.changes) {
      return null;
    } else {
      let rest: Branch = branch.length === 1 ? none : branch.slice(0, branch.length - 1);
      if (event.mapped) rest = addMappingToBranch(rest, event.mapped);
      return state.update({
        changes: event.changes,
        selection: event.startSelection,
        effects: event.effects,
        annotations: fromHistory.of({ side, rest, selection }),
        filter: false,
        userEvent: side === DONE ? 'undo' : 'redo',
        scrollIntoView: true,
      });
    }
  }
}

HistoryState.empty = new HistoryState(none, none);

/**
 * Key bindings for the history: Mod-z undo, Mod-y (Mod-Shift-z on macOS) and Ctrl-Shift-z on
 * Linux redo, Mod-u undoSelection, Alt-u (Mod-Shift-u on macOS) redoSelection.
 */
export const historyKeymap: readonly KeyBinding[] = [
  { key: 'Mod-z', run: undo, preventDefault: true },
  { key: 'Mod-y', mac: 'Mod-Shift-z', run: redo, preventDefault: true },
  { linux: 'Ctrl-Shift-z', run: redo, preventDefault: true },
  { key: 'Mod-u', run: undoSelection, preventDefault: true },
  { key: 'Alt-u', mac: 'Mod-Shift-u', run: redoSelection, preventDefault: true },
];
