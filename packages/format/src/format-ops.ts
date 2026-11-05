// The operations of a format change (format §2.6): what a person asks for, and how a payload says
// what changed, written and read.

import { decodePayload, encodePayload } from './payload.ts';
import type { MarkRange, Segment } from './types.ts';

export type InlineFormat = 'bold' | 'italic' | 'strike' | 'code';

export type BlockType =
  'p' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'ul' | 'ol' | 'task' | 'quote';

/** A change of formatting that a person asks for. */
export type FormatOp =
  | { kind: 'inline'; format: InlineFormat; on: boolean }
  /** Removes every inline format in the range. */
  | { kind: 'clear' }
  /** Adds a link, changes its address, or removes it with null. */
  | { kind: 'link'; url: string | null }
  | { kind: 'check'; checked: boolean }
  | { kind: 'block'; to: BlockType }
  | { kind: 'indent'; by: 1 | -1 };

/** One operation of a `fmt` payload (format §2.6). */
export interface ParsedFormatOp {
  /** The operation as it is written in the file, escapes and all. */
  source: string;
  /** `+` added, `-` removed, nothing for a value that changed. */
  sign: '+' | '-' | '';
  /** What it is about: `bold`, `link`, `check`, `was`, `@width`. */
  name: string;
  /** What follows the `=`, with its escapes read: the old address, the old block type. */
  value?: string;
  /** What a person would ask for to turn it back, for views. Rejecting undoes the operation
   * exactly, which this may not: `-bold=__` writes `__` back, and this asks for bold. Absent for an
   * operation that `FormatOp` has no word for. */
  inverse?: FormatOp;
}

export const INLINE_FORMATS: readonly InlineFormat[] = ['bold', 'italic', 'strike', 'code'];
const BLOCK_TYPES: readonly string[] = [
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'task',
  'quote',
];

/** The syntax that new text of a format is written with. */
export const DELIMITER: Record<InlineFormat, string> = {
  bold: '**',
  italic: '*',
  strike: '~~',
  code: '`',
};

export const isInlineFormat = (name: string): name is InlineFormat =>
  (INLINE_FORMATS as readonly string[]).includes(name);
const isBlockType = (name: string): name is BlockType => BLOCK_TYPES.includes(name);

function inverseOf(
  sign: ParsedFormatOp['sign'],
  name: string,
  value: string | undefined,
): FormatOp | undefined {
  if (isInlineFormat(name) && sign !== '')
    return { kind: 'inline', format: name, on: sign === '-' };
  if (name === 'link') {
    if (sign === '+') return { kind: 'link', url: null };
    if (value !== undefined) return { kind: 'link', url: value };
  }
  if (name === 'check' && sign !== '') return { kind: 'check', checked: sign === '-' };
  if (name === 'was' && sign === '' && value !== undefined && isBlockType(value)) {
    return { kind: 'block', to: value };
  }
  return undefined;
}

/** A payload as operations, for views and decisions. `payload` is the operations as they are
 * written, as `Segment.payload` and `MarkRange.payload` have them. */
export function parseFormatOps(payload: string): ParsedFormatOp[] {
  return payload
    .split(' ')
    .filter((source) => source !== '')
    .map((source) => {
      const sign = source[0] === '+' || source[0] === '-' ? source[0] : '';
      const equals = source.indexOf('=');
      const name = source.slice(sign.length, equals === -1 ? undefined : equals);
      const op: ParsedFormatOp = { source, sign, name };
      if (equals !== -1) op.value = decodePayload(source.slice(equals + 1));
      const inverse = inverseOf(sign, name, op.value);
      if (inverse) op.inverse = inverse;
      return op;
    });
}

/** A value of an operation as the payload writes it: escaped, and a space is `\x20`, so that a space
 * is only ever what parts operations (format §2.6). */
export function encodeValue(value: string): string {
  return value
    .split(' ')
    .map((part, i, parts) => {
      // A backslash in front of the escape of the space would be read as an escape itself.
      const ends = i < parts.length - 1 && part.endsWith('\\');
      return encodePayload(part) + (ends ? '\\' : '');
    })
    .join('\\x20');
}

/** The operation that says a format was removed: with the syntax it was written with, unless that
 * is the one this format is written with anyway. */
export function removedOp(format: InlineFormat, syntax: string): string {
  return syntax === DELIMITER[format] ? `-${format}` : `-${format}=${encodeValue(syntax)}`;
}

/** The syntax a removed format may have been written with (format §2.6). Anything else in the file
 * would write words that no view showed. */
const REMOVED_SYNTAX: Record<InlineFormat, RegExp> = {
  bold: /^(?:\*\*|__)$/,
  italic: /^[*_]$/,
  strike: /^~~?$/,
  code: /^`+ ?$/,
};

/** Whether rejecting knows what an operation of the inline formats or a link asks for. */
function isUndoable({ name, sign, value, inverse }: ParsedFormatOp): boolean {
  if (inverse?.kind === 'link') return true;
  if (inverse?.kind !== 'inline' || !isInlineFormat(name)) return false;
  if (value === undefined) return true;
  return sign === '-' && REMOVED_SYNTAX[name].test(value);
}

/** Whether accepting and rejecting know all the operations of the mark. `was=` and `+check` come
 * with block format changes, and the others are read and kept. */
export function decidesFormat(mark: MarkRange): boolean {
  return mark.segments.every((segment) => opsOf(mark, segment).every(isUndoable));
}

/** The operations of a segment. Each has its own; one made by another tool may leave them to the
 * first. */
export function opsOf(mark: MarkRange, segment: Segment): ParsedFormatOp[] {
  return parseFormatOps(segment.payload ?? mark.payload ?? '');
}
