import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Editor } from '@redlines/editor';
import type { Host, HostDocumentData, Plugin, PluginManifest } from '@redlines/plugin-api';
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

  it('gives document data only to a plugin that asks for it, each its own', () => {
    const stores = new Map<string, HostDocumentData>();
    const documentData = (manifest: PluginManifest) => {
      if (!manifest.needs?.includes('document:data')) return undefined;
      const store: HostDocumentData = {
        get: () => manifest.id,
        set: () => {},
        onReady: () => () => {},
      };
      stores.set(manifest.id, store);
      return store;
    };
    const seen = new Map<string, Host>();
    const watcher = (id: string, needs: PluginManifest['needs']): Plugin => ({
      manifest: { id, name: id, version: '0.0.0', ...(needs ? { needs } : {}) },
      activate: (context) => {
        seen.set(id, context.host);
        return () => {};
      },
    });
    // A store in the host itself is never handed to every plugin.
    const shared: Host = {
      documentData: { get: () => 'shared', set: () => {}, onReady: () => () => {} },
    };
    activatePlugins(
      editor,
      shared,
      [
        watcher('quiet', undefined),
        watcher('one', ['document:data']),
        watcher('two', ['document:data']),
      ],
      { documentData },
    );
    expect(seen.get('quiet')?.documentData).toBeUndefined();
    expect(seen.get('one')?.documentData?.get('k')).toBe('one');
    expect(seen.get('two')?.documentData?.get('k')).toBe('two');
  });
});
