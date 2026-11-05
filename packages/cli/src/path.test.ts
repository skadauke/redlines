import { describe, expect, it } from 'vitest';
import { basename, dirname, join } from './path.ts';

describe('path', () => {
  it('splits a path into folder and name', () => {
    expect([dirname('a/b/c.md'), basename('a/b/c.md')]).toEqual(['a/b', 'c.md']);
    expect([dirname('c.md'), basename('c.md')]).toEqual(['.', 'c.md']);
    expect([dirname('/c.md'), basename('/c.md')]).toEqual(['/', 'c.md']);
  });

  it('joins a folder and a name', () => {
    expect(join('a/b', 'c')).toBe('a/b/c');
    expect(join('.', 'c')).toBe('c');
    expect(join('/', 'c')).toBe('/c');
    expect(join(dirname('x/y.md'), '.y.md.tmp')).toBe('x/.y.md.tmp');
  });
});
