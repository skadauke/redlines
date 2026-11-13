import { describe, expect, it } from 'vitest';
import { parse } from '@redlines/format';
import { namesIn, noticeOf, pendingOf } from './summary.ts';

const LEDGER_HEAD = '\n<!-- redlines\nversion: 1\npeople:\n';
const PEOPLE =
  '  ada: {name: Ada Lovelace}\n  bo: {name: Bo Chen}\n  claude-ada: {name: Claude, agent: true, for: ada}\n';

/** A file with the given marks in its text, and entries in its ledger. */
function file(body: string, marks: string, comments = ''): string {
  return `${body}${LEDGER_HEAD}${PEOPLE}marks:\n${marks}comments:${comments === '' ? ' []\n' : `\n${comments}`}-->\n`;
}

const MARK = (id: string, by: string) => `  ${id}: {by: ${by}, at: 2026-10-13T22:30Z}\n`;
const THREAD = (id: string, by: string, extra = '') =>
  `  ${id}:\n    by: ${by}\n    at: 2026-10-13T22:40Z\n    text: |-\n      A question?\n${extra}`;

describe('noticeOf', () => {
  it('says nothing about a file with nothing waiting', () => {
    expect(noticeOf('# A plain file\n\nText.\n')).toBeNull();
    expect(noticeOf('')).toBeNull();
  });

  it('counts the changes and the comments, and says who made them', () => {
    const text = file(
      'We <!--ins k3x9-->new <!--/k3x9-->ship <!--sub p7qd March-->April<!--/p7qd--> the <!--cmt c8d2-->review<!--/c8d2-->.<!--del w2rf  Old.-->\n',
      MARK('k3x9', 'ada') + MARK('p7qd', 'claude-ada') + MARK('w2rf', 'bo'),
      THREAD('c8d2', 'bo'),
    );
    expect(noticeOf(text)).toBe(
      '3 changes and 1 comment by Ada Lovelace, Claude and Bo Chen. Open in Redlines to review them.',
    );
  });

  it('says one change in the singular', () => {
    const text = file('A <!--ins k3x9-->new <!--/k3x9-->word.\n', MARK('k3x9', 'ada'));
    expect(noticeOf(text)).toBe('1 change by Ada Lovelace. Open in Redlines to review it.');
  });

  it('says comments alone as comments to read', () => {
    const text = file(
      'A <!--cmt c8d2-->word<!--/c8d2--> and <!--cmt c9fm-->another<!--/c9fm-->.\n',
      '',
      THREAD('c8d2', 'bo') + THREAD('c9fm', 'ada'),
    );
    expect(noticeOf(text)).toBe(
      '2 comments by Bo Chen and Ada Lovelace. Open in Redlines to read them.',
    );
    const one = file('A <!--cmt c8d2-->word<!--/c8d2-->.\n', '', THREAD('c8d2', 'bo'));
    expect(noticeOf(one)).toBe('1 comment by Bo Chen. Open in Redlines to read it.');
  });

  it('leaves out a resolved thread, and the history that a ledger keeps', () => {
    const resolved = file(
      'A <!--cmt c8d2-->word<!--/c8d2-->.\n',
      '',
      THREAD('c8d2', 'bo', '    resolved: ada 2026-10-14T09:00Z\n'),
    );
    expect(noticeOf(resolved)).toBeNull();
    // A ledger with an entry for a mark that is no longer in the text is not waiting for anyone.
    expect(noticeOf(file('Plain.\n', MARK('k3x9', 'ada')))).toBeNull();
  });

  it('counts a thread whose anchor is gone, which is kept and shown at the end (format §4)', () => {
    expect(noticeOf(file('Plain.\n', '', THREAD('c8d2', 'bo')))).toBe(
      '1 comment by Bo Chen. Open in Redlines to read it.',
    );
  });

  it('counts a thread about a change, with no range of its own', () => {
    const text = file(
      'A <!--ins k3x9-->new <!--/k3x9-->word.\n',
      MARK('k3x9', 'ada'),
      THREAD('c8d2', 'bo', '    about: k3x9\n'),
    );
    expect(noticeOf(text)).toBe(
      '1 change and 1 comment by Ada Lovelace and Bo Chen. Open in Redlines to review them.',
    );
  });

  it('counts the marks of one suggestion as one, as the review bar does', () => {
    const grouped =
      '  k3x9: {by: claude-ada, at: 2026-10-13T22:30Z, group: g1, note: Tighter}\n' +
      '  p7qd: {by: claude-ada, at: 2026-10-13T22:30Z, group: g1, note: Tighter}\n';
    const text = file(
      'A <!--ins k3x9-->new <!--/k3x9-->word and <!--ins p7qd-->another <!--/p7qd-->one.\n',
      grouped,
    );
    expect(noticeOf(text)).toBe('1 change by Claude. Open in Redlines to review it.');
  });

  it('does not count a highlight as a change', () => {
    const text = file('A <!--hl k3x9-->word<!--/k3x9-->.\n', MARK('k3x9', 'ada'));
    expect(noticeOf(text)).toBeNull();
  });

  it('names an author the ledger does not know by the handle, and a missing one as someone', () => {
    const noPeople =
      '\n<!-- redlines\nversion: 1\npeople: {}\nmarks:\n  k3x9: {by: zed, at: 2026-10-13T22:30Z}\ncomments: []\n-->\n';
    expect(noticeOf(`A <!--ins k3x9-->new <!--/k3x9-->word.\n${noPeople}`)).toBe(
      '1 change by zed. Open in Redlines to review it.',
    );
    expect(noticeOf('A <!--ins k3x9-->new <!--/k3x9-->word.\n')).toBe(
      '1 change by someone. Open in Redlines to review it.',
    );
  });
});

describe('pendingOf', () => {
  it('lists the authors in the order of the document, each once', () => {
    const text = file(
      '<!--ins k3x9-->a<!--/k3x9--> <!--ins p7qd-->b<!--/p7qd--> <!--ins w2rf-->c<!--/w2rf-->\n',
      MARK('k3x9', 'bo') + MARK('p7qd', 'ada') + MARK('w2rf', 'bo'),
    );
    expect(pendingOf(parse(text)).authors).toEqual(['Bo Chen', 'Ada Lovelace']);
  });
});

describe('namesIn', () => {
  it('writes names as people read them', () => {
    expect(namesIn(['Claude'])).toBe('Claude');
    expect(namesIn(['Claude', 'Bo'])).toBe('Claude and Bo');
    expect(namesIn(['Ada', 'Claude', 'Bo'])).toBe('Ada, Claude and Bo');
    expect(namesIn(['Ada', 'Claude', 'Bo', 'Cy'])).toBe('Ada, Claude and 2 others');
    expect(namesIn(['A', 'B', 'C', 'D', 'E'])).toBe('A, B and 3 others');
    expect(namesIn([])).toBe('');
  });
});
