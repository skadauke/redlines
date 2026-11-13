// The type of an alert (#311, format §2.6, §3.3): `> [!NOTE]` and its kin are GitHub alerts, and
// changing the type is a block format change, `was=callout-TYPE`, that rejecting writes back.

import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { accept, reject } from './decide.ts';
import { EditError } from './errors.ts';
import type { FormatOp } from './format-ops.ts';
import { parseFormatOps } from './format-ops.ts';
import { formatChange } from './format-blocks.ts';
import { trackedFormat, untrackedFormat } from './formatting.ts';
import { parse } from './parse.ts';
import { ada, bo, bodyOf, context, expectEveryDecision, file, thread } from './test-helpers.ts';
import type { Range } from './types.ts';
import { newestView, originalView } from './views.ts';

const callout = (type: string): FormatOp => ({ kind: 'callout', type });
const ctx = (...ids: string[]) => context(ada, ids.length > 0 ? ids : ['m2bd']);

/** A tracked change, as the new file. */
const change = (text: string, range: Range, op: FormatOp, c = ctx()): string =>
  applyChanges(text, trackedFormat(text, range, op, c).changes);

/** The body of a file, ending in one line break: a ledger leaves a blank line in front of it. */
const body = (text: string) => `${bodyOf(text).replace(/[\r\n]+$/, '')}\n`;

const rejected = (text: string, id: string) => applyChanges(text, reject(text, id));
const accepted = (text: string, id: string) => applyChanges(text, accept(text, id));

/** The range of `word` in `text`: a caret in its middle. */
const inside = (text: string, word: string): Range => {
  const at = text.indexOf(word) + 1;
  if (at === 0) throw new Error(`${word} is not in the text`);
  return { from: at, to: at };
};

const messageOf = (run: () => unknown): string => {
  try {
    run();
  } catch (error) {
    if (error instanceof EditError) return `${error.code ?? 'no code'}: ${error.message}`;
    throw error;
  }
  return 'no error';
};

const ALERT = 'Intro.\n\n> [!NOTE]\n> Useful information.\n\nAfter.\n';

describe('changing the type of an alert, tracked (#311)', () => {
  it('is a block format change: the opener alone before the alert, the closer at its end', () => {
    const after = change(ALERT, inside(ALERT, 'Useful'), callout('tip'));
    expect(body(after)).toBe(
      'Intro.\n\n<!--fmt m2bd was=callout-note-->\n\n> [!TIP]\n> Useful information.<!--/m2bd-->\n\nAfter.\n',
    );
    expect(parse(after).ledger.marks['m2bd']).toEqual({ by: 'ada', at: '2026-10-31T09:00Z' });
  });

  it('rejecting gives back the exact bytes, and accepting leaves the new type', () => {
    const after = change(ALERT, inside(ALERT, 'Useful'), callout('tip'));
    expect(rejected(after, 'm2bd')).toBe(ALERT);
    expect(accepted(after, 'm2bd')).toBe('Intro.\n\n> [!TIP]\n> Useful information.\n\nAfter.\n');
  });

  it('is read by the views: the newest has the new type, the original the old one', () => {
    const after = change(ALERT, inside(ALERT, 'Useful'), callout('warning'));
    expect(newestView(after).text).toContain('> [!WARNING]');
    expect(originalView(after).text).toContain('> [!NOTE]');
    expect(originalView(after).text).not.toContain('WARNING');
  });

  it('is named by what it did, for the cards', () => {
    const after = change(ALERT, inside(ALERT, 'Useful'), callout('important'));
    const [mark] = parse(after).marks;
    expect(mark && formatChange(parse(after), mark)).toEqual([callout('important')]);
    const [op] = parseFormatOps('was=callout-note');
    expect(op?.inverse).toEqual(callout('note'));
  });

  it('takes the caret anywhere in the alert: the title, any line of its body', () => {
    const long = 'Intro.\n\n> [!CAUTION]\n> One.\n>\n> Two, in another paragraph.\n\nAfter.\n';
    for (const word of ['CAUTION', 'One', 'another']) {
      const after = change(long, inside(long, word), callout('tip'));
      expect(body(after), word).toBe(
        'Intro.\n\n<!--fmt m2bd was=callout-caution-->\n\n> [!TIP]\n> One.\n>\n> Two, in another paragraph.<!--/m2bd-->\n\nAfter.\n',
      );
      expect(rejected(after, 'm2bd'), word).toBe(long);
    }
  });

  it('asks nothing for the type it has', () => {
    expect(trackedFormat(ALERT, inside(ALERT, 'Useful'), callout('note'), ctx()).changes).toEqual(
      [],
    );
  });

  it('keeps a type written in lowercase, and rejecting writes it back as it was', () => {
    const source = 'Intro.\n\n> [!note]\n> Useful information.\n\nAfter.\n';
    const after = change(source, inside(source, 'Useful'), callout('tip'));
    expect(body(after)).toBe(
      'Intro.\n\n<!--fmt m2bd was=callout-note=note-->\n\n> [!TIP]\n> Useful information.<!--/m2bd-->\n\nAfter.\n',
    );
    expect(rejected(after, 'm2bd')).toBe(source);
  });

  it('writes a type that GitHub has not in lowercase, and keeps a title and a fold mark', () => {
    const source = 'Intro.\n\n> [!NOTE]- A title\n> Useful information.\n\nAfter.\n';
    const after = change(source, inside(source, 'Useful'), callout('info'));
    expect(body(after)).toBe(
      'Intro.\n\n<!--fmt m2bd was=callout-note-->\n\n> [!info]- A title\n> Useful information.<!--/m2bd-->\n\nAfter.\n',
    );
    expect(rejected(after, 'm2bd')).toBe(source);
  });

  it('turning your own change back takes the mark away, and changing it again keeps one', () => {
    const tip = change(ALERT, inside(ALERT, 'Useful'), callout('tip'));
    const back = trackedFormat(tip, inside(tip, 'Useful'), callout('note'), ctx('z9z9'));
    expect(applyChanges(tip, back.changes)).toBe(ALERT);
    expect(back.markIds).toEqual([]);

    const again = trackedFormat(tip, inside(tip, 'Useful'), callout('warning'), ctx('z9z9'));
    const text = applyChanges(tip, again.changes);
    expect(body(text)).toBe(
      'Intro.\n\n<!--fmt m2bd was=callout-note-->\n\n> [!WARNING]\n> Useful information.<!--/m2bd-->\n\nAfter.\n',
    );
    expect(again.extendedIds).toEqual(['m2bd']);
    expect(rejected(text, 'm2bd')).toBe(ALERT);
  });

  it('is an alert of the document’s first block, and of its last', () => {
    const only = '> [!NOTE]\n> Useful information.\n';
    const after = change(only, inside(only, 'Useful'), callout('tip'));
    expect(rejected(after, 'm2bd')).toBe(only);
    expect(accepted(after, 'm2bd')).toBe('> [!TIP]\n> Useful information.\n');
  });

  it('works with the alert’s title alone, no body yet', () => {
    const bare = 'Intro.\n\n> [!NOTE]\n\nAfter.\n';
    const after = change(bare, inside(bare, 'NOTE'), callout('tip'));
    expect(rejected(after, 'm2bd')).toBe(bare);
    expect(accepted(after, 'm2bd')).toBe('Intro.\n\n> [!TIP]\n\nAfter.\n');
  });
});

describe('where an alert’s type can not change (#311)', () => {
  const refusals = (source: string, at: string) =>
    messageOf(() => trackedFormat(source, inside(source, at), callout('tip'), ctx()));

  it('is refused on a quote that is no alert, with words about the alert', () => {
    expect(refusals('> Plain quote.\n', 'Plain')).toMatch(/not an alert/);
    // A quote whose first line has the type and more is the GitHub's no alert.
    expect(refusals('Intro.\n\n> Text\n> [!NOTE]\n', 'Text')).toMatch(/not an alert/);
  });

  it('is refused on a paragraph, a list item and an alert in a list item or another quote', () => {
    expect(refusals('One paragraph.\n', 'paragraph')).toMatch(/not an alert/);
    expect(refusals('- [!NOTE]\n', 'NOTE')).toMatch(/not an alert/);
    expect(refusals('- Item\n\n  > [!NOTE]\n  > Body.\n', 'Body')).toMatch(/not an alert/);
    expect(refusals('> > [!NOTE]\n> > Body.\n', 'Body')).toMatch(/not an alert/);
  });

  it('is refused for a type that is no word', () => {
    for (const type of ['', 'Two words', 'NO!', '1up', 'a]b']) {
      expect(
        messageOf(() => trackedFormat(ALERT, inside(ALERT, 'Useful'), callout(type), ctx())),
        type,
      ).toMatch(/type/);
    }
  });

  it('is refused while another person has a pending change in the alert, naming it', () => {
    const marked = file('> [!NOTE]\n> Useful <!--ins k3x9-->new <!--/k3x9-->information.', {
      k3x9: 'bo',
    });
    expect(
      messageOf(() => trackedFormat(marked, inside(marked, 'Useful'), callout('tip'), ctx())),
    ).toMatch(/Accept or reject the changes in this paragraph first/);
  });

  it('is refused where the alert does not stand on its own, a line of text right under it', () => {
    const lazy = '> [!NOTE]\n> Useful information.\nA line that goes on from it.\n';
    expect(refusals(lazy, 'Useful')).toMatch(/on its own|blank line/);
  });

  it('is refused inside code and front matter', () => {
    expect(refusals('```\n> [!NOTE]\n> Body.\n```\n', 'Body')).toMatch(/code/);
  });
});

describe('changing the type of an alert, with Track Changes off (#311)', () => {
  it('writes the new type plainly, and leaves no mark', () => {
    const changes = untrackedFormat(ALERT, inside(ALERT, 'Useful'), callout('caution'), {
      author: ada,
    });
    expect(applyChanges(ALERT, changes)).toBe(
      'Intro.\n\n> [!CAUTION]\n> Useful information.\n\nAfter.\n',
    );
  });

  it('refuses where a pending change holds the alert, as tracked formatting does', () => {
    const marked = file('> [!NOTE]\n> Useful <!--ins k3x9-->new <!--/k3x9-->information.', {
      k3x9: 'bo',
    });
    expect(() =>
      untrackedFormat(marked, inside(marked, 'Useful'), callout('tip'), { author: ada }),
    ).toThrow(EditError);
  });
});

describe('an alert’s type in your own new text (#311)', () => {
  it('is edited in place, with no mark: the alert you typed has the type you chose', () => {
    const typed = file('Intro.\n\n<!--ins k3x9-->\n\n> [!NOTE]\n> Typed.<!--/k3x9-->\n\nAfter.', {
      k3x9: 'ada',
    });
    const result = trackedFormat(typed, inside(typed, 'Typed'), callout('tip'), ctx('z9z9'));
    const after = applyChanges(typed, result.changes);
    expect(result.markIds).toEqual([]);
    expect(body(after)).toContain('> [!TIP]\n> Typed.');
    expect(body(after)).not.toContain('was=callout');
  });

  it('is a pending change when it is another person’s insertion: decided first', () => {
    const theirs = file('Intro.\n\n<!--ins k3x9-->\n\n> [!NOTE]\n> Typed.<!--/k3x9-->\n\nAfter.', {
      k3x9: 'bo',
    });
    expect(
      messageOf(() =>
        trackedFormat(theirs, inside(theirs, 'Typed'), callout('tip'), context(ada, ['z9z9'])),
      ),
    ).not.toBe('no error');
    expect(bo.handle).toBe('bo');
  });
});

describe('an alert’s type with other changes around it (#311)', () => {
  it('reads alike in every order of decisions, the changes in the other blocks pending', () => {
    const text = file(
      'Intro <!--ins k3x9-->new<!--/k3x9--> words.\n\n> [!NOTE]\n> Useful <!--cmt c8d2-->information<!--/c8d2-->.\n\nAfter<!--del d3x9 , gone-->.',
      { k3x9: 'bo', d3x9: 'bo' },
      thread('c8d2'),
    );
    const op = callout('warning');
    const result = trackedFormat(text, inside(text, 'Useful'), op, ctx('f3x9'));
    const after = applyChanges(text, result.changes);
    expect(result.markIds).toEqual(['f3x9']);
    expect(
      expectEveryDecision('alert', text, after, result.markIds, { structure: op }),
    ).toBeGreaterThan(8);
  });

  it('works through your own pending changes in the alert, and a comment or a highlight in it', () => {
    const text = file(
      '> [!NOTE]\n> Useful <!--ins k3x9-->new <!--/k3x9-->and <!--hl h4kz-->marked<!--/h4kz--> and <!--cmt c8d2-->noted<!--/c8d2-->.',
      { k3x9: 'ada', h4kz: 'bo' },
      thread('c8d2'),
    );
    const op = callout('tip');
    const result = trackedFormat(text, inside(text, 'Useful'), op, ctx('f3x9', 'g4x9'));
    const after = applyChanges(text, result.changes);
    expect(
      parse(after)
        .marks.map((mark) => mark.kind)
        .sort(),
    ).toEqual(['cmt', 'fmt', 'hl', 'ins']);
    expectEveryDecision('mixed', text, after, result.markIds, { structure: op });
  });

  it('keeps a file’s CRLF line breaks, and rejecting gives them back', () => {
    const crlf = ALERT.replaceAll('\n', '\r\n');
    const after = change(crlf, inside(crlf, 'Useful'), callout('tip'));
    expect(rejected(after, 'm2bd')).toBe(crlf);
    expect(accepted(after, 'm2bd')).toBe(crlf.replace('NOTE', 'TIP'));
    expect(after).not.toMatch(/(?<!\r)\n/);
  });

  it('does not move the lines of the alert, which every renderer must read as an alert', () => {
    const after = change(ALERT, inside(ALERT, 'Useful'), callout('caution'));
    const lines = bodyOf(after).split('\n');
    // The alert's own lines start with `>`, and no marker starts one of them or follows `> `.
    const first = lines.findIndex((line) => line.startsWith('> [!CAUTION]'));
    expect(first).toBeGreaterThan(0);
    expect(lines[first + 1]).toBe('> Useful information.<!--/m2bd-->');
    expect(lines[first - 1]).toBe('');
    expect(lines[first - 2]).toBe('<!--fmt m2bd was=callout-note-->');
  });

  it('is not a change of the words: the type is syntax', () => {
    const after = change(ALERT, inside(ALERT, 'Useful'), callout('important'));
    expect(newestView(after).text).toBe(ALERT.replace('NOTE', 'IMPORTANT'));
    expect(originalView(after).text).toBe(ALERT);
  });
});
