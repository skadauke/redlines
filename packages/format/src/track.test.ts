import { micromark } from 'micromark';
import { describe, expect, it } from 'vitest';
import { bodyStart, breakLength, continuationPrefix } from './blocks.ts';
import { applyChanges } from './changes.ts';
import { acceptAll, rejectAll } from './decide.ts';
import { EditError } from './errors.ts';
import { parse } from './parse.ts';
import { fuzzCount, randomDocument, seeded } from './random-docs.ts';
import {
  LEDGER_NOTE,
  TIME,
  ada,
  blockLeaves,
  blocksOnly,
  bo,
  bodyOf,
  claudeAda,
  context,
  dropEmptyBlocks,
  emptyBlockLines,
  expectInOrder,
  editedDocument,
  exactly,
  expectEveryOrderAlike,
  expectNoNewLineStarts,
  file,
  fixture,
  idsOf,
  markersInIndentedCode,
  naturalOffsets,
  prefixEdit,
  randomEdit,
  REFUSALS,
  renumbered,
  squash,
  thread,
} from './test-helpers.ts';
import { SELF_CHECK, trackedEdit, trackedEdits } from './track.ts';
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
    // The file ends as it did, without a line break (format §5.1).
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
    expect(newestView(result).text).toBe('a  c');
    expect(originalView(result).text).toBe('a b c');
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
    expect(newestView(result).text).toBe('a x c');
    expect(originalView(result).text).toBe('a b c');
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
    // A fenced block takes no marker either, so the change replaces the block whole (format §3.5).
    const fenced = applyChanges(text, trackedEdit(text, type(inFence, 'x'), context(ada, ids)));
    expect(fenced).toContain('<!--sub w8nn \\x60\\x60\\x60\\nfenced\\n\\x60\\x60\\x60-->');
    expect(fenced).toContain('```\nfexnced\n```\n<!--/w8nn-->');
    // Around code is fine.
    const here = text.indexOf('here');
    expect(() => trackedEdit(text, type(here, 'x'), context(ada, ids))).not.toThrow();
  });

  it('refuses typed text that would land on another line than it was typed on (#111)', () => {
    // A line break typed at the start of an item after Bo's split goes in front of his marker,
    // where the bullet keeps the two breaks apart (format §3.4). The words typed after it would
    // then stand on the line above the item, not on the line after it: the last check compares
    // where the line breaks fall among the letters, not only the letters.
    const text = file('- one <!--split s3vb-->\n- two', { s3vb: 'bo' });
    const at = text.indexOf('two');
    for (const author of [ada, bo]) {
      expect(() => track(text, type(at, '\nfoo'), author, ['k3x9', 'w8nn'])).toThrow(SELF_CHECK);
    }
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

describe('an insertion that ends in a backslash', () => {
  // The editor froze here: a backslash and the character after the closer are one escape, so the
  // edit takes both, which is two new marks, and the random source of the call gave the same id
  // twice. No input is allowed to keep an edit from ending.
  const body = 'Hi <!--ins bvv3-->\\<!--/bvv3-->tar';

  it('is kept whole when the character after its closer is deleted', { timeout: 10_000 }, () => {
    for (const by of ['bo', 'ada']) {
      const text = file(body, { bvv3: by });
      const at = text.indexOf('tar');
      const after = track(text, remove(at, at + 1), ada, ['w8nn', 'p3qz']);
      expect(parse(after).warnings, by).toEqual([]);
      // The backslash is in the file as it was, and the `t` is gone from the text.
      expect(newestView(after).text, by).toBe('Hi \\ar\n');
      expect(originalView(after).text, by).toBe('Hi tar\n');
    }
  });

  it('is the same on the text of the editor, three Deletes in a row', { timeout: 10_000 }, () => {
    let text = 'Escaped \\*star\\* and a\\_b.\n';
    const views = [
      'Escaped \\star\\* and a\\_b.\n',
      'Escaped \\tar\\* and a\\_b.\n',
      'Escaped \\ar\\* and a\\_b.\n',
    ];
    for (const [i, wanted] of views.entries()) {
      const view = newestView(text);
      const at = i === 0 ? 9 : view.text.indexOf('\\') + 1;
      const from = view.map.toSource(at, 1);
      const to = view.map.toSource(at + 1, -1);
      text = track(text, remove(from, to), ada, ['k3x9', 'w8nn', 'p3qz', 'q4gt', 'r5tw', 's6vx']);
      expect(newestView(text).text).toBe(wanted);
      expect(parse(text).warnings).toEqual([]);
    }
  });

  it(
    'is refused, and does not loop, when the random source repeats itself',
    {
      timeout: 10_000,
    },
    () => {
      const text = file(body, { bvv3: 'bo' });
      const at = text.indexOf('tar');
      const stuck: EditContext = { author: ada, time: TIME, random: (n) => new Uint8Array(n) };
      expect(() => trackedEdit(text, remove(at, at + 1), stuck)).toThrow(EditError);
      // One new mark is enough for other edits, so the same source makes them.
      const plain = file('Hi tar', {});
      expect(() => trackedEdit(plain, remove(3, 4), stuck)).not.toThrow();
    },
  );
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

  it('refuses text typed in my own insertion that opens a comment over a closer', () => {
    // No new mark is made: the text is part of my insertion. The comment it opens would swallow the
    // closer of Bo's comment, which would stop at a point.
    const own = file(
      'a <!--ins k3x9-->b <!--cmt c8d2-->c<!--/k3x9--> d<!--/c8d2--> e',
      { k3x9: 'ada' },
      thread('c8d2', 'bo'),
    );
    const edit = type(own.indexOf('b <!--cmt') + 2, '<!-- ');
    let code: string | undefined;
    try {
      trackedEdit(own, edit, context(ada, ['b953']));
    } catch (error) {
      if (error instanceof EditError) code = error.code;
      else throw error;
    }
    expect(code).toBe('would-hide-marks');
    // A closer that is swallowed whole is caught the same way.
    const closer = type(own.indexOf('<!--/k3x9-->'), '<!-- ');
    expect(() => trackedEdit(own, closer, context(ada, ['b953']))).toThrow(EditError);
  });

  it('goes on when the change stays readable, and tracks it', () => {
    const word = text.indexOf('importer');
    const result = track(text, remove(word, word + 8), ada, ['b953']);
    expect(Object.keys(parse(result).ledger.marks)).toEqual(['b953', 'k3x9']);
    expect(parse(result).marks.map((m) => m.id)).toEqual(['b953', 'k3x9']);
  });
});

describe('an edit in code (#153)', () => {
  /** The words of a tracked change whose markers code would hide (format §2.1). */
  const IN_CODE =
    "A tracked change can't go inside code or an HTML comment, where its markers would not be read. Change the whole code span or comment instead.";

  /** The same code, indented and fenced: a line of words, a line of `>` alone, a blank line and
   * another line of words, at the top level, in list items (four columns past the start of their
   * text) and in a quote. The fenced blocks are what the indented ones are measured against. */
  const BLOCKS: readonly (readonly [string, string])[] = [
    ['indented', 'Para.\n\n    code line\n    >\n\n    more code\n\nAfter.'],
    ['indented in an item', '- Item.\n\n      code line\n      >\n\n      more code\n\n  After.'],
    [
      'indented eight spaces in an item',
      '-   Item.\n\n        code line\n        >\n\n        more code\n\n    After.',
    ],
    [
      'indented in a numbered item',
      '1. Item.\n\n       code line\n       >\n\n       more code\n\n   After.',
    ],
    [
      'indented in a quote',
      '> Para.\n>\n>     code line\n>     >\n>\n>     more code\n>\n> After.',
    ],
    ['fenced', 'Para.\n\n```\ncode line\n>\n\nmore code\n```\n\nAfter.'],
    ['fenced in an item', '- Item.\n\n  ```\n  code line\n  >\n\n  more code\n  ```\n\n  After.'],
  ];

  /** Where `needle` ends in `text`. */
  const endOf = (text: string, needle: string) => text.indexOf(needle) + needle.length;
  const more = (text: string) => text.indexOf('more');
  /** Where the `>` of the line of `>` alone is. */
  const quoteMark = (text: string) => text.indexOf('>', endOf(text, 'code line\n'));

  /** The edits that put a marker inside the code, by what they do. */
  const EDITS: readonly (readonly [string, (text: string) => TextChange])[] = [
    ['typing in a line', (t) => type(more(t) + 2, 'x')],
    ['typing at the start of a line', (t) => type(more(t), 'x')],
    ['typing at the end of a line', (t) => type(endOf(t, 'code line'), 'x')],
    ['deleting in a line', (t) => remove(more(t), more(t) + 3)],
    ['replacing a word', (t) => replace(more(t), more(t) + 4, 'less')],
    [
      'replacing the text of the block',
      (t) => replace(t.indexOf('code line'), endOf(t, 'more code'), 'New'),
    ],
    ['Enter in a line', (t) => type(more(t) + 2, '\n')],
    ['Enter twice in a line', (t) => type(more(t) + 2, '\n\n')],
    ['Enter at the start of a line', (t) => type(t.indexOf('code line'), '\n')],
    ['Backspace at the start of a line', (t) => remove(endOf(t, 'code line'), quoteMark(t))],
    ['Backspace on the line of `>` alone', (t) => remove(quoteMark(t), quoteMark(t) + 1)],
    [
      'Backspace at the start of the text after it',
      (t) => remove(endOf(t, 'more code'), t.indexOf('After')),
    ],
    ['deleting from it into the text after it', (t) => remove(more(t) + 2, t.indexOf('After') + 2)],
  ];

  /** The error of a tracked edit by Ada, or undefined when it goes through. */
  function refusal(text: string, edit: TextChange): EditError | undefined {
    try {
      trackedEdit(text, edit, context(ada, ['b953', 'w8nn', 'p3qz']));
    } catch (error) {
      if (error instanceof EditError) return error;
      throw error;
    }
    return undefined;
  }

  it('is refused in indented code, in the words of fenced code, at the top level, in a list item and in a quote', () => {
    for (const [what, body] of BLOCKS) {
      const text = file(body);
      for (const [how, edit] of EDITS) {
        const label = `${what}, ${how}`;
        const error = refusal(text, edit(text));
        // Code at the top level takes the edits that stay inside it as a substitution of the whole
        // block (format §3.5): no marker lands in the code, and rejecting gives the block back.
        if (error === undefined && (what === 'indented' || what.startsWith('fenced'))) {
          const result = applyChanges(
            text,
            trackedEdit(text, edit(text), context(ada, ['b953', 'w8nn', 'p3qz'])),
          );
          expect(
            parse(result).marks.map((mark) => mark.kind),
            label,
          ).toEqual(['sub']);
          expect(markersInIndentedCode(result), label).toEqual([]);
          expect(bodyOf(applyChanges(result, rejectAll(result))).replace(/\n+$/, ''), label).toBe(
            body,
          );
          continue;
        }
        expect(error, label).toBeDefined();
        if (what.startsWith('fenced') || what === 'indented') {
          // Fenced code takes no marker either, and a fence line none at all; a change that ends a
          // block at the top level is refused as one that would end it.
          expect(['inside-code', 'no-legal-placement'], label).toContain(error?.code);
          continue;
        }
        expect(error?.code, label).toBe('inside-code');
        // In a list item or a quote: code that is not built yet, in words that name it.
        expect(
          [IN_CODE, error?.message].some(
            (m) =>
              m === error?.message &&
              (m === IN_CODE || /can't go in (?:indented )?code .*yet/.test(m ?? '')),
          ),
          label,
        ).toBe(true);
      }
    }
  });

  it('goes around the whole block, as it does around fenced code', () => {
    for (const [what, body] of BLOCKS) {
      const text = file(body);
      // From the text before the block to the text after it: one deletion, outside the code.
      const from = body.search(/Para|Item/) + 2;
      const result = track(text, remove(from, body.indexOf('After') + 2), ada, ['b953']);
      expect(markersInIndentedCode(result), what).toEqual([]);
      expect(newestView(result).text, what).toBe(
        newestView(text).text.replace(/(?:Para|Item)[^]*Af/, (s) => s.slice(0, 2)),
      );
      expect(originalView(result).text, what).toBe(originalView(text).text);
    }
  });

  it('deletes from the text before the block into it, and joins the two, outside the code', () => {
    // The deletion stands in the text before the block, and the code it leaves goes on that text:
    // Backspace at the start of the code, or a deletion from the paragraph into a line of it. (A
    // fence can't go, which would leave the closing fence to open a block.)
    for (const [what, body] of BLOCKS.filter(([what]) => !what.startsWith('fenced'))) {
      const text = file(body);
      const end = body.search(/(?:Para|Item)\./) + 5;
      for (const [how, edit, newest] of [
        ['Backspace', remove(end, body.indexOf('code line')), '.code line'],
        ['deleting', remove(end - 3, body.indexOf('more') + 2), 're code'],
      ] as const) {
        const result = track(text, edit, ada, ['b953']);
        expect(markersInIndentedCode(result), `${what}, ${how}`).toEqual([]);
        expect(originalView(result).text, `${what}, ${how}`).toBe(originalView(text).text);
        expect(newestView(result).text, `${what}, ${how}`).toContain(newest);
      }
    }
  });

  it('types a whole code block with its closer alone on the line after it, as a fenced one (format §3.3)', () => {
    for (const [what, body, at, typed, written] of [
      [
        'after a paragraph',
        'Para.\n\nAfter.',
        5,
        '\n\n    new code\n\n    more code',
        'Para.<!--ins b953--><!--split w8nn-->\n\n    new code\n\n    more code\n<!--/b953-->\n\nAfter.',
      ],
      [
        'in front of a block',
        'Para.\n\nAfter.',
        7,
        '    new code\n\n',
        'Para.\n\n<!--ins b953-->\n\n    new code\n<!--/b953--><!--split w8nn-->\n\nAfter.',
      ],
      [
        'in a list item',
        '- Item.\n\n  After.',
        7,
        '\n\n      new code',
        '- Item.<!--ins b953--><!--split w8nn-->\n\n      new code\n  <!--/b953-->\n\n  After.',
      ],
      [
        'in a quote',
        '> Para.\n>\n> After.',
        7,
        '\n>\n>     new code',
        '> Para.<!--ins b953--><!--split w8nn-->\n>\n>     new code\n> <!--/b953-->\n>\n> After.',
      ],
      [
        'fenced, for reference',
        'Para.\n\nAfter.',
        5,
        '\n\n```\nnew code\n```',
        'Para.<!--ins b953--><!--split w8nn-->\n\n```\nnew code\n```\n<!--/b953-->\n\nAfter.',
      ],
      // Text after it, past a blank line, as when it is pasted: the split goes on the line after it.
      [
        'with text after it',
        'Para.\n\nAfter.',
        5,
        '\n\nIntro:\n\n    new code\n\n    more code\n\nMore text.',
        'Para.<!--ins b953--><!--split w8nn-->\n\nIntro:<!--split p3qz-->\n\n    new code\n\n    more code\n<!--split k3x9-->\n\nMore text.<!--/b953-->\n\nAfter.',
      ],
      [
        'with text after it, in a list item',
        '- Item.\n\n  After.',
        7,
        '\n\n      new code\n\n  More text.',
        '- Item.<!--ins b953--><!--split w8nn-->\n\n      new code\n  <!--split p3qz-->\n\n  More text.<!--/b953-->\n\n  After.',
      ],
      [
        'fenced, with text after it',
        'Para.\n\nAfter.',
        5,
        '\n\nIntro:\n\n```\nnew code\n```\n\nMore text.',
        'Para.<!--ins b953--><!--split w8nn-->\n\nIntro:<!--split p3qz-->\n\n```\nnew code\n```\n<!--split k3x9-->\n\nMore text.<!--/b953-->\n\nAfter.',
      ],
    ] as const) {
      const text = file(body);
      const result = track(text, type(at, typed), ada, ['b953', 'w8nn', 'p3qz', 'k3x9', 'm2bd']);
      expect(bodyOf(result).replace(/\n+$/, ''), what).toBe(written);
      expect(markersInIndentedCode(result), what).toEqual([]);
      // Accepting keeps the line break that the closer stands after: one blank line more, which
      // leaves the blocks as they are.
      const typedView = applyChanges(body, [type(at, typed)]);
      expect(blockLeaves(newestView(result).text), what).toEqual(blockLeaves(typedView));
      expect(bodyOf(applyChanges(result, rejectAll(result))).replace(/\n+$/, ''), what).toBe(body);
      expectEveryOrderAlike(what, result);
    }
    // In a tight list a blank line after it would make the list loose; in front of other code, it
    // would be a part of it: the closer has no place.
    for (const [body, at, typed] of [
      ['- Item.\n- Next.', 7, '\n\n      new code'],
      ['Para.\n\n    old code', 5, '\n\n    new code'],
    ] as const) {
      expect(refusal(file(body), type(at, typed))?.code, body).toBe('inside-code');
    }
  });

  it('is made on a line indented four spaces that goes on a paragraph, or that is the text of an item', () => {
    // Indented code can't interrupt a paragraph, and four spaces are two past an item's text.
    for (const body of [
      'Para.\n    text more',
      '- Item.\n\n    text more',
      '> Para.\n>     text more',
    ]) {
      const text = file(body);
      const result = track(text, type(text.indexOf('more') + 2, 'x'), ada, ['b953']);
      expect(bodyOf(result).replace(/\n+$/, ''), body).toBe(
        body.replace('more', 'mo<!--ins b953-->x<!--/b953-->re'),
      );
      expect(markersInIndentedCode(result), body).toEqual([]);
    }
  });

  it('is refused on a line that is indented code once a pending change is decided', () => {
    // Bo's line break makes the line indented code once it is accepted, and Bo's deletion of the
    // blank line above it keeps it code until it is accepted.
    const split = file('Para.\n    text more');
    const broken = track(split, type(5, '\n\n'), bo, ['w8nn']);
    const code = file('Para.\n\n    text more');
    const joined = track(code, remove(5, code.indexOf('text')), bo, ['w8nn']);
    for (const [what, text] of [
      ['a line break that makes it code', broken],
      ['a deletion that makes it a line of the paragraph', joined],
    ] as const) {
      expect(markersInIndentedCode(text), what).toEqual([]);
      for (const [how, edit] of [
        ['typing', type(text.indexOf('more') + 2, 'x')],
        ['deleting', remove(text.indexOf('more'), text.indexOf('more') + 2)],
        ['Enter', type(text.indexOf('more') + 2, '\n')],
      ] as const) {
        const error = refusal(text, edit);
        // A pending change of Bo's touches the code: refused, naming him; or the old words where the
        // code is in one view only and nothing of his is near.
        const named = error?.code === 'no-legal-placement';
        expect(named || error?.code === 'inside-code', `${what}, ${how}`).toBe(true);
        expect(error?.message, `${what}, ${how}`).toSatisfy((m: string) =>
          named ? m.includes('pending change is in this code block') : m === IN_CODE,
        );
      }
    }
  });

  it('is refused where it would make the markers of another change code', () => {
    // Bo's comment is on a line that goes on the paragraph: a blank line above it would make it
    // indented code, with the comment's markers in it.
    const text = file('Para.\n    text <!--cmt c8d2-->more<!--/c8d2-->', {}, thread('c8d2', 'bo'));
    expect(markersInIndentedCode(text)).toEqual([]);
    const error = refusal(text, type(5, '\n\n'));
    expect(error?.code).toBe('would-hide-marks');
  });

  it('says what to do where taking the bullet of an empty item away would make it code', () => {
    // After Enter at the end of an item that a deeper item follows, Backspace puts spaces for the
    // bullet: written as they are, the new item's text would start with code.
    for (const [body, after] of [
      ['- one\n    - two\n        - three', '    - two'],
      ['- one\n\t- two', '\t- two'],
    ] as const) {
      const enter = type(body.indexOf(after) + after.length, '\n    - ');
      const text = track(file(body), enter, ada, ['w8nn']);
      const item = (/\n {4}- (?:\n|$)/.exec(bodyOf(text))?.index ?? -2) + 1;
      const error = refusal(text, { from: item + 2, to: item + 6, insert: '    ' });
      expect(error?.code, body).toBe('inside-code');
      expect(error?.message, body).toBe(
        "This would make indented code of the empty list item, where the change's markers would not be read. Undo the line break that made the item instead, or take the item away with Track Changes off.",
      );
    }
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

/** A view as the tests of the decisions compare it: blank lines at the very start are no block, and
 * one blank line between blocks is as good as two. */
const flat = (view: string): string =>
  squash(view)
    .replace(/^\n+/, '')
    .replace(/\n{2,}/g, '\n\n');

/** The text that accepting every change of a file leaves, and the text that rejecting every one
 * does, as the newest view of the file then shows it: the comments and highlights stay. A decision
 * that has no legal form for its markers is refused (`no-legal-placement`); its text is undefined. */
function decided(after: string): { accepted: string | undefined; rejected: string | undefined } {
  const view = (decide: (text: string) => TextChange[]): string | undefined => {
    try {
      return newestView(applyChanges(after, decide(after))).text;
    } catch (error) {
      if (error instanceof EditError && REFUSALS.includes(error.code ?? '')) return undefined;
      throw error;
    }
  };
  return { accepted: view(acceptAll), rejected: view(rejectAll) };
}

describe('a change inside the prefix of a block keeps the break before it (format §3.4)', () => {
  // The Markdown keymap of the editor numbers the items after the one Enter was pressed in again:
  // `5` is replaced by `6` in the prefix of a line. The marker can't stand in front of the prefix, so
  // the change is widened over the break in front of it, and the old and the new text are widened
  // by the same text: both views, and both decisions, keep the line break.
  function changed(body: string, edit: TextChange) {
    const after = track(file(body), edit, ada, ['k3x9']);
    const decided = (changes: TextChange[]) =>
      bodyOf(applyChanges(after, changes)).replace(/\n+$/, '');
    return {
      after,
      body: bodyOf(after).replace(/\n+$/, ''),
      newest: newestView(after).text.replace(/\n+$/, ''),
      original: originalView(after).text.replace(/\n+$/, ''),
      accepted: decided(acceptAll(after)),
      rejected: decided(rejectAll(after)),
    };
  }

  it('replaces a number: the item stays an item of its own', () => {
    const body = '3. Try it\n4. Reply to a note.\n5. Switch between views.';
    const at = body.indexOf('5.');
    const result = changed(body, replace(at, at + 1, '6'));
    // The closer does not start the line of the item: the word after the prefix is in the change.
    expect(result.body).toBe(
      '3. Try it\n4. Reply to a note.<!--sub k3x9 \\n5. Switch-->\n6. Switch<!--/k3x9--> between views.',
    );
    expect(result.newest).toBe('3. Try it\n4. Reply to a note.\n6. Switch between views.');
    expect(result.original).toBe(body);
    expect(result.accepted).toBe('3. Try it\n4. Reply to a note.\n6. Switch between views.');
    expect(result.rejected).toBe(body);
    expect(parse(result.after).warnings).toEqual([]);
  });

  it('replaces a bullet, a heading’s #s, and the whole prefix', () => {
    const bullet = '- one\n- two';
    const b = changed(bullet, replace(bullet.indexOf('- two'), bullet.indexOf('- two') + 1, '*'));
    expect([b.newest, b.accepted, b.rejected]).toEqual(['- one\n* two', '- one\n* two', bullet]);

    const heading = 'Para\n\n# Title';
    const h = changed(heading, replace(heading.indexOf('#'), heading.indexOf('#') + 1, '##'));
    expect([h.newest, h.accepted, h.rejected]).toEqual([
      'Para\n\n## Title',
      'Para\n\n## Title',
      heading,
    ]);

    const numbers = '1. one\n2. two';
    const at = numbers.indexOf('2. ');
    const whole = changed(numbers, replace(at, at + 3, '7. '));
    expect([whole.newest, whole.accepted, whole.rejected]).toEqual([
      '1. one\n7. two',
      '1. one\n7. two',
      numbers,
    ]);
  });

  it('replaces a number inside a quote and a nested list', () => {
    const quote = '> 1. one\n> 2. two';
    const q = changed(quote, replace(quote.indexOf('2.'), quote.indexOf('2.') + 1, '3'));
    expect([q.newest, q.accepted, q.rejected]).toEqual([
      '> 1. one\n> 3. two',
      '> 1. one\n> 3. two',
      quote,
    ]);

    const nested = '- a\n  1. one\n  2. two';
    const n = changed(nested, replace(nested.indexOf('2.'), nested.indexOf('2.') + 1, '3'));
    expect([n.newest, n.accepted, n.rejected]).toEqual([
      '- a\n  1. one\n  3. two',
      '- a\n  1. one\n  3. two',
      nested,
    ]);
  });

  it('deletes a prefix: the line stays a line, without the prefix', () => {
    const body = '1. one\n2. two';
    const at = body.indexOf('2. ');
    const whole = changed(body, remove(at, at + 3));
    expect([whole.newest, whole.accepted, whole.rejected]).toEqual([
      '1. one\ntwo',
      '1. one\ntwo',
      body,
    ]);
    const digit = changed(body, remove(at, at + 1));
    expect([digit.newest, digit.accepted, digit.rejected]).toEqual([
      '1. one\n. two',
      '1. one\n. two',
      body,
    ]);
  });

  it('keeps the file’s own line breaks', () => {
    const body = '3. one\r\n4. two\r\n5. three';
    const at = body.indexOf('4.');
    const result = changed(body, replace(at, at + 1, '9'));
    expect(result.body).toBe('3. one<!--sub k3x9 \\n4. two-->\r\n9. two<!--/k3x9-->\r\n5. three');
    expect(result.newest).toBe('3. one\r\n9. two\r\n5. three');
    expect(result.accepted).toBe('3. one\r\n9. two\r\n5. three');
    expect(result.rejected).toBe(body);
  });

  it('has no place in the first line of the file, which has no break in front of it', () => {
    const body = '1. one\n2. two';
    const codeOf = (edit: TextChange) => {
      try {
        track(file(body), edit, ada, ['k3x9']);
      } catch (error) {
        if (error instanceof EditError) return error.code;
        throw error;
      }
      return 'no error';
    };
    expect(codeOf(replace(0, 1, '7'))).toBe('no-legal-placement');
    // Not the whole prefix, with the text after it staying: that is the prefix's deletion, written
    // with its opener alone on the first line (below).
    expect(codeOf(remove(1, 3))).toBe('no-legal-placement');
    expect(codeOf(remove(0, 2))).toBe('no-legal-placement');
  });

  it('writes the deletion of the whole first prefix, with the text after it staying (#248)', () => {
    for (const [body, to, form, newest] of [
      ['1. one\n1. two', 3, '<!--del k3x9 1. -->\n\none\n1. two', 'one\n1. two'],
      ['- one\n- two', 2, '<!--del k3x9 - -->\n\none\n- two', 'one\n- two'],
      ['> One.\n>\n> Two.', 2, '<!--del k3x9 > -->\n\nOne.\n>\n> Two.', 'One.\n>\n> Two.'],
      ['  - one\n  - two', 4, '<!--del k3x9   - -->\n\none\n  - two', 'one\n  - two'],
    ] as const) {
      const result = changed(body, remove(0, to));
      expect(result.body, body).toBe(form);
      expect(result.newest, body).toBe(newest);
      expect(result.rejected, body).toBe(body);
    }
  });

  it('is the same for a number typed over a part of the prefix with text', () => {
    // Over the number and the text after the prefix: the prefix stays, the text changes.
    const body = '1. one\n2. two';
    const at = body.indexOf('2. ') + 3;
    const over = changed(body, replace(at - 3, at + 3, '2. new'));
    expect(over.accepted).toBe('1. one\n2. new');
    expect(over.rejected).toBe(body);
  });

  it('brings every line of openers under a bullet typed over onto its line, however many (#85)', () => {
    // An item whose first line and the lines under it hold only the openers of comments, each alone
    // on its line with the line break after it for its carrier, and its text on its last line. With
    // the bullet typed over, the item is a paragraph, and each opener in turn has text in front of
    // it and loses its carrier: one round of repairs each, more than the 24 there once were.
    for (const n of [3, 30]) {
      const ids = Array.from(
        { length: n },
        (_, i) => `c${'bcdfghjkm'[Math.floor(i / 9)]}${'bcdfghjkm'[i % 9]}x`,
      );
      const lines = ids.map((id, i) => `${i === 0 ? '- ' : '  '}<!--cmt ${id}-->`);
      const closers = ids
        .map((id) => `<!--/${id}-->`)
        .reverse()
        .join('');
      const text = file(
        `Intro\n\n${lines.join('\n')}\n  text here${closers}`,
        {},
        ids.flatMap((id) => thread(id, 'bo')),
      );
      expect(newestView(text).text).toBe('Intro\n\n- text here\n');
      const view = newestView(text);
      const at = view.text.indexOf('- ');
      const edit = replace(view.map.toSource(at, 1), view.map.toSource(at + 1, -1), 'x');
      const after = track(text, edit, ada, ['k3x9']);
      expect(newestView(after).text, String(n)).toBe('Intro\n\nx text here\n');
      expect(originalView(after).text, String(n)).toBe(originalView(text).text);
      expect(parse(after).warnings, String(n)).toEqual([]);
    }
  });
});

describe('on random documents', { timeout: 600_000 }, () => {
  const AUTHORS = [ada, bo, claudeAda];

  /**
   * Where the body of a text starts, past its front matter and the blank lines under it: the suites
   * of Enter and Backspace below make plain, quote, list and pick their places in what comes after
   * it, as in a file of its own (format §3.8).
   */
  function frontLength(text: string): number {
    const start = bodyStart(text);
    return start + (/^(?:[ \t]*\r?\n)*/.exec(text.slice(start))?.[0].length ?? 0);
  }

  /** The newest text of a random document, as its front matter (with the blank lines under it,
   * empty when it has none) and its body. */
  function frontAndBody(seed: number): { front: string; body: string } {
    const whole = newestView(randomDocument(seeded(seed))).text;
    const length = frontLength(whole);
    return { front: whole.slice(0, length), body: whole.slice(length) };
  }

  /** A text without its front matter, as micromark is given it: what front matter is to a reader
   * that knows it, as Pandoc, Quarto, Jekyll and Hugo do, is no block of the body. */
  const bodyAlone = (text: string) => text.slice(bodyStart(text));
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
    let checked = 0;
    let undecided = 0;
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
        // An edit stops at the end of the body, as the editor's does: nothing is typed after the
        // ledger.
        const stop = before.ledgerRange?.from ?? Infinity;
        const placed =
          wanted.from === wanted.to
            ? type(view.map.toSource(wanted.from, below(2) === 0 ? -1 : 1), wanted.insert)
            : replace(
                view.map.toSource(wanted.from, 1),
                view.map.toSource(wanted.to, -1),
                wanted.insert,
              );
        const edit = {
          ...placed,
          from: Math.min(placed.from, stop),
          to: Math.min(placed.to, stop),
        };
        const label = `seed ${seed}, step ${step}: ${JSON.stringify(wanted)} by ${author.handle} on ${JSON.stringify(bodyOf(text))}`;

        const ctx = { author, time: TIME, random: randomBytes(seed, step) };
        let after: string;
        try {
          after = applyChanges(text, trackedEdit(text, edit, ctx));
        } catch (error) {
          // An edit that has no place for its markers, or would hide other changes, is refused.
          if (error instanceof EditError && REFUSALS.includes(error.code ?? '')) {
            refused++;
            // The last check of a change refuses the rare edit whose breaks and markers meet in one
            // place, such as a line break in front of a space, which indents the line; it must
            // stay rare.
            if (error.message === SELF_CHECK) checked++;
            continue;
          }
          throw new Error(`${label}: ${String(error)}`, { cause: error });
        }

        // A file with a ledger ends with the line break after the ledger, which the views show,
        // so they are compared without their final line breaks.
        const body = (s: string) => s.replace(/\n+$/, '');
        const expected = applyChanges(view.text, [wanted.blocks ?? wanted]);
        // A deletion of all the text of a block takes the block with a break (format §3.4): the
        // empty block that the plain edit leaves is not there. Nothing else is different, but
        // that the blocks around deleted ones are as far apart as they were and a list is numbered
        // from its first item.
        const same = wanted.blocks ? blocksOnly : renumbered;
        expect(squash(same(dropEmptyBlocks(newestView(after).text))), label).toBe(
          squash(same(dropEmptyBlocks(expected))),
        );
        // The views are compared without their empty blocks, which hides a prefix that the edit
        // left behind: the file has no more lines of nothing but a prefix than it had.
        expect(emptyBlockLines(after), `${label}: a prefix is left`).toBeLessThanOrEqual(
          emptyBlockLines(text),
        );
        // Line breaks typed at a block boundary are plain (format §3.4): the original text has them
        // as blank lines too, which makes no block more or less.
        const plain = wanted.from === wanted.to && /^\n+$/.test(wanted.insert);
        const blankLines = (s: string) => (plain ? s.replace(/\s*\n\s*/g, '\n').trimStart() : s);
        expect(
          blankLines(body(originalView(after).text)),
          `${label}\n=> ${JSON.stringify(bodyOf(after))}`,
        ).toBe(blankLines(body(original)));
        const parsed = expectInOrder(label, threads, after);
        expectNoNewLineStarts(label, before, parsed);
        // Whatever the edit was widened by, rejecting every change gives the original text. (The
        // newest text is the one the views and the edit above are compared by; the next test
        // accepts every change of the files it makes. A file of dense random edits has marks that
        // accepting reads otherwise than the views do, such as the whitespace-only line of an
        // insertion that a comment's carrier takes in.)
        const { rejected } = decided(after);
        if (rejected === undefined) undecided++;
        if (rejected !== undefined) {
          expect(flat(rejected), `${label}: rejecting`).toBe(flat(originalView(after).text));
        }
        // No mark is lost, except an insertion, deletion or split of the author's own that was used
        // up, or cancelled.
        const kept = new Set(parsed.marks.map((m) => m.id));
        for (const mark of before.marks) {
          if (kept.has(mark.id)) continue;
          expect(mark.entry.by, `${label}: ${mark.id} was lost`).toBe(author.handle);
          expect(['ins', 'del', 'split'], `${label}: ${mark.id} was lost`).toContain(mark.kind);
        }
        text = after;
        edits++;
      }
    }
    // Most edits go through.
    expect(edits).toBeGreaterThan(refused);
    expect(checked).toBeLessThanOrEqual(Math.ceil(edits / 100));
    // Most decisions have a form for their markers.
    expect(undecided).toBeLessThanOrEqual(Math.ceil(edits / 20));
  });

  it('widens the old text and the new text alike: an edit inside a prefix comes out as typed', () => {
    // A marker can't stand in a prefix, so the change takes the break in front of it: accepting
    // gives the text that was typed, whole, and rejecting gives the original (format §3.4).
    const documents = fuzzCount(200);
    let edits = 0;
    let refused = 0;
    let undecided = 0;
    for (let seed = 1; seed <= documents; seed++) {
      const random = seeded(seed * 6469);
      const below = (n: number) => Math.floor(random() * n);
      // Half of the documents have been edited: splits, whole-block insertions, closers in front of
      // openers, the empty items that Enter leaves.
      let text = seed % 2 === 0 ? editedDocument(seed) : randomDocument(seeded(seed));
      for (let step = 0; step < 3; step++) {
        const view = newestView(text);
        const wanted = prefixEdit(below, view.text);
        if (!wanted) break;
        const author = AUTHORS[below(AUTHORS.length)] as Person;
        const edit = {
          ...wanted,
          from: view.map.toSource(wanted.from, 1),
          to: view.map.toSource(wanted.to, wanted.from === wanted.to ? 1 : -1),
        };
        const label = `seed ${seed}, step ${step}: ${JSON.stringify(wanted)} by ${author.handle} on ${JSON.stringify(bodyOf(text))}`;
        let after: string;
        try {
          after = applyChanges(
            text,
            trackedEdit(text, edit, { author, time: TIME, random: randomBytes(seed, step) }),
          );
        } catch (error) {
          if (error instanceof EditError && REFUSALS.includes(error.code ?? '')) {
            refused++;
            continue;
          }
          throw new Error(`${label}: ${String(error)}`, { cause: error });
        }
        // The decisions agree with the views, when they did before the edit: a file that was made
        // by other edits may have a mark that its decisions read otherwise than its views do.
        const was = decided(text);
        const agreed = was.accepted === undefined || flat(was.accepted) === flat(view.text);
        const { accepted, rejected } = decided(after);
        if (accepted === undefined || rejected === undefined) undecided++;
        if (accepted !== undefined && agreed) {
          expect(flat(accepted), `${label}: accepting\n=> ${JSON.stringify(bodyOf(after))}`).toBe(
            flat(newestView(after).text),
          );
        }
        if (rejected !== undefined) {
          expect(flat(rejected), `${label}: rejecting\n=> ${JSON.stringify(bodyOf(after))}`).toBe(
            flat(originalView(text).text),
          );
        }
        // Where the break in front of the prefix is not the break of a split, which a change of its
        // prefix cancels or joins, the text is as it was typed.
        if (parse(text).marks.every((mark) => mark.kind !== 'split')) {
          const expected = applyChanges(view.text, [wanted]);
          expect(squash(newestView(after).text), `${label}: as typed`).toBe(squash(expected));
        }
        expect(emptyBlockLines(after), `${label}: a prefix is left`).toBeLessThanOrEqual(
          emptyBlockLines(text),
        );
        expectNoNewLineStarts(label, parse(text), parse(after));
        text = after;
        edits++;
      }
    }
    // Most edits go through, and most decisions have a form for their markers.
    expect(edits).toBeGreaterThan(refused);
    expect(undecided).toBeLessThanOrEqual(Math.ceil(edits / 20));
  });

  it('reads a line break next to a pending one the same in every decision order (stacked splits)', () => {
    // A line break, then more next to it (issue #101): at the end of the line above it, on the
    // blank line of a paragraph break, on the line a second break makes, or at the start of the
    // line below, by the same person or by another, on either side of the markers. The first is
    // Enter, a paragraph break, Enter typed over a space, or a line break in typed text; then one
    // to three more line breaks, words, white space, a bullet, or a Backspace. Every order of
    // deciding every change gives the same text for the same decisions, exactly, and accepting or
    // rejecting them all gives the newest or the original view.
    const documents = fuzzCount(150);
    const FIRST = ['\n', '\n', '\n\n', 'over', 'new\nwords ', 'new\n\nwords '];
    const AGAIN = ['\n', '\n', '\n', '\n', '\n\n', 'x', 'new words', ' ', '  ', '- x', 'backspace'];
    let edits = 0;
    let refused = 0;
    let walked = 0;
    for (let seed = 1; seed <= documents; seed++) {
      const random = seeded(seed * 4099);
      const below = (n: number) => Math.floor(random() * n);
      const pick = <T>(items: readonly T[]): T => items[below(items.length)] as T;
      // The newest text of a random document, with no marks: its lists, quotes, headings, code,
      // tables and links. Half of the time, its first block alone.
      const whole = newestView(randomDocument(seeded(seed))).text;
      let text = seed % 2 === 0 ? whole : `${whole.split('\n\n')[0] ?? whole}\n`;
      const steps: string[] = [];
      /** Makes an edit of the newest view, or counts it refused. */
      const edit = (from: number, to: number, insert: string, step: number): boolean => {
        const view = newestView(text);
        // The place may be past the end of the text, which an edit before it made shorter.
        if (to > view.text.length) return false;
        const side = below(2) === 0 ? -1 : 1;
        const placed =
          from === to
            ? type(view.map.toSource(from, side), insert)
            : replace(view.map.toSource(from, 1), view.map.toSource(to, -1), insert);
        const author = pick([ada, bo]);
        const label = `seed ${seed}: ${JSON.stringify({ from, to, insert })} by ${author.handle}`;
        steps.push(label);
        const ctx = { author, time: TIME, random: randomBytes(seed, step) };
        try {
          text = applyChanges(text, trackedEdit(text, placed, ctx));
          edits++;
          return true;
        } catch (error) {
          if (error instanceof EditError && REFUSALS.includes(error.code ?? '')) {
            refused++;
            return false;
          }
          throw new Error(`${steps.join('\n')}\non ${JSON.stringify(bodyOf(text))}`, {
            cause: error,
          });
        }
      };
      // The first line break, at a place in the text of a line, often after a space.
      const view = newestView(text).text;
      const offsets = naturalOffsets(view).filter((offset) => offset < view.length - 1);
      const spaces = offsets.filter((offset) => view[offset] === ' ');
      const at = pick(below(2) === 0 && spaces.length > 0 ? spaces : offsets);
      if (at === undefined) continue;
      const first = pick(FIRST);
      if (first === 'over' && view[at] !== ' ') continue;
      const typed = first === 'over' ? '\n' : first;
      if (!edit(at, first === 'over' ? at + 1 : at, typed, 0)) continue;
      // Where the line break starts in the newest view, and where the line after it starts; for a
      // paragraph break, its blank line is in between.
      const start = at + typed.indexOf('\n');
      const end = at + typed.lastIndexOf('\n') + 1;
      // One Backspace at most: a second one in a row grows the deletion of another person's break
      // with the text after it, which is no longer read as that deletion (#109). And one text at
      // most, and none in the text of a first edit that typed words: text typed at the start of a
      // block of another insertion stacks the own-line openers of two insertions, whose carriers
      // read otherwise once the other's markers go (#108).
      const once = new Set<string>(/\S/.test(typed) ? ['text'] : []);
      const kind = (again: string) =>
        again === 'backspace' ? 'delete' : /\S| /.test(again.replace(/\n/g, '')) ? 'text' : 'break';
      for (let step = 1; step <= 1 + below(3); step++) {
        const where = pick([start, start + 1, start + 2, end, end, end + 1]);
        const again: string = pick(AGAIN.filter((a) => !once.has(kind(a))));
        if (kind(again) !== 'break') once.add(kind(again));
        if (again === 'backspace') edit(Math.max(0, where - 1), where, '', step);
        else edit(where, where, again, step);
      }
      if (parse(text).marks.filter((mark) => mark.kind !== 'cmt').length > 5) continue;
      const label = `${steps.join('\n')}\n=> ${JSON.stringify(bodyOf(text))}`;
      expectEveryOrderAlike(label, text, exactly);
      expect(applyChanges(text, acceptAll(text)), `${label}: accepting all`).toBe(
        newestView(text).text,
      );
      expect(applyChanges(text, rejectAll(text)), `${label}: rejecting all`).toBe(
        originalView(text).text,
      );
      walked++;
    }
    // Most first edits go through, and most files get every order tried.
    expect(edits).toBeGreaterThan(refused);
    expect(walked).toBeGreaterThan(documents / 3);
  });

  it('types on a blank line of a pending break where the text was typed (#111)', () => {
    // Enter twice, a paragraph break typed at once, or Enter three times, in a line of a random
    // document, by Ada or Bo, each line break with the prefix of the line's container, as the
    // editor's Enter types it. Then text on one of the blank lines, at its end or at its start, or
    // at the start of the line after them, on either side of the markers, mostly by the author of
    // the breaks, and sometimes deleted again. The text stands where it was typed, up to the prefix
    // of its line, which it goes after; words that the author of a split types on its blank line
    // are never refused; every order of deciding every change gives the same text for the same
    // decisions.
    const documents = fuzzCount(150);
    const BREAKS = [['\n', '\n'], ['\n\n'], ['\n', '\n', '\n']] as const;
    const WORDS = ['x', 'new words', 'é', '😀'];
    const TEXT = [...WORDS, ' ', 'new\n', 'one\ntwo', '- x', 'a--b'];
    let typed = 0;
    let refused = 0;
    let walked = 0;
    /** The text up to the prefix of each line, which the text typed on the line goes after, and the
     * white space that ends the line, which Markdown does not read. */
    const lines = (s: string) =>
      s
        .split('\n')
        .map((line) => line.replace(/^[ \t>]*/, '').replace(/[ \t]+$/, ''))
        .join('\n')
        .replace(/\n+$/, '');
    for (let seed = 1; seed <= documents; seed++) {
      const random = seeded(seed * 5113);
      const below = (n: number) => Math.floor(random() * n);
      const pick = <T>(items: readonly T[]): T => items[below(items.length)] as T;
      // Its first block is the body's: front matter stays in front of it, and no place is in it.
      const { front, body: whole } = frontAndBody(seed);
      let text = front + (seed % 2 === 0 ? whole : `${whole.split('\n\n')[0] ?? whole}\n`);
      const steps: string[] = [];
      /** Makes an edit of the newest view, or counts it refused. */
      const edit = (from: number, to: number, insert: string, author: Person, step: number) => {
        const view = newestView(text);
        const side = below(2) === 0 ? -1 : 1;
        const placed =
          from === to
            ? type(view.map.toSource(from, side), insert)
            : replace(view.map.toSource(from, 1), view.map.toSource(to, -1), insert);
        steps.push(
          `seed ${seed}: ${JSON.stringify({ from, to, insert, side })} by ${author.handle}`,
        );
        try {
          const ctx = { author, time: TIME, random: randomBytes(seed, step) };
          text = applyChanges(text, trackedEdit(text, placed, ctx));
          return true;
        } catch (error) {
          if (error instanceof EditError && REFUSALS.includes(error.code ?? '')) return false;
          throw new Error(`${steps.join('\n')}\non ${JSON.stringify(bodyOf(text))}`, {
            cause: error,
          });
        }
      };
      const view = newestView(text).text;
      // In the body, after the front matter.
      const bodyFrom = frontLength(view);
      const offsets = naturalOffsets(view).filter(
        (offset) => offset >= bodyFrom && offset < view.length - 1,
      );
      const spaces = offsets.filter((offset) => view[offset] === ' ');
      const at = pick(below(2) === 0 && spaces.length > 0 ? spaces : offsets);
      if (at === undefined) continue;
      // The container of the line, which each line break carries: `> ` in a quote, the indentation
      // of a list item's lines.
      const lineAt = view.lastIndexOf('\n', at - 1) + 1;
      const container = continuationPrefix(
        /^(?:[ \t]*(?:>|[-*+]|\d{1,9}[.)])[ \t]+)*/.exec(view.slice(lineAt, at))?.[0] ?? '',
      );
      const enter = (breaks: string) =>
        breaks
          .split('\n')
          .slice(1)
          .map((_, i, all) => `\n${i < all.length - 1 ? container.trimEnd() : container}`)
          .join('');
      const breaker = pick([ada, bo]);
      let caret = at;
      let made = true;
      for (const [i, breaks] of pick(BREAKS).entries()) {
        const insert = enter(breaks);
        made &&= edit(caret, caret, insert, breaker, i);
        caret += insert.length;
      }
      if (!made) continue;
      // The blank lines and the line after them, as they are in the newest view.
      const now = newestView(text).text;
      const places: number[] = [];
      for (let start = now.indexOf('\n', at) + 1; start > 0 && start <= caret;) {
        const end = now.indexOf('\n', start);
        places.push(start, end === -1 ? now.length : end);
        start = end + 1;
      }
      const where = pick(places.filter((offset) => offset <= caret));
      if (where === undefined) continue;
      const author = below(4) === 0 ? pick([ada, bo]) : breaker;
      const word = pick(TEXT);
      const insert = word.replace(/\n/g, `\n${container}`);
      const start = now.lastIndexOf('\n', where - 1) + 1;
      const line = now.slice(
        start,
        now.indexOf('\n', start) === -1 ? now.length : now.indexOf('\n', start),
      );
      const before = text;
      if (!edit(where, where, insert, author, 9)) {
        // Words that the author of a split types on its blank line, with text on the line after the
        // blank line (with none, the line break after the words would take that line in), where
        // the split is not in a code span that the split's rejection would make whole again.
        const split = parse(before).marks.some(
          (mark) => mark.kind === 'split' && mark.entry.by === author.handle,
        );
        const next = now.slice(
          caret,
          now.indexOf('\n', caret) === -1 ? now.length : now.indexOf('\n', caret),
        );
        expect(
          !(
            author === breaker &&
            split &&
            WORDS.includes(word) &&
            /^[ \t>]*$/.test(line) &&
            /[^ \t>]/.test(next) &&
            !view.slice(lineAt, view.indexOf('\n', at)).includes('`')
          ),
          `${steps.join('\n')}\non ${JSON.stringify(bodyOf(before))}: refused`,
        ).toBe(true);
        refused++;
        continue;
      }
      typed++;
      const label = `${steps.join('\n')}\n=> ${JSON.stringify(bodyOf(text))}`;
      // Typed in front of the prefix of its line, it goes after it: after the white space and quote
      // markers of a blank line, and after the container prefix that the breaks carried.
      const blank = /^[ \t>]*$/.test(line);
      const place = blank
        ? start + line.length
        : where === caret - container.length
          ? caret
          : where;
      expect(lines(newestView(text).text), `${label}: as typed`).toBe(
        lines(now.slice(0, place) + insert + now.slice(place)),
      );
      // Deleted again, the text gives the blank lines back, as many as a block break needs: text
      // that was a block of its own goes with one of the breaks around it (format §3.4). A bullet,
      // which starts a list item, stays as the prefix of the item, whose text alone is deleted.
      const blocks = (s: string) => lines(s).replace(/\n{3,}/g, '\n\n');
      if (!/\n|^- /.test(insert) && below(2) === 0) {
        const after = newestView(text).text;
        let shared = 0;
        while (shared < now.length && now[shared] === after[shared]) shared++;
        const start = after.indexOf(insert, Math.max(0, shared - insert.length));
        if (start !== -1 && edit(start, start + insert.length, '', author, 10)) {
          expect(blocks(newestView(text).text), `${label}: deleted again`).toBe(blocks(now));
        }
      }
      if (parse(text).marks.filter((mark) => mark.kind !== 'cmt').length > 5) continue;
      const decided = `${steps.join('\n')}\n=> ${JSON.stringify(bodyOf(text))}`;
      expectEveryOrderAlike(decided, text, exactly);
      expect(applyChanges(text, acceptAll(text)), `${decided}: accepting all`).toBe(
        newestView(text).text,
      );
      expect(applyChanges(text, rejectAll(text)), `${decided}: rejecting all`).toBe(
        originalView(text).text,
      );
      walked++;
    }
    // Most text goes where it was typed, and most files get every order tried.
    expect(typed).toBeGreaterThan(refused);
    expect(walked).toBeGreaterThan(documents / 3);
  });

  /** The newest text of a random document, with no marks, half of the time its first block alone.
   * A quarter of the time every line of it is in a quote, and a quarter of the time its first block
   * is in a list item: quotes in quotes, lists in quotes and quotes in lists. Its front matter, if
   * it has any, stays in front of it, as it is. */
  function plainDocument(seed: number, random: () => number): string {
    const { front, body: whole } = frontAndBody(seed);
    const text = seed % 2 === 0 ? whole : `${whole.split('\n\n')[0] ?? whole}\n`;
    const roll = random();
    if (roll < 0.25) return front + text.replace(/^(?=.)/gm, '> ');
    if (roll >= 0.5) return front + text;
    const end = text.indexOf('\n\n');
    const first = end === -1 ? text : text.slice(0, end);
    return `${front}- ${first.replace(/\n(?=.)/g, '\n  ')}${end === -1 ? '' : text.slice(end)}`;
  }

  /** Blocks that keep apart from the line above them with no blank line in front of them. */
  const BLOCKS_AFTER = [
    '# Head',
    '> Quote.',
    '***',
    '```\ncode\n```',
    '<div>\nx\n</div>',
    '<!-- c -->',
  ];

  /** Blocks after a blank line, which keep apart from the block above without it or go on with it,
   * and lines that only look like blocks. */
  const BLOCKS_AFTER_BLANK = [
    ...BLOCKS_AFTER,
    '> > Deeper.',
    '> - In a quote.',
    '- Item.',
    '1. First.',
    '2. Second.',
    '* * *',
    '___',
    '---',
    '===',
    '```a`b`',
    '~~~a`b\ncode\n~~~',
    '<!-x',
    '<!1 x',
    '<?php x ?>',
    '<![CDATA[ x ]]>',
    '<custom-tag>',
    '<span>x</span>',
    '    code',
    'Next.',
  ];

  /** The container prefix of a line of a view: quote markers, bullets and numbers, and the white
   * space around them. */
  const prefixOf = (line: string) =>
    /^(?:[ \t]*(?:>|[-*+](?=[ \t])|\d{1,9}[.)](?=[ \t]))[ \t]*)*/.exec(line)?.[0] ?? '';

  it('takes one line break with each Backspace after Enter twice (#118)', () => {
    // Enter twice in a line of a random document, by Ada or Bo, each line break with the prefix of
    // the line's container, as the editor's Enter types it, or a paragraph break typed at once: one
    // split whose break is a blank line. Then Backspace by the same person, from the start of the
    // second half or from the end of the blank line, as the editor's takes what is in front of the
    // caret: the quote markers of the line, one quote at a time, then its indentation, then the line
    // break. Each Backspace takes what it deletes and nothing more, and is never refused: the first
    // line break leaves the split with the other, and the second cancels it. Every order of
    // deciding every change gives the same text for the same decisions.
    const documents = fuzzCount(150);
    const BREAKS = [['\n', '\n'], ['\n\n']] as const;
    let pressed = 0;
    let walked = 0;
    for (let seed = 1; seed <= documents; seed++) {
      const random = seeded(seed * 6151);
      const below = (n: number) => Math.floor(random() * n);
      const pick = <T>(items: readonly T[]): T => items[below(items.length)] as T;
      let text = plainDocument(seed, random);
      const steps: string[] = [];
      /** Makes an edit of the newest view: whether it was made, or refused. */
      const edit = (from: number, to: number, insert: string, author: Person, step: number) => {
        const view = newestView(text);
        const side = below(2) === 0 ? -1 : 1;
        const placed =
          from === to
            ? type(view.map.toSource(from, side), insert)
            : replace(view.map.toSource(from, 1), view.map.toSource(to, -1), insert);
        steps.push(
          `seed ${seed}: ${JSON.stringify({ from, to, insert, side })} by ${author.handle}`,
        );
        try {
          const ctx = { author, time: TIME, random: randomBytes(seed, step) };
          text = applyChanges(text, trackedEdit(text, placed, ctx));
          return true;
        } catch (error) {
          if (error instanceof EditError && REFUSALS.includes(error.code ?? '')) return false;
          throw new Error(`${steps.join('\n')}\non ${JSON.stringify(bodyOf(text))}`, {
            cause: error,
          });
        }
      };
      const view = newestView(text).text;
      // In the body, after the front matter.
      const bodyFrom = frontLength(view);
      const offsets = naturalOffsets(view).filter(
        (offset) => offset >= bodyFrom && offset < view.length - 1,
      );
      const spaces = offsets.filter((offset) => view[offset] === ' ');
      // Often after a space, as Enter is pressed between two words.
      const at = pick(below(2) === 0 && spaces.length > 0 ? spaces.map((o) => o + 1) : offsets);
      if (at === undefined) continue;
      const lineAt = view.lastIndexOf('\n', at - 1) + 1;
      const container = continuationPrefix(prefixOf(view.slice(lineAt, at)));
      // Strictly checked: in the middle of the text of a line of a paragraph, a quote, a list item
      // or a quote in a list item, with text on either side, and not in a code span.
      // - At the start of the text of an item, a heading or a quote, the first half is an empty
      //   block, and once both line breaks are out, the Backspace this test makes next takes that
      //   block's prefix, where the split is cancelled with it. Enter there is walked in the random
      //   test of #129, with the editor's Backspaces.
      // - In a code span, a break of one line break makes the span whole again, with the split's
      //   marker inside: Backspace is refused there.
      // - Where the second half starts with white space, a quote's break would read it as the space
      //   after its marker, and not as written: the split is cancelled, as before. So it is where
      //   the line ends, and the line break after it would be read with the break.
      // - An item in a quote has markup that its break reads otherwise than the editor's Backspace
      //   takes it.
      const line = view.slice(
        lineAt,
        view.indexOf('\n', at) === -1 ? view.length : view.indexOf('\n', at),
      );
      const strict =
        /\S/.test(view[at] ?? '') &&
        /\S/.test(
          view.slice(lineAt, at).replace(/^(?:[ \t]*(?:>|[-*+]|\d{1,9}[.)]|#{1,6})(?=[ \t]))*/, ''),
        ) &&
        !line.includes('`') &&
        /^(?:(?:> ?)*|[ \t]*(?:> ?)*)$/.test(container) &&
        breakLength(prefixOf(view.slice(lineAt, at)), `\n${container}x`) === 1 + container.length;
      const author = pick([ada, bo]);
      const breaks = pick(BREAKS);
      let caret = at;
      let made = true;
      for (const [i, typed] of breaks.entries()) {
        const insert = typed === '\n' ? `\n${container}` : `\n${container.trimEnd()}\n${container}`;
        made &&= edit(caret, caret, insert, author, i);
        caret += insert.length;
      }
      // One split whose break is a blank line, and nothing else: not the line break of a wrapped
      // line typed again.
      const marks = parse(text).marks;
      if (!made || marks.length !== 1 || marks[0]?.kind !== 'split') continue;
      // The end of the blank line, which has the container's prefix that the first Enter typed.
      const blank = breaks.length === 2 ? container : container.trimEnd();
      caret = pick([caret, at + 1 + blank.length]);
      let taken = 0;
      for (let step = 2; step < 8 && taken < 2; step++) {
        const now = newestView(text).text;
        const start = now.lastIndexOf('\n', caret - 1) + 1;
        const before = now.slice(start, caret);
        if (!/^[ \t>]*$/.test(before) || caret === 0) break;
        // The quote marker in front of the caret, or the indentation, or the line break.
        const quote = /> ?$/.exec(before)?.[0];
        const from = before === '' ? caret - 1 : quote ? caret - quote.length : start;
        const label = `${steps.join('\n')}\n=> ${JSON.stringify(bodyOf(text))}`;
        const made = edit(from, caret, '', author, step);
        if (!strict) break;
        expect(made, `${label}: Backspace refused`).toBe(true);
        expect(newestView(text).text, label).toBe(now.slice(0, from) + now.slice(caret));
        pressed++;
        caret = from;
        if (before !== '') continue;
        taken++;
        // One line break taken: the split stays, with the other. (From the blank line, the caret is
        // then at the end of the line above, in its text, where Backspace goes on in the text.)
        const splits = parse(text).marks.filter((mark) => mark.kind === 'split');
        expect(splits.length, `${label}: the split`).toBe(taken === 1 ? 1 : 0);
      }
      if (parse(text).marks.filter((mark) => mark.kind !== 'cmt').length > 5) continue;
      const decided = `${steps.join('\n')}\n=> ${JSON.stringify(bodyOf(text))}`;
      expectEveryOrderAlike(decided, text, exactly);
      expect(applyChanges(text, acceptAll(text)), `${decided}: accepting all`).toBe(
        newestView(text).text,
      );
      expect(applyChanges(text, rejectAll(text)), `${decided}: rejecting all`).toBe(
        originalView(text).text,
      );
      walked++;
    }
    expect(pressed).toBeGreaterThan(documents);
    expect(walked).toBeGreaterThan(documents / 3);
  });

  it('goes on with a quote or a list at the end of its last line, as Enter types it (#125)', () => {
    // Enter at the end of the last line of a quote or a list item of a random document, before a
    // blank line or at the end of the text, by Ada or Bo, as the editor's Enter types it: the line
    // break and the quote markers of a quote, or a bullet or the next number. At the end of a quote
    // it is never refused; at the end of an item, never for the line break that would take the
    // start of the next block (an item's line can end in a construct that no marker may follow).
    // The newest view is the text as typed: a quote's new line is a blank line of the quote,
    // written plain, and an item's is a split. Then text typed on the new line; or, in a quote, a
    // letter, Backspace and other text, which goes on the new line; or Backspace as the editor's takes the
    // quote markers, one quote at a time, the indentation and the line break, which gives the file
    // back, after a letter and its Backspace too. Sometimes the break has a blank line before the
    // quote markers instead, which opens a quote of its own: that is tracked, or refused. Every
    // edit that writes no mark renders the same before and after it, and every order of deciding
    // every change gives the same text.
    const documents = fuzzCount(150);
    let entered = 0;
    let walked = 0;
    for (let seed = 1; seed <= documents; seed++) {
      const random = seeded(seed * 7103);
      const below = (n: number) => Math.floor(random() * n);
      const pick = <T>(items: readonly T[]): T => items[below(items.length)] as T;
      let text = plainDocument(seed, random);
      const steps: string[] = [];
      let quote = false;
      const edit = (from: number, to: number, insert: string, author: Person, step: number) => {
        const view = newestView(text);
        const side = below(2) === 0 ? -1 : 1;
        const placed =
          from === to
            ? type(view.map.toSource(from, side), insert)
            : replace(view.map.toSource(from, 1), view.map.toSource(to, -1), insert);
        steps.push(
          `seed ${seed}: ${JSON.stringify({ from, to, insert, side })} by ${author.handle}`,
        );
        const label = `${steps.join('\n')}\non ${JSON.stringify(bodyOf(text))}`;
        try {
          const ctx = { author, time: TIME, random: randomBytes(seed, step) };
          text = applyChanges(text, trackedEdit(text, placed, ctx));
        } catch (error) {
          const takes = /take the start of the block that follows/.test(String(error));
          if (step > 0 || quote || takes) throw new Error(`${label}: refused`, { cause: error });
          return false;
        }
        return true;
      };
      // The last lines of quotes and list items of the body: a blank line follows, or the end of
      // the text.
      const view = newestView(text).text;
      const ends: { end: number; insert: string; quote: boolean; heading: boolean }[] = [];
      for (let start = frontLength(view); start < view.length;) {
        const end = view.indexOf('\n', start);
        if (end === -1) break;
        const prefix = prefixOf(view.slice(start, end));
        const next = view.slice(end + 1, view.indexOf('\n', end + 1) + 1 || view.length);
        const last = /(>|[-*+]|(\d{1,9})([.)]))[ \t]*$/.exec(prefix);
        // Not a line of an item that goes on after its first, inside a quote: Enter goes on with
        // the item there.
        const own = last?.[1] !== '>' || />[ \t]?$/.test(prefix);
        if (last && own && /^\n?$/.test(next) && end > start + prefix.length) {
          const head = continuationPrefix(prefix.slice(0, last.index));
          const marker = last[2] ? `${Number(last[2]) + 1}${last[3]} ` : `${last[1]} `;
          const quote = last[1] === '>';
          ends.push({
            end,
            insert: `\n${quote ? continuationPrefix(prefix) : head + marker}`,
            quote,
            heading: /^#{1,6}(?:[ \t]|$)/.test(view.slice(start + prefix.length, end)),
          });
        }
        start = end + 1;
      }
      const chosen = pick(ends);
      if (chosen === undefined) continue;
      const { end } = chosen;
      quote = chosen.quote;
      // A blank line in front of the quote markers opens a quote of its own.
      const opening = quote && below(4) === 0;
      const insert = opening ? `\n${chosen.insert}` : chosen.insert;
      const author = pick([ada, bo]);
      const before = text;
      const label = () => `${steps.join('\n')}\n=> ${JSON.stringify(bodyOf(text))}`;
      // An edit that writes no mark, in a file with none, changes nothing that is rendered.
      const step = (from: number, to: number, typed: string, at: number) => {
        const was = text;
        const made = edit(from, to, typed, author, at);
        if (made && parse(was).marks.length === 0 && parse(text).marks.length === 0) {
          expect(micromark(bodyAlone(newestView(text).text)), `${label()}: rendered`).toBe(
            micromark(bodyAlone(newestView(was).text)),
          );
        }
        return made;
      };
      if (opening) {
        try {
          step(end, end, insert, 0);
        } catch (error) {
          // Refused, as main refuses it: the file is as it was. Any other failure is the test's.
          const cause = error instanceof Error ? error.cause : undefined;
          if (!(cause instanceof EditError && REFUSALS.includes(cause.code ?? ''))) throw error;
          continue;
        }
        expect(parse(text).marks.length, `${label()}: an opened quote is tracked`).toBeGreaterThan(
          0,
        );
      } else if (!step(end, end, insert, 0)) continue;
      entered++;
      const typed = view.slice(0, end) + insert + view.slice(end);
      // A file with a ledger ends with the line break after it, which the views show.
      const body = (view: string) => view.replace(/\n+$/, '');
      expect(body(newestView(text).text), label()).toBe(body(typed));
      if (!opening) {
        expect(
          parse(text).marks.map((mark) => mark.kind),
          label(),
        ).toEqual(quote ? [] : ['split']);
      }
      // A letter and Backspace on the new line give the text after Enter back, in a new item and
      // after a heading too, where the letter is a block of its own (#129).
      const then = opening ? 'nothing' : pick(['nothing', 'text', 'retype', 'backspace', 'typo']);
      const caret = end + insert.length;
      const entering = text;
      /** A letter on the new line, and Backspace over it: the file after Enter again; in a new item,
       * the split that the letter was typed with, as Enter made it, which has a new id. */
      const typo = () => {
        step(caret, caret, 'x', 1);
        step(caret, caret + 1, '', 2);
        const kinds = (file: string) => parse(file).marks.map((mark) => mark.kind);
        if (quote) expect(body(text), `${label()}: a letter and Backspace`).toBe(body(entering));
        expect(body(newestView(text).text), `${label()}: a letter and Backspace`).toBe(
          body(newestView(entering).text),
        );
        expect(kinds(text), `${label()}: a letter and Backspace`).toEqual(kinds(entering));
      };
      if (then === 'text' || then === 'retype') {
        if (then === 'retype') typo();
        const word = pick(['x', 'new words', 'é']);
        step(caret, caret, word, 3);
        expect(body(newestView(text).text), label()).toBe(
          body(typed.slice(0, caret) + word + typed.slice(caret)),
        );
      } else if ((then === 'backspace' || then === 'typo') && quote) {
        if (then === 'typo') typo();
        let at = caret;
        for (let n = 4; at > end + 1; n++) {
          const line = typed.slice(end + 1, at);
          const from = /> ?$/.test(line) ? at - (/> ?$/.exec(line)?.[0].length ?? 0) : end + 1;
          step(from, at, '', n);
          at = from;
          expect(parse(text).marks, label()).toEqual([]);
        }
        step(end, end + 1, '', 9);
        expect(body(bodyOf(text)), label()).toBe(body(bodyOf(before)));
      } else if ((then === 'backspace' || then === 'typo') && /^\n[ \t]*\S+ $/.test(insert)) {
        // In an item out of a quote, the editor's Backspace makes the bullet the item's indentation,
        // a blank line, which stays, plain; then it takes the indentation, and the line break
        // (#129).
        if (then === 'typo') typo();
        const marker = /\S+ $/.exec(insert)?.[0] ?? '';
        step(caret - marker.length, caret, ' '.repeat(marker.length), 4);
        expect(parse(text).marks, `${label()}: the bullet made indentation`).toEqual([]);
        step(end + 1, caret, '', 5);
        step(end, end + 1, '', 6);
        expect(body(bodyOf(text)), label()).toBe(body(bodyOf(before)));
      }
      expectEveryOrderAlike(label(), text, exactly);
      expect(applyChanges(text, acceptAll(text)), `${label()}: accepting all`).toBe(
        newestView(text).text,
      );
      expect(applyChanges(text, rejectAll(text)), `${label()}: rejecting all`).toBe(
        originalView(text).text,
      );
      walked++;
    }
    expect(entered).toBeGreaterThan(documents / 3);
    expect(walked).toBe(entered);
  });

  it('undoes Enter in list items, headings and quotes with Backspace, and keeps its line (#129)', () => {
    // Enter by Ada or Bo in a random document, as the editor's Enter types it, at a place of #129: in
    // front of the first word of a list item, a heading or a quote line, where the first half is an
    // empty block; in the middle of a line of a quote in a list item; at the end of the last item
    // of a list, or of a heading; at the end of a paragraph of a quote that a blank line of the
    // quote follows, also Enter three times there; at the end of the last line of an item or a
    // paragraph that another block follows with no blank line. Then the editor's Backspaces, each
    // taking what is in front of the caret (a
    // bullet made the item's indentation, a quote's markers one quote at a time, the indentation,
    // the line break), which give the file back; or a letter, its Backspace, which gives the text
    // after Enter back, the new item or line as Enter left it, and another letter. Each step is
    // never refused and comes out as typed, and every order of deciding every change gives the
    // same text. Or Backspace on a blank line between two blocks, or Delete at the end of the line
    // above it, also where the block above is in a container and its later lines are lazy, and
    // where the block below only looks like one: plain where the blocks read the same, tracked
    // where they do not. A deletion written plain changes nothing that is rendered, in either view.
    const html = (text: string) => micromark(bodyAlone(text), { allowDangerousHtml: true });
    const documents = fuzzCount(150);
    let pressed = 0;
    let walked = 0;
    let cuts = 0;
    let joinsRefused = 0;
    for (let seed = 1; seed <= documents; seed++) {
      const random = seeded(seed * 5527);
      const below = (n: number) => Math.floor(random() * n);
      const pick = <T>(items: readonly T[]): T => items[below(items.length)] as T;
      // Without the white space that ends lines, so that lines end in text more often.
      let text = plainDocument(seed, random).replace(/[ \t]+$/gm, '');
      // Its front matter, which stays in front of what is made of the body below.
      const front = text.slice(0, frontLength(text));
      /** Where a block put right after the first one starts, if there is one. */
      let blockAt = -1;
      // A third of the time, the paragraphs of the whole document in one quote, the blank lines
      // between them quote lines too.
      const paragraphs = frontAndBody(seed)
        .body.replace(/[ \t]+$/gm, '')
        .split(/\n{2,}/)
        .filter((block) => block.trim() !== '' && !/^(?:[-*+] |\d{1,9}[.)] |#|>|<)/m.test(block));
      if (below(3) === 0 && paragraphs.length > 1) {
        const quote = pick(['> ', '> > ', '- > ']);
        const later = continuationPrefix(quote);
        const lines = paragraphs.join('\n\n').split('\n');
        const quoted = lines.map((line, i) =>
          line === '' ? later.trimEnd() : `${i === 0 ? quote : later}${line}`,
        );
        text = `${front}${quoted.join('\n')}\n`;
      } else if (below(3) === 0) {
        // Another block right after the first one, with no blank line between them.
        const first = text.indexOf('\n\n', front.length);
        const at = first === -1 ? text.replace(/\n+$/, '').length : first;
        text = `${text.slice(0, at)}\n${pick(BLOCKS_AFTER)}${text.slice(at)}`;
        blockAt = at + 1;
      } else if (below(2) === 0 && paragraphs.length > 0) {
        // A paragraph in a container, its later lines lazy now and then, and another block after a
        // blank line; now and then an HTML block or a heading on the first line, right above it.
        const top = pick([
          '',
          '',
          '',
          '<!-- c -->\n',
          '<?x ?>\n',
          '<!DOCTYPE html>\n',
          '# Title\n',
        ]);
        const container = pick(['', '> ', '> > ', '> - ', '- > ', '- ', '1. ']);
        const later = continuationPrefix(container);
        const first = (paragraphs[0] ?? '')
          .split('\n')
          .map((line, i) => (i === 0 ? container : below(2) === 0 ? '' : later) + line);
        // Now and then its last line is a character that JavaScript takes for white space and
        // CommonMark for text.
        if (below(4) === 0) first.push(pick(['\u00a0', '\u3000', '\ufeff', '\u000c', '\u2028']));
        const rest = paragraphs.slice(1, 1 + below(2)).map((block) => `\n\n${block}`);
        text = `${front}${top}${first.join('\n')}\n\n${pick(BLOCKS_AFTER_BLANK)}${rest.join('')}\n`;
      }
      const original = text;
      const steps: string[] = [];
      const label = () => `${steps.join('\n')}\n=> ${JSON.stringify(bodyOf(text))}`;
      const author = pick([ada, bo]);
      /** Replaces `[from, to)` of the newest view: the newest view is then as typed. */
      const edit = (from: number, to: number, insert: string, step: number, side: 1 | -1) => {
        const view = newestView(text);
        const placed =
          from === to
            ? type(view.map.toSource(from, side), insert)
            : replace(view.map.toSource(from, 1), view.map.toSource(to, -1), insert);
        steps.push(
          `seed ${seed}: ${JSON.stringify({ from, to, insert, side })} by ${author.handle}`,
        );
        const was = text;
        try {
          const ctx = { author, time: TIME, random: randomBytes(seed, step) };
          text = applyChanges(text, trackedEdit(text, placed, ctx));
        } catch (error) {
          throw new Error(`${label()}: refused`, { cause: error });
        }
        const typed = view.text.slice(0, from) + insert + view.text.slice(to);
        expect(newestView(text).text.replace(/\n+$/, ''), label()).toBe(typed.replace(/\n+$/, ''));
        expectPlainCutRendersAlike(was, from < to && insert === '');
        pressed++;
      };
      /** What a deletion writes plain, which changes the original view, changes nothing that is
       * rendered there, and a deletion written all plain, which leaves the marks as they are,
       * nothing that is rendered in the newest view either. */
      const expectPlainCutRendersAlike = (was: string, cut: boolean) => {
        const original = originalView(was).text;
        if (!cut || originalView(text).text === original) return;
        expect(html(originalView(text).text), `${label()}: rendered plain`).toBe(html(original));
        const ids = (file: string) =>
          parse(file)
            .marks.map((mark) => mark.id)
            .join(' ');
        if (ids(text) === ids(was)) {
          expect(html(newestView(text).text), `${label()}: rendered plain`).toBe(
            html(newestView(was).text),
          );
        }
      };
      // The places, line by line, in the body: its first line has none above it.
      const view = newestView(text).text;
      const lines: { start: number; end: number }[] = [];
      for (let start = frontLength(view); start < view.length;) {
        const end = view.indexOf('\n', start) === -1 ? view.length : view.indexOf('\n', start);
        lines.push({ start, end });
        start = end + 1;
      }
      const lineText = (i: number) => {
        const line = lines[i];
        return line ? view.slice(line.start, line.end) : undefined;
      };
      const places: { kind: string; at: number; insert: string }[] = [];
      for (const [i, { start, end }] of lines.entries()) {
        const line = view.slice(start, end);
        const prefix = prefixOf(line);
        const heading = prefix === '' ? (/^#{1,6} /.exec(line)?.[0] ?? '') : '';
        const rest = line.slice(prefix.length + heading.length);
        if (/[`<\\]/.test(rest) || !/^[\p{L}\p{N}]/u.test(rest)) continue;
        const above = lineText(i - 1);
        const next = lineText(i + 1);
        const bullet = /^[-*+] $/.test(prefix);
        const numbered = /^(\d{1,9})([.)]) $/.exec(prefix);
        const quote = /^(?:> ?)+$/.test(prefix) || /^[-*+] (?:> ?)+$/.test(prefix);
        const lazy = /^ +(?:> ?)+$/.test(prefix);
        const textStart = start + prefix.length + heading.length;
        // In front of the first word of a block: the first half is an empty block. (In front of a
        // wrapped line, Backspace is refused, as on main.)
        const opens = above === undefined || /^[ \t>]*$/.test(above);
        if (bullet || heading !== '' || (/^(?:> ?)+$/.test(prefix) && opens)) {
          const insert =
            heading !== '' ? '\n' : `\n${bullet ? prefix : continuationPrefix(prefix)}`;
          places.push({ kind: 'front', at: textStart, insert });
        }
        // In the middle of a line of a quote in a list item, between two words.
        if (/^[-*+] (?:> ?)+$|^ +(?:> ?)+$/.test(prefix) && /[^\s] [^\s]/u.test(rest)) {
          const gap = rest.search(/(?<=[\p{L}\p{N}]) (?=[\p{L}\p{N}])/u);
          const insert = `\n${continuationPrefix(prefix)}`;
          if (gap > 0) places.push({ kind: 'middle', at: textStart + gap + 1, insert });
        }
        const ends = /[\p{L}\p{N}.]$/u.test(line) && (next === undefined || next === '');
        // At the end of the last item of a list, with the next bullet or number.
        if (ends && (bullet || numbered)) {
          const marker = numbered ? `${Number(numbered[1]) + 1}${numbered[2]} ` : prefix;
          places.push({ kind: 'item', at: end, insert: `\n${marker}` });
        }
        if (ends && heading !== '') places.push({ kind: 'heading', at: end, insert: '\n' });
        // At the end of the last line of an item or a paragraph that another block follows with no
        // blank line. (After a paragraph, a line starting with `<` is one of its lines, and Enter
        // there is refused, as on main.)
        const block = next !== undefined && end + 1 === blockAt;
        if (block && /[\p{L}\p{N}.]$/u.test(line) && (bullet || numbered)) {
          const marker = numbered ? `${Number(numbered[1]) + 1}${numbered[2]} ` : prefix;
          places.push({ kind: 'item before a block', at: end, insert: `\n${marker}` });
        }
        if (
          block &&
          /[\p{L}\p{N}.]$/u.test(line) &&
          /^\S/.test(line) &&
          prefix === '' &&
          heading === ''
        ) {
          if (!next.startsWith('<'))
            places.push({ kind: 'paragraph before a block', at: end, insert: '\n' });
        }
        // At the end of a paragraph of a quote that a blank line of the quote follows, as deep.
        const markup = continuationPrefix(prefix).trimEnd();
        const after = lineText(i + 2);
        // Backspace there writes a substitution up to the end of the next paragraph's first word,
        // which must be a plain word for its closer.
        const word = after
          ?.slice(prefixOf(after).length)
          .replace(/^#{1,6} /, '')
          .split(/\s/)[0];
        const plainWord =
          /^[\p{L}\p{N}\p{Extended_Pictographic}][\p{L}\p{N}\p{M}\p{Extended_Pictographic}.,;!?'"-]*$/u;
        // Each line of the block up to here a line of a paragraph of the quote: where the quote holds
        // a list or a heading above, its blank lines are not read (#125), and Enter is refused.
        let plainQuote = true;
        for (let k = i; k >= 0 && plainQuote; k--) {
          const upper = lineText(k) ?? '';
          if (upper === '') break;
          const inner = upper.slice(prefixOf(upper).length);
          plainQuote =
            continuationPrefix(prefixOf(upper)).trimEnd() === markup &&
            !/^(?:[-*+] |\d{1,9}[.)] |#|>)/.test(inner) &&
            /^(?:> ?)*(?:[-*+] (?:> ?)+)?$|^ +(?:> ?)+$/.test(prefixOf(upper));
        }
        if (
          plainQuote &&
          (quote || lazy) &&
          /[\p{L}\p{N}.]$/u.test(line) &&
          next !== undefined &&
          next.trimEnd() === markup &&
          after !== undefined &&
          prefixOf(after).trimEnd() === markup &&
          plainWord.test(word ?? '')
        ) {
          places.push({ kind: 'paragraph', at: end, insert: `\n${continuationPrefix(prefix)}` });
        }
      }
      // A blank line between two blocks: Backspace at the start of the line after it.
      for (const [i, { start }] of lines.entries()) {
        // A line with no more than spaces and tabs is blank; other white space is text.
        const blank = lineText(i - 1) === '' && /[^ \t]/.test(lineText(i - 2) ?? '');
        if (blank && /[^ \t]/.test(lineText(i) ?? '')) {
          places.push({ kind: 'blank line', at: start, insert: '' });
        }
      }
      // A kind of place, then a place of that kind, so that the rarer kinds come up too.
      const chosen = pick([...new Set(places.map((p) => p.kind))]);
      const place = pick(places.filter((p) => p.kind === chosen));
      if (place === undefined) continue;
      const { kind, at, insert } = place;
      if (kind === 'blank line') {
        // Backspace at the start of the line after the blank line, or Delete at the end of the
        // line above it: plain and as typed, or a join of the two blocks, tracked, which takes the
        // prefix of the second, and leaves the original view as it was. (A join is main's, and
        // refused where main refuses it: after a list item, a line that the format reads as a
        // fence; in front of a fence, where the format reads the end of the file inside it.)
        const from = pick([at - 1, at - 2]);
        const view = newestView(text);
        const placed = replace(view.map.toSource(from, 1), view.map.toSource(from + 1, -1), '');
        steps.push(`seed ${seed}: ${JSON.stringify({ from, to: from + 1 })} by ${author.handle}`);
        const was = text;
        try {
          const ctx = { author, time: TIME, random: randomBytes(seed, 0) };
          text = applyChanges(text, trackedEdit(text, placed, ctx));
        } catch (error) {
          const code = error instanceof EditError ? (error.code ?? '') : undefined;
          if (code !== undefined && [...REFUSALS, 'unclosed-end'].includes(code)) {
            joinsRefused++;
            continue;
          }
          throw new Error(`${label()}: failed`, { cause: error });
        }
        cuts++;
        if (parse(text).marks.length === 0) {
          const typed = view.text.slice(0, from) + view.text.slice(from + 1);
          expect(newestView(text).text.replace(/\n+$/, ''), label()).toBe(
            typed.replace(/\n+$/, ''),
          );
          expectPlainCutRendersAlike(was, true);
        } else {
          expect(originalView(text).text.replace(/\n+$/, ''), label()).toBe(
            originalView(was).text.replace(/\n+$/, ''),
          );
        }
        pressed++;
        expectEveryOrderAlike(label(), text, exactly);
        walked++;
        continue;
      }
      edit(at, at, insert, 0, -1);
      const entered = text;
      const caret = at + insert.length;
      const then =
        kind === 'front' || kind === 'middle'
          ? 'backspace'
          : kind === 'paragraph'
            ? pick(['backspace', 'typo', 'enter three times'])
            : pick(['backspace', 'typo']);
      if (then === 'enter three times') {
        // Enter twice more, as the editor types it: a line break and the quote's markers, then, on
        // the empty quote line, its command that leaves the quote, which takes the last quote marker
        // of both new lines in one keystroke, the last first. Then Backspaces, back to the file.
        const markers = insert.slice(1);
        edit(caret, caret, insert, 1, -1);
        const inner = markers.slice(0, markers.lastIndexOf('>'));
        const second = caret + 1;
        edit(second + inner.length, second + markers.length, '', 2, -1);
        edit(at + 1 + inner.length, caret, '', 3, -1);
        let now = second + inner.length - (markers.length - inner.length);
        for (let step = 4; step < 16 && bodyOf(text) !== bodyOf(original); step++) {
          const shown = newestView(text).text;
          const start = shown.lastIndexOf('\n', now - 1) + 1;
          const before = shown.slice(start, now);
          const marker = /> ?$/.exec(before)?.[0];
          const from = marker ? now - marker.length : before !== '' ? start : now - 1;
          edit(from, now, '', step, -1);
          now = from;
        }
        expect(bodyOf(text).replace(/\n+$/, ''), `${label()}: the file again`).toBe(
          original.replace(/\n+$/, ''),
        );
        expect(parse(text).marks, `${label()}: the file again`).toEqual([]);
      } else if (then === 'typo') {
        // A letter on the new line and its Backspace give the text after Enter back (up to the line
        // breaks that end the text, which the ledger the letter adds takes).
        edit(caret, caret, 'x', 1, -1);
        edit(caret, caret + 1, '', 2, -1);
        expect(
          newestView(text).text.replace(/\n+$/, ''),
          `${label()}: a letter and Backspace`,
        ).toBe(newestView(entered).text.replace(/\n+$/, ''));
        expect(parse(text).marks.length, `${label()}: a letter and Backspace`).toBe(
          parse(entered).marks.length,
        );
        edit(caret, caret, 'y', 3, -1);
      } else {
        // The editor's Backspaces, back to the file.
        let now = caret;
        for (let step = 1; step < 12; step++) {
          const shown = newestView(text).text;
          const start = shown.lastIndexOf('\n', now - 1) + 1;
          const before = shown.slice(start, now);
          const bulleted = /(?:[-*+]|\d{1,9}[.)]) $/.exec(before)?.[0];
          const marker = /> ?$/.exec(before)?.[0];
          if (bulleted) {
            edit(now - bulleted.length, now, ' '.repeat(bulleted.length), step, -1);
          } else if (marker) {
            edit(now - marker.length, now, '', step, -1);
            now -= marker.length;
          } else if (before !== '') {
            edit(start, now, '', step, -1);
            now = start;
          } else {
            edit(now - 1, now, '', step, -1);
            break;
          }
        }
        expect(bodyOf(text).replace(/\n+$/, ''), `${label()}: the file again`).toBe(
          original.replace(/\n+$/, ''),
        );
      }
      if (parse(text).marks.filter((mark) => mark.kind !== 'cmt').length > 5) continue;
      expectEveryOrderAlike(label(), text, exactly);
      expect(applyChanges(text, acceptAll(text)), `${label()}: accepting all`).toBe(
        newestView(text).text,
      );
      expect(applyChanges(text, rejectAll(text)), `${label()}: rejecting all`).toBe(
        originalView(text).text,
      );
      walked++;
    }
    expect(pressed).toBeGreaterThan(documents);
    expect(walked).toBeGreaterThan(documents / 3);
    expect(joinsRefused).toBeLessThan(cuts / 4);
  });
});
