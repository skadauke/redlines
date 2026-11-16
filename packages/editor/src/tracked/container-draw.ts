// The drawing of HTML containers (blocks/containers.ts has what they are): a summary line with its
// triangle, the summary's tags hidden, a `<details>` with no summary drawn as a "Details" row, the
// Markdown inside a `<div align>` aligned, a closed section's pending changes as a count on its
// summary line, and a faint bracket in the margin around the sections the caret is in.

import { type EditorState, type Range } from '@codemirror/state';
import { Decoration, EditorView, layer, RectangleMarker, WidgetType } from '@codemirror/view';
import {
  type Container,
  containersOf,
  enclosing,
  headLine,
  isOpen,
  setFold,
} from '../blocks/containers.ts';

/** What the drawing adds to the tracked layer's display. */
export interface ContainerDrawing {
  ranges: Range<Decoration>[];
  /** Text the caret steps over, drawn as nothing or as a widget in place of it. */
  atoms: { from: number; to: number }[];
}

/** The triangle, and the label of a section with no summary. */
class SummaryWidget extends WidgetType {
  readonly from: number;
  readonly open: boolean;
  readonly label: string | null;
  constructor(from: number, open: boolean, label: string | null) {
    super();
    this.from = from;
    this.open = open;
    this.label = label;
  }
  override eq(other: SummaryWidget): boolean {
    return other.from === this.from && other.open === this.open && other.label === this.label;
  }
  override toDOM(view: EditorView): HTMLElement {
    const dom = document.createElement('span');
    dom.className = 'rl-fold-row';
    const triangle = document.createElement('span');
    triangle.className = `rl-fold-triangle${this.open ? ' rl-fold-open' : ''}`;
    triangle.setAttribute('role', 'button');
    triangle.setAttribute('aria-expanded', String(this.open));
    triangle.setAttribute('aria-label', this.open ? 'Close section' : 'Open section');
    triangle.setAttribute('data-rl-title', this.open ? 'Close the section' : 'Open the section');
    triangle.textContent = '▶';
    triangle.addEventListener('mousedown', (event) => {
      event.preventDefault();
      view.dispatch({ effects: setFold.of({ from: this.from, open: !this.open }) });
    });
    dom.append(triangle);
    if (this.label !== null) {
      const label = document.createElement('span');
      label.className = 'rl-fold-label';
      label.textContent = this.label;
      dom.append(label);
    }
    return dom;
  }
  override ignoreEvent(): boolean {
    return true;
  }
}

/** The count of a closed section's pending changes, on its summary line. */
class CountWidget extends WidgetType {
  readonly count: number;
  constructor(count: number) {
    super();
    this.count = count;
  }
  override eq(other: CountWidget): boolean {
    return other.count === this.count;
  }
  override toDOM(): HTMLElement {
    const dom = document.createElement('span');
    dom.className = 'rl-fold-count';
    const text = this.count === 1 ? '1 change' : `${this.count} changes`;
    dom.textContent = text;
    dom.setAttribute('data-rl-title', `${text} inside: open the section to see them`);
    return dom;
  }
}

/** Whether `container` is hidden away inside a closed section. */
function folded(state: EditorState, container: Container, all: readonly Container[]): boolean {
  for (let p = container.parent; p !== -1; p = all[p]!.parent) {
    if (!isOpen(state, all[p]!)) return true;
  }
  return false;
}

/**
 * The decorations of the containers. `changes(from, to)` says how many pending changes there are
 * in a stretch of the document, so that a closed section shows them.
 */
export function drawContainers(
  state: EditorState,
  changes: (from: number, to: number) => number,
): ContainerDrawing {
  const ranges: Range<Decoration>[] = [];
  const atoms: ContainerDrawing['atoms'] = [];
  const { doc } = state;
  const all = containersOf(state);
  for (const container of all) {
    if (folded(state, container, all)) continue;
    const open = isOpen(state, container);
    if (container.kind === 'details') {
      const row = container.summary ?? doc.lineAt(container.from);
      if (container.summary) {
        const { from, to, textFrom, textTo } = container.summary;
        ranges.push(
          Decoration.line({ class: 'rl-summary-line' }).range(from),
          Decoration.widget({
            widget: new SummaryWidget(container.from, open, null),
            side: -1,
          }).range(from),
          Decoration.replace({}).range(from, textFrom),
          Decoration.replace({}).range(textTo, to),
        );
        if (textFrom < textTo) {
          ranges.push(Decoration.mark({ class: 'rl-summary-text' }).range(textFrom, textTo));
        }
        atoms.push({ from, to: textFrom }, { from: textTo, to });
      } else {
        ranges.push(
          Decoration.line({ class: 'rl-summary-line' }).range(row.from),
          Decoration.replace({ widget: new SummaryWidget(container.from, open, 'Details') }).range(
            row.from,
            row.to,
          ),
        );
        atoms.push({ from: row.from, to: row.to });
      }
      if (!open) {
        const count = changes(container.bodyFrom, container.end);
        if (count > 0) {
          ranges.push(
            Decoration.widget({ widget: new CountWidget(count), side: 2 }).range(row.to),
            Decoration.line({ class: 'rl-summary-changes' }).range(row.from),
          );
        }
      }
    } else if (container.align && container.align !== 'left') {
      const last = doc.lineAt(container.closer?.from ?? container.end).number;
      for (let n = doc.lineAt(container.bodyFrom).number; n < last; n++) {
        ranges.push(
          Decoration.line({ class: `rl-align-${container.align}` }).range(doc.line(n).from),
        );
      }
    }
  }
  return { ranges, atoms };
}

/** A faint bracket, in the margin, around each section that the caret is in. */
function bracketMarkers(view: EditorView): RectangleMarker[] {
  const { state } = view;
  const head = state.selection.main.head;
  const markers: RectangleMarker[] = [];
  const line = view.contentDOM.querySelector('.cm-line');
  if (!line) return markers;
  const base = view.scrollDOM.getBoundingClientRect();
  const lineRect = line.getBoundingClientRect();
  const padding = parseFloat(getComputedStyle(line).paddingLeft) || 0;
  const left = lineRect.left + padding - base.left + view.scrollDOM.scrollLeft;
  for (const container of enclosing(state, head)) {
    if (!isOpen(state, container)) continue;
    const first = view.lineBlockAt(headLine(state, container).from);
    const last = container.closer
      ? view.lineBlockAt(container.closer.from)
      : view.lineBlockAt(container.end);
    // Block tops are the document's; the layer's origin is the scroller's content.
    const shift = view.documentTop - (base.top - view.scrollDOM.scrollTop);
    const top = first.top + shift;
    const bottom = (container.closer ? last.top : last.bottom) + shift;
    if (bottom <= top) continue;
    markers.push(new RectangleMarker('rl-container-bracket', left - 17, top, 2, bottom - top));
  }
  return markers;
}

export const containerBracket = [
  layer({
    above: false,
    class: 'rl-bracket-layer',
    markers: bracketMarkers,
    update: (update) => update.selectionSet || update.docChanged || update.viewportChanged,
  }),
  EditorView.baseTheme({
    '.rl-container-bracket': {
      backgroundColor: 'var(--rl-rule)',
      opacity: '0.7',
      borderRadius: '1px',
    },
    '.rl-summary-line': { paddingTop: '0.3em', paddingBottom: '0.3em' },
    '.rl-fold-row': { display: 'inline-flex', alignItems: 'baseline', gap: '0.5em' },
    '.rl-fold-triangle': {
      display: 'inline-block',
      width: '1.1em',
      marginLeft: '-1.4em',
      textAlign: 'center',
      fontSize: '0.62em',
      color: 'var(--rl-ink-3)',
      cursor: 'pointer',
      userSelect: 'none',
      transition: 'transform 0.12s',
      verticalAlign: '0.12em',
    },
    '.rl-fold-triangle.rl-fold-open': { transform: 'rotate(90deg)' },
    '.rl-fold-label': { color: 'var(--rl-ink-3)' },
    '.rl-summary-text': { fontWeight: '600' },
    '.rl-fold-count': {
      marginLeft: '0.8em',
      fontSize: 'var(--rl-size-ui-small-scaled, var(--rl-size-ui-small))',
      color: 'var(--rl-ink-3)',
      backgroundColor: 'var(--rl-tint)',
      borderRadius: '5px',
      padding: '0 0.45em',
    },
    '.rl-align-center': { textAlign: 'center' },
    '.rl-align-right': { textAlign: 'right' },
    '.rl-align-justify': { textAlign: 'justify' },
  }),
];
