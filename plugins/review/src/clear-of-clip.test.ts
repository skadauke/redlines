// @vitest-environment happy-dom
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import { clearOfClip } from './shared.ts';
import { file, mount, PEOPLE, unmountAll } from './test-helpers.ts';

afterEach(() => unmountAll());

const doc = file('We ship the <!--ins k3x9-->new <!--/k3x9-->importer.', [
  ...PEOPLE,
  'marks:',
  '  k3x9: {by: ada, at: 2026-10-31T09:30Z}',
]);

/** An editor whose box starts 52 px down, with the title bar's room, 64 px, kept over it. */
function setup() {
  const { editor } = mount(doc);
  editor.addExtension(EditorView.scrollMargins.of(() => ({ top: 64 })));
  editor.view.scrollDOM.getBoundingClientRect = () => new DOMRect(0, 52, 800, 300);
  return editor.view;
}

describe('clearOfClip (#1235)', () => {
  it('lowers an anchor that ends above the box and the room, so that CodeMirror keeps its card', () => {
    // The first line: its bottom is 108, above the clip's 52 + 64 = 116, and below the top of the page.
    const anchor = { left: 288, right: 288, top: 87, bottom: 108 };
    const placed = clearOfClip(setup(), anchor);
    expect(placed.rect.bottom).toBe(117);
    expect(placed.shift).toBe(9);
    expect(placed.rect.top).toBe(87);
  });

  it('leaves an anchor that CodeMirror would keep, and one that is out of sight, as it is', () => {
    const view = setup();
    const visible = { left: 0, right: 5, top: 200, bottom: 220 };
    expect(clearOfClip(view, visible)).toEqual({ rect: visible, shift: 0 });
    // Scrolled off the top of the page: put away, as it should be.
    const hidden = { left: 0, right: 5, top: -30, bottom: -10 };
    expect(clearOfClip(view, hidden)).toEqual({ rect: hidden, shift: 0 });
  });
});
