// A whole tag alone on its line after a blank line is an HTML block (CommonMark's seventh kind).
// Replaced with Track Changes on, its closer goes on the next line (#628), so that the file reads
// the tag as a block, as the newest view does.

import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { expectSound, readsAsNewest } from './oracle.ts';
import { suggestReplace } from './agent.ts';
import { deleteThread } from './comments.ts';
import { accept, reject } from './decide.ts';
import { ada, bodyOf, context, file, thread } from './test-helpers.ts';
import { trackedEdit } from './track.ts';
import { newestView, originalView } from './views.ts';

describe('replacing a lone image by a lone tag, Track Changes on', () => {
  it.each([
    'One.\n\n![A cat](a.png)\n\nTwo.',
    '![A cat](a.png)\n\nTwo.',
    'One.\n\n![A cat](a.png)',
    '![A cat](a.png)',
    '![A cat](a.png)\n',
    'One.\n\n![A cat](a.png)\n',
    'One.\r\n\r\n![A cat](a.png)\r\n\r\nTwo.',
  ])('%j puts the closer on the line after the tag', (body) => {
    const before = file(body);
    const from = body.indexOf('!');
    const to = from + '![A cat](a.png)'.length;
    const insert = '<img src="a.png" alt="A cat" width="360">';
    const after = applyChanges(
      before,
      trackedEdit(before, { from, to, insert }, context(ada, ['m2bd', 'n8fx'])),
    );
    expect(after).toMatch(/<img [^>]*>\r?\n<!--\/m2bd-->/);
    expect(readsAsNewest(after)).toBe(true);
    expectSound(body, after);
    // The line break in front of the closer is its syntax: no view gains it.
    expect(newestView(after).text).toBe(
      newestView(file(body.replace('![A cat](a.png)', insert))).text,
    );
    expect(originalView(after).text).toBe(originalView(before).text);
  });
});

// A comment, a highlight or an agent's edit around a lone tag whose closer stands on the next line
// (#628): every removal of that closer takes its line break, so no view gains a newline.
describe('a closer on the line after a lone tag, in the paths that remove or read it', () => {
  const tag = '<img src="a.png" alt="A cat" width="360">';
  const comment = `One.\n\n<!--cmt c8d2-->\n\n${tag}\n<!--/c8d2-->\n\nTwo.`;
  const highlight = `One.\n\n<!--hl h4kq-->\n\n${tag}\n<!--/h4kq-->\n\nTwo.`;
  const plain = `One.\n\n${tag}\n\nTwo.`;

  it('deleting the thread of a comment on it leaves no line break behind', () => {
    const text = file(comment, {}, thread('c8d2'));
    const result = applyChanges(text, deleteThread(text, 'c8d2'));
    expect(bodyOf(result).trimEnd()).toBe(plain);
    expect(newestView(result).text).toBe(newestView(text).text);
  });

  it.each(['accept', 'reject'] as const)('%ss a highlight on it with no line break left', (way) => {
    const text = file(highlight, { h4kq: 'ada' });
    const result = applyChanges(text, (way === 'accept' ? accept : reject)(text, 'h4kq'));
    expect(bodyOf(result).trimEnd()).toBe(plain);
    expect(newestView(result).text).toBe(newestView(file(plain)).text);
  });

  it("an agent's edit of the tag leaves the comment's closer with its line break read as syntax", () => {
    const text = file(comment, {}, thread('c8d2'));
    const edit = suggestReplace(text, 'Two.', 'Three.', context(ada, ['m2bd']));
    const result = applyChanges(text, edit.changes);
    expect(bodyOf(result)).toContain(`${tag}\n<!--/c8d2-->`);
    expect(newestView(result).text).toBe(
      newestView(file(comment.replace('Two.', 'Three.'), {}, thread('c8d2'))).text,
    );
    expectSound(comment, result);
  });
});
