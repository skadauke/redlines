import { describe, expect, it } from 'vitest';
import { inspectPlace, stepLeft, stepRight } from './inline.ts';
import type { Place } from './inline.ts';

/** The place of the ‸ in `marked`, which is taken out of the text. */
const CARET = '‸';

function place(marked: string, hidden: { from: number; to: number }[] = []): Place {
  return inspectPlace(marked.replace(CARET, ''), hidden, marked.indexOf(CARET));
}

const OK = { kind: 'ok' };

/** The construct a place is inside of, as the text of it. */
function construct(marked: string): string | undefined {
  const found = place(marked);
  if (found.kind !== 'construct') return undefined;
  return marked.replace(CARET, '').slice(found.from, found.to);
}

describe('inside a line (format §3.1)', () => {
  it('allows a position between two characters of ordinary text', () => {
    expect(place('one t‸wo three')).toEqual(OK);
    expect(place('one‸ two')).toEqual(OK);
    expect(place('one ‸two')).toEqual(OK);
    expect(place('café 😀‸ x')).toEqual(OK);
  });

  it('allows the text of an inline link and the edges of the link', () => {
    expect(place('see [the gu‸ide](https://example.org/a "T") now')).toEqual(OK);
    expect(place('see [the guide‸](https://example.org/a) now')).toEqual(OK);
    expect(place('see ‸[the guide](https://example.org/a) now')).toEqual(OK);
    expect(place('see [the guide](https://example.org/a)‸ now')).toEqual(OK);
    expect(place('see [‸the guide](https://example.org/a) now')).toEqual(OK);
  });

  it('puts a position in the destination or title of a link on the whole link', () => {
    const link = '[the guide](https://example.org/a "The title")';
    expect(construct(`see [the guide]‸(https://example.org/a "The title") now`)).toBe(link);
    expect(construct(`see [the guide](https://exa‸mple.org/a "The title") now`)).toBe(link);
    expect(construct(`see [the guide](https://example.org/a "The ‸title") now`)).toBe(link);
    expect(construct(`see [the guide](https://example.org/a "The title"‸) now`)).toBe(link);
    expect(construct(`see [the guide](‸https://example.org/a "The title") now`)).toBe(link);
  });

  it('knows a link whose text wraps over two lines', () => {
    const link = '[the\nguide](https://example.org/a)';
    expect(construct('see [the\nguide](https://exa‸mple.org/a) now')).toBe(link);
    expect(place('see [the\ngu‸ide](https://example.org/a) now')).toEqual(OK);
  });

  it('puts a position in an image, in its alt text or its source, on the whole image', () => {
    const image = '![A cat](cat.png "Cat")';
    expect(construct('a ![A ‸cat](cat.png "Cat") b')).toBe(image);
    expect(construct('a ![A cat](ca‸t.png "Cat") b')).toBe(image);
    expect(construct('a !‸[A cat](cat.png "Cat") b')).toBe(image);
    expect(place('a ‸![A cat](cat.png "Cat") b')).toEqual(OK);
    expect(place('a ![A cat](cat.png "Cat")‸ b')).toEqual(OK);
  });

  it('puts a position in the label of a reference link on the whole link', () => {
    const text = 'see [the guide][g] now\n\n[g]: https://example.org/a\n';
    const inLabel = text.indexOf('[g]') + 1;
    expect(inspectPlace(text, [], inLabel)).toMatchObject({ kind: 'construct', from: 4, to: 18 });
    // The text of a full reference link is fine.
    expect(inspectPlace(text, [], text.indexOf('guide'))).toEqual(OK);
  });

  it('puts a position in a shortcut or collapsed reference, which has a definition, on all of it', () => {
    const text = 'see [guide] and [guide][] now\n\n[guide]: https://example.org/a\n';
    expect(inspectPlace(text, [], text.indexOf('uide'))).toMatchObject({
      kind: 'construct',
      from: 4,
      to: 11,
    });
    expect(inspectPlace(text, [], text.lastIndexOf('uide][]'))).toMatchObject({
      kind: 'construct',
      from: 16,
      to: 25,
    });
  });

  it('takes brackets that are not links for text', () => {
    expect(place('a [sic‸] b')).toEqual(OK);
    expect(place('a [x‸] (y) b')).toEqual(OK);
    expect(place('see [gu‸ide] and more\n\n[other]: https://example.org/a')).toEqual(OK);
  });

  it('puts a position inside an autolink, a bare URL, an entity or a tag on the whole of it', () => {
    expect(construct('go to <https://exa‸mple.org> now')).toBe('<https://example.org>');
    expect(construct('write <ada@exa‸mple.org> now')).toBe('<ada@example.org>');
    expect(construct('go to https://exa‸mple.org/a?b=1 now')).toBe('https://example.org/a?b=1');
    expect(construct('mail ada@exam‸ple.org please')).toBe('ada@example.org');
    expect(construct('a &am‸p; b')).toBe('&amp;');
    expect(construct('a &#1‸60; b')).toBe('&#160;');
    expect(construct('a <sp‸an class="x">b</span>')).toBe('<span class="x">');
    expect(place('a &amp;‸ b')).toEqual(OK);
    expect(place('go to https://example.org/a‸. Then')).toEqual(OK);
    // The full stop that ends the sentence is not part of the URL.
    expect(construct('go to https://example.org/a.‸ Then')).toBeUndefined();
  });

  it('does not allow a position directly before www.', () => {
    expect(place('see ‸www.example.org now')).toMatchObject({ kind: 'refuse' });
    expect(construct('see www.exam‸ple.org now')).toBe('www.example.org');
    expect(place('see www.example.org‸ now')).toEqual(OK);
  });

  it('puts a position in a footnote reference, math or an emoji shortcode on the whole of it', () => {
    expect(construct('a[^no‸te] b')).toBe('[^note]');
    expect(construct('the $x^‸2$ term')).toBe('$x^2$');
    expect(construct('a :smi‸le: b')).toBe(':smile:');
    // Dollar amounts and times are not math or a shortcode.
    expect(place('costs $5 and ‸$6 more')).toEqual(OK);
    expect(place('at 10:‸30:45 today')).toEqual(OK);
  });

  it('knows every shape of an emoji shortcode: gemoji names have digits, `+`, `-` and `_` in them (#312)', () => {
    for (const code of [
      ':smile:',
      ':+1:',
      ':-1:',
      ':100:',
      ':1234:',
      ':8ball:',
      ':1st_place_medal:',
      ':t-rex:',
      ':e-mail:',
      ':non-potable_water:',
      ':flag_de:',
      ':x:',
      ':a:',
    ]) {
      const half = Math.floor(code.length / 2);
      const marked = `a ${code.slice(0, half)}‸${code.slice(half)} b`;
      expect(construct(marked), code).toBe(code);
    }
    // A name starts and ends with a letter or a digit, and parts its words with one `_` or `-`.
    for (const text of ['see :_th‸is_: ok', 'see :-x‸-: ok', 'see :a‸b_: ok', 'see :a‸-_b: ok']) {
      expect(place(text), text).toEqual(OK);
    }
    // Times and ratios are no shortcode, and neither are words with a colon in them.
    for (const text of [
      'at 10:‸30:45 today',
      'a 1:‸2:3 ratio',
      'Note:‸ this',
      'one :‸ two',
      'a ::‸:: b',
      'the :‸xy z',
      'the :‸Smile: b',
    ]) {
      expect(place(text), text).toEqual(OK);
    }
  });

  it('keeps a position between a letter and a shortcode free of markers, and no other (#312)', () => {
    // A marker there would leave the shortcode at the start of a text, where GitHub shows it as the
    // emoji, as it doesn't with the letter against it.
    const refused = {
      kind: 'refuse',
      reason:
        'A marker between a letter and an emoji shortcode would make it show as an emoji. Select the shortcode along with the word.',
    };
    expect(place('a‸:tent: b')).toEqual(refused);
    expect(place('é‸:tent: b')).toEqual(refused);
    expect(place('日‸:tent: b')).toEqual(refused);
    expect(place('9‸:tent: b')).toEqual(refused);
    expect(place('a‸:+1: b')).toEqual(refused);
    // Inside it a position is on the whole shortcode, as in an entity.
    expect(construct('a:te‸nt: b')).toBe(':tent:');
    // A letter after it changes nothing: GitHub shows the emoji there too.
    expect(place('a :tent:‸b')).toEqual(OK);
    expect(place('a :tent:‸9')).toEqual(OK);
    // Next to a space, punctuation or another shortcode it is as free as any text.
    expect(place('a ‸:tent: b')).toEqual(OK);
    expect(place('a :tent:‸ b')).toEqual(OK);
    expect(place('(‸:tent:) b')).toEqual(OK);
    expect(place('a (:tent:‸)')).toEqual(OK);
    expect(place('x:‸:tent: b')).toEqual(OK);
    expect(place('a :tent:‸. b')).toEqual(OK);
    expect(place(':smile:‸:tent: b')).toEqual(OK);
  });

  it('puts a position inside an emoji that is more than one character on the whole of it (#312)', () => {
    const sequences: [string, string][] = [
      ['family', '👨‍👩‍👧'],
      ['couple', '👩‍❤️‍👨'],
      ['skin tone', '👍🏽'],
      ['flag', '🇩🇪'],
      ['keycap', '1️⃣'],
      ['heart with a variation selector', '❤️'],
      ['person with a ZWJ and a tone', '🧑🏽‍💻'],
      ['subdivision flag', '🏴󠁧󠁢󠁥󠁮󠁧󠁿'],
    ];
    for (const [name, emoji] of sequences) {
      const units = [...emoji];
      // Between any two of its code points, and not at its edges.
      for (let cut = 1; cut < units.length; cut++) {
        const marked = `a ${units.slice(0, cut).join('')}‸${units.slice(cut).join('')} b`;
        expect(construct(marked), `${name} at ${cut}`).toBe(emoji);
      }
      expect(place(`a ‸${emoji} b`), `${name} before`).toEqual(OK);
      expect(place(`a ${emoji}‸ b`), `${name} after`).toEqual(OK);
    }
    // A picture of one code point is two UTF-16 units, which a position doesn't part.
    expect(construct('a \uD83D‸\uDE00 b')).toBe('😀');
    expect(place('a 😀‸ b')).toEqual(OK);
    expect(place('a ‸😀 b')).toEqual(OK);
  });

  it('puts a position between a backslash and the next character on the escape', () => {
    expect(construct('a \\‸* b')).toBe('\\*');
    expect(construct('a \\‸n b')).toBe('\\n');
    expect(place('a \\\\‸ b')).toEqual(OK);
  });

  it('does not allow a position after a backslash at the end of a line', () => {
    expect(place('a b\\‸')).toMatchObject({ kind: 'refuse' });
    expect(place('a b\\‸\nc')).toMatchObject({ kind: 'refuse' });
  });

  it('does not allow a position between a hard break’s trailing spaces and the line end', () => {
    expect(place('one  ‸\ntwo')).toMatchObject({ kind: 'refuse' });
    expect(place('one ‸  \ntwo')).toMatchObject({ kind: 'refuse' });
    expect(place('one‸  \ntwo')).toEqual(OK);
    expect(place('one ‸\ntwo')).toEqual(OK);
  });

  it('keeps a position away from the inner side of emphasis that would stop flanking', () => {
    // Intraword **: a marker inside would stop it from being a delimiter.
    expect(place('foo**‸bar**baz')).toEqual({ kind: 'flank' });
    expect(place('foo**bar‸**baz')).toEqual({ kind: 'flank' });
    expect(place('foo*‸bar*baz')).toEqual({ kind: 'flank' });
    expect(place('foo~~‸bar~~baz')).toEqual({ kind: 'flank' });
    // Next to a _ whose other neighbor is a letter.
    expect(place('snake_‸case')).toEqual({ kind: 'flank' });
    expect(place('snake‸_case')).toEqual({ kind: 'flank' });
  });

  it('allows a position next to emphasis that has a space, punctuation or the line edge outside', () => {
    expect(place('a **‸bold** b')).toEqual(OK);
    expect(place('a **bold‸** b')).toEqual(OK);
    expect(place('**‸bold**')).toEqual(OK);
    expect(place('(*‸it*)')).toEqual(OK);
    expect(place('a **bold**‸ b')).toEqual(OK);
    expect(place('a ‸**bold** b')).toEqual(OK);
    expect(place('a _‸it_ b')).toEqual(OK);
  });

  it('looks past hidden markers for the neighbors', () => {
    const text = 'foo**<!--ins k3x9-->bar**baz';
    expect(inspectPlace(text, [{ from: 5, to: 20 }], 20)).toEqual({ kind: 'flank' });
    expect(inspectPlace(text, [{ from: 5, to: 20 }], 5)).toEqual({ kind: 'flank' });
  });

  it('lets the neighbors be given: the text that is typed', () => {
    // A marker that closes an insertion, in front of "**bar".
    expect(inspectPlace('foo**bar', [], 3, { before: ' ' })).toEqual(OK);
    expect(inspectPlace('foo**bar', [], 3, { before: 'x' })).toEqual({ kind: 'flank' });
    expect(inspectPlace('foo**bar', [], 3)).toEqual({ kind: 'flank' });
    expect(inspectPlace('foo bar', [], 3, { after: '*' })).toEqual(OK);
  });
});

describe('line starts (format §3.2, §3.3)', () => {
  it('starts a block at the first character of a paragraph, an item or a quote line', () => {
    expect(place('‸Para text.')).toEqual({ kind: 'block' });
    expect(place('One.\n\n‸Two.')).toEqual({ kind: 'block' });
    expect(place('- one\n- ‸two')).toEqual({ kind: 'block' });
    expect(place('> ‸quoted')).toEqual({ kind: 'block' });
    // The text of a heading follows its #s on the same line, so nothing stands alone before it.
    expect(place('## ‸Heading')).toEqual(OK);
    expect(place('3. ‸three')).toEqual({ kind: 'block' });
  });

  it('is a continuation at the start of a wrapped line', () => {
    expect(place('one two\n‸three four')).toEqual({ kind: 'continuation' });
    expect(place('- one two\n  ‸three')).toEqual({ kind: 'continuation' });
    expect(place('> one two\n> ‸three')).toEqual({ kind: 'continuation' });
  });

  it('refuses a position inside a block’s prefix, or in front of it', () => {
    expect(place('-‸ one')).toMatchObject({ kind: 'refuse' });
    expect(place('‸- one')).toMatchObject({ kind: 'refuse' });
    expect(place('#‸# Heading')).toMatchObject({ kind: 'refuse' });
    expect(place('‸## Heading')).toMatchObject({ kind: 'refuse' });
    expect(place('‸> quote')).toMatchObject({ kind: 'refuse' });
    expect(place('- [‸x] done')).toMatchObject({ kind: 'refuse' });
  });

  it('refuses a position on a line that is only syntax', () => {
    expect(place('Title\n==‸===')).toMatchObject({ kind: 'refuse' });
    expect(place('Title\n--‸---')).toMatchObject({ kind: 'refuse' });
    expect(place('para\n\n--‸-\n\nnext')).toMatchObject({ kind: 'refuse' });
    expect(place('| a | b |\n|--‸-|---|\n| 1 | 2 |')).toMatchObject({ kind: 'refuse' });
    expect(place('para\n\n``‸`js\ncode\n```')).toMatchObject({ kind: 'refuse' });
  });

  it('allows a position in a table cell, but not in front of the row', () => {
    expect(place('| a | b |\n|---|---|\n| 1 | ‸2 |')).toEqual(OK);
    expect(place('| a | b |\n|---|---|\n| 1‸ | 2 |')).toEqual(OK);
    expect(place('| a | b |\n|---|---|\n‸| 1 | 2 |')).toMatchObject({ kind: 'refuse' });
  });

  it('refuses a position after the closing hashes or attributes of a heading', () => {
    expect(place('## Title‸ ##')).toEqual(OK);
    expect(place('## Title ##‸')).toMatchObject({ kind: 'refuse' });
    expect(place('## Title #‸#')).toMatchObject({ kind: 'refuse' });
    expect(place('## Title‸ {#id}')).toEqual(OK);
    expect(place('## Title {#id}‸')).toMatchObject({ kind: 'refuse' });
    expect(place('## Title {#‸id}')).toMatchObject({ kind: 'refuse' });
  });

  it('counts a line made of markers as blank', () => {
    const text = '<!--cmt c9qf-->\nText here.';
    expect(inspectPlace(text, [{ from: 0, to: 15 }], 16)).toEqual({ kind: 'block' });
  });
});

describe('stepping to the next boundary', () => {
  const text = 'a<!--ins k3x9-->b😀c';
  const hidden = [{ from: 1, to: 16 }];

  it('moves by a character and over a marker', () => {
    expect(stepLeft(text, hidden, 17)).toBe(16);
    expect(stepLeft(text, hidden, 16)).toBe(0);
    expect(stepLeft(text, hidden, 19)).toBe(17);
    expect(stepRight(text, hidden, 0)).toBe(1);
    expect(stepRight(text, hidden, 1)).toBe(17);
    expect(stepRight(text, hidden, 17)).toBe(19);
  });

  it('stops at the ends of the text', () => {
    expect(stepLeft(text, hidden, 0)).toBe(0);
    expect(stepRight(text, hidden, text.length)).toBe(text.length);
  });
});
