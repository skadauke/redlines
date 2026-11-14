// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { createEditor, type Editor } from '../index.ts';
import {
  bandsOf,
  barLayerThemeSpec,
  barMeasure,
  type BarMeasure,
  hasRightToLeft,
  hotBar,
  rowsOfRects,
  segmentsOf,
  setHotBar,
  stopsOf,
  type DrawnPiece,
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
      { from: 180, to: 290, top: 34, bottom: 58, colors: [3] },
    ]);
  });

  it('is one bar as tall as the paragraph when every screen line holds a change', () => {
    expect(segmentsOf(line, screen, [{ from: 100, to: 400, color: 3 }])).toEqual([
      { from: 100, to: 400, top: 0, bottom: 82, colors: [3] },
    ]);
  });

  it('joins the screen lines that a change runs over, and no others', () => {
    expect(segmentsOf(line, screen, [{ from: 250, to: 350, color: 3 }])).toEqual([
      { from: 180, to: 400, top: 34, bottom: 82, colors: [3] },
    ]);
  });

  it('puts a point, a deletion the view hides, on the screen line it stands at', () => {
    const at = (pos: number) => segmentsOf(line, screen, [{ from: pos, to: pos, color: 2 }]);
    expect(at(150)).toEqual([{ from: 100, to: 180, top: 0, bottom: 34, colors: [2] }]);
    // Where one screen line ends and the next begins, it is on the next; at the paragraph's end, on
    // the last.
    expect(at(180)).toEqual([{ from: 180, to: 290, top: 34, bottom: 58, colors: [2] }]);
    expect(at(400)).toEqual([{ from: 290, to: 400, top: 58, bottom: 82, colors: [2] }]);
    expect(at(100)).toEqual([{ from: 100, to: 180, top: 0, bottom: 34, colors: [2] }]);
  });

  it('leaves the next screen line alone when a change ends where the line breaks', () => {
    expect(segmentsOf(line, screen, [{ from: 120, to: 180, color: 3 }])).toEqual([
      { from: 100, to: 180, top: 0, bottom: 34, colors: [3] },
    ]);
    expect(segmentsOf(line, screen, [{ from: 180, to: 200, color: 3 }])).toEqual([
      { from: 180, to: 290, top: 34, bottom: 58, colors: [3] },
    ]);
  });

  it('keeps each screen line to the authors on it: two bars, two colors', () => {
    expect(
      segmentsOf(line, screen, [
        { from: 110, to: 120, color: 3 },
        { from: 300, to: 310, color: 4 },
      ]),
    ).toEqual([
      { from: 100, to: 180, top: 0, bottom: 34, colors: [3] },
      { from: 290, to: 400, top: 58, bottom: 82, colors: [4] },
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
      { from: 100, to: 180, top: 0, bottom: 34, colors: [3, 4] },
      { from: 180, to: 290, top: 34, bottom: 58, colors: [3] },
    ]);
  });

  it('is a change that began above and ends below the paragraph: all of it', () => {
    expect(segmentsOf(line, screen, [{ from: 10, to: 900, color: 3 }])).toEqual([
      { from: 100, to: 400, top: 0, bottom: 82, colors: [3] },
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
      { from: 100, to: 290, top: 0, bottom: 58, colors: [2] },
    ]);
    // A piece on a screen line with other changes of other authors adds its color there.
    expect(
      segmentsOf(
        line,
        screen,
        [{ from: 200, to: 205, color: 3 }],
        [{ top: 38, bottom: 56, color: 2 }],
      ),
    ).toEqual([{ from: 180, to: 290, top: 34, bottom: 58, colors: [2, 3] }]);
    // A piece that is on no screen line of this paragraph is nobody's.
    expect(segmentsOf(line, screen, [], [{ top: 500, bottom: 520, color: 2 }])).toEqual([]);
  });

  it('draws a paragraph of one screen line as one bar', () => {
    const one = { from: 0, to: 20 };
    expect(
      segmentsOf(one, [{ from: 0, to: 20, top: 0, bottom: 20 }], [{ from: 5, to: 6, color: 3 }]),
    ).toEqual([{ from: 0, to: 20, top: 0, bottom: 20, colors: [3] }]);
  });
});

describe('rowsOfRects', () => {
  it('makes one row of the pieces of a line that lie on the same row of the page, in any order', () => {
    // The fragments of text, a marker's empty span and a widget buffer on three rows of 20 px.
    const rects = [
      { top: 104, bottom: 124 },
      { top: 0, bottom: 20 },
      { top: 2, bottom: 22 },
      { top: 52, bottom: 72 },
      { top: 0, bottom: 20 },
      { top: 50, bottom: 70 },
      { top: 100, bottom: 120 },
    ];
    expect(rowsOfRects(rects)).toEqual([
      { top: 0, bottom: 22 },
      { top: 50, bottom: 72 },
      { top: 100, bottom: 124 },
    ]);
  });

  it('keeps a row apart from the one below though an inline image makes it taller than its text', () => {
    // Text on the first row, a 100 px image on the second (the text beside it low in it) and text
    // on the third, which starts where the image ends.
    const rects = [
      { top: 0, bottom: 20 },
      { top: 30, bottom: 130 },
      { top: 110, bottom: 130 },
      { top: 130, bottom: 150 },
    ];
    expect(rowsOfRects(rects)).toEqual([
      { top: 0, bottom: 20 },
      { top: 30, bottom: 130 },
      { top: 130, bottom: 150 },
    ]);
  });

  it('drops what has no height, such as a line break, and has no rows for nothing', () => {
    expect(rowsOfRects([{ top: 5, bottom: 5 }])).toEqual([]);
    expect(rowsOfRects([])).toEqual([]);
    expect(
      rowsOfRects([
        { top: 0, bottom: 20 },
        { top: 10, bottom: 10.5 },
      ]),
    ).toEqual([{ top: 0, bottom: 20 }]);
  });
});

describe('hasRightToLeft', () => {
  it('is true for Hebrew, Arabic and the like, anywhere in the text, and false for the rest', () => {
    expect(hasRightToLeft('A word, שלום, and more')).toBe(true);
    expect(hasRightToLeft('مرحبا')).toBe(true);
    expect(hasRightToLeft('ܫܠܡܐ')).toBe(true);
    expect(hasRightToLeft('An English line with `code`, ünïcödé, 日本語 and emoji 🎉')).toBe(false);
    expect(hasRightToLeft('')).toBe(false);
  });
});

describe('stopsOf', () => {
  const line = { from: 100, to: 400 };
  const rows = [
    { top: 0, bottom: 20 },
    { top: 28, bottom: 48 },
    { top: 56, bottom: 76 },
  ];

  it('starts each screen line where the page says its row starts, and ends it where the next starts', () => {
    const starts = new Map([
      [rows[1], 180],
      [rows[2], 290],
    ]);
    expect(stopsOf(rows, line, (row) => starts.get(row) ?? 0)).toEqual([
      { from: 100, to: 180, top: 0, bottom: 20 },
      { from: 180, to: 290, top: 28, bottom: 48 },
      { from: 290, to: 400, top: 56, bottom: 76 },
    ]);
  });

  it('starts the first at the line, and keeps the others in order and inside it', () => {
    // A position the page gave before the row above, or past the end of the line, is put back.
    const given = [0, 90, 900];
    const stops = stopsOf(rows, line, (row) => given[rows.indexOf(row)] ?? 0);
    expect(stops.map(({ from }) => from)).toEqual([100, 100, 400]);
    expect(stops.map(({ to }) => to)).toEqual([100, 400, 400]);
  });

  it('gives the rows of a widget that wraps the one position, and the last of them the text after', () => {
    // A struck widget at 150 that runs over the second and third rows: its rows start where it is.
    const given = [0, 150, 150];
    expect(stopsOf(rows, line, (row) => given[rows.indexOf(row)] ?? 0)).toEqual([
      { from: 100, to: 150, top: 0, bottom: 20 },
      { from: 150, to: 150, top: 28, bottom: 48 },
      { from: 150, to: 400, top: 56, bottom: 76 },
    ]);
  });

  it('is one screen line for a line with one row or none', () => {
    expect(stopsOf([rows[0]!], line, () => 0)).toEqual([
      { from: 100, to: 400, top: 0, bottom: 20 },
    ]);
    expect(stopsOf([], line, () => 0)).toEqual([]);
  });

  it('takes the rows past a limit for one screen line, the last, as tall as they are together', () => {
    const many = Array.from({ length: 2500 }, (_, i) => ({ top: i * 20, bottom: i * 20 + 18 }));
    const stops = stopsOf(many, { from: 0, to: 100000 }, (row) => many.indexOf(row) * 10);
    expect(stops).toHaveLength(2000);
    expect(stops.at(-1)).toMatchObject({ to: 100000, top: 1999 * 20, bottom: 2499 * 20 + 18 });
  });
});

describe('bandsOf', () => {
  const line = { from: 100, to: 400 };

  it('makes the bands of the screen lines meet halfway between their text, and the ends reach the line’s', () => {
    // Three rows of text 24 px apart and 16 px high, in a line from 0 to 82 with spacing around.
    const stops = [
      { from: 100, to: 180, top: 6, bottom: 22 },
      { from: 180, to: 290, top: 30, bottom: 46 },
      { from: 290, to: 400, top: 54, bottom: 70 },
    ];
    expect(bandsOf(stops, { top: 0, bottom: 82 }, line)).toEqual([
      { from: 100, to: 180, top: 0, bottom: 26 },
      { from: 180, to: 290, top: 26, bottom: 50 },
      { from: 290, to: 400, top: 50, bottom: 82 },
    ]);
  });

  it('is one screen line, the whole line, when there is one stop or none', () => {
    expect(
      bandsOf([{ from: 100, to: 400, top: 6, bottom: 22 }], { top: 0, bottom: 28 }, line),
    ).toEqual([{ from: 100, to: 400, top: 0, bottom: 28 }]);
    expect(bandsOf([], { top: 0, bottom: 28 }, line)).toEqual([
      { from: 100, to: 400, top: 0, bottom: 28 },
    ]);
  });

  it('does not make a second screen line of a boundary on the row of the first', () => {
    // A paragraph that ends in a marker the view hides: CodeMirror gives the position before it as
    // the end of the row, and what follows is no new row. Two bands would each be half the line.
    const stops = [
      { from: 100, to: 390, top: 6, bottom: 22 },
      { from: 390, to: 400, top: 6, bottom: 22 },
    ];
    expect(bandsOf(stops, { top: 0, bottom: 28 }, line)).toEqual([
      { from: 100, to: 400, top: 0, bottom: 28 },
    ]);
    // Also where the text there is a little smaller or lower, as in a span of code.
    expect(
      bandsOf(
        [stops[0] as ScreenLine, { from: 390, to: 400, top: 8, bottom: 20 }],
        { top: 0, bottom: 28 },
        line,
      ),
    ).toEqual([{ from: 100, to: 400, top: 0, bottom: 28 }]);
  });

  it('keeps the rows of tight lines apart though their text boxes overlap', () => {
    // 20 px boxes 18 px apart: the second row starts above the bottom of the first.
    const stops = [
      { from: 100, to: 250, top: 0, bottom: 20 },
      { from: 250, to: 400, top: 18, bottom: 38 },
    ];
    expect(bandsOf(stops, { top: 0, bottom: 36 }, line)).toEqual([
      { from: 100, to: 250, top: 0, bottom: 19 },
      { from: 250, to: 400, top: 19, bottom: 36 },
    ]);
  });

  it('lets the last screen line reach the end of the line of the file', () => {
    // The walk stopped where the page gave no position for the text (a hidden range).
    const stops = [
      { from: 100, to: 180, top: 6, bottom: 22 },
      { from: 180, to: 290, top: 30, bottom: 46 },
    ];
    expect(bandsOf(stops, { top: 0, bottom: 58 }, line).at(-1)).toEqual({
      from: 180,
      to: 400,
      top: 26,
      bottom: 58,
    });
  });
});

describe('the layer', () => {
  const doc =
    'Alpha.\n\nBeta <!--ins b2b2-->two<!--/b2b2--> three four five six seven eight nine ten.\n\nGamma.\n\n<!-- redlines\nversion: 1\nmarks:\n  b2b2: {by: ada, at: 2026-10-31T09:30Z}\n-->\n';

  /**
   * Lines 20 px high, the paragraph with the change wrapped over three screen lines by character
   * position, from x = 100. Happy-dom has no layout.
   */
  const measureWith = (drawn?: DrawnPiece[]): BarMeasure => ({
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
        ...(drawn ? { drawn } : {}),
      };
    },
  });
  const measure = measureWith();

  /** The same paragraph with a second change in its last third. */
  const two =
    'Alpha.\n\nBeta <!--ins b2b2-->two<!--/b2b2--> three four five six seven eight <!--ins c3c3-->nine<!--/c3c3--> ten.\n\nGamma.\n\n<!-- redlines\nversion: 1\nmarks:\n  b2b2: {by: ada, at: 2026-10-31T09:30Z}\n  c3c3: {by: ada, at: 2026-10-31T09:35Z}\n-->\n';

  function load(
    view: 'redlines' | 'simple' | 'clean' | 'raw' = 'redlines',
    options: { doc?: string; measure?: BarMeasure } = {},
  ) {
    const parent = document.createElement('div');
    document.body.append(parent);
    const editor = createEditor(parent, {
      doc: options.doc ?? doc,
      author: ada,
      view,
      extensions: [barMeasure.of(options.measure ?? measure)],
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

  it('widens one of the two bars of a paragraph, the one whose screen lines start where it says', async () => {
    const editor = load('redlines', { doc: two });
    await frame();
    // The first and the last third hold a change: two bars with the middle third between them.
    expect(segments(editor).map(({ top }) => top)).toEqual(['100px', '140px']);
    const from = editor.view.state.doc.line(3).from;
    const lastThird = from + 2 * Math.ceil(editor.view.state.doc.line(3).length / 3);
    for (const [hot, expected] of [
      [from, [true, false]],
      [lastThird, [false, true]],
    ] as const) {
      editor.view.dispatch({ effects: setHotBar.of({ from: hot }) });
      await frame();
      expect(segments(editor).map(({ className }) => className.includes('rl-bar-hot'))).toEqual(
        expected,
      );
    }
  });

  it('lets go of the bar under the pointer when the text or the view changes', async () => {
    const editor = load();
    await frame();
    const from = editor.view.state.doc.line(3).from;
    editor.view.dispatch({ effects: setHotBar.of({ from }) });
    expect(editor.view.state.field(hotBar)).toEqual({ from });
    editor.view.dispatch({ changes: { from: 0, insert: 'x' } });
    expect(editor.view.state.field(hotBar)).toBeNull();
    editor.view.dispatch({ effects: setHotBar.of({ from }) });
    editor.setViewMode('simple');
    expect(editor.view.state.field(hotBar)).toBeNull();
    editor.view.dispatch({ effects: setHotBar.of({ from }) });
    editor.view.dispatch({ selection: { anchor: 3 } });
    expect(editor.view.state.field(hotBar)).toEqual({ from });
  });

  it('draws a bar on each screen line that deleted text drawn apart from the text is on', async () => {
    // Redlines draws deleted words as a widget that wraps as text does: the page says where each
    // piece is, and the third screen line holds one though no position of the file does.
    const pieces = [{ top: 142, bottom: 158, color: 7 }];
    const editor = load('redlines', { measure: measureWith(pieces) });
    await frame();
    const drawn = segments(editor);
    expect(drawn.map(({ top, height }) => [top, height])).toEqual([
      ['100px', '20px'],
      ['140px', '20px'],
    ]);
    expect(drawn[1]?.className).toContain('rl-author-7');
  });

  it('draws one bar for each line of the file that a change runs over', async () => {
    const across =
      'First <!--ins b2b2-->one\n\ntwo<!--/b2b2--> last.\n\nNo change.\n\n<!-- redlines\nversion: 1\nmarks:\n  b2b2: {by: ada, at: 2026-10-31T09:30Z}\n-->\n';
    const editor = load('redlines', { doc: across });
    await frame();
    // The paragraph the change begins in, the blank line it runs over and the one it ends in:
    // nothing on the paragraph below.
    expect(segments(editor)).toHaveLength(3);
  });

  it('draws nothing beside a line the page does not draw, and the others as they are', async () => {
    const both =
      'Alpha <!--ins k3x9-->one<!--/k3x9-->.\n\nBeta <!--ins b2b2-->two<!--/b2b2--> three four five six.\n\n<!-- redlines\nversion: 1\nmarks:\n  k3x9: {by: ada, at: 2026-10-31T09:30Z}\n  b2b2: {by: ada, at: 2026-10-31T09:35Z}\n-->\n';
    const hidden: BarMeasure = {
      screenLines: (view, line) =>
        view.state.doc.lineAt(line.from).text.startsWith('Beta')
          ? null
          : measure.screenLines(view, line),
    };
    const editor = load('redlines', { doc: both, measure: hidden });
    await frame();
    // The Alpha line's bar only: the Beta line is not drawn, and nothing breaks over it.
    expect(segments(editor)).toHaveLength(1);
    const none: BarMeasure = { screenLines: () => null };
    const nothing = load('redlines', { doc: both, measure: none });
    await frame();
    expect(segments(nothing)).toEqual([]);
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
