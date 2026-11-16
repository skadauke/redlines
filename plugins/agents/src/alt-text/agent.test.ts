// The request an Alt Text bubble sends an agent (#553): who is asked, what the agent is given (one
// picture, no document, no files), and what comes back.
import type { ImageBytes } from '@redlines/agent-tools';
import type { AgentInfo, AgentRequest } from '@redlines/plugin-api';
import { describe, expect, it } from 'vitest';
import { fakeProvider, fakeRelay, type FakeScript, type FakeProvider } from '../fake-provider.ts';
import { createMacAgents } from '../mac-agents.ts';
import { chooseWriter, cleanedAlt, createAltDescriber } from './agent.ts';

const PICTURE: ImageBytes = { mimeType: 'image/png', data: 'iVBORw0KGgo=' };
const info = (over: Partial<AgentInfo> & { id: string }): AgentInfo => ({
  name: over.id,
  readLimit: 'folder',
  state: { found: true, signedIn: true },
  ...over,
});

function setup(
  script: FakeScript,
  options: {
    others?: FakeProvider[];
    seesImages?: boolean;
    readImage?: (src: string) => Promise<ImageBytes>;
    generation?: { value: number };
    defaultAgent?: string;
  } = {},
) {
  const relay = fakeRelay();
  const claude = fakeProvider({ relay, script, seesImages: options.seesImages ?? true });
  const agents = createMacAgents([claude, ...(options.others ?? [])], relay);
  const read: string[] = [];
  const generation = options.generation ?? { value: 0 };
  const describer = createAltDescriber({
    agents,
    author: { handle: 'ada', name: 'Ada' },
    document: { path: () => '/notes/plan.md', generation: () => generation.value },
    ...(options.defaultAgent ? { defaultAgent: () => options.defaultAgent } : {}),
    readImage: (src) => {
      read.push(src);
      return options.readImage ? options.readImage(src) : Promise.resolve(PICTURE);
    },
  });
  return { describer, claude, read, generation };
}

const IMAGE = { src: 'img/red.png', alt: 'old' };
const answers = (text: string): FakeScript =>
  async function* ({ tools }) {
    await tools.initialize();
    yield { type: 'done', finalText: text };
  };

describe('who writes it', () => {
  it('is the default agent by its display name when it can look at pictures', async () => {
    const { describer } = setup(answers('x'));
    expect(await describer.who()).toEqual({ name: 'Claude' });
  });

  it('is another agent that can, when the default one can’t, and says it can’t when none can', () => {
    const claude = info({ id: 'claude', name: 'Claude', seesImages: true });
    const codex = info({ id: 'codex', name: 'Codex' });
    expect(chooseWriter([codex, claude], 'codex')).toEqual({ agent: claude });
    expect(chooseWriter([codex], 'codex')).toEqual({
      agent: codex,
      unavailable: 'Codex can’t look at pictures here.',
    });
    expect(chooseWriter([], undefined)).toBeNull();
    // An agent with no toolbox is never asked.
    expect(chooseWriter([info({ id: 'oc', name: 'Moby', toolbox: false })], 'oc')).toBeNull();
  });

  it('says so for an agent that is signed out, or that reads the whole Mac', () => {
    const out = info({
      id: 'claude',
      name: 'Claude',
      seesImages: true,
      state: { found: true, signedIn: false, reason: 'signed-out', help: 'Run claude to sign in.' },
    });
    expect(chooseWriter([out], 'claude')?.unavailable).toBe(
      'Claude isn’t signed in. Run claude to sign in.',
    );
    const wide = info({ id: 'claude', name: 'Claude', seesImages: true, readLimit: 'machine' });
    expect(chooseWriter([wide], 'claude')?.unavailable).toMatch(/can read more than this image/);
  });
});

describe('the request', () => {
  it('is shown the one picture, reads nothing else, and is held to document scope', async () => {
    const seen: Record<string, unknown> = {};
    const script: FakeScript = async function* ({ tools, request }) {
      seen['request'] = request;
      await tools.initialize();
      const listed = await tools.send(
        JSON.stringify({ jsonrpc: '2.0', id: 90, method: 'tools/list' }),
      );
      seen['tools'] = (
        JSON.parse(listed ?? '{}') as { result: { tools: { name: string }[] } }
      ).result.tools.map((tool) => tool.name);
      seen['picture'] = await tools.call('view_image', { path: '/etc/passwd' });
      seen['view'] = await tools.call('view', {});
      seen['write'] = await tools.call('str_replace', { old_str: 'a', new_str: 'b' });
      yield { type: 'done', finalText: 'A flat red square.' };
    };
    const { describer, read } = setup(script);
    const text = await describer.describe(IMAGE, new AbortController().signal);
    expect(text).toBe('A flat red square.');
    // The host read the file named as the document writes it, once, before the agent started.
    expect(read).toEqual(['img/red.png']);
    expect(seen['tools']).toEqual(['status', 'view_image']);
    expect(seen['picture']).toMatchObject({ isError: false, image: PICTURE });
    expect(seen['view']).toMatchObject({ isError: true });
    expect(seen['write']).toMatchObject({ isError: true });
    const request = seen['request'] as AgentRequest;
    expect(request.scope).toBe('document');
    expect(request.folder).toBeUndefined();
    expect(request.systemPrompt).toContain('plan.md');
    expect(request.systemPrompt).toContain('> old');
    expect(request.author).toEqual({ handle: 'claude-ada', name: 'Claude', for: 'ada' });
  });

  it('writes nothing, whatever the agent does', async () => {
    const { describer } = setup(answers('Fine.'));
    expect(await describer.describe(IMAGE, new AbortController().signal)).toBe('Fine.');
  });

  it('is not run when the picture can’t be read, and says why', async () => {
    const { describer, claude } = setup(answers('x'), {
      readImage: () => Promise.reject(new Error('That image is larger than 5 MB.')),
    });
    await expect(describer.describe(IMAGE, new AbortController().signal)).rejects.toThrow(
      'That image is larger than 5 MB.',
    );
    expect(claude.requests).toHaveLength(0);
  });

  it('says why when the agent fails, or ends with nothing', async () => {
    const failing: FakeScript = async function* () {
      await Promise.resolve();
      yield { type: 'error', message: 'Claude isn’t signed in.' };
    };
    await expect(
      setup(failing).describer.describe(IMAGE, new AbortController().signal),
    ).rejects.toThrow('Claude isn’t signed in.');
    await expect(
      setup(answers('   ')).describer.describe(IMAGE, new AbortController().signal),
    ).rejects.toThrow('Claude ended with nothing to say.');
  });

  it('refuses an agent that can’t look at pictures, without running it', async () => {
    const { describer, claude } = setup(answers('x'), { seesImages: false });
    expect(await describer.who()).toEqual({
      name: 'Claude',
      unavailable: 'Claude can’t look at pictures here.',
    });
    await expect(describer.describe(IMAGE, new AbortController().signal)).rejects.toThrow(
      'Claude can’t look at pictures here.',
    );
    expect(claude.requests).toHaveLength(0);
  });

  it('refuses the agent’s tool calls once the document is another', async () => {
    const generation = { value: 0 };
    const script: FakeScript = async function* ({ tools }) {
      await tools.initialize();
      generation.value++;
      const late = await tools.call('view_image');
      yield { type: 'done', finalText: late.isError ? 'refused' : 'seen' };
    };
    const { describer } = setup(script, { generation });
    expect(await describer.describe(IMAGE, new AbortController().signal)).toBe('refused');
  });
});

describe('what comes back', () => {
  it('is one line without the quotation marks or label an agent puts round it', () => {
    expect(cleanedAlt('  "A red\nsquare." ')).toBe('A red square.');
    expect(cleanedAlt('Alt text: A cat')).toBe('A cat');
    expect(cleanedAlt('“A cat”')).toBe('A cat');
    expect(cleanedAlt("It's a cat")).toBe("It's a cat");
  });
});
