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
  const was = name === 'was' && sign === '' ? readWas(value) : undefined;
  if (was) return { kind: 'block', to: was.type };
  return undefined;
}

/** The type and the old syntax of a `was=` value: `ol=3.\x20` is a numbered item that was written
 * `3. `, and `ol` one that was written `1. `, as the serializer writes it. */
export function readWas(
  value: string | undefined,
): { type: BlockType; syntax?: string } | undefined {
  if (value === undefined) return undefined;
  const equals = value.indexOf('=');
  const type = equals === -1 ? value : value.slice(0, equals);
  if (!isBlockType(type)) return undefined;
  if (equals === -1) return { type };
  // Old syntax that its type can't have written is no syntax to write back, and is not decided.
  const syntax = value.slice(equals + 1);
  return OLD_SYNTAX[type].test(syntax) ? { type, syntax } : undefined;
}

/** What the old syntax of each type may be (format §2.6). */
const OLD_SYNTAX: Record<BlockType, RegExp> = {
  p: /^$/,
  h1: /^# +$/,
  h2: /^## +$/,
  h3: /^### +$/,
  h4: /^#### +$/,
  h5: /^##### +$/,
  h6: /^###### +$/,
  ul: /^[-+*] +$/,
  ol: /^\d{1,9}[.)] +$/,
  task: /^(?:[-+*]|\d{1,9}[.)]) +\[[ xX]\] +$/,
  quote: /^> ?$/,
};
/** Whether the operations are those of a block format change that rejecting can undo: one `was=`
 * (of a type, or `indent=N`) or one box. */
export function isBlockUndo(ops: readonly ParsedFormatOp[]): boolean {
  const [op] = ops;
  if (ops.length !== 1 || !op) return false;
  if (op.name === 'check') return op.sign !== '' && (op.value === undefined || op.value === 'X');
  if (op.name !== 'was' || op.sign !== '') return false;
  // An indentation is a few spaces: one past what a list nests is not one.
  return /^indent=\d{1,2}$/.test(op.value ?? '') || readWas(op.value) !== undefined;
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
    .map((part, i, parts) =>
      // A part that a space follows is encoded as if more came after it: its last `-` needs no
      // escape, and a backslash at its end is one, which the escape of the space can't take.
      i < parts.length - 1 ? encodePayload(`${part}x`).slice(0, -1) : encodePayload(part),
    )
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

/** Whether accepting and rejecting know all the operations of the mark: those of inline formats and
 * links, or the one of a block format change. Others are read and kept. */
export function decidesFormat(mark: MarkRange): boolean {
  return mark.segments.every((segment) => {
    const ops = opsOf(mark, segment);
    return isBlockUndo(ops) || ops.every(isUndoable);
  });
}

/** The operations of a segment. Each has its own; one made by another tool may leave them to the
 * first. */
export function opsOf(mark: MarkRange, segment: Segment): ParsedFormatOp[] {
  return parseFormatOps(segment.payload ?? mark.payload ?? '');
}
