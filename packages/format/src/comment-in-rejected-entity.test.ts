// A comment's marker never stands inside an HTML entity, a tag or a link's syntax, also where rejecting
// pending deletions puts the construct together around it (#467, format §3.1): the marker moves to the
// construct's nearest edge, and every order of decisions reads alike.

import { describe, expect, it } from 'vitest';
import { addComment } from './comments.ts';
import { applyChanges } from './changes.ts';
import { expectEveryOrderRead, expectSound } from './oracle.ts';
import { ada, bo, context, file } from './test-helpers.ts';
import { trackedEdits } from './track.ts';

const body = (text: string) => text.split('<!-- redlines')[0] ?? '';

/** Bo deletes `gone` (a piece of the first cell's text), Ada comments on `on`, Bo deletes `then`. */
function build(cell: string, steps: { gone: string; on: string; then?: string }) {
  let text = file(`| café | ${cell} |\n| :---- | :-- |\n| b | 11 |`);
  const del = (piece: string, ids: string[]) => {
    const at = text.indexOf(piece, text.indexOf(cell.slice(0, 1)));
    const { changes } = trackedEdits(
      text,
      [{ from: at, to: at + piece.length, insert: '' }],
      context(bo, ids),
    );
    text = applyChanges(text, changes);
  };
  del(steps.gone, ['m5nn']);
  const at = text.indexOf(steps.on, text.indexOf('-->') + 3);
  const { changes } = addComment(
    text,
    { from: at, to: at + steps.on.length },
    'note',
    context(ada, ['q6rs']),
  );
  text = applyChanges(text, changes);
  if (steps.then) del(steps.then, ['c2dd']);
  return text;
}

describe('a comment between the pieces of a construct that deletions cut (#467)', () => {
  it('moves the comment out of the entity of the issue, and reads alike in every order', () => {
    const text = build('&amp;', { gone: '&a', on: 'p;', then: ';' });
    expect(body(text)).not.toMatch(/&am<!--cmt/);
    expectEveryOrderRead('entity', text);
    expectSound('entity', text);
  });

  it('does the same for a tag cut by a deletion', () => {
    const text = build('<b>x</b>', { gone: '<b', on: '>x', then: undefined });
    expectEveryOrderRead('tag', text);
  });

  it('does the same for a link cut by a deletion', () => {
    const text = build('[b](c)', { gone: 'b]', on: '(c)' });
    expectEveryOrderRead('link', text);
  });

  it('leaves a comment in a construct that no deletion cuts where it was', () => {
    const text = build('see &amp; and more', { gone: 'see ', on: 'and' });
    expect(body(text)).toContain('<!--cmt q6rs-->and');
  });
});
