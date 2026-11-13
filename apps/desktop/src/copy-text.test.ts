// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyText } from './copy-text.ts';

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('copyText', () => {
  it('uses the clipboard where the page may', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    await copyText('brew install --cask codex');
    expect(writeText).toHaveBeenCalledWith('brew install --cask codex');
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('selects the text in a field and copies it where the clipboard refuses, and tidies up', async () => {
    vi.stubGlobal('navigator', {
      clipboard: { writeText: () => Promise.reject(new Error('NotAllowedError')) },
    });
    let copied = '';
    document.execCommand = vi.fn((command: string) => {
      const field = document.querySelector('textarea');
      copied = field?.value ?? '';
      expect(field?.selectionStart).toBe(0);
      expect(field?.selectionEnd).toBe(copied.length);
      return command === 'copy';
    });
    await copyText('curl -fsSL https://claude.ai/install.sh | bash');
    expect(copied).toBe('curl -fsSL https://claude.ai/install.sh | bash');
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('works with no clipboard at all', async () => {
    vi.stubGlobal('navigator', {});
    document.execCommand = vi.fn(() => true);
    await expect(copyText('x')).resolves.toBeUndefined();
  });

  it('rejects when nothing could copy it, leaving no field behind', async () => {
    vi.stubGlobal('navigator', {});
    document.execCommand = vi.fn(() => false);
    await expect(copyText('x')).rejects.toThrow('Couldn’t copy.');
    expect(document.querySelector('textarea')).toBeNull();
  });
});
