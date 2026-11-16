// HTML with a Markdown twin (#690, design: "Markdown twins"): the block of HTML at a position, its
// twin if it has an exact one (`htmlTwin`, `@redlines/format`), and the conversion. A command that
// changes a block's structure (a heading's level, Tab in a list, a row or a column) calls
// `convertTwin` first, so that it acts on Markdown; where the HTML has no exact twin it says why
// (`TwinHere.reason`), which the command shows as its disabled hint. The text of the HTML is
// edited in place, with no conversion at all.
//
// With Track Changes on the conversion is a substitution of the whole block (accept gives the
// Markdown, reject gives the HTML back), and its change carries a note that names it, which the
// margin shows as the change's card. With it off the block is replaced. Either way it is one
// change and one step to undo, made before the command's own.

import { isolateHistory } from '@codemirror/commands';
import { forceParsing, syntaxTree } from '@codemirror/language';
import type { SyntaxNode } from '@lezer/common';
import { EditorSelection, type EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import {
  EditError,
  htmlTwin,
  NO_TWIN,
  trackedEdit,
  type Twin,
  type TwinKind,
} from '@redlines/format';
import { trackedEditAnnotation } from '../tracked/field.ts';
import { contextFor, rawIsReadOnly, trackingField } from '../tracked/typing.ts';
import { blockAt, type Span } from './structure.ts';

/** An HTML block with a twin (`twin`), or the reason it has none (`reason`). */
export interface TwinHere {
  /** The block's lines, from the start of its first to the end of its last. */
  lines: Span;
  kind: TwinKind;
  twin?: Twin;
  reason?: string;
}

/** Why a block in a quote or a list item is not converted. */
const IN_CONTAINER =
  "This HTML is inside a quote or a list item, so it can't be changed as Markdown. Move it out of the quote or item first.";

/**
 * The HTML block at `pos` that has a Markdown twin shape (a heading, a quote, a list, a table, a
 * rule, a pre with code) and its twin, or why it has none; null where `pos` is not in such a block.
 */
const cache = new WeakMap<EditorState, TwinHere | null>();

export function twinAt(state: EditorState, pos: number): TwinHere | null {
  if (pos !== state.selection.main.head) return findTwin(state, pos);
  let found = cache.get(state);
  if (found === undefined) {
    found = findTwin(state, pos);
    cache.set(state, found);
  }
  return found;
}

function findTwin(state: EditorState, pos: number): TwinHere | null {
  if (pos < 0 || pos > state.doc.length) return null;
  // Most positions are not in HTML at all: look at the syntax tree before reading blocks.
  for (
    let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, -1);
    ;
    node = node.parent
  ) {
    if (!node) return null;
    if (node.name === 'HTMLBlock') break;
  }
  const block = blockAt(state, pos);
  if (!block || block.kind !== 'html') return null;
  const source = state.sliceDoc(block.lines.from, block.lines.to);
  const above = block.lines.from > 0 ? state.doc.lineAt(block.lines.from - 1).text : '';
  // Inside a container the prefix of each line is the container's: no twin is written there.
  const read = htmlTwin(block.containers.length > 0 ? source.replace(/^[ \t>]*/, '') : source, {
    afterText: above.trim() !== '',
  });
  if ('reason' in read) {
    if (read.reason === NO_TWIN) return null;
    return { lines: block.lines, kind: read.kind ?? 'heading', reason: read.reason };
  }
  const { kind } = read.twin;
  if (block.containers.length > 0) return { lines: block.lines, kind, reason: IN_CONTAINER };
  if (rawIsReadOnly(state)) return { lines: block.lines, kind, reason: RAW };
  return { lines: block.lines, kind, twin: read.twin };
}

const RAW =
  'Raw is read-only while Track Changes is on. Turn Track Changes off to change this HTML as Markdown.';

/** Why a structure command can't run at the caret because of the HTML it is in, or undefined. */
export function twinReason(state: EditorState, kinds: readonly TwinKind[]): string | undefined {
  const here = twinAt(state, state.selection.main.head);
  return here && !here.twin && kinds.includes(here.kind) ? here.reason : undefined;
}

/** Whether the caret is in HTML of one of `kinds` that converts exactly. */
export function inTwin(state: EditorState, kinds: readonly TwinKind[]): boolean {
  const here = twinAt(state, state.selection.main.head);
  return !!here?.twin && kinds.includes(here.kind);
}

/**
 * Converts the HTML block at the caret to its twin, as one change: tracked as a substitution of the
 * whole block (its note names the conversion) with Track Changes on, replaced with it off. The
 * caret goes to the end of the twin's first line. True when it is done; otherwise why it isn't, as
 * a sentence for people (nothing to convert, or the format refused the change).
 */
export function convertTwin(view: EditorView, as?: string): true | string {
  const { state } = view;
  if (state.readOnly) return 'This document is read-only.';
  const here = twinAt(state, state.selection.main.head);
  if (!here?.twin) return here?.reason ?? 'There is no HTML here to change as Markdown.';
  const { from, to } = here.lines;
  const { what } = here.twin;
  const markdown = as ?? here.twin.markdown;
  const before = state.doc;
  try {
    if (state.field(trackingField)) {
      const ctx = { ...contextFor(state), note: `Converted the ${what} to Markdown` };
      const changes = trackedEdit(state.doc.toString(), { from, to, insert: markdown }, ctx);
      view.dispatch({
        changes,
        annotations: [isolateHistory.of('full'), trackedEditAnnotation.of(true)],
        userEvent: 'input.convert',
        scrollIntoView: true,
      });
    } else {
      view.dispatch({
        changes: { from, to, insert: markdown },
        annotations: isolateHistory.of('full'),
        userEvent: 'input.convert',
        scrollIntoView: true,
      });
    }
  } catch (error) {
    if (!(error instanceof EditError)) throw error;
    return error.message;
  }
  if (view.state.doc === before) return 'This HTML could not be changed as Markdown.';
  // The command that follows reads the twin's parse: make sure it has one.
  forceParsing(view, view.state.doc.length, 100);
  // The caret stays at the same place in the text: after as many letters and digits as it was.
  const at = view.state.doc.toString().indexOf(markdown, from);
  if (at >= 0) {
    const source = state.sliceDoc(from, to);
    const ahead = state.selection.main.head - from;
    const count = textBefore(source, Math.max(0, ahead), here.kind === 'code');
    view.dispatch({ selection: EditorSelection.cursor(at + placeAfter(markdown, count)) });
  }
  return true;
}

const WORD = /[\p{L}\p{N}]/u;
const NAMED: Record<string, string> = {
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&amp;': '&',
};

/** How many letters and digits of text lie before `ahead` in the HTML source (tags aren't text). */
function textBefore(source: string, ahead: number, code: boolean): number {
  let text = source.slice(0, ahead).replace(/<[^>]*>?/g, '');
  if (code) text = text.replace(/&(?:lt|gt|quot|#39|amp);/g, (entity) => NAMED[entity] ?? entity);
  let count = 0;
  for (const char of text) if (WORD.test(char)) count++;
  return count;
}

/** Where in the Markdown `count` letters and digits of text have passed, past each line's syntax. */
function placeAfter(markdown: string, count: number): number {
  const syntax = /^(?:[ \t]*>[ \t]?)*[ \t]*(?:#{1,6}[ \t]+|[-*+][ \t]+|\d{1,9}[.)][ \t]+)?/;
  let at = 0;
  let seen = 0;
  let first = -1;
  for (const line of markdown.split('\n')) {
    const start = syntax.exec(line)?.[0].length ?? 0;
    if (first < 0) first = at + start;
    if (count === 0) return first;
    let i = start;
    for (const char of line.slice(start)) {
      i += char.length;
      if (WORD.test(char) && ++seen >= count) return at + i;
    }
    at += line.length + 1;
  }
  return markdown.length;
}

/**
 * Whether Tab (or Shift-Tab, `outdent`) at the caret would move an item of an HTML list that
 * converts exactly: there is an item above it to go under, or a nested list to leave. A Tab that
 * would move nothing doesn't convert.
 */
export function htmlListMoves(state: EditorState, outdent: boolean): boolean {
  const { head } = state.selection.main;
  const here = twinAt(state, head);
  if (here?.kind !== 'list' || !here.twin) return false;
  const before = state.sliceDoc(here.lines.from, head);
  const items = before.match(/<li[\s>]/gi)?.length ?? 0;
  if (!outdent) return items > 1;
  const opened = before.match(/<(?:ul|ol)[\s>]/gi)?.length ?? 0;
  const closed = before.match(/<\/(?:ul|ol)\s*>/gi)?.length ?? 0;
  return opened - closed > 1;
}
