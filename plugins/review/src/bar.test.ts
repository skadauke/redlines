// @vitest-environment happy-dom
import { barClickHandlers, currentChange, type Editor } from '@redlines/editor';
import { afterEach, describe, expect, it } from 'vitest';
import { EditError } from '@redlines/format';
import { panelPlace } from './bar.ts';
import { button, file, mount, PEOPLE, press, REFUSAL, thread, unmountAll } from './test-helpers.ts';

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

const bar = (editor: Editor) => editor.view.dom.querySelector<HTMLElement>('.rl-review-panel');
const count = (editor: Editor) => bar(editor)?.querySelector('.rl-bar-count')?.textContent;

/** The text of the change the review is on (its marks, markers included), and nothing selected. */
function selected(editor: Editor): string {
  const { state } = editor.view;
  expect(state.selection.main.empty, 'the review leaves nothing selected').toBe(true);
  const ranges = state.field(currentChange)?.ranges ?? [];
  return ranges.map(({ from, to }) => state.sliceDoc(from, to)).join('');
}

describe('review bar', () => {
  it('opens hidden', () => {
    const { editor, review, opened } = mount(doc);
    expect(review.isBarOpen()).toBe(false);
    expect(bar(editor)).toBeNull();
    review.openBar();
    expect(review.isBarOpen()).toBe(true);
    expect(bar(editor)?.getAttribute('role')).toBe('dialog');
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

  describe('Review Changes starts at once', () => {
    const at = (editor: Editor, what: string, start = 0) =>
      editor.view.state.doc.toString().indexOf(what, start);

    it('on the first change, wherever the caret is, and marks it', () => {
      const { editor, review } = mount(doc);
      editor.view.dispatch({ selection: { anchor: at(editor, 'Third') } });
      review.startReview();
      expect(review.isBarOpen()).toBe(true);
      expect(count(editor)).toBe('Change 1 of 3');
      expect(selected(editor)).toBe('<!--ins k3x9-->new<!--/k3x9-->');
      expect(editor.view.dom.querySelector('.rl-review-current')?.textContent).toBe('new');
    });

    it('on the first change the selection touches, which it deselects', () => {
      const { editor, review } = mount(doc);
      const from = at(editor, 'Third');
      editor.view.dispatch({ selection: { anchor: from, head: editor.view.state.doc.length } });
      review.startReview();
      expect(count(editor)).toBe('Change 3 of 3');
      expect(selected(editor)).toBe('<!--sub p7qd March-->April<!--/p7qd-->');
    });

    it('on the first change after a selection that touches none, round to the top', () => {
      const { editor, review } = mount(doc);
      const from = at(editor, 'Second');
      editor.view.dispatch({ selection: { anchor: from, head: from + 4 } });
      review.startReview();
      expect(count(editor)).toBe('Change 2 of 3');
      const last = at(editor, ' line.', at(editor, 'Third'));
      editor.view.dispatch({ selection: { anchor: last, head: last + 3 } });
      review.startReview();
      expect(count(editor)).toBe('Change 1 of 3');
    });

    it('then Next and Previous walk the whole document, and the mark moves and goes', () => {
      const { editor, review } = mount(doc);
      review.startReview();
      review.next();
      expect(count(editor)).toBe('Change 2 of 3');
      expect(selected(editor)).toBe('<!--del w2rf  old-->');
      review.previous();
      review.previous();
      expect(count(editor)).toBe('Change 3 of 3');
      expect(editor.view.dom.querySelectorAll('.rl-review-current')).toHaveLength(1);
      button(bar(editor)!, 'Close').click();
      expect(editor.view.dom.querySelector('.rl-review-current')).toBeNull();
      expect(editor.view.state.field(currentChange)).toBeNull();
    });

    it('goes when the selection moves elsewhere', () => {
      const { editor, review } = mount(doc);
      review.startReview();
      editor.view.dispatch({ selection: { anchor: at(editor, 'Second') } });
      expect(editor.view.state.field(currentChange)).toBeNull();
    });

    it('with no changes, just opens the bar', () => {
      const { editor, review } = mount(file('Plain text.', []));
      review.startReview();
      expect(count(editor)).toBe('No changes');
    });
  });

  describe('the mark of the current change', () => {
    const marked = (editor: Editor) => editor.view.state.field(currentChange);

    it('goes when the change is accepted from its card or rail note, which send no selection', () => {
      const { editor, review } = mount(doc, { real: true });
      review.startReview();
      expect(marked(editor)).not.toBeNull();
      editor.accept('k3x9');
      expect(marked(editor)).toBeNull();
      expect(editor.view.dom.querySelector('.rl-review-current')).toBeNull();
    });

    it('goes when the change is rejected from elsewhere', () => {
      const { editor, review } = mount(doc, { real: true });
      review.next();
      review.next();
      expect(marked(editor)?.ids).toEqual(['w2rf']);
      editor.reject('w2rf');
      expect(marked(editor)).toBeNull();
    });

    it('goes when the bar’s Accept decides the last change, with no next one to move to', () => {
      const one = file('Only <!--ins k3x9-->one<!--/k3x9--> here.', [
        ...PEOPLE,
        'marks:',
        '  k3x9: {by: ada, at: 2026-10-31T09:30Z}',
      ]);
      const { editor, review } = mount(one, { real: true });
      review.startReview();
      button(bar(editor)!, 'Accept').click();
      expect(count(editor)).toBe('No changes');
      expect(marked(editor)).toBeNull();
      expect(editor.view.dom.querySelector('.rl-review-current')).toBeNull();
    });

    it('goes when an edit removes the change, and stays when an edit elsewhere leaves it', () => {
      const { editor, review } = mount(doc, { real: true });
      review.startReview();
      editor.view.dispatch({ changes: { from: 0, to: 0, insert: 'X' } });
      expect(marked(editor)?.ids).toEqual(['k3x9']);
      const text = editor.view.state.doc.toString();
      const from = text.indexOf('<!--ins k3x9-->');
      const to = text.indexOf('<!--/k3x9-->') + '<!--/k3x9-->'.length;
      editor.view.dispatch({ changes: { from, to } });
      expect(marked(editor)).toBeNull();
    });

    it('is on the change that starts at a caret on an edge two changes share', () => {
      const replaced = file('A <!--del w2rf  old--><!--ins p7qd-->new<!--/p7qd--> b.', [
        ...PEOPLE,
        'marks:',
        '  w2rf: {by: ada, at: 2026-10-31T09:30Z}',
        '  p7qd: {by: ada, at: 2026-10-31T09:30Z}',
      ]);
      const { editor, review } = mount(replaced, { real: true });
      review.openBar();
      const at = editor.view.state.doc.toString().indexOf('<!--ins p7qd-->');
      editor.view.dispatch({ selection: { anchor: at } });
      // The caret is where the deletion ends and the insertion starts: it is on the insertion.
      expect(count(editor)).toBe('Change 2 of 2');
    });
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

  it('opens the card of the change beside the piece of the bar that was clicked, not the first on the line', () => {
    // Two changes on one line that wraps: the bar beside the second's screen lines is the second's.
    const two = file(
      'One <!--ins k3x9-->new<!--/k3x9--> and then <!--ins w2rf-->more<!--/w2rf-->.',
      [
        ...PEOPLE,
        'marks:',
        '  k3x9: {by: ada, at: 2026-10-31T09:30Z}',
        '  w2rf: {by: bo, at: 2026-10-31T09:35Z}',
      ],
    );
    const { editor, review } = mount(two);
    review.openBar();
    const second = two.indexOf('more');
    const handle = (span?: { from: number; to: number }) =>
      editor.view.state
        .facet(barClickHandlers)
        .some((handler) => handler(editor.view, 0, undefined, span));
    handle({ from: second - 3, to: second + 8 });
    expect(editor.view.dom.querySelector('.rl-card-what')?.textContent).toBe('Inserted “more”');
    // Without one, as before: the first change of the line.
    handle();
    expect(editor.view.dom.querySelector('.rl-card-what')?.textContent).toBe('Inserted “new”');
  });

  it('opens the nearest change before a piece that has none beside it, as struck words that wrap onto later screen lines', () => {
    // A deletion's words wrap over screen lines after the one it stands at: the piece of the bar
    // there is beside plain text, and the change it belongs to is the last one before it.
    const three = file(
      'One <!--ins k3x9-->new<!--/k3x9--> and <!--ins w2rf-->more<!--/w2rf--> then plain words, <!--ins q3q3-->last<!--/q3q3-->.',
      [
        ...PEOPLE,
        'marks:',
        '  k3x9: {by: ada, at: 2026-10-31T09:30Z}',
        '  w2rf: {by: bo, at: 2026-10-31T09:35Z}',
        '  q3q3: {by: ada, at: 2026-10-31T09:40Z}',
      ],
    );
    const { editor, review } = mount(three);
    review.openBar();
    const gap = three.indexOf('plain');
    editor.view.state
      .facet(barClickHandlers)
      .some((handler) => handler(editor.view, 0, undefined, { from: gap, to: gap + 11 }));
    expect(editor.view.dom.querySelector('.rl-card-what')?.textContent).toBe('Inserted “more”');
    // Before the first change there is none before it: the first on the line.
    editor.view.state
      .facet(barClickHandlers)
      .some((handler) => handler(editor.view, 0, undefined, { from: 0, to: 3 }));
    expect(editor.view.dom.querySelector('.rl-card-what')?.textContent).toBe('Inserted “new”');
  });

  it('opens the deleted block above, not the paragraph’s own change on a later row, for the piece at the paragraph’s start', () => {
    // In the simple look the first screen line's bar is the deleted block's, which the page hides
    // just above; the paragraph's own change is on a later row, with a bar of its own.
    const body = file(
      'First.\n\n<!--del w2rf Gone.\\n\\n-->\n\nSecond line of words that wraps, then <!--ins k3x9-->new<!--/k3x9--> ones.',
      [
        ...PEOPLE,
        'marks:',
        '  k3x9: {by: ada, at: 2026-10-31T09:30Z}',
        '  w2rf: {by: bo, at: 2026-10-31T09:35Z}',
      ],
    );
    const { editor, review } = mount(body, { markupView: 'simple' });
    review.openBar();
    const start = body.indexOf('Second');
    const handle = (span: { from: number; to: number }) =>
      editor.view.state
        .facet(barClickHandlers)
        .some((handler) => handler(editor.view, start, undefined, span));
    handle({ from: start, to: start + 20 });
    expect(editor.view.dom.querySelector('.rl-card-what')?.textContent).toBe('Deleted “Gone.”');
    // The piece beside the paragraph's own change opens it.
    const own = body.indexOf('new');
    handle({ from: own - 5, to: own + 10 });
    expect(editor.view.dom.querySelector('.rl-card-what')?.textContent).toBe('Inserted “new”');
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

  it('opens the card of the change when a bar is clicked in the simple look, bar closed (#664)', () => {
    const { editor } = mount(doc);
    const handle = (pos: number) =>
      editor.view.state.facet(barClickHandlers).some((handler) => handler(editor.view, pos));
    editor.setViewMode('simple');
    expect(handle(0)).toBe(true);
    expect(editor.view.dom.querySelector('.rl-card-what')?.textContent).toBe('Inserted “new”');
    // A bar with no change at it is left to the core, which switches the looks.
    expect(handle(doc.indexOf('\n\n') + 1)).toBe(false);
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
    expect(editor.view.dom.querySelectorAll('.rl-review-panel')).toHaveLength(1);
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

  it('has no bottom bar: the panel is fixed in the window, with its title as the handle', () => {
    const { editor, review } = mount(doc);
    review.openBar();
    const panel = bar(editor)!;
    expect(panel.getAttribute('role')).toBe('dialog');
    expect(panel.querySelector('.rl-rp-top')).not.toBeNull();
    expect(editor.view.dom.querySelector('.rl-review-bar')).toBeNull();
  });
});

describe('where the panel goes', () => {
  const visible = { left: 0, top: 52, right: 1280, bottom: 800 };
  const size = { width: 304, height: 200 };

  it('goes beside the change, in the margin right of the column, level with its top', () => {
    const at = panelPlace(
      {
        change: { left: 200, right: 500, top: 300, bottom: 322 },
        column: { left: 130, right: 900 },
        visible,
      },
      size,
    );
    expect(at).toEqual({ left: 916, top: 294, width: 304 });
  });

  it('is made narrower to fit a margin that is not wide enough, down to 240 px', () => {
    const change = { left: 200, right: 500, top: 300, bottom: 322 };
    const at = panelPlace({ change, column: { left: 130, right: 980 }, visible }, size);
    expect(at).toEqual({ left: 996, top: 294, width: 272 });
  });

  it('keeps clear of the margin notes: the nearest place along the margin that has none', () => {
    const change = { left: 200, right: 500, top: 300, bottom: 322 };
    const notes = [{ top: 280, bottom: 360 }];
    const at = panelPlace({ change, column: { left: 130, right: 900 }, visible, notes }, size);
    expect(at.left).toBe(916);
    // Below the note, or above it, and never over it.
    expect(at.top >= 366 || at.top + size.height <= 274).toBe(true);
  });

  it('goes below the change where the margin has no room, never over it', () => {
    const change = { left: 40, right: 300, top: 300, bottom: 322 };
    const at = panelPlace(
      { change, column: { left: 20, right: 460 }, visible: { ...visible, right: 600 } },
      size,
    );
    expect(at.left).toBeGreaterThanOrEqual(12);
    expect(at.top).toBeGreaterThanOrEqual(change.bottom);
  });

  it('goes above the change when it does not fit below', () => {
    const change = { left: 40, right: 300, top: 700, bottom: 722 };
    const at = panelPlace(
      { change, column: { left: 20, right: 460 }, visible: { ...visible, right: 600 } },
      size,
    );
    expect(at.top + size.height).toBeLessThanOrEqual(change.top);
  });

  it('stays inside the window', () => {
    const at = panelPlace(
      {
        change: { left: 200, right: 500, top: 790, bottom: 800 },
        column: { left: 130, right: 900 },
        visible,
      },
      size,
    );
    expect(at.top + size.height).toBeLessThanOrEqual(visible.bottom - 12);
    expect(at.top).toBeGreaterThanOrEqual(visible.top + 12);
  });
});

describe('the review panel', () => {
  const panelOf = (editor: Editor) => bar(editor)!;
  const key = (editor: Editor, k: string, init: KeyboardEventInit = {}) =>
    press(panelOf(editor), k, init);

  it('names the change: who, when and what', () => {
    const { editor, review } = mount(doc);
    review.startReview();
    const text = panelOf(editor).textContent ?? '';
    expect(text).toContain('Review Changes');
    expect(text).toContain('Change 1 of 3');
    expect(panelOf(editor).querySelector('.rl-rp-name')?.textContent).toBe('Ada Lovelace');
    expect(panelOf(editor).querySelector('.rl-rp-what')?.textContent).toBe('Inserted “new”');
  });

  it('takes the keyboard when it opens and after each change', () => {
    const { editor, review } = mount(doc);
    review.startReview();
    expect(document.activeElement).toBe(panelOf(editor));
    editor.view.focus();
    key(editor, 'ArrowRight');
    expect(count(editor)).toBe('Change 2 of 3');
    expect(document.activeElement).toBe(panelOf(editor));
  });

  it('A accepts and R rejects, each moving on; the arrows move between changes', () => {
    const { editor, review } = mount(doc);
    review.startReview();
    key(editor, 'ArrowRight');
    key(editor, 'ArrowLeft');
    expect(count(editor)).toBe('Change 1 of 3');
    key(editor, 'a');
    expect(editor.getDoc()).not.toContain('<!--ins k3x9-->');
    expect(count(editor)).toBe('Change 1 of 2');
    key(editor, 'R');
    expect(editor.getDoc()).not.toContain('<!--del w2rf');
    expect(count(editor)).toBe('Change 1 of 1');
  });

  it('keys with a modifier are left alone', () => {
    const { editor, review } = mount(doc);
    review.startReview();
    key(editor, 'a', { metaKey: true });
    key(editor, 'ArrowRight', { altKey: true });
    expect(count(editor)).toBe('Change 1 of 3');
    expect(editor.getDoc()).toContain('<!--ins k3x9-->');
  });

  it('says there are no more changes after the last, and Done closes it', () => {
    const { editor, review } = mount(doc);
    review.startReview();
    key(editor, 'a');
    key(editor, 'a');
    key(editor, 'a');
    expect(panelOf(editor).textContent).toContain('No more changes to review.');
    expect(panelOf(editor).querySelector('.rl-rp-actions')).toHaveProperty('hidden', true);
    button(panelOf(editor), 'Done').click();
    expect(bar(editor)).toBeNull();
    expect(review.isBarOpen()).toBe(false);
  });

  it('Esc closes it', () => {
    const { editor, review } = mount(doc);
    review.startReview();
    key(editor, 'Escape');
    expect(bar(editor)).toBeNull();
  });

  it('C opens the comment field, and Return posts it as a comment on the change', () => {
    const { editor, review } = mount(doc);
    review.startReview();
    const form = panelOf(editor).querySelector<HTMLElement>('.rl-rp-form')!;
    expect(form.hidden).toBe(true);
    key(editor, 'c');
    expect(form.hidden).toBe(false);
    const field = form.querySelector('textarea')!;
    expect(document.activeElement).toBe(field);
    // Typing letters in the field is typing: A does not accept.
    press(field, 'a');
    expect(editor.getDoc()).toContain('<!--ins k3x9-->');
    field.value = 'Why add this?';
    press(field, 'Enter');
    const posted = editor.getDoc();
    expect(posted).toContain('Why add this?');
    expect(posted).toMatch(/<!--cmt \w{4}-->/);
    // The change is still pending, and the panel is on it, with the field closed.
    expect(posted).toContain('<!--ins k3x9-->');
    expect(count(editor)).toBe('Change 1 of 3');
    expect(form.hidden).toBe(true);
  });

  it('Esc in the comment field closes the field, not the panel', () => {
    const { editor, review } = mount(doc);
    review.startReview();
    key(editor, 'c');
    const field = panelOf(editor).querySelector('textarea')!;
    press(field, 'Escape');
    expect(bar(editor)).not.toBeNull();
    expect(panelOf(editor).querySelector<HTMLElement>('.rl-rp-form')!.hidden).toBe(true);
  });

  it('is dragged by its title and stays where it was put, for the next change too', () => {
    const { editor, review } = mount(doc);
    review.startReview();
    const handle = panelOf(editor).querySelector<HTMLElement>('.rl-rp-top')!;
    const at = (type: string, x: number, y: number) =>
      handle.dispatchEvent(
        new MouseEvent(type.replace('pointer', 'pointer'), {
          clientX: x,
          clientY: y,
          button: 0,
          bubbles: true,
          cancelable: true,
        }),
      );
    handle.getBoundingClientRect = panelOf(editor).getBoundingClientRect = () => ({
      left: 100,
      top: 100,
      right: 404,
      bottom: 300,
      width: 304,
      height: 200,
      x: 100,
      y: 100,
      toJSON() {},
    });
    at('pointerdown', 150, 110);
    at('pointermove', 450, 410);
    at('pointerup', 450, 410);
    expect(panelOf(editor).style.left).toBe('400px');
    expect(panelOf(editor).style.top).toBe('400px');
    key(editor, 'ArrowRight');
    expect(panelOf(editor).style.left).toBe('400px');
    expect(panelOf(editor).style.top).toBe('400px');
  });

  it('does not decide a change for every repeat of a held key', () => {
    const { editor, review } = mount(doc);
    review.startReview();
    key(editor, 'a', { repeat: true });
    key(editor, 'a', { repeat: true });
    expect(editor.getDoc()).toContain('<!--ins k3x9-->');
    expect(count(editor)).toBe('Change 1 of 3');
    key(editor, 'a');
    expect(editor.getDoc()).not.toContain('<!--ins k3x9-->');
  });

  it('leaves a key that is part of an input method’s composition alone', () => {
    const { editor, review } = mount(doc);
    review.startReview();
    key(editor, 'c');
    const field = panelOf(editor).querySelector('textarea')!;
    field.value = 'half';
    press(field, 'Enter', { keyCode: 229 });
    press(field, 'Escape', { isComposing: true });
    expect(editor.getDoc()).not.toContain('half');
    expect(field.value).toBe('half');
  });

  it('keeps the words of a comment when the decision is refused', () => {
    const { editor, review } = mount(doc);
    review.startReview();
    key(editor, 'c');
    const field = panelOf(editor).querySelector('textarea')!;
    field.value = 'Keep me';
    const real = editor.accept.bind(editor);
    editor.accept = () => {
      throw new EditError('The ledger can’t be read.', 'unreadable-ledger');
    };
    try {
      button(panelOf(editor), 'Accept').click();
    } finally {
      editor.accept = real;
    }
    expect(field.value).toBe('Keep me');
    expect(count(editor)).toBe('Change 1 of 3');
  });

  it('reads the next change out when it comes up', () => {
    const { editor, review } = mount(doc);
    review.startReview();
    expect(panelOf(editor).querySelector('.rl-rp-body')?.getAttribute('aria-live')).toBe('polite');
  });
});
