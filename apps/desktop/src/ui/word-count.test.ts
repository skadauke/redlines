// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWordCount, IDLE_MS, wordCountLabel, wordsIn } from './word-count.ts';

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
    document.body.append(parent);
    const counted = { total, selected: null as number | null };
    const count = vi.fn(() => ({ ...counted }));
    const words = createWordCount(parent, { count }, { visible });
    const label = () => parent.querySelector<HTMLElement>('.rl-word-count');
    const footer = () => parent.querySelector<HTMLElement>('.rl-footer');
    return { parent, words, count, counted, label, footer };
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

  it('takes its element and its timer away with it', () => {
    const { parent, words, count } = setup();
    words.schedule();
    words.destroy();
    vi.advanceTimersByTime(IDLE_MS * 2);
    expect(count).not.toHaveBeenCalled();
    expect(parent.querySelector('.rl-footer')).toBeNull();
  });

  it('is no part of what assistive technology announces as it changes', () => {
    const { label } = setup();
    expect(label()?.getAttribute('aria-live')).not.toBe('assertive');
    expect(label()?.getAttribute('role')).toBeNull();
  });
});
