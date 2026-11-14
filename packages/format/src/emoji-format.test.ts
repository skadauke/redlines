// Emoji and emoji shortcodes in tracked changes (#312, format §3.1, rules 1 and 9): a marker never
// goes inside an emoji or a shortcode, a change that starts inside one takes all of it, and none
// goes between a letter or a digit and a shortcode, where GitHub would show it as the emoji.

import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { accept, acceptAll, reject, rejectAll } from './decide.ts';
import { EditError } from './errors.ts';
import type { FormatOp } from './format-ops.ts';
import { trackedFormat } from './formatting.ts';
import { ada, bodyOf, context } from './test-helpers.ts';
import { fuzzCount, seeded } from './random-docs.ts';
import { trackedEdit } from './track.ts';
import { untrackedEdit } from './untracked.ts';
import type { Range, TextChange } from './types.ts';

const STUCK = /between a letter and an emoji shortcode/;
const IDS = ['k3x9', 'p7qd'];
const bold: FormatOp = { kind: 'inline', format: 'bold', on: true };

/** A tracked edit, as the new file. */
const edit = (text: string, change: TextChange): string =>
  applyChanges(text, trackedEdit(text, change, context(ada, IDS)));

/** The text of a file's body, ending in one line break. */
const body = (text: string) => `${bodyOf(text).replace(/[\r\n]+$/, '')}\n`;

const rejected = (file: string, id = 'k3x9') => body(applyChanges(file, reject(file, id)));
const accepted = (file: string, id = 'k3x9') => body(applyChanges(file, accept(file, id)));

/** The message of the refusal, or `undefined` when the change is made. */
function refusal(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    if (error instanceof EditError) return error.message;
    throw error;
  }
  return undefined;
}

const rangeOf = (text: string, word: string): Range => {
  const from = text.indexOf(word);
  if (from === -1) throw new Error(`${word} is not in the text`);
  return { from, to: from + word.length };
};

const formatted = (text: string, range: Range): string =>
  body(applyChanges(text, trackedFormat(text, range, bold, context(ada, ['m2bd'])).changes));

describe('an emoji of several code points, in a tracked change (#312)', () => {
  const FAMILY = '👨‍👩‍👧';
  const units = [...FAMILY];
  const text = `A ${FAMILY} here.\n`;
  const from = 2;
  const to = from + FAMILY.length;

  it('is deleted whole in one deletion, and rejecting and accepting give it back and take it away', () => {
    const after = edit(text, { from, to, insert: '' });
    expect(body(after)).toBe(`A <!--del k3x9 ${FAMILY}--> here.\n`);
    expect(rejected(after)).toBe(text);
    expect(accepted(after)).toBe('A  here.\n');
  });

  it('is replaced whole when a change starts inside it: the old picture in the mark, the rest as typed', () => {
    for (let cut = 1; cut < units.length; cut++) {
      const left = units.slice(0, cut).join('');
      const after = edit(text, { from: from + left.length, to, insert: '' });
      expect(body(after), `from ${cut}`).toBe(
        `A <!--sub k3x9 ${FAMILY}-->${left}<!--/k3x9--> here.\n`,
      );
      expect(rejected(after), `from ${cut}`).toBe(text);
    }
  });

  it('reads alike in both views when a deletion ends inside it', () => {
    for (let cut = 1; cut < units.length; cut++) {
      const left = units.slice(0, cut).join('');
      const rest = units.slice(cut).join('');
      const after = edit(text, { from, to: from + left.length, insert: '' });
      expect(rejected(after), `to ${cut}`).toBe(text);
      expect(accepted(after), `to ${cut}`).toBe(`A ${rest} here.\n`);
    }
  });

  it('takes a letter typed inside it as a change of the whole, with the old picture in the mark', () => {
    const inside = from + '👨‍'.length;
    const after = edit(text, { from: inside, to: inside, insert: 'x' });
    expect(body(after)).toBe(`A <!--sub k3x9 ${FAMILY}-->👨‍x👩‍👧<!--/k3x9--> here.\n`);
    expect(rejected(after)).toBe(text);
  });

  it('takes a keycap, a flag, a skin tone and a heart as one character each', () => {
    for (const emoji of ['1️⃣', '🇩🇪', '👍🏽', '❤️', '🧑🏽‍💻']) {
      const file = `A ${emoji} here.\n`;
      const middle = 2 + [...emoji][0]!.length;
      const after = edit(file, { from: middle, to: middle, insert: 'x' });
      expect(body(after), emoji).toContain(`<!--sub k3x9 ${emoji}-->`);
      expect(rejected(after), emoji).toBe(file);
    }
  });
});

describe('a character outside the first plane, in a tracked change (#312)', () => {
  const text = 'A 😀 here.\n';

  it('is deleted whole, or typed whole', () => {
    expect(body(edit(text, { from: 2, to: 4, insert: '' }))).toBe('A <!--del k3x9 😀--> here.\n');
    expect(body(edit(text, { from: 4, to: 4, insert: '🎉' }))).toBe(
      'A 😀<!--ins k3x9-->🎉<!--/k3x9--> here.\n',
    );
  });

  it('is refused when an edit starts or ends between its two code units, or types half of one', () => {
    const why = /cut a character in two/;
    expect(refusal(() => edit(text, { from: 2, to: 3, insert: '' }))).toMatch(why);
    expect(refusal(() => edit(text, { from: 3, to: 4, insert: '' }))).toMatch(why);
    expect(refusal(() => edit(text, { from: 3, to: 3, insert: 'x' }))).toMatch(why);
    expect(refusal(() => edit(text, { from: 5, to: 5, insert: '\ud83d' }))).toMatch(why);
    expect(refusal(() => edit(text, { from: 5, to: 5, insert: '\ude00' }))).toMatch(why);
  });
});

describe('a character outside the first plane, in a plain edit (#312)', () => {
  const text = 'A 😀 here.\n';

  it('is deleted or typed whole, and refused when an edit cuts it in two or types half of one', () => {
    expect(applyChanges(text, untrackedEdit(text, { from: 2, to: 4, insert: '' }))).toBe(
      'A  here.\n',
    );
    expect(applyChanges(text, untrackedEdit(text, { from: 4, to: 4, insert: '🎉' }))).toBe(
      'A 😀🎉 here.\n',
    );
    const why = /cut a character in two/;
    for (const edit of [
      { from: 2, to: 3, insert: '' },
      { from: 3, to: 4, insert: '' },
      { from: 3, to: 3, insert: 'x' },
      { from: 5, to: 5, insert: '\ud83d' },
    ]) {
      expect(
        refusal(() => untrackedEdit(text, edit)),
        JSON.stringify(edit),
      ).toMatch(why);
    }
  });
});

describe('an emoji shortcode, in a tracked change (#312)', () => {
  const text = 'Camp :tent: here.\n';

  it('is deleted whole, and a change that starts inside it takes all of it', () => {
    expect(body(edit(text, { from: 5, to: 11, insert: '' }))).toBe(
      'Camp <!--del k3x9 :tent:--> here.\n',
    );
    const inside = edit(text, { from: 8, to: 11, insert: '' });
    expect(body(inside)).toBe('Camp <!--sub k3x9 :tent:-->:te<!--/k3x9--> here.\n');
    expect(rejected(inside)).toBe(text);
  });

  it('reads alike in both views when a deletion ends inside it', () => {
    const after = edit(text, { from: 5, to: 8, insert: '' });
    expect(rejected(after)).toBe(text);
    expect(accepted(after)).toBe('Camp nt: here.\n');
  });

  it('is replaced whole when text is typed inside it', () => {
    const after = edit(text, { from: 8, to: 8, insert: 'X' });
    expect(body(after)).toBe('Camp <!--sub k3x9 :tent:-->:teXnt:<!--/k3x9--> here.\n');
    expect(rejected(after)).toBe(text);
    expect(accepted(after)).toBe('Camp :teXnt: here.\n');
  });

  it('takes typing next to it as any, and a letter after it, which GitHub shows the emoji with', () => {
    expect(body(edit(text, { from: 5, to: 5, insert: 'big ' }))).toBe(
      'Camp <!--ins k3x9-->big <!--/k3x9-->:tent: here.\n',
    );
    expect(body(edit(text, { from: 11, to: 11, insert: 'z' }))).toBe(
      'Camp :tent:<!--ins k3x9-->z<!--/k3x9--> here.\n',
    );
    const after = ':tent:abc here.\n';
    expect(body(edit(after, { from: 6, to: 7, insert: '' }))).toBe(
      ':tent:<!--del k3x9 a-->bc here.\n',
    );
    expect(body(edit(after, { from: 6, to: 6, insert: 'x' }))).toBe(
      ':tent:<!--ins k3x9-->x<!--/k3x9-->abc here.\n',
    );
  });

  it('is bold with the markers outside it, and a format that starts inside it reaches over all of it', () => {
    const whole = 'Camp <!--fmt m2bd +bold-->**:tent:**<!--/m2bd--> here.\n';
    expect(formatted(text, rangeOf(text, ':tent:'))).toBe(whole);
    expect(formatted(text, { from: 8, to: 11 })).toBe(whole);
  });

  it('is not a shortcode in a time or a word with colons: those take edits as any text', () => {
    for (const file of ['at 10:30:45 and more\n', 'Note: ok\n', 'x :y z\n']) {
      for (let at = 1; at < file.length - 1; at++) {
        const why = refusal(() => edit(file, { from: at, to: at, insert: 'q' })) ?? '';
        expect(why, `${file} ${at}`).not.toMatch(STUCK);
      }
    }
  });
});

describe('no marker goes between a letter or a digit and a shortcode (#312)', () => {
  const text = 'Say abc:tent: here.\n';
  const at = text.indexOf(':');

  it('refuses to delete or replace the letter in front of one, in words that say why', () => {
    expect(refusal(() => edit(text, { from: at - 1, to: at, insert: '' }))).toMatch(STUCK);
    for (const glued of ['Say a9:smile: here.\n', 'Say né:tent: here.\n']) {
      const colon = glued.indexOf(':');
      expect(
        refusal(() => edit(glued, { from: colon - 1, to: colon, insert: '' })),
        glued,
      ).toMatch(STUCK);
    }
  });

  it('takes the shortcode into the change when text typed or replaced would end against it', () => {
    // The closer would stand between the new letter and the shortcode: the change reaches over the
    // shortcode instead, as a substitution of it, which reads alike in both views and on GitHub.
    const typed = edit(text, { from: at, to: at, insert: 'd' });
    expect(body(typed)).toBe('Say abc<!--sub k3x9 :tent:-->d:tent:<!--/k3x9--> here.\n');
    expect(rejected(typed)).toBe(text);
    expect(accepted(typed)).toBe('Say abcd:tent: here.\n');
    // The word in front of one replaced by another.
    const replaced = edit(text, { from: at - 3, to: at, insert: 'xyz' });
    expect(body(replaced)).toBe('Say <!--sub k3x9 abc:tent:-->xyz:tent:<!--/k3x9--> here.\n');
    expect(rejected(replaced)).toBe(text);
  });

  it('takes typing in front of a shortcode that a space or the start of the text is before', () => {
    for (const [file, insert, expected] of [
      ['Camp :tent: here.\n', 'x', 'Camp <!--sub k3x9 :tent:-->x:tent:<!--/k3x9--> here.\n'],
      // At the start of an item's text the opener follows the bullet, and the text starts the next line.
      ['- :tent: item\n', 'T', '- <!--sub k3x9 :tent:-->\n  T:tent:<!--/k3x9--> item\n'],
    ] as const) {
      const colon = file.indexOf(':');
      const after = edit(file, { from: colon, to: colon, insert });
      expect(body(after), file).toBe(expected);
      expect(rejected(after), file).toBe(file);
      expect(accepted(after), file).toBe(file.replace(':', `${insert}:`));
    }
    // At the start of a block the opener goes on the line before it, as for any text there.
    const first = ':tent: Camp\n';
    const started = edit(first, { from: 0, to: 0, insert: 'G' });
    expect(rejected(started)).toBe(first);
    expect(accepted(started)).toBe('G:tent: Camp\n');
  });

  it('refuses the opener that would stand between a letter and a shortcode, with words to follow', () => {
    const why = refusal(() => edit(text, { from: at - 1, to: at, insert: '' }));
    expect(why).toMatch(STUCK);
    // Raw is read-only while Track Changes is on, which is when this is said: it is no advice.
    expect(why).not.toMatch(/Raw/);
  });

  it('takes a space or punctuation typed there, and a word replaced by one that ends in a space', () => {
    expect(body(edit(text, { from: at, to: at, insert: ' ' }))).toBe(
      'Say abc<!--ins k3x9--> <!--/k3x9-->:tent: here.\n',
    );
    expect(refusal(() => edit(text, { from: at - 3, to: at, insert: 'xyz ' }))).toBeUndefined();
    expect(refusal(() => edit(text, { from: at, to: at, insert: '— ' }))).toBeUndefined();
  });

  it('refuses a format whose marker would stand there: the shortcode, or the word before it', () => {
    expect(refusal(() => trackedFormat(text, rangeOf(text, ':tent:'), bold, context(ada)))).toMatch(
      STUCK,
    );
    expect(refusal(() => trackedFormat(text, rangeOf(text, 'abc'), bold, context(ada)))).toMatch(
      STUCK,
    );
    // The word and the shortcode together have their markers at the outer edges.
    expect(formatted(text, rangeOf(text, 'abc:tent:'))).toBe(
      'Say <!--fmt m2bd +bold-->**abc:tent:**<!--/m2bd--> here.\n',
    );
  });

  it('takes the deletion of the shortcode itself: its text is in the mark, with no letter against it', () => {
    expect(body(edit(text, { from: at, to: at + 6, insert: '' }))).toBe(
      'Say abc<!--del k3x9 :tent:--> here.\n',
    );
  });

  it('refuses nothing where a space, punctuation or the start of a text is in front of it', () => {
    for (const file of ['Say :tent: here.\n', 'Say (:tent:) here.\n', 'Say — :tent: x\n']) {
      const colon = file.indexOf(':');
      expect(
        refusal(() => edit(file, { from: colon, to: colon, insert: 'big ' })),
        file,
      ).toBe(undefined);
    }
    expect(refusal(() => edit(':tent: here.\n', { from: 0, to: 0, insert: 'x ' }))).toBeUndefined();
  });
});

describe('no edit puts a marker between a letter and a shortcode, in any of its edits (#312)', () => {
  const LINES = [
    'Camp :tent: here.\n',
    'abc:tent: here.\n',
    ':+1: done\n',
    'x :smile::tent: y\n',
    '- :rocket: Launch\n',
    '## :tada: Title\n',
    'Say a9:smile: ok, :t-rex:rex\n',
    '> Quote :tent:\n',
  ];
  const TYPED = ['x', ' ', 'é', '9', '— ', 'new words', 'Q '];
  // A letter or a digit, markers, and a shortcode: what a reader of the file sees as the shortcode at
  // the start of a text, which GitHub shows as the emoji.
  const STUCK_IN_FILE =
    /[\p{L}\p{N}](?:<!--(?:(?!-->)[^])*-->)+:(?:[abmovx]|\+1|-1|100|1234|[a-z0-9]+(?:[_-][a-z0-9]+)*):/u;

  it('is held by every tracked edit of a few lines, which also read alike in both views', () => {
    let made = 0;
    let refused = 0;
    for (let seed = 1; seed <= fuzzCount(300); seed++) {
      const random = seeded(seed * 7919);
      const below = (n: number) => Math.floor(random() * n);
      const line = LINES[below(LINES.length)] as string;
      // After the line's own syntax (a bullet, a quote mark, `##`), which an edit may not splice.
      const start = /^(?:[-*>][ \t]+|#{1,6}[ \t]+)?/.exec(line)![0].length;
      const end = line.length - 1;
      const from = start + below(end - start + 1);
      const to = Math.min(end, from + (below(3) === 0 ? 0 : 1 + below(5)));
      const insert = below(4) === 0 ? '' : (TYPED[below(TYPED.length)] as string);
      if (from === to && insert === '') continue;
      const label = `seed ${seed}: ${JSON.stringify(line)} ${from}-${to} ${JSON.stringify(insert)}`;
      let after: string;
      try {
        after = applyChanges(line, trackedEdit(line, { from, to, insert }, context(ada, IDS)));
      } catch (error) {
        if (error instanceof EditError) {
          refused++;
          continue;
        }
        throw error;
      }
      made++;
      expect(bodyOf(after), label).not.toMatch(STUCK_IN_FILE);
      const plain = line.slice(0, from) + insert + line.slice(to);
      expect(body(applyChanges(after, acceptAll(after))), label).toBe(plain);
      expect(body(applyChanges(after, rejectAll(after))), label).toBe(line);
    }
    expect(made).toBeGreaterThan(100);
    expect(refused).toBeGreaterThan(0);
  });
});
