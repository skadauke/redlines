// @vitest-environment happy-dom
import { activateHover } from '@codemirror/view';
import type { Editor } from '@redlines/editor';
import { parse, type MarkRange } from '@redlines/format';
import { afterEach, describe, expect, it } from 'vitest';
import { describeChange, describeChanges } from './cards.ts';
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

  it('describes a substitution with no old text as an insertion', () => {
    // The second part of a substitution that untracked typing split (format §3.10).
    const split = parse(
      file('a <!--sub p7qd old text-->new<!--/p7qd-->X<!--sub w8nn--> words<!--/w8nn--> b', [
        ...PEOPLE,
        'marks:',
        '  p7qd: {by: bo, at: 2026-10-31T09:30Z}',
        '  w8nn: {by: bo, at: 2026-10-31T09:30Z}',
      ]),
    );
    const [first, second] = split.marks;
    expect(describeChange(split, first!)).toBe('Replaced “old text” with “new”');
    expect(describeChange(split, second!)).toBe('Inserted “words”');
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

  it('says what a line break change is while its mark is hidden, as by default', () => {
    for (const [body, id, said] of [
      ['The first half.<!--split s3vb-->\n\nThe second half.', 's3vb', 'Inserted paragraph break'],
      ['One.<!--del j7mm \\n\\n-->Two.', 'j7mm', 'Joined paragraphs'],
    ] as const) {
      const ledger = [...PEOPLE, 'marks:', `  ${id}: {by: bo, at: 2026-10-31T09:35Z}`];
      const { editor } = mount(file(body, ledger));
      expect(editor.view.contentDOM.querySelector('.rl-split')).toBeNull();
      expect(editor.view.contentDOM.textContent).not.toContain('¶');
      // At the break: the end of the text before its marker.
      activateHover(editor.view, body.indexOf('<!--'), 1);
      expect(what(editor)).toBe(said);
    }
  });

  it('shows no card on hover and pins none on a click in Simple', async () => {
    const { editor } = mount(doc);
    editor.setViewMode('simple');
    expect(editor.view.contentDOM.querySelector('.rl-ins, .rl-del')).toBeNull();
    const at = doc.indexOf('new ');
    activateHover(editor.view, at, 1);
    expect(card(editor)).toBeNull();
    // Nothing is drawn to click on; a click on the text pins none either.
    const line = editor.view.contentDOM.querySelector('.cm-line')!;
    click(line, editor.view.contentDOM);
    await tick();
    expect(card(editor)).toBeNull();
    // In Redlines, the same position does show one.
    editor.setViewMode('redlines');
    activateHover(editor.view, at, 1);
    expect(what(editor)).toBe('Inserted “new”');
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

  describe('a deleted block drawn as a block, and a block rewritten whole', () => {
    // Two blocks that read the same, deleted by two people: the card is of the one pointed at.
    const twins = file(
      'First.\n\n<!--del w2rf Same words.\\n\\n-->\n\nMiddle.\n\n<!--del k3x9 Same words.\\n\\n-->\n\nLast.',
      [
        ...PEOPLE,
        'marks:',
        '  w2rf: {by: bo, at: 2026-10-31T09:35Z}',
        '  k3x9: {by: ada, at: 2026-10-31T09:36Z}',
      ],
    );
    const blocks = (editor: Editor) => [
      ...editor.view.contentDOM.querySelectorAll<HTMLElement>('.rl-struck'),
    ];
    const name = (editor: Editor) => card(editor)?.querySelector('.rl-card-name')?.textContent;

    it('opens the card of the right change on hover, found by its mark and not by its text', () => {
      const { editor } = mount(twins);
      expect(blocks(editor).map((block) => block.dataset['mark'])).toEqual(['w2rf', 'k3x9']);
      for (const [i, who] of [
        [1, 'Ada Lovelace'],
        [0, 'Bo Chen'],
      ] as const) {
        const block = blocks(editor)[i]!;
        // Over the block's text, or its padding.
        const over = i === 0 ? block : block.querySelector('.rl-del')!;
        over.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
        activateHover(editor.view, editor.view.posAtDOM(block), 1);
        expect(what(editor), who).toBe('Deleted “Same words.”');
        expect(name(editor), who).toBe(who);
      }
    });

    it('pins the card on a click and rejects the right block', async () => {
      const { editor } = mount(twins);
      click(blocks(editor)[1]!.querySelector('.rl-del')!, editor.view.contentDOM);
      await tick();
      expect(name(editor)).toBe('Ada Lovelace');
      button(card(editor)!, 'Reject').click();
      // Only Ada's block came back.
      expect(blocks(editor).map((block) => block.dataset['mark'])).toEqual(['w2rf']);
      expect(editor.getDoc()).toContain('Same words.');
      expect(editor.getDoc()).not.toContain('k3x9');
    });

    it('opens the card of a block rewritten whole from its struck old text', () => {
      const SENTENCE = 'The old paragraph here.';
      const rewritten = file(
        `Intro.\n\n<!--sub k3x9 ${SENTENCE}-->\n\nA new one entirely.<!--/k3x9-->\n\nEnd.`,
        [...PEOPLE, 'marks:', '  k3x9: {by: claude-ada, at: 2026-10-31T09:36Z}'],
      );
      const { editor } = mount(rewritten);
      const old = editor.view.contentDOM.querySelector<HTMLElement>('.rl-del')!;
      expect(old.dataset['mark']).toBe('k3x9');
      expect(old.querySelector('br')).not.toBeNull();
      old.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
      activateHover(editor.view, editor.view.posAtDOM(old), 1);
      expect(what(editor)).toBe(`Replaced “${SENTENCE}” with “A new one entirely.”`);
    });

    it('stands against the block’s box, above it or below, covering neither it nor the new text', async () => {
      const { editor } = mount(twins);
      const block = blocks(editor)[0]!;
      let asked = 0;
      Object.assign(block, {
        getBoundingClientRect: () => {
          asked++;
          return { left: 100, right: 500, top: 200, bottom: 240, width: 400, height: 40 };
        },
      });
      block.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
      activateHover(editor.view, editor.view.posAtDOM(block), 1);
      editor.view.requestMeasure();
      await new Promise((resolve) => requestAnimationFrame(resolve));
      // The editor asked the block for its box to place the card against it.
      expect(asked).toBeGreaterThan(0);
      const tooltip = card(editor)!.closest<HTMLElement>('.cm-tooltip')!;
      expect(tooltip.style.top).toMatch(/px$/);
    });

    it('keeps the card of a change with several segments from any of its struck parts', () => {
      // Ada's deletion around Bo's insertion: three pieces of one change, in three widgets.
      const spread = file(
        'Start here. The <!--del jqwd quick--><!--ins hpvc--><!--del jqwd  red--><!--/hpvc--><!--del jqwd  brown -->fox jumps. End here.',
        [
          ...PEOPLE,
          'marks:',
          '  jqwd: {by: bo, at: 2026-10-31T09:35Z}',
          '  hpvc: {by: ada, at: 2026-10-31T09:36Z}',
        ],
      );
      const { editor } = mount(spread);
      const parts = [...editor.view.contentDOM.querySelectorAll<HTMLElement>('.rl-del')];
      expect(parts.length).toBeGreaterThanOrEqual(2);
      for (const part of parts) {
        part.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
        activateHover(editor.view, editor.view.posAtDOM(part), 1);
        expect(card(editor)?.querySelector('.rl-card-name')?.textContent).toBe('Bo Chen');
      }
    });

    it('shows no card in Simple, where the block is not drawn', () => {
      const { editor } = mount(twins);
      editor.setViewMode('simple');
      expect(blocks(editor)).toEqual([]);
      expect(card(editor)).toBeNull();
    });
  });

  describe('a break whose marker is on a hidden line (#198)', () => {
    // Enter behind Bo's paragraph break: Ada's split stands alone on its line, which is hidden with
    // the blank lines around it. Both breaks are drawn at the end of the text above.
    const body = 'A second paragraph, <!--split b2b2-->\n\n<!--split c3c3-->\n\nto join.';
    const beside = file(body, [
      ...PEOPLE,
      'marks:',
      '  b2b2: {by: bo, at: 2026-10-31T09:35Z}',
      '  c3c3: {by: ada, at: 2026-10-31T09:36Z}',
    ]);
    const name = (editor: Editor) => card(editor)?.querySelector('.rl-card-name')?.textContent;

    it('opens the card of each from its mark, with line break marks shown', () => {
      const { editor } = mount(beside);
      editor.setShowLineBreakMarks(true);
      const marks = [...editor.view.contentDOM.querySelectorAll('.rl-split')];
      expect(marks).toHaveLength(2);
      // Both on the line of the text above.
      expect(marks.map((mark) => mark.closest('.cm-line')?.textContent)).toEqual([
        'A second paragraph, ',
        'A second paragraph, ',
      ]);
      for (const [i, who] of [
        [1, 'Ada Lovelace'],
        [0, 'Bo Chen'],
      ] as const) {
        const mark = marks[i]!;
        mark.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
        activateHover(editor.view, editor.view.posAtDOM(mark), 1);
        expect(what(editor), who).toBe('Inserted paragraph break');
        expect(name(editor)).toBe(who);
      }
    });

    it('opens a card at the break with the marks hidden, its line taking both bars', () => {
      const { editor } = mount(beside);
      const line = editor.view.contentDOM.querySelector('.cm-line');
      expect(line?.textContent).toBe('A second paragraph, ');
      expect(line?.className).toContain('rl-bar-mixed');
      activateHover(editor.view, body.indexOf('<!--'), 1);
      expect(what(editor)).toBe('Inserted paragraph break');
      expect(name(editor)).toBe('Bo Chen');
    });
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

  it('an open card follows the record of people', async () => {
    const { editor } = mount(doc, { people: [{ handle: 'claude-ada', color: 7 }] });
    await clickOn(editor, '.rl-del');
    expect(card(editor)!.classList).toContain('rl-author-7');
    editor.setPeople([{ handle: 'claude-ada', color: 5 }]);
    expect(card(editor)!.classList).toContain('rl-author-5');
    expect(card(editor)!.classList).not.toContain('rl-author-7');
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

  it('puts a pinned card away when Simple is chosen', async () => {
    const { editor } = mount(doc);
    await clickOn(editor, '.rl-ins');
    expect(card(editor)).not.toBeNull();
    editor.setViewMode('simple');
    expect(card(editor)).toBeNull();
  });

  it('puts a pinned card away when asked', async () => {
    const { editor, review } = mount(doc);
    await clickOn(editor, '.rl-ins');
    expect(card(editor)).not.toBeNull();
    review.closePopovers();
    expect(card(editor)).toBeNull();
    // With no card open, it does nothing.
    review.closePopovers();
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

describe('format change cards', () => {
  const formatted = file('We ship the <!--fmt m2bd +bold-->**new**<!--/m2bd--> importer.', [
    ...PEOPLE,
    'marks:',
    '  m2bd: {by: bo, at: 2026-10-31T09:35Z}',
  ]);

  it('names the format in its card, and Accept accepts it', async () => {
    const { editor, decided } = mount(formatted);
    await clickOn(editor, '.rl-fmt');
    expect(what(editor)).toBe('Formatted: Bold');
    button(card(editor)!, 'Accept').click();
    expect(decided).toEqual([{ id: 'm2bd', how: 'accept' }]);
    expect(editor.getDoc()).toContain('We ship the **new** importer.');
    expect(editor.getDoc()).not.toContain('m2bd');
  });

  it('Reject in its card undoes the format', async () => {
    const { editor, decided } = mount(formatted);
    await clickOn(editor, '.rl-fmt');
    button(card(editor)!, 'Reject').click();
    expect(decided).toEqual([{ id: 'm2bd', how: 'reject' }]);
    expect(editor.getDoc()).toContain('We ship the new importer.');
  });

  it('offers only Accept for a format change whose text has lost the format', async () => {
    const lost = file('We ship the <!--fmt m2bd +bold-->new<!--/m2bd--> importer.', [
      ...PEOPLE,
      'marks:',
      '  m2bd: {by: bo, at: 2026-10-31T09:35Z}',
    ]);
    const { editor, decided } = mount(lost);
    await clickOn(editor, '.rl-fmt');
    expect(() => button(card(editor)!, 'Reject')).toThrow('No button');
    button(card(editor)!, 'Accept').click();
    expect(decided).toEqual([{ id: 'm2bd', how: 'accept' }]);
  });
});

describe('an inserted table row', () => {
  const ROW = file(
    '| Fruit | Count |\n| ----- | ----- |\n| Apples | 3 |\n| <!--ins k3x9 row--> Pears | 5 |\n| <!--ins m2bd row--> Plums | 7 |',
    [
      ...PEOPLE,
      'marks:',
      '  k3x9: {by: bo, at: 2026-10-31T09:30Z, group: g4tz}',
      '  m2bd: {by: bo, at: 2026-10-31T09:30Z, group: g4tz}',
    ],
  );
  const ONE = file('| Fruit | Count |\n| ----- | ----- |\n| <!--ins k3x9 row--> Pears | 5 |', [
    ...PEOPLE,
    'marks:',
    '  k3x9: {by: bo, at: 2026-10-31T09:30Z}',
  ]);

  it('is described as Inserted row, and Inserted 2 rows for rows inserted together', async () => {
    const rows = parse(ROW);
    expect(describeChange(rows, rows.marks[0]!)).toBe('Inserted row');
    const { editor } = mount(ROW);
    editor.setViewMode('redlines');
    await clickOn(editor, '.rl-ins-row');
    expect(what(editor)).toBe('Inserted 2 rows');
  });

  const DELETED_ROW = file(
    '| Fruit | Count |\n| ----- | ----- |\n| Apples | 3 |\n\n<!--del g5nb row=2 \\| Pears \\| 5 \\|-->',
    [...PEOPLE, 'marks:', '  g5nb: {by: bo, at: 2026-10-31T09:30Z}'],
  );
  const MOVED_ROW = file(
    '| Fruit | Count |\n| ----- | ----- |\n| <!--ins h6nb row--> Plums | 7 |\n| Apples | 3 |\n\n<!--del j7nb row=3 \\| Plums \\| 7 \\|-->',
    [
      ...PEOPLE,
      'marks:',
      '  h6nb: {by: bo, at: 2026-10-31T09:30Z, move: j7nb}',
      '  j7nb: {by: bo, at: 2026-10-31T09:30Z, move: h6nb}',
    ],
  );

  it('is described as Deleted row and Moved row, and a click on a ghost opens the card', async () => {
    const deleted = parse(DELETED_ROW);
    expect(describeChange(deleted, deleted.marks[0]!)).toBe('Deleted row');
    const moved = parse(MOVED_ROW);
    expect(describeChange(moved, moved.marks[0]!)).toBe('Moved row');
    const { editor } = mount(DELETED_ROW);
    editor.setViewMode('redlines');
    await clickOn(editor, '.rl-ghost');
    expect(what(editor)).toBe('Deleted row');
    const again = mount(MOVED_ROW);
    again.editor.setViewMode('redlines');
    await clickOn(again.editor, '.rl-ghost');
    expect(what(again.editor)).toBe('Moved row');
  });

  it('opens its card on a click on the row, and Accept writes the plain row', async () => {
    const { editor, decided } = mount(ONE, { real: true });
    editor.setViewMode('redlines');
    await clickOn(editor, '.rl-ins-row');
    expect(what(editor)).toBe('Inserted row');
    button(card(editor)!, 'Accept').click();
    expect(decided).toEqual([]);
    expect(editor.getDoc()).toContain('| Pears | 5 |');
    expect(editor.getDoc()).not.toContain('<!--ins');
  });

  it('Reject takes the row out', async () => {
    const { editor } = mount(ONE, { real: true });
    editor.setViewMode('redlines');
    await clickOn(editor, '.rl-ins-row');
    button(card(editor)!, 'Reject').click();
    expect(editor.getDoc()).not.toContain('Pears');
    expect(editor.getDoc()).toContain('| ----- | ----- |');
  });

  it('is listed in the review bar’s changes', () => {
    const { editor } = mount(ONE);
    expect(editor.getUiState().changes.map((change) => change.id)).toEqual(['k3x9']);
  });
});

describe('an inserted, deleted or moved table column', () => {
  const COLS = file(
    '| Fruit | <!--ins k3x9 col--> A | <!--ins m2bd col--> B |\n| ----- | - | - |\n| Apples |  |  |',
    [
      ...PEOPLE,
      'marks:',
      '  k3x9: {by: bo, at: 2026-10-31T09:30Z, group: g4tz}',
      '  m2bd: {by: bo, at: 2026-10-31T09:30Z, group: g4tz}',
    ],
  );
  const ONE = file('| Fruit | <!--ins k3x9 col--> A |\n| ----- | - |\n| Apples |  |', [
    ...PEOPLE,
    'marks:',
    '  k3x9: {by: bo, at: 2026-10-31T09:30Z}',
  ]);
  const DELETED = file(
    '| Fruit | Price |\n| ----- | ----- |\n| Apples | 1 |\n\n<!--del g5nb col=2 Count\\n-\\-\\-\\n3-->',
    [...PEOPLE, 'marks:', '  g5nb: {by: bo, at: 2026-10-31T09:30Z}'],
  );
  const MOVED = file(
    '| Price | <!--ins h6nb col--> Fruit |\n| ----- | ----- |\n| 1 | Apples |\n\n<!--del j7nb col=1 Fruit\\n-\\-\\-\\nApples-->',
    [
      ...PEOPLE,
      'marks:',
      '  h6nb: {by: bo, at: 2026-10-31T09:30Z, move: j7nb}',
      '  j7nb: {by: bo, at: 2026-10-31T09:30Z, move: h6nb}',
    ],
  );

  it('is described as Inserted column, Inserted 2 columns, Deleted column and Moved column', async () => {
    const cols = parse(COLS);
    expect(describeChange(cols, cols.marks[0]!)).toBe('Inserted column');
    expect(describeChanges(cols, cols.marks)).toBe('Inserted 2 columns');
    const deleted = parse(DELETED);
    expect(describeChange(deleted, deleted.marks[0]!)).toBe('Deleted column');
    const moved = parse(MOVED);
    expect(describeChange(moved, moved.marks[0]!)).toBe('Moved column');
    const { editor } = mount(COLS);
    editor.setViewMode('redlines');
    await clickOn(editor, '.rl-ins-col');
    expect(what(editor)).toBe('Inserted 2 columns');
    const ghost = mount(DELETED);
    ghost.editor.setViewMode('redlines');
    await clickOn(ghost.editor, '.rl-ghost-col');
    expect(what(ghost.editor)).toBe('Deleted column');
    const again = mount(MOVED);
    again.editor.setViewMode('redlines');
    await clickOn(again.editor, '.rl-ghost-col');
    expect(what(again.editor)).toBe('Moved column');
  });

  it('Accept writes the plain column, and Reject takes it out', async () => {
    const { editor } = mount(ONE, { real: true });
    editor.setViewMode('redlines');
    await clickOn(editor, '.rl-ins-col');
    button(card(editor)!, 'Accept').click();
    expect(editor.getDoc()).toContain('| Fruit | A |');
    expect(editor.getDoc()).not.toContain('<!--ins');
    const rejecting = mount(ONE, { real: true });
    rejecting.editor.setViewMode('redlines');
    await clickOn(rejecting.editor, '.rl-ins-col');
    button(card(rejecting.editor)!, 'Reject').click();
    expect(rejecting.editor.getDoc()).not.toContain('| A |');
    expect(rejecting.editor.getDoc()).toContain('| Fruit |');
  });

  it('is listed in the review bar’s changes, a move once', () => {
    expect(
      mount(ONE)
        .editor.getUiState()
        .changes.map((change) => change.id),
    ).toEqual(['k3x9']);
    expect(
      mount(MOVED)
        .editor.getUiState()
        .changes.map((change) => change.id),
    ).toEqual(['h6nb']);
    expect(
      mount(DELETED)
        .editor.getUiState()
        .changes.map((change) => change.id),
    ).toEqual(['g5nb']);
  });
});

describe('an alignment change of a table', () => {
  const SPEC = '\\|\\x20-\\-\\-\\-\\-\\x20\\|\\x20-\\-\\-\\-\\-\\x20\\|';
  const CENTERED = file(
    `<!--fmt k3x9 align=${SPEC}-->\n\n| Fruit | Count |\n| ----- | :---: |\n| Apples | 3 |\n\n<!--/k3x9-->`,
    [...PEOPLE, 'marks:', '  k3x9: {by: bo, at: 2026-10-31T09:30Z}'],
  );

  it('is described by the column it changed, as Word describes a format change', () => {
    const parsed = parse(CENTERED);
    expect(describeChange(parsed, parsed.marks[0]!)).toBe(
      'Formatted: column Count centered (was default)',
    );
  });

  it('opens its card on a click on the underlined header text, and not on the rest of the table', async () => {
    const { editor } = mount(CENTERED);
    editor.setViewMode('redlines');
    await clickOn(editor, '.rl-fmt');
    expect(what(editor)).toBe('Formatted: column Count centered (was default)');
  });

  it('Accept keeps the new alignment and Reject writes the old row back', async () => {
    const { editor } = mount(CENTERED, { real: true });
    editor.setViewMode('redlines');
    await clickOn(editor, '.rl-fmt');
    button(card(editor)!, 'Accept').click();
    expect(editor.getDoc()).toContain('| ----- | :---: |');
    expect(editor.getDoc()).not.toContain('<!--');
    const rejecting = mount(CENTERED, { real: true });
    rejecting.editor.setViewMode('redlines');
    await clickOn(rejecting.editor, '.rl-fmt');
    button(card(rejecting.editor)!, 'Reject').click();
    expect(rejecting.editor.getDoc()).toContain('| ----- | ----- |');
    expect(rejecting.editor.getDoc()).not.toContain('<!--');
  });

  it('is listed once in the review bar’s changes', () => {
    expect(
      mount(CENTERED)
        .editor.getUiState()
        .changes.map((change) => change.id),
    ).toEqual(['k3x9']);
  });
});
