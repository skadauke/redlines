// A marker next to a run of emphasis delimiters in a table's cell (#490): the minimized shapes of the
// random suites' seeds 64 (alignment), 1004 and 4242 (format). A marker reads as punctuation to the
// run beside it, so the file must read as its newest view in every order of decisions, which is
// judged by micromark. Where a fine form does not, the change is written wider, never refused.

import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { addComment } from './comments.ts';
import { inspectPlace } from './inline.ts';
import { expectEveryOrderRead } from './oracle.ts';
import { trackedEdit } from './track.ts';
import { bodyOf, bo, claudeAda, context, file } from './test-helpers.ts';

const table = (cell: string, mark: Record<string, string> = {}) =>
  file(['| x y |', '| :-: |', `| ${cell} |`, '', 'Outro words.'].join('\n'), mark);

describe('a marker next to a delimiter run in a cell (#490)', () => {
  it('puts a comment that ends in a `_` before the row end, not after its pipe (seed 64)', () => {
    const text = '|b|café|café_|\n| --: | --- | ----- |\n|a|b|c|\n';
    const at = text.indexOf('afé_');
    const after = applyChanges(
      file(text),
      addComment(file(text), { from: at, to: at + 4 }, 'A note.', context(claudeAda, ['q6rs']))
        .changes,
    );
    expect(bodyOf(after)).toContain('afé_<!--/q6rs-->|');
    expectEveryOrderRead('comment', after);
  });

  it('knows a `_` before a pipe from a `_` between letters', () => {
    // A closer after `_` changes nothing for `é_|`, and does for `é_a`.
    expect(inspectPlace('|café_|', [], 6).kind).toBe('ok');
    expect(inspectPlace('|café_a|', [], 6).kind).toBe('flank');
  });

  it('writes a deletion of the first words of a bold cell wider (seed 1004)', () => {
    const text = table('**two words**');
    const at = text.indexOf('two');
    const after = applyChanges(
      text,
      trackedEdit(text, { from: at, to: at + 3, insert: '' }, context(bo, ['t5vw'])),
    );
    expect(bodyOf(after)).not.toContain('**<!--del t5vw two--> words**');
    expectEveryOrderRead('bold', after);
  });

  it('writes a deletion that takes a bold cell closer wider, next to another mark (seed 4242)', () => {
    const text = table('<!--fmt m5nn +bold-->**café**<!--/m5nn-->', { m5nn: 'claude-ada' });
    const at = text.indexOf('fé');
    const after = applyChanges(
      text,
      trackedEdit(text, { from: at, to: at + 3, insert: '' }, context(claudeAda, ['k3x9'])),
    );
    expect(bodyOf(after)).not.toContain('**ca<!--del k3x9 fé*-->*');
    expectEveryOrderRead('closer', after);
  });

  // `marksAfter` counts in UTF-16 units and `changesFlanking` looks in code points. They meet only
  // after the run, whose characters are delimiters (one unit each), so an emoji beside a mark and a
  // run cannot shift the lookup: typing a run before an emoji or beside a mark reads alike in every
  // order.
  it.each([
    ['a run typed before an emoji, a mark after it', '🎉<!--ins m5nn x-->', '**'],
    ['a run typed before a mark, an emoji after it', '<!--ins m5nn x-->🎉', '**'],
    ['a run of `_` typed between an emoji and a mark', '🎉<!--ins m5nn x-->a', '_'],
  ])('reads alike in every order: %s', (_why, cell, run) => {
    const text = table(`${cell} w`, { m5nn: 'claude-ada' });
    const at = text.indexOf(cell);
    const after = applyChanges(
      text,
      trackedEdit(text, { from: at, to: at, insert: run }, context(bo, ['t5vw'])),
    );
    expectEveryOrderRead('emoji', after);
  });
});
