// Debug only: checks Redlines' simple look in WebKit, where happy-dom can't: the click on a change
// bar through real layout (the target found by `posAtCoords` and the layer's bars, the line kept
// where it was, the hand and the wider bar), and the drawing as the page has it. Serve the page with
// `VITE_SIMPLE_CHECK=1 pnpm dev` (or `pnpm tauri dev`, for WKWebView) and open it in WebKit: it
// reads nothing in a release build. Each check reports one console line, `SIMPLE-CHECK <name> pass`
// or `SIMPLE-CHECK <name> FAIL <json>`, then `SIMPLE-CHECK done <passed> passed, <failed> failed`.
//
// It also leaves `window.__REDLINES_SIMPLE__ = { editor, drawing, run }` on the page, to ask by hand:
// `drawing()` says what the view draws now (the view, the classes drawn, the bars by line, the
// text that shows), and `run()` runs the checks again. Printing and a trackpad's click are for a
// person to try (the steps are in the stage's report).

import { EditorView } from '@codemirror/view';
import type { Editor, MarkupView } from '@redlines/editor';

/** What the page draws for the view it shows. Plain data, so that it reads in a console. */
export interface Drawing {
  view: string;
  markupView: MarkupView;
  /** The classes of the editor's own element, such as `rl-view-simple`. */
  editorClass: string;
  /** How many elements of each kind of redline the content holds. */
  drawn: Record<'ins' | 'del' | 'fmt' | 'split' | 'comment' | 'cmt' | 'cmtPoint', number>;
  /** The lines that hold a change: the line's number in the document and the line's classes. */
  bars: { line: number; className: string }[];
  /** The bars the layer draws beside them, one for each run of screen lines that holds a change. */
  segments: { className: string; top: number; height: number }[];
  /** The text the lines show, one string per line, without the markers. */
  text: string[];
  /** The page's rail: whether it shows, and how many notes. */
  rail: { shown: boolean; compact: boolean; notes: number; dots: number };
}

const count = (editor: Editor, selector: string) =>
  editor.view.contentDOM.querySelectorAll(selector).length;

export function drawing(editor: Editor): Drawing {
  const { view } = editor;
  const ui = editor.getUiState();
  const bars: Drawing['bars'] = [];
  for (const line of view.contentDOM.querySelectorAll<HTMLElement>('.cm-line.rl-bar')) {
    const n = view.state.doc.lineAt(view.posAtDOM(line)).number;
    bars.push({
      line: n,
      className: [...line.classList].filter((c) => /^rl-(bar|author)/.test(c)).join(' '),
    });
  }
  return {
    view: ui.view,
    markupView: ui.markupView,
    editorClass: [...view.dom.classList].filter((c) => c.startsWith('rl-view-')).join(' '),
    drawn: {
      ins: count(editor, '.rl-ins'),
      del: count(editor, '.rl-del'),
      fmt: count(editor, '.rl-fmt'),
      split: count(editor, '.rl-split'),
      comment: count(editor, '.rl-comment'),
      cmt: count(editor, '.rl-cmt'),
      cmtPoint: count(editor, '.rl-cmt-point'),
    },
    bars,
    segments: [...view.scrollDOM.querySelectorAll<HTMLElement>('.rl-bar-seg')].map((seg) => {
      const rect = seg.getBoundingClientRect();
      return {
        className: [...seg.classList].filter((c) => c !== 'rl-bar-seg').join(' '),
        top: Math.round(rect.top),
        height: Math.round(rect.height),
      };
    }),
    text: [...view.contentDOM.querySelectorAll('.cm-line')].map((line) => line.textContent ?? ''),
    rail: {
      shown: view.dom.classList.contains('rl-has-rail'),
      // Narrower than about 800 px, the notes are dots.
      compact: !!view.dom.querySelector('.rl-rail-compact'),
      notes: view.dom.querySelectorAll('.rl-note').length,
      dots: view.dom.querySelectorAll('.rl-note-dot').length,
    },
  };
}

/** The editor being checked, whose measuring `frames` takes on by hand (see there). */
let measuring: Editor | null = null;

/**
 * CodeMirror's own measuring, which waits for a frame, done now: the layer's bars are drawn by it,
 * and a page in a hidden pane or tab gets no frames. `measure` isn't in CodeMirror's types, and
 * it is what its own tests call; this is debug code.
 */
const measureNow = (editor: Editor) => (editor.view as unknown as { measure(): void }).measure();

const frames = async () => {
  // A page in a hidden pane or tab gets no frames: the timer is the way on, and the editor's own
  // measuring, which waits for a frame (the layer's bars are drawn by it), is asked for by hand.
  if (measuring) measureNow(measuring);
  await new Promise((resolve) => {
    requestAnimationFrame(resolve);
    setTimeout(resolve, 100);
  });
  if (measuring) measureNow(measuring);
  await new Promise((resolve) => setTimeout(resolve, 60));
  if (measuring) measureNow(measuring);
};

/** Paragraphs enough to scroll. */
const filler = (changes: boolean) =>
  Array.from({ length: 30 }, (_, i) => {
    const plain = `Paragraph ${i + 1} of the filler, which says nothing and only takes room on the page.`;
    // Long deletions just above the change (in view when it is) that the views draw at different heights: Redlines strikes
    // the text and wraps it, Simple hides it. The line under the pointer has to stay where it was.
    const long = `${'Struck words that run over several lines of the page. '.repeat(8)}`;
    if (changes && i === 27) return `${plain}<!--del m3m3 ${long}-->`;
    if (changes && i === 28) return `${plain}<!--del n5n5 ${long}-->`;
    return plain;
  }).join('\n\n');

const DOC = `${filler(true)}

A <!--ins k3x9-->new<!--/k3x9--> word, <!--sub p7qd old text-->the replaced<!--/p7qd--> text, and <!--cmt c8d2-->a comment<!--/c8d2-->.<!--del w2rf  Gone sentence.-->

<!--del d4d4 A paragraph deleted whole.\\n\\n-->

Plain below.

${filler(false)}

<!-- redlines
version: 1
people:
  ada: {name: Ada Lovelace}
  bo: {name: Bo Chen}
  claude-ada: {name: Claude, agent: true, for: ada}
marks:
  k3x9: {by: ada, at: 2026-10-31T09:30Z}
  p7qd: {by: claude-ada, at: 2026-10-31T09:31Z, note: Tense}
  w2rf: {by: bo, at: 2026-10-31T09:35Z}
  d4d4: {by: bo, at: 2026-10-31T09:36Z}
  m3m3: {by: bo, at: 2026-10-31T09:36Z}
  n5n5: {by: ada, at: 2026-10-31T09:36Z}
comments:
  c8d2:
    by: bo
    at: 2026-10-31T09:41Z
    text: |-
      Is this right?
-->
`;

interface Problem {
  [key: string]: unknown;
}

type Result = Problem | null;

const mouse = (type: string, x: number, y: number, init: MouseEventInit = {}) =>
  new MouseEvent(type, {
    clientX: x,
    clientY: y,
    button: 0,
    bubbles: true,
    cancelable: true,
    detail: 1,
    ...init,
  });

/** The line of the change in the middle of the page ("A new word"), which has a bar in both views. */
const barLine = (editor: Editor) =>
  [...editor.view.contentDOM.querySelectorAll<HTMLElement>('.cm-line.rl-bar')].find((line) =>
    /word,/.test(line.textContent ?? ''),
  ) ?? null;

/**
 * The first line with a bar, its rectangle and the point on its bar's target: the middle of the
 * first piece of the bar that the layer draws beside it, which is the screen lines that hold a
 * change and not the whole line.
 */
function barTarget(
  editor: Editor,
): { line: HTMLElement; x: number; y: number; top: number; bar: HTMLElement } | null {
  const line = barLine(editor);
  if (!line) return null;
  const rect = line.getBoundingClientRect();
  const bar = [...editor.view.scrollDOM.querySelectorAll<HTMLElement>('.rl-bar-seg')].find(
    (seg) => {
      const box = seg.getBoundingClientRect();
      return box.bottom > rect.top && box.top < rect.bottom;
    },
  );
  if (!bar) return null;
  const box = bar.getBoundingClientRect();
  return { line, bar, x: box.left + 1, y: (box.top + box.bottom) / 2, top: rect.top };
}

/** A press and release at a point, as a mouse sends them. */
function click(editor: Editor, x: number, y: number, init: MouseEventInit = {}): boolean {
  const down = mouse('mousedown', x, y, init);
  editor.view.scrollDOM.dispatchEvent(down);
  document.dispatchEvent(mouse('mouseup', x, y, init));
  return down.defaultPrevented;
}

async function open(editor: Editor, view: 'clean' | 'simple' | 'redlines' | 'raw'): Promise<void> {
  editor.setTracking(false, { inFile: false });
  editor.reloadDoc(DOC);
  editor.setViewMode(view);
  // Down to the change, so that lines above it are drawn too. The page scrolls in an element
  // around the editor, not in the editor's own scroller, so the change is scrolled to as the
  // page's own scrolling would be.
  const at = editor.getDoc().indexOf('A <!--ins k3x9');
  editor.view.dispatch({
    selection: { anchor: at },
    effects: EditorView.scrollIntoView(at, { y: 'center' }),
  });
  await frames();
  barLine(editor)?.scrollIntoView({ block: 'center' });
  await frames();
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const CHECKS: { name: string; run: (editor: Editor) => Promise<Result> }[] = [
  {
    name: 'draws-no-markup-looks',
    async run(editor) {
      await open(editor, 'simple');
      const found = drawing(editor);
      const { ins, del, fmt, split, comment } = found.drawn;
      if (ins + del + fmt + split + comment > 0) return { found: found.drawn };
      if (found.drawn.cmt === 0 || found.drawn.cmtPoint < 0) return { found: found.drawn };
      if (!found.editorClass.includes('rl-view-simple')) return { editorClass: found.editorClass };
      // The rail shows, as notes in a wide window and as dots in a narrow one.
      if (!found.rail.shown && !(found.rail.compact && found.rail.dots))
        return { rail: found.rail };
      return found.bars.length ? null : { bars: found.bars };
    },
  },
  {
    name: 'same-bars-as-redlines-and-text-as-clean',
    async run(editor) {
      await open(editor, 'simple');
      const simple = drawing(editor);
      editor.setViewMode('redlines');
      await frames();
      const redlines = drawing(editor);
      // Redlines draws a block deleted whole as a block with a bar of its own, where Simple marks
      // the line after it: those are the bars Redlines' lines lack, and it has no others.
      const struck = editor.view.contentDOM.querySelectorAll('.rl-struck').length;
      editor.setViewMode('clean');
      await frames();
      const clean = drawing(editor);
      const missing = simple.bars.filter((bar) => !redlines.bars.some((each) => same(each, bar)));
      const extra = redlines.bars.filter((bar) => !simple.bars.some((each) => same(each, bar)));
      if (extra.length || missing.length !== struck) {
        return { simple: simple.bars, redlines: redlines.bars, struck };
      }
      return same(simple.text, clean.text) ? null : { simple: simple.text, clean: clean.text };
    },
  },
  {
    name: 'click-switches-and-keeps-the-line',
    async run(editor) {
      await open(editor, 'simple');
      const target = barTarget(editor);
      if (!target) return { note: 'no bar drawn' };
      const taken = click(editor, target.x, target.y);
      await frames();
      const after = editor.getUiState();
      if (!taken || after.view !== 'redlines') return { taken, view: after.view };
      // The line that was under the pointer is where it was, to the pixel.
      const moved = target.line.isConnected
        ? target.line.getBoundingClientRect().top - target.top
        : null;
      const next = barTarget(editor);
      const drift = next ? next.top - target.top : null;
      if (drift === null || Math.abs(drift) > 1) return { moved, drift };
      click(editor, next!.x, next!.y);
      await frames();
      return editor.getUiState().view === 'simple' ? null : { view: editor.getUiState().view };
    },
  },
  {
    name: 'click-moves-no-selection-or-focus',
    async run(editor) {
      await open(editor, 'simple');
      const target = barTarget(editor);
      if (!target) return { note: 'no bar drawn' };
      // The word "new", an edge of the selection on the bar's own line, visible in both views.
      const start = editor.getDoc().indexOf('new<!--/k3x9-->');
      editor.view.dispatch({ selection: { anchor: start, head: start + 3 } });
      editor.view.focus();
      await frames();
      const focused = editor.view.hasFocus;
      const before = [
        editor.view.state.selection.main.anchor,
        editor.view.state.selection.main.head,
      ];
      click(editor, target.x, target.y);
      await frames();
      const range = editor.view.state.selection.main;
      return same([range.anchor, range.head], before) && editor.view.hasFocus === focused
        ? null
        : { before, after: [range.anchor, range.head], focused, now: editor.view.hasFocus };
    },
  },
  {
    name: 'click-ignores-moves-modifiers-clean-raw-and-the-second-click',
    async run(editor) {
      await open(editor, 'simple');
      const target = barTarget(editor)!;
      const problems: Problem = {};
      // A press that moves 5 px.
      editor.view.scrollDOM.dispatchEvent(mouse('mousedown', target.x, target.y));
      document.dispatchEvent(mouse('mouseup', target.x + 5, target.y));
      if (editor.getUiState().view !== 'simple') problems['moved'] = true;
      for (const init of [
        { metaKey: true },
        { altKey: true },
        { shiftKey: true },
        { ctrlKey: true },
      ]) {
        if (click(editor, target.x, target.y, init) || editor.getUiState().view !== 'simple') {
          problems['modifier'] = Object.keys(init)[0];
        }
      }
      // Away from the bar.
      if (click(editor, target.x + 40, target.y)) problems['beside'] = true;
      for (const view of ['clean', 'raw'] as const) {
        editor.setViewMode(view);
        await frames();
        click(editor, target.x, target.y);
        if (editor.getUiState().view !== view) problems[view] = editor.getUiState().view;
      }
      // A double-click switches once.
      await open(editor, 'simple');
      const again = barTarget(editor)!;
      click(editor, again.x, again.y);
      click(editor, again.x, again.y, { detail: 2 });
      if (editor.getUiState().view !== 'redlines') problems['double'] = editor.getUiState().view;
      return Object.keys(problems).length ? problems : null;
    },
  },
  {
    name: 'hover-gives-the-hot-bar-the-hand-and-no-hint',
    async run(editor) {
      await open(editor, 'simple');
      const target = barTarget(editor)!;
      editor.view.scrollDOM.dispatchEvent(mouse('mousemove', target.x, target.y));
      await new Promise((resolve) => setTimeout(resolve, 700));
      measureNow(editor);
      const hot = editor.view.scrollDOM.querySelectorAll('.rl-bar-seg.rl-bar-hot');
      const cursor = editor.view.scrollDOM.style.cursor;
      const width = hot[0]?.getBoundingClientRect().width;
      // No hint, however long the pointer rests.
      const hint = document.querySelector('.rl-bar-hint') ?? document.querySelector('.cm-tooltip');
      editor.view.scrollDOM.dispatchEvent(mouse('mouseleave', target.x, target.y));
      await new Promise((resolve) => setTimeout(resolve, 100));
      measureNow(editor);
      const left = editor.view.scrollDOM.querySelectorAll('.rl-bar-seg.rl-bar-hot').length;
      return hot.length === 1 && width === 3 && cursor === 'pointer' && !hint && left === 0
        ? null
        : { hot: hot.length, width, cursor, hint: !!hint, left };
    },
  },
  {
    name: 'a-bar-marks-only-the-screen-lines-a-change-is-on',
    async run(editor) {
      await open(editor, 'redlines');
      // A paragraph that wraps over many screen lines, with one word changed on one of them.
      const filler = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod. ';
      const doc = [
        `${filler.repeat(14)}<!--ins k3x9-->three changed words<!--/k3x9--> ${filler.repeat(10)}`,
        '',
        'Plain.',
        '',
        '<!-- redlines',
        'version: 1',
        'people:',
        '  ada: {name: Ada Lovelace}',
        'marks:',
        '  k3x9: {by: ada, at: 2026-10-31T09:30Z}',
        '-->',
        '',
      ].join('\n');
      editor.reloadDoc(doc);
      editor.setViewMode('redlines');
      await frames();
      const line = editor.view.contentDOM.querySelector<HTMLElement>('.cm-line.rl-bar');
      const ins = editor.view.contentDOM.querySelector<HTMLElement>('.rl-ins');
      const seg = editor.view.scrollDOM.querySelectorAll<HTMLElement>('.rl-bar-seg');
      if (!line || !ins || seg.length !== 1)
        return { line: !!line, ins: !!ins, segments: seg.length };
      const lineBox = line.getBoundingClientRect();
      const insBox = ins.getBoundingClientRect();
      const bar = seg[0]!.getBoundingClientRect();
      // Far shorter than the paragraph, and level with the changed words.
      const covers = bar.top <= insBox.top + 2 && bar.bottom >= insBox.bottom - 2;
      const short = bar.height < lineBox.height / 3;
      const left = Math.abs(bar.left - (lineBox.left - 24)) < 1;
      return covers && short && left
        ? null
        : {
            covers,
            short,
            left,
            bar: [bar.top, bar.bottom],
            ins: [insBox.top, insBox.bottom],
            line: [lineBox.top, lineBox.bottom],
          };
    },
  },
  {
    name: 'a-change-at-the-edge-of-a-paragraph-has-a-bar-as-tall-as-its-lines',
    async run(editor) {
      await open(editor, 'redlines');
      // The markers the page hides stand at the ends of these paragraphs: one ends in a closer, one
      // starts with an opener, and one wraps over screen lines with its change at the very end.
      const filler = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod. ';
      const doc = [
        'Ends with <!--ins k3x9-->a change<!--/k3x9-->',
        '',
        '<!--ins q3q3-->Begins<!--/q3q3--> with one',
        '',
        `${filler.repeat(12)}<!--ins r2r2-->the last words<!--/r2r2-->`,
        '',
        '<!-- redlines',
        'version: 1',
        'people:',
        '  ada: {name: Ada Lovelace}',
        'marks:',
        '  k3x9: {by: ada, at: 2026-10-31T09:30Z}',
        '  q3q3: {by: ada, at: 2026-10-31T09:31Z}',
        '  r2r2: {by: ada, at: 2026-10-31T09:32Z}',
        '-->',
        '',
      ].join('\n');
      editor.reloadDoc(doc);
      editor.setViewMode('redlines');
      await frames();
      const lines = [...editor.view.contentDOM.querySelectorAll<HTMLElement>('.cm-line.rl-bar')];
      const segs = [...editor.view.scrollDOM.querySelectorAll<HTMLElement>('.rl-bar-seg')];
      if (lines.length !== 3 || segs.length !== 3) {
        return { lines: lines.length, segments: segs.length };
      }
      const problems: Problem = {};
      const [ends, begins, long] = lines.map((el) => el.getBoundingClientRect());
      const [endsBar, beginsBar, longBar] = segs.map((el) => el.getBoundingClientRect());
      // A paragraph of one screen line: its bar is as tall as the line, not half of it.
      if (Math.abs(endsBar!.height - ends!.height) > 3)
        problems['ends'] = [endsBar!.height, ends!.height];
      if (Math.abs(beginsBar!.height - begins!.height) > 3)
        problems['begins'] = [beginsBar!.height, begins!.height];
      // The long one: only its last screen lines, down to the bottom of the paragraph.
      if (longBar!.bottom < long!.bottom - 3 || longBar!.height > long!.height / 2)
        problems['long'] = [longBar!.top, longBar!.bottom, long!.top, long!.bottom];
      return Object.keys(problems).length ? problems : null;
    },
  },
  {
    name: 'accept-on-a-note-in-simple-decides-in-place',
    async run(editor) {
      await open(editor, 'simple');
      const before = editor.getDoc();
      const note = [...editor.view.dom.querySelectorAll<HTMLElement>('.rl-note')].find((el) =>
        el.textContent?.includes('Tense'),
      );
      const accept =
        note &&
        [...note.querySelectorAll('button')].find((b) =>
          /Accept/.test(b.textContent + (b.getAttribute('aria-label') ?? '')),
        );
      if (!accept) return { note: 'no note with an Accept button was drawn' };
      // What the note says it decides, before the click: in words, as a card does.
      const says = note.querySelector('.rl-note-change')?.textContent ?? null;
      // Whatever scrolls, and where it is: a decision leaves every one of them there.
      const scrollers = [...document.querySelectorAll<HTMLElement>('*')].filter(
        (el) =>
          el.scrollHeight > el.clientHeight && /auto|scroll/.test(getComputedStyle(el).overflowY),
      );
      const scrolled = scrollers.map((el) => el.scrollTop);
      accept.click();
      await frames();
      const problems: Problem = {};
      if (!says || !/^(Replaced|Inserted|Deleted)/.test(says)) problems['says'] = says;
      if (editor.getDoc() === before || editor.getDoc().includes('<!--sub p7qd')) {
        problems['decided'] = false;
      }
      if (editor.getUiState().view !== 'simple') problems['view'] = editor.getUiState().view;
      if (editor.getUiState().markupView !== 'simple')
        problems['markupView'] = editor.getUiState().markupView;
      const moved = scrollers.map((el, i) => el.scrollTop - (scrolled[i] ?? 0));
      if (moved.some((by) => Math.abs(by) > 1)) problems['scroll'] = moved;
      if (!scrollers.length) problems['scrollers'] = 'nothing scrolls, so the page was not tried';
      return Object.keys(problems).length ? problems : null;
    },
  },
];

export async function runSimpleCheck(editor: Editor): Promise<void> {
  measuring = editor;
  await new Promise((resolve) => setTimeout(resolve, 800));
  const run = async () => {
    let passed = 0;
    let failed = 0;
    for (const check of CHECKS) {
      try {
        const failure = await check.run(editor);
        if (failure) {
          failed++;
          console.log(`SIMPLE-CHECK ${check.name} FAIL ${JSON.stringify(failure)}`);
        } else {
          passed++;
          console.log(`SIMPLE-CHECK ${check.name} pass`);
        }
      } catch (error) {
        failed++;
        console.log(`SIMPLE-CHECK ${check.name} FAIL ${JSON.stringify({ threw: String(error) })}`);
      }
    }
    console.log(`SIMPLE-CHECK done ${passed} passed, ${failed} failed`);
  };
  (window as unknown as Record<string, unknown>)['__REDLINES_SIMPLE__'] = {
    editor,
    drawing: () => drawing(editor),
    run,
  };
  await run();
}
