// A document joined from several files has a ledger for each part, and a marker reads the first
// ledger after it (format §5.1, #144). A marker after the last ledger reads the last, and new
// changes write their entries into the first ledger after them, so that the parts can be split
// apart again.

import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { accept, reject } from './decide.ts';
import { serializeLedger } from './ledger-write.ts';
import { parse } from './parse.ts';
import { fuzzCount, seeded } from './random-docs.ts';
import { ada, bo, context } from './test-helpers.ts';
import { trackedEdit } from './track.ts';
import type { Ledger } from './types.ts';

const T1 = '2026-10-13T22:30Z';
const T2 = '2026-10-14T09:00Z';

function ledgerOf(marks: Ledger['marks'], people = [ada, bo]): string {
  const ledger: Ledger = { version: 1, people, marks, comments: [] };
  return serializeLedger(ledger);
}

/** A part of a joined file: a body and its own ledger. */
function part(body: string, marks: Ledger['marks'], people = [ada]): string {
  return `${body}\n\n${ledgerOf(marks, people)}\n`;
}

const A = part('Alpha <!--ins dddd-->new <!--/dddd-->one.', { dddd: { by: 'ada', at: T1 } });
const B = part('Beta <!--del bbbb old -->two.', { bbbb: { by: 'bo', at: T2 } }, [bo]);
const C = part('Gamma <!--ins cccc-->fresh <!--/cccc-->three.', { cccc: { by: 'ada', at: T2 } });

function accepted(text: string, id: string): string {
  return applyChanges(text, accept(text, id));
}
function rejected(text: string, id: string): string {
  return applyChanges(text, reject(text, id));
}

describe('a marker reads the first ledger after it (format §5.1)', () => {
  it('gives each mark the author and time of its own part', () => {
    const parsed = parse(A + B + C);
    expect(parsed.warnings).toEqual([]);
    const entry = (id: string) => parsed.marks.find((mark) => mark.id === id)?.entry;
    expect(entry('dddd')).toEqual({ by: 'ada', at: T1 });
    expect(entry('bbbb')).toEqual({ by: 'bo', at: T2 });
    expect(entry('cccc')).toEqual({ by: 'ada', at: T2 });
    expect(Object.keys(parsed.ledger.marks).sort()).toEqual(['bbbb', 'cccc', 'dddd']);
  });

  it('reads a ledger in the middle: the marks in front of it have their entries', () => {
    const parsed = parse(A + B);
    expect(parsed.warnings).toEqual([]);
    expect(parsed.marks.map((mark) => mark.entry.by)).toEqual(['ada', 'bo']);
  });

  it('reads a marker after the last ledger from the last', () => {
    const tail = 'After <!--ins tttt-->tail <!--/tttt-->text.\n';
    const text = A + part('Beta.', { tttt: { by: 'bo', at: T2 } }, [bo]) + tail;
    const parsed = parse(text);
    expect(parsed.warnings).toEqual([]);
    expect(parsed.marks.find((mark) => mark.id === 'tttt')?.entry).toEqual({ by: 'bo', at: T2 });
    expect(parsed.marks.find((mark) => mark.id === 'dddd')?.entry).toEqual({ by: 'ada', at: T1 });
  });

  it('does not read an entry from a ledger in front of the marker', () => {
    // The entry for dddd is in the second ledger only: the first ledger after the marker is the
    // first, which has none.
    const text =
      part('Alpha <!--ins dddd-->new <!--/dddd-->one.', {}) +
      part('Beta.', {
        dddd: { by: 'ada', at: T1 },
      });
    const parsed = parse(text);
    expect(parsed.marks[0]?.entry).toEqual({ by: 'unknown', at: '' });
    expect(parsed.warnings.some((warning) => warning.code === 'missing-entry')).toBe(true);
  });

  it('reads the people of every part', () => {
    const parsed = parse(A + B);
    expect(parsed.ledger.people.map((person) => person.handle).sort()).toEqual(['ada', 'bo']);
  });

  it('reads a comment from the ledger after its anchor', () => {
    const thread = (id: string, text: string): Ledger => ({
      version: 1,
      people: [ada],
      marks: {},
      comments: [{ id, by: 'ada', at: T1, likes: [], replies: [], text }],
    });
    const one = `One <!--cmt c222-->word<!--/c222-->.\n\n${serializeLedger(thread('c222', 'first'))}\n`;
    const two = `Two <!--cmt c333-->word<!--/c333-->.\n\n${serializeLedger(thread('c333', 'second'))}\n`;
    const parsed = parse(one + two);
    expect(parsed.warnings).toEqual([]);
    expect(parsed.ledger.comments.map((c) => [c.id, c.text])).toEqual([
      ['c222', 'first'],
      ['c333', 'second'],
    ]);
  });
});

describe('a new change writes its entry into the first ledger after it', () => {
  const people = [ada, bo];

  it('writes it into the ledger of its own part, and leaves the others as they are', () => {
    const text = A + B + C;
    const at = text.indexOf('Beta') + 5;
    const changes = trackedEdit(text, { from: at, to: at, insert: 'big ' }, context(bo, ['nnnn']));
    const after = applyChanges(text, changes);
    // The parts split apart again: each ledger holds its own marks.
    const parts = after.split(/(?<=-->\n)(?=\S)/);
    expect(parts).toHaveLength(3);
    expect(parts[0]).toBe(A);
    expect(parts[2]).toBe(C);
    const second = parse(parts[1]!);
    expect(second.warnings).toEqual([]);
    expect(Object.keys(second.ledger.marks).sort()).toEqual(['bbbb', 'nnnn']);
    expect(second.ledger.marks['nnnn']).toMatchObject({ by: 'bo' });
    expect(parse(after).warnings).toEqual([]);
    expect(people).toBeDefined();
  });

  it('writes a change in the first part into the first ledger', () => {
    const text = A + B;
    const at = text.indexOf('one') + 3;
    const after = applyChanges(
      text,
      trackedEdit(text, { from: at, to: at, insert: '!' }, context(bo, ['mmmm'])),
    );
    const parts = after.split(/(?<=-->\n)(?=\S)/);
    expect(parts[1]).toBe(B);
    expect(Object.keys(parse(parts[0]!).ledger.marks).sort()).toEqual(['dddd', 'mmmm']);
    // A person new to that ledger is listed in it.
    expect(parse(parts[0]!).ledger.people.map((person) => person.handle)).toContain('bo');
  });

  it('removes the ledger of a part that has no change left, and no other', () => {
    const text = A + B + C;
    const after = rejected(text, 'bbbb');
    expect(after.startsWith(A)).toBe(true);
    expect(after.endsWith(C)).toBe(true);
    expect(after.match(/<!-- redlines/g)).toHaveLength(2);
    expect(parse(after).warnings).toEqual([]);
  });
});

describe('every order of decisions reads alike in a joined file', () => {
  /** Decides each part alone, and puts the results together as the file was. */
  function alone(parts: string[], decisions: [string, 'accept' | 'reject'][]): string {
    return parts
      .map((one) => {
        let text = one;
        for (const [id, how] of decisions) {
          if (!parse(text).marks.some((mark) => mark.id === id)) continue;
          text = how === 'accept' ? accepted(text, id) : rejected(text, id);
        }
        return text;
      })
      .join('');
  }

  const WORDS = ['alpha', 'beta', 'gamma', 'delta', 'café', 'x'];

  /** A part with several changes: an insertion, a deletion and a substitution, in some order. */
  function randomPart(random: () => number, ids: string[]): { text: string; ids: string[] } {
    const word = () => WORDS[Math.floor(random() * WORDS.length)]!;
    const marks: Ledger['marks'] = {};
    let body = '';
    const count = 1 + Math.floor(random() * 3);
    const mine: string[] = [];
    for (let i = 0; i < count; i++) {
      const id = ids.shift()!;
      mine.push(id);
      marks[id] = { by: random() < 0.5 ? 'ada' : 'bo', at: i % 2 ? T1 : T2 };
      const kind = Math.floor(random() * 3);
      body +=
        kind === 0
          ? `${word()} <!--ins ${id}-->${word()} <!--/${id}-->${word()}. `
          : kind === 1
            ? `${word()} <!--del ${id} ${word()} -->${word()}. `
            : `${word()} <!--sub ${id} ${word()} -->${word()}<!--/${id}--> ${word()}. `;
    }
    return { text: part(body.trimEnd(), marks, [ada, bo]), ids: mine };
  }

  const ID_POOL = [
    'b2cd',
    'b3cd',
    'c4dg',
    'd5fg',
    'f6gh',
    'g7hj',
    'h8jk',
    'j9km',
    'k2mn',
    'm3np',
    'n4pq',
    'p5qr',
  ];

  it('gives what each part would give alone, whichever order the changes are decided in', () => {
    for (let seed = 1; seed <= fuzzCount(40); seed++) {
      const random = seeded(seed);
      const ids = [...ID_POOL];
      const parts = [randomPart(random, ids), randomPart(random, ids), randomPart(random, ids)];
      const text = parts.map((one) => one.text).join('');
      expect(parse(text).warnings, `seed ${seed}`).toEqual([]);
      const all = parts.flatMap((one) => one.ids);
      // A random order, with a random decision for each change.
      const order = all.toSorted(() => random() - 0.5);
      const decisions = order.map((id): [string, 'accept' | 'reject'] => [
        id,
        random() < 0.5 ? 'accept' : 'reject',
      ]);
      let joined = text;
      decisions.forEach(([id, how], done) => {
        joined = how === 'accept' ? accepted(joined, id) : rejected(joined, id);
        expect(parse(joined).warnings, `seed ${seed} after ${id}`).toEqual([]);
        // Every step, with some changes pending and some decided: the ledger of a part that still
        // has a change is what it would be alone, and the others are gone.
        expect(joined, `seed ${seed} after ${done + 1}`).toBe(
          alone(
            parts.map((one) => one.text),
            decisions.slice(0, done + 1),
          ),
        );
      });
    }
  });

  it('reads the same author and time whichever of the other changes are decided first', () => {
    for (let seed = 1; seed <= fuzzCount(20); seed++) {
      const random = seeded(1000 + seed);
      const ids = [...ID_POOL];
      const parts = [randomPart(random, ids), randomPart(random, ids)];
      let text = parts.map((one) => one.text).join('');
      const entries = new Map(parse(text).marks.map((mark) => [mark.id, mark.entry]));
      for (const id of parts.flatMap((one) => one.ids).toSorted(() => random() - 0.5)) {
        for (const mark of parse(text).marks) expect(mark.entry).toEqual(entries.get(mark.id));
        text = random() < 0.5 ? accepted(text, id) : rejected(text, id);
      }
    }
  });
});
