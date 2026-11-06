import { ChangeSet, Text } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { followText } from './anchor.ts';
import { lineChanges } from './diff.ts';

/** Where `word` of `before` is in `after`, following the changes a reload makes. */
function follow(before: string, after: string, word: string, nth = 0) {
  let from = -1;
  for (let i = 0; i <= nth; i++) from = before.indexOf(word, from + 1);
  const changes = ChangeSet.of(lineChanges(before, after), before.length);
  const found = followText(changes, Text.of(before.split('\n')), Text.of(after.split('\n')), {
    from,
    to: from + word.length,
  });
  return found && { ...found, text: after.slice(found.from, found.to) };
}

describe('followText', () => {
  it('follows text that changes left alone, on either side or both', () => {
    expect(follow('a b importer c d.', 'a B importer c D.', 'importer')?.text).toBe('importer');
    expect(follow('a b importer c d.', 'a B importer c d.', 'importer')?.text).toBe('importer');
    expect(follow('a b importer c d.', 'A b importer c D.', 'importer')?.text).toBe('importer');
  });

  it('follows it past a line added or removed above', () => {
    expect(follow('x\nan importer', 'x\ny\nan importer', 'importer')?.text).toBe('importer');
  });

  it('gives up on text that changed, was cut or grew', () => {
    expect(follow('a b importer c d.', 'a B exporter c D.', 'importer')).toBeNull();
    expect(follow('a b importer c d.', 'a B importers c D.', 'importer')).toBeNull();
    expect(follow('a b importer c d.', 'a B import c D.', 'importer')).toBeNull();
    expect(follow('a b importer c d.', 'a B reimporter c D.', 'importer')).toBeNull();
  });

  it('does not go to the same words elsewhere in the line', () => {
    expect(follow('x importer y importer z', 'X importer Y exporter Z', 'importer', 1)).toBeNull();
  });

  it('does not follow a repeated word, which may be another occurrence', () => {
    expect(
      follow('importer a importer b importer', 'importer A importer B importer', 'importer', 1),
    ).toBeNull();
    // A rewritten paragraph: a sentence goes, another comes, and the counts match.
    expect(
      follow(
        'Intro. The importer reads files. The importer writes logs. End.',
        'Intro. The importer writes logs. The importer checks names. End.',
        'importer',
        1,
      ),
    ).toBeNull();
  });

  it('reports growth on one side only, as on both', () => {
    expect(
      follow('Alpha beta importer gamma', 'Alpha beta importers gamma', 'importer'),
    ).toBeNull();
    expect(
      follow('Alpha beta importer gamma', 'Alpha beta reimporter gamma', 'importer'),
    ).toBeNull();
    expect(
      follow('Alpha beta importer gamma', 'Alpha beta importer, gamma', 'importer'),
    ).not.toBeNull();
  });

  it('follows text at the start or end of its line', () => {
    expect(follow('importer a b c', 'importer A b C', 'importer')?.text).toBe('importer');
    expect(follow('a b c importer', 'A b C importer', 'importer')?.text).toBe('importer');
    expect(follow('importer a', 'New line\nimporter A', 'importer')?.text).toBe('importer');
  });

  it('follows text across lines and across two hunks', () => {
    expect(follow('a one\ntwo b', 'A one\ntwo B', 'one\ntwo')?.text).toBe('one\ntwo');
    const before = 'a x\nimporter y\nkeep\nz';
    const after = 'A x\nimporter Y\nkeep\nZ';
    expect(follow(before, after, 'x\nimporter y\nkeep\nz')).toBeNull();
    expect(follow(before, after, 'importer')?.text).toBe('importer');
  });

  it('gives up on text whose line is deleted', () => {
    expect(follow('top\nan importer\nbottom', 'top\nbottom', 'importer')).toBeNull();
  });

  it('follows nothing for an empty range', () => {
    const changes = ChangeSet.of([], 3);
    expect(followText(changes, Text.of(['abc']), Text.of(['abc']), { from: 1, to: 1 })).toBeNull();
  });
});
