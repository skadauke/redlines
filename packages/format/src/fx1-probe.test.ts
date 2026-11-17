import { describe, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { EditError } from './errors.ts';
import { readAs, expectEveryOrderRead } from './oracle.ts';
import { accept, reject, rejectAll } from './decide.ts';
import { parse } from './parse.ts';
import { everyOrder, exactly, file, context, ada, bo, bodyOf } from './test-helpers.ts';
import { newestView } from './views.ts';
import { trackedEdits } from './track.ts';
import { untrackedEdit } from './untracked.ts';
import { randomIds } from './test-helpers.ts';
import { suggestReplace } from './agent.ts';
import { fuzzCount, randomDocument, seeded } from './random-docs.ts';
import { claudeAda, TIME, naturalOffsets } from './test-helpers.ts';
import type { Person } from './types.ts';

export function sound(text: string): string {
  const { outcomes, stuck } = everyOrder(text, exactly);
  const bad = [...outcomes]
    .filter(([, r]) => r.size > 1)
    .map(([d, r]) => `${d}: ${JSON.stringify([...r])}`);
  let asNewest = true;
  for (const m of parse(text).marks) {
    if (m.kind === 'cmt') continue;
    for (const d of [accept, reject]) {
      try {
        const next = applyChanges(text, d(text, m.id));
        try {
          expectEveryOrderRead('x', next);
        } catch {
          asNewest = false;
        }
      } catch (e) {
        if (!(e instanceof EditError)) throw e;
      }
    }
  }
  return bad.length || stuck.length || !asNewest
    ? `UNSOUND ${asNewest ? '' : '(file reads otherwise than newest) '}${bad.slice(0, 2).join(' | ')} stuck=${stuck.length}`
    : 'sound';
}
export function edit(
  text: string,
  from: number,
  to: number,
  insert: string,
  who: Person = ada,
  ids = ['m2bd', 'n8fx', 'p5qm', 'q6rs', 'r7st', 's8tv', 't9vw', 'v2wx', 'w3xz', 'x4zb'],
) {
  try {
    const r = trackedEdits(text, [{ from, to, insert }], context(who, ids));
    const after = applyChanges(text, r.changes);
    const back = bodyOf(applyChanges(after, rejectAll(after))).trimEnd() === bodyOf(applyChanges(text, rejectAll(text))).trimEnd() ? '' : ' NOT-REJECTS-BACK';
    return { after, verdict: sound(after) + back + ' => ' + JSON.stringify(bodyOf(after)) };
  } catch (e) {
    if (e instanceof EditError) return { after: text, verdict: 'REFUSED ' + e.message.slice(0, 80) };
    throw e;
  }
}
const log = (n: string, v: string) => console.log(`PROBE ${n}: ${v}`);


const F = (body: string, marks: Record<string, string> = {}) => file(body, marks);
const pos = (t: string, s: string, off = 0) => {
  const i = t.indexOf(s);
  if (i < 0) throw new Error('no ' + s);
  return i + off;
};
const chain = (label: string, start: string, steps: [string, number | string, number | string, string, Person][]) => {
  let t = start;
  for (const [i, [what, from, to, ins, who]] of steps.entries()) {
    const f = typeof from === 'string' ? pos(t, from) : from;
    const e = typeof to === 'string' ? pos(t, to) : to;
    const r = edit(t, f, e, ins, who, ['a1b2', 'c3d4', 'e5f6', 'g7h8', 'j9k2', 'k2m3', 'm3n4', 'n4p5', 'p5q6', 'q6r7'].slice(i));
    log(`${label} step${i} ${what}`, r.verdict);
    t = r.after;
  }
  return t;
};

describe('probe', () => {
  it('102', () => {
    const t = F('1. gamma beta\n- <!--fmt tnv3 was=ol=2.\\x20-->\n  delta<!--/tnv3-->\n\nEnd', { tnv3: 'ada' });
    log('102 enter', edit(t, 3, 3, '\n').verdict);
  });
  it('107', () => {
    log('107 file', sound(F('alpha <!--split f2hf-->\n\n<!--ins jjfx-->\n\n## x<!--/jjfx-->beta', { f2hf: 'ada', jjfx: 'bo' })));
    chain('107 live', F('alpha beta'), [
      ['ada enter', 6, 6, '\n\n', ada],
      ['bo heading', 'beta', 'beta', '## x', bo],
    ]);
  });
  it('108', () => {
    log('108 file', sound(F('one two <!--split wkvr-->\n\n<!--del mffk t-->\n\n<!--ins w354-->\n\n<!--del mffk  -->\n\n<!--/w354--><!--del mffk h-->\n\nree', { wkvr: 'ada', mffk: 'bo', w354: 'bo' })));
  });
  it('109', () => {
    chain('109 live', F('new words'), [
      ['ada enter', 3, 3, '\n', ada],
      ['bo del1', 'words', 'words', '', bo],
    ]);
    log('109 file1', sound(F('new<!--split ckqw--><!--del k2f6 \n-->words', { ckqw: 'ada', k2f6: 'bo' })));
    log('109 file2', sound(F('new<!--split ckqw--><!--del k2f6 \nw-->ords', { ckqw: 'ada', k2f6: 'bo' })));
    // second delete via edits
    const t1 = F('new<!--split ckqw--><!--del k2f6 \n-->words', { ckqw: 'ada', k2f6: 'bo' });
    log('109 second delete', edit(t1, pos(t1, 'words'), pos(t1, 'words', 1), '', bo).verdict);
  });
  it('110', () => {
    log('110 file', sound(F('<!--split dj4k--><!--del tsqq \n--><!--del tsqq *4--><!--ins vbh5-->\nx*4<!--/vbh5-->', { dj4k: 'ada', tsqq: 'bo', vbh5: 'bo' })));
  });
  it('112', () => {
    const t = F('one<!--split k3x9-->\ntwo', { k3x9: 'bo' });
    log('112 above', edit(t, 3, 3, '\n', ada).verdict);
    log('112 below', edit(t, pos(t, 'two'), pos(t, 'two'), '\n', ada).verdict);
  });
  it('113', () => {
    const t = F('one <!--fmt tbp3 +bold-->**two**<!--/tbp3--> three', { tbp3: 'bo' });
    log('113 bold', edit(t, pos(t, '**<!--/'), pos(t, '**<!--/'), '\n', ada).verdict);
  });
  it('119', () => {
    let t = F('- one\nnew two');
    t = edit(t, pos(t, 'two'), pos(t, 'two'), '\n  ', ada).after;
    log('119 base', JSON.stringify(bodyOf(t)));
    const from = pos(t, 'one', 3);
    log('119 bo deletes break', edit(t, from, from + 1, '', bo).verdict);
  });
  it('120', () => {
    let t = F('- one two');
    t = edit(t, 6, 6, '\n  \n  ', ada).after;
    log('120 base', JSON.stringify(bodyOf(t)));
    const i = pos(t, '<!--split');
    log('120.1 bare', edit(t, i, i, '\n', ada).verdict);
    log('120.2 new⏎', edit(t, i, i, 'new\n', ada).verdict);
    log('120.4 text on blank (ada)', edit(t, pos(t, '-->\n  \n', 6), pos(t, '-->\n  \n', 6), 'x', ada).verdict);
    let u = F('one  two');
    u = edit(u, 5, 5, '\n\n', ada).after;
    log('120.3 base', JSON.stringify(bodyOf(u)));
    const j = pos(u, 'two');
    log('120.3 text', edit(u, j, j, 'x', ada).verdict);
  });
  it('136', () => {
    const t = F('> A long quote that\nwraps lazily.\n> q');
    log('136 quote', edit(t, pos(t, '.\n> q', 1), pos(t, '.\n> q', 1), '\n', ada).verdict);
    const u = F('para text\n```a`b`\nmore');
    log('136 fence', edit(u, pos(u, 'text', 4), pos(u, 'text', 4), '\n', ada).verdict);
  });
  it('262', () => {
    const t = F('[a]: http://x\n\nSee [a].');
    log('262 def end', edit(t, pos(t, 'http://x', 8), pos(t, 'http://x', 8), 'y', ada).verdict);
    log('262 def end space', edit(t, pos(t, 'http://x', 8), pos(t, 'http://x', 8), ' ', ada).verdict);
    log('262 def end quote', edit(t, pos(t, 'http://x', 8), pos(t, 'http://x', 8), '"', ada).verdict);
  });
  it('276', () => {
    const t = F('a <!--ins k3x9--> <!--/k3x9--><!--del q4w7 *x--><!--del r5t8  -->middle** End', { k3x9: 'bo', q4w7: 'bo', r5t8: 'bo' });
    log('276 N2 file', sound(t));
    log('276 N2', edit(t, 1, 1, 'a', bo).verdict);
  });

  it('142', () => {
    const t = 'Hello world.\r\n\r\nSecond line here.\n';
    const r = edit(t, t.length, t.length, 'Z', ada);
    log('142 type', r.verdict);
    const back = applyChanges(r.after, rejectAll(r.after));
    log('142 bytes', JSON.stringify(back) + ' vs ' + JSON.stringify(t) + ' eq=' + (back === t));
  });
  it('144', () => {
    const l1 = F('one <!--ins a1b2-->two<!--/a1b2-->', { a1b2: 'ada' }).trimEnd();
    const l2 = F('three <!--ins c3d4-->four<!--/c3d4-->', { c3d4: 'bo' });
    const joined = l1 + '\n\n' + l2;
    const p2 = parse(joined);
    log('144 ledgers', JSON.stringify(Object.keys(p2.ledger.marks)) + ' warnings=' + p2.warnings.map((w) => w.code).join(','));
  });
  it('103', () => {
    const fmt = (body: string) => F(body, { tnv3: 'bo' });
    const t = fmt('```\ncode\n\n```\n8. alpha\n- <!--fmt tnv3 was=ol=2.\\x20-->\n  delta<!--/tnv3-->\n\nEnd');
    log('103 fence above', sound(t));
    log('103 enter', edit(t, pos(t, 'alpha'), pos(t, 'alpha'), '\n', ada).verdict);
    const u = fmt('para\n8. alpha\n- <!--fmt tnv3 was=ol=2.\\x20-->\n  delta<!--/tnv3-->\n\nEnd');
    log('103 enter u', edit(u, pos(u, 'alpha'), pos(u, 'alpha'), '\n', ada).verdict);
    log('103 ada type', edit(u, pos(u, 'alpha'), pos(u, 'alpha'), 'x', ada).verdict);
  });
  it('276', () => {
    const t = F('one <!--ins q4w7-->a<!--/q4w7--><!--ins r5t8-->b<!--/r5t8--><!--ins s6vw-->c<!--/s6vw--><!--ins t7wx-->d<!--/t7wx--> two', { q4w7: 'bo', r5t8: 'bo', s6vw: 'bo', t7wx: 'bo' });
    const i = pos(t, ' two');
    log('276 M2 star before four marks', edit(t, 4, 4, '*', bo).verdict);
    log('276 M3 key', edit(t, 1, 1, 'z', bo).verdict);
    void i;
  });
  it('265', () => {
    const t = F('a <!--split k3x9-->\nb c', { k3x9: 'bo' });
    log('265.1 paste ** by ada', edit(t, pos(t, 'b c'), pos(t, 'b c'), '**x**', ada).verdict);
    log('265.1 paste * by ada', edit(t, pos(t, 'b c', 1), pos(t, 'b c', 1), '*', ada).verdict);
    const u = F('<!--ins d8fg-->q<!--/d8fg--><!--fmt r4st +italic-->*<sup>t u</sup>*<!--/r4st-->', { d8fg: 'bo', r4st: 'ada' });
    log('265 c file', sound(u));
    const v = F('x <!--del a1b2 \n-->y *z* w', { a1b2: 'bo' });
    log('265.1 paste * near del', edit(v, pos(v, 'y'), pos(v, 'y'), '*', ada).verdict);
  });
  it('273', () => {
    const t = F('| a | b |\n| - | - |\n| c | d |');
    log('273 base', 'ok');
  });

  it('109b', () => {
    let t = F('new words');
    t = edit(t, 3, 3, '\n', ada).after;
    const i = pos(t, '\n words');
    const r1 = edit(t, i, i + 1, '', bo);
    log('109b del1', r1.verdict);
    const j = pos(r1.after, ' words');
    const r2 = edit(r1.after, j, j + 1, '', bo);
    log('109b del2', r2.verdict);
    const k = pos(r2.after, 'words');
    const r3 = edit(r2.after, k, k + 1, '', bo);
    log('109b del3', r3.verdict);
  });
  it('262b', () => {
    const t = F('[a]: http://x\n\nSee [a].');
    const r = edit(t, pos(t, 'http://x', 8), pos(t, 'http://x', 8), 'y', ada);
    log('262 root reads as newest', String(readAs(bodyOf(r.after)) === readAs(newestView(r.after).text)));
    log('262 body', readAs(bodyOf(r.after)) + ' VS ' + readAs(newestView(r.after).text));
  });
  it('108b', () => {
    let t = F('one two');
    t = edit(t, 4, 4, 'new\n\nwords ', ada).after;
    log('108 base', JSON.stringify(bodyOf(t)));
    const j = pos(t, 'words');
    const r = edit(t, j, j, ' ', bo);
    log('108 bo space', r.verdict);
  });

  it('251', { timeout: 600_000 }, () => {
    const WORDS = ['alpha', 'beta', 'gamma', 'new', 'x', 'one\n\ntwo'];
    const can = (t: string, id: string, how: typeof accept) => {
      try { how(t, id); return true; } catch { return false; }
    };
    let n = 0, lost = 0, refused = 0;
    const samples: string[] = [];
    for (let seed = 1; seed <= 400; seed++) {
      const random = seeded(seed * 4801);
      const below = (k: number) => Math.floor(random() * k);
      let text = randomDocument(seeded(seed));
      for (let step = 0; step < 3; step++) {
        const view = newestView(text).text;
        const offsets = naturalOffsets(view);
        const from = offsets[below(offsets.length)] ?? 0;
        const later = offsets.filter((o) => o >= from + 3 && o <= from + 43);
        const oldStr = view.slice(from, later[below(later.length)] ?? from);
        if (oldStr.length < 3 || view.split(oldStr).length !== 2) continue;
        const newStr = oldStr.replace(/\S+/g, (w) => {
          if (/^(?:[-*+>]|\d+\.|#{1,6})$/.test(w)) return w;
          const roll = below(6);
          if (roll === 0) return WORDS[below(WORDS.length)] ?? w;
          if (roll === 1) return '';
          if (roll === 2) return `${w} ${WORDS[below(WORDS.length)] ?? ''}`;
          return w;
        });
        const author = below(2) === 0 ? claudeAda : bo;
        let result: string;
        try {
          const e = suggestReplace(text, oldStr, newStr, { author, time: TIME, random: (k: number) => Uint8Array.from({ length: k }, () => below(256)) });
          result = applyChanges(text, e.changes);
        } catch (err) {
          if (err instanceof EditError) { refused++; continue; }
          throw err;
        }
        n++;
        const before = parse(text);
        for (const mark of parse(result).marks) {
          if (mark.kind === 'cmt' || mark.kind === 'hl') continue;
          if (!before.marks.some((m) => m.id === mark.id)) continue;
          for (const [name, how] of [['accept', accept], ['reject', reject]] as const) {
            if (can(text, mark.id, how) && !can(result, mark.id, how)) {
              lost++;
              if (samples.length < 3) samples.push(`${name} ${mark.id} (${mark.kind}): ${JSON.stringify([oldStr, newStr])} on ${JSON.stringify(bodyOf(text))}`);
            }
          }
        }
        text = result;
      }
    }
    log('251', `edits=${n} refused=${refused} decisions lost=${lost} ${samples.join(' ## ')}`);
  });

  it('44', () => {
    const un = (t: string, from: number, to: number, ins: string) => {
      try {
        const ch = untrackedEdit(t, { from, to, insert: ins }, { random: randomIds('w8nn', 'p5qm', 'q6rs') });
        const after = applyChanges(t, ch);
        return sound(after) + ' => ' + JSON.stringify(bodyOf(after));
      } catch (e) {
        if (e instanceof EditError) return 'REFUSED ' + e.message.slice(0, 90);
        throw e;
      }
    };
    const t1 = F('one <!--ins a1b2-->ab cd<!--/a1b2--> two', { a1b2: 'bo' });
    log('44a blank line in ins before space', un(t1, pos(t1, ' cd'), pos(t1, ' cd'), '\n\n'));
    const t2 = F('one <!--cmt c7g3--> two');
    log('44b enter before point comment', un(t2, pos(t2, '<!--cmt'), pos(t2, '<!--cmt'), '\n'));
    const t3 = F('one <!--ins a1b2-->ab cd<!--/a1b2--> two', { a1b2: 'bo' });
    log('44c enter in front of insertion', un(t3, pos(t3, '<!--ins'), pos(t3, '<!--ins'), '\n'));
    log('44c enter inside insertion', un(t3, pos(t3, 'ab ', 1), pos(t3, 'ab ', 1), '\n'));
    const t4 = F('one two\n\nThree', {});
    log('44 spaces before hidden marker', 'n/a');
  });
  it('17', () => {
    // cancel by retyping
    let t = F('one two three');
    const d = edit(t, 4, 7, '', ada);
    log('17 delete', d.verdict);
    const j = pos(d.after, '<!--del');
    const r = edit(d.after, j, j, 'two', ada);
    log('17 retype', r.verdict);
    // final line break
    const u = 'Hello\n';
    const x = edit(u, 6, 6, 'Z', ada);
    log('17 final break typed', x.verdict + ' back=' + JSON.stringify(applyChanges(x.after, rejectAll(x.after))));
  });

  it('262c', () => {
    const t = F('[a]: http://x "T"\n\nSee [a].');
    const root = (r: { after: string }) => String(readAs(bodyOf(r.after)) === readAs(newestView(r.after).text));
    for (const [name, f, to, ins] of [
      ['label', pos(t, 'a]'), pos(t, 'a]'), 'z'],
      ['url mid', pos(t, 'http://', 3), pos(t, 'http://', 3), 'z'],
      ['url end', pos(t, ' "T"'), pos(t, ' "T"'), 'z'],
      ['title', pos(t, 'T"'), pos(t, 'T"'), 'z'],
      ['del url char', pos(t, 'x "'), pos(t, 'x "', 1), ''],
    ] as const) {
      const r = edit(t, f, to, ins, ada);
      log('262c ' + name, r.verdict.slice(0, 40) + ' root=' + root(r) + ' ' + r.verdict.slice(r.verdict.indexOf('=>')));
    }
  });
});
