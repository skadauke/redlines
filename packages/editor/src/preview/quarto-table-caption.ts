// A table's caption in a pandoc file (`: Who owns what {#tbl-owners}` in the paragraph right above
// or below a pipe table): drawn as a caption, small and quiet, with its label ("Table 1:") where the
// caption names a target, and its attributes as the same chip a heading's are (#1170). The syntax
// (`: ` and the braces) shows while the caret is on the line. Only a `.qmd` or `.Rmd` file has them.

import { syntaxTree } from '@codemirror/language';
import type { EditorState, Extension, Range } from '@codemirror/state';
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
import { tablesField } from '../table/model.ts';
import { ChipWidget, headingAttributes } from './quarto-heading-attrs.ts';
import { targetsOf } from './quarto-refs.ts';

/** A caption line: a colon and a space, then the text. */
const CAPTION = /^:[ \t]+\S/;

class LabelWidget extends WidgetType {
  readonly text: string;

  constructor(text: string) {
    super();
    this.text = text;
  }

  override eq(other: LabelWidget): boolean {
    return other.text === this.text;
  }

  override toDOM(): HTMLElement {
    const label = document.createElement('span');
    label.className = 'rl-table-caption-label';
    label.textContent = this.text;
    return label;
  }
}

const SOURCE = Decoration.mark({ class: 'rl-attr-source' });
const HIDDEN = Decoration.replace({});

/** Whether a table ends on the line above the blank line above `n`, or starts below `n`'s block. */
function besideTable(state: EditorState, n: number): boolean {
  const { doc } = state;
  const tables = state.field(tablesField, false) ?? [];
  const before = n >= 3 && doc.line(n - 1).text.trim() === '' ? doc.line(n - 2) : null;
  if (before && tables.some((t) => t.to >= before.from && t.to <= before.to + 1)) return true;
  const after = n + 2 <= doc.lines && doc.line(n + 1).text.trim() === '' ? doc.line(n + 2) : null;
  return after !== null && tables.some((t) => t.from >= after.from - 1 && t.from <= after.to);
}

function draw(view: EditorView): { all: DecorationSet; atoms: DecorationSet } {
  const { state } = view;
  const none = { all: Decoration.none, atoms: Decoration.none };
  if (state.facet(dialectFacet) !== 'pandoc') return none;
  if (state.field(viewModeField, false) === 'raw') return none;
  const tables = state.field(tablesField, false);
  if (!tables || tables.length === 0) return none;
  const ranges: Range<Decoration>[] = [];
  const atoms: Range<Decoration>[] = [];
  const targets = targetsOf(state.doc);
  const seen = new Set<number>();
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (ref) => {
        if (ref.name !== 'Paragraph' || ref.node.parent?.name !== 'Document') return;
        const line = state.doc.lineAt(ref.from);
        if (seen.has(line.from) || ref.to > line.to + 1) return;
        seen.add(line.from);
        if (!CAPTION.test(line.text) || !besideTable(state, line.number)) return;
        ranges.push(Decoration.line({ class: 'rl-table-caption' }).range(line.from));
        const found = headingAttributes(line.text);
        const touched = state.selection.ranges.some((r) => r.from <= line.to && r.to >= line.from);
        if (touched) {
          ranges.push(SOURCE.range(line.from, line.to));
          return;
        }
        const id = /#(tbl-[\w:.-]*[\w])/.exec(found?.inner ?? '')?.[1];
        const label = id ? targets.get(id)?.text : undefined;
        const prefixEnd = line.from + /^:[ \t]+/.exec(line.text)![0].length;
        const prefix = label
          ? Decoration.replace({ widget: new LabelWidget(`${label}: `) }).range(
              line.from,
              prefixEnd,
            )
          : HIDDEN.range(line.from, prefixEnd);
        ranges.push(prefix);
        atoms.push(prefix);
        if (found) {
          const start = line.from + found.from;
          const chip = Decoration.replace({ widget: new ChipWidget(found.inner) }).range(
            start,
            line.from + found.to,
          );
          ranges.push(chip);
          atoms.push(chip);
        }
      },
    });
  }
  return { all: Decoration.set(ranges, true), atoms: Decoration.set(atoms, true) };
}

const plugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    atoms: DecorationSet;

    constructor(view: EditorView) {
      ({ all: this.decorations, atoms: this.atoms } = draw(view));
    }

    update(update: ViewUpdate): void {
      if (
        update.docChanged ||
        update.selectionSet ||
        update.viewportChanged ||
        update.startState.facet(dialectFacet) !== update.state.facet(dialectFacet) ||
        update.startState.field(viewModeField, false) !== update.state.field(viewModeField, false)
      ) {
        ({ all: this.decorations, atoms: this.atoms } = draw(update.view));
      }
    }
  },
  {
    decorations: (v) => v.decorations,
    provide: (p) => EditorView.atomicRanges.of((view) => view.plugin(p)?.atoms ?? Decoration.none),
  },
);

const theme = EditorView.baseTheme({
  '.rl-table-caption': {
    fontSize: '0.9em',
    color: 'var(--rl-ink-2)',
  },
  '.rl-table-caption-label': { fontWeight: '600', color: 'var(--rl-ink)' },
});

/** A table's caption, drawn as one in a pandoc file. */
export function quartoTableCaptions(): Extension {
  return [plugin, theme];
}
