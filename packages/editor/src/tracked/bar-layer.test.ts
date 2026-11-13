// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { createEditor, type Editor } from '../index.ts';
import {
  barLayerThemeSpec,
  barMeasure,
  type BarMeasure,
  segmentsOf,
  setHotBar,
  type ScreenLine,
} from './bar-layer.ts';

const ada = { handle: 'ada', name: 'Ada Lovelace' };
const open: Editor[] = [];

afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

describe('segmentsOf', () => {
  // A paragraph of the text, positions 100 to 400, that the editor wraps over three screen lines.
  // The first reaches up into the paragraph's spacing.
  const line = { from: 100, to: 400 };
  const screen: ScreenLine[] = [
    { from: 100, to: 180, top: 0, bottom: 34 },
    { from: 180, to: 290, top: 34, bottom: 58 },
    { from: 290, to: 400, top: 58, bottom: 82 },
  ];

  it('marks only the screen line that holds a change, though the paragraph wraps over three', () => {
    expect(segmentsOf(line, screen, [{ from: 200, to: 205, color: 3 }])).toEqual([
      { from: 180, top: 34, bottom: 58, colors: [3] },
    ]);
  });

  it('is one bar as tall as the paragraph when every screen line holds a change', () => {
    expect(segmentsOf(line, screen, [{ from: 100, to: 400, color: 3 }])).toEqual([
      { from: 100, top: 0, bottom: 82, colors: [3] },
    ]);
  });

  it('joins the screen lines that a change runs over, and no others', () => {
    expect(segmentsOf(line, screen, [{ from: 250, to: 350, color: 3 }])).toEqual([
      { from: 180, top: 34, bottom: 82, colors: [3] },
    ]);
  });

  it('puts a point, a deletion the view hides, on the screen line it stands at', () => {
    const at = (pos: number) => segmentsOf(line, screen, [{ from: pos, to: pos, color: 2 }]);
    expect(at(150)).toEqual([{ from: 100, top: 0, bottom: 34, colors: [2] }]);
    // Where one screen line ends and the next begins, it is on the next; at the paragraph's end, on
    // the last.
    expect(at(180)).toEqual([{ from: 180, top: 34, bottom: 58, colors: [2] }]);
    expect(at(400)).toEqual([{ from: 290, top: 58, bottom: 82, colors: [2] }]);
    expect(at(100)).toEqual([{ from: 100, top: 0, bottom: 34, colors: [2] }]);
  });

  it('leaves the next screen line alone when a change ends where the line breaks', () => {
    expect(segmentsOf(line, screen, [{ from: 120, to: 180, color: 3 }])).toEqual([
      { from: 100, top: 0, bottom: 34, colors: [3] },
    ]);
    expect(segmentsOf(line, screen, [{ from: 180, to: 200, color: 3 }])).toEqual([
      { from: 180, top: 34, bottom: 58, colors: [3] },
    ]);
  });

  it('keeps each screen line to the authors on it: two bars, two colors', () => {
    expect(
      segmentsOf(line, screen, [
        { from: 110, to: 120, color: 3 },
        { from: 300, to: 310, color: 4 },
      ]),
    ).toEqual([
      { from: 100, top: 0, bottom: 34, colors: [3] },
      { from: 290, top: 58, bottom: 82, colors: [4] },
    ]);
  });

  it('lists every author on a screen line, which draws gray, and keeps neighbors of other colors apart', () => {
    expect(
      segmentsOf(line, screen, [
        { from: 110, to: 120, color: 3 },
        { from: 130, to: 140, color: 4 },
        { from: 200, to: 210, color: 3 },
      ]),
    ).toEqual([
      { from: 100, top: 0, bottom: 34, colors: [3, 4] },
      { from: 180, top: 34, bottom: 58, colors: [3] },
    ]);
  });

  it('is a change that began above and ends below the paragraph: all of it', () => {
    expect(segmentsOf(line, screen, [{ from: 10, to: 900, color: 3 }])).toEqual([
      { from: 100, top: 0, bottom: 82, colors: [3] },
    ]);
  });

  it('has nothing for changes elsewhere, and nothing for a line the page does not draw', () => {
    expect(segmentsOf(line, screen, [{ from: 500, to: 600, color: 3 }])).toEqual([]);
    expect(segmentsOf(line, screen, [{ from: 0, to: 99, color: 3 }])).toEqual([]);
    expect(segmentsOf(line, [], [{ from: 120, to: 130, color: 3 }])).toEqual([]);
  });

  it('follows deleted text that Redlines draws and that wraps: every screen line it is on', () => {
    // The deletion stands at 150, on the first screen line, and its struck words run on to the
    // second: the page says where each piece of it is.
    const spans = [{ from: 150, to: 150, color: 2 }];
    const pieces = [
      { top: 10, bottom: 30, color: 2 },
      { top: 38, bottom: 56, color: 2 },
    ];
    expect(segmentsOf(line, screen, spans, pieces)).toEqual([
      { from: 100, top: 0, bottom: 58, colors: [2] },
    ]);
    // A piece on a screen line with other changes of other authors adds its color there.
    expect(
      segmentsOf(
        line,
        screen,
        [{ from: 200, to: 205, color: 3 }],
        [{ top: 38, bottom: 56, color: 2 }],
      ),
    ).toEqual([{ from: 180, top: 34, bottom: 58, colors: [2, 3] }]);
    // A piece that is on no screen line of this paragraph is nobody's.
    expect(segmentsOf(line, screen, [], [{ top: 500, bottom: 520, color: 2 }])).toEqual([]);
  });

  it('draws a paragraph of one screen line as one bar', () => {
    const one = { from: 0, to: 20 };
    expect(
      segmentsOf(one, [{ from: 0, to: 20, top: 0, bottom: 20 }], [{ from: 5, to: 6, color: 3 }]),
    ).toEqual([{ from: 0, top: 0, bottom: 20, colors: [3] }]);
  });
});

describe('the layer', () => {
  const doc =
    'Alpha.\n\nBeta <!--ins b2b2-->two<!--/b2b2--> three four five six seven eight nine ten.\n\nGamma.\n\n<!-- redlines\nversion: 1\nmarks:\n  b2b2: {by: ada, at: 2026-10-31T09:30Z}\n-->\n';

  /**
   * Lines 20 px high, the paragraph with the change wrapped over three screen lines by character
   * position, from x = 100. Happy-dom has no layout.
   */
  const measure: BarMeasure = {
    screenLines(view, line) {
      const text = view.state.doc.lineAt(line.from).text;
      if (!text.startsWith('Beta')) {
        return { left: 100, lines: [{ from: line.from, to: line.to, top: 0, bottom: 20 }] };
      }
      const third = Math.ceil((line.to - line.from) / 3);
      return {
        left: 100,
        lines: [0, 1, 2].map((i) => ({
          from: line.from + i * third,
          to: Math.min(line.to, line.from + (i + 1) * third),
          top: 100 + i * 20,
          bottom: 120 + i * 20,
        })),
      };
    },
  };

  function load(view: 'redlines' | 'simple' | 'clean' | 'raw' = 'redlines') {
    const parent = document.createElement('div');
    document.body.append(parent);
    const editor = createEditor(parent, {
      doc,
      author: ada,
      view,
      extensions: [barMeasure.of(measure)],
    });
    open.push(editor);
    return editor;
  }

  const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
  const segments = (editor: Editor) =>
    [...editor.view.scrollDOM.querySelectorAll<HTMLElement>('.rl-bar-seg')].map((el) => ({
      className: el.className,
      top: el.style.top,
      height: el.style.height,
      left: el.style.left,
    }));

  it('draws a bar beside the screen line a change is on, in its author’s color, 24 px left of the text', async () => {
    const editor = load();
    await frame();
    // The insertion is a word in the first third of the paragraph: one screen line, 20 px high.
    expect(segments(editor)).toEqual([
      {
        className: expect.stringContaining('rl-author-') as string,
        top: '100px',
        height: '20px',
        left: '76px',
      },
    ]);
  });

  it('draws the same bars in the simple look, and none in Clean or Raw', async () => {
    const simple = load('simple');
    await frame();
    expect(segments(simple)).toHaveLength(1);
    for (const view of ['clean', 'raw'] as const) {
      const editor = load(view);
      await frame();
      expect(segments(editor), view).toEqual([]);
    }
  });

  it('draws the bars again when the view changes', async () => {
    const editor = load('clean');
    await frame();
    expect(segments(editor)).toEqual([]);
    editor.setViewMode('redlines');
    await frame();
    expect(segments(editor)).toHaveLength(1);
    editor.setViewMode('raw');
    await frame();
    expect(segments(editor)).toEqual([]);
  });

  it('widens the bar that is under the pointer, and only that one', async () => {
    const editor = load();
    await frame();
    const from = editor.view.state.doc.line(3).from;
    editor.view.dispatch({ effects: setHotBar.of({ from }) });
    await frame();
    expect(segments(editor)[0]?.className).toContain('rl-bar-hot');
    editor.view.dispatch({ effects: setHotBar.of({ from: from + 1 }) });
    await frame();
    expect(segments(editor)[0]?.className).not.toContain('rl-bar-hot');
    editor.view.dispatch({ effects: setHotBar.of(null) });
    await frame();
    expect(segments(editor)[0]?.className).not.toContain('rl-bar-hot');
  });

  it('is 2 px wide, 3 under the pointer, in the author’s color or gray', () => {
    expect(barLayerThemeSpec['.rl-bar-seg']).toMatchObject({
      width: '2px',
      backgroundColor: 'var(--rl-color)',
    });
    expect(barLayerThemeSpec['.rl-bar-seg.rl-bar-hot']).toMatchObject({ width: '3px' });
    expect(barLayerThemeSpec['.rl-bar-seg.rl-bar-mixed']).toMatchObject({
      backgroundColor: 'var(--rl-mixed)',
    });
  });

  it('marks the lines as before: the line itself still says it holds a change', () => {
    const editor = load();
    const lines = [...editor.view.contentDOM.querySelectorAll('.cm-line')];
    expect(lines.filter((el) => el.classList.contains('rl-bar'))).toHaveLength(1);
  });
});
