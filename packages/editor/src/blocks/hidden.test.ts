// @vitest-environment happy-dom
import { forceParsing } from '@codemirror/language';
import { EditorSelection } from '@codemirror/state';
import { runScopeHandlers } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import { createEditor, type Editor, type EditorOptions } from '../index.ts';
import { atomsOf, hiddenLines, trackedDecorations } from '../tracked/decorations.ts';

const ada = { handle: 'ada', name: 'Ada Lovelace' };
const open: Editor[] = [];

afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

function load(doc: string, options: Partial<EditorOptions> = {}): Editor {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, { doc, author: ada, ...options });
  forceParsing(editor.view, editor.view.state.doc.length, 10_000);
  open.push(editor);
  return editor;
}

/** The text of each line the editor draws. */
const drawn = (editor: Editor) =>
  [...editor.view.contentDOM.querySelectorAll('.cm-line')].map((line) => line.textContent ?? '');

/** The hidden runs, as the text they hide. */
function runs(editor: Editor): string[] {
  const { state } = editor.view;
  const found: string[] = [];
  hiddenLines(state).between(0, state.doc.length, (from, to) => {
    found.push(state.sliceDoc(from, to));
  });
  return found;
}

const press = (editor: Editor, key: string) =>
  runScopeHandlers(editor.view, new KeyboardEvent('keydown', { key }), 'editor');

const head = (editor: Editor) => editor.view.state.selection.main.head;

/** Whether `pos` is inside a range the caret steps over. */
function inHidden(editor: Editor, pos: number): boolean {
  let inside = false;
  atomsOf(editor.view.state).between(pos, pos, (from, to) => {
    if (from < pos && pos < to) inside = true;
  });
  return inside;
}

describe('hidden blank lines', () => {
  it.each([
    ['one blank line', 'One.\n\nTwo.', ['One.', 'Two.']],
    ['three blank lines', 'One.\n\n\n\nTwo.', ['One.', 'Two.']],
    ['none, under a heading', '## H\nPara.', ['H', 'Para.']],
    [
      'blank lines in a quote and a list',
      '> One.\n>\n> Two.\n\n- a\n\n  b',
      ['One.', 'Two.', 'a', 'b'],
    ],
    ['blank lines at the start and the end', '\n\nOne.\n\n', ['One.']],
  ])('draws no blank line between blocks: %s, in Clean and Redlines', (_, doc, lines) => {
    // The caret in the last block's text, as on no blank line.
    const editor = load(doc);
    editor.view.dispatch({ selection: { anchor: doc.trimEnd().length } });
    for (const mode of ['clean', 'redlines'] as const) {
      editor.setViewMode(mode);
      // Heading marks and quote markers are hidden away from the caret; the text is what counts.
      expect(
        drawn(editor).map((line) => line.replace(/^[#>•] ?/, '').trim()),
        mode,
      ).toEqual(lines);
    }
  });

  it('draws every line in Raw', () => {
    const editor = load('One.\n\n\nTwo.\n');
    editor.setViewMode('raw');
    expect(drawn(editor)).toEqual(['One.', '', '', 'Two.', '']);
    expect(runs(editor)).toEqual([]);
    expect(editor.view.contentDOM.dataset['rlHiddenLines']).toBe('0');
  });

  it('keeps the blank lines of code, front matter and an HTML block that holds them', () => {
    const doc = [
      '---',
      'title: x',
      '',
      'tags: [a]',
      '---',
      '',
      '```',
      'a',
      '',
      'b',
      '```',
      '',
      '    indented',
      '',
      '    code',
      '',
      '<pre>',
      'x',
      '',
      'y',
      '</pre>',
      '',
      'End.',
    ].join('\n');
    const editor = load(doc);
    editor.view.dispatch({ selection: { anchor: doc.length } });
    // The blank lines between the blocks only.
    expect(runs(editor)).toEqual(['', '', '', '']);
    expect(editor.view.contentDOM.dataset['rlHiddenLines']).toBe('4');
    expect(drawn(editor)).toHaveLength(doc.split('\n').length - 4);
  });

  it('steps over a hidden run in one press, and never rests in it', () => {
    const doc = 'One.\n\n\nTwo.';
    const editor = load(doc);
    editor.view.dispatch({ selection: { anchor: 'One.'.length } });
    press(editor, 'ArrowRight');
    expect(head(editor)).toBe(doc.indexOf('Two.'));
    press(editor, 'ArrowLeft');
    expect(head(editor)).toBe('One.'.length);
    for (const down of [true, false]) {
      const range = editor.view.moveVertically(editor.view.state.selection.main, down);
      expect(inHidden(editor, range.head), `${down ? 'down' : 'up'}: ${range.head}`).toBe(false);
      editor.view.dispatch({ selection: EditorSelection.create([range]) });
    }
  });

  it('draws the blank line the caret is on, as a `>` just typed on it (#167)', () => {
    const doc = 'One.\n\n>\n\nTwo.';
    const editor = load(doc, { tracking: false });
    editor.view.dispatch({ selection: { anchor: doc.indexOf('>') + 1 } });
    expect(drawn(editor)).toEqual(['One.', '>', 'Two.']);
    expect(inHidden(editor, head(editor))).toBe(false);
    editor.view.dispatch({ selection: { anchor: doc.length } });
    expect(drawn(editor)).toEqual(['One.', 'Two.']);
  });

  // A timing test: it runs with REDLINES_COST set, as CI's check job does (see blocks/cost.test.ts).

  it.skipIf(!process.env['REDLINES_COST'])(
    'keeps the pass linear with 4,000 lines of markers alone (#20)',
    () => {
      const make = (n: number) =>
        Array.from({ length: n }, (_, i) => `Para ${i}.\n\n<!--del k3x9 old-->\n\n`).join('');
      const editors = [load(make(1000)), load(make(4000))];
      const pass = (editor: Editor) => {
        const start = performance.now();
        trackedDecorations(editor.view.state);
        return performance.now() - start;
      };
      for (let warm = 0; warm < 3; warm++) editors.forEach((editor) => pass(editor));
      // The two sizes take turns, and each is held to its fastest pass: a runner slowed for a few
      // seconds slows both alike, and each size's fastest pass is the one it slowed least. Timed one
      // size after the other, as this was, the ratio read 6.1 to 7.1 on CI's runners (#398).
      const attempt = () => {
        const fastest = [Infinity, Infinity];
        for (let round = 0; round < 9; round++) {
          editors.forEach((editor, i) => {
            fastest[i] = Math.min(fastest[i]!, pass(editor));
          });
        }
        return fastest[1]! / fastest[0]!;
      };
      // Four times the lines: linear takes about four times as long (3.8 to 4.5 here), quadratic
      // sixteen. The limit is eight, as far from the one as from the other.
      const LIMIT = 8;
      // As `held` in cost.test.ts does: a ratio over the limit is timed twice more, and the lowest
      // is the one held to it, so that a real slowdown fails and a slow moment doesn't.
      let ratio = attempt();
      for (let again = 0; again < 2 && ratio >= LIMIT; again++) ratio = Math.min(ratio, attempt());
      console.log(`hidden lines: 4,000 lines of markers cost ${ratio.toFixed(2)} times 1,000`);
      expect(ratio).toBeLessThan(LIMIT);
    },
    60_000,
  );
});
