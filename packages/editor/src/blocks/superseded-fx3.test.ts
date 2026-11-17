// @vitest-environment happy-dom
// Regression test for a shape of #463 that works now: Return, then Tab, at the end of a nested item
// in a quote leaves the open item out of the file, the caret in it, and Undo giving back the text.
// (The other shape of the issue, an item that holds a quote, is still open.)
import { describe } from 'vitest';
import { scriptRows } from './script.ts';

describe('#463: Return, Tab at the end of a nested item in a quote', () => {
  scriptRows(
    [true, false]
      .flatMap((tc) => [
        {
          name: `Return and Tab leave the open item out of the file, Track Changes ${tc ? 'on' : 'off'}`,
          doc: '> - a⏎>   - b‸⏎>⏎> Para.',
          keys: ['Enter', 'Tab'] as const,
          tc,
          expect: { file: '> - a⏎>   - b⏎>⏎> Para.' },
        },
        {
          name: `Return alone leaves the item open, Track Changes ${tc ? 'on' : 'off'}`,
          doc: '> - a⏎>   - b‸⏎>⏎> Para.',
          keys: ['Enter'] as const,
          tc,
          expect: {},
        },
      ])
      .map((row) => ({ ...row, keys: [...row.keys] })),
  );
});
