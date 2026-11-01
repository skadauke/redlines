// @vitest-environment happy-dom
import type { Editor } from '@redlines/editor';
import { parse } from '@redlines/format';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { describeChange } from './cards.ts';
import { notesIn, stack } from './rail.ts';
import {
  button,
  file,
  frame,
  me,
  mount,
  PEOPLE,
  press,
  REFUSAL,
  stubHeights,
  stubWidth,
  thread,
  tick,
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
    const restore = stubHeights({ 'rl-note': 60 });
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

  it('stacked notes sit 8px apart, and stay put when one is selected', async () => {
    // A note's actions sit in its head, so showing them doesn't make it taller.
    const restore = stubHeights({ 'rl-note': 60, 'rl-note-actions': 22 });
    try {
      const { editor } = mount(threads);
      await frame();
      const [first, second] = notes(editor);
      expect(top(second!)).toBe(top(first!) + 60 + 8);
      first!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      await frame();
      expect(top(second!)).toBe(top(first!) + 60 + 8);
    } finally {
      restore();
    }
  });

  it("a note's actions are icons in its head, explained on hover", () => {
    const { editor } = mount(threads);
    const [first] = notes(editor);
    const head = first!.querySelector('.rl-note-head')!;
    const actions = [...head.querySelectorAll<HTMLButtonElement>('.rl-note-actions button')];
    expect(actions.map((action) => action.getAttribute('aria-label'))).toEqual([
      'Reply',
      'Resolve',
    ]);
    expect(actions.every((action) => action.querySelector('svg'))).toBe(true);
    expect(actions.map((action) => action.querySelector('.rl-hint')?.textContent)).toEqual([
      'Reply',
      'Resolve',
    ]);
    // Only the first entry's head holds them, not a reply's.
    expect(first!.querySelectorAll('.rl-note-actions')).toHaveLength(1);
  });

  it('a note gives the day of a change from an earlier day, and the full time on hover', () => {
    // Two weeks after the comment, in any time zone: the note gives its day, without the year.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-14T12:00:00Z'));
    try {
      const { editor } = mount(threads);
      const time = notes(editor)[0]!.querySelector('time')!;
      expect(time.dateTime).toBe('2026-10-31T09:41Z');
      const day = new Date('2026-10-31T09:41Z').toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
      });
      expect(time.textContent).toBe(day);
      expect(time.title).toContain(day);
      expect(time.title.length).toBeGreaterThan(day.length);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a note gives the time of day of a change from today', () => {
    // Nine minutes after the comment: the same day in every time zone.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-31T09:50:00Z'));
    try {
      const { editor } = mount(threads);
      const time = notes(editor)[0]!.querySelector('time')!;
      const shown = new Date('2026-10-31T09:41Z').toLocaleTimeString(undefined, {
        hour: 'numeric',
        minute: '2-digit',
      });
      expect(time.textContent).toBe(shown);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a note's text can be selected; its controls keep the keyboard in the document", () => {
    const { editor } = mount(threads);
    const [first] = notes(editor);
    const text = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    first!.querySelector('.rl-note-text')!.dispatchEvent(text);
    expect(text.defaultPrevented).toBe(false);
    expect(first!.classList).toContain('rl-note-selected');
    const control = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    button(first!, 'Resolve').dispatchEvent(control);
    expect(control.defaultPrevented).toBe(true);
  });

  it('selecting a note outlines it in the author color', () => {
    const { editor } = mount(threads);
    const [first, second] = notes(editor);
    first!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    // Bo's handle leads to the third color.
    expect(first!.classList).toContain('rl-note-selected');
    expect(first!.classList).toContain('rl-author-3');
    expect(second!.classList).not.toContain('rl-note-selected');
    // Its anchor is tinted more strongly.
    const anchor = editor.view.contentDOM.querySelector('.rl-anchor');
    expect(anchor?.textContent).toBe('importer');
    expect(anchor?.classList).toContain('rl-author-3');

    // Putting the cursor in the other anchor selects the other note.
    const april = editor.view.state.doc.toString().indexOf('April') + 2;
    editor.view.dispatch({ selection: { anchor: april } });
    expect(first!.classList).not.toContain('rl-note-selected');
    expect(second!.classList).toContain('rl-note-selected');
    expect(editor.view.contentDOM.querySelector('.rl-anchor')?.textContent).toBe('April');
  });

  it('keeps an author’s color, in the note and the text, when changes are decided', () => {
    const doc = file(
      'The <!--ins k3x9-->new<!--/k3x9--> <!--sub p7qd old-->importer<!--/p7qd--> ships in ' +
        '<!--cmt c3fm-->April<!--/c3fm-->.',
      [
        ...PEOPLE,
        'marks:',
        '  k3x9: {by: ada, at: 2026-10-31T09:30Z}',
        '  p7qd: {by: claude-ada, at: 2026-10-31T09:31Z}',
        'comments:',
        ...thread('c3fm', 'bo', 'Or May?'),
      ],
    );
    const { editor } = mount(doc);
    const colorOf = (el: Element | null | undefined) =>
      [...(el?.classList ?? [])].find((name) => name.startsWith('rl-author-'));
    const note = () => notes(editor)[0];
    const tint = () => editor.view.contentDOM.querySelector('.rl-cmt');
    const bo = colorOf(note());
    expect(colorOf(tint())).toBe(bo);
    // The changes before Bo's comment go.
    editor.accept('k3x9');
    editor.reject('p7qd');
    expect(colorOf(note())).toBe(bo);
    expect(colorOf(tint())).toBe(bo);
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
    // An agent acts for a person, named by their first name.
    expect(note!.querySelector('.rl-note-for')?.textContent).toBe('for Ada');
    // What the change did, the old text struck through, and then why.
    const change = note!.querySelector('.rl-note-change');
    expect(change?.textContent).toBe('stays → goes');
    expect(change?.querySelector('.rl-note-old')?.textContent).toBe('stays');
    expect(texts(note!)).toEqual(['Matches the roadmap']);
    button(note!, 'Accept').click();
    expect(decided).toEqual([{ id: 'p7qd', how: 'accept' }]);
    expect(notes(editor)).toHaveLength(0);
  });

  it('a note shows an insertion as its text and a deletion struck through', () => {
    const doc = file('A <!--ins k3x9-->new<!--/k3x9--> plan.<!--del w2rf  Old words.-->', [
      ...PEOPLE,
      'marks:',
      '  k3x9: {by: bo, at: 2026-10-31T09:30Z, note: Clearer}',
      '  w2rf: {by: bo, at: 2026-10-31T09:31Z, note: Not needed}',
    ]);
    const { editor } = mount(doc);
    const changes = notes(editor).map((note) => note.querySelector('.rl-note-change')!);
    expect(changes.map((change) => change.textContent)).toEqual(['new', 'Old words.']);
    expect(changes[0]!.querySelector('.rl-note-old')).toBeNull();
    expect(changes[1]!.querySelector('.rl-note-old')?.textContent).toBe('Old words.');
  });

  it('a note shows a change of white space as its card does', () => {
    const doc = file('One<!--sub p7qd   -->c<!--/p7qd-->two.', [
      ...PEOPLE,
      'marks:',
      '  p7qd: {by: claude-ada, at: 2026-10-31T09:31Z, note: Tighter}',
    ]);
    const { editor } = mount(doc);
    const change = notes(editor)[0]!.querySelector('.rl-note-change');
    expect(change?.querySelector('.rl-note-old')?.textContent).toBe('··');
    expect(change?.textContent).toBe('·· → c');
    const parsed = parse(doc);
    expect(describeChange(parsed, parsed.marks[0]!)).toBe('Replaced “··” with “c”');
  });

  it('a refused decision changes nothing and says why', () => {
    const { editor } = mount(reasons, { refuse: true });
    const before = editor.getDoc();
    const [note] = notes(editor);
    button(note!, 'Accept').click();
    expect(editor.getDoc()).toBe(before);
    const error = note!.querySelector<HTMLElement>('.rl-note-error');
    expect(error?.hidden).toBe(false);
    expect(error?.textContent).toBe(REFUSAL);
  });

  it('a narrow editor shrinks the rail to dots', async () => {
    const { editor } = mount(threads);
    const rail = editor.view.dom.querySelector<HTMLElement>('.rl-rail')!;
    stubWidth(editor.view.scrollDOM, 800);
    await frame();
    // The column has its whole width back.
    await tick();
    expect(editor.view.dom.classList).not.toContain('rl-has-rail');
    expect(rail.classList).toContain('rl-rail-compact');
    const dots = [...rail.querySelectorAll<HTMLElement>('.rl-note-dot')];
    expect(dots.map((dot) => dot.getAttribute('aria-label'))).toEqual([
      'Note by Bo Chen',
      'Note by Ada Lovelace',
    ]);
    expect(dots[0]!.classList).toContain('rl-author-3');
    const [first, second] = notes(editor);
    expect(first!.classList).not.toContain('rl-note-open');

    // Hovering a dot shows its note, until the pointer leaves.
    dots[0]!.dispatchEvent(new MouseEvent('mouseenter'));
    expect(first!.classList).toContain('rl-note-open');
    dots[0]!.dispatchEvent(new MouseEvent('mouseleave'));
    await tick(250);
    expect(first!.classList).not.toContain('rl-note-open');

    // Clicking a dot keeps its note open, and selects it.
    dots[1]!.click();
    dots[1]!.dispatchEvent(new MouseEvent('mouseleave'));
    await tick(250);
    expect(second!.classList).toContain('rl-note-open');
    expect(second!.classList).toContain('rl-note-selected');
    expect(dots[1]!.classList).toContain('rl-note-dot-selected');
    // Until the selection moves.
    editor.view.dispatch({ selection: { anchor: 0 } });
    expect(second!.classList).not.toContain('rl-note-open');

    // A wide editor has the rail again.
    stubWidth(editor.view.scrollDOM, 1200);
    editor.view.dispatch({ selection: { anchor: 1 } });
    await frame();
    await tick();
    expect(editor.view.dom.classList).toContain('rl-has-rail');
    expect(rail.classList).not.toContain('rl-rail-compact');
  });

  it('notes come back after another document is opened', () => {
    const { editor } = mount(threads);
    editor.setDoc(reasons);
    expect(notes(editor)).toHaveLength(1);
    expect(editor.view.dom.classList).toContain('rl-has-rail');
    // Opened again and again, the rail stays one rail.
    editor.setDoc(threads);
    editor.setDoc(reasons);
    expect(editor.view.dom.querySelectorAll('.rl-rail')).toHaveLength(1);
    expect(notes(editor)).toHaveLength(1);
  });

  it('a comment on a whole block is level with its text', () => {
    // The opener stands on a line of its own before the block (format §3.3).
    const parsed = parse(
      file('Para.\n\n<!--cmt c9qf-->\n\nThe importer.<!--/c9qf-->', [
        'comments:',
        ...thread('c9qf', 'ada', 'Hm.'),
      ]),
    );
    const [note] = notesIn(parsed, []);
    const [range] = note!.ranges;
    expect(parsed.text.slice(range!.from, range!.to)).toBe('The importer.');
    expect(note!.pos).toBe(range!.from);
  });

  it('stack pushes each note below the one above it', () => {
    expect(stack([0, 0, 200], [50, 40, 10], 8)).toEqual([0, 58, 200]);
    expect(stack([10, 30], [100, 20], 8)).toEqual([10, 118]);
  });
});
