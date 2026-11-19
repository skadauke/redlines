// A pandoc div that is not a callout (`::: {.columns}`, `::: {.column width="50%"}`, a custom class)
// in the preview: its opening fence is drawn as a small, quiet chip with its class, never as a line
// of source, its closing fence is hidden, and what is inside keeps reading as ordinary blocks. The
// fences show as source while the caret is on them. The callouts are drawn by `quarto-callout.ts`.
// Only a `.qmd` or `.Rmd` file has divs (the dialect, format §9.1).

import { type EditorState, type Extension, type Range, StateField } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view';
import { dialectFacet } from '../dialect.ts';
import { viewModeField } from '../tracked/field.ts';
import { divsOf, QUARTO_CALLOUTS, type Div } from './divs.ts';

/** What the chip says: the classes, then the other attributes, without the braces. */
function chipText(div: Div): string {
  const parts = [...div.classes];
  for (const [key, value] of Object.entries(div.attributes)) {
    parts.push(key === 'id' ? `#${value}` : `${key}=${value}`);
  }
  return parts.join(' ');
}

class DivChip extends WidgetType {
  readonly text: string;

  constructor(text: string) {
    super();
    this.text = text;
  }

  override eq(other: DivChip): boolean {
    return other.text === this.text;
  }

  override toDOM(): HTMLElement {
    const chip = document.createElement('span');
    chip.className = 'rl-div-chip';
    chip.textContent = this.text;
    chip.setAttribute('role', 'note');
    chip.setAttribute('aria-label', `Start of a block: ${this.text}`);
    return chip;
  }
}

const HIDDEN = Decoration.replace({});

/** Whether a selection touches the lines `from` to `to` (1-based, inclusive). */
function touchesLines(state: EditorState, from: number, to: number): boolean {
  const start = state.doc.line(from).from;
  const end = state.doc.line(to).to;
  return state.selection.ranges.some((range) => range.from <= end && range.to >= start);
}

/** The decorations of the divs of `state` that are not callouts. */
function divDecorations(state: EditorState): DecorationSet {
  if (state.facet(dialectFacet) !== 'pandoc') return Decoration.none;
  if (state.field(viewModeField, false) === 'raw') return Decoration.none;
  const { doc } = state;
  const ranges: Range<Decoration>[] = [];
  for (const div of divsOf(doc)) {
    if (div.close === 0) continue;
    if (QUARTO_CALLOUTS.some((kind) => div.classes.includes(`callout-${kind}`))) continue;
    // A div with no class, id or key (`::: {}`) has nothing to name.
    const text = chipText(div);
    const opener = doc.line(div.open);
    const closer = doc.line(div.close);
    if (!touchesLines(state, div.open, div.open)) {
      ranges.push(Decoration.line({ class: 'rl-div-fence' }).range(opener.from));
      ranges.push(
        Decoration.replace({ widget: new DivChip(text === '' ? 'div' : text) }).range(
          opener.from,
          opener.to,
        ),
      );
    }
    if (!touchesLines(state, div.close, div.close) && div.close > div.open) {
      // The closing fence goes with its line break, so that it leaves no empty line.
      const before = doc.line(div.close - 1);
      ranges.push(HIDDEN.range(before.to, closer.to));
    }
  }
  return Decoration.set(ranges, true);
}

const field = StateField.define<DecorationSet>({
  create: (state) => divDecorations(state),
  update: (value, tr) =>
    tr.docChanged ||
    tr.selection !== undefined ||
    tr.startState.facet(dialectFacet) !== tr.state.facet(dialectFacet) ||
    tr.startState.field(viewModeField, false) !== tr.state.field(viewModeField, false)
      ? divDecorations(tr.state)
      : value,
  provide: (f) => EditorView.decorations.from(f),
});

const theme = EditorView.baseTheme({
  '.rl-div-fence': { lineHeight: '1.4' },
  // The chip is small and quiet, as the other chips are: the grays, the interface's small size.
  '.rl-div-chip': {
    display: 'inline-block',
    fontFamily: 'var(--rl-font-ui)',
    fontSize: 'var(--rl-size-ui-small)',
    fontWeight: '400',
    color: 'var(--rl-ink-2)',
    backgroundColor: 'var(--rl-tint)',
    borderRadius: '5px',
    padding: '0 0.4em',
    lineHeight: '1.4',
    cursor: 'default',
  },
});

/** The divs that are not callouts, drawn as a quiet chip and no fences. */
export function quartoDivs(): Extension {
  return [field, theme];
}
