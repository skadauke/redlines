// The outline (design §6.4): an animated outline of the headings in the left margin, which opens on
// hover into a list, goes to a heading on a click, and is reached from the keyboard by ⌃⌘O.

import type { Editor } from '@redlines/editor';
import type { Plugin } from '@redlines/plugin-api';
import { createOutline } from './outline.ts';

export { createOutline } from './outline.ts';
export type { OutlineGeometry, OutlineOptions, PaneBox } from './outline.ts';
export { headingsOf, type Heading } from './headings.ts';

export const plugin: Plugin = {
  manifest: {
    id: 'redlines.outline',
    name: 'Outline',
    version: '0.0.0',
    needs: ['document:read'],
    contributes: {
      commands: [{ id: 'outline.focus', title: 'Show Outline', shortcut: 'Mod-Ctrl-o' }],
    },
  },
  activate: (context) =>
    createOutline(context.editor as Editor, { notice: (message) => context.notice(message) }),
};
