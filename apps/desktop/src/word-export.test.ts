import { describe, expect, it, vi } from 'vitest';
import type { Host } from './host.ts';
import { exportToWord, wordName } from './word-export.ts';
import type { NotificationOptions } from './ui/notifications.ts';

function parts(text: string, saved: string | null) {
  const shown: NotificationOptions[] = [];
  const exportWord = vi.fn<Host['exportWord']>(() => Promise.resolve(saved));
  return {
    shown,
    exportWord,
    parts: {
      host: { exportWord, reveal: vi.fn(() => Promise.resolve()) },
      text,
      name: 'Plan',
      path: '/notes/Plan.md',
      show: (options: NotificationOptions) => void shown.push(options),
      canReveal: true,
    },
  };
}

describe('Export to Word', () => {
  it('names the file after the document', () => {
    expect(wordName('Plan')).toBe('Plan.docx');
    expect(wordName('Plan.md')).toBe('Plan.docx');
  });

  it('writes a Word file from the panel and says so, passing by', async () => {
    const run = parts('Hello.\n', '/notes/Plan.docx');
    expect(await exportToWord(run.parts)).toBe('/notes/Plan.docx');
    const [bytes, name, folder] = run.exportWord.mock.calls[0] ?? [];
    expect([...(bytes?.subarray(0, 2) ?? [])]).toEqual([0x50, 0x4b]);
    expect([name, folder]).toEqual(['Plan.docx', '/notes']);
    expect(run.shown[0]?.text).toBe('Exported to “Plan.docx”.');
    expect(run.shown[0]?.timeout).toBeDefined();
  });

  it('shows nothing when the panel is cancelled', async () => {
    const run = parts('Hello.\n', null);
    expect(await exportToWord(run.parts)).toBeNull();
    expect(run.shown).toEqual([]);
  });

  it('keeps the card, with what Word cannot hold, until it is read', async () => {
    const run = parts('![a](a.png)\n', '/notes/Plan.docx');
    await exportToWord(run.parts);
    expect(run.shown[0]?.text).toContain('One image is not in the Word file.');
    expect(run.shown[0]?.timeout).toBeUndefined();
  });
});
