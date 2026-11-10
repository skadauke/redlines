import { describe, expect, it } from 'vitest';
import {
  commentOnQuote,
  suggestReplace,
  suggestReplaceAsOne,
  suggestReplaceWith,
  uniqueMatch,
  wordHunks,
} from './agent.ts';
import { eolOf, inEol } from './edit-support.ts';
import { trackedEdits } from './track.ts';
import { SELF_CHECK } from './track.ts';
import { applyChanges } from './changes.ts';
import { accept, acceptAll, acceptMarks, reject, rejectAll, rejectMarks } from './decide.ts';
import { EditError } from './errors.ts';
import { trackedFormat } from './formatting.ts';
import { parse } from './parse.ts';
import { fuzzCount, randomDocument, seeded } from './random-docs.ts';
import {
  TIME,
  ada,
  bo,
  bodyOf,
  claudeAda,
  context,
  expectInOrder,
  expectNoNewLineStarts,
  file,
  fixture,
  dropEmptyBlocks,
  emptyBlockLines,
  renumbered,
  squash,
  idsOf,
  naturalOffsets,
  REFUSALS,
  expectEveryOrderAlike,
  thread,
} from './test-helpers.ts';
import type { EditContext, Person } from './types.ts';
import { newestView, originalView } from './views.ts';

const NO_MATCH = 'No match found for replacement. Please check your text and try again.';
const matches = (n: number) =>
  `Found ${n} matches for replacement text. Please provide more context to make a unique match.`;

/** Suggests a replacement as an agent and returns the new file with the ids of the new marks. */
function suggest(
  text: string,
  oldStr: string,
  newStr: string,
  ids: string[] = [],
  author: Person = claudeAda,
  more: Partial<EditContext> = {},
) {
  const { changes, markIds, extendedIds } = suggestReplace(
    text,
    oldStr,
    newStr,
    context(author, ids, more),
  );
  return { result: applyChanges(text, changes), markIds, extendedIds, changes };
}

describe('suggestReplace', () => {
  it('replaces a word with a substitution, and leaves the insertion next to it as it was', () => {
    const { result, markIds } = suggest(fixture, 'new importer', 'new exporter', ['w8nn']);
    expect(markIds).toEqual(['w8nn']);
    expect(bodyOf(result)).toContain(
      'the <!--ins k3x9-->new <!--/k3x9--><!--sub w8nn importer-->exporter<!--/w8nn--> in <!--sub p7qd March-->',
    );
    const parsed = expectInOrder('replace', ['c8d2'], result);
    const added = parsed.marks.find((mark) => mark.id === 'w8nn');
    expect(added?.kind).toBe('sub');
    expect(added?.payload).toBe('importer');
    expect(added?.entry).toEqual({ by: 'claude-ada', at: TIME });
    // Ada's insertion is the same mark with the same entry.
    expect(parsed.ledger.marks['k3x9']).toEqual(parse(fixture).ledger.marks['k3x9']);
    expect(parsed.marks.find((mark) => mark.id === 'k3x9')?.segments).toHaveLength(1);
    expect(newestView(result).text).toBe(newestView(fixture).text.replace('importer', 'exporter'));
    expect(originalView(result).text).toBe(originalView(fixture).text);
  });

  it('adds only the words that were added', () => {
    const { result, markIds } = suggest(fixture, 'security review', 'security and privacy review', [
      'w8nn',
    ]);
    expect(markIds).toEqual(['w8nn']);
    expect(bodyOf(result)).toContain(
      '<!--cmt c8d2-->security <!--ins w8nn-->and privacy <!--/w8nn-->review<!--/c8d2-->',
    );
    expect(parse(result).ledger.comments.map((t) => t.id)).toEqual(['c8d2']);
    expect(newestView(result).text).toContain('after the security and privacy review.');
  });

  it('deletes only the words that were removed', () => {
    const text = file('Our big red house is old.', {});
    const { result, markIds } = suggest(text, 'big red house', 'red house', ['w8nn']);
    expect(markIds).toEqual(['w8nn']);
    expect(bodyOf(result)).toBe('Our <!--del w8nn big -->red house is old.');
    expect(parse(result).marks[0]?.payload).toBe('big ');
  });

  it('marks each changed word, so that a reviewer can accept part of a rewrite', () => {
    // Words changed far apart, with more words between them than a changed word's worth, stay
    // apart (format §3.11).
    const text = file('We ship the old importer to all of the team by next week, as planned.', {});
    const { result, markIds } = suggest(
      text,
      'the old importer to all of the team by next week',
      'the new importer to all of the crew by next month',
      ['w8nn', 'p7qd', 'k3x9'],
    );
    expect(markIds).toEqual(['w8nn', 'p7qd', 'k3x9']);
    expect(bodyOf(result)).toBe(
      'We ship the <!--sub w8nn old-->new<!--/w8nn--> importer to all of the <!--sub p7qd team-->crew<!--/p7qd--> by next <!--sub k3x9 week-->month<!--/k3x9-->, as planned.',
    );
    expect(Object.keys(parse(result).ledger.marks)).toEqual(['w8nn', 'p7qd', 'k3x9']);
    expectInOrder('words', [], result);
    // The first change can be accepted and the others rejected.
    const accepted = applyChanges(result, accept(result, 'w8nn'));
    const rest = applyChanges(accepted, rejectAll(accepted));
    expect(rest).toBe('We ship the new importer to all of the team by next week, as planned.\n');
  });

  it('makes one change of a word that is replaced by several, or by none', () => {
    const text = file('a big house', {});
    const several = suggest(text, 'a big house', 'a very large house', ['w8nn']);
    expect(bodyOf(several.result)).toBe('a <!--sub w8nn big-->very large<!--/w8nn--> house');
    const none = suggest(text, 'a big house', 'a house', ['w8nn']);
    expect(bodyOf(none.result)).toBe('a <!--del w8nn big -->house');
  });

  it('keeps punctuation, line breaks and words apart', () => {
    const text = file('Say one, and then two. Not that three and so\nfour', {});
    const { result, markIds } = suggest(
      text,
      'one, and then two. Not that three and so\nfour',
      'uno, and then dos. Not that tres and so\ncuatro',
      ['w8nn', 'p7qd', 'k3x9', 'b4rt'],
    );
    expect(markIds).toEqual(['w8nn', 'p7qd', 'k3x9', 'b4rt']);
    // The word at the start of the second line is changed together with the line break in front
    // of it, because a marker may not start a line (format §3.2).
    expect(bodyOf(result)).toBe(
      'Say <!--sub w8nn one-->uno<!--/w8nn-->, and then <!--sub p7qd two-->dos<!--/p7qd-->. Not that <!--sub k3x9 three-->tres<!--/k3x9--> and so<!--sub b4rt \\nfour-->\ncuatro<!--/b4rt-->',
    );
    expect(newestView(result).text).toBe('Say uno, and then dos. Not that tres and so\ncuatro\n');
    expect(originalView(result).text).toBe('Say one, and then two. Not that three and so\nfour\n');
  });

  it('inserts at the start and at the end of the text it was given', () => {
    const text = file('one two three', {});
    expect(bodyOf(suggest(text, 'two', 'very two', ['w8nn']).result)).toBe(
      'one <!--ins w8nn-->very <!--/w8nn-->two three',
    );
    expect(bodyOf(suggest(text, 'two', 'two so', ['w8nn']).result)).toBe(
      'one two<!--ins w8nn--> so<!--/w8nn--> three',
    );
    expect(bodyOf(suggest(text, 'two', '', ['w8nn']).result)).toBe('one <!--del w8nn two--> three');
  });

  it('puts an insertion with the word it is next to, inside the text it was given', () => {
    // The comment on "security review" has hidden markers at both ends of the text. Words added
    // after "review" are inside the old text and so inside the comment; words added in front of
    // "security" are inside it too, behind the comment's opener.
    const after = suggest(fixture, 'security review', 'security review board', ['w8nn']);
    expect(bodyOf(after.result)).toContain(
      '<!--cmt c8d2-->security review<!--ins w8nn--> board<!--/w8nn--><!--/c8d2-->',
    );
    const before = suggest(fixture, 'security review', 'the security review', ['w8nn']);
    expect(bodyOf(before.result)).toContain(
      '<!--cmt c8d2--><!--ins w8nn-->the <!--/w8nn-->security review<!--/c8d2-->',
    );
    expectInOrder('after', ['c8d2'], after.result);
    expectInOrder('before', ['c8d2'], before.result);
  });

  it('replaces the whole of the text when nothing is left to keep', () => {
    const text = file('one two three', {});
    const { result } = suggest(text, 'two', 'six', ['w8nn']);
    expect(bodyOf(result)).toBe('one <!--sub w8nn two-->six<!--/w8nn--> three');
  });

  it('makes no change when the text is the same', () => {
    const { changes, markIds } = suggest(fixture, 'new importer', 'new importer');
    expect(changes).toEqual([]);
    expect(markIds).toEqual([]);
  });

  it('gives each mark the note and group, and adds the agent to the people', () => {
    const text = file('one two three', {});
    const { result } = suggest(text, 'one two', 'one six', ['w8nn'], claudeAda, {
      note: 'Matches the roadmap',
      group: 'g2rs',
    });
    expect(parse(result).ledger.marks['w8nn']).toEqual({
      by: 'claude-ada',
      at: TIME,
      group: 'g2rs',
      note: 'Matches the roadmap',
    });
    expect(parse(result).ledger.people.map((p) => p.handle)).toEqual(['ada', 'bo', 'claude-ada']);
    expect(parse(result).ledger.people[2]).toEqual(claudeAda);
  });

  it('replaces the note of its own mark that it changes in place, and keeps it with no note', () => {
    const first = suggest(file('one two three', {}), 'two', 'two six', ['w8nn'], claudeAda, {
      note: 'First',
    });
    const noted = first.result;
    expect(parse(noted).ledger.marks['w8nn']?.note).toBe('First');
    const second = suggest(noted, 'two six', 'two seven', [], claudeAda, { note: 'Second' });
    expect(second.extendedIds).toEqual(['w8nn']);
    expect(parse(second.result).ledger.marks['w8nn']?.note).toBe('Second');
    const third = suggest(second.result, 'two seven', 'two eight', [], claudeAda);
    expect(third.extendedIds).toEqual(['w8nn']);
    expect(parse(third.result).ledger.marks['w8nn']?.note).toBe('Second');
  });

  it('works inside another person’s insertion', () => {
    const text = file('<!--ins k3x9-->foo bar qux<!--/k3x9--> tail', { k3x9: 'bo' });
    const { result } = suggest(text, 'foo bar qux', 'foo baz qux', ['w8nn'], ada);
    expect(bodyOf(result)).toBe(
      '<!--ins k3x9-->foo <!--sub w8nn bar-->baz<!--/w8nn--> qux<!--/k3x9--> tail',
    );
    const added = suggest(text, 'foo bar qux', 'foo bar new qux', ['w8nn'], ada);
    expect(bodyOf(added.result)).toBe(
      '<!--ins k3x9-->foo bar <!--/k3x9--><!--ins w8nn-->new <!--/w8nn--><!--ins k3x9-->qux<!--/k3x9--> tail',
    );
    expectInOrder('inside', [], added.result);
  });

  it('keeps a line that a replacement leaves with no text, or says why it can not', () => {
    // #85: Bo's insertion holds a paragraph, and the agent deletes its one word but keeps its line,
    // with the white space on it, and the line break after it. The deletion stands on that line, in
    // front of Bo's closer, and the newest view is what was asked.
    const text = file('One<!--ins m6tz--> \n\n two<!--/m6tz-->\nthree', { m6tz: 'bo' });
    const { result } = suggest(text, 'One \n\n two\nthree', 'One \n\n \nthree', ['bp3f']);
    expect(bodyOf(result)).toBe('One<!--ins m6tz--> \n\n <!--del bp3f two--><!--/m6tz-->\nthree');
    expect(newestView(result).text).toBe('One \n\n \nthree\n');
    expect(originalView(result).text).toBe(originalView(text).text);
    expect(applyChanges(result, acceptAll(result))).toBe('One \n\n \nthree\n');
    expect(applyChanges(result, rejectAll(result))).toBe('One\nthree\n');
    // Accepting the deletion first, then deciding Bo's insertion, gives what the views say. The
    // other way round, accepting the insertion first would leave the deletion's marker alone on its
    // line, and is refused until the deletion is decided.
    const first = applyChanges(result, accept(result, 'bp3f'));
    expect(applyChanges(first, accept(first, 'm6tz'))).toBe('One \n\n \nthree\n');
    expect(applyChanges(first, reject(first, 'm6tz'))).toBe('One\nthree\n');
    expect(() => accept(result, 'm6tz')).toThrow(/alone on its line/);
    // With nothing after the word on its line, the deletion's marker would stand alone there and
    // take the line break for its own (format §3.3). The line goes with its break when the next
    // line has the same in front of its text: a line of white space is a blank line, and the views
    // read as asked.
    for (const base of ['One\n\ntwo\nthree', '- a\n\n  two\n  three']) {
      const plain = file(base);
      const oldStr = base.slice(base.indexOf('\n\n'));
      const newStr = oldStr.replace('two', '');
      const whole = suggest(plain, oldStr, newStr, ['bp3f']).result;
      const asked = newestView(plain).text.replace(oldStr, newStr);
      expect(newestView(whole).text, base).toBe(asked.replace(/\n\n[ \t]*\n/, '\n\n'));
      expect(originalView(whole).text, base).toBe(originalView(plain).text);
    }
    // Otherwise the next line would take the white space in front of it, or lose its own, which is
    // not what was asked: a line after a list item's paragraph would stay in the item.
    for (const base of ['One\n\n two\nthree', '- a\n\n  two\nthree', '# H\n two\nthree']) {
      const oldStr = base.slice(base.indexOf('\n'));
      const run = () => suggest(file(base), oldStr, oldStr.replace('two', ''));
      expect(run, base).toThrow(/^This would leave a line with nothing but white space/);
      expect(run, base).toThrow(expect.objectContaining({ code: 'no-legal-placement' }));
    }
  });

  it('adds a blank line in front of a quote or a list item, and keeps its syntax', () => {
    // Found at REDLINES_FUZZ=6000 behind #85: the break before the quote was kept from the front
    // as far as its prefix, and so not at all, and then covered whole, with the `> ` in it.
    for (const [body, oldStr, newStr] of [
      ['one\n\n> gamma café', 'one\n\n> gamma', 'one\n\n\n> gamma'],
      ['a x\none\n\n- gamma café', 'x\none\n\n- gamma', 'one\n\n\n- gamma'],
    ] as const) {
      const text = file(body);
      const { result } = suggest(text, oldStr, newStr, ['w8nn', 'p7qd']);
      expect(newestView(result).text, body).toBe(newestView(text).text.replace(oldStr, newStr));
      // The blank line is plain, and the original text has it too (format §3.4).
      const blank = (s: string) => s.replace(/\n{3,}/g, '\n\n');
      expect(blank(originalView(result).text), body).toBe(originalView(text).text);
    }
  });

  it('refuses edits of one replacement that would land in one place once one is widened', () => {
    // Found at REDLINES_FUZZ=6000 behind #85. A line break typed in front of Bo's insertion is
    // widened over the words after it, which it writes again behind the break; the insertion after
    // the emoji would then come before them, and the words would be out of order.
    const text = file('a café\n42<!--ins q9r9--> 😀<!--/q9r9--> gamma b', { q9r9: 'bo' });
    expect(() =>
      suggest(text, 'café\n42 😀 gamma', 'café café\n 😀 café gamma', [
        'w8nn',
        'p7qd',
        'k3x9',
        'h4kz',
        'g3rp',
        'd3x9',
        'n8fx',
        'm2bd',
      ]),
    ).toThrow('Two of these changes would land in the same place.');
  });

  it("types a word at the start of a block's text behind another person's block change", () => {
    // The insertion after the words before it maps to the left of the hidden opener of Bo's change
    // of the paragraph into an item; it goes behind it, and Bo's change can still be rejected.
    const base = file('Intro\n\nTitle here\n\nEnd');
    const at = base.indexOf('Title here');
    const range = { from: at, to: at + 'Title here'.length };
    const op = { kind: 'block', to: 'ul' } as const;
    const text = applyChanges(base, trackedFormat(base, range, op, context(bo, ['m2bd'])).changes);
    const { result } = suggest(text, 'Intro\n\n- Title here', 'Intro\n\n- New Title here', [
      'w8nn',
    ]);
    expect(bodyOf(result)).toBe(
      'Intro\n\n- <!--fmt m2bd was=p-->\n  <!--ins w8nn-->\n  New <!--/w8nn-->Title here<!--/m2bd-->\n\nEnd',
    );
    expect(newestView(result).text).toBe('Intro\n\n- New Title here\n\nEnd\n');
    const accepted = applyChanges(result, accept(result, 'w8nn'));
    expect(applyChanges(accepted, reject(accepted, 'm2bd'))).toBe(
      'Intro\n\nNew Title here\n\nEnd\n',
    );
  });

  it('adds to an insertion of its own', () => {
    const text = file('a <!--ins k3x9-->new<!--/k3x9--> b', { k3x9: 'claude-ada' });
    const { result, markIds, extendedIds, changes } = suggest(text, 'a new', 'a new big');
    // Nothing is new: the insertion grows, and its entry stays as it was.
    expect(markIds).toEqual([]);
    expect(extendedIds).toEqual(['k3x9']);
    expect(bodyOf(result)).toBe('a <!--ins k3x9-->new big<!--/k3x9--> b');
    expect(changes).toHaveLength(1);
    // Next to it, with a space between, the words are a new insertion.
    const apart = suggest(text, 'a new b', 'a new big b', ['w8nn']);
    expect(apart.markIds).toEqual(['w8nn']);
    expect(newestView(apart.result).text).toBe('a new big b\n');
    expectInOrder('apart', [], apart.result);
  });

  it('matches the newest view, which has no markers, deleted text or ledger', () => {
    expect(() => suggest(fixture, 'March', 'May')).toThrow(NO_MATCH);
    expect(() => suggest(fixture, '<!--ins k3x9-->', 'x')).toThrow(NO_MATCH);
    expect(() => suggest(fixture, 'The old exporter', 'x')).toThrow(NO_MATCH);
    expect(() => suggest(fixture, 'redlines', 'x')).toThrow(NO_MATCH);
    // What a person sees, as it is spread over the file.
    const ids = ['w8nn'];
    expect(() => suggest(fixture, 'ship the new importer', 'ship the new tool', ids)).not.toThrow();
    expect(() => suggest(fixture, 'in April, after', 'in May, after', ids)).not.toThrow();
  });

  it('throws the text editor tool’s messages for no match and for several', () => {
    expect(() => suggest(fixture, 'not there', 'x')).toThrow(EditError);
    expect(() => suggest(fixture, 'not there', 'x')).toThrow(NO_MATCH);
    expect(() => suggest(fixture, '', 'x')).toThrow(NO_MATCH);
    // "e" is in the text a dozen times.
    const count = newestView(fixture).text.split('e').length - 1;
    expect(() => suggest(fixture, 'e', 'x')).toThrow(matches(count));
    const text = file('go and go again, and go', {});
    expect(() => suggest(text, 'go', 'run')).toThrow(matches(3));
    expect(() => suggest(text, ' and go', 'x')).toThrow(matches(2));
    // Matches that overlap count once, as str_replace counts them.
    expect(suggest(file('aaa', {}), 'aa', 'b', ['w8nn']).markIds).toEqual(['w8nn']);
  });

  it('refuses text that is markup, and leaves a ledger that can not be read alone', () => {
    expect(() => suggest(fixture, 'new importer', 'new <!--ins k3x9-->x', ['w8nn'])).toThrow(
      'holds Redlines markup',
    );
    const broken = 'a b\n\n<!-- redlines\nversion: 1\npeople: {ada: {name: Ada\n-->\n';
    expect(() => suggest(broken, 'a b', 'a c', ['w8nn'])).toThrow("can't be read");
  });

  it('follows the line breaks of the file', () => {
    const text = 'One line\r\nand another.\r\n';
    const { result } = suggest(text, 'line\nand another', 'line\nand some more', ['w8nn']);
    expect(bodyOf(result)).toBe('One line\r\nand <!--sub w8nn another-->some more<!--/w8nn-->.');
    expect(result.replaceAll('\r\n', '')).not.toContain('\n');
  });

  it('keeps emoji, combining characters and punctuation whole', () => {
    const text = file('A café 😀 sign, éclair (sweet).', {});
    const { result } = suggest(text, 'café 😀 sign,', 'café 😎 sign.', ['w8nn', 'p7qd']);
    expect(bodyOf(result)).toBe(
      'A café <!--sub w8nn 😀-->😎<!--/w8nn--> sign<!--sub p7qd ,-->.<!--/p7qd--> éclair (sweet).',
    );
    expectInOrder('emoji', [], result);
  });

  it('uses the agent’s own author for every mark', () => {
    const text = file('one two three four five six', {});
    const { result } = suggest(
      text,
      'one two three four five six',
      'one 2 three four five 6',
      ['w8nn', 'p7qd'],
      bo,
    );
    expect(Object.values(parse(result).ledger.marks).map((entry) => entry.by)).toEqual([
      'bo',
      'bo',
    ]);
  });

  it('lists the marks that are new in markIds, and those that grew apart from them', () => {
    const text = file('a <!--ins k3x9-->new<!--/k3x9--> b', { k3x9: 'claude-ada' });
    const grown = suggest(text, 'a new', 'a new big');
    expect(grown.markIds).toEqual([]);
    expect(grown.extendedIds).toEqual(['k3x9']);
    const added = suggest(text, 'a new b', 'a new big b', ['w8nn']);
    expect(added.markIds).toEqual(['w8nn']);
    expect(added.extendedIds).toEqual([]);
    expect(suggest(fixture, 'new importer', 'new importer').extendedIds).toEqual([]);
  });

  it('says why in the code of the error', () => {
    const codeOf = (action: () => unknown): string | undefined => {
      try {
        action();
      } catch (error) {
        if (error instanceof EditError) return error.code;
        throw error;
      }
      return 'no error';
    };
    expect(codeOf(() => suggest(fixture, 'not there', 'x'))).toBe('no-match');
    expect(codeOf(() => suggest(fixture, 'e', 'x'))).toBe('many-matches');
    expect(codeOf(() => suggest(fixture, 'new importer', 'new <!--ins k3x9-->x'))).toBe('markup');
  });

  it('refuses a replacement that would turn another person’s change into code', () => {
    // Taking the backtick away from `foo` would pair the next ones around Bo's insertion.
    const text = file(
      'Use the importer `foo` and <!--ins k3x9-->more<!--/k3x9--> here `bar` end.',
      {
        k3x9: 'bo',
      },
    );
    try {
      suggest(text, 'importer `foo` and', 'importer foo` and', ['w8nn'], ada);
      throw new Error('The suggestion went through');
    } catch (error) {
      expect(error).toBeInstanceOf(EditError);
      expect((error as EditError).code).toBe('would-hide-marks');
    }
    // The same text without the backtick change is fine.
    expect(() =>
      suggest(text, 'importer `foo` and', 'tool `foo` and', ['w8nn'], ada),
    ).not.toThrow();
  });

  it('refuses a replacement or a comment in indented code, in the words of fenced code (#153)', () => {
    const replacing =
      "A tracked change can't go inside code or an HTML comment, where its markers would not be read. Change the whole code span or comment instead.";
    const commenting =
      "A comment can't be anchored inside code or an HTML comment, where its markers would not be read. Anchor it on the whole code span or comment instead.";
    for (const body of [
      'Para.\n\n    code line\n    more code\n\nAfter.',
      '- Item.\n\n      code line\n      more code\n\n  After.',
      '> Para.\n>\n>     code line\n>     more code',
      'Para.\n\n```\ncode line\nmore code\n```\n\nAfter.',
    ]) {
      const text = file(body);
      for (const [what, words, action] of [
        ['str_replace', replacing, () => suggest(text, 'more code', 'less code', ['w8nn'])],
        [
          'comment',
          commenting,
          () => commentOnQuote(text, 'more', 'Why?', context(claudeAda, ['w8nn'])),
        ],
      ] as const) {
        const label = `${what} in ${JSON.stringify(body)}`;
        let error: unknown;
        try {
          action();
        } catch (thrown) {
          error = thrown;
        }
        expect(error, label).toBeInstanceOf(EditError);
        expect((error as EditError).code, label).toBe('inside-code');
        expect((error as EditError).message, label).toBe(words);
      }
    }
  });
});

/** The ids the tests of the joining rule draw. */
const IDS = ['k3x9', 'p7qd', 'w8nn', 'b4rt', 'm2bd', 'h4kz', 'g3rp', 'd3x9', 'n8fx'];

/** An agent's edit as it was written before the joining rule: each change the comparison finds. */
function asToday(text: string, oldStr: string, newStr: string, ids: string[] = IDS) {
  const eol = eolOf(text);
  const before = inEol(oldStr, eol);
  const after = inEol(newStr, eol);
  const view = newestView(text);
  const start = uniqueMatch(view.text, before);
  const edits = wordHunks(before, after).map((hunk) => {
    if (hunk.from === hunk.to) {
      const at = view.map.toSource(start + hunk.from, hunk.from > 0 ? -1 : 1);
      return { from: at, to: at, insert: hunk.insert };
    }
    return {
      from: view.map.toSource(start + hunk.from, 1),
      to: view.map.toSource(start + hunk.to, -1),
      insert: hunk.insert,
    };
  });
  const { changes, markIds } = trackedEdits(text, edits, context(claudeAda, ids));
  return { result: applyChanges(text, changes), markIds };
}

const IMPORTER = [
  'The importer reads every file in the folder and writes one record for each line it finds there.',
  'The importer reads each file once and writes a record per line.',
] as const;
const READER = [
  IMPORTER[0].replace('importer', 'reader'),
  IMPORTER[1].replace('importer', 'reader'),
];

describe('the joining rule (format §3.11)', () => {
  /**
   * An agent's edit, checked as every edit is: the file is in order, the newest view is what was
   * asked and the original as it was, every order of deciding the marks reads the same for the
   * same decisions, every other mark can be decided exactly when it could before, and rejecting
   * the new marks gives the bytes back.
   */
  function rewrite(text: string, oldStr: string, newStr: string) {
    const { result, markIds, extendedIds } = suggest(text, oldStr, newStr, IDS);
    const label = JSON.stringify(oldStr.slice(0, 30));
    expectInOrder(
      label,
      parse(text).ledger.comments.map((t) => t.id),
      result,
    );
    const asked = newestView(text).text.replace(
      inEol(oldStr, eolOf(text)),
      inEol(newStr, eolOf(text)),
    );
    expect(newestView(result).text, label).toBe(asked);
    expect(originalView(result).text, label).toBe(originalView(text).text);
    expectEveryOrderAlike(label, result);
    for (const mark of parse(text).marks) {
      if (mark.kind === 'cmt' || markIds.includes(mark.id)) continue;
      for (const decide of [accept, reject]) {
        const works = (file: string) => {
          try {
            decide(file, mark.id);
            return true;
          } catch (error) {
            if (error instanceof EditError) return false;
            throw error;
          }
        };
        expect(works(result), `${label}: ${mark.id}`).toBe(works(text));
      }
    }
    if (extendedIds.length === 0) {
      expect(bodyOf(applyChanges(result, rejectMarks(result, markIds))).trimEnd(), label).toBe(
        bodyOf(text).trimEnd(),
      );
      expect(newestView(applyChanges(result, acceptMarks(result, markIds))).text, label).toBe(
        asked,
      );
    }
    return { result, markIds, extendedIds, marks: parse(result).marks };
  }

  it('writes a rewritten paragraph as one substitution', () => {
    const text = file(IMPORTER[0]);
    const { result, markIds, marks } = rewrite(text, ...IMPORTER);
    expect(markIds).toEqual(['k3x9']);
    expect(marks.map((mark) => mark.kind)).toEqual(['sub']);
    expect(bodyOf(result)).toBe(`<!--sub k3x9 ${IMPORTER[0]}-->\n\n${IMPORTER[1]}<!--/k3x9-->`);
    // Today's form makes five marks of it.
    expect(asToday(text, ...IMPORTER).markIds).toHaveLength(5);
    // One mark needs no group.
    const one = suggestReplaceAsOne(text, ...IMPORTER, context(claudeAda, IDS));
    expect(parse(applyChanges(text, one.changes)).ledger.marks['k3x9']?.group).toBeUndefined();
  });

  it('keeps a light edit as marks per phrase', () => {
    const light = [
      'Creating a beautiful, minimal and functional user interface is the goal. The document looks like a finished document while you write it.',
      'Creating a beautiful, minimal and functional interface is the goal. The document looks finished while you write it.',
    ] as const;
    const far = [
      'Each person keeps the color they picked unless someone already shown has it, and past the eight colors, colors repeat.',
      'Each person keeps the color they chose unless someone already shown has it, and past the eight colors, they repeat.',
    ] as const;
    const added = [
      'The view is each person’s own and is never saved in the file.',
      'The view is each person’s own and is never saved in the file. It is kept in the settings.',
    ] as const;
    for (const [before, after, marks] of [
      ['We ship it in March.', 'We ship it in April.', 1],
      [...light, 2],
      [...far, 2],
      [...added, 1],
      [added[1], added[0], 1],
    ] as const) {
      expect(rewrite(file(before), before, after).markIds, before).toHaveLength(marks);
    }
  });

  it('replaces a heading, an item, a quote and a cell whole, in the forms of format §3.3', () => {
    const [old, next] = IMPORTER;
    for (const [body, expected] of [
      [`# ${old}`, `# <!--sub k3x9 ${old}-->${next}<!--/k3x9-->`],
      [`- ${old}`, `- <!--sub k3x9 ${old}-->\n  ${next}<!--/k3x9-->`],
      [`> ${old}`, `> <!--sub k3x9 ${old}-->\n>\n> ${next}<!--/k3x9-->`],
      [
        `| A | B |\n| --- | --- |\n| x | ${old} |`,
        `| A | B |\n| --- | --- |\n| x | <!--sub k3x9 ${old}-->${next}<!--/k3x9--> |`,
      ],
    ] as const) {
      const { result, markIds } = rewrite(file(body), old, next);
      expect(markIds, body).toEqual(['k3x9']);
      expect(bodyOf(result), body).toBe(expected);
    }
  });

  it('never joins across blocks', () => {
    for (const [body, between] of [
      [`- ${IMPORTER[0]}\n- ${READER[0]}`, '\n- '],
      [`${IMPORTER[0]}\n\n${READER[0]}`, '\n\n'],
      [`# ${IMPORTER[0]}\n\n${READER[0]}`, '\n\n'],
      [`| A | B |\n| --- | --- |\n| ${IMPORTER[0]} | ${READER[0]} |`, ' | '],
    ] as const) {
      const { markIds, marks } = rewrite(
        file(body),
        IMPORTER[0] + between + READER[0],
        IMPORTER[1] + between + READER[1],
      );
      expect(markIds, body).toEqual(['k3x9', 'p7qd']);
      expect(
        marks.map((mark) => mark.payload),
        body,
      ).toEqual([IMPORTER[0], READER[0]]);
    }
  });

  it('never joins over a prefix', () => {
    // The number and the second word changed, one word between them: written as today, as one
    // substitution of the break and the prefix (format §3.4) and one of the word.
    const text = file('Intro words here.\n5. Switch views now');
    const oldStr = 'here.\n5. Switch views';
    const newStr = 'here.\n6. Switch panes';
    const { result } = rewrite(text, oldStr, newStr);
    expect(result).toBe(asToday(text, oldStr, newStr).result);
    // An edit that today's form refuses is refused as it is today.
    const first = file('1. one two three four');
    const run = () => suggest(first, '1. one two three four', '2. uno dos tres four', IDS);
    expect(run).toThrow(/in front of or inside its list marker/);
  });

  it('never joins or replaces over another person’s pending words', () => {
    // Bo's insertion and Bo's deletion in the words the agent keeps.
    for (const body of [
      'The importer <!--ins m6tz-->reads<!--/m6tz--> every file in the folder and writes one record for each line it finds there.',
      'The importer<!--del m6tz  quickly--> reads every file in the folder and writes one record for each line it finds there.',
    ]) {
      const text = file(body, { m6tz: 'bo' });
      const { markIds, marks } = rewrite(text, ...IMPORTER);
      const bo = parse(text).marks.find((mark) => mark.id === 'm6tz');
      const after = marks.find((mark) => mark.id === 'm6tz');
      expect(after?.kind, body).toBe(bo?.kind);
      expect(after?.payload, body).toBe(bo?.payload);
      expect(after?.entry.by, body).toBe('bo');
      expect(
        marks.filter((mark) => mark.id === 'm6tz').map((mark) => mark.segments.length),
      ).toEqual([1]);
      // The paragraph is not replaced whole: the agent's changes stop at Bo's markers.
      expect(markIds.length, body).toBeGreaterThan(0);
      expect(
        marks.every((mark) => mark.payload !== IMPORTER[0]),
        body,
      ).toBe(true);
    }
    // Bo's whole paragraph: the agent's changes are written inside it, the words it keeps stay Bo's.
    const inside = file(`Intro.\n\n<!--ins m6tz-->\n\n${IMPORTER[0]}<!--/m6tz-->`, { m6tz: 'bo' });
    const { result } = rewrite(inside, ...IMPORTER);
    expect(newestView(applyChanges(result, rejectAll(result))).text).toBe(
      newestView(applyChanges(inside, rejectAll(inside))).text,
    );
    expect(bodyOf(result)).toContain('The importer reads ');
    expect(bodyOf(result)).not.toContain(`<!--sub k3x9 ${IMPORTER[0]}`);
    // The agent's own pending insertion is changed in place, as today, and not joined over.
    const own = file(
      'The importer reads every <!--ins m6tz-->new <!--/m6tz-->file in the folder and writes one record for each line it finds there.',
      { m6tz: 'claude-ada' },
    );
    const ownOld = 'every new file in the folder';
    const ownEdit = rewrite(own, ownOld, 'each file once');
    expect(ownEdit.extendedIds).toEqual(['m6tz']);
    expect(bodyOf(ownEdit.result)).toContain('<!--ins m6tz-->each <!--/m6tz-->file ');
    // A comment on part of the paragraph stops joins at its markers.
    const part = file(
      'The importer reads every <!--cmt c8d2-->file in the folder<!--/c8d2--> and writes one record for each line it finds there.',
      {},
      thread('c8d2'),
    );
    const partEdit = rewrite(part, ...IMPORTER);
    expect(bodyOf(partEdit.result)).toBe(
      'The importer reads <!--sub k3x9 every-->each<!--/k3x9--> <!--cmt c8d2-->file <!--sub p7qd in the folder-->once<!--/p7qd--><!--/c8d2--> and writes <!--sub w8nn one record for each line it finds there-->a record per line<!--/w8nn-->.',
    );
    // A comment on the whole paragraph: one substitution inside its range, the thread on it.
    const whole = file(`<!--cmt c8d2-->\n${IMPORTER[0]}<!--/c8d2-->`, {}, thread('c8d2'));
    const wholeEdit = rewrite(whole, ...IMPORTER);
    expect(wholeEdit.markIds).toEqual(['k3x9']);
    expect(bodyOf(wholeEdit.result)).toBe(
      `<!--cmt c8d2-->\n<!--sub k3x9 ${IMPORTER[0]}-->\n\n${IMPORTER[1]}<!--/k3x9--><!--/c8d2-->`,
    );
  });

  it('never joins over syntax', () => {
    const bold = rewrite(
      file('The importer reads **every file in the folder** and writes one record for each line.'),
      'The importer reads **every file in the folder** and writes one record for each line.',
      'The importer reads **each file once** and writes a record per line.',
    );
    expect(bodyOf(bold.result)).toBe(
      'The importer reads **<!--sub k3x9 every file in the folder-->each file once<!--/k3x9-->** and writes <!--sub p7qd one record for each-->a record per<!--/p7qd--> line.',
    );
    for (const kept of ['[importer reads](x)', '`importer reads`']) {
      const old = `The ${kept} every file in the folder and writes one record for each line it finds there.`;
      const { result, marks } = rewrite(
        file(old),
        old,
        `The ${kept} each file once and writes a record per line.`,
      );
      expect(bodyOf(result).startsWith(`The ${kept} <!--sub k3x9 every file`), kept).toBe(true);
      expect(
        marks.every((mark) => !mark.payload?.includes(kept)),
        kept,
      ).toBe(true);
    }
  });

  it('joins across the line breaks of a wrapped paragraph, in the file’s line breaks', () => {
    const old =
      'The importer reads every file in the folder\nand writes one record for each line it\nfinds there.';
    const next = 'The importer reads each file once\nand writes a record per line.';
    for (const eol of ['\n', '\r\n']) {
      const text = file(old).replaceAll('\n', eol);
      const { result, marks } = rewrite(text, old, next);
      // One substitution of the paragraph; the new text's line break is a split, as every line
      // break typed in a paragraph is (format §3.4).
      expect(marks.map((mark) => mark.kind)).toEqual(['sub', 'split']);
      expect(bodyOf(result)).toBe(
        `<!--sub k3x9 ${old.replaceAll('\n', '\\n')}-->${eol}${eol}The importer reads each file once<!--split p7qd-->${eol}and writes a record per line.<!--/k3x9-->`,
      );
      if (eol === '\r\n') expect(result.replaceAll('\r\n', '')).not.toContain('\n');
      expect(bodyOf(applyChanges(result, rejectAll(result))).trimEnd()).toBe(
        bodyOf(text).trimEnd(),
      );
    }
  });

  it('falls back to the word marks when the joined form is refused or reads otherwise', () => {
    const text = file('We ship the old importer to all of the team by next week, as planned.');
    const oldStr = 'old importer to all of the team';
    const newStr = 'new importer to all of the crew';
    const today = asToday(text, oldStr, newStr);
    // A joined form that the format refuses: it holds markup.
    const refused = suggestReplaceWith(text, oldStr, newStr, context(claudeAda, IDS), () => [
      { from: 0, to: 3, insert: '<!--x-->' },
    ]);
    expect(applyChanges(text, refused.changes)).toBe(today.result);
    expect(refused.markIds).toEqual(today.markIds);
    // A joined form that reads otherwise: the number after a change inside a prefix stays.
    const list = file('Intro words here.\n5. Switch views now');
    const listOld = 'here.\n5. Switch views';
    const listNew = 'here.\n6. Switch panes';
    const otherwise = suggestReplaceWith(list, listOld, listNew, context(claudeAda, IDS), () => [
      { from: 6, to: 21, insert: '6. Switch panes' },
    ]);
    expect(applyChanges(list, otherwise.changes)).toBe(asToday(list, listOld, listNew).result);
  });

  it('writes as one change an edit that today’s form refuses as several in one place', () => {
    // Found by the random test (seed 177): two words of an autolink, which takes no marker inside
    // it, changed with a dot between them. Each change is widened to the whole link, so the word
    // form's two land in one place; joined, they are one.
    const text = file('See <https://example.org/x> for more.');
    expect(() => asToday(text, '://example.org/x>', '://café.beta/x>')).toThrow(
      'Two of these changes would land in the same place.',
    );
    const { result, markIds } = rewrite(text, '://example.org/x>', '://café.beta/x>');
    expect(markIds).toEqual(['k3x9']);
    expect(newestView(result).text).toBe('See <https://café.beta/x> for more.\n');
  });
});

describe('wordHunks', () => {
  const apply = (oldText: string, newText: string) => {
    const hunks = wordHunks(oldText, newText);
    let result = '';
    let at = 0;
    for (const hunk of hunks) {
      result += oldText.slice(at, hunk.from) + hunk.insert;
      at = hunk.to;
    }
    return { hunks, result: result + oldText.slice(at) };
  };

  it('puts an insertion after the words before it, as a person reads it', () => {
    const { hunks } = apply('security review', 'security and privacy review');
    expect(hunks).toEqual([{ from: 9, to: 9, insert: 'and privacy ' }]);
  });

  it('keeps words that are the same and changes the rest', () => {
    const { hunks } = apply('the quick brown fox', 'the slow brown dog');
    expect(hunks).toEqual([
      { from: 4, to: 9, insert: 'slow' },
      { from: 16, to: 19, insert: 'dog' },
    ]);
  });

  it('makes a change of each word, even when the words are next to each other', () => {
    const { hunks } = apply('a b c d e', 'a x y z e');
    expect(hunks).toEqual([
      { from: 2, to: 3, insert: 'x' },
      { from: 4, to: 5, insert: 'y' },
      { from: 6, to: 7, insert: 'z' },
    ]);
  });

  it('makes the new text from the old text, whatever the two are', () => {
    const pairs: [string, string][] = [
      ['', ''],
      ['', 'new'],
      ['old', ''],
      ['a b c', 'c b a'],
      ['one  two', 'one two'],
      ['x, y; z.', 'x y z'],
      ['😀 é café', 'café 😀 é!'],
      ['line one\nline two\n', 'line one\n\nline 2\n'],
      ['aaa aaa aaa', 'aaa aaa'],
    ];
    for (const [before, after] of pairs) {
      expect(apply(before, after).result).toBe(after);
      for (const hunk of wordHunks(before, after)) {
        expect(hunk.from).toBeLessThanOrEqual(hunk.to);
      }
    }
  });

  it('falls back to one change for texts too long to compare', () => {
    const before = Array.from({ length: 3000 }, (_, i) => `a${i}`).join(' ');
    const after = Array.from({ length: 3000 }, (_, i) => `b${i}`).join(' ');
    const { hunks, result } = apply(before, after);
    expect(result).toBe(after);
    expect(hunks).toHaveLength(1);
  });
});

/** Suggestions on random documents: what must hold whatever the document and the replacement. */
describe('on random documents', { timeout: 600_000 }, () => {
  const WORDS = ['alpha', 'beta', 'gamma', 'new', 'x', '😀', 'café', 'éclair', '42', 'one\n\ntwo'];

  it('changes the newest view as asked, keeps the original view, and the ledger in order', () => {
    const documents = fuzzCount(150);
    let suggestions = 0;
    let refused = 0;
    let checked = 0;
    for (let seed = 1; seed <= documents; seed++) {
      const random = seeded(seed * 4801);
      const below = (n: number) => Math.floor(random() * n);
      let text = randomDocument(seeded(seed));
      const threads = parse(text).ledger.comments.map((t) => t.id);
      for (let step = 0; step < 3; step++) {
        const view = newestView(text).text;
        const original = originalView(text).text;
        const before = parse(text);
        // A piece of the text that occurs once, between two places where a change may start, with
        // some of its words changed. The words of a block's prefix stay.
        const offsets = naturalOffsets(view);
        const from = offsets[below(offsets.length)] ?? 0;
        const later = offsets.filter((offset) => offset >= from + 3 && offset <= from + 43);
        const oldStr = view.slice(from, later[below(later.length)] ?? from);
        if (oldStr.length < 3 || view.split(oldStr).length !== 2) continue;
        const newStr = oldStr.replace(/\S+/g, (word) => {
          if (/^(?:[-*+>]|\d+\.|#{1,6})$/.test(word)) return word;
          const roll = below(6);
          if (roll === 0) return WORDS[below(WORDS.length)] ?? word;
          if (roll === 1) return '';
          if (roll === 2) return `${word} ${WORDS[below(WORDS.length)] ?? ''}`;
          return word;
        });
        const label = `seed ${seed}, step ${step}: ${JSON.stringify([oldStr, newStr])}`;
        const author = below(2) === 0 ? claudeAda : bo;
        const ctx = {
          author,
          time: TIME,
          random: (n: number) => Uint8Array.from({ length: n }, () => below(256)),
        };

        let edits: ReturnType<typeof suggestReplace>;
        try {
          edits = suggestReplace(text, oldStr, newStr, ctx);
        } catch (error) {
          if (error instanceof EditError && REFUSALS.includes(error.code ?? '')) {
            refused++;
            // The last check of a change refuses the rare suggestion of several edits whose
            // breaks and markers meet in one place; it must stay rare.
            if (error.message === SELF_CHECK) checked++;
            continue;
          }
          throw new Error(`${label}: ${String(error)}`, { cause: error });
        }
        const { changes, markIds } = edits;
        text = applyChanges(text, changes);

        const trim = (s: string) => s.replace(/\n+$/, '');
        const expected = view.replace(oldStr, () => newStr);
        // A change that leaves a block with no text takes the block with a break (format §3.4).
        expect(squash(renumbered(dropEmptyBlocks(newestView(text).text))), label).toBe(
          squash(renumbered(dropEmptyBlocks(expected))),
        );
        // The views are compared without their empty blocks, which hides a prefix that the change
        // left behind: the file has no more lines of nothing but a prefix than it had.
        expect(emptyBlockLines(text), `${label}: a prefix is left`).toBeLessThanOrEqual(
          emptyBlockLines(before.text),
        );
        // Blank lines that a suggestion adds between blocks are plain (format §3.4): the original
        // text has them too.
        const blank = (s: string) => s.replace(/\n{3,}/g, '\n\n');
        expect(blank(trim(originalView(text).text)), label).toBe(blank(trim(original)));
        const parsed = expectInOrder(label, threads, text);
        expectNoNewLineStarts(label, before, parsed);
        const marks = new Set(parsed.marks.map((mark) => mark.id));
        for (const id of markIds) expect(marks.has(id), `${label}: ${id}`).toBe(true);
        suggestions++;
      }
    }
    expect(suggestions).toBeGreaterThan(refused);
    expect(checked).toBeLessThanOrEqual(Math.ceil(suggestions / 100));
  });
});

describe('the result', () => {
  it('has the ids of the new marks in the order of the text', () => {
    const text = file('one two three four', {});
    const { markIds, result } = suggest(text, 'one two three four', 'uno two three cuatro', [
      'w8nn',
      'p7qd',
    ]);
    expect(markIds).toEqual(['w8nn', 'p7qd']);
    expect(idsOf(result)).toEqual(['w8nn', 'p7qd']);
  });
});

describe('uniqueMatch', () => {
  it('gives where the quote is', () => {
    expect(uniqueMatch('one two three', 'two')).toBe(4);
  });

  it('refuses a quote that is not there, or is empty, with the text editor tool message', () => {
    for (const quote of ['four', '']) {
      expect(() => uniqueMatch('one two three', quote)).toThrow(NO_MATCH);
    }
    expect(() => uniqueMatch('one', 'two')).toThrow(expect.objectContaining({ code: 'no-match' }));
  });

  it('refuses a quote that is there several times', () => {
    expect(() => uniqueMatch('one two one', 'one')).toThrow(matches(2));
    expect(() => uniqueMatch('one two one', 'one')).toThrow(
      expect.objectContaining({ code: 'many-matches' }),
    );
  });

  it('does not count a match that overlaps an earlier one', () => {
    expect(() => uniqueMatch('aaa', 'aa')).not.toThrow();
  });
});
