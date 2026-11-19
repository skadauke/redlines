// Pandoc's subscript and superscript in a pandoc file: `H~2~O` and `x^2^` are drawn lowered and
// raised, in a smaller size, with their tildes and carets hidden; the source shows while the caret
// is in or against them, as other syntax does. Only a `.qmd` or `.Rmd` file has them (the dialect,
// format §9.1): in a Markdown file `~2~` is GitHub's strikethrough and `^2^` is text. Pandoc's rule is
// that the text between the marks holds no space (unless it is escaped), and that `~~` is
// strikethrough, `^[` an inline note, and a mark in code, math or an HTML comment is no mark.

import { syntaxTree } from '@codemirror/language';
import type { EditorState, Extension, Range } from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view';
import { dialectFacet } from '../dialect.ts';
import { viewModeField } from '../tracked/field.ts';

/** `~sub~` (not `~~`), and `^sup^` (not `^[`): no space, no mark and no backslash between. */
const SCRIPT = /(?<![~\\])~([^\s~\\]+)~(?!~)|(?<![\^\\])\^([^\s^\\[][^\s^\\]*)\^/g;
const MATH = /\$[^$\n]+\$/g;

/** The nodes in which a mark is not one. */
const PLAIN = new Set([
  'InlineCode',
  'FencedCode',
  'CodeBlock',
  'CodeText',
  'CodeInfo',
  'FrontMatter',
  'Comment',
  'CommentBlock',
  'HTMLBlock',
  'HTMLTag',
  'URL',
  'Math',
  'MathBlock',
]);

/** A subscript or superscript in a line of text: where it starts, ends, and which it is. */
export interface Script {
  from: number;
  to: number;
  kind: 'sub' | 'sup';
}

/** The scripts of a line of text, none inside a `$…$` span. */
export function scriptsOf(text: string): Script[] {
  if (!text.includes('~') && !text.includes('^')) return [];
  const math = [...text.matchAll(MATH)].map((m) => [m.index, m.index + m[0].length] as const);
  const out: Script[] = [];
  for (const found of text.matchAll(SCRIPT)) {
    const from = found.index;
    const to = from + found[0].length;
    if (math.some(([a, b]) => from >= a && from < b)) continue;
    out.push({ from, to, kind: found[0].startsWith('~') ? 'sub' : 'sup' });
  }
  return out;
}

function inPlain(state: EditorState, pos: number): boolean {
  for (let node = syntaxTree(state).resolveInner(pos, 1); node; node = node.parent!) {
    if (PLAIN.has(node.name)) return true;
    if (!node.parent) break;
  }
  return false;
}

const HIDDEN = Decoration.replace({});
const SYNTAX = Decoration.mark({ class: 'rl-syntax' });
const SUB = Decoration.mark({ class: 'rl-sub' });
const SUP = Decoration.mark({ class: 'rl-sup' });

function draw(view: EditorView): DecorationSet {
  const { state } = view;
  if (state.facet(dialectFacet) !== 'pandoc') return Decoration.none;
  if (state.field(viewModeField, false) === 'raw') return Decoration.none;
  const ranges: Range<Decoration>[] = [];
  let done = -1;
  for (const { from, to } of view.visibleRanges) {
    let at = Math.max(from, done + 1);
    while (at <= to) {
      const line = state.doc.lineAt(at);
      at = line.to + 1;
      done = line.to;
      for (const script of scriptsOf(line.text)) {
        const start = line.from + script.from;
        const end = line.from + script.to;
        if (inPlain(state, start)) continue;
        const touched = state.selection.ranges.some((r) => r.from <= end && r.to >= start);
        ranges.push((script.kind === 'sub' ? SUB : SUP).range(start + 1, end - 1));
        if (touched) {
          ranges.push(SYNTAX.range(start, start + 1), SYNTAX.range(end - 1, end));
        } else {
          ranges.push(HIDDEN.range(start, start + 1), HIDDEN.range(end - 1, end));
        }
      }
    }
  }
  return Decoration.set(ranges, true);
}

const plugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = draw(view);
    }

    update(update: ViewUpdate): void {
      if (
        update.docChanged ||
        update.selectionSet ||
        update.viewportChanged ||
        update.startState.facet(dialectFacet) !== update.state.facet(dialectFacet) ||
        update.startState.field(viewModeField, false) !== update.state.field(viewModeField, false)
      ) {
        this.decorations = draw(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

const theme = EditorView.baseTheme({
  '.rl-sub, .rl-sup': { fontSize: '0.75em', lineHeight: '0' },
  '.rl-sub': { verticalAlign: 'sub' },
  '.rl-sup': { verticalAlign: 'super' },
});

/** Subscript and superscript, drawn in a pandoc file. */
export function quartoScripts(): Extension {
  return [plugin, theme];
}
