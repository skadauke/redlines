import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { addComment, deleteThread } from './comments.ts';
import { accept, acceptAll, reject, rejectAll } from './decide.ts';
import { EditError } from './errors.ts';
import { parse } from './parse.ts';
import { fuzzCount, randomDocument, seeded } from './random-docs.ts';
import {
  ada,
  bo,
  bodyOf,
  context,
  editedDocument,
  expectInOrder,
  expectNoNewLineStarts,
  file,
  fixture,
  idsOf,
  nestedInsertions,
  problemsOf,
  thread,
} from './test-helpers.ts';
import { trackedFormat } from './formatting.ts';
import { trackedEdit } from './track.ts';
import type { TextChange } from './types.ts';
import { newestView, originalView } from './views.ts';

/** The fixture's ledger line for a mark. */
const entryLine = (id: string) => fixture.match(new RegExp(`  ${id}: \\{[^\\n]*\\}\\n`))?.[0] ?? '';

describe('accept and reject on the example of format §1.2', () => {
  it('accepting an insertion removes its markers and keeps the text', () => {
    const result = applyChanges(fixture, accept(fixture, 'k3x9'));
    expect(result).toBe(
      fixture
        .replace('<!--ins k3x9-->', '')
        .replace('<!--/k3x9-->', '')
        .replace(entryLine('k3x9'), ''),
    );
    expect(bodyOf(result)).toContain('We will ship the new importer in <!--sub p7qd');
    expect(parse(result).ledger.marks['k3x9']).toBeUndefined();
    expect(parse(result).warnings).toEqual([]);
  });

  it('rejecting a substitution puts the old text back and leaves no markers', () => {
    const result = applyChanges(fixture, reject(fixture, 'p7qd'));
    expect(result).toBe(
      fixture
        .replace('<!--sub p7qd March-->April<!--/p7qd-->', 'March')
        .replace(entryLine('p7qd'), ''),
    );
    expect(bodyOf(result)).toContain('importer in March, after the');
    expect(idsOf(result)).toEqual(['k3x9', 'c8d2', 'w2rf']);
  });

  it('accepting a substitution keeps the new text', () => {
    const result = applyChanges(fixture, accept(fixture, 'p7qd'));
    expect(bodyOf(result)).toContain('importer in April, after the');
    expect(result).not.toContain('March');
  });

  it('accepting a deletion removes its marker', () => {
    const result = applyChanges(fixture, accept(fixture, 'w2rf'));
    expect(result).toBe(
      fixture
        .replace('<!--del w2rf  The old exporter stays as it is.-->', '')
        .replace(entryLine('w2rf'), ''),
    );
    expect(result).not.toContain('exporter');
  });

  it('rejecting a deletion puts its text back as plain text', () => {
    const result = applyChanges(fixture, reject(fixture, 'w2rf'));
    expect(result).toBe(
      fixture
        .replace(
          '<!--del w2rf  The old exporter stays as it is.-->',
          ' The old exporter stays as it is.',
        )
        .replace(entryLine('w2rf'), ''),
    );
    expect(bodyOf(result).endsWith('<!--/c8d2-->. The old exporter stays as it is.')).toBe(true);
  });

  it('rejecting an insertion removes it with its text', () => {
    const result = applyChanges(fixture, reject(fixture, 'k3x9'));
    expect(bodyOf(result)).toContain('We will ship the importer in <!--sub p7qd');
    expect(parse(result).ledger.marks['k3x9']).toBeUndefined();
  });

  it('accepts everything: the newest view stays, no change is left and the comment is kept', () => {
    const result = applyChanges(fixture, acceptAll(fixture));
    expect(newestView(result).text).toBe(newestView(fixture).text);
    expect(result).toBe(
      fixture
        .replace('<!--ins k3x9-->', '')
        .replace('<!--/k3x9-->', '')
        .replace('<!--sub p7qd March-->', '')
        .replace('<!--/p7qd-->', '')
        .replace('<!--del w2rf  The old exporter stays as it is.-->', '')
        .replace(`marks:\n${entryLine('k3x9')}${entryLine('p7qd')}${entryLine('w2rf')}`, ''),
    );
    const parsed = parse(result);
    expect(parsed.marks.map((m) => [m.id, m.kind])).toEqual([['c8d2', 'cmt']]);
    expect(parsed.ledger.comments.map((t) => t.id)).toEqual(['c8d2']);
    expect(parsed.ledger.marks).toEqual({});
    expect(parsed.warnings).toEqual([]);
  });

  it('rejects everything: the original view stays, no change is left and the comment is kept', () => {
    const result = applyChanges(fixture, rejectAll(fixture));
    expect(originalView(result).text).toBe(originalView(fixture).text);
    expect(bodyOf(result)).toBe(
      '# Launch plan\n\nWe will ship the importer in March, after the <!--cmt c8d2-->security review<!--/c8d2-->. The old exporter stays as it is.',
    );
    const parsed = parse(result);
    expect(parsed.marks.map((m) => m.id)).toEqual(['c8d2']);
    expect(parsed.ledger.marks).toEqual({});
    expect(parsed.warnings).toEqual([]);
  });

  it('decides only what the filter lets through', () => {
    const byAda = applyChanges(
      fixture,
      acceptAll(fixture, (m) => m.entry.by === 'ada'),
    );
    expect(idsOf(byAda)).toEqual(['p7qd', 'c8d2', 'w2rf']);
    const dels = applyChanges(
      fixture,
      rejectAll(fixture, (m) => m.kind === 'del'),
    );
    expect(idsOf(dels)).toEqual(['k3x9', 'p7qd', 'c8d2']);
    const agent = applyChanges(
      fixture,
      acceptAll(fixture, (m) => m.entry.by === 'claude-ada'),
    );
    expect(newestView(agent).text).toBe(newestView(fixture).text);
    expect(idsOf(agent)).toEqual(['k3x9', 'c8d2', 'w2rf']);
    expect(acceptAll(fixture, () => false)).toEqual([]);
  });

  it('gives no changes for a file without marks', () => {
    expect(acceptAll('# Notes\n\nPlain.\n')).toEqual([]);
    expect(rejectAll('# Notes\n\nPlain.\n')).toEqual([]);
  });
});

describe('format §3.6: an insertion that holds another person’s deletion', () => {
  const text = file('The <!--ins k3x9-->shiny <!--del b4rt very -->new <!--/k3x9-->importer', {
    k3x9: 'ada',
    b4rt: 'bo',
  });

  it('accepting the insertion makes it plain text and leaves the deletion pending', () => {
    const result = applyChanges(text, accept(text, 'k3x9'));
    expect(bodyOf(result)).toBe('The shiny <!--del b4rt very -->new importer');
    expect(Object.keys(parse(result).ledger.marks)).toEqual(['b4rt']);
  });

  it('rejecting the insertion removes everything inside it, the deletion too', () => {
    const result = applyChanges(text, reject(text, 'k3x9'));
    // Nothing is left to write: the ledger goes with its blank line.
    expect(result).toBe('The importer\n');
  });

  it('accepting the deletion drops its text from the insertion', () => {
    const result = applyChanges(text, accept(text, 'b4rt'));
    expect(bodyOf(result)).toBe('The <!--ins k3x9-->shiny new <!--/k3x9-->importer');
    expect(Object.keys(parse(result).ledger.marks)).toEqual(['k3x9']);
  });

  it('rejecting the deletion brings its text back inside the insertion', () => {
    const result = applyChanges(text, reject(text, 'b4rt'));
    expect(bodyOf(result)).toBe('The <!--ins k3x9-->shiny very new <!--/k3x9-->importer');
  });

  it('accepting everything or rejecting everything agrees with the views', () => {
    expect(applyChanges(text, acceptAll(text))).toBe('The shiny new importer\n');
    expect(applyChanges(text, rejectAll(text))).toBe('The importer\n');
    expect(newestView(text).text).toBe('The shiny new importer\n');
    expect(originalView(text).text).toBe('The importer\n');
  });

  it('removes a change that sits inside a rejected one only once', () => {
    const changes = rejectAll(text);
    const closer = '<!--/k3x9-->';
    // One change for the insertion with the deletion inside it, and one for the empty ledger.
    expect(changes).toHaveLength(2);
    expect(changes[0]).toEqual({
      from: text.indexOf('<!--ins k3x9-->'),
      to: text.indexOf(closer) + closer.length,
      insert: '',
    });
    expect(applyChanges(text, changes)).toBe('The importer\n');
  });
});

describe('marks in several segments', () => {
  it('rejects a deletion that is split around another deletion', () => {
    const text = file(
      'Ship <!--del b4rt the old --><!--del c2zf legacy --><!--del b4rt exporter -->now.',
      { b4rt: 'bo', c2zf: 'ada' },
    );
    expect(bodyOf(applyChanges(text, reject(text, 'b4rt')))).toBe(
      'Ship the old <!--del c2zf legacy -->exporter now.',
    );
    expect(bodyOf(applyChanges(text, accept(text, 'b4rt')))).toBe(
      'Ship <!--del c2zf legacy -->now.',
    );
    expect(bodyOf(applyChanges(text, reject(text, 'c2zf')))).toBe(
      'Ship <!--del b4rt the old -->legacy <!--del b4rt exporter -->now.',
    );
  });

  it('decides an insertion that another insertion split', () => {
    const text = file(
      'The <!--ins k3x9-->shiny <!--/k3x9--><!--ins w8nn-->and fast <!--/w8nn--><!--ins k3x9-->importer<!--/k3x9-->',
      { k3x9: 'ada', w8nn: 'bo' },
    );
    expect(bodyOf(applyChanges(text, accept(text, 'k3x9')))).toBe(
      'The shiny <!--ins w8nn-->and fast <!--/w8nn-->importer',
    );
    expect(bodyOf(applyChanges(text, reject(text, 'k3x9')))).toBe(
      'The <!--ins w8nn-->and fast <!--/w8nn-->',
    );
    expect(bodyOf(applyChanges(text, reject(text, 'w8nn')))).toBe(
      'The <!--ins k3x9-->shiny <!--/k3x9--><!--ins k3x9-->importer<!--/k3x9-->',
    );
  });

  it('decides a substitution that was split around an insertion', () => {
    const text = file(
      'a <!--sub p7qd Mar-->Apr<!--/p7qd--><!--ins k3x9-->x<!--/k3x9--><!--sub p7qd ch-->il<!--/p7qd--> b',
      { p7qd: 'bo', k3x9: 'ada' },
    );
    expect(bodyOf(applyChanges(text, reject(text, 'p7qd')))).toBe(
      'a Mar<!--ins k3x9-->x<!--/k3x9-->ch b',
    );
    expect(bodyOf(applyChanges(text, accept(text, 'p7qd')))).toBe(
      'a Apr<!--ins k3x9-->x<!--/k3x9-->il b',
    );
  });
});

describe('highlights', () => {
  const text = file('a <!--hl h4kz-->b<!--/h4kz--> c', { h4kz: 'bo' });

  it('are dismissed by accepting or rejecting them, and the text stays', () => {
    for (const decide of [accept, reject]) {
      const result = applyChanges(text, decide(text, 'h4kz'));
      expect(result).toBe('a b c\n');
    }
  });

  it('are left alone by accept all and reject all', () => {
    expect(acceptAll(text)).toEqual([]);
    expect(rejectAll(text)).toEqual([]);
  });
});

describe('what can not be decided', () => {
  it('throws for a comment', () => {
    expect(() => accept(fixture, 'c8d2')).toThrow(EditError);
    expect(() => reject(fixture, 'c8d2')).toThrow(EditError);
  });

  it('throws for an id that is not in the file', () => {
    expect(() => accept(fixture, 'zzzz')).toThrow(EditError);
    expect(() => accept(fixture, 'zzzz')).toThrow('There is no change with the id zzzz.');
    expect(() => reject('plain', 'k3x9')).toThrow(EditError);
  });

  it('throws "not supported in v0.1" for table marks and moves', () => {
    const text = file('| a | <!--ins k3x9 row--> d | <!--del g5nb row=2 \\| x-->', {
      k3x9: 'ada',
      g5nb: 'ada',
    });
    for (const id of ['k3x9', 'g5nb']) {
      expect(() => accept(text, id)).toThrow(EditError);
      expect(() => reject(text, id)).toThrow('not supported in v0.1');
    }
    const at = 'at: 2026-10-13T22:30Z';
    const moved = file('a <!--del m4vf x-->b <!--ins n5vt-->x<!--/n5vt-->', {
      m4vf: 'ada',
      n5vt: 'ada',
    })
      .replace(`m4vf: {by: ada, ${at}}`, `m4vf: {by: ada, ${at}, move: n5vt}`)
      .replace(`n5vt: {by: ada, ${at}}`, `n5vt: {by: ada, ${at}, move: m4vf}`);
    for (const id of ['m4vf', 'n5vt']) expect(() => accept(moved, id)).toThrow('not supported');
    // Accept all and reject all decide what they can and leave the rest pending.
    for (const decideAll of [acceptAll, rejectAll]) {
      expect(applyChanges(moved, decideAll(moved))).toBe(moved);
      expect(applyChanges(text, decideAll(text))).toBe(text);
    }
  });
});

/** The body of a file, without the line break that ends it. */
const bodyText = (text: string) => bodyOf(text).replace(/[\r\n]+$/, '');

describe('a split, which is an inserted break (format §3.4)', () => {
  const cases: [string, string, string][] = [
    // The body, then the body after accepting and after rejecting.
    ['First.<!--split s3vb-->\n\nSecond.', 'First.\n\nSecond.', 'First.Second.'],
    ['- one<!--split s3vb-->\n- two', '- one\n- two', '- onetwo'],
    ['> one<!--split s3vb-->\n>\n> two', '> one\n>\n> two', '> onetwo'],
    ['A<!--split s3vb-->\n\n## Heading', 'A\n\n## Heading', 'AHeading'],
    ['one<!--split s3vb-->\n two', 'one\n two', 'one two'],
  ];

  it('is accepted by leaving the break, and rejected by taking the break away', () => {
    for (const [body, accepted, rejected] of cases) {
      const text = file(body, { s3vb: 'ada' });
      expect(bodyText(applyChanges(text, accept(text, 's3vb'))), body).toBe(accepted);
      expect(bodyText(applyChanges(text, reject(text, 's3vb'))), body).toBe(rejected);
      expect(parse(applyChanges(text, reject(text, 's3vb'))).ledger.marks['s3vb']).toBeUndefined();
    }
  });

  it('is decided by accept all and reject all, like any change', () => {
    const text = file('One<!--split s3vb-->\n\nTwo<!--split w8nn-->\n\nThree', {
      s3vb: 'ada',
      w8nn: 'bo',
    });
    expect(bodyText(applyChanges(text, acceptAll(text)))).toBe('One\n\nTwo\n\nThree');
    expect(bodyText(applyChanges(text, rejectAll(text)))).toBe('OneTwoThree');
    expect(
      bodyText(
        applyChanges(
          text,
          rejectAll(text, (m) => m.entry.by === 'bo'),
        ),
      ),
    ).toBe('One<!--split s3vb-->\n\nTwoThree');
  });

  it('goes with an insertion that holds it, when that is rejected', () => {
    const text = file('a <!--ins k3x9-->b<!--split s3vb-->\n\nc<!--/k3x9--> d', {
      k3x9: 'ada',
      s3vb: 'ada',
    });
    const result = applyChanges(text, reject(text, 'k3x9'));
    expect(bodyText(result)).toBe('a  d');
    expect(parse(result).ledger.marks).toEqual({});
  });

  it('is decided with the file’s line breaks', () => {
    const text = file('One<!--split s3vb-->\n\nTwo', { s3vb: 'ada' }).replaceAll('\n', '\r\n');
    expect(bodyText(applyChanges(text, reject(text, 's3vb')))).toBe('OneTwo');
  });
});

describe('the carrier of an opener that stands alone before a block (format §3.3)', () => {
  it('goes when the mark is accepted, and when the insertion is rejected', () => {
    const text = file('Para.\n\n<!--ins k3x9-->\n\nNew start.<!--/k3x9-->\n\nEnd.', {
      k3x9: 'ada',
    });
    expect(bodyText(applyChanges(text, accept(text, 'k3x9')))).toBe('Para.\n\nNew start.\n\nEnd.');
    expect(bodyText(applyChanges(text, reject(text, 'k3x9')))).toBe('Para.\n\n\n\nEnd.');
  });

  it('goes when a deletion is decided: the text comes back where the block starts', () => {
    const text = file('<!--del t6wv Note: -->\n\nThe importer ships in April.', { t6wv: 'ada' });
    expect(bodyText(applyChanges(text, accept(text, 't6wv')))).toBe('The importer ships in April.');
    expect(bodyText(applyChanges(text, reject(text, 't6wv')))).toBe(
      'Note: The importer ships in April.',
    );
  });

  it('goes with a substitution and in a list item or a quote', () => {
    const sub = file('- one\n- <!--sub p7qd two-->\n  three<!--/p7qd-->', { p7qd: 'ada' });
    expect(bodyText(applyChanges(sub, reject(sub, 'p7qd')))).toBe('- one\n- two');
    expect(bodyText(applyChanges(sub, accept(sub, 'p7qd')))).toBe('- one\n- three');
    const quote = file('> <!--del t6wv Note: -->\n> The importer.', { t6wv: 'ada' });
    expect(bodyText(applyChanges(quote, reject(quote, 't6wv')))).toBe('> Note: The importer.');
  });
});

describe('a decision leaves the view it decides toward as it is (format §3.4)', () => {
  // `*` followed by a marker is text; with the marker gone, `* ` is a bullet, and the break of the
  // split in front of it would take it: rejecting the split would take text that is not its own.
  const text = file('One<!--split s3vb-->\n*<!--hl h4kz--> two<!--/h4kz-->', {
    s3vb: 'ada',
    h4kz: 'bo',
  });

  it('refuses to dismiss the highlight that kept the star from being a bullet', () => {
    expect(() => reject(text, 'h4kz')).toThrow(EditError);
    expect(() => accept(text, 'h4kz')).toThrow(EditError);
    // The split can be decided first.
    const first = applyChanges(text, reject(text, 's3vb'));
    expect(bodyText(first)).toBe('One*<!--hl h4kz--> two<!--/h4kz-->');
    expect(bodyText(applyChanges(first, reject(first, 'h4kz')))).toBe('One* two');
  });

  it('refuses to delete the thread of a comment that kept it', () => {
    const commented = file(
      'One<!--split s3vb-->\n*<!--cmt c8d2--> two<!--/c8d2-->',
      { s3vb: 'ada' },
      thread('c8d2', 'bo'),
    );
    expect(() => deleteThread(commented, 'c8d2')).toThrow(EditError);
  });

  it('decides a mark that leaves the break as it was', () => {
    const other = file('One<!--split s3vb-->\nplain<!--hl h4kz--> two<!--/h4kz-->', {
      s3vb: 'ada',
      h4kz: 'bo',
    });
    const result = applyChanges(other, reject(other, 'h4kz'));
    expect(bodyText(result)).toBe('One<!--split s3vb-->\nplain two');
    expect(bodyText(applyChanges(result, reject(result, 's3vb')))).toBe('Oneplain two');
  });
});

describe('accepting a split does not make its break the carrier of an opener (format §3.3)', () => {
  // Enter at the start of the text of a list item that a comment or a highlight starts at: the
  // split is written after the opener, so that none starts the new line. When the split is
  // accepted, the opener is the last thing on the line of the bullet, and the line break after it
  // would be read as its carrier, which no view shows: the item and the text after it would join.
  for (const [kind, id, marks, threads] of [
    ['a comment', 'c8d2', { s3vb: 'ada' }, thread('c8d2', 'bo', 'Which key?')],
    ['a highlight', 'h4kz', { s3vb: 'ada', h4kz: 'bo' }, []],
  ] as const) {
    const open = kind === 'a comment' ? `<!--cmt ${id}-->` : `<!--hl ${id}-->`;
    for (const brk of ['\n', '\n2. ']) {
      it(`keeps the break behind ${kind} on a bullet (${JSON.stringify(brk)})`, () => {
        const text = file(
          `1. ${open}<!--split s3vb-->${brk}Enter twice<!--/${id}--> to start.\n2. Second.`,
          marks,
          [...threads],
        );
        expect(parse(text).warnings).toEqual([]);
        const view = newestView(text).text;
        for (const changes of [accept(text, 's3vb'), acceptAll(text)]) {
          const result = applyChanges(text, changes);
          expect(parse(result).warnings).toEqual([]);
          expect(newestView(result).text).toBe(view);
          // The mark is still there, on the same words.
          expect(parse(result).marks.map((mark) => mark.id)).toContain(id);
        }
        const rejected = applyChanges(text, reject(text, 's3vb'));
        expect(parse(rejected).warnings).toEqual([]);
        expect(newestView(rejected).text).toBe('1. Enter twice to start.\n2. Second.\n');
      });
    }
  }

  it('is refused for a mark that is not a comment or a highlight, which a move would change', () => {
    // Bo’s insertion starts at the item; accepting only the split would leave its opener last on
    // the line of the bullet.
    const text = file('1. <!--ins k3x9--><!--split s3vb-->\nEnter twice<!--/k3x9--> to start.', {
      s3vb: 'ada',
      k3x9: 'bo',
    });
    expect(() => accept(text, 's3vb')).toThrow(EditError);
    // Deciding both works.
    const all = applyChanges(text, acceptAll(text));
    expect(newestView(all).text).toBe(newestView(text).text);
  });
});

describe('a decision leaves no marker at the start of a line (format §3.2, §3.3)', () => {
  // The second review of #15: Bo comments on two paragraphs, Ada deletes the second. The closer of
  // the comment stands in front of the opener of the deletion's second segment, which carries the
  // break in front of `End.`.
  const edited = file(
    '<!--cmt c8d2-->\n\nPara A.\n\n<!--del w2rf Para B.-->\n\n<!--/c8d2--><!--del w2rf \\n\\n-->\n\nEnd.',
    { w2rf: 'ada' },
    thread('c8d2', 'bo'),
  );

  it('moves the closer back to the end of the line before when the opener that kept it off goes', () => {
    expect(parse(edited).warnings).toEqual([]);
    for (const changes of [accept(edited, 'w2rf'), acceptAll(edited)]) {
      const result = applyChanges(edited, changes);
      expect(bodyText(result)).toBe('<!--cmt c8d2-->\n\nPara A.<!--/c8d2-->\n\nEnd.');
      expect(parse(result).warnings).toEqual([]);
      // The text and the comment on it are as they were.
      expect(newestView(result).text).toBe(newestView(edited).text);
      expect(parse(result).marks.map((m) => m.id)).toEqual(['c8d2']);
    }
  });

  it('brings the text back with the closer after it when the deletion is rejected', () => {
    for (const changes of [reject(edited, 'w2rf'), rejectAll(edited)]) {
      const result = applyChanges(edited, changes);
      expect(bodyText(result)).toBe('<!--cmt c8d2-->\n\nPara A.\n\nPara B.<!--/c8d2-->\n\nEnd.');
      expect(parse(result).warnings).toEqual([]);
    }
  });

  it('refuses a decision whose closer would need a line of its own, which the view has not', () => {
    // Bo's insertion k3x9 is inside the paragraph Ada deleted: when the deletion is accepted the
    // insertion has no text, and its closer would start the line of `**End**`. A line of its own
    // would add a blank line to the newest view, so it waits for the insertion to be decided.
    const text = file(
      'Intro.\n\n<!--del w2rf The old -->\n\n<!--ins k3x9-->\n\n<!--del w2rf very -->\n\n' +
        '<!--/k3x9--><!--del w2rf exporter stays.\\n\\n-->\n\n**End** of the file.',
      { w2rf: 'ada', k3x9: 'bo' },
    );
    expect(parse(text).warnings).toEqual([]);
    expect(() => accept(text, 'w2rf')).toThrow(/would change the newest text/);
    for (const decided of [accept(text, 'k3x9'), reject(text, 'k3x9')]) {
      const first = applyChanges(text, decided);
      const result = applyChanges(first, accept(first, 'w2rf'));
      expect(bodyText(result)).toBe('Intro.\n\n**End** of the file.');
      expect(parse(result).warnings).toEqual([]);
    }
    // Accepting Bo's insertion as well leaves nothing of it.
    const all = applyChanges(text, acceptAll(text));
    expect(bodyText(all)).toBe('Intro.\n\n**End** of the file.');
    expect(parse(all).warnings).toEqual([]);
  });

  it('does not leave the bullet of a list item alone on its line', () => {
    // The closer of Bo's insertion would start the line of `five`, and a break after it would leave
    // the bullet alone in both views: the deletion can not be accepted before the insertion is
    // decided, and nothing is written until then.
    const text = file(
      '- one\n- <!--del w2rf two -->\n  <!--ins k3x9-->\n  <!--del w2rf three-->\n' +
        '  <!--/k3x9--><!--del w2rf  four\\n- -->\n  five',
      { w2rf: 'ada', k3x9: 'bo' },
    );
    expect(parse(text).warnings).toEqual([]);
    expect(() => accept(text, 'w2rf')).toThrow(EditError);
    try {
      accept(text, 'w2rf');
    } catch (error) {
      expect(error instanceof EditError && error.code).toBe('no-legal-placement');
    }
    // Deciding Bo's insertion first, or both, works.
    const first = applyChanges(text, accept(text, 'k3x9'));
    const then = applyChanges(first, accept(first, 'w2rf'));
    expect(bodyText(then)).toBe('- one\n- five');
    expect(parse(then).warnings).toEqual([]);
    expect(bodyText(applyChanges(text, acceptAll(text)))).toBe('- one\n- five');
  });

  it('does the same when a thread is deleted, whose opener carried a break', () => {
    // The comment c8d2 ends where the comment c9qf starts a block.
    const threads = [...thread('c8d2'), ...thread('c9qf', 'bo', 'Another.')];
    const text = file(
      '<!--cmt c8d2-->\n\nPara A.\n\n<!--/c8d2--><!--cmt c9qf-->\n\nPara B.<!--/c9qf-->',
      {},
      threads,
    );
    expect(parse(text).warnings).toEqual([]);
    const result = applyChanges(text, deleteThread(text, 'c9qf'));
    expect(parse(result).warnings).toEqual([]);
    expect(bodyText(result)).toBe('<!--cmt c8d2-->\n\nPara A.<!--/c8d2-->\n\nPara B.');
    expect(newestView(result).text).toBe(newestView(text).text);
  });
});

describe('when a decision would hide another change', () => {
  // Rejecting the deletion brings a backtick back that pairs with the one before "bar" and puts
  // Bo's insertion into a code span.
  const text = file('Use the `bar and <!--ins k3x9-->more<!--/k3x9--> end<!--del b4rt \\x60-->.', {
    k3x9: 'bo',
    b4rt: 'ada',
  });

  it('refuses a rejection that restores a backtick around a change', () => {
    expect(() => reject(text, 'b4rt')).toThrow(EditError);
    try {
      reject(text, 'b4rt');
    } catch (error) {
      expect((error as EditError).code).toBe('would-hide-marks');
    }
    expect(() => rejectAll(text, (m) => m.id === 'b4rt')).toThrow('Accept or reject them first');
    // Rejecting both takes Bo's insertion away on purpose, so nothing is hidden.
    expect(applyChanges(text, rejectAll(text))).toBe('Use the `bar and  end`.\n');
  });

  it('accepts, and rejects the other change, without a problem', () => {
    const accepted = applyChanges(text, accept(text, 'b4rt'));
    expect(parse(accepted).marks.map((m) => m.id)).toEqual(['k3x9']);
    const rejected = applyChanges(text, reject(text, 'k3x9'));
    expect(parse(rejected).marks.map((m) => m.id)).toEqual(['b4rt']);
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

  it('says why a change can not be decided', () => {
    expect(codeOf(() => accept(fixture, 'zzzz'))).toBe('unknown-id');
    expect(codeOf(() => accept(fixture, 'c8d2'))).toBe('not-supported');
    const fmt = file('a <!--fmt m2bd +mark-->==b==<!--/m2bd--> c', { m2bd: 'ada' });
    expect(codeOf(() => reject(fmt, 'm2bd'))).toBe('not-supported');
    const broken =
      'a <!--ins k3x9-->b<!--/k3x9-->\n\n<!-- redlines\nversion: 1\npeople: {ada: {name: Ada\n-->\n';
    expect(codeOf(() => accept(broken, 'k3x9'))).toBe('unreadable-ledger');
  });
});

describe('line breaks', () => {
  it('writes restored text with the line breaks of the file', () => {
    // The ledger is empty once the deletion is rejected, so it goes; the final line break stays.
    const lf = file('x <!--del k3x9 a\\nb\\n\\nc-->y', { k3x9: 'ada' });
    expect(applyChanges(lf, reject(lf, 'k3x9'))).toBe('x a\nb\n\ncy\n');
    const crlf = lf.replaceAll('\n', '\r\n');
    const result = applyChanges(crlf, reject(crlf, 'k3x9'));
    expect(result).toBe('x a\r\nb\r\n\r\ncy\r\n');
    // With a ledger left, the body is the same.
    const kept = file('x <!--del k3x9 a\\nb\\n\\nc-->y <!--del w8nn z-->', {
      k3x9: 'ada',
      w8nn: 'bo',
    }).replaceAll('\n', '\r\n');
    const keptResult = applyChanges(kept, reject(kept, 'k3x9'));
    expect(bodyOf(keptResult)).toBe('x a\r\nb\r\n\r\ncy <!--del w8nn z-->');
    expect(keptResult.replaceAll('\r\n', '')).not.toContain('\n');
  });

  it('restores emoji, combining characters and text that needed escapes', () => {
    const deleted = 'café é 😀 -- `x` | {{y}}\\';
    const text = file('a <!--del k3x9 café é 😀 -\\- \\x60x\\x60 \\| {\\{y}}\\\\-->b', {
      k3x9: 'ada',
    });
    expect(applyChanges(text, reject(text, 'k3x9'))).toBe(`a ${deleted}b\n`);
  });
});

describe('comments and highlights where a change is decided', () => {
  const threads = [...thread('c8d2'), ...thread('c9qf', 'bo', 'Another.')];

  it('turns a comment on a rejected insertion into a point comment', () => {
    const text = file(
      'a <!--ins k3x9-->b <!--cmt c8d2-->c<!--/c8d2--> d<!--/k3x9--> e',
      { k3x9: 'ada' },
      threads,
    );
    const result = applyChanges(text, reject(text, 'k3x9'));
    expect(bodyOf(result)).toBe('a <!--cmt c8d2--> e');
    expect(parse(result).ledger.comments.map((t) => t.id)).toEqual(['c8d2', 'c9qf']);
    expect(parse(result).marks.map((m) => m.id)).toEqual(['c8d2']);
  });

  it('empties a comment on a sentence that stood behind the opener of a rejected insertion', () => {
    // The repro of the review: Ada types a sentence at the start of a paragraph, Bo comments on it,
    // and Ada rejects her insertion. The comment's opener has a line of its own, and the comment
    // covered nothing but the sentence, so it is a point comment now and not a range over nothing.
    const start = file('Intro.\n\n**The rest** of the paragraph, with *emphasis*.');
    const at = start.indexOf('**The rest');
    const typed = applyChanges(
      start,
      trackedEdit(start, { from: at, to: at, insert: 'A new sentence.' }, context(ada, ['k3x9'])),
    );
    const view = newestView(typed);
    const from = view.map.toSource(view.text.indexOf('A new'), 1);
    const to = view.map.toSource(view.text.indexOf('A new') + 'A new sentence.'.length, -1);
    const commented = applyChanges(
      typed,
      addComment(typed, { from, to }, 'Why?', context(bo, ['c8d2'])).changes,
    );
    expect(parse(commented).warnings).toEqual([]);
    const result = applyChanges(commented, reject(commented, 'k3x9'));
    expect(bodyOf(result)).toBe(
      'Intro.\n\n<!--cmt c8d2-->\n\n**The rest** of the paragraph, with *emphasis*.',
    );
    expect(parse(result).warnings).toEqual([]);
    expect(parse(result).ledger.comments.map((t) => t.id)).toEqual(['c8d2']);
    // Accepting it instead keeps the comment on the sentence.
    const accepted = applyChanges(commented, accept(commented, 'k3x9'));
    expect(bodyOf(accepted)).toContain('A new sentence.<!--/c8d2-->');
  });

  it('turns a comment on a deletion that is accepted into a point comment', () => {
    const text = file(
      'a <!--cmt c8d2--><!--del b4rt Uptime target is 99.9%.--><!--/c8d2--> b',
      { b4rt: 'bo' },
      threads,
    );
    expect(bodyOf(applyChanges(text, accept(text, 'b4rt')))).toBe('a <!--cmt c8d2--> b');
    // Rejecting it brings the text back under the comment.
    expect(bodyOf(applyChanges(text, reject(text, 'b4rt')))).toBe(
      'a <!--cmt c8d2-->Uptime target is 99.9%.<!--/c8d2--> b',
    );
  });

  it('keeps the part of a comment that lies outside a rejected insertion', () => {
    const opens = file(
      '<!--ins k3x9-->ab<!--cmt c8d2-->cd<!--/k3x9-->ef<!--/c8d2-->',
      { k3x9: 'ada' },
      threads,
    );
    expect(bodyOf(applyChanges(opens, reject(opens, 'k3x9')))).toBe(
      '<!--cmt c8d2-->\n\nef<!--/c8d2-->',
    );
    const closes = file(
      '<!--cmt c8d2-->ab<!--ins k3x9-->cd<!--/c8d2-->ef<!--/k3x9-->',
      { k3x9: 'ada' },
      threads,
    );
    expect(bodyOf(applyChanges(closes, reject(closes, 'k3x9')))).toBe(
      '<!--cmt c8d2-->ab<!--/c8d2-->',
    );
  });

  it('keeps a point comment inside a rejected insertion', () => {
    const text = file('a<!--ins k3x9-->b<!--cmt c9qf-->c<!--/k3x9-->', { k3x9: 'ada' }, threads);
    const result = applyChanges(text, reject(text, 'k3x9'));
    expect(bodyOf(result)).toBe('a<!--cmt c9qf-->');
    expect(parse(result).warnings.map((w) => w.code)).toEqual(['orphan-thread']);
  });

  it('drops a segment of a comment that no longer covers anything, when another remains', () => {
    const text = file(
      '<!--cmt c8d2-->one<!--/c8d2--> <!--ins k3x9--><!--cmt c8d2-->two<!--/c8d2--><!--/k3x9--> three',
      { k3x9: 'ada' },
      threads,
    );
    const result = applyChanges(text, reject(text, 'k3x9'));
    expect(bodyOf(result)).toBe('<!--cmt c8d2-->one<!--/c8d2-->  three');
  });

  it('turns every emptied segment into one point when nothing else remains', () => {
    const text = file(
      '<!--ins k3x9--><!--cmt c8d2-->one<!--/c8d2--><!--/k3x9--> x <!--ins w8nn--><!--cmt c8d2-->two<!--/c8d2--><!--/w8nn-->',
      { k3x9: 'ada', w8nn: 'ada' },
      threads,
    );
    const result = applyChanges(text, rejectAll(text));
    expect(bodyOf(result)).toBe('<!--cmt c8d2-->\n\n x ');
  });

  it('removes a highlight that covered only rejected text, and its entry', () => {
    const text = file('a<!--ins k3x9-->b<!--hl h4kz-->c<!--/h4kz-->d<!--/k3x9-->', {
      k3x9: 'ada',
      h4kz: 'bo',
    });
    const result = applyChanges(text, reject(text, 'k3x9'));
    expect(result).toBe('a\n');
    const keep = file('a<!--ins k3x9-->b<!--hl h4kz-->c<!--/k3x9-->d<!--/h4kz-->', {
      k3x9: 'ada',
      h4kz: 'bo',
    });
    expect(bodyOf(applyChanges(keep, reject(keep, 'k3x9')))).toBe('a<!--hl h4kz-->d<!--/h4kz-->');
  });

  it('collapses a comment whose only content was a highlight that was emptied', () => {
    const text = file(
      'x<!--cmt c8d2--><!--hl h4kz--><!--del b4rt gone--><!--/h4kz--><!--/c8d2-->y',
      { h4kz: 'ada', b4rt: 'bo' },
      threads,
    );
    expect(bodyOf(applyChanges(text, accept(text, 'b4rt')))).toBe('x<!--cmt c8d2-->y');
  });

  it('leaves a comment range that was empty before alone', () => {
    const text = file('a <!--cmt c8d2--><!--/c8d2--> <!--del b4rt x-->b', { b4rt: 'bo' }, threads);
    expect(bodyOf(applyChanges(text, accept(text, 'b4rt')))).toBe(
      'a <!--cmt c8d2--><!--/c8d2--> b',
    );
  });
});

describe('the ledger', () => {
  it('is written in document order, without the entries of marks that are gone', () => {
    const text = file(
      '<!--ins w8nn-->a<!--/w8nn--> <!--ins k3x9-->b<!--/k3x9--> <!--del p7qd c-->',
      {
        k3x9: 'ada',
        p7qd: 'bo',
        w8nn: 'ada',
        m2bd: 'bo',
      },
    );
    const result = applyChanges(text, accept(text, 'k3x9'));
    expect(Object.keys(parse(result).ledger.marks)).toEqual(['w8nn', 'p7qd']);
  });

  it('keeps a thread whose anchor is gone, and the people', () => {
    const text = file('<!--del b4rt x-->a', { b4rt: 'bo' }, [...thread('c9qf'), ...thread('c8d2')]);
    const result = applyChanges(text, accept(text, 'b4rt'));
    expect(parse(result).ledger.comments.map((t) => t.id)).toEqual(['c9qf', 'c8d2']);
    expect(parse(result).ledger.people.map((p) => p.handle)).toEqual(['ada', 'bo']);
  });

  it('is left alone, with an error, when it can not be read', () => {
    const broken =
      'a <!--ins k3x9-->b<!--/k3x9-->\n\n<!-- redlines\nversion: 1\npeople: {ada: {name: Ada\nmarks:\n  k3x9: {by: ada}\n-->\n';
    expect(() => accept(broken, 'k3x9')).toThrow(EditError);
    expect(() => reject(broken, 'k3x9')).toThrow("can't be read");
    expect(() => acceptAll(broken)).toThrow(EditError);
    expect(() => rejectAll(broken)).toThrow(EditError);
  });

  it('keeps the settings and the fields it does not know', () => {
    const text = file('a <!--ins k3x9-->b<!--/k3x9-->', { k3x9: 'ada' }).replace(
      'version: 1\n',
      'version: 1\ntracking: everyone\n',
    );
    const result = applyChanges(text, accept(text, 'k3x9'));
    expect(parse(result).ledger.tracking).toBe('everyone');
    expect(bodyOf(result)).toBe('a b');
  });
});

describe('on random documents', { timeout: 600_000 }, () => {
  const seeds = Array.from({ length: fuzzCount(150) }, (_, i) => i + 1);
  const documents = seeds.map((seed) => {
    const text = randomDocument(seeded(seed));
    const parsed = parse(text);
    return {
      seed,
      text,
      parsed,
      threads: parsed.ledger.comments.map((t) => t.id),
      newest: newestView(text).text,
      original: originalView(text).text,
    };
  });
  const isChange = (kind: string) => kind === 'ins' || kind === 'del' || kind === 'sub';

  it('has documents of its own that are in order, and holds every kind of mark', () => {
    const kinds = new Set<string>();
    for (const { seed, text, parsed } of documents) {
      expect(problemsOf(parsed), `seed ${seed}`).toEqual([]);
      expect(nestedInsertions(parsed), `seed ${seed}`).toEqual([]);
      for (const mark of parse(text).marks) kinds.add(mark.kind);
    }
    expect([...kinds].sort()).toEqual(['cmt', 'del', 'hl', 'ins', 'sub']);
  });

  it('accepting a change keeps the newest view and rejecting one keeps the original view', () => {
    let decisions = 0;
    for (const { seed, text, parsed, threads, newest, original } of documents) {
      for (const mark of parsed.marks) {
        if (mark.kind === 'cmt') continue;
        const label = `seed ${seed}, ${mark.kind} ${mark.id}`;
        const accepted = applyChanges(text, accept(text, mark.id));
        expect(newestView(accepted).text, `${label} accepted`).toBe(newest);
        const kept = expectInOrder(`${label} accepted`, threads, accepted).marks.map((m) => m.id);
        expect(kept, `${label}: still there`).not.toContain(mark.id);
        // Nothing but this change (and a highlight it emptied) is gone.
        for (const other of parsed.marks) {
          if (other.id !== mark.id && other.kind !== 'hl') {
            expect(kept, `${label} accepted: ${other.id} is kept`).toContain(other.id);
          }
        }

        const rejected = applyChanges(text, reject(text, mark.id));
        expect(originalView(rejected).text, `${label} rejected`).toBe(original);
        expectInOrder(`${label} rejected`, threads, rejected);
        decisions += 2;
      }
    }
    expect(decisions).toBeGreaterThan(1000);
  });

  it('accepting all keeps the newest view, rejecting all keeps the original view', () => {
    for (const { seed, text, threads, newest, original } of documents) {
      const label = `seed ${seed}`;
      const accepted = applyChanges(text, acceptAll(text));
      expect(newestView(accepted).text, `${label} accepted`).toBe(newest);
      expect(originalView(accepted).text, `${label} accepted`).toBe(newest);
      const left = expectInOrder(`${label} accepted`, threads, accepted);
      expect(
        left.marks.filter((m) => isChange(m.kind)),
        `${label} accepted: changes left`,
      ).toEqual([]);

      const rejected = applyChanges(text, rejectAll(text));
      expect(originalView(rejected).text, `${label} rejected`).toBe(original);
      expect(newestView(rejected).text, `${label} rejected`).toBe(original);
      const rest = expectInOrder(`${label} rejected`, threads, rejected);
      expect(
        rest.marks.filter((m) => isChange(m.kind)),
        `${label} rejected: changes left`,
      ).toEqual([]);
    }
  });

  it('decides what a filter lets through, and nothing else', () => {
    for (const { seed, text, threads, newest, original } of documents.slice(0, 50)) {
      for (const handle of ['ada', 'bo', 'claude-ada']) {
        const label = `seed ${seed} ${handle}`;
        const accepted = applyChanges(
          text,
          acceptAll(text, (m) => m.entry.by === handle),
        );
        expect(newestView(accepted).text, label).toBe(newest);
        expectInOrder(`${label} accepted`, threads, accepted);
        const rejected = applyChanges(
          text,
          rejectAll(text, (m) => m.entry.by === handle),
        );
        expect(originalView(rejected).text, label).toBe(original);
        expectInOrder(`${label} rejected`, threads, rejected);
      }
    }
  });
});

/** The text of a view without its white space and quote markers: a decision that gives a closer a
 * line of its own adds a break, with the `>` of the quote it is in, and a break that is restored
 * next to an opener on its line is read as the carrier of that opener (format §3.3), which a view
 * hides. Neither loses or moves text. */
const words = (text: string) => text.replace(/[\s>]+/g, '');

describe('on documents that were edited', { timeout: 600_000 }, () => {
  // Random documents after random tracked edits have what the documents of `randomDocument` do not:
  // whole-block insertions and deletions, splits, and closers in front of the opener of the next
  // block. Every decision on them must leave the text and the placement of the markers right.
  it('leaves no more markers at the start of a line, and the text as it was', () => {
    let decisions = 0;
    let refused = 0;
    let withClosers = 0;
    for (let seed = 1; seed <= fuzzCount(40); seed++) {
      const text = editedDocument(seed, 5);
      const parsed = parse(text);
      const threads = parsed.ledger.comments.map((t) => t.id);
      const newest = words(newestView(text).text);
      const original = words(originalView(text).text);
      if (/<!--\/[a-z0-9]{4}--><!--[a-z]+ [a-z0-9]{4}[^>]*-->\n/.test(bodyOf(text))) withClosers++;
      const todo: [string, 'accept' | 'reject', () => TextChange[]][] = [];
      for (const mark of parsed.marks) {
        if (mark.kind === 'cmt') {
          todo.push([`delete thread ${mark.id}`, 'accept', () => deleteThread(text, mark.id)]);
          continue;
        }
        todo.push([`accept ${mark.kind} ${mark.id}`, 'accept', () => accept(text, mark.id)]);
        todo.push([`reject ${mark.kind} ${mark.id}`, 'reject', () => reject(text, mark.id)]);
      }
      todo.push(['accept all', 'accept', () => acceptAll(text)]);
      todo.push(['reject all', 'reject', () => rejectAll(text)]);
      for (const [what, kind, decide] of todo) {
        const label = `seed ${seed}, ${what}: ${JSON.stringify(bodyOf(text))}`;
        let after: string;
        try {
          after = applyChanges(text, decide());
        } catch (error) {
          // A decision that would hide another change (a backtick that comes back) or leave a
          // marker at the start of a line where no form is possible is refused.
          const codes = ['no-legal-placement', 'would-hide-marks'];
          if (!(error instanceof EditError && codes.includes(error.code ?? ''))) throw error;
          refused++;
          continue;
        }
        decisions++;
        const kept = what.startsWith('delete thread')
          ? threads.filter((id) => !what.endsWith(id))
          : threads;
        const now = expectInOrder(label, kept, after);
        expectNoNewLineStarts(label, parsed, now);
        // A thread that is deleted changes no view. A change that is accepted leaves the newest
        // view as it was, and one that is rejected the original view.
        const view = kind === 'accept' ? newestView(after).text : originalView(after).text;
        expect(words(view), `${label}\n=> ${JSON.stringify(bodyOf(after))}`).toBe(
          kind === 'accept' ? newest : original,
        );
      }
    }
    expect(decisions).toBeGreaterThan(500);
    expect(withClosers).toBeGreaterThan(0);
    // Those are rare.
    expect(refused).toBeLessThan(decisions / 50);
  });
});

describe('format changes (format §2.6)', () => {
  const plain = (text: string) => newestView(text).text;

  it("accepts and rejects a format change around another author's deletion", () => {
    const text = file(
      'Some <!--fmt m2bd +bold-->**big <!--del k3x9 old -->deal**<!--/m2bd--> here.',
      { m2bd: 'ada', k3x9: 'bo' },
    );
    const kept = applyChanges(text, accept(text, 'm2bd'));
    expect(bodyOf(kept)).toBe('Some **big <!--del k3x9 old -->deal** here.');
    // Rejecting the deletion later brings the text back with the new formatting.
    expect(plain(applyChanges(kept, reject(kept, 'k3x9')))).toBe('Some **big old deal** here.\n');
    const undone = applyChanges(text, reject(text, 'm2bd'));
    expect(bodyOf(undone)).toBe('Some big <!--del k3x9 old -->deal here.');
    expect(plain(applyChanges(undone, reject(undone, 'k3x9')))).toBe('Some big old deal here.\n');
    expect(applyChanges(text, rejectAll(text))).toBe('Some big old deal here.\n');
  });

  it('rejects all, format changes too, to the original view', () => {
    const text = file(
      '<!--fmt q2hw was=p-->\n\n## Plan<!--/q2hw-->\n\nShip the <!--fmt m2bd +bold-->**<!--ins k3x9-->new <!--/k3x9-->importer**<!--/m2bd--> in <!--sub p7qd March-->April<!--/p7qd-->.\n\n- [x] Done<!--fmt n8fx +check-->\n- <!--fmt d3x9 was=ol=2.\\x20-->\n  Next<!--/d3x9-->',
      { q2hw: 'ada', m2bd: 'ada', k3x9: 'bo', p7qd: 'bo', n8fx: 'ada', d3x9: 'ada' },
    );
    const original = originalView(text).text;
    expect(original).toBe('Plan\n\nShip the importer in March.\n\n- [ ] Done\n2. Next\n');
    expect(applyChanges(text, rejectAll(text))).toBe(original);
    expect(applyChanges(text, acceptAll(text))).toBe(plain(text));
  });

  /**
   * Every order of deciding every mark the same way ends where the view says: accepting them all in
   * any order gives the newest view, and rejecting them all the original view, byte for byte. A
   * decision that is refused in an order is left out of it.
   */
  function expectViewsAgree(label: string, text: string): void {
    const ids = parse(text)
      .marks.filter((mark) => mark.kind !== 'cmt')
      .map((mark) => mark.id);
    const ends = { a: plain(text), r: originalView(text).text };
    for (const action of ['a', 'r'] as const) {
      expect(applyChanges(text, action === 'a' ? acceptAll(text) : rejectAll(text)), label).toBe(
        ends[action],
      );
      const walk = (current: string, left: readonly string[], path: string) => {
        if (left.length === 0) {
          expect(current, `${label}:${path}`).toBe(ends[action]);
          return;
        }
        for (const id of left) {
          let next: string;
          try {
            next = applyChanges(
              current,
              action === 'a' ? accept(current, id) : reject(current, id),
            );
          } catch (error) {
            if (error instanceof EditError) continue;
            throw error;
          }
          walk(
            next,
            left.filter((other) => other !== id),
            `${path} ${action}${id}`,
          );
        }
      };
      walk(text, ids, '');
    }
  }

  it('decides a format change whose text another person deleted as the views read it', () => {
    // Ada's bold, italic and strike of a word that Bo then deleted: in every order the same end,
    // with the delimiters left as text where the views leave them.
    for (const [syntax, op] of [
      ['**', '+bold'],
      ['*', '+italic'],
      ['~~', '+strike'],
    ] as const) {
      const text = file(
        `Some <!--fmt m2bd ${op}--><!--sub k3x9 ${syntax}word${syntax}-->${syntax}${syntax}<!--/k3x9--><!--/m2bd--> here.`,
        { m2bd: 'ada', k3x9: 'bo' },
      );
      expectViewsAgree(op, text);
    }
    const deleted = file('Some <!--fmt m2bd +bold-->**<!--del k3x9 word-->**<!--/m2bd--> here.', {
      m2bd: 'ada',
      k3x9: 'bo',
    });
    expectViewsAgree('deleted', deleted);
    // Rejecting the format change takes its syntax from around the pending deletion.
    expect(bodyOf(applyChanges(deleted, reject(deleted, 'm2bd')))).toBe(
      'Some <!--del k3x9 word--> here.',
    );
    // An empty link, Ada's, around Bo's deletion.
    const link = file(
      'Some <!--fmt m2bd +link-->[<!--del k3x9 word-->](https://n.example/)<!--/m2bd--> here.',
      {
        m2bd: 'ada',
        k3x9: 'bo',
      },
    );
    expectViewsAgree('link', link);
  });

  it('leaves the runs on either side of a deletion as the views read them', () => {
    for (const body of [
      '**one**<!--del k3x9 , two, -->**three** here.',
      '**one**<!--ins k3x9-->, two, <!--/k3x9-->**three** here.',
      '*a*<!--ins k3x9-->b<!--/k3x9-->*c* here.',
      '*a*<!--sub k3x9 x-->b<!--/k3x9-->*c* here.',
      '**a**<!--ins k3x9-->**b**<!--/k3x9--> end',
      'Plain **<!--ins k3x9-->new<!--/k3x9-->** here.',
      '**one** <!--del k3x9 two -->**three**',
    ]) {
      expectViewsAgree(body, file(body, { k3x9: 'bo' }));
    }
    // A bold across two paragraphs, whose break Bo deleted.
    const two = 'one\n\nthree\n';
    const bold = { kind: 'inline', format: 'bold', on: true } as const;
    const bolded = applyChanges(
      two,
      trackedFormat(two, { from: 0, to: two.length }, bold, context(ada, ['m2bd', 'n8fx', 'p7qd']))
        .changes,
    );
    const view = newestView(bolded);
    const from = view.map.toSource(view.text.indexOf('**\n') + 2, 1);
    const to = view.map.toSource(view.text.indexOf('**three'), -1);
    const joined = applyChanges(
      bolded,
      trackedEdit(bolded, { from, to, insert: '' }, context(bo, ['k3x9', 'g3rp'])),
    );
    expectViewsAgree('two paragraphs', joined);
  });

  it('gives back the text of format changes whose text is only delimiters', () => {
    for (const [body, original] of [
      ['use <!--fmt rsbq -code-->_<!--/rsbq--> here', 'use `_` here\n'],
      ['use <!--fmt h9h4 +code-->`_`<!--/h9h4--> here', 'use _ here\n'],
      ['a <!--fmt hs83 -bold-->~<!--/hs83--> b', 'a **~** b\n'],
      ['a <!--fmt s5fm +code-->`*****`<!--/s5fm--> b', 'a ***** b\n'],
    ] as const) {
      const id = /fmt (\w{4})/.exec(body)?.[1] ?? '';
      const text = file(body, { [id]: 'ada' });
      expect(applyChanges(text, reject(text, id)), body).toBe(original);
      expectViewsAgree(body, text);
    }
  });
});
