// The Quick Look preview counts the changes that wait in a file as the editor does
// (apps/desktop/quicklook/src/summary.ts repeats `isChange` of the editor, which draws with
// CodeMirror and a preview takes none of that). This holds the two to each other, for every kind of
// mark, payload and move, from here, where the app has both.

import { isChange as editorIsChange } from '@redlines/editor';
import type { MarkKind, MarkRange } from '@redlines/format';
import { describe, expect, it } from 'vitest';
import { isChange } from '../quicklook/src/summary.ts';

describe('the Quick Look preview’s count of changes', () => {
  /** A mark as the parser makes it, with the one segment that carries its operations. */
  function markOf(
    kind: MarkKind,
    payload: string | undefined,
    move: string | undefined,
  ): MarkRange {
    const segment = {
      open: { from: 0, to: 1 },
      content: { from: 1, to: 1 },
      ...(payload === undefined ? {} : { payload }),
    };
    return {
      id: 'k3x9',
      kind,
      ...(payload === undefined ? {} : { payload }),
      segments: [segment],
      entry: { by: 'ada', at: '2026-10-13T22:30Z', ...(move === undefined ? {} : { move }) },
    };
  }

  const kinds: MarkKind[] = ['ins', 'del', 'sub', 'fmt', 'hl', 'cmt', 'split'];
  const payloads = [
    undefined,
    'row',
    'col',
    'row=Ab',
    'col=Ab',
    'x',
    '+bold',
    '-bold',
    '+link=u',
    '?junk',
  ];

  it('is the editor’s, for every kind of mark, payload and move', () => {
    let counted = 0;
    for (const kind of kinds) {
      for (const payload of payloads) {
        for (const move of [undefined, 'p7qd']) {
          const mark = markOf(kind, payload, move);
          expect(isChange(mark), `${kind} ${payload ?? '-'} ${move ?? '-'}`).toBe(
            editorIsChange(mark),
          );
          if (isChange(mark)) counted++;
        }
      }
    }
    // The grid has both answers in it.
    expect(counted).toBeGreaterThan(10);
    expect(counted).toBeLessThan(kinds.length * payloads.length * 2 - 10);
  });

  it('counts a moved row as one change: the row at its new place', () => {
    expect(isChange(markOf('ins', 'row', 'p7qd'))).toBe(true);
    expect(isChange(markOf('del', 'row=Ab', 'p7qd'))).toBe(false);
    expect(isChange(markOf('del', 'row=Ab', undefined))).toBe(true);
  });
});
