// @vitest-environment happy-dom
import { barClickHandlers, type Editor } from '@redlines/editor';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { barNarrow } from './bar.ts';
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

  it('opening the bar from Simple switches to Redlines, and leaves the markup view', () => {
    const { editor, review } = mount(doc);
    editor.setViewMode('simple');
    review.openBar();
    expect(editor.getUiState()).toMatchObject({ view: 'redlines', markupView: 'simple' });
  });

  it('stays open, on the full markup, when Redlines is chosen from Clean with the bar open', () => {
    // The look chosen is the simple one; the bar showed the full markup, which is what comes back.
    const { editor, review } = mount(doc, { markupView: 'simple' });
    review.openBar();
    editor.showView('clean');
    expect(review.isBarOpen()).toBe(true);
    editor.showView('redlines');
    expect(review.isBarOpen()).toBe(true);
    expect(editor.getUiState()).toMatchObject({ view: 'redlines', markupView: 'simple' });
  });

  it('closes the bar when Simple is chosen, and the view stays as chosen', () => {
    const { editor, review, opened } = mount(doc);
    review.openBar();
    expect(editor.getUiState().view).toBe('redlines');
    editor.setViewMode('simple');
    expect(review.isBarOpen()).toBe(false);
    expect(bar(editor)).toBeNull();
    expect(opened).toEqual([true, false]);
    expect(editor.getUiState().view).toBe('simple');
    // Clean doesn't close it: only the choice to read does.
    review.openBar();
    editor.setViewMode('clean');
    expect(review.isBarOpen()).toBe(true);
  });

  it('opens the card of the change instead of switching, when a bar is clicked with the bar open', () => {
    const { editor, review } = mount(doc);
    const handle = (pos: number) =>
      editor.view.state.facet(barClickHandlers).some((handler) => handler(editor.view, pos));
    // Closed: the core's switch is left to do its work.
    expect(handle(0)).toBe(false);
    review.openBar();
    expect(handle(0)).toBe(true);
    expect(editor.view.dom.querySelector('.rl-card-what')?.textContent).toBe('Inserted “new”');
    expect(editor.getUiState().view).toBe('redlines');
    // A line with no change: nothing opens, and nothing switches.
    expect(handle(doc.indexOf('Second') - 1 + 1)).toBe(true);
    expect(editor.getUiState().view).toBe('redlines');
  });

  it('pins the card of the clicked line, not of a change that ends the line above', () => {
    const body = file(
      'First <!--ins k3x9-->new<!--/k3x9-->\n\nSecond <!--ins w2rf-->other<!--/w2rf-->.',
      [
        ...PEOPLE,
        'marks:',
        '  k3x9: {by: ada, at: 2026-10-31T09:30Z}',
        '  w2rf: {by: bo, at: 2026-10-31T09:35Z}',
      ],
    );
    const { editor, review } = mount(body);
    review.openBar();
    const handle = (pos: number) =>
      editor.view.state.facet(barClickHandlers).some((handler) => handler(editor.view, pos));
    expect(handle(body.indexOf('Second'))).toBe(true);
    expect(editor.view.dom.querySelector('.rl-card-what')?.textContent).toBe('Inserted “other”');
  });

  it('pins the card of a struck block’s change by its id, with the bar open', () => {
    const body = file(
      'First.\n\n<!--del w2rf Gone.\\n\\n-->\n\nSecond <!--ins k3x9-->new<!--/k3x9-->.',
      [
        ...PEOPLE,
        'marks:',
        '  k3x9: {by: ada, at: 2026-10-31T09:30Z}',
        '  w2rf: {by: bo, at: 2026-10-31T09:35Z}',
      ],
    );
    const { editor, review } = mount(body);
    review.openBar();
    const handle = (pos: number, mark?: string) =>
      editor.view.state.facet(barClickHandlers).some((handler) => handler(editor.view, pos, mark));
    // Whatever place the widget reports: the bar is the deletion's own.
    expect(handle(body.indexOf('Second'), 'w2rf')).toBe(true);
    expect(editor.view.dom.querySelector('.rl-card-what')?.textContent).toBe('Deleted “Gone.”');
    expect(editor.getUiState().view).toBe('redlines');
  });

  it('a new document closes the bar', () => {
    const { editor, review, opened } = mount(doc);
    review.openBar();
    editor.setDoc(doc);
    // At once: the review interface stays with the editor.
    expect(review.isBarOpen()).toBe(false);
    expect(bar(editor)).toBeNull();
    expect(opened).toEqual([true, false]);
    review.next();
    expect(count(editor)).toBe('Change 1 of 3');
  });

  it('works the same after documents are opened again and again', () => {
    const { editor, review, opened } = mount(doc);
    for (let i = 0; i < 3; i++) {
      review.next();
      editor.setDoc(doc);
    }
    expect(opened).toEqual([true, false, true, false, true, false]);
    expect(editor.view.dom.querySelectorAll('.rl-rail')).toHaveLength(1);
    review.next();
    review.next();
    expect(editor.view.dom.querySelectorAll('.rl-review-bar')).toHaveLength(1);
    expect(count(editor)).toBe('Change 2 of 3');
    button(bar(editor)!, 'Accept').click();
    expect(count(editor)).toBe('Change 2 of 2');
  });

  it('Esc does nothing while the bar is closed', () => {
    const { editor, review, opened } = mount(doc);
    const before = editor.getDoc();
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    editor.view.contentDOM.dispatchEvent(event);
    expect(review.isBarOpen()).toBe(false);
    expect(bar(editor)).toBeNull();
    expect(opened).toEqual([]);
    expect(editor.getDoc()).toBe(before);
    // The key is left to others, such as the host.
    expect(event.defaultPrevented).toBe(false);
  });

  it('is taken out of the editor by destroy, and stays out', () => {
    const { editor, review, opened } = mount(doc);
    review.openBar();
    review.destroy();
    expect(opened).toEqual([true, false]);
    expect(bar(editor)).toBeNull();
    editor.setDoc(doc);
    expect(editor.view.dom.querySelector('.rl-rail')).toBeNull();
    expect(editor.view.dom.classList).not.toContain('rl-has-rail');
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

  it('visits format changes, a box’s included', () => {
    const formatted = file(
      'A <!--fmt m2bd +bold-->**big**<!--/m2bd--> plan.\n\n- [x] Done<!--fmt n8fx +check-->',
      [
        ...PEOPLE,
        'marks:',
        '  m2bd: {by: bo, at: 2026-10-31T09:30Z}',
        '  n8fx: {by: bo, at: 2026-10-31T09:31Z}',
      ],
    );
    const { editor, review } = mount(formatted);
    expect(editor.getUiState().hasRedlines).toBe(true);
    review.next();
    expect(count(editor)).toBe('Change 1 of 2');
    expect(selected(editor)).toBe('<!--fmt m2bd +bold-->**big**<!--/m2bd-->');
    review.next();
    expect(count(editor)).toBe('Change 2 of 2');
    button(bar(editor)!, 'Accept').click();
    expect(editor.getDoc()).toContain('- [x] Done\n');
    expect(editor.getDoc()).not.toContain('n8fx');
  });

  it('leaves out the halves of a move, which v0.1 can’t decide', () => {
    const moved = file(
      'Ship <!--ins k3x9-->it <!--/k3x9-->now.<!--del m4vf  Old text.-->\n\nLater: <!--ins n5vt-->Old text.<!--/n5vt-->',
      [
        ...PEOPLE,
        'marks:',
        '  k3x9: {by: ada, at: 2026-10-31T09:30Z}',
        '  m4vf: {by: bo, at: 2026-10-31T09:31Z, move: n5vt}',
        '  n5vt: {by: bo, at: 2026-10-31T09:31Z, move: m4vf}',
      ],
    );
    const { editor, review } = mount(moved);
    review.openBar();
    expect(count(editor)).toBe('1 change');
    review.next();
    expect(count(editor)).toBe('Change 1 of 1');
    review.next();
    expect(selected(editor)).toBe('<!--ins k3x9-->it <!--/k3x9-->');
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

  it('centers under the text column and the notes beside it', async () => {
    const { editor, review } = mount(doc);
    const { contentDOM, scrollDOM } = editor.view;
    scrollDOM.style.overflowY = 'auto';
    stubRect(scrollDOM, { left: 0, right: 1280, top: 52, bottom: 3000 });
    // The column's box holds the column and, in its right padding, the rail.
    stubRect(contentDOM, { left: 130, right: 1150, top: 52, bottom: 3000 });
    contentDOM.style.paddingLeft = '24px';
    contentDOM.style.paddingRight = '316px';
    review.openBar();
    await frame();
    expect(bar(editor)?.style.left).toBe('640px');
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

describe('the review bar in a narrow window', () => {
  it('is narrow when it does not fit the window less 16 px on each side', () => {
    expect(barNarrow(420, 452)).toBe(false);
    expect(barNarrow(421, 452)).toBe(true);
  });

  it("shows Accept and Reject as icons, named in their hints, when the bar doesn't fit the window", async () => {
    const width = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(420);
    const inner = vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(400);
    try {
      const { editor, review } = mount(doc);
      review.openBar();
      await frame();
      expect(bar(editor)?.classList).toContain('rl-review-bar-narrow');
      const accept = button(bar(editor)!, 'Accept');
      expect(accept.getAttribute('aria-label')).toBe('Accept');
      expect(accept.querySelector('.rl-hint')?.textContent).toBe('Accept');
      expect(button(bar(editor)!, 'Reject').querySelector('.rl-hint')?.textContent).toBe('Reject');
      // The bar is placed again at its new width, inside the window.
      expect(bar(editor)?.style.left).not.toBe('');

      // A wider window: the bar, opened again, keeps its labels.
      inner.mockReturnValue(800);
      review.closeBar();
      review.openBar();
      await frame();
      expect(bar(editor)).not.toBeNull();
      expect(bar(editor)?.classList).not.toContain('rl-review-bar-narrow');
    } finally {
      width.mockRestore();
      inner.mockRestore();
    }
  });
});
