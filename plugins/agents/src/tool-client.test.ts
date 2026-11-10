import { answerMcp } from '@redlines/agent-tools';
import type { ToolContext } from '@redlines/agent-tools';
import { describe, expect, it } from 'vitest';
import { toolClient } from './tool-client.ts';

describe('toolClient', () => {
  it('stands on its own over the toolbox, with no relay', async () => {
    let text = 'One.\n';
    const ctx: ToolContext = {
      doc: {
        read: () => text,
        write: (next) => {
          text = next;
        },
      },
      author: { handle: 'claude-ada', name: 'Claude', agent: true, for: 'ada' },
      thread: '',
      now: () => new Date('2026-11-05T10:30:45.000Z'),
      requestedBy: 'ada',
      onStatus: () => {},
      onReply: () => {},
    };
    const client = toolClient(answerMcp(ctx));
    await client.initialize();
    const viewed = await client.call('view');
    expect(viewed.isError).toBe(false);
    expect(viewed.text).toContain('One.');
    expect((await client.call('nope')).isError).toBe(true);
  });
});
