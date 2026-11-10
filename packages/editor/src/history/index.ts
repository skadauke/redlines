// The undo history of the editor: a copy of CodeMirror's (history.ts), and the guard around it
// that starts it over after a change on disk and says why Undo does nothing (guard.ts).

export {
  agentOf,
  agentStep,
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
  REDO_AFTER_RELOAD,
  redoSayingWhy,
  refusedStep,
  startOver,
  UNDO_AFTER_RELOAD,
  undoHistory,
  undoKeymap,
  undoSayingWhy,
} from './guard.ts';
export { labelOf, redoName, type StepLabel, undoName } from './names.ts';
