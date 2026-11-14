import { describe, expect, it } from 'vitest';
import { ASK_STYLE } from './ask/styles.ts';
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
  it("writes the live line's, the picker's and the Ask bubble's lengths times the note scale", () => {
    for (const style of [LIVE_LINE_STYLE, PICKER_STYLE, ASK_STYLE]) {
      expect(bare(style)).not.toMatch(/\b([2-9]|\d{2,})(\.\d+)?px/);
    }
  });

  it("draws the Ask bubble's lost passages and focus ring in the second ink, which reads", () => {
    // The third ink is 2.6:1 on the page in the light themes and 3.3:1 in the dark ones: too faint
    // for text (4.5:1) and for a ring (3:1) alike. The second is 5:1 or more on the page in every theme.
    expect(ASK_STYLE).toMatch(/\.rl-qa-lost\s*\{\s*color:\s*var\(--rl-ink-2\)/);
    expect(ASK_STYLE).toMatch(
      /\.rl-qa-cite:focus-visible\s*\{\s*outline:\s*2px solid var\(--rl-ink-2\)/,
    );
    expect(ASK_STYLE).not.toMatch(/\.rl-qa-lost[^}]*--rl-ink-3|outline:[^;]*--rl-ink-3/);
  });

  it('hides the words said only to a screen reader, without taking them out of the text', () => {
    const rule = /\.rl-qa-sr\s*\{([^}]*)\}/.exec(ASK_STYLE)?.[1] ?? '';
    expect(rule).toContain('position: absolute');
    expect(rule).toContain('clip-path: inset(50%)');
    expect(rule).toContain('overflow: hidden');
    // Not display: none or visibility: hidden, which a screen reader skips.
    expect(rule).not.toMatch(/display:\s*none|visibility:\s*hidden/);
  });
});
