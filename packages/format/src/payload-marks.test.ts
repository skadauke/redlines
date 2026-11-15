// Marks in the old text of a replacement (format §3.12): other people's pending changes that the
// payload of a substitution holds, written in the payload's encoding. They are read as marks, decided
// in the old text as in the file, and every order of decisions reads alike.

import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { accept, acceptAll, reject, rejectAll } from './decide.ts';
import { encodePayload } from './payload.ts';
import { parse } from './parse.ts';
import { bodyOf, file, problemsOf, thread } from './test-helpers.ts';
import { newestView, originalView, reviewView } from './views.ts';

/** The old text of a paragraph that Bo changed twice, and Ada made a heading. */
const OLD = '<!--ins k3x9-->\n\nFast <!--/k3x9-->importer ships <!--del w2rf very -->April.';
const NEW = '## Fast importer ships April.';

/** A replacement `r2zd` of `old` by `new`, in the form of a paragraph (format §3.3). */
const replaced = (old: string, now: string, id = 'r2zd') =>
  `Intro.\n\n<!--sub ${id} ${encodePayload(old)}-->\n\n${now}<!--/${id}-->\n\nOutro.`;

const MARKS = { r2zd: 'ada', k3x9: 'bo', w2rf: 'bo' };

describe('reading the marks in a payload', () => {
  it('reads other people’s marks in the old text as marks, with their entries', () => {
    const text = file(replaced(OLD, NEW), MARKS);
    expect(bodyOf(text)).toContain('<!--sub r2zd <!-\\-ins k3x9-\\->');
    const parsed = parse(text);
    expect(parsed.marks.map((mark) => mark.id)).toEqual(['r2zd']);
    expect(parsed.payloads).toHaveLength(1);
    const [site] = parsed.payloads;
    expect(site?.owner).toBe('r2zd');
    expect(site?.depth).toBe(1);
    expect(site?.text).toBe(OLD);
    expect(site?.marks.map((mark) => [mark.id, mark.kind, mark.entry.by])).toEqual([
      ['k3x9', 'ins', 'bo'],
      ['w2rf', 'del', 'bo'],
    ]);
    // The ranges are offsets in the decoded payload.
    const [ins] = site?.marks ?? [];
    expect(site?.text.slice(ins?.segments[0]?.open.from, ins?.segments[0]?.close?.to)).toBe(
      '<!--ins k3x9-->\n\nFast <!--/k3x9-->',
    );
    expect(problemsOf(parsed)).toEqual([]);
    expect(parsed.warnings).toEqual([]);
  });

  it('does not take their ledger entries for orphans, and keeps a comment’s thread attached', () => {
    const old = 'See <!--cmt c7bk-->this<!--/c7bk--> and <!--ins k3x9-->that<!--/k3x9-->.';
    const text = file(replaced(old, 'See it.'), { r2zd: 'ada', k3x9: 'bo' }, thread('c7bk', 'bo'));
    const parsed = parse(text);
    expect(parsed.warnings).toEqual([]);
    expect(parsed.payloads[0]?.marks.map((mark) => mark.id)).toEqual(['c7bk', 'k3x9']);
    expect(parsed.payloads[0]?.marks[0]?.entry.by).toBe('bo');
  });

  it('reads a payload in a payload, three deep', () => {
    const third = '<!--ins t3rd-->three<!--/t3rd-->';
    const second = `two <!--sub s2nd ${encodePayload(third)}-->and<!--/s2nd-->`;
    const text = file(replaced(second, 'new'), { r2zd: 'ada', s2nd: 'bo', t3rd: 'ada' });
    const parsed = parse(text);
    expect(parsed.warnings).toEqual([]);
    expect(parsed.payloads[0]?.marks.map((mark) => mark.id)).toEqual(['s2nd']);
    expect(parsed.payloads[0]?.payloads[0]?.depth).toBe(2);
    expect(parsed.payloads[0]?.payloads[0]?.marks.map((mark) => mark.id)).toEqual(['t3rd']);
  });

  it('reads no deeper than three payloads', () => {
    const l5 = '<!--ins g5th-->five<!--/g5th-->';
    const l4 = `<!--sub f4th ${encodePayload(l5)}-->four<!--/f4th-->`;
    const l3 = `<!--sub t3rd ${encodePayload(l4)}-->three<!--/t3rd-->`;
    const l2 = `<!--sub s2nd ${encodePayload(l3)}-->two<!--/s2nd-->`;
    const marks = { r2zd: 'ada', s2nd: 'bo', t3rd: 'ada', f4th: 'bo', g5th: 'ada' };
    const parsed = parse(file(replaced(l2, 'new'), marks));
    // r2zd's payload is the first, s2nd's the second, t3rd's the third. f4th is a mark in the third,
    // and its own payload would be the fourth: what it holds is text.
    const third = parsed.payloads[0]?.payloads[0]?.payloads[0];
    expect(third?.depth).toBe(3);
    expect(third?.marks.map((mark) => mark.id)).toEqual(['f4th']);
    expect(third?.payloads).toEqual([]);
    // g5th is read nowhere, and its entry has no mark.
    expect(parsed.warnings.map((w) => w.code)).toEqual(['orphan-entry']);
  });

  it('reads a marker as text when its id has no ledger entry', () => {
    const text = file(replaced(OLD, NEW), { r2zd: 'ada', w2rf: 'bo' });
    const parsed = parse(text);
    expect(parsed.payloads[0]?.marks.map((mark) => mark.id)).toEqual(['w2rf']);
    expect(parsed.warnings.map((w) => [w.code, w.id])).toEqual([['payload-mark', 'k3x9']]);
  });

  it('reads a marker as text when its id stands elsewhere in the file', () => {
    const body = `${replaced(OLD, NEW)}\n\nAnd <!--ins k3x9-->more<!--/k3x9-->.`;
    const parsed = parse(file(body, MARKS));
    expect(parsed.payloads[0]?.marks.map((mark) => mark.id)).toEqual(['w2rf']);
    expect(parsed.warnings.map((w) => [w.code, w.id])).toContainEqual(['payload-mark', 'k3x9']);
    expect(parsed.marks.map((mark) => mark.id)).toContain('k3x9');
  });

  it('reads a marker as text when its closer is not in the same payload', () => {
    const old = '<!--ins k3x9-->Fast importer';
    const parsed = parse(file(replaced(old, NEW), { r2zd: 'ada', k3x9: 'bo' }));
    expect(parsed.payloads[0]?.marks).toEqual([]);
    expect(parsed.warnings.map((w) => [w.code, w.id])).toContainEqual(['payload-mark', 'k3x9']);
  });

  it('leaves a replacement whose old text holds no marker as it was', () => {
    const parsed = parse(file(replaced('Plain old text.', 'New.'), { r2zd: 'ada' }));
    expect(parsed.payloads).toEqual([]);
    expect(parsed.warnings).toEqual([]);
  });

  it('does not read a marker in a payload’s code, which is the code’s', () => {
    const old = 'Write `<!--ins k3x9-->` to start.';
    const parsed = parse(file(replaced(old, 'New.'), { r2zd: 'ada', k3x9: 'bo' }));
    expect(parsed.payloads[0]?.marks).toEqual([]);
    // The entry has no mark: it is an orphan, as it is in a file whose body has no such mark.
    expect(parsed.warnings.map((w) => w.code)).toEqual(['orphan-entry']);
  });
});

describe('the views of a replacement whose old text holds marks', () => {
  const text = file(replaced(OLD, NEW), MARKS);

  it('the original view is the old text with its own marks rejected too', () => {
    expect(originalView(text).text).toBe('Intro.\n\nimporter ships very April.\n\nOutro.\n');
  });

  it('the newest view is the new text, as it was', () => {
    expect(newestView(text).text).toBe('Intro.\n\n## Fast importer ships April.\n\nOutro.\n');
  });

  it('the review view shows the old text as it reads with their changes, and names them', () => {
    expect(reviewView(text)).toBe(
      'Intro.\n\n{~~Fast importer ships April.~>## Fast importer ships April.~~}[r2zd ada]' +
        '{>>[r2zd ada] Its old text holds [k3x9 bo] and [w2rf bo]<<}\n\nOutro.\n',
    );
  });
});

const run = (text: string, how: typeof accept, id: string) => applyChanges(text, how(text, id));

describe('deciding a replacement whose old text holds marks', () => {
  const before = (old: string) => `Intro.\n\n${old}\n\nOutro.`;
  const text = file(replaced(OLD, NEW), MARKS);

  it('rejecting it gives the file before the edit, byte for byte, their marks pending again', () => {
    expect(run(text, reject, 'r2zd')).toBe(file(before(OLD), { k3x9: 'bo', w2rf: 'bo' }));
  });

  it('accepting it gives the new text, and drops their marks and their entries', () => {
    const done = run(text, accept, 'r2zd');
    expect(done).toBe(`Intro.\n\n${NEW}\n\nOutro.\n`);
    expect(parse(done).warnings).toEqual([]);
  });

  it('accepting a mark in the old text decides it there, and leaves the new text alone', () => {
    const done = run(text, accept, 'k3x9');
    expect(done).toBe(
      file(
        replaced('Fast importer ships <!--del w2rf very -->April.', NEW),
        { r2zd: 'ada', w2rf: 'bo' },
      ),
    );
    // Rejecting the replacement now gives the file as if it had been accepted before the edit.
    expect(run(done, reject, 'r2zd')).toBe(
      file(before('Fast importer ships <!--del w2rf very -->April.'), { w2rf: 'bo' }),
    );
  });

  it('rejecting a mark in the old text decides it there too', () => {
    const done = run(text, reject, 'w2rf');
    expect(done).toBe(
      file(replaced('<!--ins k3x9-->\n\nFast <!--/k3x9-->importer ships very April.', NEW), {
        r2zd: 'ada',
        k3x9: 'bo',
      }),
    );
    const again = run(done, reject, 'k3x9');
    expect(again).toBe(file(replaced('importer ships very April.', NEW), { r2zd: 'ada' }));
    expect(run(again, reject, 'r2zd')).toBe(`${before('importer ships very April.')}\n`);
  });

  it('decides a mark in a payload in a payload', () => {
    const third = '<!--ins t3rd-->three<!--/t3rd-->';
    const second = `two <!--sub s2nd ${encodePayload(third)}-->and<!--/s2nd-->`;
    const nested = file(replaced(second, 'new'), { r2zd: 'ada', s2nd: 'bo', t3rd: 'ada' });
    const done = run(nested, accept, 't3rd');
    expect(done).toBe(
      file(replaced('two <!--sub s2nd three-->and<!--/s2nd-->', 'new'), { r2zd: 'ada', s2nd: 'bo' }),
    );
    expect(run(nested, reject, 'r2zd')).toBe(file(before(second), { s2nd: 'bo', t3rd: 'ada' }));
  });
});

describe('comments and highlights in the old text of a replacement', () => {
  const old = 'See <!--cmt c7bk-->this<!--/c7bk--> and <!--hl h4jm-->that<!--/h4jm-->.';
  const marks = { r2zd: 'ada', h4jm: 'bo' };
  const threads = thread('c7bk', 'bo', 'Why this?');
  const text = file(replaced(old, 'See it.'), marks, threads);

  it('accepting the replacement leaves a point comment where the new text starts, and drops a highlight', () => {
    const done = run(text, accept, 'r2zd');
    expect(done).toBe(
      file('Intro.\n\n<!--cmt c7bk-->\n\nSee it.\n\nOutro.', {}, threads),
    );
    const read = parse(done);
    expect(read.warnings).toEqual([]);
    expect(read.marks.map((mark) => [mark.id, mark.kind])).toEqual([['c7bk', 'cmt']]);
    expect(Object.keys(read.ledger.marks)).toEqual([]);
  });

  it('rejecting the replacement gives the comment and the highlight back where they were', () => {
    expect(run(text, reject, 'r2zd')).toBe(file(`Intro.\n\n${old}\n\nOutro.`, { h4jm: 'bo' }, threads));
  });

  it('dismissing the highlight in the old text decides it there', () => {
    const done = run(text, accept, 'h4jm');
    expect(done).toBe(
      file(replaced('See <!--cmt c7bk-->this<!--/c7bk--> and that.', 'See it.'), { r2zd: 'ada' }, threads),
    );
  });

  it('a comment is not accepted or rejected, in the old text either', () => {
    expect(() => accept(text, 'c7bk')).toThrow(/resolved or deleted/);
  });

  it('accept all and reject all decide the replacement, and the marks it holds go with it', () => {
    const marks2 = { r2zd: 'ada', k3x9: 'bo', w2rf: 'bo' };
    const held = file(replaced(OLD, NEW), marks2);
    expect(applyChanges(held, acceptAll(held))).toBe(`Intro.\n\n${NEW}\n\nOutro.\n`);
    // Reject all leaves nothing pending: the replacement is rejected, and their changes with it.
    expect(applyChanges(held, rejectAll(held))).toBe(`Intro.\n\nimporter ships very April.\n\nOutro.\n`);
  });
});
