// @vitest-environment happy-dom
// Resolved comment threads (design §5.7): hidden by default, shown on request as settled notes in
// the rail, and reopened from their note.
import type { Editor } from '@redlines/editor';
import { parse } from '@redlines/format';
import { afterEach, describe, expect, it } from 'vitest';
import { notesIn, stack } from './rail.ts';
import {
  button,
  file,
  frame,
  mount,
  PEOPLE,
  press,
  stubHeights,
  thread,
  unmountAll,
} from './test-helpers.ts';

afterEach(unmountAll);

/** Two threads on one line: the first resolved by Bo, the second open. */
const mixed = file(
  'The <!--cmt c2dk-->importer<!--/c2dk--> ships in <!--cmt c3fm-->April<!--/c3fm-->.\n\nMore text.',
  [
    ...PEOPLE,
    'comments:',
    ...thread('c2dk', 'ada', 'Which importer?', [], 'bo 2026-11-01T10:00Z'),
    ...thread('c3fm', 'ada', 'Or May?'),
  ],
);

/** One thread, resolved: no open note, and no change with a note. */
const onlyResolved = file('A <!--cmt c2dk-->settled<!--/c2dk--> point.', [
  ...PEOPLE,
  'comments:',
  ...thread('c2dk', 'ada', 'Done?', [], 'bo 2026-11-01T10:00Z'),
]);

const notes = (editor: Editor) => [...editor.view.dom.querySelectorAll<HTMLElement>('.rl-note')];
const top = (note: HTMLElement) => parseFloat(note.style.top);
const labels = (note: HTMLElement) =>
  [...note.querySelectorAll<HTMLElement>('.rl-note-actions button')].map((el) =>
    el.getAttribute('aria-label'),
  );
const undo = (editor: Editor) => {
  const mac = /Mac/.test(navigator.platform);
  press(editor.view.contentDOM, 'z', { ctrlKey: !mac, metaKey: mac });
};

describe('notesIn', () => {
  it('leaves out resolved threads unless asked', () => {
    const parsed = parse(mixed);
    expect(notesIn(parsed, []).map(({ id }) => id)).toEqual(['c3fm']);
    expect(notesIn(parsed, [], true).map(({ id }) => id)).toEqual(['c2dk', 'c3fm']);
  });
});

describe('stack with settled notes', () => {
  it('places open notes as if the settled ones were not there, and settled ones around them', () => {
    // A settled note first, at the same place as an open one.
    expect(stack([0, 0, 100], [50, 50, 50], 8, [true, false, false])).toEqual([158, 0, 100]);
    // A settled note that fits above stays where it is.
    expect(stack([0, 100], [50, 50], 8, [true, false])).toEqual([0, 100]);
    // Settled notes among themselves stack as usual.
    expect(stack([0, 0], [50, 50], 8, [true, true])).toEqual([0, 58]);
    // Nothing settled is the plain stack.
    expect(stack([0, 0], [50, 50], 8)).toEqual([0, 58]);
  });
});

describe('showing resolved comments', () => {
  it('hides them by default, and shows them when asked', () => {
    const { editor, review } = mount(mixed);
    expect(review.showsResolved()).toBe(false);
    expect(notes(editor)).toHaveLength(1);
    review.setShowResolved(true);
    expect(review.showsResolved()).toBe(true);
    expect(notes(editor)).toHaveLength(2);
    review.setShowResolved(false);
    expect(notes(editor)).toHaveLength(1);
  });

  it('can start shown', () => {
    const { editor, review } = mount(mixed, { review: { showResolved: true } });
    expect(review.showsResolved()).toBe(true);
    expect(notes(editor)).toHaveLength(2);
  });

  it('keeps the choice when another document opens', () => {
    const { editor, review } = mount(mixed);
    review.setShowResolved(true);
    editor.setDoc(mixed);
    expect(notes(editor)).toHaveLength(2);
  });

  it('draws a resolved note settled, with who resolved it', () => {
    const { editor, review } = mount(mixed);
    review.setShowResolved(true);
    const [resolved, open] = notes(editor);
    expect(resolved!.classList.contains('rl-note-resolved')).toBe(true);
    expect(open!.classList.contains('rl-note-resolved')).toBe(false);
    const line = resolved!.querySelector('.rl-note-resolved-line')!;
    expect(line.textContent).toContain('Resolved by Bo Chen');
    expect(open!.querySelector('.rl-note-resolved-line')).toBeNull();
    expect(resolved!.querySelector('.rl-note-text')?.textContent).toBe('Which importer?');
  });

  it('offers Reply and Reopen on a resolved note, in place of Resolve', () => {
    const { editor, review } = mount(mixed);
    review.setShowResolved(true);
    const [resolved, open] = notes(editor);
    expect(labels(resolved!)).toEqual(['Reply', 'Reopen']);
    expect(labels(open!)).toEqual(['Reply', 'Resolve']);
    const reopen = button(resolved!, 'Reopen');
    expect(reopen.querySelector('svg')).not.toBeNull();
    expect(reopen.querySelector('.rl-hint')?.textContent).toBe('Reopen');
  });

  it('reopens a thread from its note, as one undo step', () => {
    const { editor, review } = mount(mixed);
    review.setShowResolved(true);
    button(notes(editor)[0]!, 'Reopen').click();
    const found = () => editor.getParsed().ledger.comments.find(({ id }) => id === 'c2dk');
    expect(found()?.resolved).toBeUndefined();
    const [now] = notes(editor);
    expect(now!.classList.contains('rl-note-resolved')).toBe(false);
    expect(now!.querySelector('.rl-note-resolved-line')).toBeNull();
    expect(labels(now!)).toEqual(['Reply', 'Resolve']);
    undo(editor);
    expect(found()?.resolved?.by).toBe('bo');
    expect(notes(editor)[0]!.classList.contains('rl-note-resolved')).toBe(true);
  });

  it('shows a note as open after a reply reopens it', () => {
    const { editor, review } = mount(mixed);
    review.setShowResolved(true);
    const [resolved] = notes(editor);
    button(resolved!, 'Reply').click();
    const box = resolved!.querySelector('textarea')!;
    box.value = 'Back again.';
    box.dispatchEvent(new Event('input', { bubbles: true }));
    press(box, 'Enter', { metaKey: true });
    expect(notes(editor)[0]!.classList.contains('rl-note-resolved')).toBe(false);
    expect(labels(notes(editor)[0]!)).toEqual(['Reply', 'Resolve']);
  });

  it('shows a note just resolved as settled when resolved comments are shown', () => {
    const { editor, review } = mount(mixed);
    review.setShowResolved(true);
    button(notes(editor)[1]!, 'Resolve').click();
    expect(notes(editor)).toHaveLength(2);
    expect(notes(editor)[1]!.classList.contains('rl-note-resolved')).toBe(true);
    expect(labels(notes(editor)[1]!)).toEqual(['Reply', 'Reopen']);
  });

  it('changes nothing when a note is resolved while they are hidden', () => {
    const { editor } = mount(mixed);
    button(notes(editor)[0]!, 'Resolve').click();
    expect(notes(editor)).toHaveLength(0);
  });

  it('names a resolved note in its dot', () => {
    const { editor, review } = mount(mixed);
    review.setShowResolved(true);
    const dots = [...editor.view.dom.querySelectorAll('.rl-note-dot')];
    expect(dots[0]?.getAttribute('aria-label')).toBe('Resolved note by Ada Lovelace');
    expect(dots[1]?.getAttribute('aria-label')).toBe('Note by Ada Lovelace');
  });

  it('gives way to open notes that compete for the same place', async () => {
    const restore = stubHeights({ 'rl-note': 60 });
    try {
      const { editor, review } = mount(mixed);
      await frame();
      const alone = top(notes(editor)[0]!);
      review.setShowResolved(true);
      await frame();
      const [resolved, open] = notes(editor);
      // The open note is where it was without the resolved one; the resolved one clears it.
      expect(top(open!)).toBe(alone);
      expect(top(resolved!)).toBeGreaterThanOrEqual(top(open!) + 60 + 8);
    } finally {
      restore();
    }
  });

  it('tints a selected resolved anchor lighter than an open one', () => {
    const { editor, review } = mount(mixed);
    review.setShowResolved(true);
    editor.view.dispatch({ selection: { anchor: editor.getDoc().indexOf('importer') + 2 } });
    const anchor = editor.view.dom.querySelector('.rl-anchor');
    expect(anchor?.classList.contains('rl-anchor-resolved')).toBe(true);
  });

  it('moves the text column for the rail as resolved comments show, and back as they hide', async () => {
    const { editor, review } = mount(onlyResolved);
    await frame();
    const column = () => editor.view.dom.classList.contains('rl-has-rail');
    expect(column()).toBe(false);
    review.setShowResolved(true);
    expect(column()).toBe(true);
    review.setShowResolved(false);
    expect(column()).toBe(false);
  });

  it('keeps a resolved note whose reply has text while they are hidden, until it is cleared', () => {
    const { editor, review } = mount(mixed);
    review.setShowResolved(true);
    const [resolved] = notes(editor);
    button(resolved!, 'Reply').click();
    const box = resolved!.querySelector('textarea')!;
    box.value = 'Half a thought';
    box.dispatchEvent(new Event('input', { bubbles: true }));
    review.setShowResolved(false);
    expect(notes(editor)).toHaveLength(2);
    expect(review.hasDraft()).toBe(true);
    // Cleared, it goes with the others.
    box.value = '';
    box.dispatchEvent(new Event('input', { bubbles: true }));
    expect(notes(editor)).toHaveLength(1);
  });

  it('lets a resolved note with a draft go once the reply is posted and reopens it', () => {
    const { editor, review } = mount(mixed);
    review.setShowResolved(true);
    const [resolved] = notes(editor);
    button(resolved!, 'Reply').click();
    const box = resolved!.querySelector('textarea')!;
    box.value = 'Back.';
    box.dispatchEvent(new Event('input', { bubbles: true }));
    review.setShowResolved(false);
    press(box, 'Enter', { metaKey: true });
    // Open now, so it shows whatever the toggle says.
    expect(notes(editor)).toHaveLength(2);
    expect(notes(editor)[0]!.classList.contains('rl-note-resolved')).toBe(false);
  });

  it('prefers an open note over a resolved one when both anchors hold the caret', () => {
    const nested = file('<!--cmt c2dk-->Some <!--cmt c3fm-->nested<!--/c3fm--> text<!--/c2dk-->.', [
      ...PEOPLE,
      'comments:',
      ...thread('c2dk', 'ada', 'Outer, open.'),
      ...thread('c3fm', 'ada', 'Inner, resolved.', [], 'bo 2026-11-01T10:00Z'),
    ]);
    const { editor, review } = mount(nested);
    review.setShowResolved(true);
    editor.view.dispatch({ selection: { anchor: editor.getDoc().indexOf('nested') + 2 } });
    const selected = notes(editor).filter((note) => note.classList.contains('rl-note-selected'));
    expect(selected).toHaveLength(1);
    expect(selected[0]!.classList.contains('rl-note-resolved')).toBe(false);
  });
});
