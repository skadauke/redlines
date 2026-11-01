// What the parts of the review interface share: the editor they work on, which marks are changes,
// and how they write to the ledger.

import type { EditorView } from '@codemirror/view';
import type { Author, Editor } from '@redlines/editor';
import type { EditContext, MarkRange, Person, Range, TextChange, Time } from '@redlines/format';

/** The editor that the review interface works on, and the person using it. */
export interface ReviewContext {
  readonly editor: Editor;
  readonly author: Author;
}

/**
 * Whether the editor draws and decides a mark as a change: an insertion, a deletion or a
 * substitution, as in `EditorUiState.changes`. Format changes, splits and table row and column
 * marks aren't decided in this version.
 */
export function isChange(mark: MarkRange): boolean {
  if (mark.kind === 'sub') return true;
  if (mark.kind === 'ins') return mark.payload === undefined;
  return mark.kind === 'del' && !/^(?:row|col)=/.test(mark.payload ?? '');
}

/** Where a mark is in the text, markers included: from its first opener to its last closer. */
export function spanOf(mark: MarkRange): Range {
  const first = mark.segments[0];
  const last = mark.segments.at(-1);
  if (!first || !last) return { from: 0, to: 0 };
  return { from: first.open.from, to: (last.close ?? last.open).to };
}

/** A time as the ledger writes it: UTC, to the minute (`2026-10-31T09:41Z`). */
export function ledgerTime(date: Date): Time {
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
