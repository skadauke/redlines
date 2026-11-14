import type { MenuView } from '@redlines/editor';

// The editor exports no list of its views (the app's View menu writes them out too). A fourth
// `MenuView` fails this file's type check until it has a label, and the page then draws it. Simple
// is no view: it is Redlines' simple look, which a click on a change bar switches to.
const LABELS = {
  clean: 'Clean',
  redlines: 'Redlines',
  raw: 'Raw',
} satisfies Record<MenuView, string>;

/** The views the editor offers, in order, with the words the app's View menu uses. */
export const VIEWS: readonly { view: MenuView; label: string }[] = (
  Object.keys(LABELS) as MenuView[]
).map((view) => ({ view, label: LABELS[view] }));
