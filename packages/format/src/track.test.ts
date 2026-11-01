import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { EditError } from './errors.ts';
import { parse } from './parse.ts';
import { fuzzCount, randomDocument, seeded } from './random-docs.ts';
import {
  LEDGER_NOTE,
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
  hasEmptyBlock,
  squash,
  idsOf,
  randomEdit,
  REFUSALS,
  thread,
} from './test-helpers.ts';
import { trackedEdit, trackedEdits } from './track.ts';
import type { EditContext, Person, TextChange } from './types.ts';
import { newestView, originalView } from './views.ts';

/** Makes a tracked edit and returns the new file. */
function track(
  text: string,
  edit: TextChange,
  author: Person = ada,
  ids: string[] = [],
  more: Partial<EditContext> = {},
): string {
  return applyChanges(text, trackedEdit(text, edit, context(author, ids, more)));
}

const type = (at: number, insert: string): TextChange => ({ from: at, to: at, insert });
const remove = (from: number, to: number): TextChange => ({ from, to, insert: '' });
const replace = (from: number, to: number, insert: string): TextChange => ({ from, to, insert });

/** The ledger entry of a mark that these tests' edits write. */
const entry = (by: string) => ({ by, at: TIME });

describe('typing', () => {
  it('insert in plain text', () => {
    const result = track('a b', type(1, 'x'), ada, ['k3x9']);
    expect(result).toBe(
      [
        'a<!--ins k3x9-->x<!--/k3x9--> b',
        '',
        '<!-- redlines',
        LEDGER_NOTE,
        'version: 1',
        'people:',
        '  ada: {name: Ada Lovelace, email: ada@example.org}',
        'marks:',
        '  k3x9: {by: ada, at: 2026-10-31T09:00Z}',
        '-->',
        '',
      ].join('\n'),
    );
    expect(parse(result).warnings).toEqual([]);
  });

  it('extends own insertion', () => {
    const text = file('a<!--ins k3x9-->x<!--/k3x9--> b', { k3x9: 'ada' });
    const closer = text.indexOf('<!--/k3x9-->');
    const expected = text.replace('x<!--/k3x9-->', 'xy<!--/k3x9-->');
    // At the end of the text, before the closer: the one change is the typed text.
    expect(trackedEdit(text, type(closer, 'y'), context(ada))).toEqual([type(closer, 'y')]);
    expect(track(text, type(closer, 'y'))).toBe(expected);
    // Just after the insertion: still its end.
    expect(track(text, type(closer + '<!--/k3x9-->'.length, 'y'))).toBe(expected);
    // Inside it.
    const inside = file('a<!--ins k3x9-->xz<!--/k3x9--> b', { k3x9: 'ada' });
    expect(track(inside, type(inside.indexOf('z'), 'y'))).toBe(inside.replace('xz', 'xyz'));
    // At its start, before the opener or after it.
    const opener = text.indexOf('<!--ins');
    expect(track(text, type(opener, 'y'))).toBe(text.replace('>x<', '>yx<'));
    expect(track(text, type(opener + '<!--ins k3x9-->'.length, 'y'))).toBe(
      text.replace('>x<', '>yx<'),
    );
  });

  it("splits another's insertion", () => {
    const text = file('a<!--ins k3x9-->xz<!--/k3x9--> b', { k3x9: 'bo' });
    const result = track(text, type(text.indexOf('z'), 'y'), ada, ['w8nn']);
    expect(bodyOf(result)).toBe(
      'a<!--ins k3x9-->x<!--/k3x9--><!--ins w8nn-->y<!--/w8nn--><!--ins k3x9-->z<!--/k3x9--> b',
    );
    const parsed = expectInOrder('split', [], result);
    expect(parsed.ledger.marks).toEqual({
      k3x9: { by: 'bo', at: '2026-10-13T22:30Z' },
      w8nn: entry('ada'),
    });
    expect(parsed.marks.map((m) => [m.id, m.segments.length])).toEqual([
      ['k3x9', 2],
      ['w8nn', 1],
    ]);
    expect(newestView(result).text).toBe('axyz b\n');
    expect(originalView(result).text).toBe('a b\n');
  });

  it('does not split another’s insertion at its edges, but goes before or after it', () => {
    const text = file('a<!--ins k3x9-->xz<!--/k3x9--> b', { k3x9: 'bo' });
    const opener = text.indexOf('<!--ins k3x9-->');
    const content = opener + '<!--ins k3x9-->'.length;
    const closer = text.indexOf('<!--/k3x9-->');
    const before = 'a<!--ins w8nn-->y<!--/w8nn--><!--ins k3x9-->xz<!--/k3x9--> b';
    const after = 'a<!--ins k3x9-->xz<!--/k3x9--><!--ins w8nn-->y<!--/w8nn--> b';
    expect(bodyOf(track(text, type(opener, 'y'), ada, ['w8nn']))).toBe(before);
    expect(bodyOf(track(text, type(content, 'y'), ada, ['w8nn']))).toBe(before);
    expect(bodyOf(track(text, type(closer, 'y'), ada, ['w8nn']))).toBe(after);
    expect(bodyOf(track(text, type(closer + 12, 'y'), ada, ['w8nn']))).toBe(after);
  });

  it('splits a substitution of another person, and an insertion that holds it', () => {
    const sub = file('In <!--sub p7qd March-->April<!--/p7qd-->.', { p7qd: 'bo' });
    const result = track(sub, type(sub.indexOf('ril'), 'x'), ada, ['w8nn']);
    expect(bodyOf(result)).toBe(
      'In <!--sub p7qd March-->Ap<!--/p7qd--><!--ins w8nn-->x<!--/w8nn--><!--sub p7qd-->ril<!--/p7qd-->.',
    );
    expect(newestView(result).text).toBe('In Apxril.\n');
    expect(originalView(result).text).toBe('In March.\n');

    const nested = file('<!--ins k3x9-->ab <!--sub p7qd cd-->ef<!--/p7qd--> gh<!--/k3x9-->', {
      k3x9: 'bo',
      p7qd: 'claude-ada',
    });
    const both = track(nested, type(nested.indexOf('f'), 'x'), ada, ['w8nn']);
    // Both are closed in front of the new text and opened again after it, so that no insertion
    // holds another one.
    expect(bodyOf(both)).toBe(
      '<!--ins k3x9-->ab <!--sub p7qd cd-->e<!--/p7qd--><!--/k3x9--><!--ins w8nn-->x<!--/w8nn--><!--ins k3x9--><!--sub p7qd-->f<!--/p7qd--> gh<!--/k3x9-->',
    );
    expect(newestView(both).text).toBe('ab exf gh\n');
    expect(originalView(both).text).toBe(originalView(nested).text);
    expectInOrder('both', [], both);
  });

  it('types inside my own insertion that holds another person’s deletion', () => {
    const text = file('<!--ins k3x9-->ab <!--del b4rt cd-->ef<!--/k3x9-->', {
      k3x9: 'ada',
      b4rt: 'bo',
    });
    const result = track(text, type(text.indexOf('ef'), 'x'));
    expect(bodyOf(result)).toBe('<!--ins k3x9-->ab <!--del b4rt cd-->xef<!--/k3x9-->');
  });

  it('keeps my text out of another person’s mark inside my insertion', () => {
    const text = file('<!--ins k3x9-->ab <!--sub p7qd cd-->ef<!--/p7qd--> gh<!--/k3x9-->', {
      k3x9: 'ada',
      p7qd: 'bo',
    });
    // In the middle of Bo's replacement, inside my insertion: Bo's mark is split around the text.
    const middle = track(text, type(text.indexOf('f'), 'x'));
    expect(bodyOf(middle)).toBe(
      '<!--ins k3x9-->ab <!--sub p7qd cd-->e<!--/p7qd-->x<!--sub p7qd-->f<!--/p7qd--> gh<!--/k3x9-->',
    );
    // At the end of Bo's replacement the text goes after it, still in my insertion.
    const end = track(text, type(text.indexOf('<!--/p7qd-->'), 'x'));
    expect(bodyOf(end)).toBe('<!--ins k3x9-->ab <!--sub p7qd cd-->ef<!--/p7qd-->x gh<!--/k3x9-->');
  });

  it('writes the typed text with the line breaks of the file', () => {
    const lf = track('a b', type(1, 'x\ny'), ada, ['k3x9', 'w8nn']);
    expect(bodyOf(lf)).toBe('a<!--ins k3x9-->x<!--split w8nn-->\ny<!--/k3x9--> b');
    // The ledger takes the place of the final line break, and ends with one.
    const crlf = track('a b\r\n', type(1, 'x\ny'), ada, ['k3x9', 'w8nn']);
    expect(bodyOf(crlf)).toBe('a<!--ins k3x9-->x<!--split w8nn-->\r\ny<!--/k3x9--> b');
    expect(crlf.endsWith('-->\r\n')).toBe(true);
    expect(crlf.replaceAll('\r\n', '')).not.toContain('\n');
  });

  it('does nothing for an edit that changes nothing', () => {
    expect(trackedEdit('a b', type(1, ''), context(ada))).toEqual([]);
    expect(trackedEdit('a b', remove(1, 1), context(ada))).toEqual([]);
  });
});

describe('deleting', () => {
  it('deletes plain text into a del', () => {
    const result = track('a b c', remove(2, 3), ada, ['k3x9']);
    expect(bodyOf(result)).toBe('a <!--del k3x9 b--> c');
    expect(parse(result).ledger.marks).toEqual({ k3x9: entry('ada') });
    expect(newestView(result).text).toBe('a  c\n');
    expect(originalView(result).text).toBe('a b c\n');
  });

  it('puts the text of the deletion in its payload, escaped', () => {
    const text = 'x -- `y` | {{z}} \\ end-';
    const result = track(text, remove(1, text.length), ada, ['k3x9']);
    const parsed = parse(result);
    expect(parsed.marks[0]?.payload).toBe(text.slice(1));
    // A backslash that nothing follows in an escape stays a single one.
    expect(result).toContain('<!--del k3x9  -\\- \\x60y\\x60 \\| {\\{z}} \\ end\\x2d-->');
    expect(parsed.warnings).toEqual([]);
  });

  it('deletes emoji', () => {
    const text = 'a 😀 b';
    const result = track(text, remove(2, 4), ada, ['k3x9']);
    expect(bodyOf(result)).toBe('a <!--del k3x9 😀--> b');
    expect(parse(result).marks[0]?.payload).toBe('😀');
    // Combining characters and a line break.
    const accent = 'café é x\r\ny';
    const accented = track(accent, remove(0, accent.length), ada, ['k3x9']);
    expect(parse(accented).marks[0]?.payload).toBe('café é x\ny');
    expect(accented).toContain('x\\ny-->');
  });

  it('deleting inside own insertion removes text', () => {
    const text = file('a<!--ins k3x9-->xyz<!--/k3x9--> b', { k3x9: 'ada' });
    const y = text.indexOf('y');
    const result = track(text, remove(y, y + 1));
    expect(result).toBe(text.replace('xyz', 'xz'));
    expect(trackedEdit(text, remove(y, y + 1), context(ada))).toEqual([remove(y, y + 1)]);
    expect(originalView(result).text).toBe('a b\n');
  });

  it('removes an insertion of my own when all its text is deleted, and its entry', () => {
    const text = file('a<!--ins k3x9-->x<!--/k3x9--> <!--del b4rt c-->b', {
      k3x9: 'ada',
      b4rt: 'bo',
    });
    const x = text.indexOf('>x<') + 1;
    const result = track(text, remove(x, x + 1));
    expect(bodyOf(result)).toBe('a <!--del b4rt c-->b');
    expect(Object.keys(parse(result).ledger.marks)).toEqual(['b4rt']);
    // The same when the range takes the markers in with it.
    const wide = track(text, remove(text.indexOf('<!--ins'), text.indexOf('<!--/k3x9-->') + 12));
    expect(bodyOf(wide)).toBe('a <!--del b4rt c-->b');
  });

  it('keeps an insertion that still holds another person’s mark', () => {
    const text = file('<!--ins k3x9-->ab<!--del b4rt c--><!--/k3x9-->', {
      k3x9: 'ada',
      b4rt: 'bo',
    });
    const result = track(text, remove(text.indexOf('ab'), text.indexOf('ab') + 2));
    expect(bodyOf(result)).toBe('<!--ins k3x9--><!--del b4rt c--><!--/k3x9-->');
  });

  it('replace makes a sub', () => {
    const result = track('a b c', replace(2, 3, 'x'), ada, ['k3x9']);
    expect(bodyOf(result)).toBe('a <!--sub k3x9 b-->x<!--/k3x9--> c');
    const parsed = parse(result);
    expect(parsed.marks[0]?.payload).toBe('b');
    expect(parsed.ledger.marks).toEqual({ k3x9: entry('ada') });
    expect(newestView(result).text).toBe('a x c\n');
    expect(originalView(result).text).toBe('a b c\n');
  });

  it('replaces text inside my own insertion in place', () => {
    const text = file('a<!--ins k3x9-->xyz<!--/k3x9--> b', { k3x9: 'ada' });
    const y = text.indexOf('y');
    expect(track(text, replace(y, y + 1, 'Q'))).toBe(text.replace('xyz', 'xQz'));
  });

  it('replaces or deletes text inside another person’s insertion with a mark inside it', () => {
    const text = file('<!--ins k3x9-->foo bar qux<!--/k3x9-->', { k3x9: 'bo' });
    const bar = text.indexOf('bar');
    const replaced = track(text, replace(bar, bar + 3, 'baz'), ada, ['w8nn']);
    expect(bodyOf(replaced)).toBe(
      '<!--ins k3x9-->foo <!--sub w8nn bar-->baz<!--/w8nn--> qux<!--/k3x9-->',
    );
    expect(newestView(replaced).text).toBe('foo baz qux\n');
    expect(originalView(replaced).text).toBe('\n');
    const deleted = track(text, remove(bar, bar + 3), ada, ['w8nn']);
    expect(bodyOf(deleted)).toBe('<!--ins k3x9-->foo <!--del w8nn bar--> qux<!--/k3x9-->');
  });

  it('delete over a marker keeps it', () => {
    const text = file('ab<!--del b4rt x-->cd', { b4rt: 'bo' });
    const result = track(text, remove(0, text.indexOf('cd') + 2), ada, ['k3x9']);
    expect(bodyOf(result)).toBe('<!--del k3x9 ab--><!--del b4rt x--><!--del k3x9 cd-->');
    const parsed = expectInOrder('over', [], result);
    // One deletion in two segments, with the text it took.
    expect(parsed.marks.map((m) => [m.id, m.payload, m.segments.length])).toEqual([
      ['k3x9', 'abcd', 2],
      ['b4rt', 'x', 1],
    ]);
    expect(newestView(result).text).toBe('\n');
    expect(originalView(result).text).toBe('abxcd\n');
  });

  it('shares one id between the segments of one deletion', () => {
    const text = file('ab<!--hl h4kz-->cd<!--/h4kz-->ef', { h4kz: 'bo' });
    const result = track(text, remove(1, text.indexOf('e') + 1), ada, ['k3x9']);
    expect(bodyOf(result)).toBe(
      'a<!--del k3x9 b--><!--hl h4kz--><!--del k3x9 cd--><!--/h4kz--><!--del k3x9 e-->f',
    );
    expect(idsOf(result)).toEqual(['k3x9', 'h4kz']);
    expect(parse(result).marks[0]?.segments).toHaveLength(3);
  });

  it('keeps every marker in the range, and goes into another person’s insertion it reaches', () => {
    const text = file('a <!--hl h4kz-->b<!--/h4kz--> <!--ins k3x9-->cd<!--/k3x9--> e', {
      h4kz: 'bo',
      k3x9: 'bo',
    });
    const result = track(text, remove(text.indexOf('b'), text.indexOf('d') + 1), ada, ['w8nn']);
    expect(bodyOf(result)).toBe(
      'a <!--hl h4kz--><!--del w8nn b--><!--/h4kz--><!--del w8nn  --><!--ins k3x9--><!--del w8nn cd--><!--/k3x9--> e',
    );
    expectInOrder('kinds', [], result);
    expect(newestView(result).text).toBe('a  e\n');
    expect(originalView(result).text).toBe('a b  e\n');
  });

  it('deletes across an insertion of mine, and takes its text and its markers along', () => {
    const text = file('ab<!--ins k3x9-->cd<!--/k3x9-->ef', { k3x9: 'ada' });
    const result = track(text, remove(1, text.indexOf('e') + 1), ada, ['w8nn']);
    expect(bodyOf(result)).toBe('a<!--del w8nn be-->f');
    expect(Object.keys(parse(result).ledger.marks)).toEqual(['w8nn']);
    expect(newestView(result).text).toBe('af\n');
    expect(originalView(result).text).toBe('abef\n');
  });

  it('merges with my deletion next to it, before or after, or both', () => {
    const text = file('ab<!--del k3x9 c-->de', { k3x9: 'ada' });
    const marker = text.indexOf('<!--del');
    const after = marker + '<!--del k3x9 c-->'.length;
    expect(bodyOf(track(text, remove(after, after + 1)))).toBe('ab<!--del k3x9 cd-->e');
    expect(bodyOf(track(text, remove(marker - 1, marker)))).toBe('a<!--del k3x9 bc-->de');
    expect(bodyOf(track(text, remove(marker - 1, after + 1)))).toBe('a<!--del k3x9 bcd-->e');
    // The ledger has nothing new to say.
    const changes = trackedEdit(text, remove(after, after + 1), context(ada));
    expect(changes).toHaveLength(1);
  });

  it('merges only into my own deletions', () => {
    const text = file('a<!--del k3x9 b-->c<!--del b4rt d-->e<!--del w8nn f-->g', {
      k3x9: 'ada',
      b4rt: 'bo',
      w8nn: 'ada',
    });
    const c = text.indexOf('c<');
    const e = text.indexOf('e<');
    // Deleting c joins Ada's deletion before it and leaves Bo's after it alone.
    expect(bodyOf(track(text, remove(c, c + 1)))).toBe(
      'a<!--del k3x9 bc--><!--del b4rt d-->e<!--del w8nn f-->g',
    );
    // Deleting e joins Ada's deletion after it and leaves Bo's before it alone.
    expect(bodyOf(track(text, remove(e, e + 1)))).toBe(
      'a<!--del k3x9 b-->c<!--del b4rt d--><!--del w8nn ef-->g',
    );
    // Next to Bo's deletion only: a deletion of its own.
    const other = file('ab<!--del b4rt c-->de', { b4rt: 'bo' });
    const d = other.indexOf('-->de') + 3;
    expect(bodyOf(track(other, remove(d, d + 1), ada, ['k3x9']))).toBe(
      'ab<!--del b4rt c--><!--del k3x9 d-->e',
    );
  });

  it('does not merge into the deletion of a table row', () => {
    const text = file('ab<!--del g5nb row=2 \\| x \\|-->de', { g5nb: 'ada' });
    const result = track(text, remove(1, 2), ada, ['k3x9']);
    expect(bodyOf(result)).toBe('a<!--del k3x9 b--><!--del g5nb row=2 \\| x \\|-->de');
  });
});

describe('replacing over several marks', () => {
  it('deletes the text and types the new text after it', () => {
    const text = file('ab<!--hl h4kz-->cd<!--/h4kz-->ef', { h4kz: 'bo' });
    const result = track(text, replace(1, text.indexOf('e') + 1, 'XY'), ada, ['w8nn', 'k3x9']);
    // The typed text is an insertion of its own; the old text is a deletion in three segments.
    expect(bodyOf(result)).toBe(
      'a<!--del k3x9 b--><!--hl h4kz--><!--del k3x9 cd--><!--/h4kz--><!--del k3x9 e--><!--ins w8nn-->XY<!--/w8nn-->f',
    );
    expectInOrder('replace', [], result);
    expect(newestView(result).text).toBe('aXYf\n');
    expect(originalView(result).text).toBe('abcdef\n');
  });

  it('types into my insertion when a replacement ends in it', () => {
    const text = file('ab<!--ins k3x9-->cd<!--/k3x9-->ef', { k3x9: 'ada' });
    const result = track(text, replace(1, text.indexOf('d') + 1, 'Q'), ada, ['w8nn']);
    expect(bodyOf(result)).toBe('a<!--del w8nn b--><!--ins k3x9-->Q<!--/k3x9-->ef');
    expect(newestView(result).text).toBe('aQef\n');
    expect(originalView(result).text).toBe('abef\n');
  });

  it('only types when the range holds markers and no text', () => {
    const text = file('ab<!--hl h4kz-->cd<!--/h4kz-->ef', { h4kz: 'bo' });
    const open = text.indexOf('<!--hl');
    const result = track(text, replace(open, text.indexOf('c'), 'Q'), ada, ['k3x9']);
    expect(bodyOf(result)).toBe('ab<!--hl h4kz--><!--ins k3x9-->Q<!--/k3x9-->cd<!--/h4kz-->ef');
  });
});

describe('the ledger', () => {
  it('adds the author to people', () => {
    expect(parse(track('a b', type(1, 'x'), ada, ['k3x9'])).ledger.people).toEqual([ada]);
    expect(parse(track('a b', type(1, 'x'), claudeAda, ['k3x9'])).ledger.people).toEqual([
      claudeAda,
    ]);
    expect(parse(track('a b', type(1, 'x'), bo, ['k3x9'])).ledger.people).toEqual([bo]);
    // Someone who is there already is not added again, and keeps their entry.
    const text = file('a b').replace('ada: {name: Ada Lovelace}', 'ada: {name: Ada L.}');
    const again = track(text, type(1, 'x'), ada, ['w8nn']);
    expect(parse(again).ledger.people.map((p) => [p.handle, p.name])).toEqual([
      ['ada', 'Ada L.'],
      ['bo', 'Bo Chen'],
    ]);
    const second = track(text, type(1, 'x'), bo, ['w8nn']);
    expect(parse(second).ledger.people.map((p) => p.handle)).toEqual(['ada', 'bo']);
  });

  it('gives a new mark its author, time, note and group', () => {
    const result = track('a b', type(1, 'x'), claudeAda, ['k3x9'], {
      note: 'Matches the roadmap',
      group: 'g2rs',
    });
    expect(parse(result).ledger.marks['k3x9']).toEqual({
      by: 'claude-ada',
      at: TIME,
      group: 'g2rs',
      note: 'Matches the roadmap',
    });
    expect(result).toContain(
      'k3x9: {by: claude-ada, at: 2026-10-31T09:00Z, group: g2rs, note: Matches the roadmap}',
    );
  });

  it('puts the marks in document order', () => {
    const text = file('a b <!--ins k3x9-->c<!--/k3x9--> d', { k3x9: 'bo' });
    const result = track(text, type(1, 'x'), ada, ['w8nn']);
    expect(Object.keys(parse(result).ledger.marks)).toEqual(['w8nn', 'k3x9']);
  });

  it('draws another id while one is taken, anywhere in the file', () => {
    const text = file('a b <!--ins k3x9-->c<!--/k3x9--> d', { k3x9: 'bo' }, thread('c8d2')).replace(
      'version: 1',
      'version: 1\nfuture: g2rs',
    );
    // Taken as a mark, as a thread and as a value in the ledger; the fourth is free.
    const result = track(text, type(1, 'x'), ada, ['k3x9', 'c8d2', 'g2rs', 'w8nn']);
    expect(idsOf(result)).toContain('w8nn');
  });

  it('keeps the threads where they are', () => {
    const text = file('a <!--cmt c8d2-->b<!--/c8d2--> c', {}, thread('c8d2'));
    const result = track(text, remove(text.indexOf('b'), text.indexOf('b') + 1), bo, ['k3x9']);
    expect(bodyOf(result)).toBe('a <!--cmt c8d2--><!--del k3x9 b--><!--/c8d2--> c');
    expect(parse(result).ledger.comments.map((t) => t.id)).toEqual(['c8d2']);
  });

  it('is left alone, with an error, when it can not be read', () => {
    const broken =
      'a b\n\n<!-- redlines\nversion: 1\npeople: {ada: {name: Ada\nmarks:\n  k3x9: {by: ada}\n-->\n';
    expect(() => trackedEdit(broken, type(1, 'x'), context(ada, ['w8nn']))).toThrow(EditError);
    expect(() => trackedEdit(broken, remove(0, 1), context(ada, ['w8nn']))).toThrow(
      "can't be read",
    );
  });
});

describe('where an edit can go', () => {
  it('moves a position inside a marker out of it', () => {
    const text = file('a<!--ins k3x9-->x<!--/k3x9--> b', { k3x9: 'bo' });
    const inside = text.indexOf('<!--ins k3x9-->') + 4;
    const result = track(text, type(inside, 'y'), ada, ['w8nn']);
    expect(bodyOf(result)).toBe('a<!--ins w8nn-->y<!--/w8nn--><!--ins k3x9-->x<!--/k3x9--> b');
    expectInOrder('inside', [], result);
    // The same for the ends of a range.
    const range = track(text, remove(inside, text.indexOf('<!--/k3x9-->') + 4), ada, ['w8nn']);
    expect(bodyOf(range)).toBe('a<!--ins k3x9--><!--del w8nn x--><!--/k3x9--> b');
    expectInOrder('range', [], range);
  });

  it('keeps everything it writes before the ledger', () => {
    const body = '# Notes\n\nA <!--ins k3x9-->paragraph<!--/k3x9-->.';
    const text = file(body, { k3x9: 'bo' });
    const ledgerStart = text.indexOf('<!-- redlines');
    const ends = 'A <!--ins k3x9-->paragraph<!--/k3x9-->.<!--ins w8nn-->!<!--/w8nn-->';
    // At the end of the paragraph, before the blank line of the ledger.
    expect(bodyOf(track(text, type(body.length, '!'), ada, ['w8nn'])).endsWith(ends)).toBe(true);
    // Inside the ledger: before it.
    expect(bodyOf(track(text, type(ledgerStart + 20, '!'), ada, ['w8nn'])).endsWith(ends)).toBe(
      true,
    );
  });

  it('types after the ledger without damaging it', () => {
    const result = track(fixture, type(fixture.length, 'x'), ada, ['w8nn']);
    expect(result.endsWith('<!--ins w8nn-->x<!--/w8nn-->')).toBe(true);
    const parsed = parse(result);
    expect(parsed.ledger.marks['w8nn']).toEqual(entry('ada'));
    expect(parsed.warnings.map((w) => w.code)).toEqual(['line-start-marker']);
    expect(newestView(result).text).toBe(`${newestView(fixture).text}x`);
    expect(originalView(result).text).toBe(originalView(fixture).text);
  });

  it('deletes the final line break of a file with a ledger', () => {
    const result = track(fixture, remove(fixture.length - 1, fixture.length), bo, ['w8nn']);
    expect(newestView(result).text).toBe(newestView(fixture).text.slice(0, -1));
    expect(originalView(result).text).toBe(originalView(fixture).text);
  });

  it('refuses text that is markup', () => {
    for (const markup of ['<!--ins k3x9-->', 'a<!--/k3x9-->', '\n<!-- redlines\nversion: 1\n-->']) {
      expect(() => trackedEdit('a b', type(1, markup), context(ada, ['w8nn']))).toThrow(EditError);
      expect(() => trackedEdit('a b', replace(0, 1, markup), context(ada, ['w8nn']))).toThrow(
        'holds Redlines markup',
      );
    }
    // An ordinary comment, or markup in code, is only text.
    expect(bodyOf(track('a b', type(1, '<!-- TODO -->'), ada, ['w8nn']))).toBe(
      'a<!--ins w8nn--><!-- TODO --><!--/w8nn--> b',
    );
    expect(() => track('a b', type(1, '`<!--ins k3x9-->`'), ada, ['w8nn'])).not.toThrow();
  });

  it('refuses a change inside code, where its markers would not be read', () => {
    const text = 'Use `code` here, and:\n\n```\nfenced\n```\n';
    const inSpan = text.indexOf('ode');
    const inFence = text.indexOf('fenced') + 2;
    const message = "can't go inside code";
    const ids = ['w8nn'];
    expect(() => trackedEdit(text, type(inSpan, 'x'), context(ada, ids))).toThrow(message);
    expect(() => trackedEdit(text, remove(inSpan, inSpan + 2), context(ada, ids))).toThrow(
      EditError,
    );
    expect(() => trackedEdit(text, type(inFence, 'x'), context(ada, ids))).toThrow(message);
    // Around code is fine.
    const here = text.indexOf('here');
    expect(() => trackedEdit(text, type(here, 'x'), context(ada, ids))).not.toThrow();
  });

  it('throws a RangeError for a range outside the text', () => {
    expect(() => trackedEdit('a b', remove(1, 9), context(ada))).toThrow(RangeError);
    expect(() => trackedEdit('a b', type(-1, 'x'), context(ada))).toThrow(RangeError);
    expect(() => trackedEdit('a b', replace(2, 1, ''), context(ada))).toThrow(RangeError);
  });
});

describe('on the example of format §1.2', () => {
  it('lets Bo type inside Ada’s insertion', () => {
    const at = fixture.indexOf('w <!--/k3x9-->');
    const result = track(fixture, type(at, 'X'), bo, ['w8nn']);
    expect(bodyOf(result)).toContain(
      'the <!--ins k3x9-->ne<!--/k3x9--><!--ins w8nn-->X<!--/w8nn--><!--ins k3x9-->w <!--/k3x9-->importer',
    );
    expect(Object.keys(parse(result).ledger.marks)).toEqual(['k3x9', 'w8nn', 'p7qd', 'w2rf']);
    expect(newestView(result).text).toContain('the neXw importer');
  });

  it('lets Ada type at the end of her own insertion', () => {
    const at = fixture.indexOf('<!--/k3x9-->');
    const result = track(fixture, type(at, 'big '));
    expect(result).toBe(fixture.replace('new <!--/k3x9-->', 'new big <!--/k3x9-->'));
  });

  it('lets Bo delete the word after Ada’s insertion', () => {
    const at = fixture.indexOf('importer');
    const result = track(fixture, remove(at, at + 8), bo, ['w8nn']);
    expect(bodyOf(result)).toContain('<!--/k3x9--><!--del w8nn importer--> in <!--sub p7qd');
    expect(Object.keys(parse(result).ledger.marks)).toEqual(['k3x9', 'w8nn', 'p7qd', 'w2rf']);
  });

  it('lets Ada replace Claude’s new word', () => {
    const at = fixture.indexOf('April');
    const result = track(fixture, replace(at, at + 5, 'May'), ada, ['w8nn']);
    expect(bodyOf(result)).toContain(
      '<!--sub p7qd March--><!--sub w8nn April-->May<!--/w8nn--><!--/p7qd-->',
    );
    expect(newestView(result).text).toContain('importer in May, after');
    expect(originalView(result).text).toBe(originalView(fixture).text);
  });

  it('keeps Bo’s comment where it is when Ada types inside it', () => {
    const at = fixture.indexOf('review<!--/c8d2-->');
    const result = track(fixture, type(at, 'X'), ada, ['w8nn']);
    expect(bodyOf(result)).toContain(
      '<!--cmt c8d2-->security <!--ins w8nn-->X<!--/w8nn-->review<!--/c8d2-->',
    );
    expect(parse(result).ledger.comments.map((t) => t.id)).toEqual(['c8d2']);
  });
});

describe('several edits', () => {
  it('are planned together, with their own ids and one ledger', () => {
    const text = 'a b c d';
    const { changes, markIds } = trackedEdits(
      text,
      [type(1, 'X'), remove(4, 5), replace(6, 7, 'Z')],
      context(ada, ['k3x9', 'w8nn', 'p7qd']),
    );
    const result = applyChanges(text, changes);
    expect(bodyOf(result)).toBe(
      'a<!--ins k3x9-->X<!--/k3x9--> b <!--del w8nn c--> <!--sub p7qd d-->Z<!--/p7qd-->',
    );
    expect(markIds).toEqual(['k3x9', 'w8nn', 'p7qd']);
    // Three changes of the text, and one of the ledger.
    expect(changes).toHaveLength(4);
    expect(Object.keys(parse(result).ledger.marks)).toEqual(['k3x9', 'w8nn', 'p7qd']);
  });

  it('list the marks that are new, and apart from them those of the author that grew', () => {
    const text = file('a<!--ins k3x9-->x<!--/k3x9--> b c', { k3x9: 'ada' });
    const x = text.indexOf('x<');
    const c = text.indexOf(' c');
    const edits = [type(x + 1, 'y'), type(c, 'z')];
    const { markIds, extendedIds } = trackedEdits(text, edits, context(ada, ['w8nn']));
    expect(markIds).toEqual(['w8nn']);
    expect(extendedIds).toEqual(['k3x9']);
    // Nothing is new when the edit only grows the insertion.
    const grown = trackedEdits(text, [type(x + 1, 'y')], context(ada));
    expect(grown.markIds).toEqual([]);
    expect(grown.extendedIds).toEqual(['k3x9']);
  });
});

describe('when an edit would hide another person’s change', () => {
  const text = file('Use the importer `foo` and <!--ins k3x9-->more<!--/k3x9--> here `bar` end.', {
    k3x9: 'bo',
  });
  const backtick = text.indexOf('`foo`');

  /** The error an edit throws, or fails the test. */
  function refusal(edit: TextChange): EditError {
    try {
      trackedEdit(text, edit, context(ada, ['b953']));
    } catch (error) {
      if (error instanceof EditError) return error;
      throw error;
    }
    throw new Error('The edit went through');
  }

  it('refuses to delete the first backtick of a code span, which would pair the next ones', () => {
    // The backtick after foo would pair with the one in front of bar, around Bo's insertion.
    const error = refusal(remove(backtick, backtick + 1));
    expect(error.code).toBe('would-hide-marks');
    expect(error.message).toContain('Accept or reject them first');
  });

  it('refuses to replace it, and to type a backtick that does the same', () => {
    expect(refusal(replace(backtick, backtick + 1, '"')).code).toBe('would-hide-marks');
    const after = text.indexOf(' and');
    expect(refusal(type(after, '`')).code).toBeDefined();
  });

  it('refuses to open an HTML comment in front of the change', () => {
    // The new insertion is swallowed by the comment as well, which is what is said first.
    expect(['inside-code', 'would-hide-marks']).toContain(refusal(type(backtick, '<!-- ')).code);
  });

  it('goes on when the change stays readable, and tracks it', () => {
    const word = text.indexOf('importer');
    const result = track(text, remove(word, word + 8), ada, ['b953']);
    expect(Object.keys(parse(result).ledger.marks)).toEqual(['b953', 'k3x9']);
    expect(parse(result).marks.map((m) => m.id)).toEqual(['b953', 'k3x9']);
  });
});

describe('the code of an error', () => {
  const codeOf = (action: () => unknown): string | undefined => {
    try {
      action();
    } catch (error) {
      if (error instanceof EditError) return error.code;
      throw error;
    }
    return 'no error';
  };

  it('says why an edit can not be made', () => {
    const broken = 'a b\n\n<!-- redlines\nversion: 1\npeople: {ada: {name: Ada\n-->\n';
    const ctx = () => context(ada, ['w8nn']);
    expect(codeOf(() => trackedEdit(broken, type(1, 'x'), ctx()))).toBe('unreadable-ledger');
    expect(codeOf(() => trackedEdit('Use `code` here', type(6, 'x'), ctx()))).toBe('inside-code');
    expect(codeOf(() => trackedEdit('a b', type(1, '<!--ins k3x9-->'), ctx()))).toBe('markup');
    expect(codeOf(() => trackedEdit('a b', type(1, 'x'), ctx()))).toBe('no error');
  });
});

/** Ids for the random tests: a different series for each edit. */
function randomBytes(seed: number, step: number): (n: number) => Uint8Array {
  const random = seeded(seed * 104729 + step);
  return (n) => Uint8Array.from({ length: n }, () => Math.floor(random() * 256));
}

describe('on random documents', { timeout: 600_000 }, () => {
  const AUTHORS = [ada, bo, claudeAda];
  const INSERTS = [
    'x',
    'new words',
    '😀',
    'é',
    'café ',
    '\n',
    '\n\n',
    ' ',
    'a--b',
    '`',
    '<!-- ',
    '**',
    '_',
    '\\',
    '[x](y)',
    '- item',
    'one\n\ntwo',
  ];

  it('edits the newest view, keeps the original view, and leaves marks and ledger in order', () => {
    const documents = fuzzCount(150);
    let edits = 0;
    let refused = 0;
    for (let seed = 1; seed <= documents; seed++) {
      const random = seeded(seed * 7919);
      const below = (n: number) => Math.floor(random() * n);
      let text = randomDocument(seeded(seed));
      const threads = parse(text).ledger.comments.map((t) => t.id);
      for (let step = 0; step < 4; step++) {
        const view = newestView(text);
        const original = originalView(text).text;
        const before = parse(text);
        const author = AUTHORS[below(AUTHORS.length)] as Person;
        const wanted = randomEdit(below, view.text, INSERTS);
        // The edit in the file: the ends of a range stay on its text, the point of an insertion
        // is on either side of the markers.
        const edit =
          wanted.from === wanted.to
            ? type(view.map.toSource(wanted.from, below(2) === 0 ? -1 : 1), wanted.insert)
            : replace(
                view.map.toSource(wanted.from, 1),
                view.map.toSource(wanted.to, -1),
                wanted.insert,
              );
        const label = `seed ${seed}, step ${step}: ${JSON.stringify(wanted)} by ${author.handle} on ${JSON.stringify(bodyOf(text))}`;

        const ctx = { author, time: TIME, random: randomBytes(seed, step) };
        let after: string;
        try {
          after = applyChanges(text, trackedEdit(text, edit, ctx));
        } catch (error) {
          // An edit that has no place for its markers, or would hide other changes, is refused.
          if (error instanceof EditError && REFUSALS.includes(error.code ?? '')) {
            refused++;
            continue;
          }
          throw new Error(`${label}: ${String(error)}`, { cause: error });
        }

        // A file with a ledger ends with the line break after the ledger, which the views show,
        // so they are compared without their final line breaks.
        const body = (s: string) => s.replace(/\n+$/, '');
        const expected = applyChanges(view.text, [wanted]);
        // A deletion of all the text of a block takes a break along with it (format §3.4).
        if (!hasEmptyBlock(expected) || hasEmptyBlock(view.text)) {
          expect(squash(newestView(after).text), label).toBe(squash(expected));
        }
        expect(
          body(originalView(after).text),
          `${label}\n=> ${JSON.stringify(bodyOf(after))}`,
        ).toBe(body(original));
        const parsed = expectInOrder(label, threads, after);
        expectNoNewLineStarts(label, before, parsed);
        // No mark is lost, except an insertion or deletion of the author's own that was used up.
        const kept = new Set(parsed.marks.map((m) => m.id));
        for (const mark of before.marks) {
          if (kept.has(mark.id)) continue;
          expect(mark.entry.by, `${label}: ${mark.id} was lost`).toBe(author.handle);
          expect(['ins', 'del'], `${label}: ${mark.id} was lost`).toContain(mark.kind);
        }
        text = after;
        edits++;
      }
    }
    // Most edits go through.
    expect(edits).toBeGreaterThan(refused);
  });
});
