// @vitest-environment happy-dom
import { MAX_VIEW_BYTES } from '@redlines/code';
import { describe, expect, it, vi } from 'vitest';
import { NotUtf8Error } from './host.ts';
import { createViewerSwap, type Viewing } from './viewer-swap.ts';

function setUp(readCapped = vi.fn()) {
  const viewerHost = document.createElement('div');
  viewerHost.hidden = true;
  const editorSide = document.createElement('div');
  document.body.append(viewerHost, editorSide);
  const notice = vi.fn();
  const changes: (Viewing | null)[] = [];
  const swap = createViewerSwap({
    host: { readCapped },
    viewerHost,
    editorSide,
    notice,
    onChange: (viewing) => changes.push(viewing),
  });
  return { swap, viewerHost, editorSide, notice, changes, readCapped };
}

describe('the viewer swap', () => {
  it('shows a file in place of the editor, and gives the editor back', async () => {
    const { swap, viewerHost, editorSide, changes, readCapped } = setUp(
      vi.fn(() => Promise.resolve({ text: 'one\ntwo\n' })),
    );
    await swap.show('/p/notes.log', 2);
    expect(readCapped).toHaveBeenCalledWith('/p/notes.log', MAX_VIEW_BYTES);
    expect(viewerHost.hidden).toBe(false);
    expect(editorSide.hidden).toBe(true);
    expect(viewerHost.querySelector('.rl-viewer-line')?.textContent).toBe('two');
    expect(swap.current).toEqual({ path: '/p/notes.log', name: 'notes.log' });

    swap.close();
    expect(viewerHost.hidden).toBe(true);
    expect(editorSide.hidden).toBe(false);
    expect(viewerHost.children).toHaveLength(0);
    expect(swap.current).toBeNull();
    expect(changes).toEqual([{ path: '/p/notes.log', name: 'notes.log' }, null]);
    // Closing again says nothing.
    swap.close();
    expect(changes).toHaveLength(2);
  });

  it('says one line for a file that is too large, and reads it no further', async () => {
    const { swap, viewerHost } = setUp(vi.fn(() => Promise.resolve({ tooLarge: true })));
    await swap.show('/p/huge.log');
    expect(viewerHost.textContent).toBe('This file is too large to show here.');
    expect(viewerHost.querySelector('.cm-editor')).toBeNull();
  });

  it('says so for a file that is not UTF-8', async () => {
    const { swap, viewerHost } = setUp(vi.fn(() => Promise.reject(new NotUtf8Error())));
    await swap.show('/p/a.csv');
    expect(viewerHost.textContent).toContain('isn’t UTF-8 text');
  });

  it('flashes a line when the file can’t be read, and keeps what was showing', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { swap, notice, editorSide } = setUp(vi.fn(() => Promise.reject(new Error('no'))));
    await swap.show('/p/gone.log');
    expect(notice).toHaveBeenCalledWith('Couldn’t open “gone.log”.');
    expect(editorSide.hidden).toBe(false);
    expect(swap.current).toBeNull();
  });

  it('drops a read that finishes after a newer ask or a close', async () => {
    const slow: (() => void)[] = [];
    const readCapped = vi.fn(
      (path: string) =>
        new Promise<{ text: string }>((resolve) => slow.push(() => resolve({ text: path }))),
    );
    const { swap, changes } = setUp(readCapped);
    const first = swap.show('/p/a.log');
    const second = swap.show('/p/b.log');
    slow[1]?.();
    await second;
    slow[0]?.();
    await first;
    expect(swap.current?.name).toBe('b.log');
    const third = swap.show('/p/c.log');
    swap.close();
    slow[2]?.();
    await third;
    expect(swap.current).toBeNull();
    expect(changes.at(-1)).toBeNull();
  });
});
