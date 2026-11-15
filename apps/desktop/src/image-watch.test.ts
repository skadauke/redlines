import { afterEach, describe, expect, it, vi } from 'vitest';
import { createImageWatch, type ImageWatch } from './image-watch.ts';

/** A disk of image files, each with the stamp it would have. */
function disk(files: Record<string, string | null>) {
  const asked: string[][] = [];
  return {
    files,
    asked,
    stamps: (paths: string[]) => {
      asked.push(paths);
      return Promise.resolve(paths.map((path) => files[path] ?? null));
    },
  };
}

const asset = (path: string) => `asset://localhost${path}`;

/** The window regains the focus: the images are drawn again (`draw` says which), then looked at. */
async function focus(watch: ImageWatch, draw: string[]): Promise<string[]> {
  watch.begin();
  for (const path of draw) watch.url(path, asset(path));
  return watch.check();
}

afterEach(() => vi.useRealTimers());

describe('image watch', () => {
  it('refreshes the image that was saved again and no other', async () => {
    const d = disk({ '/r/a.png': '1', '/r/b.png': '1' });
    const watch = createImageWatch(d.stamps);
    const both = ['/r/a.png', '/r/b.png'];
    // Nothing has changed since they were drawn.
    expect(await focus(watch, both)).toEqual([]);
    d.files['/r/a.png'] = '2';
    expect(await focus(watch, both)).toEqual(['/r/a.png']);
    // The changed one loads from another URL, the other from the same.
    expect(watch.url('/r/a.png', asset('/r/a.png'))).toBe(`${asset('/r/a.png')}?v=1`);
    expect(watch.url('/r/b.png', asset('/r/b.png'))).toBe(asset('/r/b.png'));
    // Once told of, it is not told of again until saved again.
    expect(await focus(watch, both)).toEqual([]);
    d.files['/r/a.png'] = '3';
    expect(await focus(watch, both)).toEqual(['/r/a.png']);
    expect(watch.url('/r/a.png', asset('/r/a.png'))).toBe(`${asset('/r/a.png')}?v=2`);
  });

  it('takes the stamp of a new image when the drawing settles, so a quick save is seen', async () => {
    vi.useFakeTimers();
    const d = disk({ '/r/a.png': '1' });
    const watch = createImageWatch(d.stamps);
    watch.url('/r/a.png', asset('/r/a.png'));
    // Drawing asks for nothing.
    expect(d.asked).toEqual([]);
    watch.settle();
    await vi.advanceTimersByTimeAsync(1000);
    expect(d.asked).toEqual([['/r/a.png']]);
    d.files['/r/a.png'] = '2';
    expect(await focus(watch, ['/r/a.png'])).toEqual(['/r/a.png']);
  });

  it('adds a version to the app’s URLs only', async () => {
    const d = disk({ '/r/a.png': '1' });
    const watch = createImageWatch(d.stamps);
    await focus(watch, ['/r/a.png']);
    d.files['/r/a.png'] = '2';
    await focus(watch, ['/r/a.png']);
    expect(watch.url('/r/a.png', 'blob:http://localhost/x')).toBe('blob:http://localhost/x');
    expect(watch.url('/r/a.png', 'http://asset.localhost/r/a.png')).toBe(
      'http://asset.localhost/r/a.png?v=1',
    );
  });

  it('keeps the picture of a file that is gone, and shows one that arrives', async () => {
    const d = disk({ '/r/a.png': '1', '/r/late.png': null });
    const watch = createImageWatch(d.stamps);
    const both = ['/r/a.png', '/r/late.png'];
    await focus(watch, both);
    d.files['/r/a.png'] = null;
    expect(await focus(watch, both)).toEqual([]);
    d.files['/r/late.png'] = '1';
    expect(await focus(watch, both)).toEqual(['/r/late.png']);
  });

  it('loads a document that comes back from the version it last showed', async () => {
    const d = disk({ '/r/a.png': '1' });
    const watch = createImageWatch(d.stamps);
    await focus(watch, ['/r/a.png']);
    d.files['/r/a.png'] = '2';
    await focus(watch, ['/r/a.png']);
    // Another document is drawn, and this one comes back: not from the plain URL the webview may
    // still have a copy of.
    watch.forget();
    watch.forget();
    expect(watch.url('/r/a.png', asset('/r/a.png'))).toBe(`${asset('/r/a.png')}?v=1`);
    // And it is watched afresh: nothing is told of until it is saved again.
    expect(await focus(watch, ['/r/a.png'])).toEqual([]);
    d.files['/r/a.png'] = '3';
    expect(await focus(watch, ['/r/a.png'])).toEqual(['/r/a.png']);
    expect(watch.url('/r/a.png', asset('/r/a.png'))).toBe(`${asset('/r/a.png')}?v=2`);
  });

  it('asks only about the images the text shows now', async () => {
    const d = disk({ '/r/a.png': '1', '/r/b.png': '1', '/r/img/c.png': '1' });
    const watch = createImageWatch(d.stamps);
    // A path typed letter by letter is drawn at every step, and one image is taken out.
    for (const partial of ['/r/i', '/r/im', '/r/img', '/r/img/c', '/r/img/c.png']) {
      watch.url(partial, asset(partial));
    }
    watch.url('/r/a.png', asset('/r/a.png'));
    watch.url('/r/b.png', asset('/r/b.png'));
    await focus(watch, ['/r/a.png', '/r/b.png', '/r/img/c.png']);
    d.asked.length = 0;
    // Back to the window, with b.png deleted from the text.
    await focus(watch, ['/r/a.png', '/r/img/c.png']);
    expect(d.asked).toEqual([['/r/a.png', '/r/img/c.png']]);
  });

  it('asks about nothing when no image is drawn, and survives a failed ask', async () => {
    const d = disk({});
    const watch = createImageWatch(d.stamps);
    expect(await focus(watch, [])).toEqual([]);
    expect(d.asked).toEqual([]);
    const failing = createImageWatch(() => Promise.reject(new Error('gone')));
    expect(await focus(failing, ['/r/a.png'])).toEqual([]);
  });
});
