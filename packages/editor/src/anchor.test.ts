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

  it('keeps to the occurrence it was on', () => {
    const found = follow(
      'importer a importer b importer',
      'importer A importer B importer',
      'importer',
      1,
    );
    expect(found?.from).toBe('importer A '.length);
  });

  it('follows nothing for an empty range', () => {
    const changes = ChangeSet.of([], 3);
    expect(followText(changes, Text.of(['abc']), Text.of(['abc']), { from: 1, to: 1 })).toBeNull();
  });
});
