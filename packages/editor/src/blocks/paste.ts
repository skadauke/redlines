// Pasting list items into a list item (issue #510). A paste of Markdown that is only list items
// (bullets, numbers or tasks, nested or not), made at a caret or over a selection inside one list
// item, adds items to the list as Return does: after the item at its end, before it at its start,
// in place of it when it is empty, and between its two halves in the middle. The pasted items take
// the target list's kind (a `1.` pasted into a bullet list is a bullet, a bullet pasted into a
// numbered list is the next number), a task keeps its checkbox, and nested items keep their depth.
//
// The edits are the ones Return makes (`returnInItem`: a line break and the new item's syntax at the
// end of the text, the start of the text or the caret), with the pasted text written after each
// marker, so that Track Changes writes them as it writes Return and typing, and every order of
// decisions reads alike. Where the paste is not that (no item at the caret, a selection across
// items, a pasted item that holds more than text and nested items) this declines, and the paste
// goes in as text, as before.

import { GFM, parser } from '@lezer/markdown';
import { EditorSelection, type EditorState } from '@codemirror/state';
import {
  type Item,
  type KeyEdit,
  blankOf,
  hardBreakAt,
  itemsAround,
  lastInItem,
  splitAt,
  textEnd,
  textStart,
} from './edits.ts';
import { trackingField } from '../tracked/typing.ts';
import { openBlock } from './open.ts';
import { blockAt, listItems } from './structure.ts';

const markdown = parser.configure(GFM);

/** A pasted list item: its marker as pasted (nested items keep it), its checkbox, its text, its items. */
interface PastedItem {
  marker: string;
  /** `[ ]` or `[x]`, or null. */
  box: string | null;
  /** The text, its lines after the first without their indentation. */
  text: string;
  kids: PastedItem[];
}

type Node = ReturnType<typeof markdown.parse>['topNode'];

function itemOf(text: string, node: Node): PastedItem | null {
  const mark = node.getChild('ListMark');
  if (!mark) return null;
  let content: PastedItem | null = null;
  const kids: PastedItem[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === 'ListMark') continue;
    if (child.name === 'Paragraph' && !content) {
      content = { marker: text.slice(mark.from, mark.to), box: null, text: '', kids };
      content.text = text.slice(child.from, child.to);
    } else if (child.name === 'Task' && !content) {
      const box = child.getChild('TaskMarker');
      if (!box) return null;
      content = {
        marker: text.slice(mark.from, mark.to),
        box: text.slice(box.from, box.to).toLowerCase() === '[ ]' ? '[ ]' : '[x]',
        text: text.slice(box.to, child.to).replace(/^[ \t]+/, ''),
        kids,
      };
    } else if ((child.name === 'BulletList' || child.name === 'OrderedList') && content) {
      for (let li = child.firstChild; li; li = li.nextSibling) {
        const kid = itemOf(text, li);
        if (!kid) return null;
        kids.push(kid);
      }
    } else {
      // A second paragraph, code, a quote, a table: more than the text of an item.
      return null;
    }
  }
  if (!content || !content.text.trim()) return null;
  content.text = content.text
    .split('\n')
    .map((line, i) => (i === 0 ? line : line.replace(/^[ \t]+/, '')))
    .join('\n');
  return content;
}

/** The start of a paste of list items: a marker and text, after any line breaks and up to 3 spaces. */
export const LOOKS_LIKE_ITEMS = /^[\r\n]*[ ]{0,3}(?:[-+*]|\d{1,9}[.)])[ \t]+\S/;

/**
 * The list items a pasted text is, or null when it is anything else: a text whose blocks are all
 * lists, with no blank line in it, whose items hold only text and nested items.
 */
export function pastedItems(raw: string): PastedItem[] | null {
  // The head first, on the text as it is, so that a long paste that is no list costs nothing.
  if (!LOOKS_LIKE_ITEMS.test(raw)) return null;
  const text = raw.replace(/\r\n?/g, '\n').replace(/^\n+/, '').trimEnd();
  if (/\n[ \t]*\n/.test(text)) return null;
  const items: PastedItem[] = [];
  for (let list = markdown.parse(text).topNode.firstChild; list; list = list.nextSibling) {
    if (list.name !== 'BulletList' && list.name !== 'OrderedList') return null;
    for (let li = list.firstChild; li; li = li.nextSibling) {
      const item = itemOf(text, li);
      if (!item) return null;
      items.push(item);
    }
  }
  return items.length ? items : null;
}

/** The lines of items: each at `indent`, the top ones with `markerAt`, the nested ones as pasted. */
function chunk(
  item: PastedItem,
  indent: string,
  marker: string,
  after: string,
  box: string | null,
): string {
  const lines = item.text.split('\n');
  const width = ' '.repeat(marker.length + after.length);
  const out = [
    `${indent}${marker}${after}${box ? `${box} ` : ''}${lines[0]}`,
    ...lines.slice(1).map((line) => `${indent}${width}${line}`),
  ];
  for (const kid of item.kids) {
    out.push(chunk(kid, `${indent}${width}`, kid.marker, ' ', kid.box));
  }
  return out.join('\n');
}

/**
 * Where the caret is right after a bare marker (`-` or `2.` with no space after it) in an empty
 * item, with Track Changes on: a space typed there would be written inside the insertion, right
 * after the marker, which Markdown reads as no item (`-<ins> a</ins>`). The paste writes that
 * space first, as it is, so that the insertion starts after it (`- <ins>a</ins>`).
 */
export function bareMarkerAt(state: EditorState): number | null {
  const { selection } = state;
  if (selection.ranges.length > 1 || !selection.main.empty || !state.field(trackingField, false)) {
    return null;
  }
  const block = blockAt(state, selection.main.head);
  if (!block || block.kind !== 'paragraph' || block.containers.at(-1)?.kind !== 'item') return null;
  if (state.sliceDoc(block.text.from, block.text.to).trim()) return null;
  const line = state.doc.lineAt(block.text.to);
  if (selection.main.head !== line.to || /[ \t]$/.test(line.text)) return null;
  return /(?:[-+*]|\d{1,9}[.)])$/.test(line.text) ? line.to : null;
}

/** A Return's plan for a paste of `pasted` at the caret of `state`, or null where it declines. */
export function planListPaste(state: EditorState, pasted: PastedItem[]): KeyEdit | null {
  const { selection } = state;
  if (selection.ranges.length > 1 || !selection.main.empty) return null;
  const head = selection.main.head;
  if (openBlock(state)) return null;
  const block = blockAt(state, head);
  if (!block || block.kind !== 'paragraph' || block.containers.at(-1)?.kind !== 'item') return null;
  const item: Item | undefined = itemsAround(state, block)[0];
  if (!item) return null;
  const { doc } = state;
  // The first paragraph of the item, which may start on a later line than its marker where a
  // pending deletion's marker stands between them (format §3.3): nothing but markers and white
  // space comes between the item's marker and its text.
  const markEnd = item.node.getChild('ListMark')?.to ?? item.line.from;
  const first =
    block.text.from >= markEnd &&
    state
      .sliceDoc(markEnd, block.text.from)
      .replace(/<!--[^]*?-->/g, '')
      .replace(/\[[ xX]\]/, '')
      .trim() === '';
  const text = state.sliceDoc(block.text.from, block.text.to);
  const empty = block.text.from >= block.text.to || !text.trim();
  const start = textStart(state, block);
  const end = textEnd(state, block);

  // The markers: the item's own, and the numbers after it (the same in a list numbered alike).
  const number = /^(\d+)([.)])$/.exec(item.marker);
  const numbers = listItems(state, item.node.parent).map((other) => {
    const mark = other.getChild('ListMark');
    return mark ? Number.parseInt(state.sliceDoc(mark.from, mark.to), 10) : Number.NaN;
  });
  const alike = numbers.length > 1 && numbers.every((m) => m === numbers[0]);
  const markerAt = (k: number) =>
    number
      ? `${alike ? Number.parseInt(number[1]!, 10) : Number.parseInt(number[1]!, 10) + k}${number[2]}`
      : item.marker;
  const sep = `${item.loose ? `\n${blankOf(item.indent)}` : ''}\n`;
  /** The pasted items from the `k`th marker on, as lines of their own. */
  const items = (k: number, from = 0) =>
    pasted.slice(from).map((it, i) => chunk(it, item.indent, markerAt(k + i), item.after, it.box));
  /** The first pasted item written after the item's own marker, which stays where it is. */
  const inPlace = () => {
    const [firstItem] = pasted;
    const text = chunk(
      item.task ? { ...firstItem!, box: null } : firstItem!,
      item.indent,
      item.marker,
      item.after,
      item.task ? null : firstItem!.box,
    );
    return text.slice(`${item.indent}${item.marker}${item.after}`.length);
  };
  const rest = () =>
    items(1, 1)
      .map((c) => sep + c)
      .join('');
  const done = (at: number, insert: string, userEvent: KeyEdit['userEvent'] = 'input.paste') => ({
    changes: [{ from: at, insert }],
    selection: EditorSelection.single(at + insert.length),
    userEvent,
  });

  if (empty) {
    // Only with the caret at the end of the item's own line (not inside its marker, nor on a line
    // after it), and, with Track Changes on, after a space: a bare marker is `bareMarkerAt`'s.
    if (!first || head !== block.text.to || doc.lineAt(head).number !== item.line.number) {
      return null;
    }
    const spaced = /[ \t]$/.test(doc.lineAt(head).text);
    if (!spaced && state.field(trackingField, false)) return null;
    return done(block.text.to, (spaced ? '' : ' ') + inPlace() + rest());
  }
  // The start of a later paragraph of the item: no item of its own to put them before, so the
  // text way takes it (a middle split there would leave a line of white space behind).
  if (head <= start && !first) return null;
  if (head <= start && first) {
    // Before the item: the first pasted item takes the item's own marker, and the item's text goes
    // on in a new item after the pasted ones, with a copy of the item's checkbox.
    const box = item.node.getChild('Task');
    const copy = box ? state.sliceDoc(box.from, block.text.from) : '';
    const tail = `${sep}${item.indent}${markerAt(pasted.length)}${item.after}${copy}`;
    const insert = inPlace() + rest();
    return {
      changes: [{ from: start, insert: insert + tail }],
      selection: EditorSelection.single(start + insert.length),
      userEvent: 'input.paste',
      caretAfterText: { from: start, text: insert },
    };
  }
  if (head >= end) {
    // After the item: after its last line, and after the items nested in it.
    const nested = item.node.getChild('BulletList') ?? item.node.getChild('OrderedList');
    const at =
      lastInItem(state, block, item) && !nested
        ? doc.lineAt(block.lines.to).to
        : doc.lineAt(item.node.to).to;
    return done(
      at,
      items(1)
        .map((c) => sep + c)
        .join(''),
    );
  }
  const line = doc.lineAt(head);
  // At a soft line break, at either end of it, or at a hard one: Return's own cases (a break that
  // becomes the new item's), which a paste leaves to the text way.
  const lineLead = line.from + (/^[ \t>]*/.exec(line.text)?.[0].length ?? 0);
  if (
    hardBreakAt(state, block, head) ||
    (head === line.to && line.to < block.text.to) ||
    (line.from > block.text.from && head <= lineLead)
  ) {
    return null;
  }
  // In the text: the item parts at the caret, and the pasted items go between the halves.
  const tail = `${sep}${item.indent}${markerAt(pasted.length + 1)}${item.after}${item.task ? '[ ] ' : ''}`;
  const pastedText = items(1)
    .map((c) => sep + c)
    .join('');
  const split = splitAt(state, head, pastedText + tail);
  const change = { from: split.from, to: split.to, insert: split.insert };
  return {
    changes: [change],
    selection: EditorSelection.single(change.from + change.insert.length),
    userEvent: 'input.paste',
    caretAfterText: { from: change.from, text: pastedText },
  };
}
