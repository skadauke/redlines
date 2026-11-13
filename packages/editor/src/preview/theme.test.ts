// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { trackedThemeSpec } from '../tracked/decorations.ts';
import { baseThemeSpec, space, textPx } from './theme.ts';

const s = textPx;

describe('the column', () => {
  it('makes the column the measure times the text size, between margins that grow above 100%', () => {
    expect(s(16)).toBe('calc(16px * var(--rl-text-scale, 1))');
    expect(baseThemeSpec['.cm-content']).toMatchObject({
      maxWidth: 'calc(var(--rl-column) * var(--rl-text-scale, 1) + 2 * var(--rl-margin, 24px))',
      padding: `${s(32)} var(--rl-margin, 24px) 30vh`,
    });
  });

  it('writes every length inside the column times the text size', () => {
    const spec = baseThemeSpec;
    expect(spec['.rl-quote']).toMatchObject({ paddingLeft: s(18) });
    expect(spec['.rl-image-own']).toMatchObject({ padding: `${s(6)} 0` });
    expect(spec['.rl-codeblock, .rl-frontmatter']).toMatchObject({ padding: `0 ${s(16)}` });
    expect(spec['.rl-tbl-scroll']).toMatchObject({
      margin: '0 0 0 -24px',
      padding: `${s(6)} 0 ${s(6)} 24px`,
    });
    expect(spec['.rl-tc']).toMatchObject({
      padding: `${s(10)} ${s(16)} ${s(10)} 0`,
    });
    expect(spec['.rl-th .rl-tc']).toMatchObject({ paddingBottom: s(8) });
  });

  it("draws the space between blocks from the theme's tokens, times the text size", () => {
    const spec = baseThemeSpec;
    for (const [kind, px] of [
      ['block', 16],
      ['h1', 18],
      ['heading', 10],
      ['item', 6],
      ['loose', 16],
    ] as const) {
      const length = `calc(var(--rl-space-${kind}, ${px}px) * var(--rl-text-scale, 1))`;
      expect(space(kind)).toBe(length);
      expect(spec[`.cm-line.rl-space-${kind}`]).toEqual({
        paddingTop: `calc(${length} + var(--rl-above, 0px))`,
      });
      expect(spec[`.cm-line.rl-space-${kind}-below`]).toEqual({ paddingBottom: length });
    }
    // A heading keeps its own space above it, added to the space between blocks.
    expect(spec['.rl-h2']).toMatchObject({ '--rl-above': '0.8em', paddingTop: 'var(--rl-above)' });
  });

  it('gives Raw its column times the text size, and leaves the change bars where they are', () => {
    expect(trackedThemeSpec['&.rl-view-raw .cm-content']).toMatchObject({
      maxWidth: 'calc(760px * var(--rl-text-scale, 1) + 2 * var(--rl-margin, 24px))',
      paddingTop: s(40),
      fontSize: 'calc(13.5px * var(--rl-text-scale, 1))',
    });
    // A struck block's bar; the bars of the text are the layer's (bar-layer.test.ts).
    expect(trackedThemeSpec['.rl-bar:not(.cm-line)::before']).toMatchObject({
      left: '-24px',
      width: '2px',
    });
  });
});
