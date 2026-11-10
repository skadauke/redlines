// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { notePx, reviewThemeSpec } from './styles.ts';

const NOTE = /-?\d+(\.\d+)?px \* var\(--rl-note-scale, 1\)/g;
const WINDOW = 'calc(100vw - 32px)';
const UNSCALED = new Set([
  'border',
  'borderColor',
  'borderStyle',
  'borderWidth',
  'outline',
  'outlineOffset',
  'boxShadow',
  'transition',
]);

const bare = (value: string) => value.replaceAll(NOTE, '').replaceAll(WINDOW, '');

describe('the review styles at a text size', () => {
  it('makes room for a rail that grows with the text, beside a column that does too', () => {
    expect(reviewThemeSpec['&.rl-has-rail .cm-content']).toEqual({
      maxWidth:
        'calc(var(--rl-column) * var(--rl-text-scale, 1) + 2 * var(--rl-margin, 24px) + 292px * var(--rl-note-scale, 1))',
      paddingRight: 'calc(var(--rl-margin, 24px) + 292px * var(--rl-note-scale, 1))',
    });
    expect(reviewThemeSpec['.rl-rail']).toMatchObject({ width: notePx(248) });
  });

  it('writes every length of the notes and cards times the note scale', () => {
    let checked = 0;
    const loose: string[] = [];
    for (const [selector, rule] of Object.entries(reviewThemeSpec)) {
      if (!/rl-(note|card|rail|dot|anchor)/.test(selector)) continue;
      if (/rl-review-bar|rl-bar-/.test(selector)) continue;
      for (const [property, value] of Object.entries(rule as Record<string, unknown>)) {
        if (UNSCALED.has(property) || typeof value !== 'string') continue;
        checked++;
        if (/[1-9]\d*(\.\d+)?px/.test(bare(value))) loose.push(`${selector} ${property}: ${value}`);
      }
    }
    expect(loose).toEqual([]);
    expect(checked).toBeGreaterThan(50);
  });

  it('keeps cards and notes shown from their dots inside the window', () => {
    expect(reviewThemeSpec['.rl-card']).toMatchObject({
      minWidth: `min(${notePx(232)}, ${WINDOW})`,
      maxWidth: `min(${notePx(360)}, ${WINDOW})`,
    });
    expect(reviewThemeSpec['.rl-rail-compact .rl-note']).toMatchObject({
      width: `min(${notePx(248)}, ${WINDOW})`,
    });
  });

  it("keeps the review bar at the interface's own sizes, whatever the text size", () => {
    expect(reviewThemeSpec['.rl-review-bar']).toMatchObject({
      fontSize: 'var(--rl-size-ui)',
      height: '42px',
    });
    expect(reviewThemeSpec['.rl-bar-error']).toMatchObject({ fontSize: 'var(--rl-size-ui)' });
    expect(reviewThemeSpec['.rl-review-bar .rl-hint']).toMatchObject({
      fontSize: 'var(--rl-size-ui-small)',
    });
    for (const [selector, rule] of Object.entries(reviewThemeSpec)) {
      if (/rl-review-bar|rl-bar-/.test(selector)) {
        expect(JSON.stringify(rule), selector).not.toContain('scale');
      }
    }
  });
});
