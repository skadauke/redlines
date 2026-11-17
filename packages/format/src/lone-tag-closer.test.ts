// A whole tag alone on its line after a blank line is an HTML block (CommonMark's seventh kind).
// Replaced with Track Changes on, its closer goes on the next line (#628), so that the file reads
// the tag as a block, as the newest view does.

import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { expectSound, readsAsNewest } from './oracle.ts';
import { ada, context, file } from './test-helpers.ts';
import { trackedEdit } from './track.ts';

describe('replacing a lone image by a lone tag, Track Changes on', () => {
  it.each([
    'One.\n\n![A cat](a.png)\n\nTwo.',
    '![A cat](a.png)\n\nTwo.',
    'One.\n\n![A cat](a.png)',
  ])('%j puts the closer on the line after the tag', (body) => {
    const before = file(body);
    const from = body.indexOf('!');
    const to = from + '![A cat](a.png)'.length;
    const insert = '<img src="a.png" alt="A cat" width="360">';
    const after = applyChanges(
      before,
      trackedEdit(before, { from, to, insert }, context(ada, ['m2bd', 'n8fx'])),
    );
    expect(after).toMatch(/<img [^>]*>\n<!--\/m2bd-->/);
    expect(readsAsNewest(after)).toBe(true);
    expectSound(body, after);
  });
});
