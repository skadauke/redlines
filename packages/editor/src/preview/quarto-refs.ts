// Cross-references as chips (docs/research/quarto.md, decision 3): `@fig-plot`, `@tbl-x`, `@eq-x`,
// `@lst-x` and `@sec-x` are drawn as a small chip with the target's label and number ("Figure 2")
// where the target exists in the file, and stay plain text where it doesn't. A press jumps to the
// target. The source shows while the caret is on the token, as any syntax does. The file's labels
// come from `{#fig-x}` attributes (images, tables, divs, headings, equations) and `#| label:` lines
// of chunks, numbered in the order of the document; sections are numbered by their headings, and
// only where the file asks for it (`number-sections: true`), as Quarto does. A file is read once for
// each text it has, and again only when its text changes.

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
const FENCE = /^[ \t]*(`{3,}|~{3,})/;
const HEADING = /^(#{1,6})[ \t]+\S/;
const SETEXT = /^ {0,3}(=+|-+)[ \t]*$/;
const UNNUMBERED = /\{[^}]*(?:\.unnumbered|\s-)[^}]*\}[ \t]*$/;

/** A target: its label's text, "Figure 2", and where it is in the document. */
export interface Target {
  text: string;
  pos: number;
}

/** A reference in the text: where it is, and the label it names. */
interface Reference {
  from: number;
  to: number;
  label: string;
}

interface Read {
  targets: Map<string, Target>;
  references: Reference[];
}

const kept = new WeakMap<Text, Read>();

/** `text` with the HTML comments (the markers and the ledger) and inline code blanked, in its place. */
export function blanked(text: string, comment: { open: boolean }): string {
  let out = '';
  let at = 0;
  while (at < text.length) {
    if (comment.open) {
      const end = text.indexOf('-->', at);
      if (end < 0) {
        out += ' '.repeat(text.length - at);
        return out;
      }
      out += ' '.repeat(end + 3 - at);
      at = end + 3;
      comment.open = false;
    } else {
      const start = text.indexOf('<!--', at);
      if (start < 0) {
        out += text.slice(at);
        break;
      }
      out += text.slice(at, start);
      at = start;
      comment.open = true;
    }
  }
  return out.replace(/(`+)[^`]*?\1/g, (span) => ' '.repeat(span.length));
}

function read(doc: Text): Read {
  const known = kept.get(doc);
  if (known) return known;
  const targets = new Map<string, Target>();
  const references: Reference[] = [];
  const counts: Record<string, number> = {};
  const levels = [0, 0, 0, 0, 0, 0];
  const comment = { open: false };
  let code: string | null = null;
  let numbered = false;
  let n = 1;
  if (doc.lines > 1 && /^---[ \t]*$/.test(doc.line(1).text)) {
    for (let i = 2; i <= doc.lines; i++) {
      const text = doc.line(i).text;
      if (/^(?:---|\.\.\.)[ \t]*$/.test(text)) {
        n = i + 1;
        break;
      }
      if (/^number-sections:\s*true\b/.test(text)) numbered = true;
    }
    // Front matter that is never closed is not front matter.
    if (n === 1) numbered = false;
  }
  const add = (label: string, kind: string, pos: number, number: string) => {
    if (!targets.has(label)) targets.set(label, { text: `${KINDS[kind]} ${number}`, pos });
  };
  const next = (kind: string) => (counts[kind] = (counts[kind] ?? 0) + 1);
  for (; n <= doc.lines; n++) {
    const line = doc.line(n);
    const text = blanked(line.text, comment);
    // A fence is read from the line as written: the inline code that `blanked` looks for would eat it.
    const fence = FENCE.exec(line.text);
    if (code !== null) {
      if (fence?.[1] && fence[1][0] === code[0] && fence[1].length >= code.length) code = null;
      else {
        const chunk = CHUNK_LABEL.exec(line.text);
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
    // A heading, by `#`s or by its underline; the underline's line is no heading of its own.
    let depth = -1;
    const heading = HEADING.exec(text);
    if (heading?.[1]) depth = heading[1].length - 1;
    else if (text.trim() !== '' && n < doc.lines) {
      const under = SETEXT.exec(doc.line(n + 1).text);
      if (under?.[1]) depth = under[1].startsWith('=') ? 0 : 1;
    }
    let sectionNumber = '';
    if (depth >= 0 && numbered && !UNNUMBERED.test(text)) {
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
    if (text.includes('@')) {
      for (const found of text.matchAll(TOKEN)) {
        const from = line.from + found.index;
        references.push({ from, to: from + found[0].length, label: found[1] ?? '' });
      }
    }
  }
  const made = { targets, references };
  kept.set(doc, made);
  return made;
}

/** The targets of a document by their label (`fig-plot`), the first of each label. */
export function targetsOf(doc: Text): Map<string, Target> {
  return read(doc).targets;
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
  const { targets, references } = read(state.doc);
  if (targets.size === 0 || references.length === 0) return Decoration.none;
  const ledger = state.field(parsedField, false)?.ledgerRange;
  const ranges: Range<Decoration>[] = [];
  for (const { from, to, label } of references) {
    const target = targets.get(label);
    if (!target) continue;
    if (ledger && from >= ledger.from) break;
    if (state.selection.ranges.some((range) => range.from <= to && range.to >= from)) continue;
    ranges.push(
      Decoration.replace({ widget: new RefWidget(target.text, target.pos) }).range(from, to),
    );
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
