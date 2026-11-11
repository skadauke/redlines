// What the parts of the review interface share: the editor they work on and its changes, how they
// write to the ledger, and how a refused action shows.

import { EditorSelection } from '@codemirror/state';
import { EditorView, type Rect } from '@codemirror/view';
import { type Author, type Editor, setViewModeEffect, viewModeField } from '@redlines/editor';
import {
  type BlockType,
  EditError,
  type EditContext,
  type FormatOp,
  formatChange,
  type InlineFormat,
  type MarkRange,
  type Parsed,
  type Person,
  type Range,
  type Segment,
  suggestions,
  type TextChange,
  type Time,
} from '@redlines/format';

/** The editor that the review interface works on, and the person using it. */
export interface ReviewContext {
  readonly editor: Editor;
  readonly author: Author;
}

/**
 * The pending changes in document order, as the editor draws and decides them
 * (`EditorUiState.changes`): the one list that the bar, the cards and the notes go by.
 */
export function changesOf(ctx: ReviewContext): readonly MarkRange[] {
  return ctx.editor.getUiState().changes;
}

/**
 * The pending changes as suggestions (format §6, `group`): the marks of one agent edit that share a
 * group and a note are one, and the cards, the bar and the decisions treat them as one. In
 * document order, by each suggestion's first mark.
 */
export function suggestionsOf(ctx: ReviewContext): MarkRange[][] {
  return suggestions(changesOf(ctx));
}

/** The marks of the suggestion that change `id` is in: itself alone when it has no group. */
export function suggestionIn(ctx: ReviewContext, id: string): MarkRange[] {
  const found = suggestionsOf(ctx).find((marks) => marks.some((mark) => mark.id === id));
  return found ?? changesOf(ctx).filter((mark) => mark.id === id);
}

/** The text of the suggestion that change `id` is in, from the start of its first mark to the end of its last. */
export function suggestionRange(ctx: ReviewContext, id: string): Range | null {
  const marks = suggestionIn(ctx, id);
  const first = marks[0];
  const last = marks.at(-1);
  return first && last ? { from: spanOf(first).from, to: spanOf(last).to } : null;
}

/**
 * Accepts or rejects the whole suggestion that change `id` is in, in one step to undo, or none of
 * it when one mark is refused. A mark alone is decided by its id, as always. Returns whether it
 * decided.
 *
 * Nothing is decided in Simple, where the old text of a change is hidden (design: No decision is
 * made in Simple): the view switches to Redlines and the suggestion is shown, selected and in view,
 * for the person to decide where it can be read. This one function holds the rule, so the notes,
 * the cards and the review bar's buttons all obey it, and it returns false.
 *
 * @throws EditError when the editor refuses.
 */
export function decideSuggestion(
  ctx: ReviewContext,
  how: 'accept' | 'reject',
  id: string,
): boolean {
  const { view } = ctx.editor;
  if (view.state.field(viewModeField) === 'simple') {
    const range = suggestionRange(ctx, id);
    // The switch alone, not a choice: the markup view stays Simple.
    view.dispatch({
      ...(range ? { selection: EditorSelection.range(range.from, range.to) } : {}),
      effects: [
        setViewModeEffect.of('redlines'),
        ...(range
          ? [
              EditorView.scrollIntoView(EditorSelection.range(range.from, range.to), {
                y: 'center' as const,
              }),
            ]
          : []),
      ],
      userEvent: 'select.review',
    });
    return false;
  }
  const ids = suggestionIn(ctx, id).map((mark) => mark.id);
  ctx.editor[how](ids.length > 1 ? ids : id);
  return true;
}

/**
 * Where a segment's opener ends: after its marker, and when the opener stands on a line of its own
 * before a block (format §3.3), after the line break and prefix that carry it.
 */
export function openerEnd(segment: Segment): number {
  return segment.carrier?.to ?? segment.open.to;
}

/**
 * Where a segment's text starts on screen: after an opener on a line of its own, else at the
 * opener, where deleted text is drawn.
 */
export function visibleStart(segment: Segment): number {
  return segment.carrier ? segment.carrier.to : segment.open.from;
}

/** Where a segment is in the text, its markers included. */
export function segmentSpan(segment: Segment): Range {
  return { from: segment.open.from, to: segment.close?.to ?? openerEnd(segment) };
}

/** Where a mark is in the text, markers included: from its first opener to its last closer. */
export function spanOf(mark: MarkRange): Range {
  const first = mark.segments[0];
  const last = mark.segments.at(-1);
  if (!first || !last) return { from: 0, to: 0 };
  return { from: first.open.from, to: segmentSpan(last).to };
}

/**
 * The text of `ranges` as it reads, without the markers of any marks inside them, or what carries
 * an opener on a line of its own.
 */
export function textOf(parsed: Parsed, ranges: readonly Range[]): string {
  const markers = parsed.marks
    .flatMap(({ segments }) =>
      segments.flatMap((segment) => {
        const opener = { from: segment.open.from, to: openerEnd(segment) };
        return segment.close ? [opener, segment.close] : [opener];
      }),
    )
    .sort((a, b) => a.from - b.from);
  return ranges
    .map(({ from, to }) => {
      let text = '';
      let pos = from;
      for (const marker of markers) {
        if (marker.to <= pos || marker.from >= to) continue;
        text += parsed.text.slice(pos, marker.from);
        pos = marker.to;
      }
      return text + parsed.text.slice(pos, to);
    })
    .join(' ');
}

/** The text a change put in, as it reads: an insertion's, or a substitution's new text. */
export function insertedText(parsed: Parsed, change: MarkRange): string {
  return textOf(
    parsed,
    change.segments.map(({ content }) => content),
  );
}

/** The most characters of changed text that a card or a note quotes. */
const QUOTE_LIMIT = 40;

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/**
 * Text on one line, and at most 40 characters, the last an ellipsis when it was longer.
 * Characters are what a reader sees as one, so an emoji is never cut in half. Empty for white
 * space alone.
 */
export function shorten(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const chars = [...graphemes.segment(flat)].map(({ segment }) => segment);
  if (chars.length <= QUOTE_LIMIT) return flat;
  return `${chars
    .slice(0, QUOTE_LIMIT - 1)
    .join('')
    .trimEnd()}…`;
}

/**
 * Text as a card or a note quotes it: on one line, and at most 40 characters (see `shorten`). White
 * space alone, which would read as nothing, shows its characters as Word's formatting marks do: a
 * space as ·, a tab as → and a line break as ¶.
 */
export function readable(text: string): string {
  const short = shorten(text);
  if (short || !text) return short;
  return shorten(
    text
      .replace(/\r\n?|\n/g, '¶')
      .replace(/\t/g, '→')
      .replace(/\s/g, '·'),
  );
}

/** What a change took out and what it put in. */
export interface ChangeTexts {
  /** A deletion's text, or the text a substitution replaced; empty for the other kinds. */
  old: string;
  /** An insertion's text, or a substitution's new text; a split's line break; else empty. */
  added: string;
  /** What a format change did, as `formatLabel` names it; absent for the other kinds. */
  label?: string;
}

/** Whether a change is an inserted table row (format §3.7). */
export const isRowInsertion = (change: MarkRange) =>
  change.kind === 'ins' && change.payload === 'row';

/** What rows inserted together did, in the words of a card and a note: `Inserted 2 rows`. */
export const insertedRows = (count: number) =>
  count === 1 ? 'Inserted row' : `Inserted ${count} rows`;

/** What a change took out and what it put in: the one reading of a change's kind. A format change
 * changed no text, and has its label instead. */
export function changeTexts(parsed: Parsed, change: MarkRange): ChangeTexts {
  if (change.kind === 'fmt') {
    return { old: '', added: '', label: formatLabel(formatChange(parsed, change)) };
  }
  const old = change.kind === 'del' || change.kind === 'sub' ? (change.payload ?? '') : '';
  const added =
    change.kind === 'split' ? '\n' : change.kind === 'del' ? '' : insertedText(parsed, change);
  return { old, added };
}

const INLINE_NAMES: Record<InlineFormat, string> = {
  bold: 'Bold',
  italic: 'Italic',
  strike: 'Strikethrough',
  code: 'Code',
};

const BLOCK_NAMES: Record<BlockType, string> = {
  p: 'Paragraph',
  h1: 'Heading 1',
  h2: 'Heading 2',
  h3: 'Heading 3',
  h4: 'Heading 4',
  h5: 'Heading 5',
  h6: 'Heading 6',
  ul: 'Bulleted list',
  ol: 'Numbered list',
  task: 'Task list',
  quote: 'Quote',
};

/** A format change's operations as a person reads them: `Bold`, `Not italic`, `Heading 2`, `Link`,
 * `Indent`, `Checked`, joined in one phrase when a change has several: `Not bold, not italic`. */
export function formatLabel(ops: readonly FormatOp[]): string {
  const names = ops.map((op) => {
    switch (op.kind) {
      case 'inline':
        return op.on ? INLINE_NAMES[op.format] : `Not ${INLINE_NAMES[op.format].toLowerCase()}`;
      case 'clear':
        return 'Plain text';
      case 'link':
        return op.url === null ? 'No link' : 'Link';
      case 'block':
        return BLOCK_NAMES[op.to];
      case 'indent':
        return op.by > 0 ? 'Indent' : 'Outdent';
      case 'check':
        return op.checked ? 'Checked' : 'Unchecked';
    }
  });
  if (names.length === 0) return 'Formatted';
  // One phrase: `Not bold, not italic, not code`.
  return names
    .map((name, i) => (i === 0 ? name : name[0]!.toLowerCase() + name.slice(1)))
    .join(', ');
}

/** A time as the ledger writes it: UTC, to the minute (`2026-10-31T09:41Z`). */
function ledgerTime(date: Date): Time {
  return `${date.toISOString().slice(0, 16)}Z`;
}

/** An edit by `author`, now. Only the fields `author` has are written to the ledger's people. */
export function editContext(author: Author): EditContext {
  const person: Person = { handle: author.handle, name: author.name };
  if (author.email !== undefined) person.email = author.email;
  if (author.agent !== undefined) person.agent = author.agent;
  if (author.for !== undefined) person.for = author.for;
  return { author: person, time: ledgerTime(new Date()) };
}

/**
 * Applies a ledger edit made by @redlines/format, such as a reply. It isn't typing, so Track
 * Changes leaves it alone, and Undo takes it back.
 */
export function applyEdit(view: EditorView, changes: TextChange[], userEvent: string): void {
  if (changes.length) view.dispatch({ changes, userEvent });
}

/** How long the message of a refused action shows. */
const FLASH_MS = 4000;
const flashes = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

/** Shows `message` in `line` for a few seconds. */
export function flash(line: HTMLElement, message: string): void {
  clearTimeout(flashes.get(line));
  line.textContent = message;
  line.hidden = false;
  flashes.set(
    line,
    setTimeout(() => (line.hidden = true), FLASH_MS),
  );
}

/**
 * Runs an action that may be refused, such as a decision in a file whose ledger can't be read. A
 * refusal (`EditError`) changes nothing, and its message shows in `line` for a few seconds.
 * Returns whether the action ran.
 */
export function attempt(line: HTMLElement, run: () => void): boolean {
  try {
    run();
    return true;
  } catch (error) {
    if (!(error instanceof EditError)) throw error;
    flash(line, error.message);
    return false;
  }
}

/** A line for the message of a refused action, hidden until there is one. */
export function errorLine(className: string): HTMLElement {
  const line = element('div', className);
  line.setAttribute('role', 'status');
  line.hidden = true;
  return line;
}

/**
 * The part of the window where the editor can be seen: the window, less what its scrolling
 * ancestors hide, such as a title bar above the scrolling page. The editor's own scroller computes
 * `overflow-y: auto` beside its `overflow-x`, while the page may scroll in an ancestor instead, so
 * it counts only while it really scrolls.
 */
export function visibleSpace(view: EditorView): Rect {
  const win = view.dom.ownerDocument.defaultView ?? window;
  const space = { left: 0, top: 0, right: win.innerWidth, bottom: win.innerHeight };
  for (let el: HTMLElement | null = view.scrollDOM; el; el = el.parentElement) {
    if (!/auto|scroll/.test(win.getComputedStyle(el).overflowY)) continue;
    if (el === view.scrollDOM && el.scrollHeight <= el.clientHeight) continue;
    const rect = el.getBoundingClientRect();
    space.top = Math.max(space.top, rect.top);
    space.bottom = Math.min(space.bottom, rect.bottom);
  }
  return space;
}

/** An element with a class, and text if given. */
export function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

/**
 * A button with a label, or an icon labeled for assistive technology. Clicking it keeps the
 * keyboard focus where it is, in the document, so that the selection stays visible and typing goes
 * on where it was.
 */
export function button(
  className: string,
  label: string,
  run: () => void,
  icon?: SVGSVGElement,
): HTMLButtonElement {
  const el = element('button', className);
  el.type = 'button';
  if (icon) {
    el.append(icon);
    el.setAttribute('aria-label', label);
  } else {
    el.textContent = label;
  }
  el.addEventListener('mousedown', (event) => event.preventDefault());
  el.addEventListener('click', () => run());
  return el;
}
