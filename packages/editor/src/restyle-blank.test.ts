// @vitest-environment happy-dom
// The blank lines that Clean and Redlines hide are read as the parse goes on (#696): once it is
// done, they are what one pass over the finished tree gives.
import { forceParsing, syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import { afterEach, describe, expect, it } from 'vitest';
import { BLANK, blankLines, keptLine } from './blocks/hidden.ts';
import type { Span } from './blocks/structure.ts';
import { createEditor, type Editor } from './index.ts';

const author = { handle: 'ada', name: 'Ada Lovelace' };
const open: Editor[] = [];
afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

const HOLDERS = ['FencedCode', 'CodeBlock', 'HTMLBlock', 'CommentBlock', 'FrontMatter'];

/** The runs of blank lines as one pass over a finished tree reads them. */
function reference(state: EditorState): Span[] {
  const { doc } = state;
  const holders: Span[] = [];
  syntaxTree(state).iterate({
    enter: (node) => {
      if (HOLDERS.includes(node.name)) {
        holders.push({ from: node.from, to: node.to });
        return false;
      }
      return !/^(?:Paragraph|ATXHeading|SetextHeading|Table|LinkReference|HorizontalRule)/.test(
        node.name,
      );
    },
  });
  const kept = keptLine(state);
  const runs: Span[] = [];
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n);
    if (!BLANK.test(line.text) || line.from === kept) continue;
    if (holders.some((h) => h.from <= line.from && line.to <= h.to)) continue;
    const run = runs.at(-1);
    if (run && run.to === line.from - 1) run.to = line.to;
    else runs.push({ from: line.from, to: line.to });
  }
  return runs;
}

describe('the blank lines read as the parse goes on', () => {
  it('are, once the parse is done, what one pass over the finished tree gives', () => {
    const blocks = Array.from(
      { length: 150 },
      (_, n) =>
        [
          `## Section ${n}`,
          `A paragraph ${n} with *emphasis*.`,
          '```ts\nconst x = 1;\n\nconst y = 2;\n```',
          '- one\n\n- two',
          '<div>\n\nhtml\n\n</div>',
        ][n % 5]!,
    );
    const doc = blocks.join('\n\n') + '\n\n\n';
    const parent = document.createElement('div');
    document.body.append(parent);
    const editor = createEditor(parent, { doc, author, view: 'redlines' });
    open.push(editor);
    const { view } = editor;
    for (let at = 1500; at < doc.length + 1500; at += 1500) {
      forceParsing(view, Math.min(at, doc.length), 10_000);
      blankLines(view.state);
    }
    expect(blankLines(view.state)).toEqual(reference(view.state));
    // The caret on a blank line keeps that line.
    view.dispatch({ selection: { anchor: view.state.doc.line(2).from } });
    expect(blankLines(view.state)).toEqual(reference(view.state));
  }, 60_000);
});
