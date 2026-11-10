import { describe, expect, it } from 'vitest';
import * as format from './index.ts';
import { ada, context, file } from './test-helpers.ts';
import type { TrackedEdits } from './index.ts';

describe('the public interface', () => {
  it('exports the functions that the editor and the command line call', () => {
    for (const name of [
      'accept',
      'acceptAll',
      'addComment',
      'agentWorkOf',
      'applyChanges',
      'deleteThread',
      'formatChange',
      'idsIn',
      'isDecidable',
      'newestView',
      'originalView',
      'parse',
      'rangeEdge',
      'reject',
      'rejectAll',
      'reopen',
      'reply',
      'resolve',
      'reviewView',
      'suggestReplace',
      'trackedEdit',
      'trackedEdits',
      'untrackedEdit',
    ] as const) {
      expect(typeof format[name], name).toBe('function');
    }
  });

  it('makes several edits at once with trackedEdits, as the type TrackedEdits tells', () => {
    const before = file('One two three.');
    const result: TrackedEdits = format.trackedEdits(
      before,
      [
        { from: 0, to: 0, insert: 'So ' },
        { from: 8, to: 13, insert: 'four' },
      ],
      context(ada, ['k3x9', 'w8nn']),
    );
    expect(result.markIds).toEqual(['k3x9', 'w8nn']);
    expect(result.extendedIds).toEqual([]);
    const after = format.applyChanges(before, result.changes);
    expect(format.newestView(after).text).toBe('So One two four.\n');
    expect(format.originalView(after).text).toBe('One two three.\n');
  });
});
