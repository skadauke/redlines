import { describe, expect, it } from 'vitest';
import { TOO_BROAD_NOTICE, tooBroadNotice } from './project-notice.ts';

describe('the notice for a folder too broad to be a project', () => {
  it('says why a file in the home folder or above opens on its own', () => {
    const notice = tooBroadNotice({ folder: '/Users/ada', isRepo: false, tooBroad: true });
    expect(notice?.text).toBe(TOO_BROAD_NOTICE);
    expect(notice?.text).toMatch(/home folder or above/);
    // It passes by, and a second file in the same place replaces it rather than stacking.
    expect(notice?.timeout).toBeGreaterThan(0);
    expect(notice?.key).toBe('project-too-broad');
  });

  it('says nothing for a project', () => {
    expect(tooBroadNotice({ folder: '/repo', isRepo: true, tooBroad: false })).toBeNull();
  });
});
