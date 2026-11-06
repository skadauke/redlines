// @vitest-environment happy-dom
import type { Editor } from '@redlines/editor';
import { parse } from '@redlines/format';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { describeChange } from './cards.ts';
import type { FieldAttachment, PostedComment } from './index.ts';
import { notesIn, stack } from './rail.ts';
import {
  button,
  click,
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
    expect(box.closest<HTMLElement>('.rl-note-box')?.hidden).toBe(true);
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

  it('a note names a format change, with its author', () => {
    const doc = file('A <!--fmt m2bd +bold-->**big**<!--/m2bd--> plan.', [
      ...PEOPLE,
      'marks:',
      '  m2bd: {by: bo, at: 2026-10-31T09:30Z, note: Stands out}',
    ]);
    const { editor, decided } = mount(doc);
    const [note] = notes(editor);
    expect(note!.querySelector('.rl-note-name')?.textContent).toBe('Bo Chen');
    expect(note!.querySelector('.rl-note-change')?.textContent).toBe('Bold');
    expect(note!.querySelector('.rl-note-old')).toBeNull();
    button(note!, 'Reject').click();
    expect(decided).toEqual([{ id: 'm2bd', how: 'reject' }]);
    expect(editor.getDoc()).toContain('A big plan.');
  });

  it('a note offers only Accept for a format change whose text has lost the format', () => {
    const doc = file('A <!--fmt m2bd +bold-->big<!--/m2bd--> plan.', [
      ...PEOPLE,
      'marks:',
      '  m2bd: {by: bo, at: 2026-10-31T09:30Z, note: Stands out}',
    ]);
    const { editor, decided } = mount(doc);
    const [note] = notes(editor);
    expect(() => button(note!, 'Reject')).toThrow('No button');
    button(note!, 'Accept').click();
    expect(decided).toEqual([{ id: 'm2bd', how: 'accept' }]);
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

  it('a note shows a substitution with no old text as an insertion, as its card does', () => {
    // The second part of a substitution that untracked typing split (format §3.10).
    const doc = file('a <!--sub p7qd old-->new<!--/p7qd-->X<!--sub w8nn--> words<!--/w8nn--> b', [
      ...PEOPLE,
      'marks:',
      '  p7qd: {by: bo, at: 2026-10-31T09:30Z, note: Clearer}',
      '  w8nn: {by: bo, at: 2026-10-31T09:30Z, note: Clearer}',
    ]);
    const { editor } = mount(doc);
    const changes = notes(editor).map((note) => note.querySelector('.rl-note-change')!);
    expect(changes.map((change) => change.textContent)).toEqual(['old → new', 'words']);
    expect(changes[1]!.querySelector('.rl-note-old')).toBeNull();
    const parsed = parse(doc);
    expect(describeChange(parsed, parsed.marks[1]!)).toBe('Inserted “words”');
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

  it('comes back from dots only with room to spare', async () => {
    const { editor } = mount(threads);
    const rail = editor.view.dom.querySelector<HTMLElement>('.rl-rail')!;
    let anchor = 0;
    const atWidth = async (width: number) => {
      stubWidth(editor.view.scrollDOM, width);
      editor.view.dispatch({ selection: { anchor: ++anchor } });
      await frame();
      await tick();
      return rail.classList.contains('rl-rail-compact');
    };
    expect(await atWidth(1000)).toBe(false);
    expect(await atWidth(999)).toBe(true);
    expect(await atWidth(1000)).toBe(true);
    expect(await atWidth(1023)).toBe(true);
    expect(await atWidth(1024)).toBe(false);
    expect(await atWidth(1000)).toBe(false);
  });

  it("doesn't go back and forth when showing the notes brings the page's scroll bar", async () => {
    const { editor } = mount(threads);
    const rail = editor.view.dom.querySelector<HTMLElement>('.rl-rail')!;
    const compact = () => rail.classList.contains('rl-rail-compact');
    // The notes make the page overflow, and its bar takes 15px. Shrunk to dots, it fits again.
    Object.defineProperty(editor.view.scrollDOM, 'offsetWidth', {
      configurable: true,
      get: () => (compact() ? 1005 : 990),
    });
    const seen: boolean[] = [];
    for (let anchor = 1; anchor <= 8; anchor++) {
      editor.view.dispatch({ selection: { anchor } });
      await frame();
      await tick();
      seen.push(compact());
    }
    expect(seen).toEqual(Array(8).fill(true));
  });

  it("goes by the editor's width, whatever its own scroll bar leaves of it", async () => {
    const { editor } = mount(threads);
    stubWidth(editor.view.scrollDOM, 1009);
    Object.defineProperty(editor.view.scrollDOM, 'clientWidth', { get: () => 994 });
    editor.view.dispatch({ selection: { anchor: 1 } });
    await frame();
    await tick();
    expect(editor.view.dom.classList).toContain('rl-has-rail');
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

/** A file with no comments, which opens Clean. */
const plain = file('The importer ships in April.', PEOPLE);

/** Where `word` is in the editor's text. */
const place = (editor: Editor, word: string) => {
  const from = editor.view.state.doc.toString().indexOf(word);
  expect(from).toBeGreaterThanOrEqual(0);
  return { from, to: from + word.length };
};
const select = (editor: Editor, word: string) => {
  const { from, to } = place(editor, word);
  editor.view.dispatch({ selection: { anchor: from, head: to } });
};
const caretIn = (editor: Editor, word: string) =>
  editor.view.dispatch({ selection: { anchor: place(editor, word).from + 2 } });

/** The box a comment is being written in, when one shows. */
const field = (editor: Editor) =>
  [...editor.view.dom.querySelectorAll<HTMLTextAreaElement>('.rl-note textarea')].find(
    (box) => !box.closest<HTMLElement>('.rl-note-box')?.hidden,
  );
const write = (box: HTMLTextAreaElement, text: string) => {
  box.value = text;
  box.dispatchEvent(new Event('input', { bubbles: true }));
};
/** Writes in the box that shows, and posts with ⌘↩. */
const post = (editor: Editor, text: string) => {
  const box = field(editor)!;
  write(box, text);
  press(box, 'Enter', { metaKey: true });
};
/** A press of a shortcut in the document, where `Mod` is ⌘ on a Mac and Ctrl elsewhere. */
const shortcut = (editor: Editor, key: string, init: KeyboardEventInit = {}) => {
  const mac = /Mac/.test(navigator.platform);
  press(editor.view.contentDOM, key, { ctrlKey: !mac, metaKey: mac, ...init });
};
const thisOne = (editor: Editor) => editor.getParsed().ledger.comments.at(-1)!;

describe('a new comment', () => {
  it('opens a box level with the selection and posts a comment on it', async () => {
    const { editor, review } = mount(plain);
    select(editor, 'importer');
    const { from } = place(editor, 'importer');
    vi.spyOn(editor.view, 'coordsAtPos').mockImplementation((pos) => ({
      left: 0,
      right: 0,
      top: pos * 10,
      bottom: pos * 10 + 20,
    }));

    expect(review.startComment()).toBe(true);
    const box = field(editor)!;
    expect(box).toBeDefined();
    expect(document.activeElement).toBe(box);
    expect(box.getAttribute('aria-label')).toBe('Comment');
    await frame();
    // Its first line is level with the selection's, as a posted note's is with its anchor's.
    const [note] = notes(editor);
    expect(top(note!)).toBe(from * 10 - 5);
    expect(note!.querySelector('.rl-note-name')?.textContent).toBe(me.name);
    // The anchor is tinted while it is written, and nothing is in the file yet.
    expect(editor.view.contentDOM.querySelector('.rl-anchor')?.textContent).toBe('importer');
    expect(editor.getDoc()).toBe(plain);

    post(editor, ' Which importer? ');
    const thread = thisOne(editor);
    expect(thread).toMatchObject({ by: me.handle, text: 'Which importer?', quote: 'importer' });
    expect(thread.at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\dZ$/);
    expect(editor.getDoc()).toContain(`The <!--cmt ${thread.id}-->importer<!--/${thread.id}--> `);
    // The note shows it, selected, and the box is gone.
    const shown = notes(editor);
    expect(shown).toHaveLength(1);
    expect(texts(shown[0]!)).toEqual(['Which importer?']);
    expect(shown[0]!.classList).toContain('rl-note-selected');
    expect(field(editor)).toBeUndefined();
  });

  it('comments on the word under the caret with no selection', () => {
    const { editor, review } = mount(plain);
    caretIn(editor, 'importer');
    review.startComment();
    expect(editor.view.contentDOM.querySelector('.rl-anchor')?.textContent).toBe('importer');
    post(editor, 'Which?');
    const { id, quote } = thisOne(editor);
    expect(quote).toBe('importer');
    expect(editor.getDoc()).toContain(`<!--cmt ${id}-->importer<!--/${id}-->`);
  });

  it('comments on the point with no word under the caret', () => {
    const { editor, review } = mount(file('One.  Two.', PEOPLE));
    editor.view.dispatch({ selection: { anchor: 'One. '.length } });
    review.startComment();
    post(editor, 'Here.');
    const { id, quote } = thisOne(editor);
    expect(quote).toBeUndefined();
    expect(editor.getDoc()).toContain(`One. <!--cmt ${id}--> Two.`);
    expect(texts(notes(editor)[0]!)).toEqual(['Here.']);
  });

  it('calls onPosted for a new comment and a reply, with the thread and text', () => {
    const posted: PostedComment[] = [];
    const { editor, review } = mount(threads, {
      review: { onPosted: (comment) => posted.push(comment) },
    });
    select(editor, 'More');
    review.startComment();
    post(editor, ' Why more? ');
    const { id } = thisOne(editor);
    expect(posted).toEqual([{ thread: id, text: 'Why more?' }]);
    // It is in the file by then.
    expect(id).not.toBe('c2dk');

    button(notes(editor)[0]!, 'Reply').click();
    post(editor, 'Thanks.');
    expect(posted[1]).toEqual({ thread: 'c2dk', text: 'Thanks.' });
    expect(posted).toHaveLength(2);
  });

  it('tells onPosted when the comment is in the file and the box is closed', () => {
    let seen: { doc: string; box: boolean } | undefined;
    const { editor, review } = mount(plain, {
      review: { onPosted: () => (seen = { doc: editor.getDoc(), box: !!field(editor) }) },
    });
    select(editor, 'importer');
    review.startComment();
    post(editor, 'Which?');
    expect(seen?.doc).toContain('<!--cmt ');
    expect(seen?.box).toBe(false);
  });

  it('does not call onPosted on reload, undo or setDoc', () => {
    const posted: PostedComment[] = [];
    const { editor, review } = mount(plain, {
      review: { onPosted: (comment) => posted.push(comment) },
    });
    select(editor, 'importer');
    review.startComment();
    post(editor, '@Claude which?');
    expect(posted).toHaveLength(1);
    const written = editor.getDoc();

    // Undo and redo.
    shortcut(editor, 'z');
    expect(editor.getDoc()).toBe(plain);
    shortcut(editor, 'z', { shiftKey: true });
    expect(editor.getDoc()).toBe(written);
    // A comment that arrives with a new version of the file, or in another one.
    editor.reloadDoc(threads);
    expect(notes(editor)).toHaveLength(2);
    editor.setDoc(written);
    expect(notes(editor)).toHaveLength(1);
    expect(posted).toHaveLength(1);
  });

  it('keeps the draft and shows why when addComment refuses', () => {
    const posted: PostedComment[] = [];
    const doc = file('Run\n\n```\nthe importer\n```\n\nnow.', PEOPLE);
    const { editor, review } = mount(doc, {
      review: { onPosted: (comment) => posted.push(comment) },
    });
    select(editor, 'importer');
    review.startComment();
    post(editor, 'Which?');
    expect(editor.getDoc()).toBe(doc);
    expect(posted).toEqual([]);
    const box = field(editor)!;
    expect(box.value).toBe('Which?');
    const error = box.closest('.rl-note-box')!.querySelector<HTMLElement>('.rl-note-error')!;
    expect(error.hidden).toBe(false);
    expect(error.textContent).toBe('To comment on code, select all of it.');
    // Typing again puts the message away.
    write(box, 'Which one?');
    expect(error.hidden).toBe(true);
  });

  it('scrolls to why it was refused, which can be past the foot of the window', async () => {
    const doc = file('Run `the importer` now.', PEOPLE);
    const { editor, review } = mount(doc);
    select(editor, 'importer');
    review.startComment();
    await frame();
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {});
    try {
      post(editor, 'Which?');
      await frame();
      expect(editor.getDoc()).toBe(doc);
      // The row under the message, so that the message and the buttons both show.
      expect(scroll).toHaveBeenCalledOnce();
      expect(scroll.mock.contexts[0]).toBe(
        field(editor)!.closest('.rl-note')!.querySelector('.rl-note-box-row'),
      );
    } finally {
      scroll.mockRestore();
    }
  });

  it('moves a refused draft to the new selection, and keeps its text', () => {
    const doc = file('Run `the importer` now.', PEOPLE);
    const { editor, review } = mount(doc);
    caretIn(editor, 'importer');
    review.startComment();
    post(editor, 'Which?');
    expect(editor.getDoc()).toBe(doc);
    const box = field(editor)!;
    const error = box.closest('.rl-note-box')!.querySelector<HTMLElement>('.rl-note-error')!;
    expect(error.hidden).toBe(false);

    // As the message says: the whole span.
    select(editor, '`the importer`');
    expect(review.startComment()).toBe(true);
    expect(field(editor)).toBe(box);
    expect(box.value).toBe('Which?');
    expect(error.hidden).toBe(true);
    press(box, 'Enter', { metaKey: true });
    const { id, text } = thisOne(editor);
    expect(text).toBe('Which?');
    expect(editor.getDoc()).toContain(`Run <!--cmt ${id}-->\`the importer\`<!--/${id}--> now.`);
    expect(field(editor)).toBeUndefined();
  });

  it('moves a draft refused on a line of syntax, however much was typed since', () => {
    const { editor, review } = mount(file('One.\n\n---\n\nTwo.', PEOPLE));
    editor.view.dispatch({ selection: { anchor: 'One.\n\n-'.length } });
    review.startComment();
    post(editor, 'A rule?');
    const box = field(editor)!;
    const error = box.closest('.rl-note-box')!.querySelector<HTMLElement>('.rl-note-error')!;
    expect(error.textContent).toBe('Select other text to comment on.');
    write(box, 'A rule? Really?');
    select(editor, 'Two');
    review.startComment();
    press(box, 'Enter', { metaKey: true });
    expect(thisOne(editor)).toMatchObject({ quote: 'Two', text: 'A rule? Really?' });
  });

  it('keeps a draft that was not refused where it is', () => {
    const { editor, review } = mount(plain);
    select(editor, 'importer');
    review.startComment();
    write(field(editor)!, 'Which?');
    select(editor, 'April');
    review.startComment();
    expect(editor.view.contentDOM.querySelector('.rl-anchor')?.textContent).toBe('importer');
  });

  it('says why in one line, in words for a comment', () => {
    const refusal = (doc: string, word: string) => {
      const { editor, review } = mount(doc);
      select(editor, word);
      review.startComment();
      post(editor, 'Hm.');
      const box = field(editor)!.closest('.rl-note-box')!;
      return box.querySelector<HTMLElement>('.rl-note-error')!.textContent;
    };
    expect(refusal('Run `the importer` now.', 'importer')).toBe(
      'To comment on code, select all of it.',
    );
    expect(refusal('---\ntitle: Plan\n---\n\nText.', 'Plan')).toBe(
      "Comments can't go in front matter yet.",
    );
  });

  it('finds the word past a hidden marker', () => {
    const doc = file('The <!--cmt c2dk-->importer<!--/c2dk--> ships.', [
      ...PEOPLE,
      'comments:',
      ...thread('c2dk', 'bo', 'Which?'),
    ]);
    // Left of the opener, and right of the closer: on screen, at either end of the word.
    for (const marker of ['<!--cmt c2dk-->', '<!--/c2dk-->']) {
      const { editor, review } = mount(doc);
      const { from, to } = place(editor, marker);
      const caret = marker.startsWith('<!--cmt') ? from : to;
      editor.view.dispatch({ selection: { anchor: caret } });
      review.startComment();
      post(editor, 'This one.');
      expect(thisOne(editor).quote).toBe('importer');
    }
  });

  it('takes no comment in Raw, and says so', () => {
    const { editor, review, notices } = mount(plain);
    editor.setViewMode('raw');
    select(editor, 'importer');
    expect(review.startComment()).toBe(false);
    expect(field(editor)).toBeUndefined();
    expect(editor.getDoc()).toBe(plain);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain('Raw');
    expect(editor.getUiState().view).toBe('raw');
  });

  it('switches a document shown Clean to Redlines', () => {
    const { editor, review } = mount(plain);
    expect(editor.getUiState().view).toBe('clean');
    select(editor, 'importer');
    expect(review.startComment()).toBe(true);
    expect(editor.getUiState().view).toBe('redlines');
    expect(field(editor)).toBeDefined();
    // The column makes room for the note.
    expect(editor.view.dom.classList).toContain('rl-has-rail');
  });

  it('Escape closes the box and writes nothing', () => {
    const posted: PostedComment[] = [];
    const { editor, review } = mount(plain, {
      review: { onPosted: (comment) => posted.push(comment) },
    });
    select(editor, 'importer');
    review.startComment();
    const box = field(editor)!;
    write(box, 'Never mind.');
    press(box, 'Escape');
    expect(field(editor)).toBeUndefined();
    expect(notes(editor)).toHaveLength(0);
    expect(editor.getDoc()).toBe(plain);
    expect(posted).toEqual([]);
    expect(editor.view.contentDOM.querySelector('.rl-anchor')).toBeNull();
    expect(editor.view.dom.classList).not.toContain('rl-has-rail');
  });

  it('brings back what Escape set aside, on that anchor', () => {
    const { editor, review } = mount(plain);
    select(editor, 'importer');
    review.startComment();
    write(field(editor)!, 'Which one?');
    press(field(editor)!, 'Escape');

    // Started again on the same selection.
    review.startComment();
    const box = field(editor)!;
    expect(box.value).toBe('Which one?');
    expect(button(notes(editor)[0]!, 'Post').disabled).toBe(false);
    expect(editor.view.contentDOM.querySelector('.rl-anchor')?.textContent).toBe('importer');

    // Once more, from a caret in it, with the text around it edited in between.
    press(box, 'Escape');
    editor.view.dispatch({ changes: { from: 0, insert: 'So: ' } });
    caretIn(editor, 'importer');
    review.startComment();
    expect(field(editor)!.value).toBe('Which one?');
    post(editor, 'Which one, then?');
    expect(thisOne(editor).quote).toBe('importer');
    // Posted, it is gone.
    select(editor, 'importer');
    review.startComment();
    expect(field(editor)!.value).toBe('');
  });

  it('keeps what Escape set aside for its anchor while another comment is written', () => {
    const { editor, review } = mount(plain);
    select(editor, 'importer');
    review.startComment();
    write(field(editor)!, 'Which one?');
    press(field(editor)!, 'Escape');

    select(editor, 'April');
    review.startComment();
    expect(field(editor)!.value).toBe('');
    expect(editor.view.contentDOM.querySelector('.rl-anchor')?.textContent).toBe('April');
    post(editor, 'Or May?');

    select(editor, 'importer');
    review.startComment();
    expect(field(editor)!.value).toBe('Which one?');
  });

  it('sets nothing aside for an empty box', () => {
    const { editor, review } = mount(plain);
    select(editor, 'importer');
    review.startComment();
    write(field(editor)!, 'Which one?');
    press(field(editor)!, 'Escape');
    select(editor, 'April');
    review.startComment();
    press(field(editor)!, 'Escape');
    // What Escape set aside on the other anchor is still there.
    select(editor, 'importer');
    review.startComment();
    expect(field(editor)!.value).toBe('Which one?');
  });

  it('goes with its document when it was set aside', () => {
    const { editor, review } = mount(plain);
    select(editor, 'importer');
    review.startComment();
    write(field(editor)!, 'Which one?');
    press(field(editor)!, 'Escape');
    editor.setDoc(plain);
    select(editor, 'importer');
    review.startComment();
    expect(field(editor)!.value).toBe('');
  });

  it('knows when a comment or a reply has text, shown or not', () => {
    const { editor, review } = mount(threads);
    expect(review.hasDraft()).toBe(false);
    select(editor, 'More');
    review.startComment();
    expect(review.hasDraft()).toBe(false);
    write(field(editor)!, 'Which?');
    expect(review.hasDraft()).toBe(true);
    // Set aside with Escape, it is still a comment not posted.
    press(field(editor)!, 'Escape');
    expect(review.hasDraft()).toBe(true);
    // Until it is started again and cleared, or posted.
    review.startComment();
    expect(review.hasDraft()).toBe(true);
    press(field(editor)!, 'Escape');
    editor.setDoc(threads);
    expect(review.hasDraft()).toBe(false);
    button(notes(editor)[0]!, 'Reply').click();
    write(field(editor)!, 'This one.');
    expect(review.hasDraft()).toBe(true);
  });

  describe('through a reload', () => {
    const line = (text: string) => file(text, PEOPLE);
    const notice = (editor: Editor) =>
      editor.view.dom.querySelector<HTMLElement>('.rl-note-notice:not([hidden])');

    it('keeps the anchor when text on both sides of it changed in its line', () => {
      const { editor, review } = mount(line('Alpha beta importer gamma delta.'));
      select(editor, 'importer');
      review.startComment();
      write(field(editor)!, 'Which one?');
      editor.reloadDoc(line('Alpha BETA importer gamma DELTA.'));
      expect(editor.view.contentDOM.querySelector('.rl-anchor')?.textContent).toBe('importer');
      expect(field(editor)!.value).toBe('Which one?');
      expect(notice(editor)).toBeNull();
      post(editor, 'Which one?');
      expect(thisOne(editor).quote).toBe('importer');
      expect(editor.getDoc()).toContain('BETA <!--cmt');
    });

    it('keeps the anchor when several places around it changed', () => {
      const { editor, review } = mount(line('one two importer three four five.'));
      select(editor, 'importer');
      review.startComment();
      editor.reloadDoc(line('ONE two importer THREE four FIVE.'));
      expect(editor.view.contentDOM.querySelector('.rl-anchor')?.textContent).toBe('importer');
      post(editor, 'Which?');
      expect(thisOne(editor).quote).toBe('importer');
    });

    it('says so rather than follow a repeated word to another place', () => {
      const { editor, review } = mount(
        line('Intro. The importer reads files. The importer writes logs. End.'),
      );
      const at = editor.view.state.doc.toString().indexOf('importer', 20);
      editor.view.dispatch({ selection: { anchor: at, head: at + 8 } });
      review.startComment();
      editor.reloadDoc(line('Intro. The importer writes logs. The importer checks names. End.'));
      expect(notice(editor)).not.toBeNull();
    });

    it('keeps an anchor with a draft set aside by Escape', () => {
      const { editor, review } = mount(line('Alpha beta importer gamma delta.'));
      select(editor, 'importer');
      review.startComment();
      write(field(editor)!, 'Which one?');
      press(field(editor)!, 'Escape');
      editor.reloadDoc(line('Alpha BETA importer gamma DELTA.'));
      select(editor, 'importer');
      review.startComment();
      expect(field(editor)!.value).toBe('Which one?');
      expect(notice(editor)).toBeNull();
    });

    it('shows the message when the restored draft is not moved', () => {
      const { editor, review } = mount(line('Alpha beta importer gamma delta.'));
      select(editor, 'importer');
      review.startComment();
      write(field(editor)!, 'Which one?');
      press(field(editor)!, 'Escape');
      editor.reloadDoc(line('Alpha BETA exporter gamma DELTA.'));
      // The selection followed the changed stretch to a point; a caret inside the aside's span.
      const doc = editor.view.state.doc.toString();
      const mid = doc.indexOf('exporter');
      editor.view.dispatch({ selection: { anchor: mid } });
      review.startComment();
      expect(field(editor)!.value).toBe('Which one?');
      expect(notice(editor)).not.toBeNull();
    });

    it('writes the message once, not at every keystroke', () => {
      const { editor, review } = mount(line('Alpha beta importer gamma delta.'));
      select(editor, 'importer');
      review.startComment();
      editor.reloadDoc(line('Alpha BETA exporter gamma DELTA.'));
      const el = notice(editor)!;
      const watch = new MutationObserver(() => {});
      watch.observe(el, { childList: true, characterData: true, subtree: true, attributes: true });
      write(field(editor)!, 'a');
      write(field(editor)!, 'ab');
      editor.view.dispatch({ selection: { anchor: 1 } });
      expect(watch.takeRecords()).toEqual([]);
    });

    it('keeps the draft and says so when the anchored text changed', () => {
      const { editor, review } = mount(line('Alpha beta importer gamma delta.'));
      select(editor, 'importer');
      review.startComment();
      write(field(editor)!, 'Which one?');
      editor.reloadDoc(line('Alpha BETA exporter gamma DELTA.'));
      expect(field(editor)!.value).toBe('Which one?');
      expect(notice(editor)?.textContent).toMatch(/changed/);
      expect(button(notes(editor)[0]!, 'Post').disabled).toBe(false);
    });

    it('says so when the anchored text only grew', () => {
      const { editor, review } = mount(line('Alpha beta importer gamma delta.'));
      select(editor, 'importer');
      review.startComment();
      write(field(editor)!, 'Which one?');
      editor.reloadDoc(line('Alpha BETA importers gamma DELTA.'));
      expect(notice(editor)).not.toBeNull();
      expect(field(editor)!.value).toBe('Which one?');
    });

    it('does not move to the same words elsewhere when the anchored text changed', () => {
      const { editor, review } = mount(line('importer one. Alpha importer gamma.'));
      const at = editor.view.state.doc.toString().indexOf('importer', 5);
      editor.view.dispatch({ selection: { anchor: at, head: at + 8 } });
      review.startComment();
      editor.reloadDoc(line('importer ONE. Alpha exporter GAMMA.'));
      expect(notice(editor)).not.toBeNull();
      const tinted = editor.view.contentDOM.querySelector('.rl-anchor')?.textContent;
      expect(tinted === undefined || tinted !== 'importer').toBe(true);
    });

    it('lets the person post it where it now fits, or pick new text', () => {
      const { editor, review } = mount(line('Alpha beta importer gamma delta.'));
      select(editor, 'importer');
      review.startComment();
      write(field(editor)!, 'Which one?');
      editor.reloadDoc(line('Alpha BETA exporter gamma DELTA.'));
      // New text: the draft moves to it, and the message goes.
      select(editor, 'gamma');
      review.startComment();
      expect(field(editor)!.value).toBe('Which one?');
      expect(notice(editor)).toBeNull();
      expect(editor.view.contentDOM.querySelector('.rl-anchor')?.textContent).toBe('gamma');
      post(editor, 'Which one?');
      expect(thisOne(editor).quote).toBe('gamma');
    });

    it('posts a changed anchor where it now best fits', () => {
      const { editor, review } = mount(line('Alpha beta importer gamma delta.'));
      select(editor, 'importer');
      review.startComment();
      editor.reloadDoc(line('Alpha BETA exporter gamma DELTA.'));
      // The changed stretch is what the comment is on, and it is tinted while it is written.
      expect(editor.view.contentDOM.querySelector('.rl-anchor')?.textContent).toBe(
        'BETA exporter gamma DELTA',
      );
      post(editor, 'Still here.');
      expect(thisOne(editor).text).toBe('Still here.');
      expect(thisOne(editor).quote).toBe('BETA exporter gamma DELTA');
    });

    it('keeps an unchanged anchor when the reload touches another line', () => {
      const { editor, review } = mount(line('Top.\n\nAlpha importer beta.'));
      select(editor, 'importer');
      review.startComment();
      editor.reloadDoc(line('New top line.\n\nAlpha importer beta.'));
      expect(editor.view.contentDOM.querySelector('.rl-anchor')?.textContent).toBe('importer');
      expect(notice(editor)).toBeNull();
    });
  });

  it('keeps an open reply box and its text through a reload that changes its line', () => {
    const doc = file('Alpha beta <!--cmt c2dk-->importer<!--/c2dk--> gamma delta.', [
      ...PEOPLE,
      'comments:',
      ...thread('c2dk', 'bo', 'Which importer?'),
    ]);
    const { editor } = mount(doc);
    button(notes(editor)[0]!, 'Reply').click();
    write(field(editor)!, 'This one.');
    editor.reloadDoc(doc.replace('beta', 'BETA').replace('delta', 'DELTA'));
    // A reply's box belongs to its thread, whose anchor is marks in the text: no position maps.
    expect(field(editor)?.value).toBe('This one.');
    expect(editor.getParsed().ledger.comments[0]?.id).toBe('c2dk');
  });

  it('Escape does nothing during IME composition', () => {
    const { editor, review } = mount(threads);
    select(editor, 'More');
    review.startComment();
    const box = field(editor)!;
    write(box, 'に');
    press(box, 'Escape', { isComposing: true });
    expect(field(editor)).toBe(box);
    expect(box.value).toBe('に');
    // In a reply's box too.
    press(box, 'Escape');
    button(notes(editor)[0]!, 'Reply').click();
    const reply = field(editor)!;
    press(reply, 'Escape', { isComposing: true });
    expect(field(editor)).toBe(reply);
  });

  it('Cancel closes it and discards the draft', () => {
    const { editor, review } = mount(plain);
    select(editor, 'importer');
    review.startComment();
    write(field(editor)!, 'Never mind.');
    button(notes(editor)[0]!, 'Cancel').click();
    expect(notes(editor)).toHaveLength(0);
    expect(editor.getDoc()).toBe(plain);
    review.startComment();
    expect(field(editor)!.value).toBe('');
  });

  it('posts nothing while the box is empty', () => {
    const { editor, review } = mount(plain);
    select(editor, 'importer');
    review.startComment();
    const box = field(editor)!;
    expect(button(notes(editor)[0]!, 'Post').disabled).toBe(true);
    press(box, 'Enter', { metaKey: true });
    write(box, '   ');
    press(box, 'Enter', { metaKey: true });
    expect(editor.getDoc()).toBe(plain);
    expect(field(editor)).toBe(box);
  });

  it('holds its anchor through edits', () => {
    const { editor, review } = mount(plain);
    select(editor, 'importer');
    review.startComment();
    // Text put in before the anchor, inside it, and right at either end of it.
    editor.view.dispatch({ changes: { from: 0, insert: 'So: ' } });
    editor.view.dispatch({ changes: { from: place(editor, 'importer').from + 3, insert: '-' } });
    const { from, to } = place(editor, 'imp-orter');
    editor.view.dispatch({ changes: { from: to, insert: 'B' } });
    editor.view.dispatch({ changes: { from, insert: 'A' } });
    expect(editor.view.contentDOM.querySelector('.rl-anchor')?.textContent).toBe('imp-orter');
    post(editor, 'Which?');
    const { id } = thisOne(editor);
    expect(editor.getDoc()).toContain(`A<!--cmt ${id}-->imp-orter<!--/${id}-->B`);
  });

  it('holds its anchor and its draft through a reload', () => {
    const { editor, review } = mount(plain);
    select(editor, 'importer');
    review.startComment();
    const box = field(editor)!;
    write(box, 'Which?');
    editor.reloadDoc(file('A new line.\n\nThe importer ships in April.', PEOPLE));
    expect(field(editor)).toBe(box);
    expect(box.value).toBe('Which?');
    expect(editor.view.contentDOM.querySelector('.rl-anchor')?.textContent).toBe('importer');
    press(box, 'Enter', { metaKey: true });
    expect(thisOne(editor).quote).toBe('importer');
  });

  it('comes to rest on a point when its text is deleted', () => {
    const { editor, review } = mount(plain);
    select(editor, 'importer');
    review.startComment();
    const { from, to } = place(editor, 'importer');
    editor.view.dispatch({ changes: { from, to } });
    post(editor, 'Gone?');
    const { id } = thisOne(editor);
    expect(editor.getDoc()).toContain(`The <!--cmt ${id}--> ships`);
  });

  it('stops before the ledger on a selection of the whole file', () => {
    const { editor, review } = mount(plain);
    editor.view.dispatch({ selection: { anchor: 0, head: editor.view.state.doc.length } });
    review.startComment();
    post(editor, 'All of it.');
    const { id, quote } = thisOne(editor);
    expect(quote).toBe('The importer ships in April.');
    expect(editor.getDoc()).toContain(`April.<!--/${id}-->`);
    expect(editor.getParsed().ledger.comments).toHaveLength(1);
  });

  it('is no tracked change, and one Undo takes it back to the same bytes', () => {
    const doc = `Before.\r\n\r\nThe importer ships.\r\n`;
    const { editor, review } = mount(doc);
    editor.setTracking(true);
    select(editor, 'importer');
    review.startComment();
    post(editor, 'Which?');
    expect(editor.getUiState().changes).toEqual([]);
    expect(editor.getParsed().ledger.comments).toHaveLength(1);
    shortcut(editor, 'z');
    expect(editor.getDoc()).toBe(doc);
  });

  it('keeps a draft and its anchor when started again, and moves an empty box', () => {
    const { editor, review } = mount(plain);
    select(editor, 'importer');
    review.startComment();
    const box = field(editor)!;
    select(editor, 'April');
    review.startComment();
    expect(editor.view.contentDOM.querySelector('.rl-anchor')?.textContent).toBe('April');
    write(box, 'Or May?');
    select(editor, 'ships');
    expect(review.startComment()).toBe(true);
    expect(notes(editor)).toHaveLength(1);
    expect(field(editor)).toBe(box);
    expect(box.value).toBe('Or May?');
    expect(editor.view.contentDOM.querySelector('.rl-anchor')?.textContent).toBe('April');
  });

  it('comments on an empty document', () => {
    const { editor, review } = mount('');
    review.startComment();
    post(editor, 'Start here.');
    const { id, text } = thisOne(editor);
    expect(text).toBe('Start here.');
    expect(editor.getDoc()).toContain(`<!--cmt ${id}-->`);
    expect(notes(editor)).toHaveLength(1);
  });

  it('stays while the selection moves in the document', () => {
    const { editor, review } = mount(threads);
    select(editor, 'More');
    review.startComment();
    const box = field(editor)!;
    write(box, 'Draft.');
    caretIn(editor, 'April');
    expect(field(editor)).toBe(box);
    // Its anchor stays the one tinted.
    expect(editor.view.contentDOM.querySelector('.rl-anchor')?.textContent).toBe('More');
    expect(notes(editor)).toHaveLength(3);
  });

  it('sits among the notes in the order of the text', () => {
    const { editor, review } = mount(threads);
    select(editor, 'ships');
    review.startComment();
    const shown = notes(editor);
    expect(shown).toHaveLength(3);
    expect(shown[1]!.querySelector('textarea')).not.toBeNull();
    expect(texts(shown[0]!)[0]).toBe('Which importer?');
    expect(texts(shown[2]!)[0]).toBe('Or May?');
  });

  it('keeps the draft through Clean and Raw, out of sight', () => {
    const { editor, review } = mount(plain);
    select(editor, 'importer');
    review.startComment();
    const box = field(editor)!;
    write(box, 'Which?');
    editor.setViewMode('clean');
    expect(notes(editor)).toHaveLength(0);
    editor.setViewMode('raw');
    expect(notes(editor)).toHaveLength(0);
    editor.setViewMode('redlines');
    expect(field(editor)).toBe(box);
    expect(box.value).toBe('Which?');
    press(box, 'Enter', { metaKey: true });
    expect(thisOne(editor).text).toBe('Which?');
  });

  it('goes away with its document', () => {
    const { editor, review } = mount(plain);
    select(editor, 'importer');
    review.startComment();
    write(field(editor)!, 'Which?');
    editor.setDoc(threads);
    expect(field(editor)).toBeUndefined();
    expect(notes(editor)).toHaveLength(2);
    expect(editor.getDoc()).toBe(threads);
  });

  it('shows over the page in a narrow editor, with the rail shrunk to dots', async () => {
    const { editor, review } = mount(threads);
    stubWidth(editor.view.scrollDOM, 800);
    await frame();
    await tick();
    select(editor, 'More');
    review.startComment();
    const note = field(editor)!.closest<HTMLElement>('.rl-note')!;
    expect(note.classList).toContain('rl-note-open');
    // It stays while the selection moves, until it closes.
    caretIn(editor, 'April');
    expect(note.classList).toContain('rl-note-open');
    press(field(editor)!, 'Escape');
    expect(notes(editor)).toHaveLength(2);
  });

  it('stays open when its first measure finds the editor narrow', async () => {
    const { editor, review } = mount(plain);
    stubWidth(editor.view.scrollDOM, 800);
    select(editor, 'importer');
    review.startComment();
    const note = field(editor)!.closest<HTMLElement>('.rl-note')!;
    await frame();
    await tick();
    expect(editor.view.dom.querySelector('.rl-rail')?.classList).toContain('rl-rail-compact');
    expect(note.classList).toContain('rl-note-open');
  });

  it('puts away the card of a change', async () => {
    const doc = file('We ship <!--ins k3x9-->new <!--/k3x9-->code.', [
      ...PEOPLE,
      'marks:',
      '  k3x9: {by: ada, at: 2026-10-31T09:30Z}',
    ]);
    const { editor, review } = mount(doc);
    click(editor.view.contentDOM.querySelector('.rl-ins')!, editor.view.contentDOM);
    await tick();
    expect(editor.view.dom.querySelector('.rl-card')).not.toBeNull();
    review.startComment();
    expect(editor.view.dom.querySelector('.rl-card')).toBeNull();
  });

  it('opens again after Raw or Clean, in a narrow editor', async () => {
    const { editor, review } = mount(threads);
    stubWidth(editor.view.scrollDOM, 800);
    await frame();
    await tick();
    select(editor, 'More');
    review.startComment();
    const box = field(editor)!;
    write(box, 'Draft.');
    const note = box.closest<HTMLElement>('.rl-note')!;
    for (const away of ['raw', 'clean'] as const) {
      editor.setViewMode(away);
      expect(note.isConnected).toBe(false);
      editor.setViewMode('redlines');
      expect(note.isConnected).toBe(true);
      expect(note.classList).toContain('rl-note-open');
    }
    // A second click on its dot still puts it away, and it stays away while you work.
    const dot = [...editor.view.dom.querySelectorAll<HTMLElement>('.rl-note-dot')].find((one) =>
      one.classList.contains('rl-note-dot-selected'),
    );
    dot!.click();
    expect(note.classList).not.toContain('rl-note-open');
    caretIn(editor, 'April');
    expect(note.classList).not.toContain('rl-note-open');
  });

  it('stops measuring when it leaves the editor', async () => {
    const { editor, review } = mount(plain);
    select(editor, 'importer');
    review.startComment();
    review.destroy();
    await frame();
    expect(editor.view.scrollDOM.style.minHeight).toBe('');
  });

  it('reads no old positions after a shorter document opens', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const long = file(`${'Words and more words. '.repeat(40)}<!--cmt c2dk-->end<!--/c2dk-->.`, [
        ...PEOPLE,
        'comments:',
        ...thread('c2dk', 'bo', 'Hm.'),
      ]);
      const { editor } = mount(long);
      // Asks for a measure, which is still to come when the other document opens.
      editor.view.dispatch({ selection: { anchor: 1 } });
      editor.setDoc('Short.');
      await frame();
      expect(logged).not.toHaveBeenCalled();
    } finally {
      logged.mockRestore();
    }
  });

  it('makes the page as long as its note, when that reaches past the text', async () => {
    const restore = stubHeights({ 'rl-note': 300 });
    try {
      const { editor, review } = mount(plain);
      select(editor, 'importer');
      vi.spyOn(editor.view, 'coordsAtPos').mockImplementation(() => ({
        left: 0,
        right: 0,
        top: 100,
        bottom: 120,
      }));
      review.startComment();
      await frame();
      // Raised 5px to its anchor, 300px high, with 24px under it. The page scrolls that far, where
      // the editor's own scroller would have shown a second scroll bar.
      expect(editor.view.scrollDOM.style.minHeight).toBe('419px');
      // With no notes, it goes.
      press(field(editor)!, 'Escape');
      await frame();
      expect(editor.view.scrollDOM.style.minHeight).toBe('');
    } finally {
      restore();
    }
  });

  it('is scrolled into view once it is placed', async () => {
    const { editor, review } = mount(plain);
    select(editor, 'importer');
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {});
    try {
      review.startComment();
      expect(scroll).not.toHaveBeenCalled();
      await frame();
      expect(scroll).toHaveBeenCalledOnce();
      expect(scroll.mock.contexts[0]).toBe(notes(editor)[0]);
    } finally {
      scroll.mockRestore();
    }
  });

  it('does nothing once the interface is out of the editor', () => {
    const { editor, review } = mount(plain);
    review.destroy();
    expect(review.startComment()).toBe(false);
    expect(() => review.refreshThread('c2dk')).not.toThrow();
    expect(field(editor)).toBeUndefined();
  });
});

describe('the Add Comment command', () => {
  it('is for the Format menu, with its key', () => {
    const { editor } = mount(plain);
    const command = editor.commands.list().find(({ id }) => id === 'comment.add');
    expect(command).toMatchObject({ title: 'Add Comment', shortcut: 'Mod-Alt-m', menu: 'format' });
    // A disabled item would take its key with it, and in Raw the key says why it does nothing.
    expect('isEnabled' in command!).toBe(false);
  });

  it('opens the box from the key and from a menu, and says why in Raw', () => {
    const { editor, notices } = mount(plain);
    select(editor, 'importer');
    shortcut(editor, 'm', { altKey: true });
    expect(field(editor)).toBeDefined();
    press(field(editor)!, 'Escape');

    expect(editor.commands.run('comment.add')).toBe(true);
    expect(field(editor)).toBeDefined();
    press(field(editor)!, 'Escape');

    editor.setViewMode('raw');
    expect(editor.commands.run('comment.add')).toBe(false);
    shortcut(editor, 'm', { altKey: true });
    expect(notices).toHaveLength(2);
  });

  it('goes with the review interface', () => {
    const { editor, review } = mount(plain);
    review.destroy();
    expect(editor.commands.list().map(({ id }) => id)).not.toContain('comment.add');
  });
});

describe('what a host adds to the boxes and the notes', () => {
  it('attaches to each comment box as it opens, and detaches as it closes', () => {
    const detach = vi.fn();
    const attach = vi.fn<FieldAttachment>(() => detach);
    const { editor, review } = mount(threads, { review: { attachToField: attach } });

    select(editor, 'More');
    review.startComment();
    expect(attach).toHaveBeenCalledTimes(1);
    expect(attach.mock.calls[0]![0]).toBe(field(editor));
    // Started again, it is the same box.
    review.startComment();
    expect(attach).toHaveBeenCalledTimes(1);
    press(field(editor)!, 'Escape');
    expect(detach).toHaveBeenCalledTimes(1);

    // A reply's box, which opens again after it closes.
    const [first] = notes(editor);
    button(first!, 'Reply').click();
    expect(attach).toHaveBeenCalledTimes(2);
    expect(attach.mock.calls[1]![0]).toBe(field(editor));
    button(first!, 'Cancel').click();
    expect(detach).toHaveBeenCalledTimes(2);
    button(first!, 'Reply').click();
    expect(attach).toHaveBeenCalledTimes(3);
    post(editor, 'Thanks.');
    expect(detach).toHaveBeenCalledTimes(3);

    // Posting a new comment closes its box.
    select(editor, 'More');
    review.startComment();
    expect(attach).toHaveBeenCalledTimes(4);
    post(editor, 'Why?');
    expect(detach).toHaveBeenCalledTimes(4);
    expect(attach).toHaveBeenCalledTimes(4);
  });

  it('detaches a box that goes with its note, its document or the interface', () => {
    const detach = vi.fn();
    const attachToField = vi.fn(() => detach);
    const { editor, review } = mount(threads, { review: { attachToField } });

    // Its note goes when the thread is resolved from another window, say.
    button(notes(editor)[1]!, 'Reply').click();
    editor.reloadDoc(file('Nothing here.', PEOPLE));
    expect(detach).toHaveBeenCalledTimes(1);

    select(editor, 'Nothing');
    review.startComment();
    editor.setDoc(plain);
    expect(detach).toHaveBeenCalledTimes(2);

    select(editor, 'importer');
    review.startComment();
    review.destroy();
    expect(detach).toHaveBeenCalledTimes(3);
  });

  it('stays attached to a draft kept through Clean', () => {
    const detach = vi.fn();
    const attachToField = vi.fn(() => detach);
    const { editor, review } = mount(plain, { review: { attachToField } });
    select(editor, 'importer');
    review.startComment();
    editor.setViewMode('clean');
    editor.setViewMode('redlines');
    expect(attachToField).toHaveBeenCalledTimes(1);
    expect(detach).not.toHaveBeenCalled();
  });

  it("draws a comment's text with renderText, and with who wrote it", () => {
    const renderText = vi.fn(
      (entry: { by: string; text: string }, person: { name: string } | undefined) => {
        const shown = document.createElement('b');
        shown.textContent = `${person?.name ?? entry.by}: ${entry.text}`;
        return shown;
      },
    );
    const doc = file('The <!--cmt c2dk-->importer<!--/c2dk-->.', [
      ...PEOPLE,
      'comments:',
      ...thread('c2dk', 'bo', 'Which?', [{ id: 'r5tw', by: 'nobody', text: 'Hm.' }]),
    ]);
    const { editor } = mount(doc, { review: { extras: { renderText } } });
    const [note] = notes(editor);
    expect(texts(note!)).toEqual(['Bo Chen: Which?', 'nobody: Hm.']);
    expect(note!.querySelector('.rl-note-text b')).not.toBeNull();
  });

  it('lets renderText ask for the rail to be laid out again', () => {
    let resized: (() => void) | undefined;
    const renderText = (entry: { text: string; resized: () => void }) => {
      resized = entry.resized;
      return document.createTextNode(entry.text);
    };
    const doc = file('The <!--cmt c2dk-->importer<!--/c2dk-->.', [
      ...PEOPLE,
      'comments:',
      ...thread('c2dk', 'bo', 'Which?'),
    ]);
    const { editor } = mount(doc, { review: { extras: { renderText } } });
    const measure = vi.spyOn(editor.view, 'requestMeasure');
    resized!();
    expect(measure).toHaveBeenCalled();
  });

  it('leaves the note of a change as it is', () => {
    const renderText = vi.fn(() => document.createTextNode('never'));
    const footer = vi.fn(() => document.createElement('p'));
    const { editor, review } = mount(reasons, { review: { extras: { renderText, footer } } });
    const [note] = notes(editor);
    expect(texts(note!)).toEqual(['Matches the roadmap']);
    review.refreshThread('p7qd');
    expect(renderText).not.toHaveBeenCalled();
    expect(footer).not.toHaveBeenCalled();
  });

  it('shows the footer at the foot of the thread, and refreshThread brings it up to date', () => {
    const lines = new Map<string, HTMLElement>();
    const footer = vi.fn((id: string) => lines.get(id) ?? null);
    const { editor, review } = mount(threads, { review: { extras: { footer } } });
    const [first, second] = notes(editor);
    expect(footer.mock.calls.map(([id]) => id)).toEqual(['c2dk', 'c3fm']);
    expect(first!.querySelector('.live')).toBeNull();
    // A note with no footer has nothing for one.
    expect(first!.children).toHaveLength(2);

    const line = document.createElement('div');
    line.className = 'live';
    lines.set('c2dk', line);
    review.refreshThread('c2dk');
    expect(first!.querySelector('.live')).toBe(line);
    expect(line.previousElementSibling).toBe(first!.querySelector('.rl-note-items'));
    expect(second!.querySelector('.live')).toBeNull();

    // Below the thread, above a box being written in.
    button(first!, 'Reply').click();
    expect(line.nextElementSibling).toBe(first!.querySelector('.rl-note-box'));
    write(field(editor)!, 'Draft.');
    // Another element takes its place; the draft stays.
    const next = document.createElement('div');
    next.className = 'live';
    lines.set('c2dk', next);
    review.refreshThread('c2dk');
    expect(first!.querySelectorAll('.live')).toHaveLength(1);
    expect(first!.querySelector('.live')).toBe(next);
    expect(field(editor)!.value).toBe('Draft.');

    lines.delete('c2dk');
    review.refreshThread('c2dk');
    expect(first!.querySelector('.live')).toBeNull();
    // A thread with no note, such as one that was resolved.
    expect(() => review.refreshThread('nope')).not.toThrow();
  });

  it('asks for the footer only when the note is drawn or refreshed', () => {
    const footer = vi.fn(() => null);
    const { editor } = mount(threads, { review: { extras: { footer } } });
    const asked = footer.mock.calls.length;
    caretIn(editor, 'April');
    expect(footer).toHaveBeenCalledTimes(asked);
  });

  it('asks renderText again on refreshThread', () => {
    let word = 'first';
    const renderText = (entry: { text: string }) =>
      document.createTextNode(`${word}: ${entry.text}`);
    const { editor, review } = mount(threads, { review: { extras: { renderText } } });
    expect(texts(notes(editor)[1]!)).toEqual(['first: Or May?']);
    word = 'second';
    review.refreshThread('c3fm');
    expect(texts(notes(editor)[1]!)).toEqual(['second: Or May?']);
    // Only the thread asked for.
    expect(texts(notes(editor)[0]!)[0]).toBe('first: Which importer?');
  });

  it('lays the rail out again when a footer comes or goes', async () => {
    const restore = stubHeights({ 'rl-note': 60 });
    try {
      let live: HTMLElement | null = null;
      const { editor, review } = mount(threads, { review: { extras: { footer: () => live } } });
      await frame();
      const [first, second] = notes(editor);
      Object.defineProperty(first!, 'offsetHeight', {
        configurable: true,
        get: () => (first!.querySelector('.live') ? 90 : 60),
      });
      expect(top(second!)).toBe(top(first!) + 60 + 8);
      live = document.createElement('div');
      live.className = 'live';
      review.refreshThread('c2dk');
      await frame();
      expect(top(second!)).toBe(top(first!) + 90 + 8);
      live = null;
      review.refreshThread('c2dk');
      await frame();
      expect(top(second!)).toBe(top(first!) + 60 + 8);
    } finally {
      restore();
    }
  });
});
