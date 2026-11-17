// Typing in a one-line HTML block (#854): the write reads as the newest view in every order.
import { describe, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { expectEveryOrderRead, expectSound } from './oracle.ts';
import { ada, context, file } from './test-helpers.ts';
import { trackedEdits } from './track.ts';

describe('typing in a one-line HTML block', () => {
  it('a letter in a tag', () => {
    const start = file('<div>\n\nmore</div>\n');
    const changes = trackedEdits(
      start,
      [{ from: 1, to: 1, insert: 'x' }],
      context(ada, ['m2bd']),
    ).changes;
    const after = applyChanges(start, changes);
    expectEveryOrderRead('letter in a tag', after);
    expectSound('letter in a tag', after);
  });
});
