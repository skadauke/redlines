// Format changes (format §2.6) as Word's property changes: `w:rPrChange` holds the properties a run
// had before, `w:pPrChange` those of a paragraph. The file holds the newest formatting, so the old
// is that with each operation undone.

import { parseFormatOps } from '@redlines/format';
import type { MarkRange, ParsedFormatOp, Segment } from '@redlines/format';
import type { Fmt } from './blocks.ts';

const INLINE = ['bold', 'italic', 'strike', 'code', 'sub', 'sup'] as const;

/** The operations of one segment of a `fmt` mark. */
export function opsOf(mark: MarkRange, segment: Segment): ParsedFormatOp[] {
  return parseFormatOps(segment.payload ?? mark.payload ?? '');
}

/** The formatting a run had before the operations: `+bold` was not bold, `-bold` was. Null when
 * none of them is one of the formats a run has. */
export function oldFormat(fmt: Fmt, ops: ParsedFormatOp[]): Fmt | null {
  const old: Fmt = { ...fmt };
  let changed = false;
  for (const op of ops) {
    const name = INLINE.find((format) => format === op.name);
    if (!name || op.sign === '') continue;
    old[name] = op.sign === '-';
    changed = true;
  }
  return changed ? old : null;
}

/** The alignment of each column in a delimiter row (`| :-- | --: |`): `left`, `center`, `right`,
 * or '' for none. Markers in the row are no cells. */
export function alignsOf(row: string): ('' | 'left' | 'center' | 'right')[] {
  const cells = row
    .replace(/<!--[\s\S]*?-->/g, '')
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
  return cells.map((cell) => {
    const left = cell.startsWith(':');
    const right = cell.endsWith(':');
    return left && right ? 'center' : right ? 'right' : left ? 'left' : '';
  });
}

/** The old block type of a `was=` value: `h2`, `ul`, `ol=3.\x20`, `indent=4`. */
export function blockWas(value: string | undefined): { type: string; indent?: number } | null {
  if (!value) return null;
  const [type, rest] = value.split('=');
  if (type === 'indent') return { type, indent: Number(rest) || 0 };
  return type ? { type } : null;
}

/** Word wants a property change to hold the old properties, even when there were none: `docx`
 * writes `<w:rPrChange .../>` alone then, which Word reads as damage. */
export function completeChanges(xml: string): string {
  return xml
    .replace(/<w:rPrChange\b([^>]*?)\/>/g, '<w:rPrChange$1><w:rPr/></w:rPrChange>')
    .replace(/<w:pPrChange\b([^>]*?)\/>/g, '<w:pPrChange$1><w:pPr/></w:pPrChange>');
}
