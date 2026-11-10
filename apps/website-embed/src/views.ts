import type { ViewMode } from '@redlines/editor';

// The editor exports no list of its views (the app's View menu writes them out too). A fourth
// `ViewMode` fails this file's type check until it has a label, and the page then draws it.
const LABELS = { clean: 'Clean', redlines: 'Redlines', raw: 'Raw' } satisfies Record<
  ViewMode,
  string
>;

/** The views the editor offers, in order, with the words the app's View menu uses. */
export const VIEWS: readonly { view: ViewMode; label: string }[] = (
  Object.keys(LABELS) as ViewMode[]
).map((view) => ({ view, label: LABELS[view] }));
