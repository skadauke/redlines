// Cross-references as chips (docs/research/quarto.md, decision 3): `@fig-plot`, `@tbl-x`, `@eq-x`,
// `@lst-x` and `@sec-x` are drawn as a small chip with the target's label and number ("Figure 2")
// where the target exists in the file, and stay plain text where it doesn't. A press jumps to the
// target. The source shows while the caret is on the token, as any syntax does. The file's labels
// come from `{#fig-x}` attributes (images, tables, divs, headings, equations) and `#| label:` lines
// of chunks, numbered in the order of the document; sections are numbered by their headings.

import {
  type EditorState,
  type Extension,
  type Range,
  StateField,
  type Text,
} from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view';
import { dialectFacet } from '../dialect.ts';
import { parsedField, viewModeField } from '../tracked/field.ts';

/** The kinds of target whose chips are drawn, with the word before the number. */
const KINDS: Readonly<Record<string, string>> = {
  fig: 'Figure',
  tbl: 'Table',
  eq: 'Equation',
  lst: 'Listing',
  sec: 'Section',
};

/** A reference token: `@` and a label of a kind that Quarto numbers (format §3.1, rule 9). */
const TOKEN = /(?<![\w@])@((?:fig|tbl|eq|lst|sec)-[\w][\w:.-]*)(?<![:.-])/g;
const ATTRIBUTE_ID = /\{[^}\n]*?#((?:fig|tbl|eq|lst|sec)-[\w][\w:.-]*)(?<![:.-])[^}\n]*\}/g;
const CHUNK_LABEL = /^#\|\s*label:\s*((?:fig|tbl|eq|lst)-[\w][\w:.-]*)\s*$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const HEADING = /^(#{1,6})[ \t]+\S/;

/** A target: its label's text, "Figure 2", and where it is in the document. */
export interface Target {
  text: string;
  pos: number;
}

/** The targets of a document by their label (`fig-plot`), the first of each label. */
export function targetsOf(doc: Text): Map<string, Target> {
  const targets = new Map<string, Target>();
  const counts: Record<string, number> = {};
  const levels = [0, 0, 0, 0, 0, 0];
  let code: string | null = null;
  let front = false;
  const add = (label: string, kind: string, pos: number, number: string) => {
    if (!targets.has(label)) targets.set(label, { text: `${KINDS[kind]} ${number}`, pos });
  };
  const next = (kind: string) => (counts[kind] = (counts[kind] ?? 0) + 1);
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n);
    const { text } = line;
    if (n === 1 && /^---[ \t]*$/.test(text)) {
      front = true;
      continue;
    }
    if (front) {
      if (/^(?:---|\.\.\.)[ \t]*$/.test(text)) front = false;
      continue;
    }
    const fence = FENCE.exec(text);
    if (code !== null) {
      if (fence?.[1] && fence[1][0] === code[0] && fence[1].length >= code.length) code = null;
      else {
        const chunk = CHUNK_LABEL.exec(text);
        if (chunk?.[1]) {
          const kind = chunk[1].slice(0, chunk[1].indexOf('-'));
          add(chunk[1], kind, line.from, String(next(kind)));
        }
      }
      continue;
    }
    if (fence?.[1]) {
      code = fence[1];
      continue;
    }
    const heading = HEADING.exec(text);
    let sectionNumber = '';
    if (heading?.[1] && !/\{[^}]*(?:\.unnumbered|\s-)[^}]*\}\s*$/.test(text)) {
      const depth = heading[1].length - 1;
      levels[depth] = (levels[depth] ?? 0) + 1;
      for (let i = depth + 1; i < levels.length; i++) levels[i] = 0;
      sectionNumber = levels.slice(0, depth + 1).join('.');
    }
    for (const found of text.matchAll(ATTRIBUTE_ID)) {
      const label = found[1] ?? '';
      const kind = label.slice(0, label.indexOf('-'));
      if (kind === 'sec') {
        if (sectionNumber !== '') add(label, kind, line.from, sectionNumber);
      } else add(label, kind, line.from, String(next(kind)));
    }
  }
  return targets;
}

class RefWidget extends WidgetType {
  readonly text: string;
  readonly pos: number;

  constructor(text: string, pos: number) {
    super();
    this.text = text;
    this.pos = pos;
  }

  override eq(other: RefWidget): boolean {
    return other.text === this.text && other.pos === this.pos;
  }

  override toDOM(view: EditorView): HTMLElement {
    const chip = document.createElement('span');
    chip.className = 'rl-xref';
    chip.textContent = this.text;
    chip.setAttribute('role', 'link');
    chip.setAttribute('aria-label', `${this.text}, go to it`);
    chip.addEventListener('mousedown', (event) => {
      // A press on the chip goes to its target; a click with a modifier is left to the editor.
      if (event.button !== 0 || event.shiftKey || event.metaKey || event.ctrlKey) return;
      event.preventDefault();
      view.dispatch({ selection: { anchor: this.pos }, scrollIntoView: true });
    });
    return chip;
  }

  override ignoreEvent(event: Event): boolean {
    return event.type === 'mousedown';
  }
}

/** The chips of the references in `state`; none outside a pandoc file or in Plain. */
export function refDecorations(state: EditorState): DecorationSet {
  if (state.facet(dialectFacet) !== 'pandoc') return Decoration.none;
  if (state.field(viewModeField, false) === 'raw') return Decoration.none;
  const { doc } = state;
  if (!doc.sliceString(0).includes('@')) return Decoration.none;
  const ledger = state.field(parsedField, false)?.ledgerRange;
  const targets = targetsOf(doc);
  if (targets.size === 0) return Decoration.none;
  const ranges: Range<Decoration>[] = [];
  let code: string | null = null;
  let front = false;
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n);
    const { text } = line;
    if (n === 1 && /^---[ \t]*$/.test(text)) {
      front = true;
      continue;
    }
    if (front) {
      if (/^(?:---|\.\.\.)[ \t]*$/.test(text)) front = false;
      continue;
    }
    const fence = FENCE.exec(text);
    if (code !== null) {
      if (fence?.[1] && fence[1][0] === code[0] && fence[1].length >= code.length) code = null;
      continue;
    }
    if (fence?.[1]) {
      code = fence[1];
      continue;
    }
    if (!text.includes('@')) continue;
    if (ledger && line.from >= ledger.from) break;
    // Inline code is text.
    const masked = text.replace(/(`+)[^`]*?\1/g, (span) => ' '.repeat(span.length));
    for (const found of masked.matchAll(TOKEN)) {
      const target = targets.get(found[1] ?? '');
      if (!target) continue;
      const from = line.from + found.index;
      const to = from + found[0].length;
      if (state.selection.ranges.some((range) => range.from <= to && range.to >= from)) continue;
      ranges.push(
        Decoration.replace({ widget: new RefWidget(target.text, target.pos) }).range(from, to),
      );
    }
  }
  return Decoration.set(ranges, true);
}

const field = StateField.define<DecorationSet>({
  create: (state) => refDecorations(state),
  update: (value, tr) =>
    tr.docChanged ||
    tr.selection !== undefined ||
    tr.startState.facet(dialectFacet) !== tr.state.facet(dialectFacet) ||
    tr.startState.field(viewModeField, false) !== tr.state.field(viewModeField, false)
      ? refDecorations(tr.state)
      : value,
  provide: (f) => [
    EditorView.decorations.from(f),
    EditorView.atomicRanges.of((v) => v.state.field(f)),
  ],
});

/** A small chip, in the grays like the rest of the review chrome. */
const theme = EditorView.baseTheme({
  '.rl-xref': {
    display: 'inline-block',
    padding: '0 0.3em',
    borderRadius: '4px',
    backgroundColor: 'var(--rl-tint)',
    color: 'var(--rl-ink)',
    lineHeight: '1.35',
    cursor: 'pointer',
  },
  '.rl-xref:hover': { backgroundColor: 'var(--rl-rule)' },
});

/** Cross-references drawn as chips in a pandoc file. */
export function quartoRefs(): Extension {
  return [field, theme];
}
