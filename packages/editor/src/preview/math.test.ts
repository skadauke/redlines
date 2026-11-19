// @vitest-environment happy-dom
// Math (#1173): `$…$` and `$$…$$` are read as pandoc reads them, and drawn once the host's engine
// is there; dollar signs that aren't math, code and front matter are left alone.

import { forceParsing } from '@codemirror/language';
import { Text } from '@codemirror/state';
import { afterEach, describe, expect, it } from 'vitest';
import { createEditor, type Editor } from '../index.ts';
import { mathOf } from './math.ts';

const author = { handle: 'ada', name: 'Ada Lovelace' };
const open: Editor[] = [];

afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

const found = (text: string) =>
  mathOf(Text.of(text.split('\n'))).map((formula) => ({
    tex: formula.tex,
    display: formula.display,
    block: formula.block,
    ...(formula.label ? { label: formula.label } : {}),
  }));

describe('reading math', () => {
  it('reads inline math with no space inside its dollars', () => {
    expect(found('Mass $m$ and energy $E = mc^2$ here.')).toEqual([
      { tex: 'm', display: false, block: false },
      { tex: 'E = mc^2', display: false, block: false },
    ]);
  });

  it('leaves dollar signs that are money, escaped or alone', () => {
    expect(found('It costs $5 and $6 each.')).toEqual([]);
    expect(found('Pay \\$5 or \\$6, then $ x $ and 20$.')).toEqual([]);
    expect(found('A $ lone dollar, and $10.')).toEqual([]);
    expect(found('Price is $a$5 here.')).toEqual([]);
  });

  it('reads a display on a line, and across lines, with its label', () => {
    expect(found('Before $$ E = mc^2 $$ after.')).toEqual([
      { tex: 'E = mc^2', display: true, block: false },
    ]);
    expect(found('$$ E = mc^2 $$ {#eq-mass}')).toEqual([
      { tex: 'E = mc^2', display: true, block: true, label: 'eq-mass' },
    ]);
    expect(found('$$\n\\int_0^1 x\\,dx\n= \\tfrac12\n$$ {#eq-int}\n\ntext')).toEqual([
      { tex: '\\int_0^1 x\\,dx\n= \\tfrac12', display: true, block: true, label: 'eq-int' },
    ]);
  });

  it('leaves code, front matter, a marker inside a formula and the ledger alone', () => {
    const text = [
      '---',
      'title: "$x$"',
      '---',
      '',
      'Real $a$ and `code $b$`, an inserted <!--ins k3x9-->$c$<!--/k3x9-->, and $d<!--ins p3x9-->e<!--/p3x9-->$.',
      '',
      '```',
      '$f$ and $$g$$',
      '```',
      '',
      '<!-- redlines',
      'comments: $h$',
      '-->',
    ].join('\n');
    expect(found(text).map((formula) => formula.tex)).toEqual(['a', 'c']);
  });
});

describe('drawing math', () => {
  const engine = {
    renderToString: (tex: string, options?: { displayMode?: boolean }) =>
      `<math data-display="${options?.displayMode ? 1 : 0}"><mi>${tex}</mi></math>`,
  };

  function editorOf(doc: string, withEngine = true): Editor {
    const parent = document.createElement('div');
    document.body.append(parent);
    const editor = createEditor(parent, {
      doc,
      author,
      dialect: 'pandoc',
      ...(withEngine ? { math: () => Promise.resolve(engine) } : {}),
    });
    forceParsing(editor.view, editor.view.state.doc.length, 10_000);
    open.push(editor);
    return editor;
  }

  const drawn = async (editor: Editor, count: number) => {
    for (let i = 0; i < 100 && editor.view.dom.querySelectorAll('.rl-math').length < count; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return [...editor.view.dom.querySelectorAll('.rl-math')];
  };

  const DOC =
    'Text with $x^2$ inline.\n\nSecond.\n\n$$ E = mc^2 $$ {#eq-mass}\n\n$$\n\\sum_i a_i\n$$\n\nEnd.\n';

  it('draws inline and display formulas with the engine, and the equation’s number', async () => {
    const editor = editorOf(DOC);
    // The caret is at the start, away from every formula.
    const boxes = await drawn(editor, 3);
    expect(boxes).toHaveLength(3);
    expect(boxes[0]?.querySelector('math')?.getAttribute('data-display')).toBe('0');
    expect(boxes[0]?.getAttribute('role')).toBe('math');
    expect(boxes[1]?.classList.contains('rl-math-block')).toBe(true);
    expect(boxes[1]?.textContent).toContain('(1)');
    expect(boxes[2]?.textContent).toContain('\\sum_i a_i');
    expect(editor.view.dom.textContent).not.toContain('$$');
  });

  it('shows the source while the caret is in a formula', async () => {
    const editor = editorOf(DOC);
    await drawn(editor, 3);
    editor.view.dispatch({ selection: { anchor: DOC.indexOf('x^2') + 1 } });
    expect(editor.view.dom.querySelectorAll('.rl-math')).toHaveLength(2);
    expect(editor.view.dom.textContent).toContain('$x^2$');
  });

  it('shows the source where the host has no engine, and when the document has no formula', async () => {
    const none = editorOf(DOC, false);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(none.view.dom.querySelectorAll('.rl-math')).toHaveLength(0);
    expect(none.view.dom.textContent).toContain('$x^2$');
    let loaded = 0;
    const parent = document.createElement('div');
    document.body.append(parent);
    open.push(
      createEditor(parent, {
        doc: 'It costs $5 and $6.\n',
        author,
        math: () => {
          loaded++;
          return Promise.resolve(engine);
        },
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(loaded).toBe(0);
  });

  it('draws math in a Markdown file too', async () => {
    const parent = document.createElement('div');
    document.body.append(parent);
    const editor = createEditor(parent, {
      doc: 'Euler: $e^{i\\pi}+1=0$.\n\nNext.\n',
      author,
      dialect: 'gfm',
      math: () => Promise.resolve(engine),
    });
    open.push(editor);
    expect(await drawn(editor, 1)).toHaveLength(1);
  });
});
