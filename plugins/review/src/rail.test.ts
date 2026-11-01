// @vitest-environment happy-dom
import type { Editor } from '@redlines/editor';
import { afterEach, describe, expect, it } from 'vitest';
import { stack } from './rail.ts';
import {
  button,
  file,
  frame,
  me,
  mount,
  PEOPLE,
  press,
  stubHeight,
  thread,
  unmountAll,
} from './test-helpers.ts';

afterEach(unmountAll);

/** Two threads on one line, the first with a reply. */
const threads = file(
  'The <!--cmt c2dk-->importer<!--/c2dk--> ships in <!--cmt c3fm-->April<!--/c3fm-->.\n\nMore text.',
  [
    ...PEOPLE,
    'comments:',
    ...thread('c2dk', 'bo', 'Which importer?', [
      { id: 'r5tw', by: 'claude-ada', text: 'The new one.' },
    ]),
    ...thread('c3fm', 'ada', 'Or May?'),
  ],
);

/** A change with its author's reason, and one without. */
const reasons = file(
  'The exporter <!--sub p7qd stays-->goes<!--/p7qd--> <!--ins k3x9-->now<!--/k3x9-->.',
  [
    ...PEOPLE,
    'marks:',
    '  p7qd: {by: claude-ada, at: 2026-10-31T09:31Z, note: Matches the roadmap}',
    '  k3x9: {by: ada, at: 2026-10-31T09:30Z}',
  ],
);

const notes = (editor: Editor) => [...editor.view.dom.querySelectorAll<HTMLElement>('.rl-note')];
const top = (note: HTMLElement) => parseFloat(note.style.top);
const texts = (note: HTMLElement) =>
  [...note.querySelectorAll('.rl-note-text')].map((text) => text.textContent);

describe('margin notes', () => {
  it('one note per thread in Redlines', () => {
    const { editor } = mount(threads);
    expect(editor.getUiState().view).toBe('redlines');
    const shown = notes(editor);
    expect(shown).toHaveLength(2);
    // The thread's replies are in its note.
    expect(texts(shown[0]!)).toEqual(['Which importer?', 'The new one.']);
    expect(texts(shown[1]!)).toEqual(['Or May?']);
    expect(shown[0]!.querySelector('.rl-note-name')?.textContent).toBe('Bo Chen');
    // The column moves left to make room.
    expect(editor.view.dom.classList).toContain('rl-has-rail');
  });

  it('no notes in Clean', () => {
    const { editor } = mount(threads);
    editor.setViewMode('clean');
    expect(notes(editor)).toHaveLength(0);
    expect(editor.view.dom.classList).not.toContain('rl-has-rail');
    editor.setViewMode('raw');
    expect(notes(editor)).toHaveLength(0);
    editor.setViewMode('redlines');
    expect(notes(editor)).toHaveLength(2);
  });

  it("notes don't overlap", async () => {
    const restore = stubHeight('rl-note', 60);
    try {
      const { editor } = mount(threads);
      await frame();
      const [first, second] = notes(editor);
      expect(top(first!)).not.toBeNaN();
      expect(top(second!)).toBeGreaterThanOrEqual(top(first!) + first!.offsetHeight + 8);
    } finally {
      restore();
    }
  });

  it('selecting a note outlines it in the author color', () => {
    const { editor } = mount(threads);
    const [first, second] = notes(editor);
    first!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    // Bo is the first person after you, so Bo's color is the second.
    expect(first!.classList).toContain('rl-note-selected');
    expect(first!.classList).toContain('rl-author-2');
    expect(second!.classList).not.toContain('rl-note-selected');
    // Its anchor is tinted more strongly.
    const anchor = editor.view.contentDOM.querySelector('.rl-anchor');
    expect(anchor?.textContent).toBe('importer');
    expect(anchor?.classList).toContain('rl-author-2');

    // Putting the cursor in the other anchor selects the other note.
    const april = editor.view.state.doc.toString().indexOf('April') + 2;
    editor.view.dispatch({ selection: { anchor: april } });
    expect(first!.classList).not.toContain('rl-note-selected');
    expect(second!.classList).toContain('rl-note-selected');
    expect(editor.view.contentDOM.querySelector('.rl-anchor')?.textContent).toBe('April');
  });

  it('posting a reply adds it to the ledger', () => {
    const { editor } = mount(threads);
    const [first] = notes(editor);
    button(first!, 'Reply').click();
    const box = first!.querySelector('textarea')!;
    box.value = 'Thanks, Bo.';
    box.dispatchEvent(new Event('input', { bubbles: true }));
    press(box, 'Enter', { metaKey: true });

    const posted = editor.getParsed().ledger.comments.find(({ id }) => id === 'c2dk');
    expect(posted?.replies).toHaveLength(2);
    expect(posted?.replies[1]).toMatchObject({ by: me.handle, text: 'Thanks, Bo.' });
    expect(posted?.replies[1]?.at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\dZ$/);
    expect(editor.getParsed().ledger.people.find(({ handle }) => handle === me.handle)).toEqual(me);
    // The reply shows in the note, and the box is closed and empty.
    expect(texts(notes(editor)[0]!)).toEqual(['Which importer?', 'The new one.', 'Thanks, Bo.']);
    expect(box.value).toBe('');
    expect(box.closest<HTMLElement>('.rl-note-reply')?.hidden).toBe(true);
  });

  it('an empty reply is not posted', () => {
    const { editor } = mount(threads);
    const before = editor.getDoc();
    const [first] = notes(editor);
    button(first!, 'Reply').click();
    press(first!.querySelector('textarea')!, 'Enter', { metaKey: true });
    expect(editor.getDoc()).toBe(before);
  });

  it('resolving a thread takes its note away', () => {
    const { editor } = mount(threads);
    button(notes(editor)[1]!, 'Resolve').click();
    const resolved = editor.getParsed().ledger.comments.find(({ id }) => id === 'c3fm');
    expect(resolved?.resolved?.by).toBe(me.handle);
    expect(notes(editor)).toHaveLength(1);
  });

  it("a change with its author's note has a note, with Accept and Reject", () => {
    const { editor, decided } = mount(reasons);
    const shown = notes(editor);
    expect(shown).toHaveLength(1);
    const [note] = shown;
    expect(note!.querySelector('.rl-note-name')?.textContent).toBe('Claude');
    expect(note!.querySelector('.rl-note-for')?.textContent).toBe('for Ada Lovelace');
    expect(texts(note!)).toEqual(['Matches the roadmap']);
    button(note!, 'Accept').click();
    expect(decided).toEqual([{ id: 'p7qd', how: 'accept' }]);
    expect(notes(editor)).toHaveLength(0);
  });

  it('notes come back after another document is opened', async () => {
    const { editor } = mount(threads);
    editor.setDoc(reasons);
    await Promise.resolve();
    expect(notes(editor)).toHaveLength(1);
    expect(editor.view.dom.classList).toContain('rl-has-rail');
  });

  it('stack pushes each note below the one above it', () => {
    expect(stack([0, 0, 200], [50, 40, 10], 8)).toEqual([0, 58, 200]);
    expect(stack([10, 30], [100, 20], 8)).toEqual([10, 118]);
  });
});
