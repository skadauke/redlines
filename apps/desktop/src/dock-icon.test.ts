import { emit } from '@tauri-apps/api/event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ICON_ROTATION_EVENT, iconRotationLabel, reportIconRotation } from './dock-icon.ts';

vi.mock('@tauri-apps/api/event', () => ({ emit: vi.fn() }));

beforeEach(() => {
  vi.mocked(emit).mockResolvedValue(undefined);
});

afterEach(() => {
  vi.mocked(emit).mockReset();
  vi.restoreAllMocks();
});

describe('the icon setting', () => {
  it('is told to the app as true or false, in the event the app listens for', () => {
    // src-tauri/src/dock_icon.rs listens for this name, and reads the payload as a boolean.
    expect(ICON_ROTATION_EVENT).toBe('icon-rotation');
    reportIconRotation(false);
    reportIconRotation(true);
    expect(emit).toHaveBeenNthCalledWith(1, 'icon-rotation', false);
    expect(emit).toHaveBeenNthCalledWith(2, 'icon-rotation', true);
  });

  it('says in the console, and goes on, when the app cannot be told', async () => {
    const error = new Error('no way to the app');
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(emit).mockRejectedValue(error);
    expect(() => reportIconRotation(true)).not.toThrow();
    await vi.waitFor(() => expect(logged).toHaveBeenCalledOnce());
    expect(logged.mock.calls[0]?.[1]).toBe(error);
  });

  it('is called the Dock icon on a Mac, and the window icon elsewhere', () => {
    const mac =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)';
    const windows =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Edg/130.0';
    const linux = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko)';
    expect(iconRotationLabel(mac)).toBe('Rotate the Dock Icon');
    expect(iconRotationLabel(windows)).toBe('Rotate the Window Icon');
    expect(iconRotationLabel(linux)).toBe('Rotate the Window Icon');
  });
});
