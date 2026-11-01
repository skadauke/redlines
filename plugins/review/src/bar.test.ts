// @vitest-environment happy-dom
import type { Editor } from '@redlines/editor';
import { afterEach, describe, expect, it } from 'vitest';
import {
  button,
  file,
  frame,
  mount,
  PEOPLE,
  press,
  REFUSAL,
  stubRect,
  thread,
  unmountAll,
} from './test-helpers.ts';

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

  it('moves through a change inside another, and decides the one it is on', () => {
    // Bo's deletion inside Ada's insertion (format §3.6), then a third change.
    const nested = file(
      'The <!--ins k3x9-->shiny <!--del b4rt very -->new <!--/k3x9-->importer ships <!--ins w8nn-->soon<!--/w8nn-->.',
      [
        ...PEOPLE,
        'marks:',
        '  k3x9: {by: ada, at: 2026-10-31T09:30Z}',
        '  b4rt: {by: bo, at: 2026-10-31T09:35Z}',
        '  w8nn: {by: bo, at: 2026-10-31T09:36Z}',
      ],
    );
    const { editor, review, decided } = mount(nested);
    review.next();
    expect(count(editor)).toBe('Change 1 of 3');
    review.next();
    expect(count(editor)).toBe('Change 2 of 3');
    expect(selected(editor)).toBe('<!--del b4rt very -->');
    review.next();
    expect(count(editor)).toBe('Change 3 of 3');
    expect(selected(editor)).toBe('<!--ins w8nn-->soon<!--/w8nn-->');
    review.previous();
    review.previous();
    expect(count(editor)).toBe('Change 1 of 3');
    review.next();
    button(bar(editor)!, 'Accept').click();
    expect(decided).toEqual([{ id: 'b4rt', how: 'accept' }]);
    expect(editor.getDoc()).toContain('<!--ins k3x9-->shiny new <!--/k3x9-->');
    // On to the change after it.
    expect(count(editor)).toBe('Change 2 of 2');
    expect(selected(editor)).toBe('<!--ins w8nn-->soon<!--/w8nn-->');
  });

  it('moves through interleaved changes, and decides the one it is on', () => {
    // Bo deletes a passage that holds Ada's pending deletion (format §3.6).
    const interleaved = file(
      'Ship <!--del b4rt the old --><!--del c2zf legacy --><!--del b4rt exporter -->now.',
      [
        ...PEOPLE,
        'marks:',
        '  b4rt: {by: bo, at: 2026-10-31T09:35Z}',
        '  c2zf: {by: ada, at: 2026-10-31T09:36Z}',
      ],
    );
    const { editor, review, decided } = mount(interleaved);
    review.next();
    expect(count(editor)).toBe('Change 1 of 2');
    review.next();
    expect(count(editor)).toBe('Change 2 of 2');
    expect(selected(editor)).toBe('<!--del c2zf legacy -->');
    button(bar(editor)!, 'Accept').click();
    expect(decided).toEqual([{ id: 'c2zf', how: 'accept' }]);
    expect(count(editor)).toBe('Change 1 of 1');
  });

  it('a cursor in a change inside another is on the inner one', () => {
    const nested = file('The <!--ins k3x9-->shiny <!--del b4rt very -->new <!--/k3x9-->importer.', [
      ...PEOPLE,
      'marks:',
      '  k3x9: {by: ada, at: 2026-10-31T09:30Z}',
      '  b4rt: {by: bo, at: 2026-10-31T09:35Z}',
    ]);
    const { editor, review } = mount(nested);
    review.openBar();
    const text = editor.view.state.doc.toString();
    editor.view.dispatch({ selection: { anchor: text.indexOf('very') } });
    expect(count(editor)).toBe('Change 2 of 2');
    editor.view.dispatch({ selection: { anchor: text.indexOf('shiny') + 2 } });
    expect(count(editor)).toBe('Change 1 of 2');
  });

  it('a refused decision changes nothing and says why', () => {
    const { editor, review } = mount(doc, { refuse: true });
    const before = editor.getDoc();
    review.next();
    button(bar(editor)!, 'Accept').click();
    expect(editor.getDoc()).toBe(before);
    expect(count(editor)).toBe('Change 1 of 3');
    expect(selected(editor)).toBe('<!--ins k3x9-->new<!--/k3x9-->');
    const error = bar(editor)?.querySelector<HTMLElement>('.rl-bar-error');
    expect(error?.hidden).toBe(false);
    expect(error?.textContent).toBe(REFUSAL);
  });

  it('goes by the editor’s list of changes', () => {
    const { editor, review } = mount(doc);
    const real = editor.getUiState.bind(editor);
    editor.getUiState = () => ({
      ...real(),
      changes: real().changes.filter(({ id }) => id !== 'w2rf'),
    });
    review.openBar();
    expect(count(editor)).toBe('2 changes');
    review.next();
    review.next();
    expect(selected(editor)).toBe('<!--sub p7qd March-->April<!--/p7qd-->');
  });

  it('floats 22px above the window’s bottom, over the text column, however long the document', async () => {
    const short = file('One <!--ins k3x9-->short<!--/k3x9--> paragraph.', [
      ...PEOPLE,
      'marks:',
      '  k3x9: {by: ada, at: 2026-10-31T09:30Z}',
    ]);
    for (const [text, documentBottom] of [
      [short, 300],
      [doc, 3000],
    ] as const) {
      const { editor, review } = mount(text);
      const { contentDOM, scrollDOM } = editor.view;
      // The page scrolls in the host's scroller. The editor's own scroller computes overflow
      // `auto` without scrolling, and ends where the document ends.
      scrollDOM.style.overflowY = 'auto';
      stubRect(scrollDOM, { left: 0, right: 1000, top: 52, bottom: documentBottom });
      stubRect(contentDOM, { left: 100, right: 900, top: 52, bottom: documentBottom });
      contentDOM.style.paddingLeft = '24px';
      contentDOM.style.paddingRight = '24px';
      review.openBar();
      await frame();
      expect(bar(editor)?.style.bottom).toBe('22px');
      expect(bar(editor)?.style.left).toBe('500px');
      unmountAll();
    }
  });
});
