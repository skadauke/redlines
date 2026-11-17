// Comments on an include (docs/research/quarto.md, "Includes and several ledgers"): Quarto expands
// `{{< include _part.qmd >}}` only when the shortcode is alone on its line, so a comment on it
// is written as a block mark, its opener alone on the line before and its closer alone on the line
// after, and no mark ever holds the include line.

import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { addComment, deleteThread } from './comments.ts';
import { ada, context } from './test-helpers.ts';
import { addHighlight } from './highlights.ts';
import { newestView, originalView } from './views.ts';

const QMD = [
  '---',
  'title: "Triage study"',
  '---',
  '',
  '## Methods {#sec-methods}',
  '',
  'We followed the protocol.',
  '',
  '{{< include _protocol.qmd >}}',
  '',
  'Results follow.',
  '',
].join('\n');

const at = (word: string) => {
  const from = QMD.indexOf(word);
  return { from, to: from + word.length };
};
const ctx = () => context(ada, ['c2bd'], { dialect: 'pandoc' });

describe('a comment on an include line', () => {
  it('leaves the shortcode alone on its line', () => {
    const { changes } = addComment(
      QMD,
      at('{{< include _protocol.qmd >}}'),
      'Is this current?',
      ctx(),
    );
    const after = applyChanges(QMD, changes);
    const lines = after.split('\n');
    const line = lines.findIndex((each) => each.includes('{{< include'));
    expect(lines[line]).toBe('{{< include _protocol.qmd >}}');
    expect(lines[line - 1]).toMatch(/^<!--cmt c2bd-->$/);
    expect(lines[line + 1]).toMatch(/^<!--\/c2bd-->$/);
    expect(newestView(after).text).toBe(QMD);
  });

  it('widens a comment that starts inside the shortcode to the whole line', () => {
    const word = QMD.indexOf('protocol.qmd');
    const { changes } = addComment(QMD, { from: word, to: word + 8 }, 'Which file?', ctx());
    const lines = applyChanges(QMD, changes).split('\n');
    const line = lines.findIndex((each) => each.includes('{{< include'));
    expect(lines[line]).toBe('{{< include _protocol.qmd >}}');
  });

  it('puts a comment on text that ends before the include and runs into it outside the line', () => {
    const from = QMD.indexOf('We followed');
    const to = QMD.indexOf('{{<') + 5;
    const { changes } = addComment(QMD, { from, to }, 'Both.', ctx());
    const lines = applyChanges(QMD, changes).split('\n');
    const line = lines.findIndex((each) => each.includes('{{< include'));
    expect(lines[line]).toBe('{{< include _protocol.qmd >}}');
  });

  it('is the same file again once the thread is deleted', () => {
    const { changes, id } = addComment(QMD, at('{{< include _protocol.qmd >}}'), 'x', ctx());
    const after = applyChanges(QMD, changes);
    expect(applyChanges(after, deleteThread(after, id))).toBe(QMD);
  });

  it('leaves a file that is not a .qmd as it was: the shortcode is text there', () => {
    const md = context(ada, ['c2bd']);
    const { changes } = addComment(QMD, at('{{< include _protocol.qmd >}}'), 'Note.', md);
    expect(applyChanges(QMD, changes)).toContain('{{< include _protocol.qmd >}}<!--/c2bd-->');
  });

  it('reads right with a second comment on the same include, and gives the bytes back', () => {
    const first = addComment(QMD, at('{{< include _protocol.qmd >}}'), 'one', ctx());
    const once = applyChanges(QMD, first.changes);
    const wide = once.indexOf('<!--cmt');
    const end = once.indexOf('<!--/c2bd-->') + '<!--/c2bd-->'.length;
    const second = addComment(
      once,
      { from: wide, to: end },
      'two',
      context(ada, ['d3cm'], { dialect: 'pandoc' }),
    );
    const twice = applyChanges(once, second.changes);
    expect(newestView(twice).text).toBe(QMD);
    expect(originalView(twice).text).toBe(QMD);
    const undone = applyChanges(twice, deleteThread(twice, second.id));
    expect(applyChanges(undone, deleteThread(undone, first.id))).toBe(QMD);
  });

  it('puts a highlight around an include as it does a comment', () => {
    const { changes } = addHighlight(QMD, at('{{< include _protocol.qmd >}}'), ctx());
    const after = applyChanges(QMD, changes);
    const lines = after.split('\n');
    const line = lines.findIndex((each) => each.includes('{{< include'));
    expect(lines[line]).toBe('{{< include _protocol.qmd >}}');
    expect(newestView(after).text).toBe(QMD);
  });

  it('reads a closer after an include line in a .md file as before', () => {
    const md = '<!--ins k3x9-->new\n{{< include _a.qmd >}}\n<!--/k3x9-->\n\nNext\n';
    expect(newestView(md).text).toContain('{{< include _a.qmd >}}\n\n\nNext');
  });
});
