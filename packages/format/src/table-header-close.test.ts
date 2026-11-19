// A decision that empties the last cell of a header with no pipe at its end writes the pipe the cell
// needs (#428): rejecting the author's own insertion that is all the text of the last cell, for one.
// Without it the header is a cell less than the delimiter row, and micromark reads no table.

import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { accept, reject } from './decide.ts';
import { expectEveryOrderRead, expectSound } from './oracle.ts';
import { ada, bo, bodyOf, context, file } from './test-helpers.ts';
import { trackedEdits } from './track.ts';
import { newestView } from './views.ts';

const decided = (text: string, id: string, action: 'accept' | 'reject') =>
  applyChanges(text, (action === 'reject' ? reject : accept)(text, id));

const ROWS = '\n| --- | --- |\n| 1 | 2 |\n';

describe('a header whose last cell a decision empties', () => {
  const headers: [string, string, string][] = [
    ['with a leading pipe', '| a | <!--ins k3x9-->é<!--/k3x9-->', '| a | |'],
    ['with no leading pipe', 'a | <!--ins k3x9-->é<!--/k3x9-->', 'a | |'],
    ['with the cell’s text in two parts', '| a | <!--ins k3x9-->é é<!--/k3x9-->', '| a | |'],
  ];
  for (const [name, header, closed] of headers) {
    it(`rejecting the insertion of its text writes the pipe, ${name}`, () => {
      const start = file(header + ROWS.replace('--- | ---', '--- | ---'), { k3x9: '' });
      expectEveryOrderRead(name, start);
      const after = decided(start, 'k3x9', 'reject');
      expect(bodyOf(after).split('\n')[0]).toBe(closed);
      expectSound(name, start);
    });
    it(`accepting it leaves the header as it was, ${name}`, () => {
      const start = file(header + ROWS, { k3x9: '' });
      const after = decided(start, 'k3x9', 'accept');
      expect(bodyOf(after).split('\n')[0]).toBe(header.replace(/<!--[^]*?-->/g, ''));
    });
  }

  it('is left alone where the header keeps its cells', () => {
    const start = file('| a | b <!--ins k3x9-->é<!--/k3x9-->' + ROWS, { k3x9: '' });
    expect(bodyOf(decided(start, 'k3x9', 'reject')).split('\n')[0]).toBe('| a | b ');
  });

  it('is left alone where the header was no table’s', () => {
    // A line over a delimiter row with more cells than it has: a paragraph before and after.
    const start = file('x <!--ins k3x9-->é<!--/k3x9-->' + ROWS, { k3x9: '' });
    expect(bodyOf(decided(start, 'k3x9', 'reject')).split('\n')[0]).toBe('x ');
  });
});

describe('a key that empties the last cell of a bare header (the half of #428 that #1055 fixed)', () => {
  const emptied = (header: string, marks: Record<string, string> = {}) => {
    const start = file(header + ROWS, marks);
    const view = newestView(start).text;
    const from = view.indexOf('é');
    const changes = trackedEdits(
      start,
      [{ from, to: from + 1, insert: '' }],
      context(ada, ['p5qm', 'q6rs', 'c2dd']),
    ).changes;
    return applyChanges(start, changes);
  };

  it('writes the pipe where another person’s pending deletion stays in the cell', () => {
    const after = emptied('| a | é<!--del w8nn  x-->', { w8nn: '' });
    expectEveryOrderRead('marker stays', after);
  });

  it('writes the pipe for a header of one cell', () => {
    const start = file('é\n---\n1\n');
    const from = newestView(start).text.indexOf('é');
    const changes = trackedEdits(
      start,
      [{ from, to: from + 1, insert: '' }],
      context(bo, ['p5qm']),
    ).changes;
    expectEveryOrderRead('one cell', applyChanges(start, changes));
  });
});
