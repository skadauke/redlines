// Debug only: checks deleted and replaced blocks in WebKit, where happy-dom can't, because they need
// a real layout and WebKit's own hit-testing and caret: a paragraph and a list item deleted whole
// are blocks of their own where they were (between their neighbors, with no blank line, struck, with
// a bar of their own), a heading, a paragraph and a table cell rewritten whole have the old text
// above the new, the caret and the arrow keys step over all of them, a click on a struck block's bar
// switches to Simple and the block below keeps the place, and hover and click open the right card,
// clear of the text. Each is checked in Redlines and in Simple, which draws none of the old text.
// Serve the page with `VITE_STRUCK_CHECK=1 pnpm dev` (or `pnpm tauri dev`, for WKWebView) and open
// it in WebKit: it reads nothing in a release build.
//
// Each check loads its document and does what a person does, and reports one console line,
// `STRUCK-CHECK <name> pass` or `STRUCK-CHECK <name> FAIL <json>`, then
// `STRUCK-CHECK done <passed> passed, <failed> failed`. A check fails unless the behavior really
// happened: where it found nothing to measure, it says so and fails.

import { EditorSelection } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { Editor } from '@redlines/editor';
import sample from './sample.md?raw';

const filler = (from: number, count: number) =>
  Array.from(
    { length: count },
    (_, i) => `Filler paragraph ${from + i}, which says nothing and only takes room on the page.`,
  ).join('\n\n');

const OLD_PARAGRAPH =
  'The old paragraph says that the importer reads every file in the folder and writes one record per file.';
const NEW_PARAGRAPH = 'The new paragraph says that records are produced by a nightly batch job.';
const OLD_CELL = 'the old cell text, which is long enough to wrap in its column';

const DOC = `# Struck blocks

${filler(1, 8)}

Before the deleted paragraph.

<!--del b2b2 This paragraph was deleted whole.\\n\\n-->

After the deleted paragraph.

${filler(9, 3)}

- Item one
- <!--del c3c3 Item two, deleted\\n- -->
  Item three
- Item four

${filler(12, 3)}

## <!--sub d4d4 Old heading text-->New heading text<!--/d4d4-->

Between the heading and the paragraph.

<!--sub f5f5 ${OLD_PARAGRAPH}-->

${NEW_PARAGRAPH}<!--/f5f5-->

Below the rewritten paragraph.

| Item | Note |
| ---- | ---- |
| One | plain |
| Two | <!--sub g6g6 ${OLD_CELL}-->the new text<!--/g6g6--> |
| Three | plain |

Between the table and the twins.

<!--del h7h7 Twin words.\\n\\n-->

Between the twins.

<!--del j8j8 Twin words.\\n\\n-->

Last paragraph.

${filler(15, 8)}

<!-- redlines
version: 1
people:
  ada: {name: Ada Lovelace}
  bo: {name: Bo Chen}
  claude-ada: {name: Claude, agent: true, for: ada}
marks:
  b2b2: {by: bo, at: 2026-10-31T09:30Z}
  c3c3: {by: ada, at: 2026-10-31T09:31Z}
  d4d4: {by: claude-ada, at: 2026-10-31T09:32Z}
  f5f5: {by: claude-ada, at: 2026-10-31T09:33Z}
  g6g6: {by: claude-ada, at: 2026-10-31T09:34Z}
  h7h7: {by: ada, at: 2026-10-31T09:35Z}
  j8j8: {by: bo, at: 2026-10-31T09:36Z}
-->
`;

type View = 'redlines' | 'simple';
type Problem = Record<string, unknown>;
type Result = Problem | null;

/** A frame, and a little after it: the measures and the effects that follow an update. */
const frames = async () => {
  await Promise.race([
    new Promise((resolve) => requestAnimationFrame(resolve)),
    new Promise((resolve) => setTimeout(resolve, 120)),
  ]);
  await new Promise((resolve) => setTimeout(resolve, 40));
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Presses a key as a keyboard does, through CodeMirror's own key handling. */
function press(editor: Editor, name: string): boolean {
  const event = new KeyboardEvent('keydown', {
    key: name,
    code: name,
    bubbles: true,
    cancelable: true,
  });
  editor.view.contentDOM.dispatchEvent(event);
  return event.defaultPrevented;
}

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

/** A press of the primary button at a point, as the pointer makes it: down, and up. */
function pressAt(editor: Editor, x: number, y: number): void {
  const target = document.elementFromPoint(x, y) ?? editor.view.contentDOM;
  target.dispatchEvent(mouse('mousedown', x, y, { buttons: 1 }));
  document.dispatchEvent(mouse('mouseup', x, y));
}

/** A press on a change bar, as the bar's own handler takes it. */
function pressBar(editor: Editor, x: number, y: number): boolean {
  const down = mouse('mousedown', x, y);
  editor.view.scrollDOM.dispatchEvent(down);
  document.dispatchEvent(mouse('mouseup', x, y));
  return down.defaultPrevented;
}

/**
 * Loads the document in a view and scrolls to `needle`, so that the lines around it are drawn: the
 * editor draws only what is near the window. The page scrolls in an element around the editor, so
 * the text is scrolled to as the page's own scrolling would.
 */
async function open(editor: Editor, view: View, needle: string): Promise<void> {
  editor.setTracking(false, { inFile: false });
  editor.reloadDoc(DOC);
  editor.setViewMode(view);
  editor.view.focus();
  const pos = DOC.indexOf(needle);
  editor.view.dispatch({
    selection: EditorSelection.cursor(pos),
    effects: EditorView.scrollIntoView(pos, { y: 'center' }),
  });
  await frames();
  const line = lines(editor).find((found) => found.textContent?.includes(needle));
  line?.scrollIntoView({ block: 'center' });
  await frames();
}

const head = (editor: Editor) => editor.view.state.selection.main.head;

/** The pointer leaves the editor: a card that was only hovering goes away. */
function away(editor: Editor): void {
  document.body.dispatchEvent(mouse('mousemove', 4, 4));
  editor.view.dom.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false }));
}

async function place(editor: Editor, pos: number): Promise<void> {
  editor.view.dispatch({ selection: EditorSelection.cursor(pos), scrollIntoView: true });
  await frames();
}

/** Where `needle` starts in the document, plus `offset`. */
function at(editor: Editor, needle: string, offset = 0): number {
  const found = editor.getDoc().indexOf(needle);
  if (found < 0) throw new Error(`the document has no ${needle}`);
  return found + offset;
}

/** The end of the line of the document that holds `needle`. */
const endOf = (editor: Editor, needle: string) =>
  editor.view.state.doc.lineAt(at(editor, needle)).to;

async function reveal(el: Element): Promise<DOMRect> {
  el.scrollIntoView({ block: 'center', inline: 'nearest' });
  await frames();
  return el.getBoundingClientRect();
}

const lines = (editor: Editor) => [
  ...editor.view.contentDOM.querySelectorAll<HTMLElement>('.cm-line'),
];

/** The line of the page that shows `text`. */
const lineWith = (editor: Editor, text: string) =>
  lines(editor).find((line) => line.textContent?.includes(text)) ?? null;

/** The struck block that shows `text`. */
const blockWith = (editor: Editor, text: string) =>
  [...editor.view.contentDOM.querySelectorAll<HTMLElement>('.rl-struck')].find((block) =>
    block.textContent?.includes(text),
  ) ?? null;

const px = (value: string) => Number.parseFloat(value) || 0;

/** Where the text `needle` starts on the screen, in the element. */
function textLeft(el: Element, needle: string): number | null {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const index = node.textContent?.indexOf(needle) ?? -1;
    if (index >= 0) {
      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + 1);
      return range.getBoundingClientRect().left;
    }
  }
  return null;
}

/** The last box of an element's text, which is where it ends. */
const lastBox = (el: Element) => [...el.getClientRects()].at(-1) ?? el.getBoundingClientRect();
const firstBox = (el: Element) => [...el.getClientRects()][0] ?? el.getBoundingClientRect();

/** The bar of an element: drawn before it, in the margin, as wide as a bar is. */
function barOf(el: Element): { width: string; content: string } {
  const style = getComputedStyle(el, '::before');
  return { width: style.width, content: style.content };
}

const same = (a: number, b: number, within = 1.5) => Math.abs(a - b) <= within;

interface Check {
  name: string;
  run: (editor: Editor) => Promise<Result>;
}

const problemsOf = (problems: Problem): Result => (Object.keys(problems).length ? problems : null);

// -- Drawing --------------------------------------------------------------------------------------

const drawing: Check[] = [
  {
    name: 'deleted-paragraph-is-a-block-between-its-neighbors-in-redlines',
    async run(editor) {
      await open(editor, 'redlines', 'After the deleted paragraph.');
      const block = blockWith(editor, 'This paragraph was deleted whole.');
      const above = lineWith(editor, 'Before the deleted paragraph.');
      const below = lineWith(editor, 'After the deleted paragraph.');
      if (!block || !above || !below) return { note: 'nothing drawn', block: !!block };
      await reveal(block);
      const [b, a, c] = [block, above, below].map((el) => el.getBoundingClientRect()) as [
        DOMRect,
        DOMRect,
        DOMRect,
      ];
      const problems: Problem = {};
      // Abutting, with no blank line between: the space is the block's own padding.
      if (!same(b.top, a.bottom)) problems['gapAbove'] = b.top - a.bottom;
      if (!same(c.top, b.bottom)) problems['gapBelow'] = c.top - b.bottom;
      if (!same(b.left, a.left)) problems['left'] = [b.left, a.left];
      // The space around it is a block's own: the same as the next block's.
      const [padBlock, padBelow] = [block, below].map((el) => px(getComputedStyle(el).paddingTop));
      if (!same(padBlock!, padBelow!)) problems['padding'] = [padBlock, padBelow];
      const struck = block.querySelector('.rl-del');
      if (!struck || !getComputedStyle(struck).textDecorationLine.includes('line-through')) {
        problems['struck'] = struck ? getComputedStyle(struck).textDecorationLine : null;
      }
      const bar = barOf(block);
      if (bar.content === 'none' || bar.width !== '2px') problems['bar'] = bar;
      if (!block.classList.contains('rl-author-3') && !block.classList.contains('rl-bar')) {
        problems['barClasses'] = block.className;
      }
      // Its text is nowhere in the lines around it, and they carry no bar of the deletion.
      if (below.textContent !== 'After the deleted paragraph.') {
        problems['belowText'] = below.textContent;
      }
      if (below.classList.contains('rl-bar') || above.classList.contains('rl-bar')) {
        problems['neighborsBar'] = true;
      }
      return problemsOf(problems);
    },
  },
  {
    name: 'deleted-paragraph-is-not-drawn-in-simple-and-the-bar-is-on-the-block-below',
    async run(editor) {
      await open(editor, 'simple', 'After the deleted paragraph.');
      const above = lineWith(editor, 'Before the deleted paragraph.');
      const below = lineWith(editor, 'After the deleted paragraph.');
      if (!above || !below) return { note: 'nothing drawn' };
      const problems: Problem = {};
      if (editor.view.contentDOM.querySelector('.rl-struck, .rl-del')) problems['drawn'] = true;
      if (!below.classList.contains('rl-bar')) problems['bar'] = below.className;
      if (!same(below.getBoundingClientRect().top, above.getBoundingClientRect().bottom)) {
        problems['gap'] = below.getBoundingClientRect().top - above.getBoundingClientRect().bottom;
      }
      return problemsOf(problems);
    },
  },
  {
    name: 'deleted-item-is-an-item-between-its-neighbors-in-redlines',
    async run(editor) {
      await open(editor, 'redlines', 'Item three');
      const block = blockWith(editor, 'Item two, deleted');
      const one = lineWith(editor, 'Item one');
      const three = lineWith(editor, 'Item three');
      if (!block || !one || !three) return { note: 'nothing drawn', block: !!block };
      await reveal(block);
      const [b, o, t] = [block, one, three].map((el) => el.getBoundingClientRect()) as [
        DOMRect,
        DOMRect,
        DOMRect,
      ];
      const problems: Problem = {};
      if (!(o.bottom - 1.5 <= b.top && b.bottom <= t.top + 1.5)) {
        problems['order'] = { one: o.bottom, block: [b.top, b.bottom], three: t.top };
      }
      if (!same(b.top, o.bottom) || !same(t.top, b.bottom)) {
        problems['gaps'] = [b.top - o.bottom, t.top - b.bottom];
      }
      // Its bullet stands where the other items' bullets do, and its text where theirs starts.
      const bullet = block.querySelector('.rl-list-mark');
      const others = one.querySelector('.rl-list-mark') ?? three.querySelector('.rl-list-mark');
      if (!bullet || bullet.textContent !== '•') problems['bullet'] = bullet?.textContent ?? null;
      if (
        bullet &&
        others &&
        !same(bullet.getBoundingClientRect().left, others.getBoundingClientRect().left)
      ) {
        problems['bulletLeft'] = [
          bullet.getBoundingClientRect().left,
          others.getBoundingClientRect().left,
        ];
      }
      const text = block.querySelector('.rl-del');
      const start = textLeft(three, 'Item three');
      if (!text || start === null || !same(text.getBoundingClientRect().left, start, 2)) {
        problems['textLeft'] = [text?.getBoundingClientRect().left ?? null, start];
      }
      if (!text || !getComputedStyle(text).textDecorationLine.includes('line-through')) {
        problems['struck'] = true;
      }
      if (barOf(block).width !== '2px') problems['bar'] = barOf(block);
      if (three.textContent?.includes('Item two')) problems['threeText'] = three.textContent;
      return problemsOf(problems);
    },
  },
  {
    name: 'deleted-item-is-not-drawn-in-simple-and-the-bar-is-on-the-item-below',
    async run(editor) {
      await open(editor, 'simple', 'Item three');
      const one = lineWith(editor, 'Item one');
      const three = lineWith(editor, 'Item three');
      if (!one || !three) return { note: 'nothing drawn' };
      const problems: Problem = {};
      if (editor.view.contentDOM.querySelector('.rl-struck, .rl-del')) problems['drawn'] = true;
      if (!three.classList.contains('rl-bar')) problems['bar'] = three.className;
      if (!same(three.getBoundingClientRect().top, one.getBoundingClientRect().bottom)) {
        problems['gap'] = three.getBoundingClientRect().top - one.getBoundingClientRect().bottom;
      }
      return problemsOf(problems);
    },
  },
  {
    name: 'two-blocks-with-the-same-words-are-two-blocks',
    async run(editor) {
      await open(editor, 'redlines', 'Between the twins.');
      const twins = [...editor.view.contentDOM.querySelectorAll<HTMLElement>('.rl-struck')].filter(
        (block) => block.textContent === 'Twin words.',
      );
      if (twins.length !== 2) return { twins: twins.length };
      const marks = twins.map((block) => block.dataset['mark']);
      const colors = twins.map((block) => [...block.classList].find((c) => /^rl-author-/.test(c)));
      return marks.join() === 'h7h7,j8j8' && colors[0] !== colors[1] ? null : { marks, colors };
    },
  },
];

/** A block rewritten whole, in Redlines: the old text above the new. */
function rewritten(
  name: string,
  needle: string,
  where: (editor: Editor) => HTMLElement | null,
  old: string,
  next: string,
  extra?: (el: HTMLElement) => Problem,
): Check[] {
  return [
    {
      name: `${name}-has-the-old-text-above-the-new-in-redlines`,
      async run(editor) {
        await open(editor, 'redlines', needle);
        const el = where(editor);
        if (!el) return { note: 'nothing drawn' };
        await reveal(el);
        const del = [...el.querySelectorAll<HTMLElement>('.rl-del')].find(
          (found) => found.textContent === old,
        );
        const ins = [...el.querySelectorAll<HTMLElement>('.rl-ins')].find(
          (found) => found.textContent?.endsWith(next) || found.textContent === next,
        );
        if (!del || !ins) return { note: 'old or new text not drawn', del: !!del, ins: !!ins };
        const problems: Problem = {};
        if (!del.querySelector('br')) problems['br'] = false;
        // Above: the old text ends before the new starts, both in the same element.
        if (!(lastBox(del).bottom <= firstBox(ins).top + 1)) {
          problems['order'] = { oldBottom: lastBox(del).bottom, newTop: firstBox(ins).top };
        }
        if (!same(firstBox(ins).left, firstBox(del).left, 3)) {
          problems['left'] = [firstBox(del).left, firstBox(ins).left];
        }
        if (!getComputedStyle(del).textDecorationLine.includes('line-through')) {
          problems['struck'] = true;
        }
        if (!getComputedStyle(ins).textDecorationLine.includes('underline')) {
          problems['underlined'] = true;
        }
        const size = [del, ins].map((found) => getComputedStyle(found).fontSize);
        if (size[0] !== size[1]) problems['sizes'] = size;
        return problemsOf({ ...problems, ...extra?.(el) });
      },
    },
    {
      name: `${name}-shows-only-the-new-text-in-simple`,
      async run(editor) {
        await open(editor, 'simple', needle);
        const el = where(editor);
        if (!el) return { note: 'nothing drawn' };
        const problems: Problem = {};
        if (el.querySelector('.rl-del, br')) problems['old'] = true;
        if (!el.textContent?.includes(next)) problems['text'] = el.textContent;
        if (el.textContent?.includes(old.slice(0, 12))) problems['oldText'] = el.textContent;
        const row = el.closest('.rl-trow') ?? el;
        if (!row.classList.contains('rl-bar')) problems['bar'] = row.className;
        return problemsOf(problems);
      },
    },
  ];
}

const rewrites: Check[] = [
  ...rewritten(
    'heading',
    'New heading text',
    (editor) => lineWith(editor, 'New heading text'),
    'Old heading text',
    'New heading text',
    (line) => {
      // At the heading's size, in the heading's one line element.
      const body = px(getComputedStyle(document.body).fontSize);
      return px(getComputedStyle(line).fontSize) > body ? {} : { size: 'not a heading' };
    },
  ),
  ...rewritten(
    'paragraph',
    NEW_PARAGRAPH,
    (editor) => lineWith(editor, NEW_PARAGRAPH),
    OLD_PARAGRAPH,
    NEW_PARAGRAPH,
  ),
  ...rewritten(
    'table-cell',
    'the new text',
    (editor) =>
      [...editor.view.contentDOM.querySelectorAll<HTMLElement>('.rl-tc')].find((cell) =>
        cell.textContent?.includes('the new text'),
      ) ?? null,
    OLD_CELL,
    'the new text',
    (cell) => {
      const problems: Problem = {};
      const rows = [...cell.closest('.rl-tbl')!.querySelectorAll<HTMLElement>('.rl-trow')];
      const row = cell.closest<HTMLElement>('.rl-trow')!;
      const plain = rows.find((other) => other.textContent === 'Threeplain');
      // Not a second row, and the row grew.
      if (rows.length !== 4) problems['rows'] = rows.length;
      if (
        !plain ||
        row.getBoundingClientRect().height < plain.getBoundingClientRect().height * 1.5
      ) {
        problems['height'] = [
          row.getBoundingClientRect().height,
          plain?.getBoundingClientRect().height,
        ];
      }
      if (!row.classList.contains('rl-bar')) problems['bar'] = row.className;
      if (row.querySelector('.rl-tc')?.textContent !== 'Two') problems['firstCell'] = true;
      return problems;
    },
  ),
];

// -- The caret and the keys ------------------------------------------------------------------------

/** The positions the caret rests at, one key press after the other. */
async function walk(editor: Editor, from: number, key: string, steps: number): Promise<number[]> {
  await place(editor, from);
  const seen = [head(editor)];
  for (let i = 0; i < steps; i++) {
    press(editor, key);
    await frames();
    seen.push(head(editor));
  }
  return seen;
}

/** Caret checks over a block deleted whole, in a view. */
function overDeleted(
  name: string,
  view: View,
  above: string,
  below: string,
  marker: string,
  click: string | null,
): Check {
  return {
    name: `caret-steps-over-the-${name}-in-${view}`,
    async run(editor) {
      await open(editor, view, above);
      const problems: Problem = {};
      const aboveEnd = endOf(editor, above);
      const belowStart = at(editor, below);
      const belowText = belowStart;
      const markerStart = at(editor, marker);
      const doc = editor.view.state.doc;
      // An item's bullet stands in front of the marker, on the line of the text below.
      const markerLine = doc.lineAt(markerStart);
      const shared = markerLine.text.slice(0, markerStart - markerLine.from).trim() !== '';
      const belowFrom = shared ? markerLine.from : belowStart;
      const aboveFrom = doc.lineAt(aboveEnd).from;
      /** Whether the caret is inside what is hidden between the two. */
      const inside = (pos: number) => pos > markerStart && pos < belowText;
      // → from the end of the text above, until it is in the text below: never inside the block.
      const right = await walk(editor, aboveEnd, 'ArrowRight', 3);
      if (right.some(inside) || right.at(-1)! <= belowStart) problems['right'] = right;
      // ← from the start of the text below: back to the end of the text above.
      // (An item's bullet is two stops of its own, behind which the caret reaches the text above.)
      const left = await walk(editor, belowStart + 1, 'ArrowLeft', 6);
      if (left.some(inside) || Math.min(...left) > aboveEnd) problems['left'] = left;
      // ↓ from the middle of the text above goes to the text below, past the block, and ↑ back.
      const down = await walk(editor, aboveEnd - 4, 'ArrowDown', 1);
      if (inside(down[1]!) || down[1]! < belowFrom || down[1]! > belowStart + below.length) {
        problems['down'] = { head: down[1], from: belowFrom };
      }
      const up = await walk(editor, belowStart + 4, 'ArrowUp', 1);
      if (inside(up[1]!) || up[1]! < aboveFrom || up[1]! > aboveEnd) {
        problems['up'] = { head: up[1], from: aboveFrom };
      }
      // A click on the block puts the caret beside it, never inside.
      if (click) {
        await place(editor, 0);
        const block = blockWith(editor, click);
        if (!block) problems['click'] = 'no block drawn';
        else {
          const rect = await reveal(block);
          pressAt(editor, rect.left + Math.min(40, rect.width / 2), rect.top + rect.height / 2);
          await frames();
          if (inside(head(editor))) problems['click'] = head(editor);
          if (head(editor) === 0) problems['clickMoved'] = false;
        }
      }
      return problemsOf(problems);
    },
  };
}

/** Caret checks over the old text of a block rewritten whole, in a view. */
function overRewritten(name: string, view: View, textAt: string, text: string): Check {
  return {
    name: `caret-steps-over-the-old-text-of-the-${name}-in-${view}`,
    async run(editor) {
      await open(editor, view, textAt);
      const problems: Problem = {};
      const start = at(editor, textAt);
      const doc = editor.getDoc();
      const mark = doc.lastIndexOf('<!--sub', start);
      // The marker, and the line break and blank line that carry it, up to the new text.
      const inside = (pos: number) => pos > mark && pos < start;
      // Through the first letters, back to the start, and one more back: never inside the marker.
      const right = await walk(editor, start, 'ArrowRight', 3);
      if (right.some(inside) || right.at(-1)! !== start + 3) problems['right'] = right;
      const left = await walk(editor, start + 3, 'ArrowLeft', 5);
      if (left.some(inside) || left.at(-1)! >= start) problems['left'] = left;
      // ↑ from the new text goes up and out of it, to the old text's line or the line above, and
      // ↓ from there comes back: no position inside the marker.
      const up = await walk(editor, start + Math.min(6, text.length - 1), 'ArrowUp', 2);
      if (up.some(inside)) problems['up'] = up;
      const down = await walk(editor, start, 'ArrowDown', 2);
      if (down.some(inside)) problems['down'] = down;
      return problemsOf(problems);
    },
  };
}

const carets: Check[] = [];
for (const view of ['redlines', 'simple'] as const) {
  carets.push(
    overDeleted(
      'deleted-paragraph',
      view,
      'Before the deleted paragraph.',
      'After the deleted paragraph.',
      '<!--del b2b2',
      view === 'redlines' ? 'This paragraph was deleted whole.' : null,
    ),
    overDeleted(
      'deleted-item',
      view,
      'Item one',
      'Item three',
      '<!--del c3c3',
      view === 'redlines' ? 'Item two, deleted' : null,
    ),
    overRewritten('rewritten-heading', view, 'New heading text', 'New heading text'),
    overRewritten('rewritten-paragraph', view, NEW_PARAGRAPH, NEW_PARAGRAPH),
    overRewritten('rewritten-table-cell', view, 'the new text', 'the new text'),
  );
}

// -- The bar and the cards -------------------------------------------------------------------------

const pointer: Check[] = [
  {
    name: 'click-on-a-struck-blocks-bar-switches-to-simple-and-the-block-below-keeps-the-place',
    async run(editor) {
      await open(editor, 'redlines', 'After the deleted paragraph.');
      const block = blockWith(editor, 'This paragraph was deleted whole.');
      if (!block) return { note: 'nothing drawn' };
      const rect = await reveal(block);
      const taken = pressBar(editor, rect.left - 23, rect.top + Math.min(10, rect.height / 2));
      await frames();
      const problems: Problem = {};
      if (!taken) problems['taken'] = false;
      if (editor.getUiState().view !== 'simple') problems['view'] = editor.getUiState().view;
      const below = lineWith(editor, 'After the deleted paragraph.');
      const drift = below ? below.getBoundingClientRect().top - rect.top : null;
      if (drift === null || Math.abs(drift) > 1) problems['drift'] = drift;
      if (editor.view.contentDOM.querySelector('.rl-struck')) problems['stillDrawn'] = true;
      // And the bar of the block below switches back.
      if (below) {
        const next = below.getBoundingClientRect();
        pressBar(editor, next.left - 23, next.top + 10);
        await frames();
        if (editor.getUiState().view !== 'redlines') problems['back'] = editor.getUiState().view;
        if (!blockWith(editor, 'This paragraph was deleted whole.')) problems['drawnAgain'] = false;
      }
      return problemsOf(problems);
    },
  },
  {
    name: 'click-on-a-struck-blocks-bar-moves-no-selection-or-focus',
    async run(editor) {
      await open(editor, 'redlines', 'After the deleted paragraph.');
      const block = blockWith(editor, 'This paragraph was deleted whole.');
      if (!block) return { note: 'nothing drawn' };
      const pos = endOf(editor, 'Before the deleted paragraph.');
      editor.view.dispatch({ selection: EditorSelection.range(pos - 6, pos) });
      editor.view.focus();
      const rect = await reveal(block);
      const before = editor.view.state.selection.main;
      const focused = editor.view.hasFocus;
      pressBar(editor, rect.left - 23, rect.top + 10);
      await frames();
      const after = editor.view.state.selection.main;
      return before.anchor === after.anchor &&
        before.head === after.head &&
        editor.view.hasFocus === focused
        ? null
        : {
            before: [before.anchor, before.head],
            after: [after.anchor, after.head],
            focused,
            now: editor.view.hasFocus,
          };
    },
  },
  {
    name: 'hover-on-a-struck-block-opens-its-card-clear-of-the-block',
    async run(editor) {
      await open(editor, 'redlines', 'After the deleted paragraph.');
      const block = blockWith(editor, 'This paragraph was deleted whole.');
      if (!block) return { note: 'nothing drawn' };
      const rect = await reveal(block);
      const text = block.querySelector('.rl-del')!.getBoundingClientRect();
      const x = text.left + Math.min(20, text.width / 2);
      const y = text.top + text.height / 2;
      (document.elementFromPoint(x, y) ?? block).dispatchEvent(mouse('mousemove', x, y));
      await wait(700);
      const card = document.querySelector<HTMLElement>('.rl-card');
      if (!card) return { note: 'no card opened' };
      const box = card.getBoundingClientRect();
      const problems: Problem = {};
      if (!card.textContent?.includes('Deleted') || !card.textContent.includes('This paragraph')) {
        problems['what'] = card.textContent;
      }
      if (!card.textContent?.includes('Bo Chen')) problems['who'] = card.textContent;
      // Above or below the block, covering neither it nor the paragraph after it.
      const below = lineWith(editor, 'After the deleted paragraph.')!.getBoundingClientRect();
      const clear = box.bottom <= rect.top + 1 || box.top >= below.bottom - 1;
      if (!clear)
        problems['covers'] = { card: [box.top, box.bottom], block: [rect.top, rect.bottom] };
      away(editor);
      await wait(500);
      if (document.querySelector('.rl-card')) problems['stays'] = true;
      return problemsOf(problems);
    },
  },
  {
    name: 'hover-on-two-blocks-with-the-same-words-opens-the-card-of-the-one-pointed-at',
    async run(editor) {
      await open(editor, 'redlines', 'Between the twins.');
      const twins = [...editor.view.contentDOM.querySelectorAll<HTMLElement>('.rl-struck')].filter(
        (block) => block.textContent === 'Twin words.',
      );
      if (twins.length !== 2) return { twins: twins.length };
      const problems: Problem = {};
      const expected = ['Ada Lovelace', 'Bo Chen'];
      for (const [i, block] of twins.entries()) {
        await reveal(block);
        const text = block.querySelector('.rl-del')!.getBoundingClientRect();
        const x = text.left + 6;
        const y = text.top + text.height / 2;
        away(editor);
        await wait(450);
        (document.elementFromPoint(x, y) ?? block).dispatchEvent(mouse('mousemove', x, y));
        await wait(700);
        const name = document.querySelector('.rl-card .rl-card-name')?.textContent ?? null;
        if (name !== expected[i]) problems[`block${i}`] = name;
      }
      away(editor);
      return problemsOf(problems);
    },
  },
  {
    name: 'click-on-a-struck-block-pins-its-card',
    async run(editor) {
      await open(editor, 'redlines', 'After the deleted paragraph.');
      const block = blockWith(editor, 'This paragraph was deleted whole.');
      if (!block) return { note: 'nothing drawn' };
      await reveal(block);
      const text = block.querySelector('.rl-del')!.getBoundingClientRect();
      pressAt(editor, text.left + 10, text.top + text.height / 2);
      await wait(300);
      const opened = !!document.querySelector('.rl-card');
      away(editor);
      await wait(800);
      const pinned = !!document.querySelector('.rl-card');
      press(editor, 'Escape');
      await wait(200);
      const gone = !document.querySelector('.rl-card');
      return opened && pinned && gone ? null : { opened, pinned, gone };
    },
  },
  {
    name: 'hover-on-the-old-text-of-a-rewritten-paragraph-opens-its-card-clear-of-both',
    async run(editor) {
      await open(editor, 'redlines', NEW_PARAGRAPH);
      const line = lineWith(editor, NEW_PARAGRAPH);
      const del = line?.querySelector<HTMLElement>('.rl-del');
      const ins = line?.querySelector<HTMLElement>('.rl-ins');
      if (!line || !del || !ins) return { note: 'nothing drawn' };
      await reveal(line);
      const old = firstBox(del);
      const x = old.left + 20;
      const y = old.top + old.height / 2;
      (document.elementFromPoint(x, y) ?? del).dispatchEvent(mouse('mousemove', x, y));
      await wait(700);
      const card = document.querySelector<HTMLElement>('.rl-card');
      if (!card) return { note: 'no card opened' };
      const box = card.getBoundingClientRect();
      const problems: Problem = {};
      if (!card.textContent?.includes('Replaced')) problems['what'] = card.textContent;
      const top = Math.min(firstBox(del).top, firstBox(ins).top);
      const bottom = Math.max(lastBox(del).bottom, lastBox(ins).bottom);
      if (!(box.bottom <= top + 1 || box.top >= bottom - 1)) {
        problems['covers'] = { card: [box.top, box.bottom], text: [top, bottom] };
      }
      away(editor);
      return problemsOf(problems);
    },
  },
  {
    name: 'card-below-a-rewritten-paragraph-at-the-top-of-the-window-covers-neither-text',
    async run(editor) {
      await open(editor, 'redlines', NEW_PARAGRAPH);
      const line = lineWith(editor, NEW_PARAGRAPH);
      const del = line?.querySelector<HTMLElement>('.rl-del');
      const ins = line?.querySelector<HTMLElement>('.rl-ins');
      if (!line || !del || !ins) return { note: 'nothing drawn' };
      // At the very top of the scroller, where a card has no room above.
      line.scrollIntoView({ block: 'start' });
      await frames();
      const old = firstBox(del);
      const x = old.left + 20;
      const y = old.top + old.height / 2;
      (document.elementFromPoint(x, y) ?? del).dispatchEvent(mouse('mousemove', x, y));
      await wait(700);
      const card = document.querySelector<HTMLElement>('.rl-card');
      if (!card) return { note: 'no card opened' };
      const box = card.getBoundingClientRect();
      const top = Math.min(firstBox(del).top, firstBox(ins).top);
      const bottom = Math.max(lastBox(del).bottom, lastBox(ins).bottom);
      const problems: Problem = {};
      if (box.top < bottom - 1)
        problems['notBelow'] = { card: [box.top, box.bottom], text: [top, bottom] };
      away(editor);
      return problemsOf(problems);
    },
  },
  {
    name: 'option-down-home-end-and-typing-next-to-a-struck-block-act-on-the-text-beside-it',
    async run(editor) {
      await open(editor, 'redlines', 'After the deleted paragraph.');
      const problems: Problem = {};
      const aboveEnd = endOf(editor, 'Before the deleted paragraph.');
      const belowStart = at(editor, 'After the deleted paragraph.');
      const keyed = async (key: string, altKey = false) => {
        const event = new KeyboardEvent('keydown', {
          key,
          altKey,
          bubbles: true,
          cancelable: true,
        });
        editor.view.contentDOM.dispatchEvent(event);
        await frames();
        return event.defaultPrevented;
      };
      // ⌥↓ goes to the end of the paragraph the caret is in, then to the end of the next one's, past
      // the struck block; ⌥↑ goes to the start of that paragraph, then of the one before it. The
      // paragraph keys are the Mac's.
      if (/Mac/.test(navigator.platform)) {
        const belowEnd = endOf(editor, 'After the deleted paragraph.');
        const aboveStart = at(editor, 'Before the deleted paragraph.');
        await place(editor, aboveEnd - 6);
        const seen: number[] = [];
        for (const down of [true, true, false, false]) {
          await keyed(down ? 'ArrowDown' : 'ArrowUp', true);
          seen.push(head(editor));
        }
        const wanted = [aboveEnd, belowEnd, belowStart, aboveStart];
        if (seen.join() !== wanted.join()) problems['option'] = { seen, wanted };
      }
      // End and Home stay on their own line, in the text, never in the block.
      await place(editor, belowStart + 4);
      await keyed('Home');
      if (head(editor) !== belowStart) problems['home'] = [head(editor), belowStart];
      await place(editor, aboveEnd - 4);
      await keyed('End');
      if (head(editor) !== aboveEnd) problems['end'] = [head(editor), aboveEnd];
      // A character typed at the start of the line below goes into it, and the block stays.
      await place(editor, belowStart);
      const before = editor.getDoc().length;
      document.execCommand('insertText', false, 'x');
      await frames();
      const typed = editor.getDoc().slice(belowStart, belowStart + 12);
      if (editor.getDoc().length <= before || !typed.includes('x')) problems['typed'] = typed;
      if (!blockWith(editor, 'This paragraph was deleted whole.')) problems['blockGone'] = true;
      return problemsOf(problems);
    },
  },
  {
    name: 'no-card-opens-on-hover-in-simple',
    async run(editor) {
      await open(editor, 'simple', NEW_PARAGRAPH);
      const line = lineWith(editor, NEW_PARAGRAPH);
      if (!line) return { note: 'nothing drawn' };
      const rect = await reveal(line);
      const x = rect.left + 30;
      const y = rect.top + 8;
      (document.elementFromPoint(x, y) ?? line).dispatchEvent(mouse('mousemove', x, y));
      await wait(700);
      return document.querySelector('.rl-card') ? { card: true } : null;
    },
  },
];

const CHECKS: Check[] = [...drawing, ...rewrites, ...carets, ...pointer];

export async function runStruckCheck(editor: Editor): Promise<void> {
  const run = async () => {
    let passed = 0;
    let failed = 0;
    for (const check of CHECKS) {
      try {
        const failure = await check.run(editor);
        if (failure) {
          failed++;
          console.log(`STRUCK-CHECK ${check.name} FAIL ${JSON.stringify(failure)}`);
        } else {
          passed++;
          console.log(`STRUCK-CHECK ${check.name} pass`);
        }
      } catch (error) {
        failed++;
        console.log(`STRUCK-CHECK ${check.name} FAIL ${JSON.stringify({ threw: String(error) })}`);
      }
    }
    editor.setTracking(false, { inFile: false });
    editor.reloadDoc(sample);
    console.log(`STRUCK-CHECK done ${passed} passed, ${failed} failed`);
  };
  // For a person at the console: the document the checks load, to look at in a view, and the
  // checks to run again.
  (window as unknown as Record<string, unknown>)['__REDLINES_STRUCK__'] = {
    editor,
    doc: DOC,
    show: (view: View, needle: string) => open(editor, view, needle),
    run,
  };
  await wait(800);
  await run();
}
