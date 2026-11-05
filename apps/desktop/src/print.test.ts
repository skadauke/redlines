// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { printPage } from './print.ts';

afterEach(() => vi.restoreAllMocks());

describe('printPage', () => {
  it('tells the page to lay out all of the document, waits a frame, and then prints', async () => {
    const order: string[] = [];
    window.addEventListener('beforeprint', () => order.push('beforeprint'), { once: true });
    const frame = vi.fn((callback: () => void) => {
      order.push('frame');
      callback();
    });
    await printPage(() => {
      order.push('print');
      return Promise.resolve();
    }, frame);
    expect(order).toEqual(['beforeprint', 'frame', 'print']);
  });

  it('does not print before the frame has come', async () => {
    const print = vi.fn(() => Promise.resolve());
    let frameComes: () => void = () => {};
    const printing = printPage(print, (callback) => (frameComes = callback));
    await Promise.resolve();
    expect(print).not.toHaveBeenCalled();
    frameComes();
    await printing;
    expect(print).toHaveBeenCalledOnce();
  });

  it('puts the page back as it was if printing fails', async () => {
    const after = vi.fn();
    window.addEventListener('afterprint', after, { once: true });
    await expect(
      printPage(
        () => Promise.reject(new Error('no printer')),
        (callback) => callback(),
      ),
    ).rejects.toThrow('no printer');
    expect(after).toHaveBeenCalledOnce();
  });
});
