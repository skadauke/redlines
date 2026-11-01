// Helpers shared by the tracked layer's tests: what its decorations draw. Not part of the package.

import { EditorView, type WidgetType } from '@codemirror/view';
import type { Editor } from '../index.ts';
import { trackedDecorations } from './decorations.ts';

export interface Found {
  from: number;
  to: number;
  kind: 'line' | 'mark' | 'replace' | 'widget';
  className: string;
  block: boolean;
  /** A widget as drawn. */
  widget?: { text: string; className: string };
}

/** The tracked layer's decorations. */
export function list(editor: Editor): Found[] {
  const found: Found[] = [];
  const { state } = editor.view;
  trackedDecorations(state).between(0, state.doc.length, (from, to, value) => {
    const spec = value.spec as { class?: string; block?: boolean; widget?: WidgetType };
    const kind = !value.point
      ? 'mark'
      : from === to
        ? spec.widget
          ? 'widget'
          : 'line'
        : 'replace';
    const item: Found = { from, to, kind, className: spec.class ?? '', block: !!spec.block };
    if (spec.widget) {
      const dom = spec.widget.toDOM(editor.view);
      item.widget = { text: dom.textContent ?? '', className: dom.className };
    }
    found.push(item);
  });
  return found;
}

export const classes = (found: { className: string }) => found.className.split(' ');

/**
 * The text the decorations leave visible before `to` (by default, all of it): hidden text gone,
 * each widget's text in its place, and the lines of a hidden block gone together with one line
 * break.
 */
export function visibleText(editor: Editor, to = editor.view.state.doc.length): string {
  const doc = editor.view.state.doc.toString();
  let text = '';
  let pos = 0;
  for (const d of list(editor)) {
    if (d.kind === 'mark' || d.kind === 'line' || d.from < pos) continue;
    if (d.from >= to) break;
    text += doc.slice(pos, d.from) + (d.widget?.text ?? '');
    pos = d.to;
    if (d.block) {
      if (doc[pos] === '\n') pos++;
      else text = text.replace(/\n$/, '');
    }
  }
  return text + doc.slice(pos, Math.max(pos, to));
}

/** The ranges the caret steps over. */
export function atomic(editor: Editor): [number, number][] {
  const { view } = editor;
  const ranges: [number, number][] = [];
  for (const source of view.state.facet(EditorView.atomicRanges)) {
    for (let it = source(view).iter(); it.value; it.next()) ranges.push([it.from, it.to]);
  }
  return ranges;
}
