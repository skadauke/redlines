// @vitest-environment happy-dom
import { activateHover } from '@codemirror/view';
import type { Editor } from '@redlines/editor';
import { parse, type MarkRange } from '@redlines/format';
import { afterEach, describe, expect, it } from 'vitest';
import { describeChange } from './cards.ts';
import {
  button,
  click,
  file,
  mount,
  PEOPLE,
  press,
  REFUSAL,
  tick,
  unmountAll,
} from './test-helpers.ts';

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
const what = (editor: Editor) => card(editor)?.querySelector('.rl-card-what')?.textContent;

/** Clicks the first element drawn as `selector`; the card opens after the release. */
async function clickOn(editor: Editor, selector: string): Promise<void> {
  const target = editor.view.contentDOM.querySelector(selector);
  if (!target) throw new Error(`Nothing drawn as ${selector}`);
  click(target, editor.view.contentDOM);
  await tick();
}

describe('change cards', () => {
  it("describes a substitution in Word's words", () => {
    expect(describeChange(parsed, mark('p7qd'))).toBe('Replaced “March” with “April”');
    expect(describeChange(parsed, mark('k3x9'))).toBe('Inserted “new”');
  });

  it('describes inserted and deleted breaks', () => {
    const breaks = parse(
      file(
        'The first half.<!--split s3vb-->\n\nThe second half.\n\nPara<!--del j7mm \\n\\n## -->Heading text',
        [
          ...PEOPLE,
          'marks:',
          '  s3vb: {by: ada, at: 2026-10-31T09:30Z}',
          '  j7mm: {by: bo, at: 2026-10-31T09:35Z}',
        ],
      ),
    );
    const [split, join] = breaks.marks;
    expect(describeChange(breaks, split!)).toBe('Inserted paragraph break');
    expect(describeChange(breaks, join!)).toBe('Joined paragraphs');
  });

  it('shows a change of white space with marks that can be read', () => {
    const spaces = parse(
      file(
        'One<!--sub p7qd   -->c<!--/p7qd-->two.<!--del w2rf  -->Three<!--sub r4tn \t-->  <!--/r4tn-->four.',
        [
          ...PEOPLE,
          'marks:',
          '  p7qd: {by: bo, at: 2026-10-31T09:30Z}',
          '  w2rf: {by: bo, at: 2026-10-31T09:31Z}',
          '  r4tn: {by: bo, at: 2026-10-31T09:32Z}',
        ],
      ),
    );
    const [replaced, deleted, tab] = spaces.marks;
    // A space as a dot and a tab as an arrow, as Word's formatting marks show them.
    expect(describeChange(spaces, replaced!)).toBe('Replaced “··” with “c”');
    expect(describeChange(spaces, deleted!)).toBe('Deleted “·”');
    expect(describeChange(spaces, tab!)).toBe('Replaced “→” with “··”');
  });

  it('long text is shortened to 40 characters with an ellipsis', () => {
    const quoted = /^Deleted “(.*)”$/.exec(describeChange(parsed, mark('w2rf')))?.[1];
    expect(quoted).toBe('The old exporter stays as it is, and so…');
    expect(quoted).toHaveLength(40);
    // An emoji is never cut in half.
    const emoji: MarkRange = { ...mark('w2rf'), payload: '😀'.repeat(45) };
    expect(describeChange(parsed, emoji)).toBe(`Deleted “${'😀'.repeat(39)}…”`);
  });

  it('quotes inserted text without what carries its opener', () => {
    // In a quote, an opener on a line of its own is carried by the line break and the next `> `.
    const quoted = parse(
      file('> <!--ins k3x9-->\n> The importer.<!--/k3x9-->', [
        ...PEOPLE,
        'marks:',
        '  k3x9: {by: ada, at: 2026-10-31T09:30Z}',
      ]),
    );
    expect(describeChange(quoted, quoted.marks[0]!)).toBe('Inserted “The importer.”');
  });

  it('accept in a card accepts that change', async () => {
    const { editor, decided } = mount(doc);
    await clickOn(editor, '.rl-ins');
    expect(what(editor)).toBe('Inserted “new”');
    button(card(editor)!, 'Accept').click();
    expect(decided).toEqual([{ id: 'k3x9', how: 'accept' }]);
    expect(editor.getDoc()).not.toContain('k3x9');
    expect(editor.getDoc()).toContain('We ship the new importer');
    // The card goes with its change.
    expect(card(editor)).toBeNull();
  });

  it('reject in a card rejects that change', async () => {
    const { editor, decided } = mount(doc);
    await clickOn(editor, '.rl-del');
    expect(what(editor)).toBe('Replaced “March” with “April”');
    button(card(editor)!, 'Reject').click();
    expect(decided).toEqual([{ id: 'p7qd', how: 'reject' }]);
    expect(editor.getDoc()).toContain('importer in March.');
  });

  it('a refused decision changes nothing and says why', async () => {
    const { editor, decided } = mount(doc, { refuse: true });
    const before = editor.getDoc();
    await clickOn(editor, '.rl-ins');
    button(card(editor)!, 'Accept').click();
    expect(editor.getDoc()).toBe(before);
    expect(decided).toEqual([]);
    const error = card(editor)?.querySelector<HTMLElement>('.rl-card-error');
    expect(error?.hidden).toBe(false);
    expect(error?.textContent).toBe(REFUSAL);
  });

  it('clicking a change pins its card, also when the press redraws the change', async () => {
    // An agent's change with its reason: the press puts the cursor in the change, which selects its
    // note and redraws the change with its anchor's tint, so the browser sends no click.
    const noted = file('We ship in <!--sub p7qd March-->April<!--/p7qd-->.', [
      ...PEOPLE,
      'marks:',
      '  p7qd: {by: claude-ada, at: 2026-10-31T09:31Z, note: Matches the roadmap}',
    ]);
    const { editor } = mount(noted);
    const target = editor.view.contentDOM.querySelector('.rl-ins')!;
    target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    const inside = editor.view.state.doc.toString().indexOf('April') + 2;
    editor.view.dispatch({ selection: { anchor: inside }, userEvent: 'select.pointer' });
    // The change is drawn again, inside its anchor's tint.
    expect(target.closest('.rl-anchor')).not.toBeNull();
    editor.view.contentDOM.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    await tick();
    expect(what(editor)).toBe('Replaced “March” with “April”');
  });

  it('a drag over a change pins no card', async () => {
    const { editor } = mount(doc);
    const target = editor.view.contentDOM.querySelector('.rl-ins')!;
    target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 10, clientY: 10 }));
    editor.view.contentDOM.dispatchEvent(
      new MouseEvent('mouseup', { bubbles: true, clientX: 90, clientY: 10 }),
    );
    await tick();
    expect(card(editor)).toBeNull();
  });

  it('hovering a deleted paragraph shows its card', () => {
    // A whole paragraph's deletion: its opener on a line of its own, its text drawn at the start of
    // the block below.
    const blocks = file(
      'First.\n\n<!--del w2rf Old paragraph text.\\n\\n-->\n\nSecond paragraph.',
      [...PEOPLE, 'marks:', '  w2rf: {by: bo, at: 2026-10-31T09:35Z}'],
    );
    const { editor } = mount(blocks);
    const struck = editor.view.contentDOM.querySelector('.rl-del')!;
    struck.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    // The editor reports a widget by its start and the side after it.
    activateHover(editor.view, editor.view.posAtDOM(struck), 1);
    expect(what(editor)).toBe('Deleted “Old paragraph text.”');
  });

  describe('a deleted paragraph next to an inserted one', () => {
    // Bo deleted a paragraph and Ada inserted one in its place, as the format writes it: the
    // deleted text is drawn at the start of the block below, which is Ada's insertion.
    const swapped = file(
      [
        'First.',
        '',
        '<!--del w2rf Old paragraph text.\\n\\n-->',
        '',
        '<!--ins k3x9-->',
        '',
        'New paragraph text.<!--/k3x9--><!--split s3vb-->',
        '',
        'Second paragraph.',
      ].join('\n'),
      [
        ...PEOPLE,
        'marks:',
        '  w2rf: {by: bo, at: 2026-10-31T09:35Z}',
        '  k3x9: {by: ada, at: 2026-10-31T09:30Z}',
        '  s3vb: {by: ada, at: 2026-10-31T09:30Z}',
      ],
    );
    const struck = (editor: Editor) =>
      [...editor.view.contentDOM.querySelectorAll('.rl-del')].find((el) =>
        el.textContent?.includes('Old paragraph'),
      )!;

    it('hovering the struck text shows the deletion’s card', () => {
      const { editor } = mount(swapped);
      const el = struck(editor);
      el.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
      activateHover(editor.view, editor.view.posAtDOM(el), 1);
      expect(what(editor)).toBe('Deleted “Old paragraph text.”');
    });

    it('clicking the struck text pins the deletion’s card', async () => {
      const { editor } = mount(swapped);
      click(struck(editor), editor.view.contentDOM);
      await tick();
      expect(what(editor)).toBe('Deleted “Old paragraph text.”');
      button(card(editor)!, 'Reject').click();
      expect(editor.getDoc()).toContain('Old paragraph text.');
    });

    it('hovering the inserted text shows the insertion’s card', () => {
      const { editor } = mount(swapped);
      const text = editor.view.state.doc.toString();
      editor.view.contentDOM.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
      activateHover(editor.view, text.indexOf('paragraph text.<!--/k3x9') + 2, 1);
      expect(what(editor)).toBe('Inserted “New paragraph text.”');
    });
  });

  it('says who made the change and when', async () => {
    const { editor } = mount(doc);
    await clickOn(editor, '.rl-del');
    const shown = card(editor)!;
    // Claude's color, which follows from Claude's handle.
    expect(shown.classList).toContain('rl-author-4');
    expect(shown.querySelector('.rl-card-name')?.textContent).toBe('Claude');
    expect(shown.querySelector('.rl-card-for')?.textContent).toBe('for Ada');
    expect(shown.querySelector('time')?.dateTime).toBe('2026-10-31T09:31Z');
    expect(shown.querySelector('time')?.textContent).not.toBe('');
  });

  it('Esc puts a pinned card away', async () => {
    const { editor } = mount(doc);
    await clickOn(editor, '.rl-ins');
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
    expect(what(editor)).toBe('Inserted “new”');
  });

  it('goes by the editor’s list of changes', () => {
    const { editor } = mount(doc);
    const real = editor.getUiState.bind(editor);
    editor.getUiState = () => ({
      ...real(),
      changes: real().changes.filter(({ id }) => id !== 'k3x9'),
    });
    activateHover(editor.view, editor.view.state.doc.toString().indexOf('new') + 1, 1);
    expect(card(editor)).toBeNull();
  });
});
