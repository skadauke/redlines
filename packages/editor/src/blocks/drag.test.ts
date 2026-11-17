// @vitest-environment happy-dom
// Dragging selected blocks (#623): the gap the pointer picks, what counts as a selection of whole
// blocks, and the drop that moves them, with Track Changes off and on. The page has no layout here, so
// the drag is given its geometry: the gaps' lines are at heights it names.
import { EditorSelection } from '@codemirror/state';
import { newestView, originalView } from '@redlines/format';
import { afterEach, describe, expect, it } from 'vitest';
import { createEditor, type Editor } from '../index.ts';
import { editSourceFacet } from '../tracked/typing.ts';
import { BlockDrag, type DragGeometry, draggableRun, pickGap } from './drag.ts';
import { runOfSelection } from './move.ts';

const ada = { handle: 'ada', name: 'Ada Lovelace' };
const mounted: Editor[] = [];

afterEach(() => {
  for (const editor of mounted.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

function mount(doc: string, select: [number, number], tracking: boolean): Editor {
  const parent = document.createElement('div');
  document.body.append(parent);
  let n = 0;
  const editor = createEditor(parent, {
    doc,
    author: ada,
    tracking,
    extensions: [
      editSourceFacet.of({
        now: () => new Date('2026-11-01T10:00Z'),
        random: (k) => Uint8Array.from({ length: k }, () => n++ % 19),
      }),
    ],
  });
  editor.view.dispatch({ selection: EditorSelection.range(select[0], select[1]) });
  mounted.push(editor);
  return editor;
}

/** Gap `i` is at y = 10 * (i + 1); the dragged run, at 100 to 110, is out of the way. */
const lines: DragGeometry = {
  gapY: (_view, gap) => 10 * (gap.index + 1),
  extent: () => ({ top: 100, bottom: 110 }),
};

const BODY = 'One.\n\nTwo.\n\nThree.\n\nFour.';

describe('the gap a drag picks', () => {
  const gaps = [0, 1, 3, 4].map((index) => ({
    gap: { at: index, after: false, index },
    y: 10 * (index + 1),
  }));
  it('is the nearest, and none over the blocks themselves', () => {
    expect(pickGap(gaps, { top: 100, bottom: 110 }, 12)?.index).toBe(0);
    expect(pickGap(gaps, { top: 100, bottom: 110 }, 38)?.index).toBe(3);
    expect(pickGap(gaps, { top: 100, bottom: 110 }, 200)?.index).toBe(4);
    expect(pickGap(gaps, { top: 100, bottom: 110 }, 105)).toBeUndefined();
  });
});

describe('selected blocks', () => {
  it('are dragged when the selection covers their text, whole', () => {
    const two = BODY.indexOf('Two.');
    expect(draggableRun(mount(BODY, [two, two + 4], false).view)?.count).toBe(1);
    const run = draggableRun(mount(BODY, [0, BODY.indexOf('Three.') + 6], false).view);
    expect(run?.count).toBe(3);
  });

  it('are not dragged by a caret or a part of a block', () => {
    const two = BODY.indexOf('Two.');
    expect(draggableRun(mount(BODY, [two, two], false).view)).toBeUndefined();
    expect(draggableRun(mount(BODY, [two, two + 2], false).view)).toBeUndefined();
  });

  it('are the item, with its bullet hidden, in a list', () => {
    const list = '- one\n- two\n- three';
    const two = list.indexOf('two');
    const run = draggableRun(mount(list, [two, two + 3], false).view);
    expect(run?.kind).toBe('item');
  });
});

describe('dropping selected blocks', () => {
  for (const tracking of [false, true]) {
    const how = tracking ? 'Track Changes on' : 'Track Changes off';

    it(`moves them to the gap, one step to undo, ${how}`, () => {
      const two = BODY.indexOf('Two.');
      const editor = mount(BODY, [two, two + 4], tracking);
      const { view } = editor;
      const run = runOfSelection(view.state)!;
      const drag = new BlockDrag(view, run, lines);
      drag.move(38);
      expect(drag.gap?.index).toBe(3);
      expect(drag.drop()).toBe(true);
      const text = view.state.doc.toString();
      expect(newestView(text).text.trimEnd()).toBe('One.\n\nThree.\n\nTwo.\n\nFour.');
      if (tracking) expect(originalView(text).text.trimEnd()).toBe(BODY);
      // The moved blocks stay selected.
      const { from, to } = view.state.selection.main;
      expect(
        newestView(text).text.slice(
          newestView(text).map.fromSource(from),
          newestView(text).map.fromSource(to),
        ),
      ).toBe('Two.');
    });

    it(`does nothing over the blocks themselves, or when cancelled, ${how}`, () => {
      const two = BODY.indexOf('Two.');
      const editor = mount(BODY, [two, two + 4], tracking);
      const { view } = editor;
      const drag = new BlockDrag(view, runOfSelection(view.state)!, lines);
      drag.move(105);
      expect(drag.gap).toBeUndefined();
      expect(drag.drop()).toBe(false);
      const again = new BlockDrag(view, runOfSelection(view.state)!, lines);
      again.move(38);
      again.cancel();
      expect(view.state.doc.toString()).toBe(BODY);
      expect(view.dom.classList.contains('rl-block-dragging')).toBe(false);
    });
  }
});

describe('a drag as the editor scrolls', () => {
  it('measures the blocks being dragged at every move, not at the press', () => {
    const editor = mount(BODY, [0, 4], false);
    const run = runOfSelection(editor.view.state)!;
    let top = 100;
    const scrolling: DragGeometry = { ...lines, extent: () => ({ top, bottom: top + 10 }) };
    const drag = new BlockDrag(editor.view, run, scrolling);
    drag.move(105);
    expect(drag.gap).toBeUndefined();
    // The editor scrolled: the blocks are now where the pointer was not.
    top = 300;
    drag.move(105);
    expect(drag.gap).toBeDefined();
    drag.cancel();
  });

  it('says that the pointer is at an edge, so that the caller keeps scrolling', () => {
    const editor = mount(BODY, [0, 4], false);
    const run = runOfSelection(editor.view.state)!;
    const drag = new BlockDrag(editor.view, run, lines);
    // happy-dom's scroller has no size: its rectangle is at 0, so y = 1 is at the top edge.
    expect(drag.scrollFor(1)).toBe(true);
    drag.cancel();
  });
});
