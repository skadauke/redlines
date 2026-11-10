// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { trackedThemeSpec } from '../tracked/decorations.ts';
import { baseThemeSpec, textPx } from './theme.ts';

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
    expect(spec['.cm-line.rl-gap']).toEqual({ lineHeight: s(16) });
    expect(spec['.cm-line.rl-h1 + .cm-line.rl-gap']).toEqual({ lineHeight: s(18) });
    const lower = ['h2', 'h3', 'h4', 'h5', 'h6']
      .map((h) => `.cm-line.rl-${h} + .cm-line.rl-gap`)
      .join(', ');
    expect(spec[lower]).toEqual({ lineHeight: s(10) });
    expect(spec['.rl-quote']).toMatchObject({ paddingLeft: s(18) });
    expect(spec['.rl-image-own']).toMatchObject({ padding: `${s(6)} 0` });
    expect(spec['.cm-line.rl-li + .cm-line.rl-li']).toEqual({ paddingTop: s(6) });
    expect(spec['.rl-codeblock, .rl-frontmatter']).toMatchObject({ padding: `0 ${s(16)}` });
    expect(spec['.rl-table']).toMatchObject({
      margin: '0 0 0 -24px',
      padding: `${s(6)} 0 ${s(6)} 24px`,
    });
    expect(spec['.rl-table th, .rl-table td']).toMatchObject({
      padding: `${s(10)} ${s(16)} ${s(10)} 0`,
    });
    expect(spec['.rl-table th']).toMatchObject({ paddingBottom: s(8) });
  });

  it('gives Raw its column times the text size, and leaves the change bars where they are', () => {
    expect(trackedThemeSpec['&.rl-view-raw .cm-content']).toMatchObject({
      maxWidth: 'calc(760px * var(--rl-text-scale, 1) + 2 * var(--rl-margin, 24px))',
      paddingTop: s(40),
      fontSize: 'calc(13.5px * var(--rl-text-scale, 1))',
    });
    expect(trackedThemeSpec['.rl-bar::before']).toMatchObject({ left: '-24px', width: '2px' });
  });
});
