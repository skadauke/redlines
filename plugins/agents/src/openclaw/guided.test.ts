// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OpenClawConnection } from './connection.ts';
import { renderGuided, type GuidedDeps } from './guided.ts';

const moby: OpenClawConnection = {
  handle: 'moby-ada',
  name: 'Moby',
  computer: 'studio-mini',
  url: 'wss://studio-mini.yak-bebop.ts.net',
  level: 'suggest',
  folders: [],
  created: 1,
  node_token: true,
  operator_token: true,
  device_key: true,
};

function deps(list: () => OpenClawConnection[], openSetup: () => void): GuidedDeps {
  return {
    connections: {
      list: () => Promise.resolve(list()),
      change: () => Promise.resolve(list()),
      remove: () => Promise.resolve(list()),
    },
    node: {
      connect: () => Promise.resolve(),
      status: () => Promise.resolve({ state: 'connected', tools: 6 }),
      stop: () => Promise.resolve(),
    },
    chooseFolder: () => Promise.resolve(null),
    openSetup,
  };
}

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('the OpenClaw agents of Preferences › Agents', () => {
  it('opens the setup in its own window, and draws no setup sheet in the pane', () => {
    const open = vi.fn();
    const root = renderGuided(
      deps(() => [], open),
      { alive: () => true },
    );
    document.body.append(root);
    const connect = [...root.querySelectorAll('button')].find(
      (button) => button.textContent === 'Connect OpenClaw…',
    );
    connect?.click();
    expect(open).toHaveBeenCalledTimes(1);
    expect(root.querySelector('.rl-oc-sheet')).toBeNull();
    expect(connect?.hidden).toBe(false);
  });

  it('shows what the setup window made as it is made, with no connection before it', async () => {
    vi.useFakeTimers();
    let list: OpenClawConnection[] = [];
    const root = renderGuided(
      deps(() => list, vi.fn()),
      { alive: () => true },
    );
    document.body.append(root);
    await vi.advanceTimersByTimeAsync(10);
    expect(root.querySelector('.rl-oc-card')).toBeNull();
    // Another window adds a connection: the pane looks again by itself.
    list = [moby];
    await vi.advanceTimersByTimeAsync(3500);
    expect(root.querySelector('.rl-oc-card')?.getAttribute('data-agent')).toBe('moby-ada');
  });

  it('says so when the window can’t be opened', () => {
    const root = renderGuided(
      deps(
        () => [],
        () => {
          throw new Error('The setup window couldn’t open.');
        },
      ),
      { alive: () => true },
    );
    document.body.append(root);
    [...root.querySelectorAll('button')]
      .find((button) => button.textContent === 'Connect OpenClaw…')
      ?.click();
    expect(root.textContent).toContain('The setup window couldn’t open.');
  });
});
