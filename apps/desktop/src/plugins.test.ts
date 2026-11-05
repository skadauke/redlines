import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Editor } from '@redlines/editor';
import type { Host, Plugin } from '@redlines/plugin-api';
import { activatePlugins } from './plugins.ts';

const editor = {} as Editor;
const host: Host = {};

function plugin(id: string, log: string[], activate?: () => void): Plugin {
  return {
    manifest: { id, name: id, version: '0.0.0' },
    activate: () => {
      activate?.();
      log.push(`on ${id}`);
      return () => log.push(`off ${id}`);
    },
  };
}

afterEach(() => vi.restoreAllMocks());

describe('activatePlugins', () => {
  it('activates in order and removes in reverse', () => {
    const log: string[] = [];
    const remove = activatePlugins(editor, host, [plugin('a', log), plugin('b', log)]);
    expect(log).toEqual(['on a', 'on b']);
    remove();
    expect(log).toEqual(['on a', 'on b', 'off b', 'off a']);
  });

  it('reports a plugin that throws and keeps going', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const log: string[] = [];
    const broken = plugin('broken', log, () => {
      throw new Error('no');
    });
    const remove = activatePlugins(editor, host, [plugin('a', log), broken, plugin('c', log)]);
    expect(log).toEqual(['on a', 'on c']);
    expect(error).toHaveBeenCalledOnce();
    expect(String(error.mock.calls[0]?.[0])).toContain('broken');
    remove();
    expect(log).toEqual(['on a', 'on c', 'off c', 'off a']);
  });

  it('keeps removing when a plugin throws as it is taken out', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const log: string[] = [];
    const stubborn: Plugin = {
      manifest: { id: 'stubborn', name: 's', version: '0.0.0' },
      activate: () => () => {
        throw new Error('stuck');
      },
    };
    const remove = activatePlugins(editor, host, [plugin('a', log), stubborn]);
    remove();
    expect(log).toEqual(['on a', 'off a']);
    expect(error).toHaveBeenCalledOnce();
  });

  it('gives each plugin the editor, host, author and a notice', () => {
    const seen: unknown[] = [];
    const notices: string[] = [];
    const spy: Plugin = {
      manifest: { id: 'spy', name: 's', version: '0.0.0' },
      activate: (context) => {
        seen.push(context.editor, context.host, context.author);
        context.notice('hi');
        return () => {};
      },
    };
    const author = { handle: 'ada', name: 'Ada' };
    activatePlugins(editor, host, [spy], { author, notice: (m) => notices.push(m) });
    expect(seen).toEqual([editor, host, author]);
    expect(notices).toEqual(['hi']);
  });
});
