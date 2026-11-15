import { describe, expect, it } from 'vitest';
import { createImageWatch } from './image-watch.ts';

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

describe('image watch', () => {
  it('refreshes the image that was saved again and no other', async () => {
    const d = disk({ '/r/a.png': '1', '/r/b.png': '1' });
    const watch = createImageWatch(d.stamps);
    expect(watch.url('/r/a.png', asset('/r/a.png'))).toBe(asset('/r/a.png'));
    expect(watch.url('/r/b.png', asset('/r/b.png'))).toBe(asset('/r/b.png'));
    // Nothing has changed since they were drawn.
    expect(await watch.check()).toEqual([]);
    d.files['/r/a.png'] = '2';
    expect(await watch.check()).toEqual(['/r/a.png']);
    // The changed one loads from another URL, the other from the same.
    expect(watch.url('/r/a.png', asset('/r/a.png'))).toBe(`${asset('/r/a.png')}?v=1`);
    expect(watch.url('/r/b.png', asset('/r/b.png'))).toBe(asset('/r/b.png'));
    // Once told of, it is not told of again until saved again.
    expect(await watch.check()).toEqual([]);
    d.files['/r/a.png'] = '3';
    expect(await watch.check()).toEqual(['/r/a.png']);
    expect(watch.url('/r/a.png', asset('/r/a.png'))).toBe(`${asset('/r/a.png')}?v=2`);
  });

  it('sees a save made right after the image was drawn, since it takes the stamp then', async () => {
    const d = disk({ '/r/a.png': '1' });
    const watch = createImageWatch(d.stamps);
    watch.url('/r/a.png', asset('/r/a.png'));
    await Promise.resolve();
    await Promise.resolve();
    d.files['/r/a.png'] = '2';
    expect(await watch.check()).toEqual(['/r/a.png']);
  });

  it('adds a version to the app’s URLs only', async () => {
    const d = disk({ '/r/a.png': '1' });
    const watch = createImageWatch(d.stamps);
    watch.url('/r/a.png', 'blob:http://localhost/x');
    await watch.check();
    d.files['/r/a.png'] = '2';
    await watch.check();
    expect(watch.url('/r/a.png', 'blob:http://localhost/x')).toBe('blob:http://localhost/x');
    expect(watch.url('/r/a.png', 'http://asset.localhost/r/a.png')).toBe(
      'http://asset.localhost/r/a.png?v=1',
    );
  });

  it('keeps the picture of a file that is gone, and shows one that arrives', async () => {
    const d = disk({ '/r/a.png': '1', '/r/late.png': null });
    const watch = createImageWatch(d.stamps);
    watch.url('/r/a.png', asset('/r/a.png'));
    watch.url('/r/late.png', asset('/r/late.png'));
    await watch.check();
    d.files['/r/a.png'] = null;
    expect(await watch.check()).toEqual([]);
    d.files['/r/late.png'] = '1';
    expect(await watch.check()).toEqual(['/r/late.png']);
  });

  it('forgets the images of the document it was watching', async () => {
    const d = disk({ '/r/a.png': '1' });
    const watch = createImageWatch(d.stamps);
    watch.url('/r/a.png', asset('/r/a.png'));
    await watch.check();
    d.files['/r/a.png'] = '2';
    await watch.check();
    watch.forget();
    expect(watch.url('/r/a.png', asset('/r/a.png'))).toBe(asset('/r/a.png'));
  });

  it('asks about nothing when no image is drawn, and survives a failed ask', async () => {
    const d = disk({});
    const watch = createImageWatch(d.stamps);
    expect(await watch.check()).toEqual([]);
    expect(d.asked).toEqual([]);
    const failing = createImageWatch(() => Promise.reject(new Error('gone')));
    failing.url('/r/a.png', asset('/r/a.png'));
    expect(await failing.check()).toEqual([]);
  });
});
