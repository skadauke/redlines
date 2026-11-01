// @vitest-environment happy-dom
import type { Editor } from '@redlines/editor';
import { afterEach, describe, expect, it } from 'vitest';
import { button, file, mount, PEOPLE, press, thread, unmountAll } from './test-helpers.ts';

afterEach(unmountAll);

/** Three changes on three lines, and a comment, which the bar doesn't count. */
const doc = file(
  [
    'First <!--ins k3x9-->new<!--/k3x9--> line.',
    '',
    'Second <!--del w2rf  old-->line, with a <!--cmt c8d2-->comment<!--/c8d2-->.',
    '',
    'Third <!--sub p7qd March-->April<!--/p7qd--> line.',
  ].join('\n'),
  [
    ...PEOPLE,
    'marks:',
    '  k3x9: {by: ada, at: 2026-10-31T09:30Z}',
    '  w2rf: {by: bo, at: 2026-10-31T09:35Z}',
    '  p7qd: {by: claude-ada, at: 2026-10-31T09:31Z}',
    'comments:',
    ...thread('c8d2', 'bo', 'Is this right?'),
  ],
);

const bar = (editor: Editor) => editor.view.dom.querySelector<HTMLElement>('.rl-review-bar');
const count = (editor: Editor) => bar(editor)?.querySelector('.rl-bar-count')?.textContent;

/** The text the selection covers, markers included. */
function selected(editor: Editor): string {
  const { from, to } = editor.view.state.selection.main;
  return editor.view.state.sliceDoc(from, to);
}

describe('review bar', () => {
  it('opens hidden', () => {
    const { editor, review, opened } = mount(doc);
    expect(review.isBarOpen()).toBe(false);
    expect(bar(editor)).toBeNull();
    review.openBar();
    expect(review.isBarOpen()).toBe(true);
    expect(bar(editor)?.getAttribute('role')).toBe('toolbar');
    // No change is selected yet: the bar counts them.
    expect(count(editor)).toBe('3 changes');
    expect(count(editor)).toBe(`${editor.getUiState().changes.length} changes`);
    expect(opened).toEqual([true]);
  });

  it('next moves through changes in order', () => {
    const { editor, review } = mount(doc);
    review.next();
    expect(review.isBarOpen()).toBe(true);
    expect(count(editor)).toBe('Change 1 of 3');
    expect(selected(editor)).toBe('<!--ins k3x9-->new<!--/k3x9-->');
    review.next();
    expect(count(editor)).toBe('Change 2 of 3');
    expect(selected(editor)).toBe('<!--del w2rf  old-->');
    button(bar(editor)!, 'Next change').click();
    expect(count(editor)).toBe('Change 3 of 3');
    expect(selected(editor)).toBe('<!--sub p7qd March-->April<!--/p7qd-->');
    // Past the last change, the first.
    review.next();
    expect(count(editor)).toBe('Change 1 of 3');
  });

  it('previous moves back, from the last change', () => {
    const { editor, review } = mount(doc);
    review.previous();
    expect(count(editor)).toBe('Change 3 of 3');
    button(bar(editor)!, 'Previous change').click();
    expect(count(editor)).toBe('Change 2 of 3');
  });

  it('next starts from the cursor', () => {
    const { editor, review } = mount(doc);
    editor.view.dispatch({
      selection: { anchor: editor.view.state.doc.toString().indexOf('Second') },
    });
    review.next();
    expect(count(editor)).toBe('Change 2 of 3');
  });

  it('accept decides and moves on', () => {
    const { editor, review, decided } = mount(doc);
    review.next();
    button(bar(editor)!, 'Accept').click();
    expect(decided).toEqual([{ id: 'k3x9', how: 'accept' }]);
    expect(editor.getDoc()).toContain('First new line.');
    expect(count(editor)).toBe('Change 1 of 2');
    expect(selected(editor)).toBe('<!--del w2rf  old-->');
  });

  it('reject decides and moves on', () => {
    const { editor, review, decided } = mount(doc);
    review.next();
    review.next();
    button(bar(editor)!, 'Reject').click();
    expect(decided).toEqual([{ id: 'w2rf', how: 'reject' }]);
    expect(editor.getDoc()).toContain('Second  oldline');
    expect(count(editor)).toBe('Change 2 of 2');
    expect(selected(editor)).toBe('<!--sub p7qd March-->April<!--/p7qd-->');
  });

  it('decides nothing while no change is selected', () => {
    const { editor, review, decided } = mount(doc);
    review.openBar();
    expect(button(bar(editor)!, 'Accept').disabled).toBe(true);
    expect(button(bar(editor)!, 'Reject').disabled).toBe(true);
    button(bar(editor)!, 'Accept').click();
    expect(decided).toEqual([]);
  });

  it('Esc closes', () => {
    const { editor, review, opened } = mount(doc);
    review.openBar();
    press(editor.view.contentDOM, 'Escape');
    expect(review.isBarOpen()).toBe(false);
    expect(bar(editor)).toBeNull();
    // Also with the keyboard on the bar.
    review.next();
    press(button(bar(editor)!, 'Next change'), 'Escape');
    expect(review.isBarOpen()).toBe(false);
    expect(opened).toEqual([true, false, true, false]);
  });

  it('the close button closes', () => {
    const { editor, review } = mount(doc);
    review.openBar();
    button(bar(editor)!, 'Close').click();
    expect(review.isBarOpen()).toBe(false);
  });

  it('count updates after a decision', () => {
    const { editor, review } = mount(doc);
    review.openBar();
    expect(count(editor)).toBe('3 changes');
    editor.accept('p7qd');
    expect(count(editor)).toBe('2 changes');
    editor.reject('k3x9');
    editor.reject('w2rf');
    expect(count(editor)).toBe('No changes');
    expect(button(bar(editor)!, 'Next change').disabled).toBe(true);
  });

  it('opening the bar shows the changes', () => {
    const { editor, review } = mount(doc);
    editor.setViewMode('clean');
    review.openBar();
    expect(editor.getUiState().view).toBe('redlines');
  });

  it('a new document closes the bar', async () => {
    const { editor, review, opened } = mount(doc);
    review.openBar();
    editor.setDoc(doc);
    await Promise.resolve();
    expect(review.isBarOpen()).toBe(false);
    expect(bar(editor)).toBeNull();
    expect(opened).toEqual([true, false]);
    review.next();
    expect(count(editor)).toBe('Change 1 of 3');
  });
});
