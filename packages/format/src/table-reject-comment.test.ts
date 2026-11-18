// A comment in the new text of another person's replacement of a whole table: rejecting the replacement is not
// refused (#265). The comment's opener is carried into the restored table, and read there.

import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { accept, reject, rejectAll } from './decide.ts';
import { expectEveryOrderRead } from './oracle.ts';
import { parse } from './parse.ts';
import { file, thread } from './test-helpers.ts';
import { newestView, originalView } from './views.ts';

describe('rejecting the replacement of a table that holds a comment (#265)', () => {
  const text = file(
    'Intro words.\n\n<!--sub k3x9 \\| a \\|\\n\\| - \\|\\n\\| b \\|\\n-->\n| a |\n| - |\n| <!--cmt n3pq-->b<!--/n3pq--> |\n<!--/k3x9-->\n\nOutro words.',
    { k3x9: 'bo' },
    thread('n3pq', 'ada', 'A note.', ['quote: |-', '  b']),
  );

  it('is decided, and the original table comes back', () => {
    const rejected = applyChanges(text, reject(text, 'k3x9'));
    expect(originalView(rejected).text).toContain('| b |');
    expect(originalView(rejected).text).toBe(originalView(text).text);
    expect(parse(rejected).marks.map((mark) => mark.id)).toContain('n3pq');
    expect(newestView(applyChanges(text, accept(text, 'k3x9'))).text).toContain('b');
    expect(() => applyChanges(text, rejectAll(text))).not.toThrow();
    expectEveryOrderRead('rejected', text);
  }, 60_000);
});
