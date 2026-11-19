import { describe, expect, it } from 'vitest';
import {
  disagreements,
  judgeDisagreements,
  PROPS,
  SPECIMENS,
  type KnownDisagreement,
  type Style,
} from './sheet.ts';

const style = (over: Partial<Style> = {}): Style => ({
  ...(Object.fromEntries(PROPS.map((p) => [p, 'x'])) as Style),
  outlineStyle: 'none',
  ...over,
});

describe('the sheet of every interface element', () => {
  it('names each specimen once, and gives each a state to start from', () => {
    const names = SPECIMENS.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
    for (const specimen of SPECIMENS) expect(specimen.reach.rest, specimen.name).toBeDefined();
  });

  it('sees siblings that disagree, and says who has which value', () => {
    const styles = {
      'redlines/picture-handle/rest': style({ borderTopLeftRadius: '3px' }),
      'redlines/row-grip/rest': style({ borderTopLeftRadius: '999px' }),
      'redlines/column-grip/rest': style({ borderTopLeftRadius: '999px' }),
    };
    const found = disagreements(styles, 'redlines').filter((d) => d.family === 'handles');
    expect(found).toEqual([
      {
        family: 'handles',
        state: 'rest',
        prop: 'borderTopLeftRadius',
        detail: 'picture-handle: 3px | row-grip, column-grip: 999px',
      },
    ]);
  });

  it('does not count the color of an outline that is not drawn', () => {
    const styles = {
      'redlines/eye-menu-item/keys': style({ outlineColor: 'red', outlineWidth: '3px' }),
      'redlines/palette-item/keys': style({ outlineColor: 'blue', outlineWidth: '1px' }),
    };
    expect(disagreements(styles, 'redlines').filter((d) => d.family === 'focus-ring')).toEqual([]);
  });

  it('compares a row’s hover with its keys', () => {
    const styles = {
      'redlines/eye-menu-item/hover': style({ backgroundColor: 'gray' }),
      'redlines/eye-menu-item/keys': style({ backgroundColor: 'darkgray' }),
    };
    expect(
      disagreements(styles, 'redlines').filter((d) => d.family === 'keys-like-hover'),
    ).toHaveLength(1);
  });

  const known: KnownDisagreement[] = [
    { issue: 1, family: 'handles', props: ['borderTopLeftRadius'], why: 'radii' },
  ];
  const radius = {
    family: 'handles',
    state: 'rest',
    prop: 'borderTopLeftRadius' as const,
    detail: 'a: 1 | b: 2',
  };

  it('passes a known disagreement, fails a new one and a fixed one', () => {
    expect(judgeDisagreements([radius], known)).toEqual({ unknown: [], gone: [] });
    expect(judgeDisagreements([{ ...radius, prop: 'boxShadow' }, radius], known).unknown).toEqual([
      'handles (rest) boxShadow: a: 1 | b: 2',
    ]);
    expect(judgeDisagreements([], known).gone).toEqual([
      expect.stringContaining('#1: handles borderTopLeftRadius agrees now'),
    ]);
  });
});
