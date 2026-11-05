// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { renderLiveLine, type LiveLineActions } from './live-line.ts';

function actions(): LiveLineActions & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    answer: vi.fn((answer) => calls.push(`answer ${answer}`)),
    stop: vi.fn(() => calls.push('stop')),
    dismiss: vi.fn(() => calls.push('dismiss')),
  };
}

const buttons = (el: HTMLElement) => [...el.querySelectorAll('button')];
const press = (el: HTMLElement, name: string) =>
  buttons(el)
    .find((button) => button.textContent === name)
    ?.click();

describe('renderLiveLine', () => {
  it('shows the agent and its status while it runs, with Stop', () => {
    const act = actions();
    const el = renderLiveLine(
      { kind: 'running', agent: 'claude', agentName: 'Claude', status: 'Reading tests' },
      act,
    );
    expect(el.textContent).toContain('Claude');
    expect(el.textContent).toContain('Reading tests');
    press(el, 'Stop');
    expect(act.calls).toEqual(['stop']);
  });

  it('asks whether the agent may read the folder, naming it', () => {
    const act = actions();
    const el = renderLiveLine(
      {
        kind: 'asking',
        agent: 'claude',
        agentName: 'Claude',
        folder: '/Users/ada/redlines',
        readLimit: 'folder',
      },
      act,
    );
    expect(el.textContent).toContain('Let Claude read this folder?');
    expect(el.textContent).toContain('redlines');
    expect(buttons(el).map((button) => button.textContent)).toEqual([
      'Allow',
      'Just this document',
      'Not now',
    ]);
    press(el, 'Allow');
    press(el, 'Just this document');
    press(el, 'Not now');
    expect(act.calls).toEqual(['answer folder', 'answer document', 'answer no']);
  });

  it('asks an agent that reads the whole machine about the machine, with no Just this document', () => {
    const el = renderLiveLine(
      { kind: 'asking', agent: 'x', agentName: 'X', folder: '/p', readLimit: 'machine' },
      actions(),
    );
    expect(el.textContent).toContain('Let it read files on this Mac?');
    expect(buttons(el).map((button) => button.textContent)).toEqual(['Allow', 'Not now']);
  });

  it('shows a failure in one line, which can be dismissed', () => {
    const act = actions();
    const el = renderLiveLine(
      {
        kind: 'failed',
        agent: 'claude',
        agentName: 'Claude',
        message: "Claude isn't signed in. Run `claude auth login`.",
      },
      act,
    );
    expect(el.textContent).toContain("Claude isn't signed in.");
    press(el, 'Dismiss');
    expect(act.calls).toEqual(['dismiss']);
  });
});
