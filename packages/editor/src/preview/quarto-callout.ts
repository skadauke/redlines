// Quarto's callouts in the preview (docs/research/quarto.md, decision 2): a div with a class
// `callout-note`, `-tip`, `-important`, `-warning` or `-caution` is drawn in the alert's box, with
// the alert's classes, so that one design holds both. The opening fence becomes the title row (an
// icon, the title from `title="…"` or the body's first heading, and a chevron when the callout can
// fold), and the closing fence is hidden. The fences show as source while the caret is on them,
// and a callout that is open to the caret never stays folded. Only a pandoc file has divs.

import {
  type EditorState,
  type Extension,
  type Range,
  StateEffect,
  StateField,
} from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view';
import { dialectFacet } from '../dialect.ts';
import { viewModeField } from '../tracked/field.ts';
import { calloutMenuEffect, calloutName, drawChevron, drawIcon } from './callout.ts';
import { calloutsOf, divsOf, type QuartoCallout } from './divs.ts';

/** A press of a callout's chevron: the position of its opening fence. */
const toggleFold = StateEffect.define<number>();

/**
 * The callouts whose fold is the opposite of what they were written with, as the positions of their
 * opening fences. A fold is a way of reading, so it is never in the file.
 */
const turned = StateField.define<readonly number[]>({
  create: () => [],
  update(value, tr) {
    // A position that no longer holds an opening fence is dropped, so that it never marks another.
    let next = tr.docChanged
      ? value
          .map((pos) => tr.changes.mapPos(pos, -1))
          .filter((pos) => {
            const line = tr.state.doc.lineAt(pos);
            return line.from === pos && /^ {0,3}:{3,}/.test(line.text);
          })
      : value;
    for (const effect of tr.effects) {
      if (!effect.is(toggleFold)) continue;
      next = next.includes(effect.value)
        ? next.filter((pos) => pos !== effect.value)
        : [...next, effect.value];
    }
    return next;
  },
});

class QuartoTitleWidget extends WidgetType {
  readonly callout: QuartoCallout;
  readonly folded: boolean;

  constructor(callout: QuartoCallout, folded: boolean) {
    super();
    this.callout = callout;
    this.folded = folded;
  }

  override eq(other: QuartoTitleWidget): boolean {
    return (
      other.callout.type === this.callout.type &&
      other.callout.title === this.callout.title &&
      other.callout.collapse === this.callout.collapse &&
      other.callout.attributes['title'] === this.callout.attributes['title'] &&
      other.folded === this.folded
    );
  }

  override toDOM(view: EditorView): HTMLElement {
    const { callout, folded } = this;
    const name = callout.title === '' ? calloutName(callout.type) : callout.title;
    const head = document.createElement('span');
    head.className = 'rl-callout-head rl-quarto-head';
    head.setAttribute('role', 'group');
    head.setAttribute('aria-label', `${calloutName(callout.type)} callout`);
    head.append(drawIcon(callout.type));
    const text = document.createElement('span');
    text.className = 'rl-callout-name';
    text.textContent = name;
    head.append(text);
    head.append(this.menuButton(view, head));
    if (callout.collapse !== null) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'rl-callout-fold';
      button.setAttribute('aria-label', folded ? 'Show the callout' : 'Fold the callout');
      button.setAttribute('aria-expanded', String(!folded));
      button.append(drawChevron());
      button.addEventListener('mousedown', (event) => {
        event.preventDefault();
        if (event.button !== 0) return;
        const at = view.posAtDOM(head);
        view.dispatch({ effects: toggleFold.of(view.state.doc.lineAt(at).from) });
      });
      head.append(button);
    }
    return head;
  }

  /** The button of the type and title menu: the formatting plugin answers (`calloutMenuEffect`). */
  private menuButton(view: EditorView, head: HTMLElement): HTMLButtonElement {
    const { callout } = this;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'rl-callout-menu';
    button.setAttribute('aria-label', 'Callout type and title');
    button.setAttribute('aria-haspopup', 'menu');
    button.setAttribute('aria-expanded', 'false');
    button.append(drawChevron());
    const ask = () => {
      const line = view.state.doc.lineAt(view.posAtDOM(head));
      // A place inside the fence's colons, which a format change takes for the callout it opens.
      view.dispatch({
        effects: calloutMenuEffect.of({
          pos: line.from + 4,
          type: callout.type,
          anchor: button,
          quarto: { title: callout.attributes['title'] ?? null },
        }),
      });
    };
    button.addEventListener('mousedown', (event) => {
      event.preventDefault();
      if (event.button !== 0 || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      ask();
    });
    button.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'ArrowDown') return;
      if (event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return;
      event.preventDefault();
      event.stopPropagation();
      ask();
    });
    return button;
  }

  override ignoreEvent(event: Event): boolean {
    return (
      event.target instanceof Element &&
      event.target.closest('.rl-callout-fold, .rl-callout-menu') !== null
    );
  }
}

const HIDDEN = Decoration.replace({});

/** Whether a selection touches the lines `from` to `to` (1-based, inclusive). */
function touchesLines(state: EditorState, from: number, to: number): boolean {
  const start = state.doc.line(from).from;
  const end = state.doc.line(to).to;
  return state.selection.ranges.some((range) => range.from <= end && range.to >= start);
}

/** Whether any line before line `n` holds text. */
function hasTextBefore(doc: EditorState['doc'], n: number): boolean {
  for (let i = n - 1; i >= 1; i--) if (doc.line(i).text.trim() !== '') return true;
  return false;
}

/** The decorations of the callouts of `state`; none outside a pandoc file or in Plain. */
export function quartoCalloutDecorations(state: EditorState): DecorationSet {
  if (state.facet(dialectFacet) !== 'pandoc') return Decoration.none;
  if (state.field(viewModeField, false) === 'raw') return Decoration.none;
  const { doc } = state;
  const callouts = calloutsOf(doc, divsOf(doc));
  if (callouts.length === 0) return Decoration.none;
  const flipped = state.field(turned);
  const ranges: Range<Decoration>[] = [];
  const classes = new Map<number, Set<string>>();
  const mark = (line: number, ...names: string[]) => {
    const at = doc.line(line).from;
    const set = classes.get(at) ?? new Set<string>();
    for (const name of names) set.add(name);
    classes.set(at, set);
  };
  // A callout inside another is drawn by the outer box alone: one box, one title.
  const outer: QuartoCallout[] = [];
  for (const callout of callouts) {
    const last = outer.at(-1);
    if (last && callout.open < last.close) continue;
    outer.push(callout);
  }
  for (const callout of outer) {
    const first = doc.line(callout.open);
    const closer = doc.line(callout.close);
    const asWritten = callout.collapse === true;
    const opened = touchesLines(state, callout.open, callout.close);
    const folded = !opened && asWritten !== flipped.includes(first.from);
    const onOpen = touchesLines(state, callout.open, callout.open);
    const onClose = touchesLines(state, callout.close, callout.close);
    const heading =
      callout.attributes['title'] === undefined &&
      callout.title !== '' &&
      callout.open + 1 < callout.close
        ? doc.line(callout.open + 1)
        : null;
    const onHeading = heading !== null && touchesLines(state, heading.number, heading.number);

    const visibleLast = folded ? callout.open : onClose ? callout.close : callout.close - 1;
    const visibleLines = folded ? [callout.open] : lines(callout.open, callout.close);
    for (const n of visibleLines) {
      mark(n, 'rl-callout', 'rl-quarto-callout', `rl-callout-${callout.type}`);
      if (n === callout.open) {
        mark(n, 'rl-callout-first', 'rl-callout-title');
        // The space above the box is outside it, as an alert's is under another block (#389).
        if (hasTextBefore(doc, n)) mark(n, 'rl-space-block-apart');
      }
      if (n === callout.open && onOpen) mark(n, 'rl-callout-active');
      if (n === visibleLast) mark(n, 'rl-callout-last');
    }
    if (!onOpen) {
      const widget = new QuartoTitleWidget(callout, folded);
      ranges.push(Decoration.replace({ widget }).range(first.from, first.to));
    }
    if (folded) {
      // The body and the closing fence go with their line breaks, so that the title stands alone.
      if (closer.to > first.to) ranges.push(HIDDEN.range(first.to, closer.to));
      continue;
    }
    if (heading && !onHeading && !onOpen) {
      ranges.push(HIDDEN.range(first.to, heading.to));
    }
    if (!onClose) {
      const before = doc.line(callout.close - 1);
      ranges.push(HIDDEN.range(before.to, closer.to));
    }
  }
  for (const [from, set] of classes) {
    ranges.push(Decoration.line({ class: [...set].join(' ') }).range(from));
  }
  return Decoration.set(ranges, true);

  function lines(from: number, to: number): number[] {
    return Array.from({ length: to - from + 1 }, (_, i) => from + i);
  }
}

const field = StateField.define<DecorationSet>({
  create: (state) => quartoCalloutDecorations(state),
  update: (value, tr) =>
    tr.docChanged ||
    tr.selection !== undefined ||
    tr.startState.field(turned) !== tr.state.field(turned) ||
    tr.startState.facet(dialectFacet) !== tr.state.facet(dialectFacet) ||
    tr.startState.field(viewModeField, false) !== tr.state.field(viewModeField, false)
      ? quartoCalloutDecorations(tr.state)
      : value,
  provide: (f) => EditorView.decorations.from(f),
});

/** Quarto's callouts, drawn in the alert's box. Needs the preview's theme for the box. */
export function quartoCallouts(): Extension {
  return [turned, field];
}

/** The decorations that the callouts hold, for tests. */
export function quartoCalloutField(): StateField<DecorationSet> {
  return field;
}
