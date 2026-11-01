// @vitest-environment happy-dom
import { activateHover } from '@codemirror/view';
import type { Editor } from '@redlines/editor';
import { parse, type MarkRange } from '@redlines/format';
import { afterEach, describe, expect, it } from 'vitest';
import { describeChange } from './cards.ts';
import { button, file, mount, PEOPLE, press, unmountAll } from './test-helpers.ts';

afterEach(unmountAll);

const LONG = 'The old exporter stays as it is, and so does its long list of options.';

const doc = file(
  `We ship the <!--ins k3x9-->new <!--/k3x9-->importer in <!--sub p7qd March-->April<!--/p7qd-->.<!--del w2rf  ${LONG}-->`,
  [
    ...PEOPLE,
    'marks:',
    '  k3x9: {by: ada, at: 2026-10-31T09:30Z}',
    '  p7qd: {by: claude-ada, at: 2026-10-31T09:31Z}',
    '  w2rf: {by: bo, at: 2026-10-31T09:35Z}',
  ],
);

const parsed = parse(doc);
const mark = (id: string) => parsed.marks.find((found) => found.id === id)!;
const card = (editor: Editor) => editor.view.dom.querySelector<HTMLElement>('.rl-card');

/** Clicks the first element with this class in the text. */
function clickOn(editor: Editor, selector: string): void {
  const target = editor.view.contentDOM.querySelector(selector);
  if (!target) throw new Error(`Nothing drawn as ${selector}`);
  target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}

describe('change cards', () => {
  it("describes a substitution in Word's words", () => {
    expect(describeChange(parsed, mark('p7qd'))).toBe('Replaced “March” with “April”');
    expect(describeChange(parsed, mark('k3x9'))).toBe('Inserted “new”');
  });

  it('long text is shortened to 40 characters with an ellipsis', () => {
    const quoted = /^Deleted “(.*)”$/.exec(describeChange(parsed, mark('w2rf')))?.[1];
    expect(quoted).toBe('The old exporter stays as it is, and so…');
    expect(quoted).toHaveLength(40);
    // An emoji is never cut in half.
    const emoji: MarkRange = { ...mark('w2rf'), payload: '😀'.repeat(45) };
    expect(describeChange(parsed, emoji)).toBe(`Deleted “${'😀'.repeat(39)}…”`);
  });

  it('accept in a card accepts that change', () => {
    const { editor, decided } = mount(doc);
    clickOn(editor, '.rl-ins');
    expect(card(editor)?.querySelector('.rl-card-what')?.textContent).toBe('Inserted “new”');
    button(card(editor)!, 'Accept').click();
    expect(decided).toEqual([{ id: 'k3x9', how: 'accept' }]);
    expect(editor.getDoc()).not.toContain('k3x9');
    expect(editor.getDoc()).toContain('We ship the new importer');
    // The card goes with its change.
    expect(card(editor)).toBeNull();
  });

  it('reject in a card rejects that change', () => {
    const { editor, decided } = mount(doc);
    clickOn(editor, '.rl-del');
    expect(card(editor)?.querySelector('.rl-card-what')?.textContent).toBe(
      'Replaced “March” with “April”',
    );
    button(card(editor)!, 'Reject').click();
    expect(decided).toEqual([{ id: 'p7qd', how: 'reject' }]);
    expect(editor.getDoc()).toContain('importer in March.');
  });

  it('says who made the change and when', () => {
    const { editor } = mount(doc);
    clickOn(editor, '.rl-del');
    const shown = card(editor)!;
    expect(shown.classList).toContain('rl-author-3');
    expect(shown.querySelector('.rl-card-name')?.textContent).toBe('Claude');
    expect(shown.querySelector('.rl-card-for')?.textContent).toBe('for Ada Lovelace');
    expect(shown.querySelector('time')?.dateTime).toBe('2026-10-31T09:31Z');
    expect(shown.querySelector('time')?.textContent).not.toBe('');
  });

  it('Esc puts a pinned card away', () => {
    const { editor } = mount(doc);
    clickOn(editor, '.rl-ins');
    expect(card(editor)).not.toBeNull();
    press(editor.view.contentDOM, 'Escape');
    expect(card(editor)).toBeNull();
  });

  it('shows cards only for changes, in Redlines', () => {
    const { editor } = mount(doc);
    const text = editor.view.state.doc.toString();
    activateHover(editor.view, text.indexOf('importer') + 1, 1);
    expect(card(editor)).toBeNull();
    editor.setViewMode('clean');
    activateHover(editor.view, text.indexOf('new') + 1, 1);
    expect(card(editor)).toBeNull();
    editor.setViewMode('redlines');
    activateHover(editor.view, text.indexOf('new') + 1, 1);
    expect(card(editor)?.querySelector('.rl-card-what')?.textContent).toBe('Inserted “new”');
  });
});
