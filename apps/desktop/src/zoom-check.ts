// Debug only: checks in WebKit what happy-dom can't: the column and the rail at every text size,
// and, in the app, the window zoom (the app sets WebKit's zoom, so these need `pnpm tauri dev`).
// Start the app with `VITE_ZOOM_CHECK=1` in the environment of `pnpm tauri dev` (it reads nothing
// in a release build); `quick` leaves out the check that needs the window dragged to its smallest,
// and `surfaces` runs that one alone. It opens the welcome document, sets the editor's width by giving `.rl-main`
// an inline width, and reports each check as one console line: `ZOOM-CHECK <name> pass` or
// `ZOOM-CHECK <name> FAIL <json>`, then `ZOOM-CHECK done <passed> passed, <failed> failed`. The
// console is what `vite` prints, as for print-check.ts.

import { EditorView } from '@codemirror/view';
import type { Editor } from '@redlines/editor';
import type { ReviewController } from '@redlines/review';
import { longDocument } from '../../../packages/editor/src/test-documents.ts';
import sample from './sample.md?raw';
import { applyTextSize } from './text-size.ts';
import type { TextZoom } from './text-zoom.ts';
import type { Notice } from './ui/notice.ts';
import type { Notifications } from './ui/notifications.ts';
import type { PageZoom } from './zoom.ts';

export interface ZoomCheckContext {
  editor: Editor;
  scroller: HTMLElement;
  /** The page's side of the app's zoom; none in a browser, where the zoom checks fail and say so. */
  zoom: PageZoom | null;
  /** The text size's keys and pinch (the pinch is sent to it as the gesture events a trackpad makes). */
  textZoom: TextZoom;
  /** What `surfaces-fit` opens. */
  surfaces: {
    review: ReviewController;
    setSidebar(open: boolean): void;
    notice: Notice;
    notifications: Notifications;
  };
  /** The value of `VITE_ZOOM_CHECK`: `1` for every check, `quick`, or `surfaces`. */
  mode: string;
}

/** The text sizes of the check, and, for each, the editor widths of design's table (CSS px). */
const RAIL_TABLE: { size: number; beside: number; dots: number }[] = [
  { size: 0.8, beside: 884, dots: 703 },
  { size: 1, beside: 1020, dots: 793 },
  { size: 1.25, beside: 1275, dots: 992 },
  { size: 1.5, beside: 1530, dots: 1190 },
  { size: 2, beside: 2040, dots: 1587 },
];
const WIDE_SIZES = [1.1, 1.25, 1.5, 1.75, 2];
const COLUMN = 680;

const frames = async (count = 2) => {
  for (let i = 0; i < count; i++) {
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
  await new Promise((resolve) => setTimeout(resolve, 50));
};

/** The width of the column's text, without its padding. */
function textWidth(content: HTMLElement): number {
  const style = getComputedStyle(content);
  return (
    content.clientWidth -
    parseFloat(style.paddingLeft || '0') -
    parseFloat(style.paddingRight || '0')
  );
}

/** The lines of text the editor shows: its rects, grouped by the line they are on. */
function visualLines(editor: Editor): number {
  let count = 0;
  for (const line of editor.view.dom.querySelectorAll('.cm-line')) {
    const range = document.createRange();
    range.selectNodeContents(line);
    const rects = [...range.getClientRects()]
      .filter((rect) => rect.width > 0 && rect.height > 0)
      .sort((a, b) => a.top - b.top);
    let bottom = -Infinity;
    let rows = 0;
    for (const rect of rects) {
      // A rect that starts below the middle of the row before it is the next row.
      if (rect.top >= bottom - rect.height / 2) {
        rows++;
        bottom = rect.bottom;
      } else bottom = Math.max(bottom, rect.bottom);
    }
    count += Math.max(1, rows);
  }
  return count;
}

export async function runZoomCheck({
  editor,
  scroller,
  zoom,
  textZoom,
  surfaces,
  mode,
}: ZoomCheckContext): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 1000));
  const root = document.documentElement;
  const main = document.querySelector<HTMLElement>('.rl-main');
  if (!main) throw new Error('zoom-check: no .rl-main');
  const content = editor.view.contentDOM;
  let passed = 0;
  let failed = 0;
  const report = (name: string, failures: unknown[]) => {
    if (failures.length === 0) {
      passed++;
      console.warn(`ZOOM-CHECK ${name} pass`);
    } else {
      failed++;
      console.warn(`ZOOM-CHECK ${name} FAIL ${JSON.stringify(failures)}`);
    }
  };

  /**
   * Makes the editor `width` px wide: its scroller's offsetWidth, which the rail goes by. The page's
   * own scroll bar, if it shows one, takes `gutter` from what `.rl-main` holds. It is set in one
   * step, for an editor that passes through a narrower width would shrink its rail to dots, which
   * it leaves only with room to spare.
   */
  let gutter = 0;
  const setWidth = async (width: number) => {
    main.style.flex = 'none';
    main.style.width = `${width + gutter}px`;
    await frames();
  };
  await setWidth(1800);
  gutter = main.offsetWidth - editor.view.scrollDOM.offsetWidth;
  await setWidth(1800);
  const setSize = async (size: number) => {
    applyTextSize(root, size);
    await frames();
  };

  editor.setDoc(sample);
  scroller.scrollTop = 0;

  if (mode !== 'surfaces') {
    // 1. The column is the measure times the text size, and the lines break where they did.
    editor.setViewMode('clean');
    await setWidth(1800);
    await setSize(1);
    const baseline = visualLines(editor);
    const column: unknown[] = [];
    for (const size of WIDE_SIZES) {
      await setSize(size);
      const width = textWidth(content);
      const lines = visualLines(editor);
      if (Math.abs(width - COLUMN * size) > 1)
        column.push({ size, width, expected: COLUMN * size });
      if (Math.abs(lines - baseline) > Math.ceil(baseline / 100))
        column.push({ size, lines, baseline });
    }
    // Past the margins, the column is the page less them.
    await setWidth(1200);
    await setSize(2);
    const page = editor.view.scrollDOM.clientWidth;
    const margins = 2 * parseFloat(getComputedStyle(content).paddingLeft || '0');
    const narrow = textWidth(content);
    if (Math.abs(narrow - (page - margins)) > 1) column.push({ at: 2, narrow, page, margins });
    if (Math.abs(margins - 96) > 1) column.push({ at: 2, margins, expected: 96 });
    report('column-keeps-its-breaks', column);

    // 2. The rail's three states, at the widths of design's table.
    editor.setViewMode('redlines');
    const states: unknown[] = [];
    for (const { size, beside, dots } of RAIL_TABLE) {
      await setSize(size);
      await setWidth(beside);
      const full = textWidth(content);
      if (!editor.view.dom.classList.contains('rl-has-rail'))
        states.push({ size, beside, rail: false });
      if (Math.abs(full - COLUMN * size) > 1)
        states.push({ size, beside, full, expected: COLUMN * size });
      await setWidth(dots + 1);
      if (!editor.view.dom.classList.contains('rl-has-rail'))
        states.push({ size, dots: dots + 1, rail: false });
      await setWidth(dots - 2);
      const rail = editor.view.dom.querySelector('.rl-rail');
      if (!rail?.classList.contains('rl-rail-compact'))
        states.push({ size, dots: dots - 2, compact: false });
    }
    report('rail-states', states);
  }

  // Leave the page as it was.
  main.style.flex = '';
  main.style.width = '';
  applyTextSize(root, 1);
  await frames();

  // The window zoom is the app's: it needs the app, which sets WebKit's zoom.
  const windowChecks = [
    ['positions-map-at-every-zoom', () => positionsMap({ editor, scroller, zoom })],
    ['caret-keeps-its-place', () => caretKeepsItsPlace({ editor, zoom })],
    ['frame-stays-on-the-buttons-line', () => frameStaysOnTheLine({ editor, zoom })],
  ] as const;
  // The text size is the page's own, and needs no app: these run in a browser too.
  const textChecks = [
    ['text-keys-keep-the-caret', () => textKeysKeepTheCaret({ editor, textZoom })],
    ['pinch-keeps-its-line', () => pinchKeepsItsLine({ editor, scroller })],
    ['pinch-frame-time', () => pinchFrameTime({ editor, main })],
  ] as const;
  if (mode !== 'surfaces') {
    for (const [name, check] of windowChecks) {
      report(name, await check().catch((error: unknown) => [`threw ${String(error)}`]));
    }
  }
  if (mode !== 'surfaces') {
    for (const [name, check] of textChecks) {
      report(name, await check().catch((error: unknown) => [`threw ${String(error)}`]));
    }
    // Leave the page as it was.
    main.style.flex = '';
    main.style.width = '';
    await frames();
  }
  if (mode !== 'quick') {
    report(
      'surfaces-fit',
      await surfacesFit({ editor, scroller, zoom, surfaces }).catch((error: unknown) => [
        `threw ${String(error)}`,
      ]),
    );
  }
  await zoom?.ask(1);
  console.warn(`ZOOM-CHECK done ${passed} passed, ${failed} failed`);
}

const NOT_IN_THE_APP = ['there is no app zoom: run this in `pnpm tauri dev`'];

/** Waits for the `--rl-zoom` of the page to be `level`, then settles. False if it never is. */
async function landed(level: number): Promise<boolean> {
  const root = document.documentElement;
  const until = performance.now() + 5000;
  while (root.style.getPropertyValue('--rl-zoom') !== String(level)) {
    if (performance.now() > until) return false;
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
  await frames(3);
  return true;
}

/** Asks the app for `level` and waits for the page to be at it. */
async function zoomTo(zoom: PageZoom, level: number): Promise<boolean> {
  await zoom.ask(level);
  return landed(level);
}

/** The paragraph whose fifth row holds the caret, in the middle of `LONG`. */
const WRAPPED = 'A long paragraph to keep, with the caret deep in it. '.repeat(30).trim();

/** A document of many short paragraphs, and, in the middle, one long wrapped paragraph. */
const LONG = [
  ...Array.from(
    { length: 80 },
    (_, i) =>
      `Paragraph ${i + 1} runs on for a while, so that it wraps differently at every zoom and the ` +
      'check has something to rewrap.\n',
  ),
  `${WRAPPED}\n`,
  ...Array.from(
    { length: 80 },
    (_, i) => `Afterword ${i + 1} is here to give the page its length.\n`,
  ),
].join('\n');

/** 1. At every zoom, CodeMirror's positions and coordinates map onto each other. */
async function positionsMap({
  editor,
  scroller,
  zoom,
}: Pick<ZoomCheckContext, 'editor' | 'scroller' | 'zoom'>): Promise<unknown[]> {
  if (!zoom) return NOT_IN_THE_APP;
  const failures: unknown[] = [];
  editor.setDoc(sample);
  editor.setViewMode('raw');
  for (const level of [0.8, 1, 1.5, 2]) {
    if (!(await zoomTo(zoom, level))) return [...failures, { level, landed: false }];
    const rect = scroller.getBoundingClientRect();
    const { view } = editor;
    const sampled: number[] = [];
    // Positions on screen, every third one from the top line down.
    const top = view.lineBlockAtHeight(rect.top - view.documentTop).from;
    for (let at = top; at < view.state.doc.length && sampled.length < 50; at += 3) {
      const coords = view.coordsAtPos(at);
      if (coords && coords.top > rect.bottom) break;
      if (coords && coords.top >= rect.top && coords.bottom <= rect.bottom) sampled.push(at);
    }
    if (sampled.length < 50) failures.push({ level, onlyOnScreen: sampled.length });
    for (const pos of sampled) {
      const coords = view.coordsAtPos(pos);
      if (!coords) continue;
      const back = view.posAtCoords({
        x: (coords.left + coords.right) / 2,
        y: (coords.top + coords.bottom) / 2,
      });
      if (back !== pos) failures.push({ level, pos, back });
    }
  }
  await zoomTo(zoom, 1);
  return failures;
}

/**
 * Puts the caret in the fifth row of `WRAPPED` in `LONG`, level with the middle of the screen.
 * Fails, saying why, if the paragraph does not wrap to five rows.
 */
async function caretInFifthRow(
  editor: Editor,
): Promise<{ pos: number } | { why: string; rowHeight: number }> {
  const { view } = editor;
  const start = LONG.indexOf(WRAPPED);
  // The paragraph's start in the middle of the screen, to find the fifth row of its text.
  view.dispatch({
    selection: { anchor: start },
    effects: EditorView.scrollIntoView(start, { y: 'center' }),
  });
  view.focus();
  await frames();
  const rowTop = (at: number) => view.coordsAtPos(at)?.top ?? NaN;
  const first = rowTop(start);
  let pos = start;
  let rowHeight = 0;
  while (pos < start + WRAPPED.length) {
    pos += 4;
    const down = rowTop(pos) - first;
    if (rowHeight === 0 && down > 1) rowHeight = down;
    if (rowHeight > 0 && down >= 4 * rowHeight - 1) break;
  }
  if (rowHeight === 0 || rowTop(pos) - first < 4 * rowHeight - 1) {
    return { why: 'the paragraph does not wrap to five rows', rowHeight };
  }
  // The caret in the fifth row, level with the middle of the screen.
  view.dispatch({
    selection: { anchor: pos },
    effects: EditorView.scrollIntoView(pos, { y: 'center' }),
  });
  await frames();
  return { pos };
}

/** 4. A caret's line keeps its place, in points, across the zoom (and back). */
async function caretKeepsItsPlace({
  editor,
  zoom,
}: Pick<ZoomCheckContext, 'editor' | 'zoom'>): Promise<unknown[]> {
  if (!zoom) return NOT_IN_THE_APP;
  await zoomTo(zoom, 1);
  editor.setDoc(LONG);
  editor.setViewMode('clean');
  await frames();
  const { view } = editor;
  const placed = await caretInFifthRow(editor);
  if ('why' in placed) return [placed];
  const { pos } = placed;
  const top = (level: number) => (view.coordsAtPos(pos)?.top ?? NaN) * level;
  const was = top(1);
  const failures: unknown[] = [];
  for (const level of [1.25, 1, 0.9, 1]) {
    if (!(await zoomTo(zoom, level))) return [...failures, { level, landed: false }];
    const now = top(level);
    if (!(Math.abs(now - was) <= 2)) failures.push({ level, was, now });
  }
  return failures;
}

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/** A gesture event as WebKit sends it: a scale, and where the pointer is. */
function gestureEvent(type: string, scale: number, at: { x: number; y: number }): Event {
  const event = new Event(type, { cancelable: true });
  Object.defineProperties(event, {
    scale: { value: scale },
    clientX: { value: at.x },
    clientY: { value: at.y },
  });
  return event;
}

/**
 * A pinch out by 60% and back, a 1% step at a time, as the gesture events of a trackpad: the scales
 * 1.01 to 1.6 and 1.59 to 1.00. `between` is awaited after each, with the step's number and the
 * time just before its event was sent and the time its handlers were done.
 */
async function pinchThrough(
  at: { x: number; y: number },
  between: (step: number, sent: number, handled: number) => Promise<void>,
): Promise<void> {
  window.dispatchEvent(gestureEvent('gesturestart', 1, at));
  let step = 0;
  for (let i = 1; i <= 60; i++) {
    const sent = performance.now();
    window.dispatchEvent(gestureEvent('gesturechange', 1 + i / 100, at));
    await between(step++, sent, performance.now());
  }
  for (let i = 59; i >= 0; i--) {
    const sent = performance.now();
    window.dispatchEvent(gestureEvent('gesturechange', 1 + i / 100, at));
    await between(step++, sent, performance.now());
  }
  window.dispatchEvent(gestureEvent('gestureend', 1, at));
}

/** 5. The text keys (Larger, Smaller, Actual Text Size) keep the caret's line where it was. */
async function textKeysKeepTheCaret({
  editor,
  textZoom,
}: Pick<ZoomCheckContext, 'editor' | 'textZoom'>): Promise<unknown[]> {
  editor.setDoc(LONG);
  editor.setViewMode('clean');
  // The size the page is at, whatever the earlier checks left of it.
  textZoom.follow(1);
  await frames();
  const placed = await caretInFifthRow(editor);
  if ('why' in placed) return [placed];
  const { view } = editor;
  const top = () => view.coordsAtPos(placed.pos)?.top ?? NaN;
  const was = top();
  const failures: unknown[] = [];
  const steps = [
    ['step(1)', () => textZoom.step(1)],
    ['step(-1)', () => textZoom.step(-1)],
    ['step(1) again', () => textZoom.step(1)],
    ['reset()', () => textZoom.reset()],
  ] as const;
  for (const [name, run] of steps) {
    run();
    await frames();
    const now = top();
    if (!(Math.abs(now - was) <= 2)) failures.push({ name, was, now });
  }
  return failures;
}

/** 5. In every frame of a scripted pinch, the line under the pointer stays where it was. */
async function pinchKeepsItsLine({
  editor,
  scroller,
}: Pick<ZoomCheckContext, 'editor' | 'scroller'>): Promise<unknown[]> {
  editor.setDoc(LONG);
  editor.setViewMode('clean');
  await frames();
  const { view } = editor;
  // A paragraph in the middle of the document, level with the middle of the screen.
  const start = LONG.indexOf('Paragraph 40 ');
  view.dispatch({ effects: EditorView.scrollIntoView(start, { y: 'center' }) });
  await frames();
  const rect = scroller.getBoundingClientRect();
  const content = view.contentDOM.getBoundingClientRect();
  const at = { x: content.left + 100, y: (rect.top + rect.bottom) / 2 };
  const pos = view.posAtCoords(at);
  if (pos === null) return [{ why: 'no text under the pointer', at }];
  // The line's first row, as the person sees it (what a scroll target keeps, reading-place.ts).
  const from = view.lineBlockAt(pos).from;
  const lineTop = () => view.coordsAtPos(from)?.top ?? NaN;
  const was = lineTop();
  const failures: unknown[] = [];
  await pinchThrough(at, async (step) => {
    // CodeMirror's measure of this step runs in the next frame, before this callback.
    await nextFrame();
    const now = lineTop();
    if (!(Math.abs(now - was) <= 2)) {
      failures.push({
        step,
        was,
        now,
        scale: document.documentElement.style.getPropertyValue('--rl-text-scale'),
      });
    }
  });
  await frames();
  return failures;
}

/** 5. A pinch step's work is at most 8 ms at the 90th percentile, with the rail showing, and holds it. */
async function pinchFrameTime({
  editor,
  main,
}: {
  editor: Editor;
  main: HTMLElement;
}): Promise<unknown[]> {
  const failures: unknown[] = [];
  const { view } = editor;
  const documents = [
    ['welcome', sample],
    ['long', longDocument().doc],
  ] as const;
  for (const [name, doc] of documents) {
    editor.setDoc(doc);
    editor.setViewMode('redlines');
    // Wide enough for the rail beside the text at every size of the pinch.
    main.style.flex = 'none';
    main.style.width = '2200px';
    view.scrollDOM.scrollTop = 0;
    await frames();
    const rail = () => view.dom.classList.contains('rl-has-rail');
    const hadRail = rail();
    const at = {
      x: view.contentDOM.getBoundingClientRect().left + 100,
      y: view.scrollDOM.getBoundingClientRect().top + 200,
    };
    const times: number[] = [];
    let railChanged = false;
    await pinchThrough(at, async (_step, sent, handled) => {
      // The work of the step: the handlers, then CodeMirror's measure in the next frame, from the
      // frame's start to the end of a write queued after the event (the wait for the frame is not
      // work, and a real pinch's events come at any time in a frame).
      let end = NaN;
      view.requestMeasure({
        read: () => null,
        write: () => {
          end = performance.now();
        },
      });
      const frameStart = await new Promise<number>((resolve) => requestAnimationFrame(resolve));
      times.push(handled - sent + Math.max(0, end - frameStart));
      if (rail() !== hadRail) railChanged = true;
    });
    await frames();
    times.sort((a, b) => a - b);
    const p90 = times[Math.floor(times.length * 0.9)] ?? NaN;
    if (!(p90 <= 8)) failures.push({ doc: name, p90, max: times[times.length - 1] });
    if (!hadRail) failures.push({ doc: name, why: 'the rail was not showing' });
    if (railChanged) failures.push({ doc: name, why: 'the rail changed during the pinch' });
  }
  return failures;
}

/** 7. In every frame of a zoom change, the title bar's controls stay on the window buttons' line. */
async function frameStaysOnTheLine({
  editor,
  zoom,
}: Pick<ZoomCheckContext, 'editor' | 'zoom'>): Promise<unknown[]> {
  if (!zoom) return NOT_IN_THE_APP;
  editor.setViewMode('clean');
  await zoomTo(zoom, 1);
  const files = document.querySelector<HTMLElement>('.rl-files-button');
  if (!files) return ['no Files control'];
  // A point is a CSS px times the device pixel ratio over its value at 100%.
  const dpr100 = window.devicePixelRatio;
  const middle = () => {
    const rect = files.getBoundingClientRect();
    return ((rect.top + rect.bottom) / 2) * (window.devicePixelRatio / dpr100);
  };
  const failures: unknown[] = [];
  let sampling = true;
  let frame = 0;
  const sample = () => {
    if (!sampling) return;
    const at = middle();
    if (!(Math.abs(at - 26) <= 1)) {
      failures.push({
        frame,
        middle: at,
        zoom: document.documentElement.style.getPropertyValue('--rl-zoom'),
      });
    }
    frame++;
    requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
  // Up, to the top, down to the bottom, and home: each change sampled until three frames after it
  // lands (`landed` waits three more).
  for (const level of [1.25, 2, 0.8, 1]) {
    if (!(await zoomTo(zoom, level))) failures.push({ level, landed: false });
  }
  sampling = false;
  return failures;
}

/** What `surfaces-fit` needs the window to be: 720 × 480 pt at 200% is 360 × 240 CSS px. */
const SMALLEST_PAGE = 360;

/** 8. At 360 CSS px wide, every surface is inside the window, and keeps 16 px from its sides. */
async function surfacesFit({
  editor,
  scroller,
  zoom,
  surfaces,
}: Pick<ZoomCheckContext, 'editor' | 'scroller' | 'zoom' | 'surfaces'>): Promise<unknown[]> {
  if (!zoom) return NOT_IN_THE_APP;
  editor.setDoc(sample);
  editor.setViewMode('redlines');
  if (!(await zoomTo(zoom, 2))) return [{ level: 2, landed: false }];
  // The window is dragged to its smallest by hand: the page is then 360 px wide.
  for (let waited = 0; window.innerWidth !== SMALLEST_PAGE; waited += 500) {
    if (waited >= 120_000) {
      return [{ innerWidth: window.innerWidth, wanted: SMALLEST_PAGE, why: 'window not smallest' }];
    }
    if (waited % 5000 === 0) {
      console.warn(
        `ZOOM-CHECK surfaces-fit waiting: drag the window to its smallest ` +
          `(the page is ${window.innerWidth} px wide, ${SMALLEST_PAGE} wanted)`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const failures: unknown[] = [];
  const width = window.innerWidth;
  const height = window.innerHeight;
  /**
   * `element` is inside the window; where it keeps a margin (the bars and notifications place
   * themselves 16 px from its sides), `margin` px from them; where it is placed by something that
   * only keeps it inside (a card, a note, the find bar), no wider than the window less 32 px.
   */
  const fits = (
    name: string,
    element: Element | null,
    rule: { margin?: number; narrow?: true } = {},
  ) => {
    if (!element) return failures.push({ name, found: false });
    const rect = element.getBoundingClientRect();
    const margin = rule.margin ?? 0;
    // A hidden or collapsed surface is not "inside the window": it is not there.
    if (rect.width === 0 || rect.height === 0) {
      return failures.push({ name, zeroSize: true, width: rect.width, height: rect.height });
    }
    if (
      rect.left < margin - 0.5 ||
      rect.right > width - margin + 0.5 ||
      rect.top < 0 ||
      rect.bottom > height + 0.5 ||
      (rule.narrow && rect.width > width - 32 + 0.5)
    ) {
      failures.push({
        name,
        rule,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        width,
        height,
      });
    }
  };
  const settle = () => frames(3);
  const clickOn = (target: Element) => {
    for (const type of ['mousedown', 'mouseup', 'click']) {
      target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0 }));
    }
  };

  // The title bar: Files, the name and the two menus' buttons.
  for (const control of document.querySelectorAll('.rl-titlebar button, .rl-title')) {
    fits(`titlebar ${control.getAttribute('aria-label') ?? control.className}`, control);
  }
  // The open View menu.
  const view = document.querySelector<HTMLElement>('.rl-titlebar button[aria-label="View"]');
  view?.click();
  await settle();
  fits('view menu', document.querySelector('.rl-menu-anchor:not([hidden]) .rl-menu'));
  view?.click();
  // The review bar.
  surfaces.review.openBar();
  await settle();
  fits('review bar', document.querySelector('.rl-review-bar'), { margin: 16 });
  surfaces.review.closeBar();
  // The sidebar, open and covering the page: the page keeps its whole width under it.
  surfaces.setSidebar(true);
  await settle();
  const sidebar = document.querySelector<HTMLElement>('.rl-sidebar');
  fits('sidebar', sidebar);
  const page = scroller.getBoundingClientRect();
  const covering = {
    open: document.querySelector<HTMLElement>('.rl-app')?.dataset['sidebar'] === 'open',
    position: sidebar ? getComputedStyle(sidebar).position : null,
    sidebarWidth: sidebar?.getBoundingClientRect().width ?? 0,
    pageWidth: page.width,
  };
  if (
    !covering.open ||
    covering.position !== 'absolute' ||
    covering.sidebarWidth < 200 ||
    covering.pageWidth < width - 1
  ) {
    failures.push({ name: 'sidebar covers the page', ...covering, width });
  }
  surfaces.setSidebar(false);
  // A pinned card, and a note shown from its dot.
  await frames();
  const inserted = editor.view.contentDOM.querySelector('.rl-ins');
  if (inserted) {
    clickOn(inserted);
    await settle();
    fits('pinned card', editor.view.dom.querySelector('.rl-card'), { narrow: true });
  } else failures.push({ name: 'pinned card', found: false, why: 'no insertion to click' });
  const dot = editor.view.dom.querySelector<HTMLElement>('.rl-note-dot');
  if (dot) {
    dot.click();
    await settle();
    fits('note from its dot', editor.view.dom.querySelector('.rl-note-open'), { narrow: true });
  } else failures.push({ name: 'note from its dot', found: false, why: 'no dot at this width' });
  // The find bar.
  editor.commands.run('find.open');
  await settle();
  fits('find bar', document.querySelector('.rl-find-bar'), { narrow: true });
  scroller.focus();
  // A notice and a notification.
  surfaces.notice.flash('Text size 137%');
  await settle();
  fits('notice', document.querySelector('.rl-notice:not([hidden])'), { margin: 16 });
  const note = surfaces.notifications.show({
    text: 'A notification, as wide as the window allows.',
    dismissLabel: 'Later',
    key: 'zoom-check',
  });
  await settle();
  fits('notification', note.element, { margin: 16 });
  note.close();
  return failures;
}
