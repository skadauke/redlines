// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createSidebarResize,
  SIDEBAR_CLOSES_BELOW,
  SIDEBAR_DEFAULT,
  SIDEBAR_MAX,
  SIDEBAR_MIN,
  sidebarWidthOf,
} from './sidebar-resize.ts';

afterEach(() => document.body.replaceChildren());

function setUp() {
  const app = document.createElement('div');
  const aside = document.createElement('aside');
  app.append(aside);
  document.body.append(app);
  const onResize = vi.fn();
  const onClose = vi.fn();
  const resize = createSidebarResize({ aside, app, onResize, onClose });
  const handle = aside.querySelector<HTMLElement>('.rl-sidebar-resize');
  if (!handle) throw new Error('No handle');
  const pointer = (type: string, clientX = 0) =>
    handle.dispatchEvent(new PointerEvent(type, { clientX, button: 0, bubbles: true }));
  const width = () => aside.style.getPropertyValue('--rl-sidebar-width');
  return { app, aside, handle, resize, onResize, onClose, pointer, width };
}

describe('sidebarWidthOf', () => {
  it('keeps a width in range and puts the rest right', () => {
    expect(sidebarWidthOf(300)).toBe(300);
    expect(sidebarWidthOf(10)).toBe(SIDEBAR_MIN);
    expect(sidebarWidthOf(9999)).toBe(SIDEBAR_MAX);
    expect(sidebarWidthOf('wide')).toBe(SIDEBAR_DEFAULT);
    expect(sidebarWidthOf(Number.NaN)).toBe(SIDEBAR_DEFAULT);
    expect(sidebarWidthOf(undefined)).toBe(SIDEBAR_DEFAULT);
  });
});

describe('the sidebar edge', () => {
  it('draws the width it is given, made right', () => {
    const { resize, width } = setUp();
    expect(width()).toBe('240px');
    resize.setWidth(320);
    expect(width()).toBe('320px');
    resize.setWidth(5);
    expect(width()).toBe(`${SIDEBAR_MIN}px`);
  });

  it('follows the pointer through a drag and keeps the width where it lets go', () => {
    const { app, pointer, width, onResize, onClose } = setUp();
    pointer('pointerdown', 240);
    expect(app.hasAttribute('data-sidebar-drag')).toBe(true);
    pointer('pointermove', 300);
    expect(width()).toBe('300px');
    pointer('pointerup', 300);
    expect(app.hasAttribute('data-sidebar-drag')).toBe(false);
    expect(onResize).toHaveBeenCalledExactlyOnceWith(300);
    expect(onClose).not.toHaveBeenCalled();
    expect(width()).toBe('300px');
  });

  it('holds the least width between the minimum and the closing point, and the most at the other end', () => {
    const { pointer, width, onResize } = setUp();
    pointer('pointerdown', 240);
    pointer('pointermove', SIDEBAR_MIN - 20);
    expect(width()).toBe(`${SIDEBAR_MIN}px`);
    pointer('pointerup', SIDEBAR_MIN - 20);
    expect(onResize).toHaveBeenCalledWith(SIDEBAR_MIN);
    pointer('pointerdown', 180);
    pointer('pointermove', 900);
    expect(width()).toBe(`${SIDEBAR_MAX}px`);
  });

  it('closes when it is let go below the closing point, and keeps the width it had', () => {
    const { resize, pointer, width, onResize, onClose } = setUp();
    resize.setWidth(300);
    pointer('pointerdown', 300);
    pointer('pointermove', SIDEBAR_CLOSES_BELOW - 1);
    // It follows the pointer into the edge.
    expect(width()).toBe(`${SIDEBAR_CLOSES_BELOW - 1}px`);
    pointer('pointerup', SIDEBAR_CLOSES_BELOW - 1);
    expect(onClose).toHaveBeenCalledOnce();
    expect(onResize).not.toHaveBeenCalled();
    expect(width()).toBe('300px');
  });

  it('puts a drag back when it is cancelled', () => {
    const { pointer, width, onResize, onClose } = setUp();
    pointer('pointerdown', 240);
    pointer('pointermove', 400);
    pointer('pointercancel', 400);
    expect(width()).toBe('240px');
    expect(onResize).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('ends a drag whose capture is lost, so that later widths are drawn', () => {
    const { resize, pointer, width, app, onResize } = setUp();
    pointer('pointerdown', 240);
    pointer('pointermove', 400);
    pointer('lostpointercapture', 400);
    expect(app.hasAttribute('data-sidebar-drag')).toBe(false);
    expect(onResize).not.toHaveBeenCalled();
    resize.setWidth(300);
    expect(width()).toBe('300px');
  });

  it('resizes with the arrow keys, within the range', () => {
    const { handle, width, onResize } = setUp();
    const key = (name: string) =>
      handle.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true }));
    key('ArrowRight');
    expect(width()).toBe('256px');
    expect(onResize).toHaveBeenLastCalledWith(256);
    key('ArrowLeft');
    key('ArrowLeft');
    expect(width()).toBe('224px');
    for (let i = 0; i < 20; i++) key('ArrowLeft');
    expect(width()).toBe(`${SIDEBAR_MIN}px`);
    const calls = onResize.mock.calls.length;
    key('ArrowLeft');
    expect(onResize.mock.calls.length).toBe(calls);
  });

  it('is a separator with a hint, and goes away with the sidebar', () => {
    const { aside, handle, resize } = setUp();
    expect(handle.getAttribute('role')).toBe('separator');
    expect(handle.title).toMatch(/resize/i);
    resize.destroy();
    expect(aside.querySelector('.rl-sidebar-resize')).toBeNull();
  });
});
