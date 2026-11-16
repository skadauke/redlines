// Syntax colors for code (design: Rendering): the theme's --rl-code-* tokens, set on a few families
// of tags. Everything else in code stays the text color. Grammars come from @codemirror/language-data,
// which loads each on demand: a dynamic import per language, so none of it is in the first load.

import { HighlightStyle, LanguageDescription, syntaxTree } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import type { EditorState, Extension, Range } from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view';
import { type ChangedRange, type Parser, type Tree, TreeFragment } from '@lezer/common';
import { highlightTree, tags as t } from '@lezer/highlight';

const color = (kind: string) => ({ color: `var(--rl-code-${kind})` });

/** The colors, as a style that can also be run over a tree. */
export const codeStyle = HighlightStyle.define([
  {
    tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword, t.definitionKeyword],
    ...color('keyword'),
  },
  { tag: [t.string, t.special(t.string), t.regexp], ...color('string') },
  { tag: [t.number, t.bool, t.null, t.atom], ...color('number') },
  {
    tag: [t.comment, t.lineComment, t.blockComment, t.docComment],
    ...color('comment'),
    fontStyle: 'italic',
  },
  {
    tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName],
    ...color('function'),
  },
  { tag: [t.typeName, t.className, t.namespace, t.tagName], ...color('type') },
  { tag: [t.operator, t.punctuation], color: 'var(--rl-ink-2)' },
]);

/** A colored stretch of code: the class the style gives it. */
export interface CodeSpan {
  from: number;
  to: number;
  class: string;
}

/**
 * The colored stretches of the fenced and indented code blocks that overlap `from` to `to`, and
 * nothing else. The Markdown around a block shares tags with code (its comments, which hold the
 * hidden markers of tracked changes, its link titles), so the style is run over the blocks alone.
 */
export function codeSpans(state: EditorState, from: number, to: number): CodeSpan[] {
  const tree = syntaxTree(state);
  const spans: CodeSpan[] = [];
  tree.iterate({
    from,
    to,
    enter(node) {
      if (node.name !== 'FencedCode' && node.name !== 'CodeBlock') return;
      highlightTree(
        tree,
        codeStyle,
        (start, end, classes) => spans.push({ from: start, to: end, class: classes }),
        Math.max(from, node.from),
        Math.min(to, node.to),
      );
      return false;
    },
  });
  return spans;
}

const codePlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }
    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        syntaxTree(update.startState) !== syntaxTree(update.state)
      ) {
        this.decorations = this.build(update.view);
      }
    }
    build(view: EditorView): DecorationSet {
      const marks: Range<Decoration>[] = [];
      for (const { from, to } of view.visibleRanges) {
        for (const span of codeSpans(view.state, from, to)) {
          marks.push(Decoration.mark({ class: span.class }).range(span.from, span.to));
        }
      }
      return Decoration.set(marks, true);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

/** Colors the code in the editor's Markdown, and only the code. */
export const codeHighlight: Extension = [EditorView.styleModule.of(codeStyle.module!), codePlugin];

/** The language for a fence's info string (`ts`, `python`), or null when there is none. */
export function codeLanguages(info: string): LanguageDescription | null {
  const word = info.trim().split(/\s+/)[0] ?? '';
  return word === '' ? null : LanguageDescription.matchLanguageName(languages, word, true);
}

/** Loads a language by its info string, as the editor does when it meets the block. */
export async function loadCodeLanguage(info: string): Promise<void> {
  await codeLanguages(info)?.load();
}

/** Above this many characters a file is not colored: the colors are off, and the file is still Plain. */
export const CODE_FILE_COLOR_LIMIT = 2_000_000;

/**
 * The grammar for a file's name (`app.ts`, `Makefile`), or null for a name with none, such as
 * `.txt`, `.log` and `.csv`, which stay uncolored.
 */
export function codeFileLanguage(filename: string): LanguageDescription | null {
  const name = filename.slice(Math.max(filename.lastIndexOf('/'), filename.lastIndexOf('\\')) + 1);
  // The extensions are lowercase in the grammars; `Makefile` and its kind are matched as written.
  return (
    LanguageDescription.matchFilename(languages, name) ??
    LanguageDescription.matchFilename(languages, name.toLowerCase())
  );
}

/** The ranges an update changed, as `TreeFragment.applyChanges` takes them. */
function changedRanges(update: ViewUpdate): ChangedRange[] {
  const ranges: ChangedRange[] = [];
  update.changes.iterChangedRanges((fromA, toA, fromB, toB) =>
    ranges.push({ fromA, toA, fromB, toB }),
  );
  return ranges;
}

/**
 * Colors a whole file as the language its name says, for a Plain-only file (text or code). It uses
 * the same style and the theme's `--rl-code-*` tokens as the blocks of a Markdown file, and the
 * grammar loads on demand: until it arrives the text is uncolored. The grammar parses the file on
 * its own, beside the editor's own parse. A name with no grammar, or a file over
 * `CODE_FILE_COLOR_LIMIT` characters, gets no colors.
 */
export function codeFileHighlight(filename: string, size = 0): Extension {
  const found = size > CODE_FILE_COLOR_LIMIT ? null : codeFileLanguage(filename);
  if (!found) return [];
  const description = found;
  return [
    EditorView.styleModule.of(codeStyle.module!),
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet = Decoration.none;
        parser: Parser | null = null;
        tree: Tree | null = null;
        fragments: readonly TreeFragment[] = [];
        gone = false;
        constructor(view: EditorView) {
          description.load().then(
            (support) => {
              if (this.gone || view.state.doc.length > CODE_FILE_COLOR_LIMIT) return;
              this.parser = support.language.parser;
              this.decorations = this.build(view);
              // Draws the colors that the grammar's arrival made possible.
              view.dispatch({});
            },
            // A grammar that can't be loaded leaves the file uncolored, and still Plain.
            () => {},
          );
        }
        update(update: ViewUpdate) {
          if (!this.parser) return;
          // A file that grew past the limit by paste or reload is no longer colored.
          if (update.state.doc.length > CODE_FILE_COLOR_LIMIT) {
            this.parser = null;
            this.tree = null;
            this.fragments = [];
            this.decorations = Decoration.none;
            return;
          }
          if (update.docChanged || update.viewportChanged) {
            this.decorations = this.build(update.view, update);
          }
        }
        destroy() {
          this.gone = true;
        }
        build(view: EditorView, update?: ViewUpdate): DecorationSet {
          const { parser } = this;
          if (!parser) return Decoration.none;
          if (update?.docChanged || !this.tree) {
            if (update?.docChanged) {
              this.fragments = TreeFragment.applyChanges(this.fragments, changedRanges(update));
            }
            this.tree = parser.parse(view.state.doc.toString(), this.fragments);
            this.fragments = TreeFragment.addTree(this.tree, this.fragments);
          }
          const marks: Range<Decoration>[] = [];
          for (const { from, to } of view.visibleRanges) {
            highlightTree(
              this.tree,
              codeStyle,
              (start, end, classes) =>
                marks.push(Decoration.mark({ class: classes }).range(start, end)),
              from,
              to,
            );
          }
          return Decoration.set(marks, true);
        }
      },
      { decorations: (plugin) => plugin.decorations },
    ),
  ];
}
