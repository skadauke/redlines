// Ordinary typing with Track Changes on (format §3.4): Enter at the end of a block or on a blank
// line, the text typed on the line it makes, and replacing the whole document. The editor and the
// command line make the same edits, so the format decides what they are.

import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { accept, acceptAll, reject, rejectAll } from './decide.ts';
import { EditError } from './errors.ts';
import { parse } from './parse.ts';
import { ada, bo, bodyOf, context, file, fixture, thread } from './test-helpers.ts';
import type { TextChange } from './types.ts';
import { trackedEdit, trackedEdits } from './track.ts';
import { newestView, originalView } from './views.ts';

/** The body of a file without the line breaks that end it. */
const bodyText = (text: string) => bodyOf(text).replace(/\n+$/, '');

const without = (view: string) => view.replace(/\n+$/, '');

/** Types at `at` of a file with `body`: the new file. */
function type(body: string, at: number, insert: string, ids: string[] = [], author = ada) {
  const before = file(body);
  const result = trackedEdits(before, [{ from: at, to: at, insert }], context(author, ids));
  const after = applyChanges(before, result.changes);
  return { before, after, ...result };
}

describe('Enter at a block boundary writes line breaks and no mark (format §3.4)', () => {
  it('at the end of a paragraph, a heading and the last block', () => {
    for (const [body, at, expected] of [
      ['Para one.\n\nPara two.', 9, 'Para one.\n\n\nPara two.'],
      ['## Heading\n\nText.', 10, '## Heading\n\n\nText.'],
      ['Para one.', 9, 'Para one.\n\n'],
      ['- one\n- two', 11, '- one\n- two\n'],
    ] as const) {
      const { after, markIds, changes } = type(body, at, '\n');
      expect(bodyText(after), body).toBe(without(expected));
      expect(markIds).toEqual([]);
      expect(parse(after).marks).toEqual([]);
      // The line break is in the original text as well: blank lines make no block.
      expect(without(newestView(after).text).replace(/\n+/g, '\n')).toBe(
        without(newestView(file(body)).text).replace(/\n+/g, '\n'),
      );
      expect(changes.length).toBeGreaterThan(0);
    }
  });

  it('at the end of a list item, with the indentation of its lines', () => {
    const { after, markIds } = type('- one\n- two', 5, '\n  ');
    expect(bodyText(after)).toBe('- one\n  \n- two');
    expect(markIds).toEqual([]);
  });

  it('on a blank line between two blocks, and in front of the first block', () => {
    expect(bodyText(type('Para one.\n\nPara two.', 10, '\n').after)).toBe(
      'Para one.\n\n\nPara two.',
    );
    expect(bodyText(type('Para one.', 0, '\n').after)).toBe('\nPara one.');
    expect(type('Para one.', 0, '\n').markIds).toEqual([]);
    // Two line breaks, as a paragraph break typed in one go.
    expect(bodyText(type('Para one.\n\nPara two.', 9, '\n\n').after)).toBe(
      'Para one.\n\n\n\nPara two.',
    );
  });

  it('in the file’s own line breaks', () => {
    const before = file('Para one.\r\n\r\nPara two.');
    const changes = trackedEdit(before, { from: 9, to: 9, insert: '\n' }, context(ada));
    expect(bodyText(applyChanges(before, changes))).toBe('Para one.\r\n\r\n\r\nPara two.');
  });

  it('after the markers that end the line, which stay at the end of it', () => {
    // A comment at the end of the paragraph has no text of the original in it.
    const before = file('We will ship it.<!--cmt c8d2-->', {}, thread('c8d2', 'bo', 'Who?'));
    const end = before.indexOf('<!--cmt');
    const changes = trackedEdit(before, { from: end, to: end, insert: '\n' }, context(ada));
    const after = applyChanges(before, changes);
    // The line break comes after the comment, which stays at the end of its line.
    expect(bodyOf(after).endsWith('it.<!--cmt c8d2-->\n')).toBe(true);
    expect(parse(after).warnings).toEqual([]);
    expect(parse(after).marks.map((mark) => mark.id)).toEqual(['c8d2']);
  });

  it('but not where the original text goes on, after a deletion at the end of the paragraph', () => {
    // The paragraph of the example of format §1.2 ends in a deletion of Bo's: the sentence it
    // deleted is the end of the paragraph in the original text, so a line break is a split.
    const end = fixture.indexOf('<!--del w2rf');
    const edit = { from: end, to: end, insert: '\n' };
    const after = applyChanges(fixture, trackedEdit(fixture, edit, context(ada, ['s3vb'])));
    expect(bodyOf(after)).toContain('stays as it is.--><!--split s3vb-->\n');
    expect(originalView(after).text).toBe(originalView(fixture).text);
  });

  it('but not in the middle of a paragraph, where it is a split', () => {
    const { after, markIds } = type('Hello world', 5, '\n', ['s3vb']);
    expect(bodyText(after)).toBe('Hello<!--split s3vb-->\n world');
    expect(markIds).toEqual(['s3vb']);
  });

  it('but next to the break of a split, which the original text goes on through', () => {
    // The paragraph is one in the original text: another break is another split, in front of it.
    const before = file('One<!--split s3vb-->\n\ntwo.', { s3vb: 'bo' });
    const at = before.indexOf('<!--split');
    const changes = trackedEdit(before, { from: at, to: at, insert: '\n' }, context(ada, ['w8nn']));
    const after = applyChanges(before, changes);
    expect(bodyText(after)).toBe('One<!--split w8nn-->\n<!--split s3vb-->\n\ntwo.');
    expect(parse(after).warnings).toEqual([]);
    expect(bodyText(applyChanges(after, rejectAll(after)))).toBe('Onetwo.');
  });
});

describe('text typed on a blank line between two blocks is a block (format §3.4)', () => {
  it('is a whole-block insertion with its opener on a line of its own', () => {
    // Enter twice at the end of a paragraph leaves a blank line with a blank line on either side.
    const { before, after, markIds } = type('Para one.\n\n\n\nPara two.', 11, 'New', ['k3x9']);
    expect(bodyText(after)).toBe('Para one.\n\n<!--ins k3x9-->\n\nNew<!--/k3x9-->\n\nPara two.');
    expect(markIds).toEqual(['k3x9']);
    expect(parse(after).warnings).toEqual([]);
    expect(without(newestView(after).text)).toBe('Para one.\n\nNew\n\nPara two.');
    expect(without(originalView(after).text)).toBe(without(originalView(before).text));
    expect(bodyText(applyChanges(after, rejectAll(after)))).toBe('Para one.\n\n\n\nPara two.');
    expect(bodyText(applyChanges(after, acceptAll(after)))).toBe('Para one.\n\nNew\n\nPara two.');
  });

  it('is the same after Enter on a blank line, which makes the second blank line', () => {
    const blank = 'Para one.\n\nPara two.';
    const enter = type(blank, 10, '\n');
    expect(bodyText(enter.after)).toBe('Para one.\n\n\nPara two.');
    // The caret is after the line break that was typed: 11. Typed text goes there.
    const typed = applyChanges(
      enter.after,
      trackedEdit(enter.after, { from: 11, to: 11, insert: 'New' }, context(ada, ['k3x9'])),
    );
    expect(parse(typed).warnings).toEqual([]);
    expect(without(newestView(typed).text)).toBe('Para one.\n\nNew\nPara two.');
  });

  it('is a block after a heading, which is one line', () => {
    const { after } = type('## Heading\n\n\nText.', 11, 'New', ['k3x9']);
    expect(bodyText(after)).toBe('## Heading\n<!--ins k3x9-->\n\nNew<!--/k3x9-->\n\nText.');
    expect(parse(after).warnings).toEqual([]);
    expect(without(newestView(after).text)).toBe('## Heading\nNew\n\nText.');
  });

  it('continues the paragraph above when it is on the line right below it, as in Markdown', () => {
    // After one Enter at the end of a paragraph, the line has text right above it: a wrapped line.
    const { before, after } = type('Para one.\n\n\nPara two.', 10, 'New', ['k3x9']);
    expect(bodyText(after)).toBe('Para one.<!--sub k3x9 \\n-->\nNew<!--/k3x9-->\n\nPara two.');
    expect(parse(after).warnings).toEqual([]);
    expect(without(newestView(after).text)).toBe('Para one.\nNew\n\nPara two.');
    expect(without(originalView(after).text)).toBe(without(originalView(before).text));
  });
});

describe('replacing the whole document (format §3.4)', () => {
  const body = '# Title\n\nFirst para here.\n\n- item one\n- item two\n\n> A quote.\n\nLast para.';
  const before = file(body);
  const bodyEnd = body.length + 2;

  /** Types over everything, up to the end of the body or the end of the file's text. */
  function replaceAll(insert: string, to: number, ids = ['k3x9']) {
    const edit = { from: 0, to, insert };
    const after = applyChanges(before, trackedEdit(before, edit, context(ada, ids)));
    expect(parse(after).warnings).toEqual([]);
    expect(without(originalView(after).text)).toBe(without(originalView(before).text));
    expect(bodyText(applyChanges(after, rejectAll(after)))).toBe(body);
    return after;
  }

  it('is a substitution of everything after the prefix of the first block', () => {
    for (const to of [body.length, bodyEnd]) {
      const after = replaceAll('New text', to);
      expect(bodyText(after)).toBe(
        '# <!--sub k3x9 Title\\n\\nFirst para here.\\n\\n- item one\\n- item two\\n\\n> A quote.\\n\\nLast para.-->New text<!--/k3x9-->',
      );
      expect(without(newestView(after).text)).toBe('# New text');
      expect(without(applyChanges(after, acceptAll(after)))).toContain('# New text');
    }
  });

  it('holds the paragraph breaks of the new text as splits inside the substitution', () => {
    const after = replaceAll('New one.\n\nNew two.', body.length, ['k3x9', 's3vb']);
    expect(bodyText(after)).toContain('New one.<!--split s3vb-->\n\nNew two.<!--/k3x9-->');
    expect(without(newestView(after).text)).toBe('# New one.\n\nNew two.');
  });

  it('is a deletion of everything when nothing is typed', () => {
    const edit = { from: 0, to: bodyEnd, insert: '' };
    const after = applyChanges(before, trackedEdit(before, edit, context(ada, ['k3x9'])));
    expect(bodyText(after)).toBe(
      '<!--del k3x9 # Title\\n\\nFirst para here.\\n\\n- item one\\n- item two\\n\\n> A quote.\\n\\nLast para.-->',
    );
    expect(without(newestView(after).text)).toBe('');
    expect(bodyText(applyChanges(after, rejectAll(after)))).toBe(body);
  });

  it('is a deletion and an insertion when other people’s changes are in it', () => {
    const marked = file('One <!--ins k3x9-->two<!--/k3x9--> three.\n\nFour.', { k3x9: 'bo' });
    const edit: TextChange = { from: 0, to: marked.indexOf('\n\n<!-- redlines'), insert: 'New' };
    const after = applyChanges(marked, trackedEdit(marked, edit, context(ada, ['w2rf', 'w3rf'])));
    expect(parse(after).warnings).toEqual([]);
    expect(without(newestView(after).text)).toBe('New');
    expect(without(originalView(after).text)).toBe(without(originalView(marked).text));
    // Bo's insertion is still Bo's, and Ada's deletion of its text is inside it.
    expect(parse(after).marks.find((mark) => mark.id === 'k3x9')?.entry.by).toBe('bo');
  });
});

describe('Enter at every position (format §3.2)', () => {
  it('never leaves a marker at the start of a line, in the example of format §1.2', () => {
    const view = newestView(fixture);
    const was = parse(fixture).warnings.length;
    let done = 0;
    let refused = 0;
    for (const author of [ada, bo]) {
      for (const insert of ['\n', '\n\n']) {
        for (let at = 0; at <= view.text.length - 1; at++) {
          for (const side of [-1, 1] as const) {
            const source = view.map.toSource(at, side);
            try {
              const changes = trackedEdit(
                fixture,
                { from: source, to: source, insert },
                context(author, ['w8nn', 'p3qz']),
              );
              const after = applyChanges(fixture, changes);
              expect(
                parse(after).warnings.map((warning) => warning.code),
                `${author.handle} ${JSON.stringify(insert)} at ${at}: ${JSON.stringify(bodyOf(after))}`,
              ).toEqual(parse(fixture).warnings.map((warning) => warning.code));
              expect(parse(after).warnings.length).toBe(was);
              // The text is as it was, with the line break in it.
              expect(newestView(after).text.replace(/\s+/g, ' ')).toBe(
                `${view.text.slice(0, at)}${insert}${view.text.slice(at)}`.replace(/\s+/g, ' '),
              );
              done++;
            } catch (error) {
              if (!(error instanceof EditError) || error.code !== 'no-legal-placement') throw error;
              refused++;
            }
          }
        }
      }
    }
    // Most go through; the ones that do not are in front of a space and a marker.
    expect(done).toBeGreaterThan(refused * 5);
  });

  it('moves the line break past the opener that follows it, which stays on the line before', () => {
    // "the |new importer": the opener of Ada's insertion would start the new line.
    const body = 'We will ship the <!--ins k3x9-->new <!--/k3x9-->importer.';
    const before = file(body, { k3x9: 'ada' });
    const at = before.indexOf('<!--ins');
    for (const insert of ['\n', '\n\n']) {
      const changes = trackedEdit(before, { from: at, to: at, insert }, context(bo, ['s3vb']));
      const after = applyChanges(before, changes);
      expect(bodyText(after)).toBe(
        `We will ship the <!--ins k3x9--><!--split s3vb-->${insert}new <!--/k3x9-->importer.`,
      );
      expect(parse(after).warnings).toEqual([]);
      expect(bodyText(applyChanges(after, reject(after, 's3vb')))).toBe(bodyText(before));
      expect(bodyText(applyChanges(after, accept(after, 's3vb')))).toBe(
        `We will ship the <!--ins k3x9-->${insert}new <!--/k3x9-->importer.`,
      );
    }
  });

  it('puts the break after the closer that follows it, and after a deletion', () => {
    const body = 'after the <!--cmt c8d2-->review<!--/c8d2--> and <!--del w2rf now-->end.';
    const before = file(body, { w2rf: 'bo' }, [
      '  c8d2:',
      '    by: bo',
      '    at: 2026-10-13T22:40Z',
      '    text: |-',
      '      Why?',
    ]);
    const closer = before.indexOf('<!--/c8d2-->');
    const closed = applyChanges(
      before,
      trackedEdit(before, { from: closer, to: closer, insert: '\n' }, context(ada, ['s3vb'])),
    );
    expect(bodyText(closed)).toContain('review<!--/c8d2--><!--split s3vb-->\n and');
    const deletion = before.indexOf('<!--del');
    const deleted = applyChanges(
      before,
      trackedEdit(before, { from: deletion, to: deletion, insert: '\n' }, context(ada, ['s3vb'])),
    );
    expect(bodyText(deleted)).toContain('and <!--del w2rf now--><!--split s3vb-->\nend.');
    expect(parse(deleted).warnings).toEqual([]);
  });

  it('refuses a break in front of spaces and a marker, which would start the new line', () => {
    const before = file('the <!--ins k3x9-->new <!--/k3x9-->importer.', { k3x9: 'ada' });
    const at = before.indexOf(' <!--ins');
    expect(() => trackedEdit(before, { from: at, to: at, insert: '\n' }, context(bo))).toThrow(
      EditError,
    );
  });
});
