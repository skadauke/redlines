import { describe, expect, it, vi } from 'vitest';
import { createImageSizes } from './image-sizes.ts';

describe('image sizes', () => {
  it('asks once for the images asked about together, and keeps the answer', async () => {
    const ask = vi.fn((paths: string[]) =>
      Promise.resolve(paths.map((path) => (path === '/a.png' ? { width: 3, height: 2 } : null))),
    );
    const sizes = createImageSizes(ask);
    const [a, b] = await Promise.all([sizes.of('/a.png'), sizes.of('/b.png')]);
    expect(a).toEqual({ width: 3, height: 2 });
    expect(b).toBeNull();
    // An unknown size is asked again, a known one is kept.
    await sizes.of('/b.png');
    expect(ask).toHaveBeenCalledTimes(2);
    expect(ask).toHaveBeenCalledWith(['/a.png', '/b.png']);
    // Known now: no promise, no call.
    expect(sizes.of('/a.png')).toEqual({ width: 3, height: 2 });
    expect(ask).toHaveBeenCalledTimes(2);
    sizes.forget(['/a.png']);
    await sizes.of('/a.png');
    expect(ask).toHaveBeenCalledTimes(3);
    sizes.forget();
    await sizes.of('/a.png');
    expect(ask).toHaveBeenCalledTimes(4);
  });

  it('answers null when the app can’t', async () => {
    const sizes = createImageSizes(() => Promise.reject(new Error('no')));
    expect(await sizes.of('/a.png')).toBeNull();
  });
});
