import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  definePlugin,
  type AgentEvent,
  type AgentInfo,
  type AgentProvider,
  type AgentState,
  type Host,
  type HostAgents,
  type HostFiles,
  type HostProcesses,
  type HostRelay,
  type Plugin,
  type ProjectRoot,
  type SettingContribution,
  type ToolLines,
} from './index';

describe('the plugin API', () => {
  it('lets a plugin be written against it', () => {
    const plugin = definePlugin<Plugin>({
      manifest: {
        id: 'test.agents',
        name: 'Agents',
        version: '0.0.0',
        needs: ['agents'],
        contributes: {
          settings: [{ id: 'on', title: 'On', default: true, pane: 'agents' }],
        },
      },
      activate: (context) => {
        context.notice(`hello ${context.author.name}`);
        return () => {};
      },
    });
    expect(plugin.manifest.contributes?.settings?.[0]?.pane).toBe('agents');
  });

  it('types the agent surface', async () => {
    const state: AgentState = {
      found: true,
      signedIn: false,
      reason: 'signed-out',
      help: 'Sign in',
    };
    const provider: AgentProvider = {
      id: 'claude',
      name: 'Claude',
      readLimit: 'folder',
      detect: () => Promise.resolve(state),
      async *run() {
        await Promise.resolve();
        yield { type: 'status', text: 'reading' } satisfies AgentEvent;
        yield { type: 'done' } satisfies AgentEvent;
      },
    };
    const events: AgentEvent[] = [];
    const tools: ToolLines = () => Promise.resolve(null);
    for await (const event of provider.run(
      {
        prompt: 'p',
        systemPrompt: 's',
        thread: 't',
        scope: 'document',
        author: { handle: 'claude-ada', name: 'Claude', for: 'ada' },
      },
      { command: 'x', args: [] },
      new AbortController().signal,
    ))
      events.push(event);
    expect(events.map((event) => event.type)).toEqual(['status', 'done']);
    expectTypeOf(tools).toEqualTypeOf<ToolLines>();
    expectTypeOf<AgentInfo['state']>().toEqualTypeOf<AgentState>();
  });

  it('adds processes, a relay and project folders to the host', () => {
    expectTypeOf<Host['processes']>().toEqualTypeOf<HostProcesses | undefined>();
    expectTypeOf<Host['relay']>().toEqualTypeOf<HostRelay | undefined>();
    expectTypeOf<HostFiles['list']>().parameters.toEqualTypeOf<[folder: string]>();
    expectTypeOf<HostFiles['exists']>().returns.toEqualTypeOf<Promise<boolean>>();
    expectTypeOf<HostFiles['projectRoot']>().returns.toEqualTypeOf<Promise<ProjectRoot>>();
    expectTypeOf<HostAgents['list']>().returns.toEqualTypeOf<Promise<AgentInfo[]>>();
    expectTypeOf<SettingContribution['pane']>().toEqualTypeOf<
      'general' | 'appearance' | 'editor' | 'agents'
    >();
    expect('ask' in ({} as HostAgents)).toBe(false);
  });
});
