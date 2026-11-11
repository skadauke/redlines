// Return and Tab in code, display math, HTML blocks and front matter (design: block editing, "Code,
// tables, front matter, HTML blocks and rules"). Code holds blank lines, so Return in it is a line
// break in the code with the line's indentation; "Return twice" can't mean "leave", so Return on
// the empty last line of a fence leaves the block, and Return at the end of the opening fence goes
// into the code. Tab inserts the code's indentation unit, Shift-Tab takes one away. With Track
// Changes on every edit is the format's (rule 9, `code-edit.ts` in the format): a whole-block
// substitution, or for front matter a refusal in format §3.8's words.

import { type ChangeSpec, EditorSelection, EditorState, type Line } from '@codemirror/state';
import { blankOf, continuation, type KeyEdit, nothing, returnAtEnd } from './edits.ts';
import { trackedEditAnnotation } from '../tracked/field.ts';
import { openBlock, returnAnnotation, setOpenEffect } from './open.ts';
import { type Block, blockAt } from './structure.ts';

/** The kinds of block that take code keys. */
const CODE_KEYS = new Set(['code', 'math', 'html', 'front-matter']);

/** Whether a block's keys are these. */
export const takesCodeKeys = (block: Block) => CODE_KEYS.has(block.kind);

const OPEN_FENCE = /^[ \t>]*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+)*[ \t]*(`{3,}|~{3,})/;
const CLOSE_FENCE = /^[ \t>]*(`{3,}|~{3,})[ \t]*$/;

/** The lines of a block that holds code: its first and last lines, and the lines of code between,
 * which are all of them for indented code, math, an HTML block and front matter's body. */
interface Shape {
  first: Line;
  last: Line;
  /** The line that opens the block (a fence, `$$`, `---`), and the one that closes it. */
  opens: boolean;
  closes: boolean;
}

function shapeOf(state: EditorState, block: Block): Shape {
  const { doc } = state;
  const first = doc.lineAt(block.lines.from);
  const last = doc.lineAt(block.lines.to);
  const several = last.number > first.number;
  if (block.kind === 'code') {
    const fenced = OPEN_FENCE.test(first.text);
    return {
      first,
      last,
      opens: fenced,
      closes: fenced && several && CLOSE_FENCE.test(last.text),
    };
  }
  if (block.kind === 'front-matter') {
    return { first, last, opens: true, closes: several };
  }
  return { first, last, opens: false, closes: false };
}

/** The leading white space of a line's text after the container syntax `cont` of its block. */
function indentOf(line: Line, cont: string): string {
  const rest = line.text.startsWith(cont) ? line.text.slice(cont.length) : line.text;
  return /^[ \t]*/.exec(rest)?.[0] ?? '';
}

/** Whether the line holds nothing but white space after the block's container syntax. */
function emptyLine(line: Line, cont: string): boolean {
  const rest = line.text.startsWith(cont)
    ? line.text.slice(cont.length)
    : line.text.trim() === blankOf(cont).trim()
      ? ''
      : line.text;
  return rest.trim() === '';
}

/** A line break at `head`, with the indentation of the line it is typed in (as far as the caret). */
function lineBreak(state: EditorState, block: Block, head: number, line: Line): KeyEdit {
  const cont = continuation(state, block);
  const indent = indentOf(line, cont);
  const typed = Math.max(0, Math.min(indent.length, head - line.from - cont.length));
  const insert = `\n${cont}${indent.slice(0, typed)}`;
  return {
    changes: [{ from: head, insert }],
    selection: EditorSelection.single(head + insert.length),
    userEvent: 'input.break',
    caretAfterText: { from: head, text: insert },
  };
}

/**
 * Return in code, display math, an HTML block or front matter at `head`, or null where it is not
 * this block's to handle (the block's own start, and an HTML block's end, are `planReturn`'s).
 */
export function planCodeReturn(state: EditorState, block: Block, head: number): KeyEdit | null {
  if (!takesCodeKeys(block)) return null;
  const { doc } = state;
  const shape = shapeOf(state, block);
  const { first, last } = shape;
  const line = doc.lineAt(head);
  const cont = continuation(state, block);
  // The block's last line: past it the key makes an empty paragraph, except on the empty last
  // line of a fence, which leaves the block.
  if (shape.closes && line.number === last.number) return returnAtEnd(state, block);
  if (shape.opens && line.number === first.number) {
    // Anywhere on the opening line: into the code, with a line of its own at the line's end.
    const insert = `\n${cont}`;
    return {
      changes: [{ from: first.to, insert }],
      selection: EditorSelection.single(first.to + insert.length),
      userEvent: 'input.break',
      caretAfterText: { from: first.to, text: insert },
    };
  }
  if (!shape.closes && head === last.to && block.kind !== 'code') {
    // The end of a block that no line closes: the empty paragraph after it.
    return returnAtEnd(state, block);
  }
  const lastCode = shape.closes ? doc.line(last.number - 1) : last;
  if (
    block.kind === 'code' &&
    shape.closes &&
    line.number === lastCode.number &&
    line.number > first.number &&
    emptyLine(line, cont)
  ) {
    return leave(state, block, line);
  }
  if (block.kind === 'code' && !shape.opens && head === last.to) {
    // The end of indented code: a line break with the line's indentation. A line of white space
    // alone is no part of an indented block, so the new line is open, as the empty paragraph a
    // Return opens is: drawn, with the caret on it, and not in the file until something is typed.
    const edit = lineBreak(state, block, head, line);
    return {
      ...edit,
      plain: true,
      open: {
        at: head,
        assoc: 1,
        down: 1,
        pressedIn: { from: block.lines.from, to: block.lines.to },
      },
    };
  }
  return lineBreak(state, block, head, line);
}

/**
 * The indented code above the open line of white space that Return at its end opened, when `head`
 * is on it: a second Return there leaves the block.
 */
export function openIndentedLine(state: EditorState, head: number): Block | null {
  const open = openBlock(state);
  if (!open || open.item || open.line || head < open.empty.from || head > open.empty.to)
    return null;
  const { doc } = state;
  const line = doc.lineAt(open.empty.from);
  if (line.number < 2 || !/^[ \t]+$/.test(line.text)) return null;
  const above = doc.line(line.number - 1);
  const block = blockAt(state, above.from);
  if (block?.kind !== 'code' || block.lines.to !== above.to) return null;
  return OPEN_FENCE.test(doc.lineAt(block.lines.from).text) ? null : block;
}

/**
 * Return on the empty last line of a fence: the empty line goes and an empty paragraph opens after
 * the closing fence. One step: the deletion of the line and the break after the block.
 */
function leave(state: EditorState, block: Block, empty: Line): KeyEdit {
  const { doc } = state;
  const above = doc.line(empty.number - 1);
  const after = returnAtEnd(state, block);
  const deleted = empty.to - above.to;
  const changes: ChangeSpec[] = [{ from: above.to, to: empty.to }, ...after.changes];
  const caret = after.selection.main.head - deleted;
  return {
    ...after,
    changes,
    selection: EditorSelection.single(caret),
  };
}

/** The indentation unit of a language, by the name its fence gives it. */
const UNITS: Record<string, string> = {
  python: '    ',
  py: '    ',
  rust: '    ',
  rs: '    ',
  c: '    ',
  cpp: '    ',
  'c++': '    ',
  cs: '    ',
  csharp: '    ',
  java: '    ',
  kotlin: '    ',
  kt: '    ',
  swift: '    ',
  php: '    ',
  scala: '    ',
  go: '\t',
  golang: '\t',
  make: '\t',
  makefile: '\t',
  js: '  ',
  javascript: '  ',
  jsx: '  ',
  ts: '  ',
  typescript: '  ',
  tsx: '  ',
  json: '  ',
  jsonc: '  ',
  yaml: '  ',
  yml: '  ',
  css: '  ',
  scss: '  ',
  html: '  ',
  xml: '  ',
  r: '  ',
  ruby: '  ',
  rb: '  ',
  sh: '  ',
  bash: '  ',
  zsh: '  ',
  shell: '  ',
  lua: '  ',
  sql: '  ',
  tex: '  ',
  latex: '  ',
};

/**
 * What one Tab puts in: the unit of the code's language (its fence names it, `js`, `{python}`,
 * `{r, echo=FALSE}`), else what its lines use — a tab if they are indented by tabs, else the
 * smallest indentation any of them has, else two spaces.
 */
export function indentUnit(state: EditorState, block: Block): string {
  const { doc } = state;
  const first = doc.lineAt(block.lines.from);
  if (block.kind === 'front-matter') return '  ';
  if (block.kind === 'code' && OPEN_FENCE.test(first.text)) {
    const info = first.text.replace(OPEN_FENCE, '').trim();
    const name = /^\{?\s*\.?([A-Za-z0-9_+#-]+)/.exec(info)?.[1]?.toLowerCase();
    const unit = name === undefined ? undefined : UNITS[name];
    if (unit !== undefined) return unit;
  }
  const cont = continuation(state, block);
  let smallest = Infinity;
  const end = doc.lineAt(block.lines.to).number;
  for (let n = first.number; n <= end; n++) {
    const line = doc.line(n);
    if (n === first.number && block.kind === 'code' && OPEN_FENCE.test(line.text)) continue;
    if (emptyLine(line, cont)) continue;
    const indent = indentOf(line, cont);
    if (indent.startsWith('\t')) return '\t';
    if (indent.length > 0) smallest = Math.min(smallest, indent.length);
  }
  return smallest === Infinity ? '  ' : ' '.repeat(smallest);
}

/** The lines the selection touches, the last one only if the selection reaches into it. */
function linesOf(state: EditorState, from: number, to: number): Line[] {
  const { doc } = state;
  const lines: Line[] = [];
  const last =
    to > from && doc.lineAt(to).from === to ? doc.lineAt(to).number - 1 : doc.lineAt(to).number;
  for (let n = doc.lineAt(from).number; n <= last; n++) lines.push(doc.line(n));
  return lines;
}

/**
 * Tab and Shift-Tab in code, math, an HTML block or front matter. Tab at the caret puts in the
 * indentation unit; over a selection, in front of each line it touches. Shift-Tab takes one unit
 * (or the spaces of one) from the start of the lines the caret or selection touches. Not on a
 * fence's own lines.
 */
export function planCodeTab(state: EditorState, block: Block, outdent: boolean): KeyEdit | null {
  if (!takesCodeKeys(block)) return null;
  const { doc, selection } = state;
  const { from, to, empty } = selection.main;
  const shape = shapeOf(state, block);
  const unit = indentUnit(state, block);
  const cont = continuation(state, block);
  const onFence = (line: Line) =>
    (shape.opens && line.number === shape.first.number) ||
    (shape.closes && line.number === shape.last.number);
  if (!outdent && empty) {
    if (onFence(doc.lineAt(from))) return nothing(state);
    return {
      changes: [{ from, insert: unit }],
      selection: EditorSelection.single(from + unit.length),
      userEvent: 'indent',
      caretAfterText: { from, text: unit },
    };
  }
  const lines = linesOf(state, from, to).filter((line) => !onFence(line));
  if (lines.length === 0) return nothing(state);
  const changes: ChangeSpec[] = [];
  for (const line of lines) {
    const start = line.from + (line.text.startsWith(cont) ? cont.length : 0);
    if (!outdent) {
      if (!emptyLine(line, cont)) changes.push({ from: start, insert: unit });
      continue;
    }
    const rest = doc.sliceString(start, line.to);
    const lead = /^[ \t]*/.exec(rest)?.[0] ?? '';
    if (lead === '') continue;
    // A tab, or as many spaces as the unit has (fewer if the line has fewer).
    const take = lead.startsWith('\t')
      ? 1
      : Math.min(/^ */.exec(lead)?.[0].length ?? 0, unit === '\t' ? 4 : unit.length);
    if (take > 0) changes.push({ from: start, to: start + take });
  }
  if (changes.length === 0) return nothing(state);
  const mapped = state.changes(changes);
  return {
    changes,
    selection: EditorSelection.single(
      mapped.mapPos(selection.main.anchor, 1),
      mapped.mapPos(selection.main.head, 1),
    ),
    userEvent: 'indent',
  };
}

/**
 * Spaces typed on the open line under indented code stay on it: the line is still a line of white
 * space alone, no part of the block, so it stays open, drawn and not in the file, as it was before.
 * Written as they are, with Track Changes on too, where no change could carry a line of white
 * space (the format has none to mark). The first character that is not white space writes the line.
 */
export const openLineSpaces = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || !tr.isUserEvent('input.type') || tr.isUserEvent('input.type.compose')) {
    return tr;
  }
  const open = openBlock(tr.startState);
  const { head } = tr.startState.selection.main;
  if (!open || openIndentedLine(tr.startState, head) === null) return tr;
  let spaces = true;
  tr.changes.iterChanges((from, to, _a, _b, text) => {
    if (
      from !== to ||
      from < open.empty.from ||
      from > open.empty.to ||
      !/^[ \t]+$/.test(text.toString())
    ) {
      spaces = false;
    }
  });
  if (!spaces) return tr;
  return {
    changes: tr.changes,
    selection: tr.selection,
    effects: [
      ...tr.effects,
      setOpenEffect.of({
        ...open,
        empty: {
          from: tr.changes.mapPos(open.empty.from, -1),
          to: tr.changes.mapPos(open.empty.to, 1),
        },
        pressedIn: open.pressedIn && {
          from: tr.changes.mapPos(open.pressedIn.from, -1),
          to: tr.changes.mapPos(open.pressedIn.to, 1),
        },
      }),
    ],
    // Kept in the record with the Return, so that the file has neither.
    annotations: [trackedEditAnnotation.of(true), returnAnnotation.of(true)],
    userEvent: 'input.type',
    scrollIntoView: tr.scrollIntoView,
  };
});
