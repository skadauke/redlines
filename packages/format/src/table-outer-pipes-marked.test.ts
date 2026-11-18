// A deletion that empties the last cell of a bare header while a marker stays in the cell, or the only cell of
// a header with one pipe (#428): the closing pipe it needs is written plain, in both versions, so that every
// view and every order of decisions reads one table (format §3.7, rule 7).
import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { expectEveryOrderRead, readAs } from './oracle.ts';
import { trackedEdit } from './track.ts';
import { untrackedEdit } from './untracked.ts';
import { bo, bodyOf, context, file } from './test-helpers.ts';
import { newestView, originalView } from './views.ts';

const shapes: { label: string; body: string; cut: string; marks: Record<string, string> }[] = [
  {
    label: 'another person’s pending insertion in the cell',
    body: 'a | <!--ins k3x9-->é<!--/k3x9-->\n--- | ---\nc | d',
    cut: 'é',
    marks: { k3x9: 'ada' },
  },
  {
    label: 'a comment’s point after the text',
    body: 'a | b<!--cmt q6rs-->\n--- | ---\nc | d',
    cut: 'b',
    marks: {},
  },
  {
    label: 'a header of one cell, with a leading pipe',
    body: '| a b\n| ---\n| c',
    cut: 'a b',
    marks: {},
  },
  {
    label: 'a header of one cell, with a closing pipe',
    body: 'a b |\n--- |\nc |',
    cut: 'a b',
    marks: {},
  },
];

describe('a deletion that empties the last cell of a bare header that holds a marker, or one cell (#428)', () => {
  for (const { label, body, cut, marks } of shapes) {
    for (const tracked of [false, true]) {
      it(`writes the pipe it needs, ${tracked ? 'tracked' : 'plain'}: ${label}`, () => {
        const text = file(body, marks);
        const at = bodyOf(text).indexOf(cut);
        const edit = { from: at, to: at + cut.length, insert: '' };
        const done = applyChanges(
          text,
          tracked
            ? trackedEdit(text, edit, context(bo, ['n3pq', 'r4st']))
            : untrackedEdit(text, edit),
        );
        expect(readAs(newestView(done).text)).toMatch(/^<table/);
        expect(readAs(originalView(done).text)).toMatch(/^<table/);
        expectEveryOrderRead(label, done);
      });
    }
  }
});
