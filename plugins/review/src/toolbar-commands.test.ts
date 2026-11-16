// @vitest-environment happy-dom
// The commands the toolbar's Review menu runs (#504): Accept and Reject for the change at the
// selection, and Review Changes. They are in the registry, with the reason they can't be used.
import type { Editor } from '@redlines/editor';
import { afterEach, describe, expect, it } from 'vitest';
import { file, mount, PEOPLE, REFUSAL, unmountAll } from './test-helpers.ts';

afterEach(unmountAll);

const AT = 'at: 2026-10-31T09:31Z';
const BODY = 'We will <!--ins k3x9-->ship<!--/k3x9--> it in April.';
const changed = file(BODY, [...PEOPLE, 'marks:', `  k3x9: {by: claude-ada, ${AT}}`]);

const reason = (editor: Editor, id: string) => {
  const command = editor.commands.list().find((each) => each.id === id);
  return command ? command.disabledReason?.(editor.view.state) : 'missing';
};

/** The caret at the first place where `text` starts. */
const caretIn = (editor: Editor, text: string) => {
  const at = editor.view.state.doc.toString().indexOf(text) + 1;
  editor.view.dispatch({ selection: { anchor: at } });
};

describe('Accept, Reject and Review Changes', () => {
  it('are commands of the registry', () => {
    const { editor } = mount(changed);
    const ids = editor.commands.list().map(({ id }) => id);
    expect(ids).toEqual(expect.arrayContaining(['change.accept', 'change.reject', 'review.start']));
  });

  it('are grayed away from a change, and say what to do', () => {
    const { editor } = mount(changed);
    editor.view.dispatch({ selection: { anchor: 0 } });
    expect(reason(editor, 'change.accept')).toMatch(/caret in a tracked change/);
    expect(reason(editor, 'change.reject')).toMatch(/caret in a tracked change/);
    // There are changes to review, though not here.
    expect(reason(editor, 'review.start')).toBeUndefined();
  });

  it('decide the change the caret is in, and are open there', () => {
    const { editor, decided } = mount(changed);
    caretIn(editor, 'ship');
    expect(reason(editor, 'change.accept')).toBeUndefined();
    expect(reason(editor, 'change.reject')).toBeUndefined();
    expect(editor.commands.run('change.accept')).toBe(true);
    expect(decided).toEqual([{ id: 'k3x9', how: 'accept' }]);
  });

  it('reject the change too', () => {
    const { editor, decided } = mount(changed);
    caretIn(editor, 'ship');
    expect(editor.commands.run('change.reject')).toBe(true);
    expect(decided).toEqual([{ id: 'k3x9', how: 'reject' }]);
  });

  it('say when the editor refuses, and change nothing', () => {
    const notes: string[] = [];
    const { editor, decided } = mount(changed, {
      refuse: true,
      review: { notice: (message) => notes.push(message) },
    });
    caretIn(editor, 'ship');
    expect(editor.commands.run('change.accept')).toBe(false);
    expect(notes).toEqual([REFUSAL]);
    expect(decided).toEqual([]);
  });

  it('start the review on the first change, and are grayed with none to review', () => {
    const { editor, review, opened } = mount(changed);
    expect(editor.commands.run('review.start')).toBe(true);
    expect(review.isBarOpen()).toBe(true);
    expect(opened.at(-1)).toBe(true);
    const plain = mount('Nothing to review here.');
    expect(reason(plain.editor, 'review.start')).toBe('There are no changes to review.');
    expect(reason(plain.editor, 'change.accept')).toBeDefined();
  });
});
