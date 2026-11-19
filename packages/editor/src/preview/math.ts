// Math (#1173): `$x^2$` inline and `$$ E = mc^2 $$` as a display, drawn as MathML in a Markdown or a
// Quarto file (GitHub draws both too). The source shows while the caret is in it, as any syntax
// does. The reading follows pandoc: an opening `$` has no space after it, a closing `$` none before
// it and no digit after it, so "costs $5 and $6" is no math; `\$` is a dollar; code (a fence, a code
// span), front matter, a comment marker and the ledger are text. A display that stands alone across
// lines (`$$` on a line, the formula, `$$` on a line) is a block; a display with a Quarto label
// after it (`{#eq-mass}`) takes the equation's number.
//
// The engine is the host's to load (`EditorOptions.math`, Temml in the app, which writes MathML that
// the web view draws with no fonts of its own), so that a page that doesn't (the website's embed)
// never holds it, and a document with no math never loads it. Until it is loaded, the source shows.

import {
  type EditorState,
  type Extension,
  Facet,
  type Range,
  StateEffect,
  StateField,
  type Text,
} from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from '@codemirror/view';
import { parsedField, viewModeField } from '../tracked/field.ts';
import { blanked, targetsOf } from './quarto-refs.ts';

/** What the host gives to draw math: TeX in, MathML out. */
export interface MathEngine {
  renderToString(tex: string, options?: { displayMode?: boolean; throwOnError?: boolean }): string;
}

/** The host's way to load the engine; without it the source stays. */
export const mathFacet = Facet.define<
  () => Promise<MathEngine>,
  (() => Promise<MathEngine>) | null
>({ combine: (values) => values[0] ?? null });

/** A formula in the text. */
export interface MathRange {
  from: number;
  to: number;
  tex: string;
  display: boolean;
  /** A display that fills its lines: drawn as a block. */
  block: boolean;
  /** The Quarto label after a display (`eq-mass`), which numbers it. */
  label?: string;
}

const FENCE = /^[ \t]*(`{3,}|~{3,})/;
const ATTRIBUTE = /^[ \t]*\{[^}\n]*#(eq-[\w][\w:.-]*)[^}\n]*\}/;
const kept = new WeakMap<Text, MathRange[]>();

/** The index of the unescaped `$$` at or after `from`, or -1. */
function closingDisplay(text: string, from: number): number {
  for (let i = from; i < text.length - 1; i++) {
    if (text[i] === '\\') i++;
    else if (text[i] === '$' && text[i + 1] === '$') return i;
  }
  return -1;
}

/** The index of the `$` that closes an inline formula opened before `from`, or -1. */
function closingInline(text: string, from: number): number {
  for (let i = from; i < text.length; i++) {
    const char = text[i];
    if (char === '\\') i++;
    else if (char === '$') {
      // No space before it, no digit after it; a `$$` is not a close.
      if (/\s/.test(text[i - 1] ?? ' ') || text[i + 1] === '$' || /\d/.test(text[i + 1] ?? '')) {
        return -1;
      }
      return i;
    }
  }
  return -1;
}

function read(doc: Text): MathRange[] {
  const known = kept.get(doc);
  if (known) return known;
  const found: MathRange[] = [];
  const comment = { open: false };
  let code: string | null = null;
  let n = 1;
  if (doc.lines > 1 && /^---[ \t]*$/.test(doc.line(1).text)) {
    for (let i = 2; i <= doc.lines; i++) {
      if (/^(?:---|\.\.\.)[ \t]*$/.test(doc.line(i).text)) {
        n = i + 1;
        break;
      }
    }
  }
  for (; n <= doc.lines; n++) {
    const line = doc.line(n);
    const text = blanked(line.text, comment);
    const fence = FENCE.exec(line.text);
    if (code !== null) {
      if (fence?.[1] && fence[1][0] === code[0] && fence[1].length >= code.length) code = null;
      continue;
    }
    if (fence?.[1]) {
      code = fence[1];
      continue;
    }
    if (!text.includes('$')) continue;
    // A display across lines: `$$` alone on a line, the formula, `$$` (and a label) on a line.
    if (/^\s*\$\$\s*$/.test(text) && line.text === text) {
      for (let m = n + 1; m <= Math.min(doc.lines, n + 200); m++) {
        const close = doc.line(m);
        if (blanked(close.text, { open: false }) !== close.text) break;
        const done = /^\s*\$\$[ \t]*(\{[^}\n]*\})?[ \t]*$/.exec(close.text);
        if (!done) continue;
        const tex = doc.sliceString(line.to + 1, close.from - 1).trim();
        const label = ATTRIBUTE.exec(done[1] ?? '')?.[1];
        if (tex) {
          found.push({
            from: line.from,
            to: close.to,
            tex,
            display: true,
            block: true,
            ...(label ? { label } : {}),
          });
          n = m;
        }
        break;
      }
      continue;
    }
    // Formulas inside a line.
    const plain = (from: number, to: number) => line.text.slice(from, to) === text.slice(from, to);
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '\\') {
        i++;
        continue;
      }
      if (text[i] !== '$') continue;
      if (text[i + 1] === '$') {
        const close = closingDisplay(text, i + 2);
        const tex = close < 0 ? '' : text.slice(i + 2, close).trim();
        if (close < 0 || !tex || !plain(i, close + 2)) {
          i += 1;
          continue;
        }
        let to = close + 2;
        const label = ATTRIBUTE.exec(text.slice(to));
        if (label && plain(to, to + label[0].length)) to += label[0].length;
        const whole = text.slice(0, i).trim() === '' && text.slice(to).trim() === '';
        found.push({
          from: line.from + i,
          to: line.from + to,
          tex,
          display: true,
          block: whole,
          ...(label?.[1] ? { label: label[1] } : {}),
        });
        i = to - 1;
        continue;
      }
      if (/[\s$]/.test(text[i + 1] ?? ' ')) continue;
      const close = closingInline(text, i + 1);
      if (close < 0 || !plain(i, close + 1)) continue;
      found.push({
        from: line.from + i,
        to: line.from + close + 1,
        tex: text.slice(i + 1, close),
        display: false,
        block: false,
      });
      i = close;
    }
  }
  kept.set(doc, found);
  return found;
}

/** The formulas of a document, in order. */
export function mathOf(doc: Text): readonly MathRange[] {
  return read(doc);
}

const setEngine = StateEffect.define<MathEngine | null>();

const engineField = StateField.define<MathEngine | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setEngine)) return effect.value;
    return value;
  },
});

class MathWidget extends WidgetType {
  readonly range: MathRange;
  readonly engine: MathEngine;
  readonly number: string | undefined;

  constructor(range: MathRange, engine: MathEngine, number: string | undefined) {
    super();
    this.range = range;
    this.engine = engine;
    this.number = number;
  }

  override eq(other: MathWidget): boolean {
    return (
      other.engine === this.engine &&
      other.range.tex === this.range.tex &&
      other.range.display === this.range.display &&
      other.range.block === this.range.block &&
      other.number === this.number
    );
  }

  override get estimatedHeight(): number {
    return this.range.block ? 48 : -1;
  }

  override toDOM(): HTMLElement {
    const { tex, display, block } = this.range;
    const box = document.createElement(block ? 'div' : 'span');
    box.className = `rl-math${display ? ' rl-math-display' : ''}${block ? ' rl-math-block' : ''}`;
    box.setAttribute('role', 'math');
    box.setAttribute('aria-label', tex);
    const drawn = document.createElement('span');
    drawn.className = 'rl-math-formula';
    try {
      drawn.innerHTML = this.engine.renderToString(tex, {
        displayMode: display,
        throwOnError: false,
      });
    } catch {
      drawn.textContent = tex;
    }
    box.append(drawn);
    if (this.number) {
      const label = document.createElement('span');
      label.className = 'rl-math-number';
      label.textContent = `(${this.number})`;
      box.append(label);
    }
    return box;
  }
}

/** The drawn formulas of `state`: none in Plain, with no engine, or in a file with no math. */
export function mathDecorations(state: EditorState): DecorationSet {
  if (state.field(viewModeField, false) === 'raw') return Decoration.none;
  const engine = state.field(engineField, false);
  if (!engine) return Decoration.none;
  const formulas = read(state.doc);
  if (formulas.length === 0) return Decoration.none;
  const ledger = state.field(parsedField, false)?.ledgerRange;
  const targets = formulas.some((formula) => formula.label) ? targetsOf(state.doc) : null;
  const ranges: Range<Decoration>[] = [];
  for (const formula of formulas) {
    if (ledger && formula.from >= ledger.from) break;
    if (state.selection.ranges.some((r) => r.from <= formula.to && r.to >= formula.from)) continue;
    const number = formula.label
      ? targets?.get(formula.label)?.text.replace(/^\D+/, '')
      : undefined;
    const widget = new MathWidget(formula, engine, number);
    ranges.push(
      Decoration.replace({ widget, block: formula.block }).range(formula.from, formula.to),
    );
  }
  return Decoration.set(ranges, true);
}

const field = StateField.define<DecorationSet>({
  create: (state) => mathDecorations(state),
  update: (value, tr) =>
    tr.docChanged ||
    tr.selection !== undefined ||
    tr.effects.some((effect) => effect.is(setEngine)) ||
    tr.startState.field(viewModeField, false) !== tr.state.field(viewModeField, false)
      ? mathDecorations(tr.state)
      : value,
  provide: (f) => [
    EditorView.decorations.from(f),
    EditorView.atomicRanges.of((v) => v.state.field(f)),
  ],
});

/** Loads the engine once, the first time the document has a formula. */
const loader = ViewPlugin.fromClass(
  class {
    started = false;
    view: EditorView;

    constructor(view: EditorView) {
      this.view = view;
      this.check();
    }

    update(update: ViewUpdate) {
      if (update.docChanged) this.check();
    }

    check() {
      if (this.started) return;
      const load = this.view.state.facet(mathFacet);
      if (!load || read(this.view.state.doc).length === 0) return;
      this.started = true;
      load().then(
        (engine) => this.view.dispatch({ effects: setEngine.of(engine) }),
        () => {
          this.started = false;
        },
      );
    }
  },
);

const theme = EditorView.baseTheme({
  '.rl-math': { color: 'inherit' },
  '.rl-math math': { fontSize: '1.08em' },
  '.rl-math-display:not(.rl-math-block)': { display: 'inline-block' },
  '.rl-math-block': {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '1em',
    padding: '0.4em 0',
    position: 'relative',
  },
  '.rl-math-number': {
    position: 'absolute',
    right: '0',
    color: 'var(--rl-ink-2)',
  },
});

/** Math drawn from its source, with the engine the host loads. */
export function math(): Extension {
  return [engineField, field, loader, theme];
}
