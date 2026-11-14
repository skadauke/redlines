// @vitest-environment happy-dom
import { EditorSelection } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import { createEditor, type Editor, type EditorOptions } from '../index.ts';
import { type BarGeometry, barClickHandlers, barSwitch, type ViewKeys } from './bar-switch.ts';
import { viewModeField } from './field.ts';

const ada = { handle: 'ada', name: 'Ada Lovelace' };
const open: Editor[] = [];

afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

const doc =
  'Alpha.\nBeta <!--ins b2b2-->two<!--/b2b2--> three.\nGamma.\n\n<!-- redlines\nversion: 1\nmarks:\n  b2b2: {by: ada, at: 2026-10-31T09:30Z}\n-->\n';

/**
 * A layout for happy-dom, which has none: lines 20 px high in Simple and 30 in Redlines, 100 px
 * from the left, in a scroller whose `scrollTop` is a plain number.
 */
const LEFT = 100;
const heightIn = (view: EditorView) => (view.state.field(viewModeField) === 'redlines' ? 30 : 20);
const layout: BarGeometry = {
  locate(view, x, y) {
    const h = heightIn(view);
    const n = Math.floor((y + view.scrollDOM.scrollTop) / h) + 1;
    if (n < 1 || n > view.state.doc.lines) return null;
    const line = view.state.doc.line(n);
    const node = view.domAtPos(line.from).node;
    const element = (node instanceof Element ? node : node.parentElement)?.closest('.cm-line');
    if (!element) return null;
    const top = (n - 1) * h - view.scrollDOM.scrollTop;
    return { element, pos: line.from, rect: { left: LEFT, top, bottom: top + h } };
  },
  lineTop: (view, pos) =>
    (view.state.doc.lineAt(pos).number - 1) * heightIn(view) - view.scrollDOM.scrollTop,
};

function load(
  options: Partial<EditorOptions> = {},
  hintDelay = 400,
  keys: ViewKeys = { simple: '⌃S', redlines: '⌃R' },
) {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, {
    doc,
    author: ada,
    extensions: [barSwitch({ geometry: layout, hintDelay, keys })],
    ...options,
  });
  open.push(editor);
  return editor;
}

/** The bar of the second line: 24 px left of the line, and its target 12 px each side of that. */
const ON_BAR = { x: LEFT - 23, y: 35 };
const mouse = (type: string, at: { x: number; y: number }, init: MouseEventInit = {}) =>
  new MouseEvent(type, {
    clientX: at.x,
    clientY: at.y,
    button: 0,
    bubbles: true,
    cancelable: true,
    detail: 1,
    ...init,
  });
/** A press and release; returns whether the press was taken (its default prevented). */
function click(editor: Editor, at = ON_BAR, init: MouseEventInit = {}, moveTo = at): boolean {
  const down = mouse('mousedown', at, init);
  editor.view.scrollDOM.dispatchEvent(down);
  document.dispatchEvent(mouse('mouseup', moveTo, init));
  return down.defaultPrevented;
}
const viewOf = (editor: Editor) => editor.getUiState().view;

describe('the click on a change bar', () => {
  it("switches Simple to Redlines and back on a click on a bar's target", () => {
    const editor = load({ view: 'simple' });
    expect(click(editor)).toBe(true);
    expect(viewOf(editor)).toBe('redlines');
    expect(editor.getUiState().markupView).toBe('redlines');
    click(editor);
    expect(viewOf(editor)).toBe('simple');
    expect(editor.getUiState().markupView).toBe('simple');
    // The edge of the target, and a little beyond it.
    click(editor, { x: LEFT - 23 + 12, y: 35 });
    expect(viewOf(editor)).toBe('redlines');
    click(editor, { x: LEFT - 23 + 14, y: 35 });
    expect(viewOf(editor)).toBe('redlines');
  });

  it('keeps the line under the pointer where it was', async () => {
    const editor = load({ view: 'simple' });
    const { scrollDOM } = editor.view;
    scrollDOM.scrollTop = 7;
    const line = editor.view.state.doc.line(2).from;
    const before = layout.lineTop(editor.view, line);
    click(editor, { x: ON_BAR.x, y: before + 5 });
    await new Promise((resolve) => requestAnimationFrame(resolve));
    // Lines above grew 10 px each; the scroller moved so that the line stayed.
    expect(layout.lineTop(editor.view, line)).toBeCloseTo(before, 0);
    expect(scrollDOM.scrollTop).toBe(17);
  });

  it('moves no selection, caret or focus', () => {
    for (const focused of [true, false]) {
      const editor = load({ view: 'simple' });
      const { view } = editor;
      const edge = view.state.doc.line(2).from;
      view.dispatch({ selection: EditorSelection.range(edge, edge + 4) });
      if (focused) view.focus();
      else (document.activeElement as HTMLElement | null)?.blur();
      const [selection, hadFocus, active] = [
        view.state.selection,
        view.hasFocus,
        document.activeElement,
      ];
      click(editor);
      expect(view.state.selection.eq(selection)).toBe(true);
      expect(view.hasFocus).toBe(hadFocus);
      expect(document.activeElement).toBe(active);
      expect(viewOf(editor)).toBe('redlines');
    }
  });

  it('does nothing for a press that moves 5 px, and for a press in Clean or Raw', () => {
    const editor = load({ view: 'simple' });
    click(editor, ON_BAR, {}, { x: ON_BAR.x + 5, y: ON_BAR.y });
    expect(viewOf(editor)).toBe('simple');
    for (const view of ['clean', 'raw'] as const) {
      editor.setViewMode(view);
      expect(click(editor)).toBe(false);
      expect(viewOf(editor)).toBe(view);
    }
  });

  it('leaves a press with a modifier, and a press beside a line with no bar, to the editor', () => {
    const editor = load({ view: 'simple' });
    for (const init of [
      { metaKey: true },
      { altKey: true },
      { shiftKey: true },
      { ctrlKey: true },
    ]) {
      expect(click(editor, ON_BAR, init)).toBe(false);
    }
    expect(click(editor, { x: LEFT - 23, y: 5 })).toBe(false);
    expect(click(editor, { x: LEFT + 40, y: 35 })).toBe(false);
    expect(viewOf(editor)).toBe('simple');
  });

  it('switches once on a double-click', () => {
    const editor = load({ view: 'simple' });
    click(editor);
    const second = click(editor, ON_BAR, { detail: 2 });
    expect(second).toBe(true);
    expect(viewOf(editor)).toBe('redlines');
  });

  it('asks the handlers first, and switches only when none handles it', () => {
    const asked: number[] = [];
    const editor = load({
      view: 'simple',
      extensions: [
        barSwitch({ geometry: layout }),
        barClickHandlers.of((_view, pos) => (asked.push(pos), false)),
        barClickHandlers.of((_view, pos) => (asked.push(pos), asked.length < 3)),
      ],
    });
    click(editor);
    expect(viewOf(editor)).toBe('simple');
    expect(asked).toEqual([7, 7]);
    click(editor);
    expect(viewOf(editor)).toBe('redlines');
  });

  it('puts rl-bar-hot and the hint on the hovered bar and takes them away on leave', async () => {
    const editor = load({ view: 'simple' }, 5);
    const { scrollDOM } = editor.view;
    const hot = () => editor.view.contentDOM.querySelectorAll('.rl-bar-hot').length;
    const hint = () => editor.view.dom.ownerDocument.querySelector('.rl-bar-hint')?.textContent;
    scrollDOM.dispatchEvent(mouse('mousemove', ON_BAR));
    expect(hot()).toBe(1);
    expect(scrollDOM.style.cursor).toBe('pointer');
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(hint()).toBe('Show full markup⌃R');
    scrollDOM.dispatchEvent(mouse('mouseleave', ON_BAR));
    expect(hot()).toBe(0);
    expect(hint()).toBeUndefined();
    expect(scrollDOM.style.cursor).toBe('');

    editor.setViewMode('redlines');
    scrollDOM.dispatchEvent(mouse('mousemove', { x: ON_BAR.x, y: 35 }));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(hint()).toBe('Show simple look⌃S');
    // A move off the target.
    scrollDOM.dispatchEvent(mouse('mousemove', { x: LEFT + 50, y: 35 }));
    expect(hot()).toBe(0);
  });

  it('names no keys in the hint when the host gives none', async () => {
    const editor = load({ view: 'simple' }, 5, {});
    editor.view.scrollDOM.dispatchEvent(mouse('mousemove', ON_BAR));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(document.querySelector('.rl-bar-hint')?.textContent).toBe('Show full markup');
    expect(document.querySelector('.rl-bar-hint-keys')).toBeNull();
  });

  it('keeps the line when only the switch makes an ancestor scroll', () => {
    // A document that fits in Simple: nothing scrolls. Redlines is taller, and the element around
    // the editor then scrolls, so that is the one to move, chosen after the switch.
    const around = document.createElement('div');
    around.style.overflowY = 'auto';
    document.body.append(around);
    const parent = document.createElement('div');
    around.append(parent);
    const geometry: BarGeometry = {
      locate: (view, x, y) => layout.locate(view, x, y),
      lineTop: (view, pos) =>
        (view.state.doc.lineAt(pos).number - 1) * heightIn(view) - around.scrollTop,
    };
    const editor = createEditor(parent, {
      doc,
      author: ada,
      view: 'simple',
      extensions: [barSwitch({ geometry })],
    });
    open.push(editor);
    Object.defineProperty(around, 'clientHeight', { configurable: true, get: () => 100 });
    Object.defineProperty(around, 'scrollHeight', {
      configurable: true,
      get: () => (viewOf(editor) === 'redlines' ? 400 : 100),
    });
    click(editor);
    expect(viewOf(editor)).toBe('redlines');
    // Line 2 sat 20 px down in Simple and is 30 px down in Redlines: the page scrolls 10 px.
    expect(around.scrollTop).toBe(10);
    expect(editor.view.scrollDOM.scrollTop).toBe(0);
  });
  describe('a struck block’s bar (a block deleted whole, drawn as a block)', () => {
    const BLOCK_TOP = 30;
    const struckDoc =
      'One.\n\n<!--del b2b2 Two.\\n\\n-->\n\nThree.\n\n<!-- redlines\nversion: 1\nmarks:\n  b2b2: {by: bo, at: 2026-10-31T09:30Z}\n-->\n';
    /** Redlines draws the struck block between "One." and "Three."; Simple's lines are 20 px. */
    function loadStruck(
      handlers: ((view: EditorView, pos: number, mark?: string) => boolean)[] = [],
    ) {
      let block: Element | null = null;
      const geometry: BarGeometry = {
        locate(view, _x, y) {
          block = view.contentDOM.querySelector('.rl-struck');
          if (!block || y < BLOCK_TOP || y > BLOCK_TOP + 24) return null;
          Object.assign(block, {
            getBoundingClientRect: () => ({ left: LEFT, top: BLOCK_TOP, bottom: BLOCK_TOP + 24 }),
          });
          return {
            element: block,
            pos: view.posAtDOM(block),
            mark: (block as HTMLElement).dataset['mark'] ?? '',
            rect: { left: LEFT, top: BLOCK_TOP, bottom: BLOCK_TOP + 24 },
          };
        },
        // Simple draws "One." in 20 px and "Three." under it: where the block was drawn it is not.
        lineTop: (view, pos) =>
          (view.state.doc.lineAt(pos).number > 1 ? 20 : 0) - view.scrollDOM.scrollTop,
      };
      const parent = document.createElement('div');
      document.body.append(parent);
      const editor = createEditor(parent, {
        doc: struckDoc,
        author: ada,
        extensions: [barSwitch({ geometry }), ...handlers.map((h) => barClickHandlers.of(h))],
      });
      open.push(editor);
      return editor;
    }
    const onBlock = { x: LEFT - 23, y: BLOCK_TOP + 5 };

    it('switches to Simple, and the block below takes the place the block had', () => {
      const editor = loadStruck();
      expect(editor.view.contentDOM.querySelector('.rl-struck')).not.toBeNull();
      expect(click(editor, onBlock)).toBe(true);
      expect(viewOf(editor)).toBe('simple');
      // "Three." now stands 10 px higher than the block did: the page scrolled to put it back.
      expect(editor.view.scrollDOM.scrollTop).toBe(-10);
      expect(editor.view.contentDOM.querySelector('.rl-struck')).toBeNull();
    });

    it('asks the bar handlers with the id of its change', () => {
      const asked: [number, string | undefined][] = [];
      const editor = loadStruck([
        (_view, pos, mark) => {
          asked.push([pos, mark]);
          return true;
        },
      ]);
      click(editor, onBlock);
      expect(asked).toEqual([[expect.any(Number), 'b2b2']]);
      // A handler took it: nothing switched.
      expect(viewOf(editor)).toBe('redlines');
    });
  });
});
