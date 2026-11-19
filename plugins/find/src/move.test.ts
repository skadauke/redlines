// @vitest-environment happy-dom
import { createEditor, type Editor } from '@redlines/editor';
import { afterEach, describe, expect, it } from 'vitest';
import { createFind } from './index.ts';
import { findThemeSpec } from './styles.ts';

const mounted: { editor: Editor; remove: () => void }[] = [];

function mount(doc = 'one two one\n'): Editor {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, { doc, author: { handle: 'ada', name: 'Ada Lovelace' } });
  mounted.push({ editor, remove: createFind(editor) });
  return editor;
}

afterEach(() => {
  for (const { editor, remove } of mounted.splice(0)) {
    remove();
    editor.destroy();
  }
  document.body.replaceChildren();
});

const root = (editor: Editor) => editor.view.dom.querySelector<HTMLElement>('.rl-find-bar');
const pointer = (target: EventTarget, type: string, x: number, y: number) =>
  target.dispatchEvent(
    new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }),
  );
const escapeIn = (editor: Editor) => {
  const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  editor.view.contentDOM.dispatchEvent(event);
  return event;
};

describe('Esc in the document (#1189)', () => {
  it('closes Find while it is open', () => {
    const editor = mount();
    editor.commands.run('find.open');
    expect(root(editor)).not.toBeNull();
    escapeIn(editor);
    expect(root(editor)).toBeNull();
  });

  it('does nothing when Find is closed, so that other Esc handlers still get it', () => {
    const editor = mount();
    expect(escapeIn(editor).defaultPrevented).toBe(false);
  });
});

describe('the bar moves (#1189)', () => {
  it('follows the pointer from a part that is no control, and stays where it was left', () => {
    const editor = mount();
    editor.commands.run('find.open');
    const bar = root(editor)!;
    pointer(bar, 'pointerdown', 10, 10);
    pointer(window, 'pointermove', 210, 160);
    pointer(window, 'pointerup', 210, 160);
    // 200 across and 150 down from where it was grabbed (its box is at 0, 0 without a layout).
    expect([bar.style.left, bar.style.top]).toEqual(['200px', '150px']);
    expect(bar.style.right).toBe('auto');
    // After it is put away and opened again, it is where it was left.
    escapeIn(editor);
    editor.commands.run('find.open');
    expect([root(editor)!.style.left, root(editor)!.style.top]).toEqual(['200px', '150px']);
  });

  it('is kept inside the window', () => {
    const editor = mount();
    editor.commands.run('find.open');
    const bar = root(editor)!;
    pointer(bar, 'pointerdown', 0, 0);
    pointer(window, 'pointermove', -500, -500);
    pointer(window, 'pointerup', -500, -500);
    expect([bar.style.left, bar.style.top]).toEqual(['8px', '8px']);
  });

  it('is not moved by a press on a control or in a box', () => {
    const editor = mount();
    editor.commands.run('find.open');
    const bar = root(editor)!;
    const before = bar.style.left;
    pointer(bar.querySelector('input')!, 'pointerdown', 10, 10);
    pointer(window, 'pointermove', 300, 300);
    pointer(window, 'pointerup', 300, 300);
    pointer(bar.querySelector('button')!, 'pointerdown', 10, 10);
    pointer(window, 'pointermove', 400, 400);
    pointer(window, 'pointerup', 400, 400);
    expect(bar.style.left).toBe(before);
  });
});

describe('the match highlight (#1189)', () => {
  const spec = findThemeSpec as Record<string, Record<string, string>>;

  it('has no box: no outline and no rounded corners', () => {
    for (const name of ['.rl-find-match', '.rl-find-current']) {
      expect(spec[name]).not.toHaveProperty('outline');
      expect(spec[name]).not.toHaveProperty('borderRadius');
      expect(spec[name]).not.toHaveProperty('border');
    }
  });

  it('is a light gray, with the current match set apart by a stronger one', () => {
    const share = (name: string) =>
      Number(/ (\d+)%/.exec(spec[name]?.['backgroundColor'] ?? '')?.[1]);
    expect(share('.rl-find-match')).toBeLessThanOrEqual(8);
    expect(share('.rl-find-current')).toBeGreaterThan(share('.rl-find-match') * 2);
  });
});
