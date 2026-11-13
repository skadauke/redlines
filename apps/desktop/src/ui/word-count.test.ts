// @vitest-environment happy-dom
import { EditorView } from '@codemirror/view';
import { createEditor, type Author, type Editor } from '@redlines/editor';
import { newestView } from '@redlines/format';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createEditorWordCount,
  createWordCount,
  IDLE_MS,
  wordCountLabel,
  wordsIn,
} from './word-count.ts';

// Counts how often the text is read as a reader sees it, which is the cost of a count.
vi.mock('@redlines/format', async (importOriginal) => {
  const real = await importOriginal<typeof import('@redlines/format')>();
  return { ...real, newestView: vi.fn(real.newestView) };
});

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

/** The ledger a file carries, which a reader never sees. */
const LEDGER = [
  '<!-- redlines',
  'version: 1',
  'people:',
  '  bo: {name: Bo Chen}',
  'marks:',
  '  k3x9: {by: bo, at: 2026-10-31T09:30Z}',
  '  w2rf: {by: bo, at: 2026-10-31T09:31Z}',
  '-->',
  '',
].join('\n');
const SOURCE = `Keep <!--ins k3x9-->this<!--/k3x9--> one.<!--del w2rf  gone words here-->\n\n${LEDGER}`;

describe('wordsIn', () => {
  it('counts the words a reader sees, none of the markers, the deleted text or the ledger', () => {
    expect(wordsIn(SOURCE, { from: 0, to: 0 })).toEqual({ total: 3, selected: null });
    expect(wordsIn('', { from: 0, to: 0 })).toEqual({ total: 0, selected: null });
  });

  it('counts the words a selection covers, as a reader sees them', () => {
    // "Keep <!--ins k3x9-->this" is "Keep this" to a reader.
    const through = SOURCE.indexOf('this') + 'this'.length;
    expect(wordsIn(SOURCE, { from: 0, to: through })).toEqual({ total: 3, selected: 2 });
    // Starting inside the insertion's marker: the nearest place a reader sees.
    const inside = SOURCE.indexOf('<!--ins') + 3;
    expect(wordsIn(SOURCE, { from: inside, to: SOURCE.indexOf(' one.') + 5 })).toEqual({
      total: 3,
      selected: 2,
    });
  });

  it('says no selection for one with no words in it', () => {
    expect(wordsIn('One two.\n\nThree.', { from: 8, to: 10 })).toEqual({
      total: 3,
      selected: null,
    });
    expect(wordsIn('One two.', { from: 3, to: 4 })).toEqual({ total: 2, selected: null });
  });
});

describe('wordCountLabel', () => {
  it('says the words, thousands set apart, and how many of them are selected', () => {
    expect(wordCountLabel(1204, null)).toBe('1,204 words');
    expect(wordCountLabel(1, null)).toBe('1 word');
    expect(wordCountLabel(0, null)).toBe('0 words');
    expect(wordCountLabel(1204, 120)).toBe('120 of 1,204 words');
    expect(wordCountLabel(1, 1)).toBe('1 of 1 word');
  });
});

describe('createWordCount', () => {
  const setup = (visible = true, total = 1204) => {
    const parent = document.createElement('div');
    const scroller = document.createElement('div');
    scroller.className = 'rl-scroller';
    parent.append(scroller);
    document.body.append(parent);
    const counted = { total, selected: null as number | null };
    const count = vi.fn(() => ({ ...counted }));
    const words = createWordCount(parent, { count }, { visible });
    const label = () => parent.querySelector<HTMLElement>('.rl-word-count');
    const footer = () => parent.querySelector<HTMLElement>('.rl-footer');
    return { parent, scroller, words, count, counted, label, footer };
  };

  it('counts on idle, not as the document changes, and not once for each change', () => {
    const { words, count, label } = setup();
    expect(label()?.textContent).toBe('');
    // A burst of typing: each change asks again, and the count waits for the last.
    for (let i = 0; i < 5; i++) {
      words.schedule();
      vi.advanceTimersByTime(IDLE_MS - 1);
    }
    expect(count).not.toHaveBeenCalled();
    expect(label()?.textContent).toBe('');
    vi.advanceTimersByTime(1);
    expect(count).toHaveBeenCalledOnce();
    expect(label()?.textContent).toBe('1,204 words');
  });

  it('counts a document that has just opened as soon as the page has drawn it, not on idle', () => {
    const { words, count, counted, label } = setup();
    words.schedule();
    counted.total = 87;
    words.refresh();
    expect(count).not.toHaveBeenCalled();
    // The next turn of the event loop, far short of the idle wait; the count that waited is
    // replaced, not run besides.
    vi.advanceTimersByTime(0);
    expect(count).toHaveBeenCalledOnce();
    expect(label()?.textContent).toBe('87 words');
    vi.advanceTimersByTime(IDLE_MS * 2);
    expect(count).toHaveBeenCalledOnce();
  });

  it('counts nothing for a document that opens while it is hidden', () => {
    const { words, count } = setup(false);
    words.refresh();
    vi.advanceTimersByTime(IDLE_MS);
    expect(count).not.toHaveBeenCalled();
  });

  it('shows the words selected, and goes back to the total when nothing is', () => {
    const { words, counted, label } = setup();
    counted.selected = 120;
    words.schedule();
    vi.advanceTimersByTime(IDLE_MS);
    expect(label()?.textContent).toBe('120 of 1,204 words');
    counted.selected = null;
    words.schedule();
    vi.advanceTimersByTime(IDLE_MS);
    expect(label()?.textContent).toBe('1,204 words');
  });

  it('counts nothing while it is hidden, and counts at once when it is shown', () => {
    const { words, count, label, footer } = setup(false);
    expect(footer()?.hidden).toBe(true);
    words.schedule();
    vi.advanceTimersByTime(IDLE_MS * 3);
    expect(count).not.toHaveBeenCalled();
    words.setVisible(true);
    expect(footer()?.hidden).toBe(false);
    expect(label()?.textContent).toBe('1,204 words');
    // Hidden again: a count that was waiting does not run.
    words.schedule();
    words.setVisible(false);
    vi.advanceTimersByTime(IDLE_MS);
    expect(count).toHaveBeenCalledTimes(1);
    expect(footer()?.hidden).toBe(true);
  });

  it('does not count again for the setting it already has', () => {
    const { words, count } = setup(true);
    words.setVisible(true);
    words.setVisible(true);
    expect(count).not.toHaveBeenCalled();
  });

  it('is no part of what assistive technology announces as it changes', () => {
    const { label } = setup();
    expect(label()?.getAttribute('aria-live')).toBeNull();
    expect(label()?.getAttribute('role')).toBeNull();
  });

  it('is drawn after the page it fades, which would otherwise be over it', () => {
    const { parent, scroller, footer } = setup();
    expect(parent.lastElementChild).toBe(footer());
    expect(footer()?.previousElementSibling).toBe(scroller);
  });

  it('marks the page while it takes room, so that what scrolls into view stops short of it', () => {
    const { parent, words } = setup(true);
    expect(parent.classList.contains('rl-has-footer')).toBe(true);
    words.setVisible(false);
    expect(parent.classList.contains('rl-has-footer')).toBe(false);
    words.setVisible(true);
    expect(parent.classList.contains('rl-has-footer')).toBe(true);
    expect(setup(false).parent.classList.contains('rl-has-footer')).toBe(false);
  });

  it('says how much room it takes as it is drawn, and none while it is hidden', () => {
    const { words, footer } = setup(true);
    // The fade's height follows the page's zoom, so it is measured each time it is asked.
    let height = 44;
    footer()!.getBoundingClientRect = () => new DOMRect(0, 0, 800, height);
    expect(words.room()).toBe(44);
    height = 55;
    expect(words.room()).toBe(55);
    words.setVisible(false);
    expect(words.room()).toBe(0);
  });
});

describe('the word count of an editor', () => {
  const author: Author = { handle: 'ada', name: 'Ada Lovelace' };
  const editors: Editor[] = [];
  afterEach(() => {
    for (const editor of editors.splice(0)) editor.destroy();
  });

  function setup(doc: string, visible = true) {
    const parent = document.createElement('div');
    document.body.append(parent);
    const host = document.createElement('div');
    parent.append(host);
    const editor = createEditor(host, { doc, author, tracking: false });
    editors.push(editor);
    const words = createEditorWordCount(parent, editor, { visible });
    const label = () => parent.querySelector('.rl-word-count')?.textContent;
    const select = (anchor: number, head = anchor) =>
      editor.view.dispatch({ selection: { anchor, head } });
    /** The room the editor keeps clear at the bottom of what it scrolls to. */
    const bottomMargin = () =>
      Math.max(
        0,
        ...editor.view.state
          .facet(EditorView.scrollMargins)
          .map((margins) => margins(editor.view)?.bottom ?? 0),
      );
    return { parent, editor, words, label, select, bottomMargin };
  }

  it('counts what a reader sees of the editor’s text, none of its markers or ledger', () => {
    const { words, label } = setup(SOURCE);
    words.refresh();
    vi.advanceTimersByTime(0);
    expect(label()).toBe('3 words');
  });

  it('counts a selection in a file whose lines end in CRLF, which the editor keeps as LF', () => {
    // The selection is a place in the editor's text, where every line break is one character; the
    // file's text, which `getDoc` gives back, has two. Counting the file's text from the editor's
    // places slides every selection one character left for each break above it.
    const { editor, words, label, select } = setup('One two\r\nthree four\r\nfive six\r\nseven');
    expect(editor.getDoc()).toContain('\r\n');
    select(0, editor.view.state.doc.length);
    words.refresh();
    vi.advanceTimersByTime(0);
    expect(label()).toBe('7 of 7 words');
    // The last line but one: "five six" is two words, with three line breaks above it.
    const line = editor.view.state.doc.line(3);
    select(line.from, line.to);
    words.refresh();
    vi.advanceTimersByTime(0);
    expect(label()).toBe('2 of 7 words');
    // Just "seven", the last.
    const last = editor.view.state.doc.line(4);
    select(last.from, last.to);
    words.refresh();
    vi.advanceTimersByTime(0);
    expect(label()).toBe('1 of 7 words');
  });

  it('counts again on idle after the text changes, and after the selection does', () => {
    const { editor, label, select, words } = setup('One two three');
    words.refresh();
    vi.advanceTimersByTime(0);
    expect(label()).toBe('3 words');
    editor.view.dispatch({ changes: { from: 0, insert: 'Zero ' } });
    expect(label()).toBe('3 words');
    vi.advanceTimersByTime(IDLE_MS);
    expect(label()).toBe('4 words');
    select(5, 13);
    vi.advanceTimersByTime(IDLE_MS);
    expect(label()).toBe('2 of 4 words');
  });

  it('does nothing for a change that is neither of the text nor of the selection', () => {
    const { editor, label, words } = setup('One two three');
    words.refresh();
    vi.advanceTimersByTime(0);
    const before = vi.mocked(newestView).mock.calls.length;
    editor.view.dispatch({ scrollIntoView: true });
    vi.advanceTimersByTime(IDLE_MS * 2);
    expect(vi.mocked(newestView).mock.calls.length).toBe(before);
    expect(label()).toBe('3 words');
  });

  it('reads the text again only when it has changed, not when the selection moves', () => {
    // Moving through a long file would otherwise read all of it at every stop.
    const { editor, words, select } = setup('One two three four five');
    words.refresh();
    vi.advanceTimersByTime(0);
    const reads = () => vi.mocked(newestView).mock.calls.length;
    const first = reads();
    select(4, 7);
    vi.advanceTimersByTime(IDLE_MS);
    select(0, 3);
    vi.advanceTimersByTime(IDLE_MS);
    expect(reads()).toBe(first);
    editor.view.dispatch({ changes: { from: 0, insert: 'x ' } });
    vi.advanceTimersByTime(IDLE_MS);
    expect(reads()).toBe(first + 1);
  });

  it('keeps what the editor scrolls to clear of the fade while the count is shown', () => {
    // A caret scrolled into view from below would otherwise rest under the fade, where the line
    // being typed is gone.
    const { parent, bottomMargin, words } = setup('One two three');
    const footer = parent.querySelector<HTMLElement>('.rl-footer')!;
    footer.getBoundingClientRect = () => new DOMRect(0, 0, 800, 44);
    expect(bottomMargin()).toBe(44);
    words.setVisible(false);
    expect(bottomMargin()).toBe(0);
    words.setVisible(true);
    expect(bottomMargin()).toBe(44);
  });
});
