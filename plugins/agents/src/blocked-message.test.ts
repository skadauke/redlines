import { describe, expect, it } from 'vitest';
import { blockedMessage, privacyMessage } from './blocked-message.ts';
import type { BlockedNotice } from './runs.ts';

const base: BlockedNotice = {
  agent: 'claude',
  agentName: 'Claude',
  thread: 'c1',
  path: '/Users/ada/Documents/plan.md',
  cause: 'privacy',
  place: 'Documents',
};

describe('blockedMessage', () => {
  it('says which folder macOS is holding back, and offers System Settings', () => {
    expect(blockedMessage(base)).toEqual({
      text: 'macOS isn’t letting Redlines read your Documents folder.',
      action: { label: 'Open System Settings', do: 'privacy-settings' },
    });
    for (const place of ['Desktop', 'Downloads']) {
      expect(blockedMessage({ ...base, place }).text).toBe(
        `macOS isn’t letting Redlines read your ${place} folder.`,
      );
    }
    // The other places are named as they are.
    for (const place of ['iCloud Drive', 'Dropbox', 'Backup']) {
      expect(blockedMessage({ ...base, place }).text).toBe(
        `macOS isn’t letting Redlines read ${place}.`,
      );
    }
    expect(blockedMessage({ ...base, place: undefined }).text).toBe(
      'macOS isn’t letting Redlines read ~/Documents/plan.md.',
    );
  });

  it('says which file the permissions refuse, with no button', () => {
    const message = blockedMessage({
      ...base,
      cause: 'permission',
      path: '/Users/ada/Shared/report.md',
    });
    expect(message).toEqual({ text: 'You don’t have permission to read ~/Shared/report.md.' });
  });

  it('says the agent’s settings refused it, and that an organization’s can', () => {
    expect(blockedMessage({ ...base, cause: 'settings', path: '/Users/ada/Notes' }).text).toBe(
      'Claude’s settings don’t allow reading ~/Notes. An organization’s settings can do this.',
    );
  });

  it('gives the agent’s own words for any other cause, with its log', () => {
    expect(
      blockedMessage({
        ...base,
        cause: 'other',
        path: '/Users/ada/code/a.md',
        words: 'EIO: i/o error',
        logPath: '/logs/run.jsonl',
      }),
    ).toEqual({
      text: 'Claude couldn’t read ~/code/a.md: EIO: i/o error.',
      action: { label: 'Show log', do: 'log' },
    });
    const bare = blockedMessage({ ...base, cause: 'other', path: '/Users/ada/code/a.md' });
    expect(bare).toEqual({ text: 'Claude couldn’t read ~/code/a.md.' });
  });

  it('shortens a long path from its folder, and keeps the file', () => {
    const long = blockedMessage({
      ...base,
      cause: 'permission',
      path: '/Users/ada/a/very/deep/folder/of/many/parts/that/goes/on/report-final.md',
    });
    expect(Array.from(long.text).length).toBeLessThanOrEqual(90);
    expect(long.text).toContain('report-final.md');
    expect(long.text).toContain('…');
  });

  it('names a path outside the home folder as it is', () => {
    expect(
      blockedMessage({ ...base, cause: 'permission', path: '/Volumes/Backup/a.md' }).text,
    ).toBe('You don’t have permission to read /Volumes/Backup/a.md.');
  });
});

describe('privacyMessage', () => {
  it('says the folder in the words people know it by, and offers System Settings', () => {
    expect(privacyMessage('/Users/ada/Documents', 'Documents')).toEqual({
      text: 'macOS isn’t letting Redlines read your Documents folder.',
      action: { label: 'Open System Settings', do: 'privacy-settings' },
    });
    expect(privacyMessage('/Users/ada/Library/Mobile Documents', 'iCloud Drive').text).toBe(
      'macOS isn’t letting Redlines read iCloud Drive.',
    );
    expect(privacyMessage('/Users/ada/Documents/x').text).toBe(
      'macOS isn’t letting Redlines read ~/Documents/x.',
    );
  });
});
