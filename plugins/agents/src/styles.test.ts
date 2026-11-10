import { describe, expect, it } from 'vitest';
import { LIVE_LINE_STYLE } from './live-line.ts';
import { PICKER_STYLE } from './picker.ts';

const NOTE = /-?\d+(\.\d+)?px \* var\(--rl-note-scale, 1\)/g;

/** The style with its comments, its borders, its focus rings and its hidden Stop button's 1 px taken out. */
function bare(style: string): string {
  return (
    style
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\b(border|outline|box-shadow)[\w-]*\s*:[^;]*;/g, '')
      // The answer buttons keep their 24 px floor and follow the text size on their own terms.
      .replace(/min-height:\s*max\(24px[^;]*;/g, '')
      .replaceAll(NOTE, '')
  );
}

describe('the agents plugin styles', () => {
  it("writes the live line's and the picker's lengths times the note scale", () => {
    for (const style of [LIVE_LINE_STYLE, PICKER_STYLE]) {
      expect(bare(style)).not.toMatch(/\b([2-9]|\d{2,})(\.\d+)?px/);
    }
  });
});
