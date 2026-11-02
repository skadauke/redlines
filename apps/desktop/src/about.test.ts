import { invoke } from '@tauri-apps/api/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { aboutMetadata, loadAbout } from './about.ts';

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
    // On a Mac the standard About panel reads "Version 0.1.0 (1a2b3c4)", from the version and the
    // short version; Windows and Linux show "0.1.0 (1a2b3c4)".
    expect(aboutMetadata({ name: 'Redlines', version: '0.1.0', build: '1a2b3c4' })).toEqual({
      name: 'Redlines',
      version: '0.1.0',
      shortVersion: '1a2b3c4',
    });
    expect(
      aboutMetadata({ name: 'Redlines', version: '0.1.0-dev', build: '1a2b3c4-20261101.1430' }),
    ).toEqual({ name: 'Redlines', version: '0.1.0-dev', shortVersion: '1a2b3c4-20261101.1430' });
  });
});
