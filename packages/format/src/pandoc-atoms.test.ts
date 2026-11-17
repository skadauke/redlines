// Two more atoms of pandoc's dialect that the random Quarto suite found (`pandoc-random.test.ts`,
// format §3.1 rule 9): the author-in-text citation `@smith2020` is a key like `@fig-x`, and a span's
// text and its attributes (`[x]{.mark}`) stay together. A marker from a comment or a highlight never
// stands inside either, in a `.qmd`.

import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { addComment } from './comments.ts';
import { addHighlight } from './highlights.ts';
import { expectEveryOrderRead } from './oracle.ts';
import { ada, bodyOf, context, file } from './test-helpers.ts';
import { newestView } from './views.ts';

const QMD = { dialect: 'pandoc' } as const;
const source = file('As @smith2020 showed, a [word]{.mark} here.');
const view = newestView(source).text;
const at = (find: string, offset = 0) => view.indexOf(find) + offset;

// [name, from, to] in offsets of the view.
const ranges: [string, number, number][] = [
  ['ends inside a citation key', at('As'), at('@smith', 6)],
  ['starts inside a citation key', at('@smith', 6), at('showed')],
  ['ends right after the text of a span', at('a [word'), at('[word]', 6)],
  ['starts right after the text of a span', at('[word]', 6), at('here')],
  ['starts inside a span', at('[word]', 3), at('here')],
];

describe('a citation in the text and a span are whole in a .qmd', () => {
  for (const [name, from, to] of ranges) {
    for (const kind of ['comment', 'highlight']) {
      it(`a ${kind} that ${name}: no marker inside`, () => {
        const ctx = context(ada, ['k3x9'], QMD);
        const range = { from, to };
        const done =
          kind === 'comment'
            ? addComment(source, range, 'Why?', ctx)
            : addHighlight(source, range, ctx);
        const after = applyChanges(source, done.changes);
        const body = bodyOf(after);
        expect(body).toContain('@smith2020');
        expect(body).toMatch(/\[[^\]]*\]\{\.mark\}/);
        expectEveryOrderRead(name, after);
      });
    }
  }
});
