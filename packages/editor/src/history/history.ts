// The undo history: a copy of the history half of @codemirror/commands 6.11.1, from `fromHistory`
// to `historyKeymap`, in TypeScript. Redlines keeps its own so that its steps can have an owner
// (docs/superpowers/specs/2026-11-10-agents-undo-and-allow-design.md, A history of our own). It
// reads CodeMirror's own `isolateHistory` annotation and `invertedEffects` facet, so what uses
// them works with it unchanged. Left out of the copy: `canUndoSelection` and `canRedoSelection`,
// which nothing here uses (and CodeMirror's `canRedoSelection` reads the done branch, not the
// undone one).
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
import type { AgentStep } from '../api.ts';
import type { StepLabel } from './names.ts';

/** The branch a step is popped from: the steps done, or the steps undone. */
const DONE = 0;
const UNDONE = 1;
type BranchName = typeof DONE | typeof UNDONE;

type Branch = readonly HistEvent[];

interface FromHistory {
  side: BranchName;
  rest: Branch;
  selection: EditorSelection;
  /** The agent whose step this takes back or brings back, or null. */
  owner: AgentStep | null;
  /** The name of the step (Redlines), which goes with it through Undo and Redo. */
  label: StepLabel | null;
}

const fromHistory = Annotation.define<FromHistory>();

/**
 * Marks an agent's transaction: a step of its own, joined to the newest step when that is its
 * group's, whatever the time and whatever was selected since.
 */
export const agentStep = Annotation.define<AgentStep>();

/**
 * Marks a transaction whose step the history joins to the step before it, next to it or not
 * (Redlines): a Return over a selection is the deletion's step, though a mark's closer can stand
 * between the two. Time and the user event still decide, as for any join.
 */
export const joinsStep = Annotation.define<true>();

/**
 * Marks a transaction that joins the newest step, whatever its owner, the time since it, the
 * selections after it and what isolated it (Redlines): a change that is no step of its own, such as
 * the view a Save records in the ledger. Undo gives it back with that step, so that the steps below
 * still fit the text, as they wouldn't if it were made outside the history (a step that replaced
 * the ledger would be taken back over the line the change put in it). With no step to join, it is
 * a step of its own.
 */
export const joinsNewestStep = Annotation.define<true>();

/**
 * Takes the steps done back to `depth` of them, and maps the rest through `mapping`, if any
 * (Redlines): a take-back of Returns outside the history carries it, with the depth before the
 * first Return it takes back, so that no step of a Return it took back, nor of what was done and
 * undone between them, is left to replay. Mapping alone drops only a step that inserted and
 * deleted nothing, since an inverse that inserts survives it.
 */
export const dropStepsEffect = StateEffect.define<{ depth: number; mapping: ChangeDesc | null }>();

/**
 * How many steps have been done, for `dropStepsEffect`'s depth (Redlines): counted from the start of
 * the history, with the steps trimmed off its bottom (`minDepth`), so that a depth stays the same
 * step's however much is trimmed after it is taken.
 */
export function doneDepth(state: EditorState): number {
  const history = state.field(historyField_, false);
  return history ? history.trimmed + history.done.length : 0;
}

/** The agent whose step `tr` makes, takes back or brings back; null for anything else. */
export function agentOf(tr: Transaction): AgentStep | null {
  return tr.annotation(agentStep) ?? tr.annotation(fromHistory)?.owner ?? null;
}

/**
 * Whether anchors follow text through `tr` rather than map: a reload, an agent's step, and its
 * Undo and Redo.
 */
export function followsText(tr: Transaction): boolean {
  return tr.isUserEvent('reload') || agentOf(tr) !== null;
}

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
  /**
   * Where the caret goes when an agent's step is taken back or brought back (Redlines), given that
   * undo or redo as made with the step's own start selection. By default, there.
   */
  agentCaret?: (tr: Transaction) => EditorSelection;
  /**
   * What a transaction's step is called (Redlines), for the Edit menu: the label its event keeps,
   * the first transaction's, while later ones join it. By default, none.
   */
  label?: (tr: Transaction) => StepLabel | null;
}

const historyConfig = Facet.define<HistoryConfig, Required<HistoryConfig>>({
  combine(configs) {
    return combineConfig<Required<HistoryConfig>>(
      configs,
      {
        minDepth: 100,
        newGroupDelay: 500,
        joinToEvent: (t: Transaction, isAdjacent: boolean) =>
          isAdjacent || !!t.annotation(joinsStep),
        agentCaret: (tr: Transaction) => tr.state.selection,
        label: () => null,
      },
      {
        minDepth: Math.max,
        newGroupDelay: Math.min,
        joinToEvent:
          (a: Required<HistoryConfig>['joinToEvent'], b: Required<HistoryConfig>['joinToEvent']) =>
          (tr: Transaction, adj: boolean) =>
            a(tr, adj) || b(tr, adj),
        agentCaret: (a: Required<HistoryConfig>['agentCaret']) => a,
        label: (a: Required<HistoryConfig>['label']) => a,
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
      const item = HistEvent.fromTransaction(
        tr,
        fromHist.owner,
        fromHist.label,
        fromHist.selection,
      );
      const from = fromHist.side;
      let other = from === DONE ? state.undone : state.done;
      // Redo pushes onto the steps done, which may trim them.
      const trimmed = from === UNDONE && item ? trimmedBy(other.length, config.minDepth) : 0;
      if (item) other = updateBranch(other, other.length, config.minDepth, item);
      else other = addSelection(other, tr.startState.selection);
      return new HistoryState(
        from === DONE ? fromHist.rest : other,
        from === DONE ? other : fromHist.rest,
        0,
        undefined,
        false,
        state.trimmed + trimmed,
      );
    }
    const drop = tr.effects.find((effect) => effect.is(dropStepsEffect));
    if (drop) {
      // The text is as before those steps again: the steps below them need no mapping of it.
      state = state.dropSteps(drop.value.depth);
      return drop.value.mapping ? state.addMapping(drop.value.mapping) : state;
    }
    const isolate = tr.annotation(isolateHistory);
    if (isolate === 'full' || isolate === 'before') state = state.isolate();
    if (tr.annotation(Transaction.addToHistory) === false) {
      return !tr.changes.empty ? state.addMapping(tr.changes.desc) : state;
    }
    const event = HistEvent.fromTransaction(
      tr,
      tr.annotation(agentStep) ?? null,
      // Only for a transaction that has an event: a keystroke costs what it costs on main.
      tr.changes.empty ? null : config.label(tr),
    );
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

function topLabel(side: BranchName): (state: EditorState) => StepLabel | null {
  return (state) => {
    const branch = state.field(historyField_, false)?.[side === DONE ? 'done' : 'undone'];
    const event = branch?.[branch.length - 1];
    return event?.changes ? event.label : null;
  };
}

/** The label of the step Undo would take back, or null for none or a step without one. */
export const undoLabel: (state: EditorState) => StepLabel | null = topLabel(DONE);
/** The label of the step Redo would bring back, likewise. */
export const redoLabel: (state: EditorState) => StepLabel | null = topLabel(UNDONE);

interface EventJSON {
  changes: unknown;
  mapped: unknown;
  startSelection: unknown;
  selectionsAfter: unknown[];
  owner?: AgentStep | null;
  label?: StepLabel | null;
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
  // The agent whose step this is, or null for the person's own (Redlines).
  readonly owner: AgentStep | null;
  // What the step is called, for the Edit menu, or null (Redlines).
  readonly label: StepLabel | null;

  constructor(
    changes: ChangeSet | undefined,
    effects: readonly StateEffect<unknown>[],
    mapped: ChangeDesc | undefined,
    startSelection: EditorSelection | undefined,
    selectionsAfter: readonly EditorSelection[],
    owner: AgentStep | null,
    label: StepLabel | null,
  ) {
    this.changes = changes;
    this.effects = effects;
    this.mapped = mapped;
    this.startSelection = startSelection;
    this.selectionsAfter = selectionsAfter;
    this.owner = owner;
    this.label = label;
  }

  setSelAfter(after: readonly EditorSelection[]): HistEvent {
    return new HistEvent(
      this.changes,
      this.effects,
      this.mapped,
      this.startSelection,
      after,
      this.owner,
      this.label,
    );
  }

  toJSON(): EventJSON {
    return {
      changes: this.changes?.toJSON(),
      mapped: this.mapped?.toJSON(),
      startSelection: this.startSelection?.toJSON(),
      selectionsAfter: this.selectionsAfter.map((s): unknown => s.toJSON()),
      owner: this.owner,
      label: this.label,
    };
  }

  static fromJSON(json: EventJSON): HistEvent {
    return new HistEvent(
      json.changes ? ChangeSet.fromJSON(json.changes) : undefined,
      [],
      json.mapped ? ChangeDesc.fromJSON(json.mapped) : undefined,
      json.startSelection ? EditorSelection.fromJSON(json.startSelection) : undefined,
      json.selectionsAfter.map((s) => EditorSelection.fromJSON(s)),
      json.owner ?? null,
      json.label ?? null,
    );
  }

  // This does not check `addToHistory` and such, it assumes the transaction needs to be converted
  // to an item. Returns null when there are no changes or effects in the transaction.
  static fromTransaction(
    tr: Transaction,
    owner: AgentStep | null,
    label: StepLabel | null,
    selection?: EditorSelection,
  ): HistEvent | null {
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
      owner,
      label,
    );
  }

  static selection(selections: readonly EditorSelection[]): HistEvent {
    return new HistEvent(undefined, none, undefined, undefined, selections, null, null);
  }
}

/** How many events from the bottom `updateBranch` cuts off, pushing at `to`. */
function trimmedBy(to: number, maxLen: number): number {
  return to + 1 > maxLen + 20 ? to - maxLen - 1 : 0;
}

function updateBranch(branch: Branch, to: number, maxLen: number, newEvent: HistEvent): Branch {
  const start = trimmedBy(to, maxLen);
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
    event.owner,
    event.label,
  );
}

/**
 * The label of an event that another joins: the first's, but for an agent's step, which stays a
 * reply only while every edit joined to it changed nothing but threads.
 */
function joinedLabel(first: StepLabel | null, next: StepLabel | null): StepLabel | null {
  if (first && next && 'agent' in first && 'agent' in next) {
    return { agent: first.agent, onlyThreads: first.onlyThreads && next.onlyThreads };
  }
  return first;
}

const joinableUserEvent = /^(input\.type|delete)($|\.)/;

class HistoryState {
  static empty: HistoryState;
  readonly done: Branch;
  readonly undone: Branch;
  readonly prevTime: number;
  readonly prevUserEvent: string | undefined;
  // Redlines: whether the last event was isolated from what comes next (`isolateHistory`), which
  // an agent's event, joined whatever the time, can't tell from `prevTime`.
  readonly isolated: boolean;
  // Redlines: how many steps done have been trimmed off the bottom of `done` (`minDepth`), so that
  // `doneDepth` counts from the history's start.
  readonly trimmed: number;

  constructor(
    done: Branch,
    undone: Branch,
    prevTime = 0,
    prevUserEvent: string | undefined = undefined,
    isolated = false,
    trimmed = 0,
  ) {
    this.done = done;
    this.undone = undone;
    this.prevTime = prevTime;
    this.prevUserEvent = prevUserEvent;
    this.isolated = isolated;
    this.trimmed = trimmed;
  }

  isolate(): HistoryState {
    if (this.prevTime) {
      return new HistoryState(this.done, this.undone, 0, undefined, true, this.trimmed);
    }
    return this.isolated
      ? this
      : new HistoryState(
          this.done,
          this.undone,
          this.prevTime,
          this.prevUserEvent,
          true,
          this.trimmed,
        );
  }

  addChanges(
    event: HistEvent,
    time: number,
    userEvent: string | undefined,
    config: Required<HistoryConfig>,
    tr: Transaction,
  ): HistoryState {
    let done = this.done;
    let trimmed = this.trimmed;
    const lastEvent = done[done.length - 1];
    // Redlines: an agent's event joins the last only when that is its group's and nothing isolated
    // them (`isolateHistory`), whatever the time, the adjacency and the selections since; the
    // person's joins only the person's, by CodeMirror's rules, a composition's included. Steps
    // never cross owners.
    const lastChanges = lastEvent?.changes;
    if (
      lastEvent &&
      lastChanges &&
      event.changes &&
      (tr.annotation(joinsNewestStep) ||
        (event.owner
          ? !this.isolated && lastEvent.owner?.group === event.owner.group
          : !lastEvent.owner &&
            !lastChanges.empty &&
            (!userEvent || joinableUserEvent.test(userEvent)) &&
            ((!lastEvent.selectionsAfter.length &&
              time - this.prevTime < config.newGroupDelay &&
              config.joinToEvent(tr, isAdjacent(lastChanges, event.changes))) ||
              // For compose (but not compose.start) events, always join with previous event
              userEvent === 'input.type.compose')))
    ) {
      trimmed += trimmedBy(done.length - 1, config.minDepth);
      done = updateBranch(
        done,
        done.length - 1,
        config.minDepth,
        new HistEvent(
          event.changes.compose(lastChanges),
          conc(StateEffect.mapEffects(event.effects, lastChanges), lastEvent.effects),
          lastEvent.mapped,
          lastEvent.startSelection,
          none,
          lastEvent.owner,
          joinedLabel(lastEvent.label, event.label),
        ),
      );
    } else {
      trimmed += trimmedBy(done.length, config.minDepth);
      done = updateBranch(done, done.length, config.minDepth, event);
    }
    return new HistoryState(done, none, time, userEvent, false, trimmed);
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
    return new HistoryState(
      addSelection(this.done, selection),
      this.undone,
      time,
      userEvent,
      this.isolated,
      this.trimmed,
    );
  }

  /** With only the steps done before `depth` (a `doneDepth`) left, isolated. */
  dropSteps(depth: number): HistoryState {
    const keep = Math.max(0, Math.min(depth - this.trimmed, this.done.length));
    return new HistoryState(
      this.done.slice(0, keep),
      this.undone,
      0,
      undefined,
      true,
      this.trimmed,
    );
  }

  addMapping(mapping: ChangeDesc): HistoryState {
    return new HistoryState(
      addMappingToBranch(this.done, mapping),
      addMappingToBranch(this.undone, mapping),
      this.prevTime,
      this.prevUserEvent,
      this.isolated,
      this.trimmed,
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
        annotations: fromHistory.of({
          side,
          rest: popSelection(branch),
          selection,
          owner: null,
          label: null,
        }),
        userEvent: side === DONE ? 'select.undo' : 'select.redo',
        scrollIntoView: true,
      });
    } else if (!event.changes) {
      return null;
    } else {
      let rest: Branch = branch.length === 1 ? none : branch.slice(0, branch.length - 1);
      if (event.mapped) rest = addMappingToBranch(rest, event.mapped);
      const spec = {
        changes: event.changes,
        selection: event.startSelection,
        effects: event.effects,
        annotations: fromHistory.of({
          side,
          rest,
          selection,
          owner: event.owner,
          label: event.label,
        }),
        filter: false,
        userEvent: side === DONE ? 'undo' : 'redo',
        scrollIntoView: true,
      };
      const tr = state.update(spec);
      // Redlines: an agent's step puts the caret where it changed, which the made step tells.
      if (!event.owner) return tr;
      return state.update({ ...spec, selection: state.facet(historyConfig).agentCaret(tr) });
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
