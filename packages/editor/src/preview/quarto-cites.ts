// Citations as chips (docs/research/quarto.md, Q9 and decision 3): `[@smith2020]`, `[@a; @b, p. 4]`
// and a narrative `@smith2020` are drawn as a small chip with the cited keys, the way the
// cross-references of quarto-refs.ts are, and with no bibliography to read, nothing else is
// claimed: the chip says what was cited, not who wrote it. The chip is as atomic as the citation is
// (a marker never stands inside one, format §3.1, rule 9); the source shows while the caret is on
// it. The kinds that Quarto numbers (`@fig-x`, `@sec-x`…) are cross-references, not citations, and
// are left to quarto-refs.ts. A citation inside code, a comment marker, front matter or the ledger
// is text.

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
import type { Context, Entry, Item } from '@redlines/citations';
import { dialectFacet } from '../dialect.ts';
import { parsedField, viewModeField } from '../tracked/field.ts';
import { blanked } from './quarto-refs.ts';
import { includeFacet } from './quarto-include.ts';

/** The kinds of label that Quarto numbers: a key that starts with one is a cross-reference. */
const XREF = /^(?:fig|tbl|sec|eq|lst|thm|lem|cor|prp|cnj|def|exm|exr|nte|tip|wrn|cau|imp)-/;
/** A bracket of citations, `[@a; @b, p. 4]` or `[-@a]` (pandoc), with its keys. */
const BRACKET = /\[(?=[^\][\n]*-?@)[^\][\n]*\]/g;
/** A citation key: pandoc's characters, as quarto-refs.ts and the format's rule 9 have them. */
const KEY = /(?<![\w@])-?@([\w][\w:.#$%&+?<>~/-]*)(?<![:.#$%&+?<>~/-])/g;
const NARRATIVE = /(?<![\w@\]])@([\w][\w:.#$%&+?<>~/-]*)(?<![:.#$%&+?<>~/-])/g;
const FENCE = /^[ \t]*(`{3,}|~{3,})/;

/** A citation in the text: where it is, and the keys it cites. */
interface Citation {
  from: number;
  to: number;
  keys: string[];
  /** What the chip says: the keys, with a locator after the key it belongs to. */
  text: string;
  /** The works cited and how, for the bibliography to print; none for a narrative one's. */
  items?: Item[];
  /** A citation that is part of the sentence (`@smith2020`). */
  narrative?: boolean;
}

const kept = new WeakMap<Text, Citation[]>();

/** The text of a bracket as a chip says it: the keys, parted by semicolons, with their locators. A
 * bracket that holds a key Quarto numbers anywhere is a cross-reference's. */
function bracketText(bracket: string): { keys: string[]; text: string; items: Item[] } | undefined {
  const keys: string[] = [];
  const parts: string[] = [];
  const items: Item[] = [];
  for (const part of bracket.slice(1, -1).split(';')) {
    const found = [...part.matchAll(KEY)];
    const last = found.at(-1);
    if (!last) continue;
    const named = found.map((each) => each[1] ?? '');
    keys.push(...named);
    const locator = part.slice((last.index ?? 0) + last[0].length).trim();
    const said = named.join(', ');
    parts.push(locator === '' ? said : `${said} ${locator.replace(/^,\s*/, '')}`);
    for (const each of found) {
      items.push({
        key: each[1] ?? '',
        prefix: each === found[0] ? part.slice(0, each.index ?? 0).trim() : '',
        suffix: each === last ? locator.replace(/^,\s*/, '') : '',
        suppress: each[0].startsWith('-'),
      });
    }
  }
  if (keys.length === 0 || keys.some((key) => XREF.test(key))) return undefined;
  return { keys, text: parts.join('; '), items };
}

function read(doc: Text): Citation[] {
  const known = kept.get(doc);
  if (known) return known;
  const found: Citation[] = [];
  const comment = { open: false };
  let code: string | null = null;
  let math = false;
  let blankBefore = true;
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
    const wasBlank = blankBefore;
    blankBefore = line.text.trim() === '';
    if (code !== null) {
      if (fence?.[1] && fence[1][0] === code[0] && fence[1].length >= code.length) code = null;
      continue;
    }
    if (fence?.[1]) {
      code = fence[1];
      continue;
    }
    // Display math, and a code block indented by four spaces after a blank line, are no text.
    if (/^\s*\$\$/.test(text)) {
      const closes = /\$\$\s*(?:\{[^}]*\})?\s*$/.test(text.replace(/^\s*\$\$/, ''));
      if (!closes) math = !math;
      continue;
    }
    if (math) continue;
    if (wasBlank && /^(?: {4}|\t)/.test(line.text)) continue;
    if (!text.includes('@')) continue;
    const whole = text.replace(/\$[^$\n]*\$/g, (span) => ' '.repeat(span.length));
    // A text that differs from the line's own holds a marker or code there: no chip hides one.
    const plain = (from: number, to: number) => line.text.slice(from, to) === text.slice(from, to);
    const spans: { from: number; to: number }[] = [];
    for (const bracket of whole.matchAll(BRACKET)) {
      const end = bracket.index + bracket[0].length;
      spans.push({ from: bracket.index, to: end });
      // A bracket that a `(`, `{` or `[` follows is a link or a span.
      if (/^[({[]/.test(whole.slice(end, end + 1)) || !plain(bracket.index, end)) continue;
      const said = bracketText(bracket[0]);
      if (said) found.push({ from: line.from + bracket.index, to: line.from + end, ...said });
    }
    for (const key of whole.matchAll(NARRATIVE)) {
      const from = key.index;
      const to = from + key[0].length;
      if (XREF.test(key[1] ?? '') || !plain(from, to)) continue;
      if (spans.some((span) => from >= span.from && to <= span.to)) continue;
      // Not in an address or an autolink.
      const word =
        whole
          .slice(Math.max(0, from - 120), from)
          .split(/\s/)
          .at(-1) ?? '';
      if (/[/<]$/.test(word) || /:\/\/|\]\(/.test(word)) continue;
      found.push({
        from: line.from + from,
        to: line.from + to,
        keys: [key[1] ?? ''],
        text: key[1] ?? '',
        narrative: true,
      });
    }
  }
  found.sort((a, b) => a.from - b.from);
  kept.set(doc, found);
  return found;
}

/** The citations of a document, in order. */
export function citationsOf(doc: Text): readonly Citation[] {
  return read(doc);
}

/** The bibliography a document's front matter names, read, and what formats with it. */
interface Loaded {
  /** What it was read from, so that the same files are not read into a new value. */
  stamp: string;
  context: (cited: string[]) => Context;
  api: Pick<typeof import('@redlines/citations'), 'formatBracket' | 'formatNarrative'>;
}

/** The host's way to load the formatter of citations; without it the chips say the keys. */
export const citationsFacet = Facet.define<
  () => Promise<typeof import('@redlines/citations')>,
  (() => Promise<typeof import('@redlines/citations')>) | null
>({ combine: (values) => values[0] ?? null });

const setBibliography = StateEffect.define<Loaded | null>();

const loadedField = StateField.define<Loaded | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setBibliography)) return effect.value;
    return value;
  },
});

/** The text of the front matter that names a bibliography or a style, or '' (nothing to load). */
function frontMatter(doc: Text): string {
  if (doc.lines < 3 || !/^---[ \t]*$/.test(doc.line(1).text)) return '';
  const lines: string[] = [];
  for (let n = 1; n <= Math.min(doc.lines, 120); n++) {
    const text = doc.line(n).text;
    lines.push(text);
    if (n > 1 && /^(?:---|\.\.\.)[ \t]*$/.test(text)) {
      const whole = lines.join('\n');
      return /^(?:bibliography|csl)\s*:/m.test(whole) ? whole : '';
    }
  }
  return '';
}

class CiteWidget extends WidgetType {
  readonly text: string;
  readonly keys: string;

  constructor(text: string, keys: string) {
    super();
    this.text = text;
    this.keys = keys;
  }

  override eq(other: CiteWidget): boolean {
    return other.text === this.text && other.keys === this.keys;
  }

  override toDOM(): HTMLElement {
    const chip = document.createElement('span');
    chip.className = 'rl-cite';
    chip.textContent = this.text;
    chip.setAttribute('role', 'note');
    chip.setAttribute('aria-label', `Citation: ${this.text}`);
    // The keys, where the chip says the authors.
    if (this.keys !== this.text) chip.title = this.keys;
    return chip;
  }
}

/** The chips of the citations in `state`; none outside a pandoc file or in Plain. */
export function citeDecorations(state: EditorState): DecorationSet {
  if (state.facet(dialectFacet) !== 'pandoc') return Decoration.none;
  if (state.field(viewModeField, false) === 'raw') return Decoration.none;
  const citations = read(state.doc);
  if (citations.length === 0) return Decoration.none;
  const ledger = state.field(parsedField, false)?.ledgerRange;
  const loaded = state.field(loadedField, false) ?? null;
  const context = loaded?.context(citations.flatMap((citation) => citation.keys));
  /** What the bibliography prints of a citation; undefined where it has no such work. */
  const printed = (citation: Citation): string | undefined => {
    if (!loaded || !context) return undefined;
    if (citation.narrative) return loaded.api.formatNarrative(citation.keys[0] ?? '', context);
    return citation.items ? loaded.api.formatBracket(citation.items, context) : undefined;
  };
  const ranges: Range<Decoration>[] = [];
  for (const citation of citations) {
    const { from, to } = citation;
    if (ledger && from >= ledger.from) break;
    if (state.selection.ranges.some((range) => range.from <= to && range.to >= from)) continue;
    const widget = new CiteWidget(printed(citation) ?? citation.text, citation.text);
    ranges.push(Decoration.replace({ widget }).range(from, to));
  }
  return Decoration.set(ranges, true);
}

const field = StateField.define<DecorationSet>({
  create: (state) => citeDecorations(state),
  update: (value, tr) =>
    tr.docChanged ||
    tr.selection !== undefined ||
    tr.effects.some((effect) => effect.is(setBibliography)) ||
    tr.startState.facet(dialectFacet) !== tr.state.facet(dialectFacet) ||
    tr.startState.field(viewModeField, false) !== tr.state.field(viewModeField, false)
      ? citeDecorations(tr.state)
      : value,
  provide: (f) => [
    EditorView.decorations.from(f),
    EditorView.atomicRanges.of((v) => v.state.field(f)),
  ],
});

/**
 * Reads the bibliography and the style that the front matter names, through the host that reads a
 * document's includes (the files beside the document), when the front matter says so or the window
 * comes back to the front (the files may have changed). `@redlines/citations` is loaded only then, so
 * a document with no bibliography never holds it.
 */
const bibliographyLoader = ViewPlugin.fromClass(
  class {
    view: EditorView;
    token = 0;
    stamp = '';
    readonly focus = () => void this.load();

    constructor(view: EditorView) {
      this.view = view;
      view.dom.addEventListener('focusin', this.focus);
      void this.load();
    }

    update(update: ViewUpdate) {
      const moved = update.startState.facet(dialectFacet) !== update.state.facet(dialectFacet);
      if (update.docChanged || moved) void this.load();
    }

    destroy() {
      this.token++;
      this.view.dom.removeEventListener('focusin', this.focus);
    }

    clear() {
      this.stamp = '';
      if (this.view.state.field(loadedField, false)) {
        this.view.dispatch({ effects: setBibliography.of(null) });
      }
    }

    async load() {
      const view = this.view;
      const front = view.state.facet(dialectFacet) === 'pandoc' ? frontMatter(view.state.doc) : '';
      const host = view.state.facet(includeFacet);
      const token = ++this.token;
      const load = view.state.facet(citationsFacet);
      if (!front || !host || !load) {
        this.clear();
        return;
      }
      try {
        const api = await load();
        const refs = api.bibliographyRefs(front);
        if (!refs) {
          this.clear();
          return;
        }
        const paths = [...refs.files, ...(refs.csl ? [refs.csl] : [])];
        const texts = await Promise.all(paths.map((path) => host.read(path)));
        if (token !== this.token) return;
        const stamp = JSON.stringify([refs, texts]);
        if (stamp === this.stamp) return;
        this.stamp = stamp;
        const bib = new Map<string, Entry>();
        refs.files.forEach((path, i) => {
          const text = texts[i];
          if (!text) return;
          for (const [key, entry] of api.parseBibliography(path, text)) bib.set(key, entry);
        });
        const cslText = refs.csl ? texts[refs.files.length] : undefined;
        const style = (cslText ? api.styleOfCsl(cslText) : undefined) ?? 'chicago-author-date';
        const loaded: Loaded | null =
          bib.size === 0
            ? null
            : { stamp, api, context: (cited) => api.makeContext(bib, style, cited) };
        view.dispatch({ effects: setBibliography.of(loaded) });
      } catch {
        if (token === this.token) this.clear();
      }
    }
  },
);

/** A small chip like the cross-reference's, a quieter gray: a citation has no place to go. */
const theme = EditorView.baseTheme({
  '.rl-cite': {
    display: 'inline-block',
    padding: '0 0.3em',
    borderRadius: '4px',
    backgroundColor: 'var(--rl-tint)',
    color: 'var(--rl-ink-2)',
    lineHeight: '1.35',
  },
});

/** Citations drawn as chips in a pandoc file. */
export function quartoCites(): Extension {
  return [loadedField, field, bibliographyLoader, theme];
}
