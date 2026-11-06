import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { accept, acceptMarks, reject, rejectMarks } from './decide.ts';
import { EditError } from './errors.ts';
import { parse } from './parse.ts';
import { suggestionOf, suggestions } from './suggestion.ts';

/** A file whose ledger is these `marks` lines (flow-style entries, one per mark). */
function doc(body: string, marks: string[]): string {
  return [
    body,
    '',
    '<!-- redlines',
    'version: 1',
    'people:',
    '  claude-ada: {name: Claude, agent: true, for: ada}',
    '  ada: {name: Ada Lovelace}',
    'marks:',
    ...marks.map((line) => `  ${line}`),
    '-->',
    '',
  ].join('\n');
}

const BY = 'by: claude-ada, at: 2026-10-31T09:31Z';
const BODY =
  'We <!--ins b2c3-->will <!--/b2c3-->ship the importer <!--sub c4d5 March-->April<!--/c4d5--> ' +
  '<!--del f6g7  , after the beta-->and <!--ins h8j9-->done<!--/h8j9-->.';

const one = doc(BODY, [
  `b2c3: {${BY}, group: r7k2, note: Tense}`,
  `c4d5: {${BY}, group: r7k2, note: Tense}`,
  `f6g7: {${BY}, group: r7k2, note: Tense}`,
  `h8j9: {${BY}, group: r7k2, note: Other}`,
]);

describe('suggestionOf', () => {
  it('is the marks that share a group and a note, in document order', () => {
    const parsed = parse(one);
    expect(suggestionOf(parsed, 'c4d5')).toEqual(['b2c3', 'c4d5', 'f6g7']);
    expect(suggestionOf(parsed, 'b2c3')).toEqual(['b2c3', 'c4d5', 'f6g7']);
    expect(suggestionOf(parsed, 'h8j9')).toEqual(['h8j9']);
  });

  it('is the mark alone when it has no group', () => {
    const text = doc(BODY, [
      `b2c3: {${BY}, note: Tense}`,
      `c4d5: {${BY}, note: Tense}`,
      `f6g7: {${BY}}`,
      `h8j9: {${BY}}`,
    ]);
    expect(suggestionOf(parse(text), 'b2c3')).toEqual(['b2c3']);
    expect(suggestionOf(parse(text), 'f6g7')).toEqual(['f6g7']);
  });

  it('keeps authors apart, and leaves out the marks it is not given', () => {
    const text = doc(BODY, [
      `b2c3: {${BY}, group: r7k2, note: Tense}`,
      `c4d5: {by: ada, at: 2026-10-31T09:31Z, group: r7k2, note: Tense}`,
      `f6g7: {${BY}, group: r7k2, note: Tense}`,
      `h8j9: {${BY}}`,
    ]);
    const parsed = parse(text);
    expect(suggestionOf(parsed, 'b2c3')).toEqual(['b2c3', 'f6g7']);
    const among = parsed.marks.filter((mark) => mark.id !== 'f6g7');
    expect(suggestionOf(parsed, 'b2c3', among)).toEqual(['b2c3']);
  });

  it('is empty for an id that is not there, and does not count a comment', () => {
    expect(suggestionOf(parse(one), 'zzzz')).toEqual([]);
  });
});

describe('suggestions', () => {
  it('splits marks into suggestions, in the order of their first marks', () => {
    const parsed = parse(one);
    expect(suggestions(parsed.marks).map((marks) => marks.map(({ id }) => id))).toEqual([
      ['b2c3', 'c4d5', 'f6g7'],
      ['h8j9'],
    ]);
  });
});

describe('acceptMarks and rejectMarks', () => {
  const ids = ['b2c3', 'c4d5', 'f6g7'];
  it('accept like accepting each mark by hand', () => {
    let by = one;
    for (const id of [...ids].reverse()) by = applyChanges(by, accept(by, id));
    expect(applyChanges(one, acceptMarks(one, ids))).toBe(by);
  });

  it('reject like rejecting each mark by hand', () => {
    let by = one;
    for (const id of [...ids].reverse()) by = applyChanges(by, reject(by, id));
    expect(applyChanges(one, rejectMarks(one, ids))).toBe(by);
  });

  it('decide nothing when one mark cannot be decided', () => {
    const text = doc('A <!--ins b2c3-->b<!--/b2c3--> c <!--cmt k3x9-->d<!--/k3x9-->.', [
      `b2c3: {${BY}}`,
      `k3x9: {${BY}}`,
    ]);
    expect(() => acceptMarks(text, ['b2c3', 'k3x9'])).toThrow(EditError);
    expect(() => rejectMarks(text, ['b2c3', 'zzzz'])).toThrow(EditError);
  });
});
