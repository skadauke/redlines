// Cross-references as links (docs/research/quarto.md, decision 3): `@fig-plot`, `@tbl-x`, `@eq-x`,
// `@lst-x` and `@sec-x` are drawn as the target's label and number ("Figure 2", or a section's title
// where the file doesn't number sections) in the text's own look, with a fine dotted underline, where
// the target exists in the file, and stay plain text where it doesn't. A click puts the caret there,
// which shows the source (as any syntax does); ⌘-click goes to the target and scrolls the whole
// figure, table, equation, listing or section into view (`goToTarget`). The file's labels
// come from `{#fig-x}` attributes (images, tables, divs, headings, equations) and `#| label:` lines
// of chunks, numbered in the order of the document; sections are numbered by their headings, and
// only where the file asks for it (`number-sections: true`), as Quarto does. A file is read once for
// each text it has, and again only when its text changes.

import {
  EditorSelection,
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

/** A target: its label's text, "Figure 2", and where it is in the document: `pos` where it starts, and
 * `end` where the whole of it ends (a figure's line, a table with its caption, an equation, a chunk,
 * a section down to the next heading of its level or above), so that it can be shown whole. */
export interface Target {
  text: string;
  pos: number;
  end: number;
  /** A section is shown from its heading down, as far as the window goes. */
  section?: boolean;
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
  const add = (label: string, text: string, pos: number, end: number, section = false) => {
    if (!targets.has(label))
      targets.set(label, { text, pos, end, ...(section ? { section } : {}) });
  };
  /** The first and last line of the block of text lines that line `at` is in. */
  const blockOf = (at: number): [number, number] => {
    let a = at;
    let b = at;
    while (a > 1 && doc.line(a - 1).text.trim() !== '') a--;
    while (b < doc.lines && doc.line(b + 1).text.trim() !== '') b++;
    return [a, b];
  };
  /** The extent of the target whose attributes are on line `at`: the block of its line, and for a
   * table's caption (`: Caption {#tbl-x}`) the table above it or below it too. */
  const extentOf = (at: number): [number, number] => {
    const [a, b] = blockOf(at);
    let from = doc.line(a).from;
    let to = doc.line(b).to;
    if (/^:/.test(doc.line(a).text)) {
      const above = a - 2 >= 1 && doc.line(a - 1).text.trim() === '' ? a - 2 : 0;
      const below = b + 2 <= doc.lines && doc.line(b + 1).text.trim() === '' ? b + 2 : 0;
      if (above > 0 && doc.line(above).text.includes('|')) from = doc.line(blockOf(above)[0]).from;
      else if (below > 0 && doc.line(below).text.includes('|')) to = doc.line(blockOf(below)[1]).to;
    }
    return [from, to];
  };
  const sections: { target: Target; depth: number }[] = [];
  let chunkFrom = 0;
  const chunkTargets: Target[] = [];
  const next = (kind: string) => (counts[kind] = (counts[kind] ?? 0) + 1);
  for (; n <= doc.lines; n++) {
    const line = doc.line(n);
    const text = blanked(line.text, comment);
    // A fence is read from the line as written: the inline code that `blanked` looks for would eat it.
    const fence = FENCE.exec(line.text);
    if (code !== null) {
      if (fence?.[1] && fence[1][0] === code[0] && fence[1].length >= code.length) {
        code = null;
        // The chunk ends with its closing fence: the whole chunk is what its target shows.
        for (const target of chunkTargets.splice(0)) target.end = line.to;
      } else {
        const chunk = CHUNK_LABEL.exec(line.text);
        if (chunk?.[1]) {
          const kind = chunk[1].slice(0, chunk[1].indexOf('-'));
          add(chunk[1], `${KINDS[kind]} ${next(kind)}`, chunkFrom, doc.length);
          const made = targets.get(chunk[1]);
          if (made && made.pos === chunkFrom) chunkTargets.push(made);
        }
      }
      continue;
    }
    if (fence?.[1]) {
      code = fence[1];
      chunkFrom = line.from;
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
        // A section is its number where the file numbers them, and else its title.
        const title = text
          .replace(/^#{1,6}[ \t]+/, '')
          .replace(/[ \t]*\{[^}]*\}[ \t]*$/, '')
          .trim();
        const named = sectionNumber !== '' ? `Section ${sectionNumber}` : title;
        if (named !== '') {
          add(label, named, line.from, doc.length, true);
          const made = targets.get(label);
          if (made && made.pos === line.from && depth >= 0) sections.push({ target: made, depth });
        }
      } else {
        const [from, to] = extentOf(n);
        add(label, `${KINDS[kind]} ${next(kind)}`, from, to);
      }
    }
    if (text.includes('@')) {
      for (const found of text.matchAll(TOKEN)) {
        const from = line.from + found.index;
        references.push({ from, to: from + found[0].length, label: found[1] ?? '' });
      }
    }
  }
  // A section runs to the heading that is of its level or above, or to the end of the document. (A
  // heading without an id of its own still ends it, so the headings are read again.)
  const heads: { from: number; depth: number }[] = [];
  let inCode: string | null = null;
  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i);
    const fence = FENCE.exec(line.text);
    if (inCode !== null) {
      if (fence?.[1] && fence[1][0] === inCode[0] && fence[1].length >= inCode.length)
        inCode = null;
      continue;
    }
    if (fence?.[1]) {
      inCode = fence[1];
      continue;
    }
    const heading = HEADING.exec(line.text);
    if (heading?.[1]) heads.push({ from: line.from, depth: heading[1].length - 1 });
  }
  for (const { target, depth } of sections) {
    const after = heads.find((head) => head.from > target.pos && head.depth <= depth);
    target.end = after ? after.from - 1 : doc.length;
  }
  const made = { targets, references };
  kept.set(doc, made);
  return made;
}

/** The targets of a document by their label (`fig-plot`), the first of each label. */
export function targetsOf(doc: Text): Map<string, Target> {
  return read(doc).targets;
}

/**
 * Takes the caret to `target` and scrolls the whole of it into view: a figure, a table with its
 * caption, an equation or a chunk as far as the window holds it, and a section from its heading down.
 */
export function goToTarget(
  view: EditorView,
  target: Pick<Target, 'pos' | 'end' | 'section'>,
): void {
  const end = Math.min(Math.max(target.end, target.pos), view.state.doc.length);
  view.dispatch({
    selection: { anchor: target.pos },
    effects: EditorView.scrollIntoView(EditorSelection.range(target.pos, end), {
      y: target.section ? 'start' : 'nearest',
      yMargin: 24,
    }),
  });
  // (After the update: the focus moves the browser's own selection, which the view reads back.)
  queueMicrotask(() => view.focus());
}

/**
 * The press of a reference or a citation drawn as a link: a click puts the caret at the end of the
 * token, which shows its source; ⌘-click (Ctrl on other systems) goes to `go`, if the link has a place
 * to go to. Another press (a right-click, or with Shift or Alt) is left to the editor.
 */
export function pressLink(
  view: EditorView,
  event: MouseEvent,
  token: HTMLElement,
  length: number,
  go: (() => void) | null,
): void {
  if (event.button !== 0 || event.shiftKey || event.altKey) return;
  event.preventDefault();
  if (event.metaKey || event.ctrlKey) {
    go?.();
    return;
  }
  const from = view.posAtDOM(token);
  view.dispatch({ selection: { anchor: from + length } });
  view.focus();
}

class RefWidget extends WidgetType {
  readonly text: string;
  readonly target: Target;
  readonly length: number;

  constructor(text: string, target: Target, length: number) {
    super();
    this.text = text;
    this.target = target;
    this.length = length;
  }

  override eq(other: RefWidget): boolean {
    return (
      other.text === this.text &&
      other.target.pos === this.target.pos &&
      other.target.end === this.target.end &&
      other.length === this.length
    );
  }

  override toDOM(view: EditorView): HTMLElement {
    const link = document.createElement('span');
    link.className = 'rl-xref';
    link.textContent = this.text;
    link.setAttribute('role', 'link');
    link.setAttribute('aria-label', `${this.text}. Click to edit, Command-click to go to it`);
    link.addEventListener('mousedown', (event) =>
      pressLink(view, event, link, this.length, () => goToTarget(view, this.target)),
    );
    return link;
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
      Decoration.replace({ widget: new RefWidget(target.text, target, to - from) }).range(from, to),
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

/** A link in the text's own look: a fine dotted underline and nothing else. */
const theme = EditorView.baseTheme({
  '.rl-xref, .rl-cite': {
    textDecoration: 'underline dotted',
    textDecorationColor: 'var(--rl-ink-3)',
    textDecorationThickness: '1px',
    textUnderlineOffset: '0.2em',
  },
  '.rl-xref:hover, .rl-cite:hover': { textDecorationColor: 'var(--rl-ink-2)' },
});

/** Cross-references drawn as links in a pandoc file. */
export function quartoRefs(): Extension {
  return [field, theme];
}
