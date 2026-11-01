import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { accept, acceptAll, reject, rejectAll } from './decide.ts';
import { EditError } from './errors.ts';
import { parse } from './parse.ts';
import { fuzzCount, randomDocument, seeded } from './random-docs.ts';
import {
  bodyOf,
  expectInOrder,
  file,
  fixture,
  idsOf,
  nestedInsertions,
  problemsOf,
  thread,
} from './test-helpers.ts';
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

  it('throws "not supported in v0.1" for format changes, splits, table marks and moves', () => {
    const text = file(
      'a <!--fmt m2bd +bold-->**b**<!--/m2bd--> c<!--split s3vb-->\n\n| <!--ins k3x9 row--> d | <!--del g5nb row=2 \\| x-->',
      { m2bd: 'ada', s3vb: 'ada', k3x9: 'ada', g5nb: 'ada' },
    );
    for (const id of ['m2bd', 's3vb', 'k3x9', 'g5nb']) {
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
    const fmt = file('a <!--fmt m2bd +bold-->**b**<!--/m2bd--> c', { m2bd: 'ada' });
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
      '<!--cmt c8d2-->ef<!--/c8d2-->',
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
    expect(bodyOf(result)).toBe('<!--cmt c8d2--> x ');
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
