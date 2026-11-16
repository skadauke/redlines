import { describe, expect, it } from 'vitest';
import { expressionOf, MAX_MATCHES, replacementFor, searchDoc } from './search.ts';

const rx = { regex: true };
const texts = (doc: string, query: string, options = {}) =>
  searchDoc(doc, query, options).matches.map((m) => doc.slice(m.from, m.to));

describe('regular expressions', () => {
  it('never match nothing: empty matches are left out, and the search ends', () => {
    expect(searchDoc('abc\n', '^', rx).matches).toEqual([]);
    expect(searchDoc('abc\n', '\\b', rx).matches).toEqual([]);
    expect(texts('baab a\n', 'a*', rx)).toEqual(['aa', 'a']);
  });

  it('^ and $ match at the ends of each line', () => {
    expect(texts('one\ntwo\n', '^t\\w+$', rx)).toEqual(['two']);
    expect(texts('one\ntwo\n', '^\\w', rx)).toEqual(['o', 't']);
  });

  it('take a pattern that only a plain expression accepts', () => {
    expect(texts('a-b_c\n', '\\-', rx)).toEqual(['-']);
    expect(texts('a-b_c\n', '\\_', rx)).toEqual(['_']);
    expect(expressionOf('(', { ...rx, matchCase: false, wholeWord: false })).toBeNull();
  });

  it('work with Whole Word', () => {
    expect(texts('cat concat cat.\n', 'cat|con', { ...rx, wholeWord: true })).toEqual([
      'cat',
      'cat',
    ]);
  });

  it('that can run without end are refused, not run', () => {
    const doc = `${'a'.repeat(40)}!\n`;
    for (const bad of ['(a+)+$', '(a*)*b', '(\\w+\\s?)+$', '(a+){2,}']) {
      expect(searchDoc(doc, bad, rx).invalid, bad).toBe(true);
    }
    expect(searchDoc('a+ b\n', '(a\\+)+', rx).invalid).toBe(false);
    expect(searchDoc('ab-12\n', '([a-z]+)-(\\d+)', rx).invalid).toBe(false);
  });

  it('stop at a cap of matches', () => {
    const doc = 'a '.repeat(MAX_MATCHES + 50);
    expect(searchDoc(doc, 'a').matches).toHaveLength(MAX_MATCHES);
  });
});

describe('the replacement', () => {
  const match = (found: RegExpExecArray) => ({
    from: 0,
    to: 0,
    groups: [...found],
    ...(found.groups ? { named: found.groups } : {}),
  });

  it('fills in groups as JavaScript does', () => {
    const m = match(/(a)|(b)/.exec('b')!);
    // The group that took no part is empty, not "$1".
    expect(replacementFor(m, '[$1|$2|$&|$$]')).toBe('[|b|b|$]');
    // No such group: as written. $10 with two groups is $1 and a 0.
    expect(replacementFor(m, '$3 $10')).toBe('$3 0');
    expect(replacementFor(m, '$1x')).toBe('x');
  });

  it('fills in named groups', () => {
    const m = match(/(?<year>\d+)-(?<month>\d+)/.exec('2026-11')!);
    expect(replacementFor(m, '$<month>/$<year> $<none>.')).toBe('11/2026 .');
    expect(replacementFor({ from: 0, to: 0, groups: ['x'] }, '$<year>')).toBe('$<year>');
  });

  it('leaves a plain search’s text as it is', () => {
    expect(replacementFor({ from: 0, to: 0 }, '$1 $&')).toBe('$1 $&');
  });
});
