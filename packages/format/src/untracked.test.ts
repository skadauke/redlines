import { describe, expect, it } from 'vitest';
import { breakEnd, openerRange, splitEnd } from './blocks.ts';
import { markerRanges } from './edit-support.ts';
import { applyChanges } from './changes.ts';
import { EditError } from './errors.ts';
import { inspectPlace } from './inline.ts';
import { parse } from './parse.ts';
import { fuzzCount, randomDocument, seeded } from './random-docs.ts';
import {
  LEDGER_NOTE,
  REFUSALS,
  ada,
  bo,
  bodyOf,
  context,
  editedDocument,
  expectInOrder,
  expectNoNewLineStarts,
  file,
  fixture,
  randomEdit,
  randomIds,
  thread,
} from './test-helpers.ts';
import type { Parsed, Range, TextChange } from './types.ts';
import { UNTRACKED_SELF_CHECK, untrackedEdit } from './untracked.ts';
import { newestView, originalView } from './views.ts';

/** Makes an untracked edit, drawing `ids` for the marks it splits, and returns the new file. */
function untrack(text: string, edit: TextChange, ids: string[] = []): string {
  return applyChanges(text, untrackedEdit(text, edit, { random: randomIds(...ids) }));
}

const type = (at: number, insert: string): TextChange => ({ from: at, to: at, insert });
const remove = (from: number, to: number): TextChange => ({ from, to, insert: '' });
const replace = (from: number, to: number, insert: string): TextChange => ({ from, to, insert });

/** The code of the error an untracked edit is refused with. */
function refusal(text: string, edit: TextChange): string | undefined {
  try {
    untrackedEdit(text, edit, { random: randomIds('w8nn') });
  } catch (error) {
    if (error instanceof EditError) return error.code;
    throw error;
  }
  return undefined;
}

/** The views of a file without the line break after the ledger. */
const newest = (text: string) => newestView(text).text.replace(/\n$/, '');
const original = (text: string) => originalView(text).text.replace(/\n$/, '');

/** The ledger entry these tests' files give each mark. */
const OLD = '2026-10-13T22:30Z';

describe('typing with Track Changes off (format §3.10)', () => {
  /** Where typed text can land at the edges of the mark `id`: before and after its opener, and
   * before and after its closer, which look the same in the editor. */
  function edges(text: string, id: string) {
    const opener = text.search(new RegExp(`<!--[a-z]+ ${id}`));
    const content = text.indexOf('-->', opener) + 3;
    const closer = text.indexOf(`<!--/${id}-->`);
    return { starts: [opener, content], ends: [closer, closer + `<!--/${id}-->`.length] };
  }

  it('puts text typed at the end of someone’s insertion after it, not in it', () => {
    const text = file('a<!--ins k3x9-->xz<!--/k3x9--> b', { k3x9: 'bo' });
    const expected = text.replace('<!--/k3x9--> b', '<!--/k3x9-->y b');
    for (const at of edges(text, 'k3x9').ends) {
      expect(untrack(text, type(at, 'y'))).toBe(expected);
    }
    // One change, the typed text: the ledger is left as it is.
    const closer = text.indexOf('<!--/k3x9-->') + '<!--/k3x9-->'.length;
    expect(untrackedEdit(text, type(closer - 12, 'y'))).toEqual([type(closer, 'y')]);
    expect(newest(expected)).toBe('axzy b');
    expect(original(expected)).toBe('ay b');
  });

  it('puts text typed at the start of someone’s insertion before it', () => {
    const text = file('a<!--ins k3x9-->xz<!--/k3x9--> b', { k3x9: 'bo' });
    for (const at of edges(text, 'k3x9').starts) {
      expect(bodyOf(untrack(text, type(at, 'y')))).toBe('ay<!--ins k3x9-->xz<!--/k3x9--> b');
    }
  });

  it('splits someone’s insertion around text typed in its middle, the second part a new mark', () => {
    const text = file('a<!--ins k3x9-->xz<!--/k3x9--> b', { k3x9: 'bo' });
    const after = untrack(text, type(text.indexOf('z'), 'y'), ['w8nn']);
    expect(bodyOf(after)).toBe('a<!--ins k3x9-->x<!--/k3x9-->y<!--ins w8nn-->z<!--/w8nn--> b');
    // The second part has a copy of the ledger entry: the author and the time of the insertion.
    const parsed = expectInOrder('split', [], after);
    expect(parsed.ledger.marks).toEqual({
      k3x9: { by: 'bo', at: OLD },
      w8nn: { by: 'bo', at: OLD },
    });
    expect(newest(after)).toBe('axyz b');
    expect(original(after)).toBe('ay b');
  });

  it('treats an insertion of the editing person’s own like anyone’s', () => {
    // With Track Changes off nothing typed is part of a change, an own one included.
    const text = file('a<!--ins k3x9-->xz<!--/k3x9--> b', { k3x9: 'ada' });
    const ctx = context(bo, ['w8nn']);
    const at = (edit: TextChange) => bodyOf(applyChanges(text, untrackedEdit(text, edit, ctx)));
    const { starts, ends } = edges(text, 'k3x9');
    expect(at(type(ends[0]!, 'y'))).toBe('a<!--ins k3x9-->xz<!--/k3x9-->y b');
    expect(at(type(starts[1]!, 'y'))).toBe('ay<!--ins k3x9-->xz<!--/k3x9--> b');
    expect(at(type(text.indexOf('z'), 'y'))).toBe(
      'a<!--ins k3x9-->x<!--/k3x9-->y<!--ins w8nn-->z<!--/w8nn--> b',
    );
  });

  it('does the same for a substitution: the old text stays with the first part', () => {
    const text = file('a<!--sub p7qd old-->xz<!--/p7qd--> b', { p7qd: 'bo' });
    const { starts, ends } = edges(text, 'p7qd');
    for (const at of ends) {
      expect(bodyOf(untrack(text, type(at, 'y')))).toBe('a<!--sub p7qd old-->xz<!--/p7qd-->y b');
    }
    // At the start of the new text, as at the start of the mark: before the old text.
    for (const at of starts) {
      expect(bodyOf(untrack(text, type(at, 'y')))).toBe('ay<!--sub p7qd old-->xz<!--/p7qd--> b');
    }
    // The second part has no old text: it is a substitution of nothing.
    const after = untrack(text, type(text.indexOf('z'), 'y'), ['w8nn']);
    expect(bodyOf(after)).toBe('a<!--sub p7qd old-->x<!--/p7qd-->y<!--sub w8nn-->z<!--/w8nn--> b');
    expect(expectInOrder('split', [], after).ledger.marks['w8nn']).toEqual({ by: 'bo', at: OLD });
    expect(newest(after)).toBe('axyz b');
    expect(original(after)).toBe('aoldy b');
  });

  it('copies the note and the group of a split mark, and a thread about it stays with the first part', () => {
    const body = 'a<!--ins k3x9-->xz<!--/k3x9--><!--cmt c8d2--> b';
    const text = file(body, {}, thread('c8d2', 'ada', 'Why?', ['about: k3x9'])).replace(
      'people:',
      `marks:\n  k3x9: {by: bo, at: ${OLD}, group: g2rs, note: Shorter}\npeople:`,
    );
    const after = untrack(text, type(text.indexOf('z'), 'y'), ['w8nn']);
    const parsed = parse(after);
    expect(parsed.ledger.marks['w8nn']).toEqual({
      by: 'bo',
      at: OLD,
      group: 'g2rs',
      note: 'Shorter',
    });
    expect(parsed.ledger.comments[0]?.about).toBe('k3x9');
  });

  it('extends a highlight or a comment at its end and not at its start, and never splits one', () => {
    const highlight = file('a<!--hl h4kz-->xz<!--/h4kz--> b', { h4kz: 'bo' });
    const comment = file('a<!--cmt c8d2-->xz<!--/c8d2--> b', {}, thread('c8d2'));
    for (const [text, id] of [
      [highlight, 'h4kz'],
      [comment, 'c8d2'],
    ] as const) {
      const kind = id === 'h4kz' ? 'hl' : 'cmt';
      const { starts, ends } = edges(text, id);
      for (const at of ends) {
        expect(bodyOf(untrack(text, type(at, 'y')))).toBe(
          `a<!--${kind} ${id}-->xzy<!--/${id}--> b`,
        );
      }
      for (const at of starts) {
        expect(bodyOf(untrack(text, type(at, 'y')))).toBe(
          `ay<!--${kind} ${id}-->xz<!--/${id}--> b`,
        );
      }
      expect(bodyOf(untrack(text, type(text.indexOf('xz') + 1, 'y')))).toBe(
        `a<!--${kind} ${id}-->xyz<!--/${id}--> b`,
      );
    }
  });

  it('types in front of a comment on whole blocks at its start: the opener joins the text', () => {
    const text = file('Prev.\n\n<!--cmt c8d2-->\n\nPara text.<!--/c8d2-->', {}, thread('c8d2'));
    const after = untrack(text, type(text.indexOf('Para'), 'X'));
    expect(bodyOf(after)).toBe('Prev.\n\nX<!--cmt c8d2-->Para text.<!--/c8d2-->');
    expect(newest(after)).toBe('Prev.\n\nXPara text.');
  });

  it('splits an insertion and the substitution inside it at once', () => {
    const text = file('a<!--ins k3x9-->x<!--sub p7qd old-->yz<!--/p7qd-->w<!--/k3x9--> b', {
      k3x9: 'ada',
      p7qd: 'bo',
    });
    const after = untrack(text, type(text.indexOf('z'), 'Q'), ['w8nn', 'm9tp']);
    expect(bodyOf(after)).toBe(
      'a<!--ins k3x9-->x<!--sub p7qd old-->y<!--/p7qd--><!--/k3x9-->Q<!--ins w8nn--><!--sub m9tp-->z<!--/m9tp-->w<!--/w8nn--> b',
    );
    expect(newest(after)).toBe('axyQzw b');
    expect(original(after)).toBe('aQ b');
    expectInOrder('nested split', [], after);
  });

  it('types at the start of a later block of an insertion: the first part ends before the split', () => {
    // A closer can't start the block, so the split and its break are left between the two parts.
    const body = '<!--ins k3x9-->\n\nPara one.<!--split s3vb-->\n\nPara two.<!--/k3x9-->';
    const text = file(body, { k3x9: 'bo', s3vb: 'bo' });
    const after = untrack(text, type(text.indexOf('Para two'), 'X'), ['w8nn']);
    expect(bodyOf(after)).toBe(
      '<!--ins k3x9-->\n\nPara one.<!--/k3x9--><!--split s3vb-->\n\nX<!--ins w8nn-->Para two.<!--/w8nn-->',
    );
    expect(newest(after)).toBe('Para one.\n\nXPara two.');
    expect(original(after)).toBe('X');
    // The same for an item of a list, and for text that replaces all of the block's text.
    const list = file('- <!--ins k3x9-->\n  one<!--split s3vb-->\n- two<!--/k3x9-->', {
      k3x9: 'bo',
      s3vb: 'bo',
    });
    expect(bodyOf(untrack(list, type(list.indexOf('two'), 'X'), ['w8nn']))).toBe(
      '- <!--ins k3x9-->\n  one<!--/k3x9--><!--split s3vb-->\n- X<!--ins w8nn-->two<!--/w8nn-->',
    );
    const all = untrack(text, replace(text.indexOf('Para two'), text.indexOf('<!--/k3x9'), 'New.'));
    expect(bodyOf(all)).toBe('<!--ins k3x9-->\n\nPara one.<!--/k3x9--><!--split s3vb-->\n\nNew.');
    expect(original(all)).toBe('New.');
  });

  describe('a line break at the edge of a comment or a highlight (format §4)', () => {
    // A line break is not text of the range. Written inside it, at its end, it would leave the
    // closer alone on a line of its own, which the editor hides: Enter would look like moving down,
    // and the next text typed would join the range or the block below.
    const ranges = [
      ['comment', (body: string) => file(body, {}, thread('c8d2'))],
      ['highlight', (body: string) => file(body.replaceAll('cmt c8d2', 'hl c8d2'), { c8d2: 'bo' })],
    ] as const;
    const kindOf = (text: string) => (text.includes('<!--hl') ? 'hl' : 'cmt');

    it.each(ranges)('goes after the closer at the end of a line with a %s', (_, make) => {
      for (const [body, typed, expected] of [
        // A paragraph followed by another; the last line of the file; a heading; a list item,
        // where Enter writes the bullet of the next item too.
        ['A <!--cmt c8d2-->note<!--/c8d2-->\n\nNext.', '\n', 'note<!--/c8d2-->\n\n\nNext.'],
        ['A <!--cmt c8d2-->note<!--/c8d2-->', '\n', 'note<!--/c8d2-->\n'],
        ['## A <!--cmt c8d2-->note<!--/c8d2-->\n\nNext.', '\n', 'note<!--/c8d2-->\n\n\nNext.'],
        ['- one <!--cmt c8d2-->note<!--/c8d2-->\n- two', '\n- ', 'note<!--/c8d2-->\n- \n- two'],
      ] as const) {
        const text = make(body);
        const closer = text.indexOf('<!--/c8d2-->');
        for (const at of [closer, closer + '<!--/c8d2-->'.length]) {
          const after = untrack(text, type(at, typed));
          expect(after, `${body} at ${at}`).toContain(expected);
          expect(after).toContain(`<!--${kindOf(text)} c8d2-->note<!--/c8d2-->`);
        }
      }
    });

    it.each(ranges)('goes after the opener in front of a %s, where it is legal', (_, make) => {
      const text = make('One <!--cmt c8d2-->two<!--/c8d2--> three.');
      const marker = `<!--${kindOf(text)} c8d2-->`;
      const opener = text.indexOf(marker);
      for (const at of [opener, opener + marker.length]) {
        const after = untrack(text, type(at, '\n'));
        expect(bodyOf(after)).toBe(`One <!--${kindOf(text)} c8d2-->\ntwo<!--/c8d2--> three.`);
        expect(newest(after)).toBe('One \ntwo three.');
      }
    });

    it('keeps text that starts or ends with a line break out of a range at its end', () => {
      const text = file('A <!--cmt c8d2-->note<!--/c8d2-->\n\nNext.', {}, thread('c8d2'));
      const closer = text.indexOf('<!--/c8d2-->');
      for (const at of [closer, closer + '<!--/c8d2-->'.length]) {
        expect(bodyOf(untrack(text, type(at, '\nmore')))).toBe(
          'A <!--cmt c8d2-->note<!--/c8d2-->\nmore\n\nNext.',
        );
        // A paste that ends with a line break would leave the closer alone on the next line.
        expect(bodyOf(untrack(text, type(at, 'more\n')))).toBe(
          'A <!--cmt c8d2-->note<!--/c8d2-->more\n\n\nNext.',
        );
        // Text with a line break inside it is text of the range like any other.
        expect(bodyOf(untrack(text, type(at, 'a\nb')))).toBe(
          'A <!--cmt c8d2-->notea\nb<!--/c8d2-->\n\nNext.',
        );
      }
    });

    it('goes after a range that ends with a change that holds no new text', () => {
      // A substitution of nothing ends right before the highlight's closer: typing after it is
      // not typing at its start, and does not go in front of it.
      const text = file(
        'A <!--hl h4kz-->note <!--sub p7qd old--><!--/p7qd--><!--/h4kz-->\n\nNext.',
        { h4kz: 'bo', p7qd: 'bo' },
      );
      const closer = text.indexOf('<!--/h4kz-->');
      for (const at of [closer, closer + '<!--/h4kz-->'.length]) {
        expect(bodyOf(untrack(text, type(at, '\n')))).toBe(
          'A <!--hl h4kz-->note <!--sub p7qd old--><!--/p7qd--><!--/h4kz-->\n\n\nNext.',
        );
      }
    });

    it('puts text that ends with a line break after a point comment, which would start the line', () => {
      const text = file('A note<!--cmt c8d2-->\n\nNext.', {}, thread('c8d2'));
      const point = text.indexOf('<!--cmt');
      expect(bodyOf(untrack(text, type(point, 'x\n')))).toBe('A note<!--cmt c8d2-->x\n\n\nNext.');
      // Other text stays on the side it is typed on.
      expect(bodyOf(untrack(text, type(point, 'x')))).toBe('A notex<!--cmt c8d2-->\n\nNext.');
    });

    it('keeps text that starts with a line break out of a range at its start', () => {
      const text = file('One <!--cmt c8d2-->two<!--/c8d2--> three.', {}, thread('c8d2'));
      const opener = text.indexOf('<!--cmt c8d2-->');
      for (const at of [opener, opener + '<!--cmt c8d2-->'.length]) {
        expect(bodyOf(untrack(text, type(at, '\nX')))).toBe(
          'One \nX<!--cmt c8d2-->two<!--/c8d2--> three.',
        );
      }
    });
  });

  it('keeps typed text off the break of a split', () => {
    const text = file('One<!--split s3vb-->\ntwo', { s3vb: 'bo' });
    const marker = text.indexOf('<!--split');
    const after = untrack(text, type(marker + '<!--split s3vb-->'.length, 'X'));
    expect(bodyOf(after)).toBe('OneX<!--split s3vb-->\ntwo');
  });

  it('writes the typed text with the line breaks of the file', () => {
    const text = file('a<!--ins k3x9-->xz<!--/k3x9--> b', { k3x9: 'bo' }).replaceAll('\n', '\r\n');
    const after = untrack(text, type(text.indexOf(' b'), '\n\n'));
    expect(bodyOf(after)).toBe('a<!--ins k3x9-->xz<!--/k3x9-->\r\n\r\n b');
  });

  it('does nothing for an edit that changes nothing', () => {
    expect(untrackedEdit('a b', type(1, ''))).toEqual([]);
    expect(untrackedEdit('a b', remove(1, 1))).toEqual([]);
  });

  it('types and deletes plain text in a file without marks as it is', () => {
    expect(untrackedEdit('One two.\n', type(3, ' and a half'))).toEqual([type(3, ' and a half')]);
    expect(untrackedEdit('One two.\n', remove(3, 7))).toEqual([remove(3, 7)]);
  });

  it('types and deletes away from every mark as it is, in a file with marks', () => {
    const text = file('Plain words here.\n\nOne <!--ins k3x9-->two<!--/k3x9--> three.', {
      k3x9: 'bo',
    });
    expect(untrackedEdit(text, type(5, 'x'))).toEqual([type(5, 'x')]);
    expect(untrackedEdit(text, replace(6, 11, 'w'))).toEqual([replace(6, 11, 'w')]);
    // Unless it changes how the marks elsewhere are read: a backtick that pairs with one on the
    // next line makes code of the markers between them.
    const code = file('One\ntwo <!--ins k3x9-->x<!--/k3x9--> three` four', { k3x9: 'bo' });
    expect(refusal(code, type(0, '`'))).toBe('would-hide-marks');
  });
});

describe('deleting with Track Changes off (format §3.10, issue #24)', () => {
  const at = (text: string, s: string) => text.indexOf(s);

  it('removes an insertion whose text is all deleted, with its ledger entry', () => {
    const text = file('a <!--ins k3x9-->new <!--/k3x9-->b', { k3x9: 'bo' });
    // The text alone, or the text with its markers: no empty insertion is left.
    const content = remove(at(text, 'new '), at(text, 'new ') + 4);
    const whole = remove(at(text, '<!--ins'), at(text, 'b\n'));
    for (const edit of [content, whole]) {
      // Nothing is left in the ledger, so it goes too.
      expect(untrack(text, edit)).toBe('a b\n');
    }
  });

  it('keeps the rest of a mark that keeps some of its text', () => {
    const text = file('a <!--ins k3x9-->new <!--/k3x9-->b', { k3x9: 'bo' });
    const after = untrack(text, remove(at(text, 'w '), at(text, 'b\n') + 1));
    expect(bodyOf(after)).toBe('a <!--ins k3x9-->ne<!--/k3x9-->');
    expect(parse(after).ledger.marks['k3x9']).toEqual({ by: 'bo', at: OLD });
  });

  it('removes a pending deletion in the deleted text, its old text with it', () => {
    const text = file('One two <!--del w2rf old -->three four.', { w2rf: 'bo' });
    const after = untrack(text, remove(at(text, 'two'), at(text, 'four')));
    expect(after).toBe('One four.\n');
    expect(original(text)).toBe('One two old three four.');
    expect(original(after)).toBe('One four.');
    // A deletion beside the deleted text is not in it, and stays.
    const beside = untrack(text, remove(at(text, 'three'), at(text, 'four')));
    expect(bodyOf(beside)).toBe('One two <!--del w2rf old -->four.');
  });

  it('removes the marks inside an insertion that is deleted, and keeps one that still holds a change', () => {
    const text = file('a <!--ins k3x9-->x <!--del w2rf q -->y <!--/k3x9-->b', {
      k3x9: 'ada',
      w2rf: 'bo',
    });
    expect(untrack(text, remove(at(text, 'x '), at(text, '<!--/k3x9')))).toBe('a b\n');
    // The visible text goes, the deletion inside stays, and so does the insertion that holds it.
    const holds = file('a <!--ins k3x9--><!--del w2rf q -->xy<!--/k3x9--> b', {
      k3x9: 'ada',
      w2rf: 'bo',
    });
    const after = untrack(holds, remove(at(holds, 'xy'), at(holds, 'xy') + 2));
    expect(bodyOf(after)).toBe('a <!--ins k3x9--><!--del w2rf q --><!--/k3x9--> b');
    expect(original(after)).toBe(original(holds));
  });

  it('keeps the old text of a substitution whose new text is deleted, as a deletion', () => {
    const text = file('In <!--sub p7qd March-->April<!--/p7qd-->, we ship.', { p7qd: 'bo' });
    const after = untrack(text, remove(at(text, 'April'), at(text, 'April') + 5));
    expect(bodyOf(after)).toBe('In <!--del p7qd March-->, we ship.');
    expect(parse(after).ledger.marks['p7qd']).toEqual({ by: 'bo', at: OLD });
    expect(newest(after)).toBe('In , we ship.');
    expect(original(after)).toBe('In March, we ship.');
  });

  it('deletes the old text of a substitution with its opener, and keeps the rest of the new text', () => {
    const text = file('In <!--sub p7qd March-->April<!--/p7qd-->, we ship.', { p7qd: 'bo' });
    const opener = at(text, '<!--sub');
    const after = untrack(text, remove(opener, at(text, 'ril')));
    expect(bodyOf(after)).toBe('In <!--sub p7qd-->ril<!--/p7qd-->, we ship.');
    expect(newest(after)).toBe('In ril, we ship.');
    expect(original(after)).toBe('In , we ship.');
    // All of it: the substitution goes.
    expect(untrack(text, remove(opener, at(text, ', we')))).toBe('In , we ship.\n');
  });

  it('removes a split whose break is deleted, and keeps one whose break is shorter', () => {
    const text = file('One<!--split s3vb-->\n\ntwo', { s3vb: 'bo' });
    const brk = at(text, '-->\n\n') + 3;
    expect(untrack(text, remove(brk, brk + 2))).toBe('Onetwo\n');
    expect(bodyOf(untrack(text, remove(brk + 1, brk + 2)))).toBe('One<!--split s3vb-->\ntwo');
  });

  it('removes a highlight whose text is all deleted', () => {
    const text = file('a <!--hl h4kz-->note<!--/h4kz--> b', { h4kz: 'bo' });
    expect(untrack(text, remove(at(text, 'note'), at(text, 'note') + 4))).toBe('a  b\n');
  });

  it('makes a comment whose text is all deleted a point comment there, and keeps its thread', () => {
    const text = file('a <!--cmt c8d2-->note<!--/c8d2--> b', {}, thread('c8d2'));
    const after = untrack(text, remove(at(text, 'note'), at(text, 'note') + 4));
    expect(bodyOf(after)).toBe('a <!--cmt c8d2--> b');
    expectInOrder('point', ['c8d2'], after);
    // A comment that keeps some of its text keeps the rest of its range.
    const part = untrack(text, remove(at(text, 'te'), at(text, ' b')));
    expect(bodyOf(part)).toBe('a <!--cmt c8d2-->no<!--/c8d2--> b');
  });

  it('replaces all of the text that holds marks with new text: the marks go, the comment stays', () => {
    const end = parse(fixture).ledgerRange!.from;
    const after = untrack(fixture, replace(0, end, 'New text.'));
    expect(bodyOf(after)).toBe('New text.<!--cmt c8d2-->');
    const parsed = expectInOrder('replace all', ['c8d2'], after);
    expect(parsed.ledger.marks).toEqual({});
    expect(newest(after)).toBe('New text.');
    expect(original(after)).toBe('New text.');
  });

  it('puts text that replaces the text of a comment in its range', () => {
    const text = file('a <!--cmt c8d2-->note<!--/c8d2--> b', {}, thread('c8d2'));
    const after = untrack(text, replace(at(text, 'note'), at(text, 'note') + 4, 'memo'));
    expect(bodyOf(after)).toBe('a <!--cmt c8d2-->memo<!--/c8d2--> b');
  });

  it('puts text that replaces the end of an insertion after it', () => {
    const text = file('a<!--ins k3x9-->bcd<!--/k3x9-->ef', { k3x9: 'bo' });
    const after = untrack(text, replace(at(text, 'cd'), at(text, 'f'), 'Q'));
    expect(bodyOf(after)).toBe('a<!--ins k3x9-->b<!--/k3x9-->Qf');
    expect(newest(after)).toBe('abQf');
    expect(original(after)).toBe('aQf');
  });
});

describe('what has no legal form with Track Changes off is refused (format §3.10)', () => {
  /** The message an untracked edit is refused with. */
  function message(text: string, edit: TextChange, author = bo): string {
    try {
      untrackedEdit(text, edit, { random: randomIds('w8nn'), author });
    } catch (error) {
      if (error instanceof EditError) return error.message;
      throw error;
    }
    return '';
  }

  it('refuses a line break in front of an insertion, whose opener would start the line', () => {
    const text = file('a <!--ins k3x9-->new<!--/k3x9--> b', { k3x9: 'bo' });
    const edit = type(text.indexOf('<!--ins'), '\n');
    expect(refusal(text, edit)).toBe('no-legal-placement');
    // It says what can't be done, whose change is in the way, and the way around.
    expect(message(text, edit, ada)).toBe(
      "This edit can't be made with Track Changes off: it would leave a hidden mark of Bo Chen's insertion at the start of a line or alone on it, where Markdown would read it as text. Accept or reject it first, or turn on Track Changes.",
    );
    expect(message(text, edit, bo)).toContain('a hidden mark of your insertion');
  });

  it('refuses text typed inside a link destination in someone’s insertion', () => {
    const text = file('a <!--ins k3x9-->[x](https://e.org)<!--/k3x9--> b', { k3x9: 'bo' });
    const edit = type(text.indexOf('.org'), 'y');
    expect(refusal(text, edit)).toBe('no-legal-placement');
    expect(message(text, edit, ada)).toBe(
      "Text can't be typed here with Track Changes off: it would split Bo Chen's insertion where Markdown can't hold its hidden marks, such as at the start of a line or inside a link. Accept or reject it first, or turn on Track Changes.",
    );
  });

  it('refuses an edit that would hide other changes in code', () => {
    const text = file('one <!--ins k3x9-->x<!--/k3x9--> two` three', { k3x9: 'bo' });
    expect(refusal(text, type(0, '`'))).toBe('would-hide-marks');
  });

  it('refuses typed text that holds Redlines markup', () => {
    expect(refusal('a b\n', type(1, '<!--ins k3x9-->x<!--/k3x9-->'))).toBe('markup');
  });

  it('refuses taking out the blank line between two splits’ breaks (#101)', () => {
    // Bo's break is a blank line and Ada's split stands behind it. Without the blank line, Ada's
    // split would be alone on the line after Bo's line break: accepting it would make that line
    // blank, and rejecting Bo's split would then take both line breaks away.
    const text = file('one <!--split s3vb-->\n\n<!--split w8nn-->\ntwo', {
      s3vb: 'bo',
      w8nn: 'ada',
    });
    const blank = text.indexOf('\n\n') + 1;
    expect(refusal(text, remove(blank, blank + 1))).toBe('no-legal-placement');
    expect(message(text, remove(blank, blank + 1), ada)).toBe(
      "This edit can't be made with Track Changes off: it would leave Bo Chen's line break right next to your line break, and deciding one would change the other. Accept or reject Bo Chen's line break first.",
    );
    // Text typed on the line of Ada's split is not refused for it.
    const at = text.indexOf('two');
    expect(newest(untrack(text, type(at, 'x')))).toBe('one \n\n\nxtwo');
  });

  it('throws a RangeError for an edit outside the text', () => {
    expect(() => untrackedEdit('a b', type(9, 'x'))).toThrow(RangeError);
  });
});

describe('the ledger with Track Changes off', () => {
  it('leaves a ledger it has no change for as it is, in whatever form it is written', () => {
    const text =
      'One <!--ins k3x9-->two<!--/k3x9--> three.\n\n<!-- redlines\nversion: 1\nmarks:\n  k3x9: {by: bo, at: 2026-10-31T09:30Z}\n-->\n';
    expect(untrackedEdit(text, type(1, 'x'))).toEqual([type(1, 'x')]);
    // A ledger that can't be read too: plain text is edited all the same.
    const unreadable = 'One two.\n\n<!-- redlines\nversion: 1\nmarks: [\n-->\n';
    expect(untrackedEdit(unreadable, type(1, 'x'))).toEqual([type(1, 'x')]);
  });

  it('writes the ledger in its canonical form when an entry comes or goes', () => {
    const text = file('a <!--ins k3x9-->new <!--/k3x9-->b', { k3x9: 'bo' });
    const after = untrack(text, type(at(text, 'w '), 'X'), ['w8nn']);
    expect(after.slice(parse(after).ledgerRange!.from)).toContain(LEDGER_NOTE);
    expectInOrder('canonical', [], after);
  });

  function at(text: string, s: string): number {
    return text.indexOf(s);
  }
});

/** Ids for the random tests: a different series for each edit. */
function randomBytes(seed: number, step: number): (n: number) => Uint8Array {
  const random = seeded(seed * 104729 + step);
  return (n) => Uint8Array.from({ length: n }, () => Math.floor(random() * 256));
}

/** The text with blank lines and line endings as Markdown reads them. */
const loose = (s: string) =>
  s
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]*\n(?:[ \t]*\n)+[ \t]*/g, '\n\n')
    .trim();

/** The new text of the insertions and substitutions of a parse, without their carriers. */
function newTextRanges(parsed: Parsed): Range[] {
  return parsed.marks.flatMap((mark) =>
    mark.kind === 'ins' || mark.kind === 'sub'
      ? mark.segments.flatMap((s) =>
          s.close ? [{ from: s.carrier?.to ?? s.content.from, to: s.content.to }] : [],
        )
      : [],
  );
}

/**
 * The original view of `text`, worked out character by character rather than as the views are, with
 * the text that both views have in `[from, to)` left out, and the old text of the deletions and
 * substitutions whose opener is in it: what deleting the range with Track Changes off leaves of the
 * original text (format §3.10). With an empty range, it is the original view.
 */
function originalLeft(text: string, from: number, to: number): string {
  const parsed = parse(text);
  const hidden = new Array<boolean>(text.length).fill(false);
  const hide = (a: number, b: number) => hidden.fill(true, a, Math.max(a, b));
  const limit = parsed.ledgerRange?.from;
  const deletions = parsed.marks.flatMap((mark) => (mark.kind === 'del' ? mark.segments : []));
  const newText = newTextRanges(parsed);
  const breaks: Range[] = [];
  for (const mark of parsed.marks) {
    for (const segment of mark.segments) {
      const opener = openerRange(segment);
      hide(opener.from, opener.to);
      if (segment.close) hide(segment.close.from, segment.close.to);
      if (mark.kind === 'split') {
        const end = splitEnd(text, segment.open, deletions, limit);
        breaks.push({ from: segment.open.to, to: end });
        hide(segment.open.to, end);
      }
    }
  }
  for (const range of newText) hide(range.from, range.to);
  if (parsed.ledgerRange) hide(parsed.ledgerRange.from, parsed.ledgerRange.to);
  const old = new Map<number, { text: string; opener: Range }>();
  for (const mark of parsed.marks) {
    if (mark.kind !== 'del' && mark.kind !== 'sub') continue;
    for (const segment of mark.segments) {
      const opener = openerRange(segment);
      // Old text in new text, or in the break of a split, is no more in the original than they are.
      const within = (r: Range) => r.from <= opener.from && opener.to <= r.to && r.from < r.to;
      if (segment.payload && !newText.some(within) && !breaks.some(within)) {
        old.set(opener.from, { text: segment.payload, opener });
      }
    }
  }
  let result = '';
  for (let i = 0; i < text.length; i++) {
    const payload = old.get(i);
    if (payload && !(from < to && from <= payload.opener.from && payload.opener.to <= to)) {
      result += payload.text;
    }
    if (!hidden[i] && !(from <= i && i < to)) result += text[i];
  }
  return result;
}

/** Segments of insertions, substitutions, highlights and format changes with nothing between their
 * markers, and splits with no break: what an edit must not leave. */
function emptyMarks(text: string): number {
  const parsed = parse(text);
  const limit = parsed.ledgerRange?.from;
  let count = 0;
  for (const mark of parsed.marks) {
    for (const s of mark.segments) {
      const { kind } = mark;
      if (s.close && kind !== 'cmt' && (s.carrier?.to ?? s.content.from) === s.content.to) count++;
      if (kind === 'split' && breakEnd(text, s.open.to, limit) === s.open.to) count++;
    }
  }
  return count;
}

/** How many warnings of each code a parse has. */
function warningCounts(parsed: Parsed): Map<string, number> {
  const counts = new Map<string, number>();
  for (const { code } of parsed.warnings) counts.set(code, (counts.get(code) ?? 0) + 1);
  return counts;
}

/**
 * What every untracked edit must give (format §3.10): the newest text is the plain edit of the
 * newest text; the typed text is plain, in both views and in no pending change; the original text
 * loses what both views had of the deleted text and the old text whose marker was in it, and nothing
 * else; no warning more, no empty mark, no marker at the start of a line; the ledger in order; and
 * the marks away from the edit as they were.
 */
function expectPlainEdit(
  label: string,
  text: string,
  edit: TextChange,
  after: string,
  threads: string[],
): void {
  const view = newestView(text);
  const before = parse(text);
  const shown = `${label}\n=> ${JSON.stringify(bodyOf(after))}`;
  const { from, to, insert } = edit;
  const start = view.map.fromSource(from);
  const plain = { from: start, to: view.map.fromSource(to), insert };
  const newest = newestView(after);
  expect(loose(newest.text), `${shown}: newest`).toBe(loose(applyChanges(view.text, [plain])));
  const parsed = parse(after);
  let original = originalView(after).text;
  if (insert !== '') {
    const at = newest.map.toSource(start, 1);
    const end = at + insert.length;
    expect(after.slice(at, end), `${shown}: typed`).toBe(insert);
    const changed = newTextRanges(parsed).some((r) => r.from < end && at < r.to);
    expect(changed, `${shown}: the typed text is in a change`).toBe(false);
    const k = originalView(after).map.fromSource(at);
    expect(original.slice(k, k + insert.length), `${shown}: typed`).toBe(insert);
    original = original.slice(0, k) + original.slice(k + insert.length);
  }
  expect(loose(original), `${shown}: original`).toBe(loose(originalLeft(text, from, to)));
  const had = warningCounts(before);
  for (const [code, count] of warningCounts(parsed)) {
    expect(count, `${shown}: ${code}`).toBeLessThanOrEqual(had.get(code) ?? 0);
  }
  expect(emptyMarks(after), `${shown}: an empty mark`).toBeLessThanOrEqual(emptyMarks(text));
  expectNoNewLineStarts(shown, before, parsed);
  expectInOrder(shown, threads, after);
  const segments = new Map(parsed.marks.map((mark) => [mark.id, mark.segments.length]));
  for (const mark of before.marks) {
    const away = mark.segments.every(
      (s) => (s.close ?? openerRange(s)).to < from || s.open.from > to,
    );
    if (away) expect(segments.get(mark.id), `${shown}: ${mark.id}`).toBe(mark.segments.length);
  }
}

/**
 * The `nth` marker of `text` that reads `marker` (a mark's markers repeat in each of its segments),
 * with `before` characters in front of it and `after` characters after it.
 */
function around(text: string, marker: string, nth: number, before: number, after: number): string {
  let at = -1;
  for (let i = 0; i <= nth; i++) at = text.indexOf(marker, at + 1);
  return text.slice(at - before, at + marker.length + after);
}

/** An edit that has a legal form wherever it is made, and what else it must give. */
interface Sure {
  label: string;
  edit: TextChange;
  check: (after: string, label: string) => void;
}

/**
 * Edits on `text` that must never be refused (format §3.10), each with the caret on both sides of
 * the hidden marker: a letter typed after the end or before the start of an insertion or a
 * substitution that stands in plain text, and in the middle of a plain word of one, which splits it;
 * a line break typed at the end of a line that a comment or a highlight ends, and in front of one
 * that starts after text. Marks inside other changes are left out, and words next to syntax.
 */
function sureEdits(text: string): Sure[] {
  const parsed = parse(text);
  const hidden = markerRanges(parsed);
  const newText = newTextRanges(parsed);
  const letter = (c: string | undefined) => c !== undefined && /[a-z]/i.test(c);
  const nested = (from: number, to: number) => newText.some((r) => r.from <= from && to <= r.to);
  const sure: Sure[] = [];
  for (const mark of parsed.marks) {
    for (const segment of mark.segments) {
      const { open, close, carrier } = segment;
      // Neither marker is in the new text of another change, which typed text would split.
      if (!close || carrier || nested(open.from, open.to) || nested(close.from, close.to)) continue;
      const opener = text.slice(open.from, open.to);
      const closer = text.slice(close.from, close.to);
      // Which of the markers that read the same these are.
      const nthOpen = text.slice(0, open.from).split(opener).length - 1;
      const nthClose = text.slice(0, close.from).split(closer).length - 1;
      if (mark.kind === 'ins' || mark.kind === 'sub') {
        if (letter(text[close.from - 1]) && /[ \n]/.test(text[close.to] ?? '')) {
          for (const at of [close.from, close.to]) {
            sure.push({
              label: `x after the end of ${mark.id}`,
              edit: { from: at, to: at, insert: 'x' },
              check: (after, label) =>
                expect(around(after, closer, nthClose, 0, 1), label).toBe(`${closer}x`),
            });
          }
        }
        if (text[open.from - 1] === ' ' && letter(text[open.to])) {
          for (const at of [open.from, open.to]) {
            sure.push({
              label: `x before the start of ${mark.id}`,
              edit: { from: at, to: at, insert: 'x' },
              check: (after, label) =>
                expect(around(after, opener, nthOpen, 1, 0), label).toBe(`x${opener}`),
            });
          }
        }
        // In the middle of a word of plain letters, with white space around it, none of it in a
        // marker.
        const word = [...text.slice(open.to, close.from).matchAll(/(?<=[ \n])[a-z]{3,}(?=[ \n])/gi)]
          .map((m) => ({ from: open.to + m.index, to: open.to + m.index + m[0].length }))
          .find(
            (w) =>
              !hidden.some((r) => r.from <= w.to && w.from - 1 < r.to) &&
              !newText.some((r) => open.to < r.from && r.from <= w.from && w.to <= r.to),
          );
        const at = word ? word.from + 1 : -1;
        if (word && inspectPlace(text, hidden, at).kind === 'ok') {
          // The entry, without the other half of a move and the parts of a simplified change.
          const entry = { ...parsed.ledger.marks[mark.id] };
          delete entry.move;
          delete entry.parts;
          sure.push({
            label: `x in the middle of ${mark.id}`,
            edit: { from: at, to: at, insert: 'x' },
            check: (after, label) => {
              // The second part is a new mark of the same kind, with a copy of the entry.
              const read = parse(after);
              const made = read.marks.filter((m) => !parsed.marks.some((old) => old.id === m.id));
              expect(
                made.map((m) => m.kind),
                label,
              ).toEqual([mark.kind]);
              const id = made[0]!.id;
              expect(read.ledger.marks[id], label).toEqual(entry);
              expect(after, label).toContain(`<!--/${mark.id}-->x<!--${mark.kind} ${id}-->`);
            },
          });
        }
      }
      if (mark.kind === 'cmt' || mark.kind === 'hl') {
        if (text[close.to] === '\n') {
          for (const at of [close.from, close.to]) {
            sure.push({
              label: `Enter at the end of ${mark.id}`,
              edit: { from: at, to: at, insert: '\n' },
              check: (after, label) =>
                expect(around(after, closer, nthClose, 0, 2), label).toBe(`${closer}\n\n`),
            });
          }
        }
        const line = text.slice(text.lastIndexOf('\n', open.from - 1) + 1, open.from);
        const textBefore = /[a-z0-9]/i.test(line.replace(/<!--.*?-->/g, ''));
        if (text[open.from - 1] === ' ' && letter(text[open.to]) && textBefore) {
          for (const at of [open.from, open.to]) {
            sure.push({
              label: `Enter before the start of ${mark.id}`,
              edit: { from: at, to: at, insert: '\n' },
              check: (after, label) =>
                expect(around(after, opener, nthOpen, 0, 1), label).toBe(`${opener}\n`),
            });
          }
        }
      }
    }
  }
  return sure;
}

describe('on random documents (format §3.10)', { timeout: 600_000 }, () => {
  const INSERTS = [
    'x',
    'new words',
    '😀',
    'é',
    ' ',
    '\n',
    '\n\n',
    'a--b',
    '**',
    '_',
    '[x](y)',
    '- item',
    'one\n\ntwo',
    '`',
    '<!-- ',
  ];

  /** A random document. Half of them have been edited with Track Changes on, which leaves splits,
   * whole-block insertions and deletions, and closers in front of openers. */
  const documentOf = (seed: number) =>
    seed % 2 === 0 ? editedDocument(seed) : randomDocument(seeded(seed));

  it('makes the plain edit of both views, and leaves marks and ledger in order', () => {
    const documents = fuzzCount(150);
    let edits = 0;
    let refused = 0;
    let checked = 0;
    for (let seed = 1; seed <= documents; seed++) {
      const random = seeded(seed * 3571);
      const below = (n: number) => Math.floor(random() * n);
      let text = documentOf(seed);
      const threads = parse(text).ledger.comments.map((t) => t.id);
      for (let step = 0; step < 4; step++) {
        const view = newestView(text);
        const before = parse(text);
        // The model of the original view agrees with the views.
        expect(originalLeft(text, 0, 0), `seed ${seed}: the model`).toBe(originalView(text).text);
        const wanted = randomEdit(below, view.text, INSERTS);
        // Either side of the hidden markers at each end, as the editor may have it. An edit stops
        // at the end of the body.
        const side = () => (below(2) === 0 ? -1 : 1);
        const stop = before.ledgerRange?.from ?? text.length;
        const from = Math.min(view.map.toSource(wanted.from, side()), stop);
        const to =
          wanted.from === wanted.to
            ? from
            : Math.min(Math.max(from, view.map.toSource(wanted.to, side())), stop);
        const edit = { from, to, insert: wanted.insert };
        const label = `seed ${seed}, step ${step}: ${JSON.stringify(edit)} on ${JSON.stringify(bodyOf(text))}`;
        let after: string;
        try {
          after = applyChanges(
            text,
            untrackedEdit(text, edit, { random: randomBytes(seed, step) }),
          );
        } catch (error) {
          if (error instanceof EditError && REFUSALS.includes(error.code ?? '')) {
            refused++;
            // The last check refuses a result that came out wrong, which would hide a rule that
            // broke: it must stay rare.
            if (error.message === UNTRACKED_SELF_CHECK) checked++;
            continue;
          }
          throw new Error(`${label}: ${String(error)}`, { cause: error });
        }
        expectPlainEdit(label, text, edit, after, threads);
        text = after;
        edits++;
      }
    }
    // Most edits go through, and the last check refuses hardly any.
    expect(edits, `refused ${refused}`).toBeGreaterThan(refused * 4);
    expect(checked, `the last check refused ${checked} of ${edits + refused}`).toBeLessThanOrEqual(
      Math.ceil((edits + refused) / 100),
    );
  });

  it('never refuses typing beside or inside an insertion, or Enter beside a comment', () => {
    const documents = fuzzCount(150);
    let tried = 0;
    const kinds = new Set<string>();
    for (let seed = 1; seed <= documents; seed++) {
      const text = documentOf(seed);
      const threads = parse(text).ledger.comments.map((t) => t.id);
      for (const { label, edit, check } of sureEdits(text)) {
        const shown = `seed ${seed}: ${label} ${JSON.stringify(edit)} on ${JSON.stringify(bodyOf(text))}`;
        let after: string;
        try {
          after = applyChanges(
            text,
            untrackedEdit(text, edit, { random: randomBytes(seed, tried) }),
          );
        } catch (error) {
          throw new Error(`${shown}: refused: ${String(error)}`, { cause: error });
        }
        expectPlainEdit(shown, text, edit, after, threads);
        check(after, shown);
        kinds.add(label.replace(/ \S+$/, ''));
        tried++;
      }
    }
    // Enough of them, of every kind.
    expect(tried).toBeGreaterThan(documents * 2);
    expect([...kinds].sort()).toEqual([
      'Enter at the end of',
      'Enter before the start of',
      'x after the end of',
      'x before the start of',
      'x in the middle of',
    ]);
  });
});
