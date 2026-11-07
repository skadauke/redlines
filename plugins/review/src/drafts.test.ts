// @vitest-environment happy-dom
import { Text } from '@codemirror/state';
import type { Editor } from '@redlines/editor';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DRAFT_DELAY, DRAFT_LONGEST, keepComment, readDrafts } from './drafts.ts';
import { manifest } from './index.ts';
import {
  button,
  file,
  me,
  memoryShelf,
  type MemoryShelf,
  mount,
  type Mounted,
  PEOPLE,
  press,
  thread,
  unmountAll,
  windowData,
  type WindowData,
} from './test-helpers.ts';

/** The document's real path, as the host names it. */
const PATH = '/Users/mira/notes/plan.md';

const plain = file('The importer ships in April.\n\nMore text.', PEOPLE);
const threads = file(
  'The <!--cmt c2dk-->importer<!--/c2dk--> ships in <!--cmt c3fm-->April<!--/c3fm-->.\n\nMore text.',
  [
    ...PEOPLE,
    'comments:',
    ...thread('c2dk', 'bo', 'Which importer?'),
    ...thread('c3fm', 'ada', 'Or May?'),
  ],
);

beforeEach(() => {
  // The clock that writes the store: no real timer runs in these tests.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});

afterEach(() => {
  unmountAll();
  vi.useRealTimers();
});

/** A window of the app. */
type Page = Mounted & { data: WindowData };

/** A window's page with `doc` open, at `path`, with drafts kept on `store`. */
function open(
  doc: string,
  store: MemoryShelf,
  path: string | null = PATH,
  options: { showResolved?: boolean } = {},
): Page {
  const data = windowData(store);
  const mounted = mount(doc, { review: { documentData: data, ...options } });
  // The host has found the document's file: its data can be read.
  data.open(path);
  return { ...mounted, data };
}

/** The page goes away, as when the window closes or the app quits, without being asked. */
function leave({ editor, review }: Mounted): void {
  review.destroy();
  editor.destroy();
}

const notes = (editor: Editor) => [...editor.view.dom.querySelectorAll<HTMLElement>('.rl-note')];
const select = (editor: Editor, word: string) => {
  const from = editor.view.state.doc.toString().indexOf(word);
  expect(from).toBeGreaterThanOrEqual(0);
  editor.view.dispatch({ selection: { anchor: from, head: from + word.length } });
};
/** The boxes being written in that show. */
const fields = (editor: Editor) =>
  [...editor.view.dom.querySelectorAll<HTMLTextAreaElement>('.rl-note textarea')].filter(
    (box) => !box.closest<HTMLElement>('.rl-note-box')?.hidden,
  );
const field = (editor: Editor) => fields(editor)[0];
/** The box a new comment is being written in. */
const newBox = (editor: Editor) =>
  fields(editor).find((box) => box.getAttribute('aria-label') === 'Comment');
/** The box in the note of `thread`, or the new comment's. */
const boxOf = (editor: Editor, text: string) =>
  notes(editor)
    .find((note) => note.textContent?.includes(text))
    ?.querySelector<HTMLTextAreaElement>('textarea');
const write = (box: HTMLTextAreaElement, text: string) => {
  box.value = text;
  box.dispatchEvent(new Event('input', { bubbles: true }));
};
const post = (box: HTMLTextAreaElement) => press(box, 'Enter', { metaKey: true });
const anchor = (editor: Editor) =>
  editor.view.contentDOM.querySelector('.rl-anchor')?.textContent ?? null;
const notice = (editor: Editor) =>
  editor.view.dom.querySelector<HTMLElement>('.rl-note-notice:not([hidden])')?.textContent ?? null;
const thisOne = (editor: Editor) => editor.getParsed().ledger.comments.at(-1)!;
const written = () => vi.advanceTimersByTime(DRAFT_DELAY);

/** A comment on `word` being written: `text` typed in its box. */
function comment(editor: Mounted, word: string, text: string): HTMLTextAreaElement {
  select(editor.editor, word);
  editor.review.startComment();
  const box = newBox(editor.editor)!;
  write(box, text);
  return box;
}

/** A reply to the thread whose comment says `on`, being written. */
function reply(editor: Editor, on: string, text: string): HTMLTextAreaElement {
  const note = notes(editor).find((each) => each.textContent?.includes(on))!;
  button(note, 'Reply').click();
  const box = note.querySelector('textarea')!;
  write(box, text);
  return box;
}

describe('drafts that outlast the page', () => {
  it('are kept in the document data its manifest asks for', () => {
    expect(manifest).toMatchObject({ id: 'redlines.review' });
    expect(manifest.needs).toContain('document:data');
  });

  it('writes a draft later, by the clock, never at the keystroke', () => {
    const store = memoryShelf();
    const page = open(plain, store);
    const box = comment(page, 'importer', 'Which');
    expect(store.writes).toBe(0);
    vi.advanceTimersByTime(DRAFT_DELAY - 1);
    expect(store.writes).toBe(0);
    vi.advanceTimersByTime(1);
    expect(store.writes).toBe(1);
    // Typing on: one write for what was typed meanwhile, never one for each key.
    write(box, 'Which one');
    write(box, 'Which one?');
    expect(store.writes).toBe(1);
    written();
    expect(store.writes).toBe(2);
    // Nothing changed, nothing written.
    written();
    expect(store.writes).toBe(2);
  });

  it('writes when typing pauses, and at least every little while as it goes on', () => {
    const store = memoryShelf();
    const page = open(plain, store);
    const box = comment(page, 'importer', 'W');
    // A key every 300 ms: no pause long enough, until just past the longest wait.
    const steps = Math.ceil(DRAFT_LONGEST / 300);
    for (let i = 1; i <= steps; i++) {
      vi.advanceTimersByTime(300);
      write(box, `W${'x'.repeat(i)}`);
    }
    expect(store.writes).toBe(1);
    expect(store.drafts(PATH)).toMatchObject({ comment: { text: `W${'x'.repeat(steps - 1)}` } });
    vi.advanceTimersByTime(DRAFT_DELAY);
    expect(store.writes).toBe(2);
    expect(store.drafts(PATH)).toMatchObject({ comment: { text: `W${'x'.repeat(steps)}` } });
  });

  it('writes no more while the document is typed in than the gathering allows', () => {
    const store = memoryShelf();
    const page = open(plain, store);
    comment(page, 'importer', 'Which one?');
    written();
    expect(store.writes).toBe(1);
    // Typing in the document moves the comment's anchor at every key.
    for (let i = 0; i < 9; i++) {
      vi.advanceTimersByTime(300);
      page.editor.view.dispatch({ changes: { from: 0, insert: 'x' } });
    }
    expect(store.writes).toBe(2);
    written();
    expect(store.writes).toBe(3);
  });

  it('keeps one copy of the document for a comment and the comment set aside', () => {
    const store = memoryShelf();
    const page = open(threads, store);
    press(comment(page, 'More', 'Set aside.'), 'Escape');
    comment(page, 'ships', 'Open.');
    written();
    const kept = JSON.stringify(store.drafts(PATH));
    expect(kept.split('More text.')).toHaveLength(2);
    // And both come back, from that one copy.
    leave(page);
    const { editor, review } = open(threads, store);
    expect(field(editor)?.value).toBe('Open.');
    expect(anchor(editor)).toBe('ships');
    post(field(editor)!);
    select(editor, 'More');
    review.startComment();
    expect(newBox(editor)?.value).toBe('Set aside.');
  });

  it('copies the document again only when it changed', () => {
    const store = memoryShelf();
    const page = open(plain, store);
    const box = comment(page, 'importer', 'Which');
    written();
    const copy = vi.spyOn(page.editor.view.state.doc, 'toString');
    write(box, 'Which one?');
    written();
    expect(store.drafts(PATH)).toMatchObject({ comment: { text: 'Which one?' } });
    expect(copy).not.toHaveBeenCalled();
  });

  it('gives a new comment back when its document opens again', () => {
    const store = memoryShelf();
    const first = open(plain, store);
    comment(first, 'importer', 'Which one?');
    written();
    leave(first);

    const { editor } = open(plain, store);
    const box = field(editor)!;
    expect(box.value).toBe('Which one?');
    expect(box.selectionStart).toBe('Which one?'.length);
    expect(document.activeElement).toBe(box);
    expect(anchor(editor)).toBe('importer');
    expect(notice(editor)).toBeNull();
    expect(editor.getDoc()).toBe(plain);
    post(box);
    expect(thisOne(editor)).toMatchObject({ text: 'Which one?', quote: 'importer', by: me.handle });
  });

  it('shows a document that opens Clean in Redlines, to give a new comment back', () => {
    const store = memoryShelf();
    const first = open(plain, store);
    comment(first, 'importer', 'Which one?');
    written();
    leave(first);
    const bare = mount(plain).editor;
    expect(bare.getUiState().view).toBe('clean');

    const { editor } = open(plain, store);
    expect(editor.getUiState().view).toBe('redlines');
    expect(field(editor)?.value).toBe('Which one?');
  });

  it('finds the anchor again in a document changed elsewhere', () => {
    const store = memoryShelf();
    const first = open(plain, store);
    comment(first, 'importer', 'Which one?');
    written();
    leave(first);

    const changed = file(
      'A new first line.\n\nThe importer ships in April.\n\nMore words.',
      PEOPLE,
    );
    const { editor } = open(changed, store);
    expect(anchor(editor)).toBe('importer');
    expect(notice(editor)).toBeNull();
    post(field(editor)!);
    expect(thisOne(editor).quote).toBe('importer');
  });

  it('keeps the text and says so when the text it pointed to changed', () => {
    const store = memoryShelf();
    const first = open(file('Alpha beta importer gamma delta.', PEOPLE), store);
    comment(first, 'importer', 'Which one?');
    written();
    leave(first);

    const { editor, review } = open(file('Alpha BETA exporter gamma DELTA.', PEOPLE), store);
    expect(field(editor)?.value).toBe('Which one?');
    expect(notice(editor)).toMatch(/changed/);
    expect(anchor(editor)).toBe('BETA exporter gamma DELTA');
    // It moves to other text, as after a reload, and the line goes.
    select(editor, 'gamma');
    review.startComment();
    expect(anchor(editor)).toBe('gamma');
    expect(notice(editor)).toBeNull();
    expect(field(editor)?.value).toBe('Which one?');
  });

  it('gives a reply back to its thread', () => {
    const store = memoryShelf();
    const first = open(threads, store);
    reply(first.editor, 'Or May?', 'June, then.');
    written();
    leave(first);

    const { editor } = open(threads, store);
    const box = boxOf(editor, 'Or May?')!;
    expect(box.value).toBe('June, then.');
    expect(fields(editor)).toEqual([box]);
    expect(document.activeElement).toBe(box);
    post(box);
    const april = editor.getParsed().ledger.comments.find(({ id }) => id === 'c3fm')!;
    expect(april.replies.map(({ text }) => text)).toEqual(['June, then.']);
  });

  it('keeps a reply whose thread is gone, and says so', () => {
    const store = memoryShelf();
    const first = open(threads, store);
    reply(first.editor, 'Or May?', 'June, then.');
    written();
    leave(first);

    const without = file('The <!--cmt c2dk-->importer<!--/c2dk--> ships in April.\n\nMore text.', [
      ...PEOPLE,
      'comments:',
      ...thread('c2dk', 'bo', 'Which importer?'),
    ]);
    const { editor, review } = open(without, store);
    expect(field(editor)?.value).toBe('June, then.');
    expect(notice(editor)).toMatch(/gone/);
    expect(review.hasDraft()).toBe(true);
    // Cancel lets it go, for good, at once.
    button(notes(editor).at(-1)!, 'Cancel').click();
    expect(store.drafts(PATH)).toBeUndefined();
  });

  it('keeps saying the text changed after a reload, when the document opens again', () => {
    const store = memoryShelf();
    const doc = file('Alpha beta importer gamma delta.', PEOPLE);
    const first = open(doc, store);
    comment(first, 'importer', 'Which one?');
    const reloaded = file('Alpha BETA exporter gamma DELTA.', PEOPLE);
    first.editor.reloadDoc(reloaded);
    written();
    leave(first);

    const { editor } = open(reloaded, store);
    expect(notice(editor)).toMatch(/changed/);
    expect(anchor(editor)).toBe('BETA exporter gamma DELTA');
  });

  it('gives a reply back to a resolved thread, which shows for it', () => {
    const store = memoryShelf();
    const resolved = file('The <!--cmt c2dk-->importer<!--/c2dk--> ships.', [
      ...PEOPLE,
      'comments:',
      ...thread('c2dk', 'bo', 'Which importer?', [], 'ada 2026-11-01T10:00Z'),
    ]);
    const first = open(resolved, store, PATH, { showResolved: true });
    reply(first.editor, 'Which importer?', 'The new one.');
    written();
    leave(first);

    const { editor } = open(resolved, store);
    expect(notes(editor)).toHaveLength(1);
    expect(field(editor)?.value).toBe('The new one.');
    expect(notice(editor)).toBeNull();
  });

  it('writes what is waiting when the page goes away', () => {
    const store = memoryShelf();
    const page = open(plain, store);
    comment(page, 'importer', 'Which one?');
    window.dispatchEvent(new Event('pagehide'));
    expect(store.drafts(PATH)).toMatchObject({ comment: { text: 'Which one?' } });
  });

  it('gives back every draft, and the caret to the box last typed in', () => {
    const store = memoryShelf();
    const first = open(threads, store);
    reply(first.editor, 'Which importer?', 'The old one.');
    comment(first, 'More', 'More what?');
    reply(first.editor, 'Or May?', 'June, then.');
    written();
    leave(first);

    const { editor } = open(threads, store);
    expect(fields(editor).map(({ value }) => value)).toEqual([
      'The old one.',
      'June, then.',
      'More what?',
    ]);
    expect(document.activeElement).toBe(boxOf(editor, 'Or May?'));
    expect(anchor(editor)).toBe('More');
  });

  it('keeps what Escape set aside, set aside on its anchor', () => {
    const store = memoryShelf();
    const first = open(plain, store);
    const box = comment(first, 'importer', 'Which one?');
    press(box, 'Escape');
    written();
    leave(first);

    const { editor, review } = open(plain, store);
    expect(fields(editor)).toEqual([]);
    expect(review.hasDraft()).toBe(true);
    select(editor, 'importer');
    review.startComment();
    expect(field(editor)?.value).toBe('Which one?');
  });

  it('forgets a comment and a reply at once when they are posted, not a moment later', () => {
    const store = memoryShelf();
    const page = open(threads, store);
    const box = comment(page, 'More', 'More what?');
    const answer = reply(page.editor, 'Or May?', 'June, then.');
    written();
    // Posting can save the file and the app quit at once: no clock moves before the store forgets.
    post(box);
    expect(store.drafts(PATH)).not.toHaveProperty('comment');
    post(answer);
    expect(store.drafts(PATH)).toBeUndefined();
    const doc = page.editor.getDoc();
    leave(page);
    expect(fields(open(doc, store).editor)).toEqual([]);
  });

  it('forgets a draft at once when it is cleared: Cancel, or its text deleted', () => {
    const store = memoryShelf();
    const page = open(threads, store);
    const box = comment(page, 'More', 'More what?');
    const answer = reply(page.editor, 'Or May?', 'June, then.');
    written();
    button(box.closest('.rl-note')!, 'Cancel').click();
    expect(store.drafts(PATH)).not.toHaveProperty('comment');
    write(answer, '');
    expect(store.drafts(PATH)).toBeUndefined();
  });

  it('forgets the drafts discarded to open another document, and writes them no more', () => {
    const store = memoryShelf();
    const page = open(threads, store);
    const box = comment(page, 'More', 'More what?');
    written();
    write(box, 'More what, then?');
    page.review.discardDrafts();
    expect(store.drafts(PATH)).toBeUndefined();
    written();
    expect(store.drafts(PATH)).toBeUndefined();
    // The other document takes this one's place.
    page.editor.setDoc(plain);
    written();
    expect(store.drafts(PATH)).toBeUndefined();
  });

  it('moves the drafts with their document when it is renamed or saved as', () => {
    const store = memoryShelf();
    const page = open(threads, store);
    comment(page, 'More', 'More what?');
    written();
    page.data.moveTo('/Users/mira/notes/launch.md');
    expect(store.drafts(PATH)).toBeUndefined();
    expect(store.drafts('/Users/mira/notes/launch.md')).toBeDefined();
    leave(page);
    expect(field(open(threads, store, '/Users/mira/notes/launch.md').editor)?.value).toBe(
      'More what?',
    );
  });

  it('keeps nothing for a document with no file, until it is saved', () => {
    const store = memoryShelf();
    const page = open(plain, store, null);
    comment(page, 'importer', 'Which one?');
    written();
    expect(store.writes).toBe(0);
    page.data.moveTo(PATH);
    expect(store.drafts(PATH)).toBeDefined();
  });

  it('replaces what was kept for a file that a document is saved over', () => {
    const store = memoryShelf();
    const old = open(threads, store);
    reply(old.editor, 'Or May?', 'June, then.');
    written();
    leave(old);
    // Another document, saved as that file, takes its place there, with its own drafts.
    const page = open(plain, store, null);
    comment(page, 'importer', 'Which one?');
    page.data.moveTo(PATH);
    leave(page);
    // The reply to the old document's thread, which would say its thread is gone, isn't there.
    expect(fields(open(plain, store).editor).map(({ value }) => value)).toEqual(['Which one?']);
  });

  it('writes at once when asked, as before the window closes', () => {
    const store = memoryShelf();
    const page = open(plain, store);
    comment(page, 'importer', 'Which one?');
    page.review.saveDrafts();
    expect(store.writes).toBe(1);
    written();
    expect(store.writes).toBe(1);
  });

  it('gives a draft back once, however often it is told where the document is', () => {
    const store = memoryShelf();
    const first = open(threads, store);
    comment(first, 'More', 'More what?');
    reply(first.editor, 'Or May?', 'June, then.');
    written();
    leave(first);
    const { editor, data } = open(threads, store);
    data.open(PATH);
    expect(fields(editor).map(({ value }) => value)).toEqual(['June, then.', 'More what?']);
    expect(notes(editor)).toHaveLength(3);
  });

  it('reads what it does not understand as nothing', () => {
    const store = memoryShelf();
    store.set(PATH, 'drafts', {
      comment: { from: 'x', to: 3, text: 'Hi', v: '1' },
      aside: 7,
      replies: { c2dk: { text: 3 }, nope: null },
    });
    const { editor, review } = open(threads, store);
    expect(fields(editor)).toEqual([]);
    expect(review.hasDraft()).toBe(false);
  });

  it('keeps a copy of the document to find a comment again, unless the document is long', () => {
    const doc = Text.of(['The importer ships.']);
    const draft = { range: { from: 4, to: 12 }, text: 'Which?' };
    expect(keepComment(draft, doc, 'v1')).toEqual({
      from: 4,
      to: 12,
      text: 'Which?',
      v: 'v1',
      doc: 'The importer ships.',
    });
    expect(keepComment(draft, doc, 'v1', 10)).toEqual({
      from: 4,
      to: 12,
      text: 'Which?',
      v: 'v1',
      around: ' importer ',
    });
  });

  it('reads only drafts with text, a version, and a place in the text they were kept with', () => {
    const comment = { from: 4, to: 12, text: 'Which?', v: 'a', doc: 'The importer ships.' };
    expect(readDrafts({ comment, replies: { c2dk: { text: 'Hi', v: 'b' } } })).toEqual({
      comment,
      replies: { c2dk: { text: 'Hi', v: 'b' } },
    });
    expect(readDrafts({ comment: { ...comment, to: 40 } })).toEqual({});
    expect(readDrafts({ comment: { ...comment, text: '  ' } })).toEqual({});
    expect(readDrafts({ comment: { ...comment, doc: undefined } })).toEqual({});
    expect(readDrafts({ replies: { 'a b': { text: 'Hi', v: 'b' } } })).toEqual({});
    expect(readDrafts('nonsense')).toEqual({});
  });

  describe('in two windows', () => {
    it('keeps the draft typed last, and each window takes the kept drafts when it opens', () => {
      const store = memoryShelf();
      const one = open(threads, store);
      comment(one, 'More', 'From one.');
      written();
      const two = open(threads, store);
      const box = field(two.editor)!;
      expect(box.value).toBe('From one.');
      write(box, 'From two.');
      written();
      // One writing on, without typing in it, doesn't take the place of what two typed.
      one.editor.view.dispatch({ changes: { from: 0, insert: 'So: ' } });
      written();
      expect(store.drafts(PATH)).toMatchObject({ comment: { text: 'From two.' } });
      // And posting it in one forgets only its own: two's text is kept.
      post(field(one.editor)!);
      written();
      expect(store.drafts(PATH)).toMatchObject({ comment: { text: 'From two.' } });
    });

    it('forgets a draft posted in one window that the other took and left alone', () => {
      const store = memoryShelf();
      const one = open(threads, store);
      comment(one, 'More', 'More what?');
      written();
      const two = open(threads, store);
      expect(field(two.editor)?.value).toBe('More what?');
      post(field(one.editor)!);
      written();
      expect(store.drafts(PATH)).toBeUndefined();
      // Two still shows it, and keeps it again once it is typed in.
      write(field(two.editor)!, 'More what? Still?');
      written();
      expect(store.drafts(PATH)).toMatchObject({ comment: { text: 'More what? Still?' } });
    });
  });
});
