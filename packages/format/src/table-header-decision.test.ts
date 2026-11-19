// The closing pipe of a bare header's last cell (#428). A key that empties the cell writes the pipe it
// needs (#1055: `outerPipeWrites`), so a table that the editor writes never has the header one cell
// short. A decision never writes a pipe: it restores or accepts exactly (docs/hardening.md, all
// rejected gives the original byte for byte), so a hand-made header one cell short, which was no
// table, reads as no table again once its insertion is rejected.

import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { accept, reject } from './decide.ts';
import { expectEveryOrderRead } from './oracle.ts';
import { ada, bo, bodyOf, context, file } from './test-helpers.ts';
import { trackedEdits } from './track.ts';
import { newestView } from './views.ts';

const decided = (text: string, id: string, action: 'accept' | 'reject') =>
  applyChanges(text, (action === 'reject' ? reject : accept)(text, id));

const ROWS = '\n| --- | --- |\n| 1 | 2 |\n';

describe('a decision on a header whose last cell an insertion holds, in a hand-made file', () => {
  const headers: [string, string, string][] = [
    ['with a leading pipe', '| a | <!--ins k3x9-->é<!--/k3x9-->', '| a | '],
    ['with no leading pipe', 'a | <!--ins k3x9-->é<!--/k3x9-->', 'a | '],
    ['with the cell’s text in two parts', '| a | <!--ins k3x9-->é é<!--/k3x9-->', '| a | '],
  ];
  for (const [name, header, original] of headers) {
    it(`rejecting it restores the original exactly, with no pipe written, ${name}`, () => {
      const start = file(header + ROWS, { k3x9: '' });
      const after = decided(start, 'k3x9', 'reject');
      expect(bodyOf(after).split('\n')[0]).toBe(original);
      expect(bodyOf(after)).toBe(`${original}${ROWS}`.replace(/\n$/, '\n\n'));
    });
    it(`accepting it leaves the header as it was, ${name}`, () => {
      const start = file(header + ROWS, { k3x9: '' });
      const after = decided(start, 'k3x9', 'accept');
      expect(bodyOf(after).split('\n')[0]).toBe(header.replace(/<!--[^]*?-->/g, ''));
    });
  }
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
