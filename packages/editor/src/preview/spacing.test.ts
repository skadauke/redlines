// @vitest-environment happy-dom
// The space between a table, a quote, a code block and an alert (#1183), in the editor's lines: a
// quote's bar is kept out of the space around it, a table under a table has a spacer, and a block
// under a Quarto callout takes its space outside the callout's box.

import { forceParsing } from '@codemirror/language';
import { afterEach, describe, expect, it } from 'vitest';
import { createEditor, type Editor } from '../index.ts';
import { baseThemeSpec } from './theme.ts';

const author = { handle: 'ada', name: 'Ada Lovelace' };
const open: Editor[] = [];

afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

/** An editor on `doc`, the caret at its start (so that nothing is open), and its lines' classes. */
function linesOf(doc: string, dialect: 'gfm' | 'pandoc' = 'gfm'): Lines {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, { doc, author, dialect });
  forceParsing(editor.view, editor.view.state.doc.length, 10_000);
  editor.view.dispatch({ selection: { anchor: 0 } });
  open.push(editor);
  const found: Lines = [];
  for (const el of editor.view.contentDOM.querySelectorAll('.cm-line')) {
    found.push({ text: (el.textContent ?? '').trim(), classes: [...el.classList] });
  }
  return Object.assign(found, {
    get: (text: string) => found.find((line) => line.text === text)?.classes,
    withClass: (name: string) => found.find((line) => line.classes.includes(name))?.classes,
  });
}

type Lines = { text: string; classes: string[] }[] & {
  get?: (text: string) => string[] | undefined;
  withClass?: (name: string) => string[] | undefined;
};

describe('the space around a quote', () => {
  const spec = baseThemeSpec as Record<string, Record<string, string>>;

  it('keeps the quote’s bar out of the space above it and the space below it', () => {
    for (const kind of ['block', 'h1', 'heading']) {
      expect(spec[`.cm-line.rl-quote.rl-space-${kind}`]?.['clipPath']).toContain('--rl-clip-top');
    }
    for (const kind of ['block', 'h1', 'heading', 'item', 'loose']) {
      expect(spec[`.cm-line.rl-quote.rl-space-${kind}-below`]?.['clipPath']).toContain(
        '--rl-clip-bottom',
      );
    }
    // The space between a quote's paragraphs is inside it: the bar goes on.
    expect(spec['.cm-line.rl-quote.rl-space-loose']).toBeUndefined();
  });

  it('gives a quote under a paragraph and a code block under a quote their space', () => {
    const lines = linesOf('Text.\n\n> Quoted.\n\n```js\ncode\n```\n');
    expect(lines.get!('Quoted.')).toEqual(expect.arrayContaining(['rl-quote', 'rl-space-block']));
    // The code block is boxed: the quote's last line takes the space, below its text.
    expect(lines.get!('Quoted.')).toContain('rl-space-block-below');
  });
});

describe('a table under a table', () => {
  it('has a spacer between them, which no other pair of blocks has', () => {
    const table = '| a | b |\n| - | - |\n| 1 | 2 |\n';
    const parent = document.createElement('div');
    document.body.append(parent);
    const editor = createEditor(parent, {
      doc: `${table}\n${table}\n\nText.\n`,
      author,
      dialect: 'gfm',
    });
    open.push(editor);
    forceParsing(editor.view, editor.view.state.doc.length, 10_000);
    editor.view.dispatch({ selection: { anchor: editor.view.state.doc.length } });
    expect(editor.view.contentDOM.querySelectorAll('.rl-space-widget')).toHaveLength(1);
  });
});

describe('a block under a Quarto callout (#1183)', () => {
  const CALLOUT = '::: {.callout-note}\n## A note\n\nSays something.\n:::\n\n';

  it('puts an alert’s space outside the callout’s box, on the alert’s first line', () => {
    const lines = linesOf(`${CALLOUT}> [!NOTE]\n> An alert.\n`, 'pandoc');
    expect(lines.get!('Note')).toEqual(
      expect.arrayContaining(['rl-callout-first', 'rl-space-block-apart']),
    );
  });

  it('puts a code block’s space outside the box too', () => {
    const lines = linesOf(`${CALLOUT}\`\`\`js\ncode\n\`\`\`\n`, 'pandoc');
    const first = lines.withClass!('rl-codeblock-first');
    expect(first).toContain('rl-space-block-apart');
  });

  it('puts a table’s space on the callout’s last line, clipped out of the tint', () => {
    const lines = linesOf(`${CALLOUT}| a | b |\n| - | - |\n| 1 | 2 |\n`, 'pandoc');
    const last = lines.withClass!('rl-callout-last');
    expect(last).toContain('rl-space-block-clip');
  });

  it('does nothing to a paragraph under it, whose own space is outside the box', () => {
    const lines = linesOf(`${CALLOUT}After.\n`, 'pandoc');
    expect(lines.get!('After.')).toContain('rl-space-block');
    const last = lines.withClass!('rl-callout-last');
    expect(last).not.toContain('rl-space-block-clip');
    expect(last).not.toContain('rl-space-block-below');
  });
});
