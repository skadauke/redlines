// The drawing of inline HTML (#687, html-inline.ts has the parse): an element's text drawn as the
// element, through a mark decoration with the real tag name, and its tags hidden unless the
// selection touches the element, as the tags of `<sub>` and `<sup>` are. `<br>` is a line break and
// `<wbr>` is nothing, each stepped over by the caret as one unit; the open tag of an element GitHub
// drops that has no text shows as a small muted chip, drawn as an image is: the source shows while
// the selection is inside it.

import type { EditorState, Range } from '@codemirror/state';
import { Decoration, WidgetType } from '@codemirror/view';
import type { syntaxTree } from '@codemirror/language';
import { keptAttributes, readTag } from './html-inline.ts';
import { selectionInside } from './image.ts';

type SyntaxNode = ReturnType<typeof syntaxTree>['topNode'];

/** What the drawing needs of the preview's builder. */
export interface Sink {
  readonly state: EditorState;
  push(range: Range<Decoration>): void;
  syntax(from: number, to: number, shown: boolean): void;
}

/** Elements whose text the spell check leaves alone. */
const UNCHECKED = new Set(['code', 'tt', 'kbd', 'samp', 'var']);

/** Attributes that go to the element as they are, for how it is drawn (never an address). */
const PASSED = new Set(['dir', 'lang']);

function touches(state: EditorState, from: number, to: number): boolean {
  return state.selection.ranges.some((range) => range.from <= to && range.to >= from);
}

/** A paired element: its text in the element, its tags hidden or, with the caret in it, shown. */
export function htmlElement(b: Sink, node: SyntaxNode): void {
  const marks = node.getChildren('HtmlTagMark');
  const open = marks[0];
  const close = marks.length > 1 ? marks.at(-1)! : null;
  if (!open || !close) return;
  const tag = readTag(b.state.sliceDoc(open.from, open.to));
  if (!tag) return;
  const { name } = tag;
  const attributes: Record<string, string> = {};
  const kept = keptAttributes(name, tag.attributes);
  for (const [attribute, value] of Object.entries(kept)) {
    if (PASSED.has(attribute)) attributes[attribute] = value;
  }
  // The `title` is for an app hint (#684), never the system's tooltip.
  if (kept['title']) attributes['data-rl-title'] = kept['title'];
  if (UNCHECKED.has(name)) attributes['spellcheck'] = 'false';
  const class_ = name === 'a' ? `rl-h-${name} rl-link` : `rl-h-${name}`;
  if (open.to < close.from) {
    b.push(
      Decoration.mark({ tagName: name, class: class_, attributes }).range(open.to, close.from),
    );
  }
  const shown = touches(b.state, node.from, node.to);
  b.syntax(open.from, open.to, shown);
  b.syntax(close.from, close.to, shown);
}

/** A line break, drawn as one. */
class BreakWidget extends WidgetType {
  override eq(): boolean {
    return true;
  }
  override toDOM(): HTMLElement {
    return document.createElement('br');
  }
}

/** `<wbr>`: a place a word may break, with nothing drawn. */
class WbrWidget extends WidgetType {
  override eq(): boolean {
    return true;
  }
  override toDOM(): HTMLElement {
    return document.createElement('wbr');
  }
}

/** The `<br>` tag drawn as a line break; the caret steps over it as one unit (`hardBreak`). */
export function htmlBreak(): Decoration {
  return Decoration.replace({ widget: new BreakWidget(), hardBreak: true });
}

/** The `<wbr>` tag, invisible, and one step for the caret. */
export function htmlWbr(): Decoration {
  return Decoration.replace({ widget: new WbrWidget(), hardBreak: true });
}

/** An element GitHub drops that has no text, as a small muted chip with its name. */
class ChipWidget extends WidgetType {
  readonly name: string;
  constructor(name: string) {
    super();
    this.name = name;
  }
  override eq(other: ChipWidget): boolean {
    return other.name === this.name;
  }
  override toDOM(): HTMLElement {
    const chip = document.createElement('span');
    chip.className = 'rl-html-chip';
    chip.textContent = this.name;
    return chip;
  }
  override ignoreEvent(): boolean {
    return false;
  }
}

/** The open tag of such an element as a chip, until the selection is inside it. */
export function htmlChip(b: Sink, node: SyntaxNode): void {
  if (selectionInside(b.state, node.from, node.to)) return;
  const tag = readTag(b.state.sliceDoc(node.from, node.to));
  if (!tag) return;
  b.push(
    Decoration.replace({ widget: new ChipWidget(tag.name), imageAtom: true }).range(
      node.from,
      node.to,
    ),
  );
}
