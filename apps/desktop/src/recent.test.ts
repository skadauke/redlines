import { describe, expect, it } from 'vitest';
import { addRecent, dropRecent, MAX_RECENT, shownRecent, stillThere } from './recent.ts';

describe('addRecent', () => {
  it('puts the newest first', () => {
    expect(addRecent(['/a.md', '/b.md'], '/c.md')).toEqual(['/c.md', '/a.md', '/b.md']);
  });

  it('moves a file already in the list to the top, once', () => {
    expect(addRecent(['/a.md', '/b.md', '/c.md'], '/b.md')).toEqual(['/b.md', '/a.md', '/c.md']);
  });

  it('keeps at most ten, dropping the oldest', () => {
    const full = Array.from({ length: MAX_RECENT }, (_, i) => `/${i}.md`);
    const next = addRecent(full, '/new.md');
    expect(next).toHaveLength(10);
    expect(next[0]).toBe('/new.md');
    expect(next).not.toContain('/9.md');
  });

  it('does not change the list it is given', () => {
    const list = ['/a.md'];
    addRecent(list, '/b.md');
    expect(list).toEqual(['/a.md']);
  });
});

describe('stillThere', () => {
  it('drops the files that are gone, keeping the order', async () => {
    const there = new Set(['/a.md', '/c.md']);
    const kept = await stillThere(['/a.md', '/b.md', '/c.md'], (path) =>
      Promise.resolve(there.has(path)),
    );
    expect(kept).toEqual(['/a.md', '/c.md']);
  });

  it('counts a file it could not ask about as gone', async () => {
    const kept = await stillThere(['/a.md'], () => Promise.reject(new Error('forbidden')));
    expect(kept).toEqual([]);
  });
});

describe('shownRecent', () => {
  it('shows the documents that are still there, in order, and no other file', async () => {
    // An earlier version could list a file of another kind, which would now open nothing.
    const there = new Set(['/a.md', '/logo.svg', '/c.txt', '/notes', '/e.qmd', '/f.Rmd']);
    const asked: string[] = [];
    const shown = await shownRecent(
      ['/a.md', '/logo.svg', '/c.txt', '/gone.md', '/notes', '/e.qmd', '/f.Rmd'],
      (path) => {
        asked.push(path);
        return Promise.resolve(there.has(path));
      },
    );
    expect(shown).toEqual(['/a.md', '/c.txt', '/e.qmd', '/f.Rmd']);
    // Nothing is asked of a file that isn't a document.
    expect(asked).toEqual(['/a.md', '/c.txt', '/gone.md', '/e.qmd', '/f.Rmd']);
  });
});

describe('dropRecent', () => {
  it('takes a file out and leaves the order of the rest', () => {
    expect(dropRecent(['/a.md', '/b.md', '/c.md'], '/b.md')).toEqual(['/a.md', '/c.md']);
    expect(dropRecent(['/a.md'], '/z.md')).toEqual(['/a.md']);
  });
});
