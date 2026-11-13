// @vitest-environment happy-dom
import type { Editor } from '@redlines/editor';
import { accept, applyChanges, reject } from '@redlines/format';
import { afterEach, describe, expect, it } from 'vitest';
import { decideSuggestion } from './shared.ts';
import { button, file, me, mount, PEOPLE, press, REFUSAL, unmountAll } from './test-helpers.ts';

afterEach(unmountAll);

const AT = 'at: 2026-10-31T09:31Z';

/** One suggestion of three marks: group g2rs, the note "Tense". */
const BODY =
  'We <!--ins k3x9-->will <!--/k3x9-->ship the importer in <!--sub p7qd March-->April<!--/p7qd--> ' +
  '<!--ins w2rf-->now<!--/w2rf-->.';
const suggestion = file(BODY, [
  ...PEOPLE,
  'marks:',
  `  k3x9: {by: claude-ada, ${AT}, group: g2rs, note: Tense}`,
  `  p7qd: {by: claude-ada, ${AT}, group: g2rs, note: Tense}`,
  `  w2rf: {by: claude-ada, ${AT}, group: g2rs, note: Tense}`,
]);

/** The same run, and a second suggestion in it with another note. */
const two = file(`${BODY} It <!--ins m4np-->is<!--/m4np--> late <!--ins q5rs-->!<!--/q5rs-->`, [
  ...PEOPLE,
  'marks:',
  `  k3x9: {by: claude-ada, ${AT}, group: g2rs, note: Tense}`,
  `  p7qd: {by: claude-ada, ${AT}, group: g2rs, note: Tense}`,
  `  w2rf: {by: claude-ada, ${AT}, group: g2rs, note: Tense}`,
  `  m4np: {by: claude-ada, ${AT}, group: g2rs, note: Mood}`,
  `  q5rs: {by: claude-ada, ${AT}, group: g2rs, note: Mood}`,
]);

const notes = (editor: Editor) => [...editor.view.dom.querySelectorAll<HTMLElement>('.rl-note')];
const bar = (editor: Editor) => editor.view.dom.querySelector<HTMLElement>('.rl-review-bar');
const count = (editor: Editor) => bar(editor)?.querySelector('.rl-bar-count')?.textContent;

/** By hand: each mark decided on its own, last first. */
function byHand(doc: string, ids: string[], how: typeof accept): string {
  let text = doc;
  for (const id of [...ids].reverse()) text = applyChanges(text, how(text, id));
  return text;
}

const undo = (editor: Editor) => {
  const mac = /Mac/.test(navigator.platform);
  press(editor.view.contentDOM, 'z', { ctrlKey: !mac, metaKey: mac });
};

describe('decideSuggestion', () => {
  it('decides the whole suggestion in Redlines', () => {
    const { editor, decided } = mount(suggestion);
    decideSuggestion({ editor, author: me }, 'accept', 'p7qd');
    expect(decided.map(({ id }) => id)).toEqual(['k3x9', 'p7qd', 'w2rf']);
  });

  it.each(['accept', 'reject'] as const)(
    'decides the whole suggestion in the simple look too, and leaves it as it is: %s',
    (how) => {
      const { editor, decided } = mount(suggestion);
      editor.setViewMode('simple');
      const selection = editor.view.state.selection;
      decideSuggestion({ editor, author: me }, how, 'p7qd');
      expect(decided).toEqual(['k3x9', 'p7qd', 'w2rf'].map((id) => ({ id, how })));
      expect(editor.getUiState()).toMatchObject({ view: 'simple', markupView: 'simple' });
      expect(editor.view.state.selection.eq(selection)).toBe(true);
    },
  );

  it('is one step to undo in the simple look, and the view stays', () => {
    const { editor } = mount(suggestion, { real: true });
    editor.setViewMode('simple');
    const before = editor.getDoc();
    decideSuggestion({ editor, author: me }, 'accept', 'p7qd');
    expect(editor.getDoc()).toBe(byHand(before, ['k3x9', 'p7qd', 'w2rf'], accept));
    expect(editor.getUiState().view).toBe('simple');
    undo(editor);
    expect(editor.getDoc()).toBe(before);
    expect(editor.getUiState().view).toBe('simple');
  });
});

describe('a suggestion of several marks', () => {
  it('shows one card for a suggestion of several marks, with its note once', () => {
    const { editor } = mount(suggestion);
    expect(editor.getUiState().changes).toHaveLength(3);
    const [note, ...others] = notes(editor);
    expect(others).toEqual([]);
    expect(note!.querySelectorAll('.rl-note-name')).toHaveLength(1);
    expect(note!.querySelectorAll('.rl-note-text')).toHaveLength(1);
    expect(note!.querySelector('.rl-note-text')?.textContent).toBe('Tense');
    // The changes, in order, in one line.
    expect(note!.querySelector('.rl-note-change')?.textContent).toBe('will · March → April · now');
  });

  it('keeps two suggestions of one run apart when their notes differ', () => {
    const { editor } = mount(two);
    const shown = notes(editor);
    expect(shown).toHaveLength(2);
    expect(shown.map((note) => note.querySelector('.rl-note-text')?.textContent)).toEqual([
      'Tense',
      'Mood',
    ]);
  });

  it('selecting any of its marks selects the whole suggestion', () => {
    const { editor } = mount(suggestion);
    const doc = editor.getDoc();
    editor.view.dispatch({ selection: { anchor: doc.indexOf('now') + 1 } });
    expect(notes(editor)[0]!.classList).toContain('rl-note-selected');
    const anchors = editor.view.dom.querySelectorAll('.rl-anchor');
    expect(anchors.length).toBeGreaterThanOrEqual(3);
  });

  it('accepts every mark of a suggestion from its card, in one undo step', () => {
    const { editor } = mount(suggestion, { real: true });
    const before = editor.getDoc();
    button(notes(editor)[0]!, 'Accept').click();
    expect(editor.getDoc()).toBe(byHand(before, ['k3x9', 'p7qd', 'w2rf'], accept));
    expect(editor.getUiState().changes).toHaveLength(0);
    undo(editor);
    expect(editor.getDoc()).toBe(before);
  });

  it('rejects every mark of a suggestion from its card, in one undo step', () => {
    const { editor } = mount(suggestion, { real: true });
    const before = editor.getDoc();
    button(notes(editor)[0]!, 'Reject').click();
    expect(editor.getDoc()).toBe(byHand(before, ['k3x9', 'p7qd', 'w2rf'], reject));
    expect(editor.getDoc()).toContain('in March');
    undo(editor);
    expect(editor.getDoc()).toBe(before);
  });

  it('decides only its own suggestion when the run has more', () => {
    const { editor } = mount(two, { real: true });
    button(notes(editor)[1]!, 'Accept').click();
    expect(editor.getDoc()).toContain('It is late !');
    expect(editor.getUiState().changes).toHaveLength(3);
    expect(notes(editor)).toHaveLength(1);
  });

  it('decides nothing when one mark of the suggestion cannot be decided', () => {
    // Bold that the text has lost can only be accepted, so a rejection stops at it.
    const doc = file(
      'A <!--ins k3x9-->new<!--/k3x9--> <!--fmt m2bd +bold-->big<!--/m2bd--> plan.',
      [
        ...PEOPLE,
        'marks:',
        `  k3x9: {by: bo, ${AT}, group: g2rs, note: Both}`,
        `  m2bd: {by: bo, ${AT}, group: g2rs, note: Both}`,
      ],
    );
    const { editor, review } = mount(doc, { real: true });
    const before = editor.getDoc();
    // The card offers no Reject, as for a lone format change of this kind; accepting is fine.
    expect(() => button(notes(editor)[0]!, 'Reject')).toThrow('No button');
    // The bar offers it, and the refusal writes nothing.
    review.next();
    button(bar(editor)!, 'Reject').click();
    expect(editor.getDoc()).toBe(before);
    expect(bar(editor)!.querySelector('.rl-bar-error')?.textContent).not.toBe('');
  });

  it('writes nothing when the editor refuses', () => {
    const { editor } = mount(suggestion, { refuse: true });
    const before = editor.getDoc();
    const note = notes(editor)[0]!;
    button(note, 'Accept').click();
    expect(editor.getDoc()).toBe(before);
    expect(note.querySelector('.rl-note-error')?.textContent).toBe(REFUSAL);
  });

  it('steps the review bar by suggestion and counts suggestions', () => {
    const { editor, review } = mount(two, { real: true });
    review.openBar();
    expect(count(editor)).toBe('2 changes');
    review.next();
    expect(count(editor)).toBe('Change 1 of 2');
    // The whole suggestion is selected: from its first mark to its last.
    const { from, to } = editor.view.state.selection.main;
    const chosen = editor.view.state.sliceDoc(from, to);
    expect(chosen.startsWith('<!--ins k3x9-->')).toBe(true);
    expect(chosen.endsWith('now<!--/w2rf-->')).toBe(true);
    review.next();
    expect(count(editor)).toBe('Change 2 of 2');
    review.next();
    expect(count(editor)).toBe('Change 1 of 2');
    review.previous();
    expect(count(editor)).toBe('Change 2 of 2');
    // Accept decides the whole suggestion, and moves on to the other.
    button(bar(editor)!, 'Accept').click();
    expect(editor.getDoc()).toContain('It is late !');
    expect(count(editor)).toBe('Change 1 of 1');
    expect(editor.getUiState().changes).toHaveLength(3);
  });

  it('decides a suggestion with no note from the bar, all its marks', () => {
    const doc = file('A <!--ins k3x9-->b<!--/k3x9--> c <!--ins w2rf-->d<!--/w2rf-->.', [
      ...PEOPLE,
      'marks:',
      `  k3x9: {by: bo, ${AT}, group: g2rs}`,
      `  w2rf: {by: bo, ${AT}, group: g2rs}`,
    ]);
    const { editor, review, decided } = mount(doc);
    review.next();
    expect(count(editor)).toBe('Change 1 of 1');
    button(bar(editor)!, 'Accept').click();
    expect(decided.map(({ id }) => id)).toEqual(['k3x9', 'w2rf']);
  });
});
