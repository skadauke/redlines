// The places that decide where the caret goes when an agent's step is taken back or brought back,
// before `agentCaret` (`caret.ts`) does. In a file of its own, which imports nothing of the editor,
// so that the blocks can provide one without a cycle through the history's guard.

import type { EditorSelection, Transaction } from '@codemirror/state';
import { Facet } from '@codemirror/state';

/** The first that has an answer wins (the open empty paragraph an Undo brings back, `blocks/open.ts`). */
export const agentCaretFacet = Facet.define<(tr: Transaction) => EditorSelection | null>();
