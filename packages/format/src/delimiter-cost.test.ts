// The extra read that a delimiter key makes in a paragraph that holds a marker (`readsOtherMicromark`,
// #1016) costs time in the paragraph, not in the file: it reads the paragraphs the key is in, and the
// whole file only where a fence or a raw HTML block could run past a blank line. The timing tests
// run with REDLINES_COST=check, as the other cost tests do: the bounds are ratios to a plain key of
// the same file, which follow the machine.
import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { ada, context, file } from './test-helpers.ts';
import { trackedEdits } from './track.ts';
import { readsOtherMicromark } from './widen.ts';

const L = 'bcdfghjkmnpqrstvwxz';
const idOf = (i: number) =>
  `${L[Math.floor(i / 361) % 19]}${L[Math.floor(i / 19) % 19]}${L[i % 19]}x`;
const FRESH = Array.from({ length: 12 }, (_, i) => `z${L[i]}${L[i + 1]}${L[i + 2]}`);

/** A paragraph of about 5,000 characters with 50 of Bo's insertions in it, and `more` plain ones. */
function documentOf(more: number): { before: string; at: number } {
  const marks: Record<string, string> = {};
  const words: string[] = [];
  for (let i = 0; i < 850; i++) {
    if (i % 17 === 0) {
      const id = idOf(i / 17);
      marks[id] = 'bo';
      words.push(`<!--ins ${id}-->new<!--/${id}-->`);
    } else words.push('word');
  }
  const plain = Array.from({ length: more }, () => Array(100).fill('word').join(' '));
  const text = [`${words.join(' ')} tail`, ...plain].join('\n\n');
  return { before: file(text, marks), at: text.indexOf(' tail') + 5 };
}

function press(before: string, at: number, key: string): string {
  const done = trackedEdits(before, [{ from: at, to: at, insert: key }], context(ada, [...FRESH]));
  return applyChanges(before, done.changes);
}

/** The fastest of `runs`: what a busy machine adds is never negative, so the minimum is the cost. */
function time(fn: () => void, runs = 9): number {
  fn();
  let fastest = Infinity;
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    fn();
    fastest = Math.min(fastest, performance.now() - start);
  }
  return fastest;
}

const timed = it.skipIf(!process.env['REDLINES_COST']);

describe('a delimiter key in a paragraph that holds marks', () => {
  it('is written in a long paragraph, alone and in a long file', () => {
    for (const { before, at } of [documentOf(0), documentOf(60)]) {
      for (const key of ['*', '_']) {
        expect(press(before, at, key)).toContain(key);
      }
    }
  });

  it('is read as the whole file reads it: a key at every 101st place, beside each kind of block', () => {
    const filler = Array.from({ length: 14 }, () => 'plain words '.repeat(12).trim());
    const specials = [
      'A *starred <!--ins m2bd-->word<!--/m2bd--> and _more_ text.',
      '```ts\nconst a = 1;\n\nconst b = *2;\n```',
      '- item one <!--ins m2bd-->new<!--/m2bd-->\n\n  continued *item*\n- item two',
      '> quoted _text_\n>\n> more <!--del m2bd old *words-->',
      '| a | b |\n| - | - |\n| *x | y<!--ins m2bd-->z<!--/m2bd--> |',
      '<!-- an ordinary comment\n\nthat spans a blank line -->',
      '<pre>\nraw\n\n*text*\n</pre>',
      '<!--ins m2bd-->first\n\nsecond *paragraph<!--/m2bd-->',
    ];
    let checked = 0;
    for (const special of specials) {
      const before = file([...filler, special, ...filler].join('\n\n'), { m2bd: 'bo' });
      // Only where the file as it stands reads alike: elsewhere the whole read answers for the file.
      if (readsOtherMicromark(before, [], true)) continue;
      for (let at = 3; at < before.indexOf('<!-- redlines'); at += 101) {
        for (const insert of ['*', '_', 'x']) {
          const changes = [{ from: at, to: at, insert }];
          expect(readsOtherMicromark(before, changes), `${insert} at ${at} by ${special}`).toBe(
            readsOtherMicromark(before, changes, true),
          );
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(50);
  }, 120_000);

  timed(
    'costs at most 12 times a plain key in the paragraph (it was 3 to 4 in a short file)',
    () => {
      const { before, at } = documentOf(0);
      expect(time(() => press(before, at, '*'))).toBeLessThan(
        time(() => press(before, at, 'z')) * 12 + 3,
      );
    },
  );

  timed('costs the same in a file of 100 KB as in one of 3 KB more: at most 3 times', () => {
    const short = documentOf(5);
    const long = documentOf(200);
    const small = time(() => press(short.before, short.at, '*'));
    expect(time(() => press(long.before, long.at, '*'))).toBeLessThan(small * 3 + 5);
  });
});
