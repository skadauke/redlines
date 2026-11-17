import { exportDocx } from '@redlines/word';
import { describe, expect, it, vi } from 'vitest';
import type { NotificationOptions } from './ui/notifications.ts';
import { importMessage, openWord } from './word-import.ts';

describe('Open .docx', () => {
  it('opens the file as the text of a new document, and passes by when nothing was lost', async () => {
    const bytes = await exportDocx('Hello **world**.\n');
    const opened: string[] = [];
    const shown: NotificationOptions[] = [];
    const done = await openWord({
      host: { openDocx: () => Promise.resolve({ name: 'plan.docx', bytes }) },
      open: (markdown) => {
        opened.push(markdown);
        return Promise.resolve();
      },
      show: (options) => void shown.push(options),
    });
    expect(done).toBe(true);
    expect(opened[0]).toContain('Hello **world**.');
    expect(shown[0]?.text).toBe('Opened “plan.docx” as a new document.');
    expect(shown[0]?.timeout).toBeDefined();
  });

  it('does nothing when the panel is cancelled', async () => {
    const open = vi.fn(() => Promise.resolve());
    const show = vi.fn();
    const done = await openWord({ host: { openDocx: () => Promise.resolve(null) }, open, show });
    expect(done).toBe(false);
    expect(open).not.toHaveBeenCalled();
    expect(show).not.toHaveBeenCalled();
  });

  it('keeps the card, shortened, when the report has lines', () => {
    const { text, kept } = importMessage('a.docx', ['One.', 'Two.', 'Three.', 'Four.'], 1);
    expect(kept).toBe(true);
    expect(text).toBe('Opened “a.docx” as a new document. One. Two. Three. And 2 more.');
  });
});
