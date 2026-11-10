// Debug only: checks in WebKit what happy-dom can't, the column and the rail at every text size.
// Start the app with `VITE_ZOOM_CHECK=1` in the environment of `pnpm tauri dev` (it reads nothing
// in a release build). It opens the welcome document, sets the editor's width by giving `.rl-main`
// an inline width, and reports each check as one console line: `ZOOM-CHECK <name> pass` or
// `ZOOM-CHECK <name> FAIL <json>`, then `ZOOM-CHECK done <passed> passed, <failed> failed`. The
// console is what `vite` prints, as for print-check.ts.

import type { Editor } from '@redlines/editor';
import sample from './sample.md?raw';
import { applyTextSize } from './text-size.ts';

export interface ZoomCheckContext {
  editor: Editor;
  scroller: HTMLElement;
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

export async function runZoomCheck({ editor, scroller }: ZoomCheckContext): Promise<void> {
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
    if (Math.abs(width - COLUMN * size) > 1) column.push({ size, width, expected: COLUMN * size });
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

  // Leave the page as it was.
  main.style.flex = '';
  main.style.width = '';
  applyTextSize(root, 1);
  console.warn(`ZOOM-CHECK done ${passed} passed, ${failed} failed`);
}
