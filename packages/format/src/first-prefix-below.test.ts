// Backspace at a file's first item with Track Changes on: the marker is taken out as a deletion of
// the prefix (#248), also under front matter and over another person's pending insertion, which
// reads alike in every order of decisions (#291).
import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { EditError } from './errors.ts';
import { expectEveryOrderRead } from './oracle.ts';
import { ada, bodyOf, context, expectNoDecisionRefused, file } from './test-helpers.ts';
import { trackedEdit } from './track.ts';

const IDS = ['m1aa', 'm2bb', 'm3cc', 'm4dd'];

/** Backspace at the start of the first item: its `- ` deleted. */
function backspace(text: string): string {
  const from = text.indexOf('- one');
  return applyChanges(
    text,
    trackedEdit(text, { from, to: from + 2, insert: '' }, context(ada, IDS)),
  );
}

describe('the marker of a file’s first item taken out with Track Changes on (#291)', () => {
  const cases: [string, string, Record<string, string>][] = [
    ['under front matter', '---\ntitle: T\n---\n\n- one\n- three', {}],
    ['under front matter, one item', '---\ntitle: T\n---\n\n- one', {}],
    [
      'above another person’s inserted item',
      '- one<!--ins s3vb-->\n- two<!--/s3vb-->\n- three',
      { s3vb: 'bo' },
    ],
  ];
  for (const [name, body, by] of cases) {
    it(`${name}: written, read alike in every order, and no decision refused`, () => {
      const text = file(body, by);
      const after = backspace(text);
      expect(bodyOf(after)).toContain('<!--del');
      expectEveryOrderRead(`291 ${name}`, after);
      expectNoDecisionRefused(`291 ${name}`, after);
    });
  }

  it('says why when another person’s split is in the lines of the item', () => {
    const text = file('- one<!--split s3vb-->\n  more\n- three', { s3vb: 'bo' });
    expect(() => backspace(text)).toThrow(EditError);
    try {
      backspace(text);
    } catch (error) {
      expect((error as Error).message).toMatch(/^The next lines would read as part of this text/);
    }
  });
});
