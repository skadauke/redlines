// Very long lines, shortened on screen (#694). CodeMirror draws a whole line at once, and a line of
// a million characters that wraps is an enormous layout: a document with base64 pictures in code
// spans stalled the page and, scrolled far, crashed it. A line over `LONG_LINE` characters shows its
// first `SHOWN` and then a chip that holds the rest ("… 1.5 MB more"); the base64 of a `data:` URI
// is a chip of its own ("PNG image, 1.1 MB, embedded"), wherever it stands in the line.
//
// Nothing in the file changes. The chip is a replaced range of the text and one atomic object: the
// caret steps over it, a click selects it, a deletion over it takes all of it (written whole by
// Track Changes, as any deletion is), and a copy holds all of it, since a copy reads the document and
// never the page. The text under a chip is never laid out. It has no way to be shown in parts yet
// (a ruling for #694: a person who needs it reads it in another tool, or copies it).

import { type EditorState, type Range, StateField, type Text } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view';

/** A line longer than this is shortened. */
export const LONG_LINE = 10_000;
/** What a shortened line shows of its own text, before the chip that holds the rest. */
export const SHOWN = 2_000;
/** A `data:` URI whose base64 is shorter than this is left as text, in a long line too. */
const MIN_DATA = 1_000;

export interface ChipSpec {
  from: number;
  to: number;
  label: string;
}

/** A size in bytes as people read it: `812 B`, `34 KB`, `1.5 MB`. */
export function sizeLabel(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${Math.round(bytes / 1000)} KB`;
  if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
}

/** What a media type is called on the chip of its data: `image/png` is `PNG image`. */
function kindLabel(mime: string): string {
  const [type, subtype = ''] = mime.toLowerCase().split('/');
  const name = subtype.replace(/\+.*/, '').replace(/^x-/, '').toUpperCase();
  if (type === 'image' && name) return `${name === 'JPG' ? 'JPEG' : name} image`;
  if (type === 'application' && name) return `${name} data`;
  return 'Embedded data';
}

// `data:image/png;base64,` and its kin: a media type, parameters, then `;base64,`.
const DATA_URI =
  /data:([a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*)?(?:;[a-z0-9=._+-]+)*;base64,/gi;
const BASE64 = /[A-Za-z0-9+/]*={0,2}/y;

/** A cut of `text` at `at` that never splits a surrogate pair. */
function whole(text: string, at: number, floor: number): number {
  const code = text.charCodeAt(at);
  return at > floor && code >= 0xdc00 && code <= 0xdfff ? at - 1 : at;
}

/**
 * The chips of one line, as ranges of the document (`base` is where the line starts), or none for a
 * line that is not long. The base64 of every `data:` URI in it that is long enough is a chip; and
 * once the line's own text shown passes `SHOWN`, everything from there to the line's end is one.
 */
export function chipsOfLine(text: string, base: number): ChipSpec[] {
  if (text.length <= LONG_LINE) return [];
  const chips: ChipSpec[] = [];
  let shown = 0;
  let at = 0;
  const cutFrom = (from: number): void => {
    const cut = whole(text, from, at);
    chips.push({
      from: base + cut,
      to: base + text.length,
      label: `… ${sizeLabel(text.length - cut)} more`,
    });
    at = text.length;
  };
  DATA_URI.lastIndex = 0;
  for (let found = DATA_URI.exec(text); found; found = DATA_URI.exec(text)) {
    const start = found.index + found[0].length;
    BASE64.lastIndex = start;
    const end = start + (BASE64.exec(text)?.[0].length ?? 0);
    DATA_URI.lastIndex = Math.max(end, DATA_URI.lastIndex);
    if (end - start < MIN_DATA) continue;
    // What is shown before this data counts against the line's allowance.
    if (shown + (found.index - at) > SHOWN) {
      cutFrom(at + (SHOWN - shown));
      return chips;
    }
    shown += found.index - at;
    const padding = /=*$/.exec(text.slice(end - 2, end))?.[0].length ?? 0;
    chips.push({
      from: base + start - found[0].length,
      to: base + end,
      label: `${kindLabel(found[1] ?? '')}, ${sizeLabel(Math.floor(((end - start) * 3) / 4) - padding)}, embedded`,
    });
    at = end;
  }
  if (shown + (text.length - at) > SHOWN) cutFrom(at + (SHOWN - shown));
  return chips;
}

class Chip extends WidgetType {
  readonly label: string;
  constructor(label: string) {
    super();
    this.label = label;
  }
  override eq(other: WidgetType): boolean {
    return other instanceof Chip && other.label === this.label;
  }
  override toDOM(): HTMLElement {
    const chip = document.createElement('span');
    chip.className = 'rl-chip';
    chip.textContent = this.label;
    chip.setAttribute('role', 'img');
    chip.setAttribute('aria-label', this.label);
    return chip;
  }
  // A click is the editor's: it selects the chip (below).
  override ignoreEvent(): boolean {
    return false;
  }
}

function decorate(spec: ChipSpec): Range<Decoration> {
  return Decoration.replace({ widget: new Chip(spec.label) }).range(spec.from, spec.to);
}

/** The chips of the lines from `from` to `to`, which are whole lines of `doc`. */
function chipsBetween(doc: Text, from: number, to: number): Range<Decoration>[] {
  const out: Range<Decoration>[] = [];
  let pos = from;
  for (const text of doc.iterLines(doc.lineAt(from).number, doc.lineAt(to).number + 1)) {
    out.push(...chipsOfLine(text, pos).map(decorate));
    pos += text.length + 1;
  }
  return out;
}

function build(state: EditorState): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  let pos = 0;
  for (const text of state.doc.iterLines()) {
    if (text.length > LONG_LINE) ranges.push(...chipsOfLine(text, pos).map(decorate));
    pos += text.length + 1;
  }
  return Decoration.set(ranges, true);
}

/** The chips, kept as the document is edited: only the lines an edit touches are read again. */
export const chipsField = StateField.define<DecorationSet>({
  create: build,
  update(chips, tr) {
    if (!tr.docChanged) return chips;
    let next = chips.map(tr.changes);
    const doc = tr.newDoc;
    const touched: { from: number; to: number }[] = [];
    tr.changes.iterChangedRanges((_a, _b, from, to) => {
      const start = doc.lineAt(from).from;
      const end = doc.lineAt(to).to;
      const last = touched.at(-1);
      if (last && start <= last.to + 1) last.to = Math.max(last.to, end);
      else touched.push({ from: start, to: end });
    });
    for (const { from, to } of touched) {
      const fresh = chipsBetween(doc, from, to);
      next = next.update({
        filterFrom: from,
        filterTo: to,
        filter: () => false,
        add: fresh,
        sort: true,
      });
    }
    return next;
  },
  provide: (field) => [
    EditorView.decorations.from(field),
    EditorView.atomicRanges.of((view) => view.state.field(field)),
  ],
});

/** The chip that holds `pos` or touches it, as a range, or null. */
function chipAt(chips: DecorationSet, pos: number): { from: number; to: number } | null {
  let found: { from: number; to: number } | null = null;
  chips.between(pos, pos, (from, to) => {
    found = { from, to };
    return false;
  });
  return found;
}

/** The chips of a state, for tests and for what draws the editor. */
export function chipRanges(state: EditorState): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  for (const it = state.field(chipsField).iter(); it.value; it.next()) {
    out.push({ from: it.from, to: it.to });
  }
  return out;
}

/** Shortens very long lines: see the top of this file. */
export function longLines() {
  return [
    chipsField,
    EditorView.domEventHandlers({
      // A click on a chip selects it, whole: the next key acts on all of it, as on a picture.
      mousedown(event, view) {
        const target = event.target;
        if (!(target instanceof Element) || event.button !== 0) return false;
        const chip = target.closest('.rl-chip');
        if (!chip) return false;
        const range = chipAt(view.state.field(chipsField), view.posAtDOM(chip));
        if (!range) return false;
        event.preventDefault();
        view.focus();
        view.dispatch({
          selection: event.shiftKey
            ? {
                anchor: view.state.selection.main.anchor,
                head: range.to > view.state.selection.main.anchor ? range.to : range.from,
              }
            : { anchor: range.from, head: range.to },
          userEvent: 'select.pointer',
        });
        return true;
      },
    }),
    EditorView.baseTheme({
      '.rl-chip': {
        display: 'inline-block',
        padding: '0 0.5em',
        borderRadius: '4px',
        backgroundColor: 'var(--rl-tint)',
        color: 'var(--rl-ink-2)',
        fontFamily: 'var(--rl-font-ui, inherit)',
        fontSize: 'var(--rl-size-ui-small)',
        lineHeight: '1.6',
        cursor: 'default',
        userSelect: 'none',
        whiteSpace: 'nowrap',
      },
    }),
  ];
}
