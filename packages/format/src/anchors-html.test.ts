import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { addComment } from './comments.ts';
import { addHighlight } from './highlights.ts';
import { newestView } from './views.ts';
import { ada, context, file } from './test-helpers.ts';
import type { Range } from './types.ts';

/**
 * A comment or a highlight whose range has an end in an HTML block is anchored to the whole block,
 * not refused and not written in the block's raw text (format §4, #378).
 */
const body = 'Intro text.\n\n<div>\ntwo\n</div>\n\nAfter.\n';
const text = file(body);

const at = (needle: string, offset = 0) => text.indexOf(needle) + offset;
const BLOCK = `<div>\ntwo\n</div>`;

/** The body of `text` after a highlight on `range`, with the ledger cut off. */
function highlighted(source: string, range: Range): string {
  const { changes } = addHighlight(source, range, context(ada, ['k3x9']));
  return applyChanges(source, changes).split('<!-- redlines')[0]!.trimEnd() + '\n';
}
function commented(source: string, range: Range): string {
  const { changes } = addComment(source, range, 'Why?', context(ada, ['k3x9']));
  return applyChanges(source, changes).split('<!-- redlines')[0]!.trimEnd() + '\n';
}

const WHOLE = 'Intro text.\n\n<!--hl k3x9-->\n\n<div>\ntwo\n</div><!--/k3x9-->\n\nAfter.\n';

describe('a range with an end in an HTML block', () => {
  it('anchors a highlight to the whole block, whichever way the range reaches in', () => {
    const closing = at('</div>') + 6;
    for (const range of [
      { from: at('two', 2), to: closing },
      { from: at('two'), to: at('two', 3) },
      { from: at('<div>'), to: closing },
      { from: at('<div>', 2), to: at('two', 1) },
    ]) {
      expect(highlighted(text, range), JSON.stringify(range)).toBe(WHOLE);
    }
  });

  it('anchors a comment the same way, and a caret in the block too', () => {
    const range = { from: at('two', 2), to: at('</div>') + 6 };
    expect(commented(text, range)).toBe(WHOLE.replace(/hl k3x9/, 'cmt k3x9'));
    const caret = commented(text, { from: at('two', 1), to: at('two', 1) });
    expect(caret).toBe(WHOLE.replace(/hl k3x9/, 'cmt k3x9'));
  });

  it('keeps the text around the block when the range reaches out of it', () => {
    // From the intro into the block: ends at the block's end.
    expect(highlighted(text, { from: at('text.'), to: at('two', 1) })).toBe(
      'Intro <!--hl k3x9-->text.\n\n<div>\ntwo\n</div><!--/k3x9-->\n\nAfter.\n',
    );
    // From the block to the text after it: starts at the block's start.
    expect(highlighted(text, { from: at('two'), to: at('After') + 3 })).toBe(
      'Intro text.\n\n<!--hl k3x9-->\n\n<div>\ntwo\n</div>\n\nAft<!--/k3x9-->er.\n',
    );
  });

  it('leaves the block as it reads: the views are the same with the markers out', () => {
    const range = { from: at('two', 2), to: at('</div>') + 6 };
    const ctx = () => context(ada, ['k3x9']);
    for (const { changes } of [
      addHighlight(text, range, ctx()),
      addComment(text, range, 'Why?', ctx()),
    ]) {
      const after = applyChanges(text, changes);
      expect(newestView(after).text).toBe(newestView(text).text);
      expect(after).toContain(BLOCK);
    }
  });

  it('writes the markers outside the block in a quote and in a list item', () => {
    for (const [source, lines] of [
      ['> <div>\n> two\n> </div>\n', ['<div>', 'two', '</div>']],
      ['- <div>\n  two\n  </div>\n', ['<div>', 'two', '</div>']],
    ] as const) {
      const doc = file(source);
      const from = doc.indexOf('two') + 1;
      const after = highlighted(doc, { from, to: from + 1 });
      expect(after.match(/<!--hl k3x9-->/g)).toHaveLength(1);
      expect(after.match(/<!--\/k3x9-->/g)).toHaveLength(1);
      for (const line of lines) expect(after).toContain(line);
      // No marker stands between the tags of the block.
      expect(after.slice(after.indexOf('<div>'), after.indexOf('</div>'))).not.toContain('<!--');
    }
  });

  it('anchors to an HTML comment block, which is one too', () => {
    const doc = file('Intro.\n\n<!-- a note\nto self -->\n\nAfter.\n');
    const from = doc.indexOf('note');
    expect(highlighted(doc, { from, to: from + 4 })).toBe(
      'Intro.\n\n<!--hl k3x9-->\n\n<!-- a note\nto self --><!--/k3x9-->\n\nAfter.\n',
    );
  });

  it('does not take a paragraph with markers in it for an HTML block', () => {
    const doc = file('The <!--hl h4kz-->importer<!--/h4kz--> ships.\n', { h4kz: 'bo' });
    const from = doc.indexOf('ships');
    expect(highlighted(doc, { from, to: from + 5 })).toBe(
      'The <!--hl h4kz-->importer<!--/h4kz--> <!--hl k3x9-->ships<!--/k3x9-->.\n',
    );
  });

  it('ends the anchor before the carriage return of a CRLF file, not between \r and \n', () => {
    const doc = file('A\r\n\r\n<div>\r\nx\r\n</div>\r\n\r\nEnd\r\n');
    const from = doc.indexOf('x');
    const after = highlighted(doc, { from, to: from + 1 });
    expect(after).toContain('</div><!--/k3x9-->\r\n');
    expect(after).not.toContain('\r<!--');
  });
});
