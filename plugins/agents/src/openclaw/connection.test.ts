import { describe, expect, it } from 'vitest';
import { authorHandle, isSetUp, type OpenClawConnection } from './connection.ts';

describe('authorHandle', () => {
  it('joins the agent and the person, as the handles of the agents Redlines runs do', () => {
    expect(authorHandle('Moby', 'ada')).toBe('moby-ada');
    expect(authorHandle('Moby Dick', 'Ada L.')).toBe('moby-dick-ada-l');
  });

  it('is always a handle the app accepts: lowercase words, at most 40 characters', () => {
    for (const [name, owner] of [
      ['Ünïcode Name!!', 'ada'],
      ['', ''],
      ['x'.repeat(80), 'y'.repeat(80)],
      ['---', 'ada'],
      ['日本語', 'ada'],
    ] as const) {
      const handle = authorHandle(name, owner);
      expect(handle, `${name}/${owner}`).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(handle.length).toBeLessThanOrEqual(40);
    }
    expect(authorHandle('', '')).toBe('openclaw');
    expect(authorHandle('Ünïcode', 'ada')).toBe('unicode-ada');
  });
});

describe('isSetUp', () => {
  const base: OpenClawConnection = {
    handle: 'moby-ada',
    name: 'Moby',
    computer: 'studio-mini',
    url: 'wss://studio-mini.yak-bebop.ts.net',
    level: 'suggest',
    folders: [],
    created: 1,
    node_token: false,
    operator_token: false,
    device_key: false,
  };

  it('needs the node token and the device key', () => {
    expect(isSetUp(base)).toBe(false);
    expect(isSetUp({ ...base, node_token: true })).toBe(false);
    expect(isSetUp({ ...base, node_token: true, device_key: true })).toBe(true);
  });
});
