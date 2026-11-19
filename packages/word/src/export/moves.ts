// Moves. Redlines writes the move of a block as a deletion where it stood and an insertion where it
// landed, in one group (format §3.14); Word has `w:moveFrom` and `w:moveTo` for the two halves.
// `docx` writes neither, so the halves are written as a deletion and an insertion, with their ids
// remembered here, and the document part is patched once it is packed: `w:del` and `w:ins` of those
// ids are renamed, and each side is wrapped in its range, which carries the move's name.

import type { MarkRange } from '@redlines/format';
import { plainPayload } from '@redlines/format';

export interface MoveHalf {
  side: 'from' | 'to';
  /** Both halves of a move have the same name. */
  name: string;
}

const simple = (text: string) =>
  text.replace(/<!--[\s\S]*?-->/g, '').replace(/[^\p{L}\p{N}]+/gu, '');

/** The marks that are the halves of a move: a deletion and an insertion that agree on the text,
 * either named by the ledger's `move` or alone in one `group`. */
export function movesOf(marks: MarkRange[], text: string): Map<string, MoveHalf> {
  const halves = new Map<string, MoveHalf>();
  const byId = new Map(marks.map((mark) => [mark.id, mark]));
  const contentOf = (mark: MarkRange) =>
    mark.segments.map((segment) => text.slice(segment.content.from, segment.content.to)).join('');
  const oldOf = (mark: MarkRange) =>
    mark.segments.map((segment) => plainPayload(segment.payload ?? mark.payload ?? '')).join('');
  let count = 0;
  const pair = (from: MarkRange, to: MarkRange) => {
    if (halves.has(from.id) || halves.has(to.id)) return;
    const wanted = simple(oldOf(from));
    if (wanted === '' || wanted !== simple(contentOf(to))) return;
    const name = `move${++count}`;
    halves.set(from.id, { side: 'from', name });
    halves.set(to.id, { side: 'to', name });
  };
  const isTable = (mark: MarkRange) => /^(?:row|col)(?:=|$)/.test(mark.payload ?? '');
  const groups = new Map<string, MarkRange[]>();
  for (const mark of marks) {
    if (mark.kind !== 'del' && mark.kind !== 'ins') continue;
    if (isTable(mark)) continue;
    const named = mark.entry.move ? byId.get(mark.entry.move) : undefined;
    if (named && mark.kind === 'del' && named.kind === 'ins') pair(mark, named);
    if (named && mark.kind === 'ins' && named.kind === 'del') pair(named, mark);
    if (mark.entry.group)
      groups.set(mark.entry.group, [...(groups.get(mark.entry.group) ?? []), mark]);
  }
  for (const members of groups.values()) {
    const dels = members.filter((mark) => mark.kind === 'del');
    const inss = members.filter((mark) => mark.kind === 'ins');
    if (dels.length === 1 && inss.length === 1) pair(dels[0] as MarkRange, inss[0] as MarkRange);
  }
  return halves;
}

export interface MoveRevision extends MoveHalf {
  /** The `w:id` that `docx` wrote for the revision. */
  id: number;
  /** An id for the range that wraps the side. */
  rangeId: number;
}
/** Renames the revisions that are halves of moves, and wraps each side in its range. */
export function patchMoves(xml: string, revisions: MoveRevision[]): string {
  let out = xml;
  const done: MoveRevision[] = [];
  for (const rev of revisions) {
    const was = rev.side === 'from' ? 'w:del' : 'w:ins';
    const now = rev.side === 'from' ? 'w:moveFrom' : 'w:moveTo';
    const open = out.indexOf(`<${was} w:id="${rev.id}"`);
    if (open === -1) continue;
    const tagEnd = out.indexOf('>', open);
    if (tagEnd === -1) continue;
    const selfClosing = out[tagEnd - 1] === '/';
    if (selfClosing) {
      out = `${out.slice(0, open)}<${now}${out.slice(open + 1 + was.length, tagEnd + 1)}${out.slice(tagEnd + 1)}`;
      continue;
    }
    const close = out.indexOf(`</${was}>`, tagEnd);
    if (close === -1) continue;
    let inner = out.slice(tagEnd + 1, close);
    if (rev.side === 'from') {
      inner = inner.replace(/<w:delText\b/g, '<w:t').replace(/<\/w:delText>/g, '</w:t>');
    }
    const start = out.slice(open + 1 + was.length, tagEnd + 1);
    out = `${out.slice(0, open)}<${now}${start}${inner}</${now}>${out.slice(close + was.length + 3)}`;
    done.push(rev);
  }
  // One range for each side of a move, from its first element to its last.
  const names = new Set(done.map((rev) => `${rev.name}:${rev.side}`));
  for (const key of names) {
    const mine = done.filter((rev) => `${rev.name}:${rev.side}` === key);
    const first = mine[0] as MoveRevision;
    const side = first.side === 'from' ? 'moveFrom' : 'moveTo';
    const tag = (rev: MoveRevision) => out.indexOf(`<w:${side} w:id="${rev.id}"`);
    const spots = mine.map(tag).filter((at) => at !== -1);
    if (spots.length === 0) continue;
    const firstAt = Math.min(...spots);
    const lastAt = Math.max(...spots);
    const startTag = out.slice(firstAt, out.indexOf('>', firstAt) + 1);
    const attributes = /w:author="[^"]*" w:date="[^"]*"/.exec(startTag)?.[0] ?? '';
    const lastClose = out.indexOf(`</w:${side}>`, lastAt) + `</w:${side}>`.length;
    out =
      out.slice(0, firstAt) +
      `<w:${side}RangeStart w:id="${first.rangeId}" w:name="${first.name}" ${attributes}/>` +
      out.slice(firstAt, lastClose) +
      `<w:${side}RangeEnd w:id="${first.rangeId}"/>` +
      out.slice(lastClose);
  }
  return out;
}
