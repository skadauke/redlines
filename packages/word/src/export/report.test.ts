import { describe, expect, it } from 'vitest';
import { exportReport } from './report.ts';

describe('exportReport', () => {
  it('is empty for text alone', () => {
    expect(exportReport('Hello **world**.\n').entries).toEqual([]);
  });
  it('names images, but not those in code', () => {
    expect(exportReport('![a](a.png) and ![b](b.png)\n').entries[0]?.message).toBe(
      '2 images are not in the Word file.',
    );
    expect(exportReport('`![a](a.png)`\n\n```\n![b](b.png)\n```\n').entries).toEqual([]);
  });
});
