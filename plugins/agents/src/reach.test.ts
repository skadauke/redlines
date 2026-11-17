import type { AgentScope, ProjectRoot } from '@redlines/plugin-api';
import { describe, expect, it, vi } from 'vitest';
import { decideReach, narrower, TOO_BROAD, type ReachInput } from './reach.ts';

const root: ProjectRoot = { folder: '/p', isRepo: true, tooBroad: false };

function input(over: Partial<ReachInput> = {}): ReachInput & {
  stored: Map<string, AgentScope | 'no'>;
} {
  const stored = new Map<string, AgentScope | 'no'>();
  return {
    stored,
    agent: { id: 'claude' },
    root,
    defaultScope: () => 'folder',
    consent: (agent, folder) => stored.get(`${agent}:${folder}`),
    setConsent: (agent, folder, answer) => stored.set(`${agent}:${folder}`, answer),
    ask: () => Promise.resolve('folder' as const),
    over: () => false,
    ...over,
  };
}

describe('narrower', () => {
  it('takes the narrower scope', () => {
    expect(narrower('everything', 'folder')).toBe('folder');
    expect(narrower('document', 'everything')).toBe('document');
  });
});

describe('decideReach', () => {
  it('is this document for a document with no file', async () => {
    const ask = vi.fn();
    expect(await decideReach(input({ root: null, ask }))).toEqual({ scope: 'document' });
    expect(ask).not.toHaveBeenCalled();
  });

  it('is this document, with a note, for a folder that is too broad', async () => {
    const reach = await decideReach(
      input({ root: { folder: '/Users/a', isRepo: false, tooBroad: true } }),
    );
    expect(reach).toEqual({ scope: 'document', note: TOO_BROAD });
  });

  it('is this document where Preferences say so, without asking', async () => {
    const ask = vi.fn();
    expect(await decideReach(input({ defaultScope: () => 'document', ask }))).toEqual({
      scope: 'document',
    });
    expect(ask).not.toHaveBeenCalled();
  });

  it('asks until the person allows something, and remembers it', async () => {
    const i = input();
    const ask = vi.spyOn(i, 'ask');
    expect(await decideReach(i)).toEqual({ scope: 'folder', folder: '/p' });
    expect(i.stored.get('claude:/p')).toBe('folder');
    await decideReach(i);
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it('asks again over a stored no, and does not remember a not now', async () => {
    const i = input({ ask: () => Promise.resolve(null) });
    i.stored.set('claude:/p', 'no');
    expect(await decideReach(i)).toBeNull();
    expect(i.stored.get('claude:/p')).toBe('no');
  });

  it('offers the home folder only where Preferences allow it and the caller can use it', async () => {
    const homes: boolean[] = [];
    const ask = async (_folder: string, home: boolean) => {
      homes.push(home);
      return Promise.resolve('folder' as const);
    };
    await decideReach(input({ defaultScope: () => 'everything', ask }));
    await decideReach(input({ defaultScope: () => 'everything', ask, home: false }));
    await decideReach(input({ defaultScope: () => 'folder', ask }));
    expect(homes).toEqual([true, false, false]);
  });

  it('holds a stored answer to what Preferences allow now', async () => {
    const i = input();
    i.stored.set('claude:/p', 'everything');
    expect(await decideReach(i)).toEqual({ scope: 'folder', folder: '/p' });
    i.stored.set('claude:/p', 'everything');
    expect(await decideReach({ ...i, defaultScope: () => 'everything' })).toEqual({
      scope: 'everything',
      folder: '/p',
    });
  });

  it('keeps an everything answer to the folder where the caller has no home folder', async () => {
    const i = input({ defaultScope: () => 'everything', home: false });
    i.stored.set('claude:/p', 'everything');
    expect(await decideReach(i)).toEqual({ scope: 'folder', folder: '/p' });
  });

  it('holds the answer to the setting as it is once the question is answered', async () => {
    let allowed: AgentScope = 'everything';
    const i = input({
      defaultScope: () => allowed,
      ask: () => {
        allowed = 'document';
        return Promise.resolve('everything' as const);
      },
    });
    expect(await decideReach(i)).toEqual({ scope: 'document' });
  });

  it('always asks a machine-wide agent, which has no this document', async () => {
    const ask = vi.fn(() => Promise.resolve('document' as const));
    const i = input({
      agent: { id: 'x', readLimit: 'machine' },
      defaultScope: () => 'document',
      ask,
    });
    i.stored.set('x:/p', 'document');
    await decideReach(i);
    expect(ask).toHaveBeenCalledWith('/p', false);
  });

  it('is null when the caller is over once the question is answered', async () => {
    let over = false;
    const i = input({
      over: () => over,
      ask: () => {
        over = true;
        return Promise.resolve('folder' as const);
      },
    });
    expect(await decideReach(i)).toBeNull();
    expect(i.stored.size).toBe(0);
  });

  it('tells the caller when the question is answered', async () => {
    const answered = vi.fn();
    await decideReach(input({ answered }));
    expect(answered).toHaveBeenCalledTimes(1);
  });
});
