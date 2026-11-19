// A heading's attributes in a pandoc file (`## Methods {#sec-methods}`, `# Intro {.unnumbered}`):
// drawn as a small, quiet chip after the heading's text, never at heading size. The braces are
// syntax: the chip shows what is inside them, and the source (`{#sec-methods}`) shows while the
// caret is in the attributes, as other hidden syntax does, in the same small size. Only a `.qmd` or
// `.Rmd` file has them (the dialect, format §9.1); in a Markdown file `{#id}` is text.

import { syntaxTree } from '@codemirror/language';
import { type Extension, type Range } from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from '@codemirror/view';
import { dialectFacet } from '../dialect.ts';
import { viewModeField } from '../tracked/field.ts';

/**
 * The attributes at the end of a heading's line: braces that hold an id, a class or a key, after a
 * space, followed by nothing but the markers of changes. The groups are the whitespace before, the
 * braces, and the markers after.
 */
const ATTRIBUTES =
  /([ \t]+)(\{[ \t]*(?:[#.][^\s{}]|-(?=[ \t]*\})|[\w:-]+=)[^{}\n]*\})((?:<!--[^]*?-->)*)[ \t]*$/;

/** The attributes of a heading's line, and where they are: `from`–`to` are the braces. */
export function headingAttributes(
  text: string,
): { from: number; to: number; inner: string } | null {
  const found = ATTRIBUTES.exec(text);
  if (!found) return null;
  const from = found.index + (found[1]?.length ?? 0);
  const braces = found[2] ?? '';
  return { from, to: from + braces.length, inner: braces.slice(1, -1).trim() };
}

export class ChipWidget extends WidgetType {
  readonly text: string;

  constructor(text: string) {
    super();
    this.text = text;
  }

  override eq(other: ChipWidget): boolean {
    return other.text === this.text;
  }

  override toDOM(): HTMLElement {
    const chip = document.createElement('span');
    chip.className = 'rl-attr-chip';
    chip.textContent = this.text;
    return chip;
  }
}

const SOURCE = Decoration.mark({ class: 'rl-attr-source' });

/** The decorations of the visible headings, and the chips among them, which the caret skips. */
function draw(view: EditorView): { all: DecorationSet; chips: DecorationSet } {
  const { state } = view;
  const none = { all: Decoration.none, chips: Decoration.none };
  if (state.facet(dialectFacet) !== 'pandoc') return none;
  if (state.field(viewModeField, false) === 'raw') return none;
  const ranges: Range<Decoration>[] = [];
  const chips: Range<Decoration>[] = [];
  const seen = new Set<number>();
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (ref) => {
        const name = ref.name;
        let line;
        if (name.startsWith('ATXHeading')) line = state.doc.lineAt(ref.from);
        else if (name.startsWith('SetextHeading')) {
          // The text line above the underline.
          const mark = ref.node.getChild('HeaderMark');
          if (!mark) return;
          const underline = state.doc.lineAt(mark.from);
          if (underline.number < 2) return;
          line = state.doc.line(underline.number - 1);
        } else return;
        if (seen.has(line.from)) return;
        seen.add(line.from);
        const found = headingAttributes(line.text);
        if (!found) return;
        const start = line.from + found.from;
        const end = line.from + found.to;
        const touched = state.selection.ranges.some((r) => r.from <= end && r.to >= start);
        if (touched) ranges.push(SOURCE.range(start, end));
        else {
          const widget = new ChipWidget(found.inner);
          const chip = Decoration.replace({ widget }).range(start, end);
          ranges.push(chip);
          chips.push(chip);
        }
      },
    });
  }
  return { all: Decoration.set(ranges, true), chips: Decoration.set(chips, true) };
}

const plugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    chips: DecorationSet;

    constructor(view: EditorView) {
      ({ all: this.decorations, chips: this.chips } = draw(view));
    }

    update(update: ViewUpdate): void {
      if (
        update.docChanged ||
        update.selectionSet ||
        update.viewportChanged ||
        update.startState.facet(dialectFacet) !== update.state.facet(dialectFacet) ||
        update.startState.field(viewModeField, false) !== update.state.field(viewModeField, false)
      ) {
        ({ all: this.decorations, chips: this.chips } = draw(update.view));
      }
    }
  },
  {
    decorations: (v) => v.decorations,
    provide: (p) => EditorView.atomicRanges.of((view) => view.plugin(p)?.chips ?? Decoration.none),
  },
);

/** The chip is small and quiet, as the other chips are: the grays, the interface's small size. */
const theme = EditorView.baseTheme({
  '.rl-attr-chip, .rl-attr-source': {
    fontFamily: 'var(--rl-font-ui)',
    fontSize: 'var(--rl-size-ui-small)',
    fontWeight: '400',
    fontStyle: 'normal',
    letterSpacing: 'normal',
    color: 'var(--rl-ink-2)',
  },
  '.rl-attr-chip': {
    display: 'inline-block',
    verticalAlign: 'middle',
    backgroundColor: 'var(--rl-tint)',
    borderRadius: '5px',
    padding: '0 0.4em',
    lineHeight: '1.4',
    cursor: 'default',
  },
});

/** A heading's attributes, drawn as a chip in a pandoc file. */
export function quartoHeadingAttributes(): Extension {
  return [plugin, theme];
}
