// A comment or a highlight that ends after the closing pipe of a table's header (#955, #396): the marker
// after the pipe is a cell more than the delimiter row has, and the table stops reading as one. Its end
// goes in front of the pipe, and in front of a delimiter run that the marker would split.
import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { addComment } from './comments.ts';
import { addHighlight } from './highlights.ts';
import { readAs } from './oracle.ts';
import { ada, bodyOf, context, file } from './test-helpers.ts';
import { newestView } from './views.ts';

const isTable = (text: string) => readAs(bodyOf(text)).startsWith('<table');
const rest = '\n| --: | --- | ----- |\n|alpha|alpha|alpha|\n';

describe('a comment or a highlight at the end of a header row', () => {
  for (const header of ['|b|café|café_|', '| b | c | d |', '|b|c|d\\||']) {
    it(`leaves ${JSON.stringify(header)} a table`, () => {
      const text = file(`${header}${rest}`);
      const end = bodyOf(text).indexOf('\n');
      for (const from of [end - 4, end - 2, end - 1]) {
        const comment = applyChanges(
          text,
          addComment(text, { from, to: end }, 'Note.', context(ada, ['q6rs'])).changes,
        );
        expect(isTable(comment)).toBe(true);
        expect(newestView(comment).text).toBe(newestView(text).text);
        if (from > end - 3) continue;
        const highlight = applyChanges(
          text,
          addHighlight(text, { from, to: end }, context(ada, ['q6rs'])).changes,
        );
        expect(isTable(highlight)).toBe(true);
      }
    });
  }

  it('goes in front of the underscore before a pending alignment mark, not past the pipe', () => {
    const body = `|b|café|café_<!--fmt k3x9 align=\\|\\x20-\\-:\\x20\\|\\x20:-\\-\\x20\\|\\x20-\\-\\-\\-:\\x20\\|-->|${rest}`;
    const text = file(body, { k3x9: 'ada' });
    const view = newestView(text);
    const range = { from: view.map.toSource(9, 1), to: view.map.toSource(13, -1) };
    const out = applyChanges(
      text,
      addComment(text, range, 'Note.', context(ada, ['q6rs'])).changes,
    );
    expect(bodyOf(out).split('\n')[0]).toMatch(/<!--\/q6rs-->_<!--fmt k3x9.*-->\|$/);
    expect(isTable(out)).toBe(true);
  });
});
