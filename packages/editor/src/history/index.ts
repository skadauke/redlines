// The undo history of the editor: a copy of CodeMirror's (history.ts), and the guard around it
// that starts it over after a change on disk and says why Undo does nothing (guard.ts).

export {
  agentOf,
  agentStep,
  doneDepth,
  dropStepsEffect,
  followsText,
  history,
  historyField,
  historyKeymap,
  type HistoryConfig,
  redo,
  redoDepth,
  redoSelection,
  undo,
  undoDepth,
  undoSelection,
} from './history.ts';
export {
  changedOutside,
  REDO_AFTER_RELOAD,
  redoHasSomething,
  redoSayingWhy,
  refusedStep,
  startOver,
  startsOver,
  UNDO_AFTER_RELOAD,
  undoHistory,
  undoHasSomething,
  undoKeymap,
  undoKeys,
  undoSayingWhy,
} from './guard.ts';
export { labelOf, redoName, type StepLabel, undoName } from './names.ts';
