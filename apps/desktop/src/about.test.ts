import { invoke } from '@tauri-apps/api/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadAbout, versionLine } from './about.ts';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

afterEach(() => {
  vi.mocked(invoke).mockReset();
});

describe('About Redlines', () => {
  it('asks the app for its name, version and build', async () => {
    const about = { name: 'Redlines', version: '0.1.0', build: '1a2b3c4' };
    vi.mocked(invoke).mockResolvedValue(about);
    expect(await loadAbout()).toEqual(about);
    // src-tauri/src/lib.rs: about.
    expect(invoke).toHaveBeenCalledWith('about');
  });

  it('shows the build tag as the version and, in parentheses, the build', () => {
    // As the system's panel did: "Version 0.1.0 (1a2b3c4)".
    expect(versionLine({ name: 'Redlines', version: '0.1.0', build: '1a2b3c4' })).toBe(
      'Version 0.1.0 (1a2b3c4)',
    );
    expect(
      versionLine({ name: 'Redlines', version: '0.1.0-dev', build: '1a2b3c4-20261101.1430' }),
    ).toBe('Version 0.1.0-dev (1a2b3c4-20261101.1430)');
  });
});
