// @vitest-environment happy-dom
import type { ProjectRoot } from '@redlines/plugin-api';
import { describe, expect, it, vi } from 'vitest';
import { fakeProvider, fakeRelay, type FakeScript } from '../fake-provider.ts';
import { createMacAgents } from '../mac-agents.ts';
import { createChat } from './index.ts';
import { memoryStore, parseRecord, recordText } from './history.ts';
import { renderMarkdown } from './markdown.ts';

const REPO: ProjectRoot = { folder: '/repo', isRepo: true, tooBroad: false };

const answers = (text: string): FakeScript =>
  async function* ({ tools }) {
    await tools.initialize();
    await tools.call('view', {});
    yield { type: 'done', finalText: text };
  };

function setup(script: FakeScript = answers('It ships in April.'), notices: string[] = []) {
  const relay = fakeRelay();
  const claude = fakeProvider({
    relay,
    script,
    models: [
      { id: 'opus', name: 'Opus' },
      { id: 'sonnet', name: 'Sonnet' },
    ],
  });
  const store = memoryStore();
  const generation = { value: 1 };
  const chat = createChat({
    agents: createMacAgents([claude], relay),
    author: { handle: 'ada', name: 'Ada' },
    document: {
      path: () => '/repo/plan.md',
      generation: () => generation.value,
      read: () => 'Plan',
    },
    projectRoot: () => Promise.resolve(REPO),
    settings: { defaultScope: () => 'document', consent: () => undefined, setConsent: () => {} },
    store,
    notice: (message) => notices.push(message),
  });
  document.body.append(chat.el);
  return { chat, claude, store, generation };
}

const field = (chat: { el: HTMLElement }) => chat.el.querySelector('textarea')!;
const send = (chat: { el: HTMLElement }, text: string) => {
  field(chat).value = text;
  chat.el
    .querySelector('form')!
    .dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
};
const theirs = (chat: { el: HTMLElement }) => [...chat.el.querySelectorAll('.rl-chat-theirs')];

describe('a record', () => {
  it('reads what it wrote, and an empty chat from anything else', () => {
    const record = {
      version: 1 as const,
      agent: 'claude',
      model: 'opus',
      turns: [{ question: 'Q', answer: 'A', agent: { id: 'claude', name: 'Claude' }, at: 5 }],
    };
    expect(parseRecord(recordText(record))).toEqual(record);
    for (const bad of [null, '', 'not json', '[]', '{"version":2,"turns":[]}', '{"version":1}']) {
      expect(parseRecord(bad)).toEqual({ version: 1, turns: [] });
    }
  });

  it('drops a turn that is not one', () => {
    const text = JSON.stringify({
      version: 1,
      turns: [{ question: 1 }, null, { question: 'q', answer: 'a', agent: { id: 'x', name: 'X' } }],
    });
    expect(parseRecord(text).turns).toHaveLength(1);
  });
});

describe('the chat of a document', () => {
  it('answers, draws the answer as the agent’s message, and keeps it in the app’s data', async () => {
    const { chat, store } = setup();
    chat.follow('/repo/plan.md', 1, 'plan.md');
    await vi.waitFor(() => expect(chat.el.querySelector('.rl-chat-empty')).not.toBeNull());
    send(chat, 'When does it ship?');
    await vi.waitFor(() => expect(theirs(chat)).toHaveLength(1));
    expect(chat.el.querySelector('.rl-chat-bubble')?.textContent).toBe('When does it ship?');
    expect(theirs(chat)[0]?.textContent).toContain('It ships in April.');
    await vi.waitFor(() => expect(store.kept.has('/repo/plan.md')).toBe(true));
    expect(parseRecord(store.kept.get('/repo/plan.md') ?? null).turns[0]).toMatchObject({
      question: 'When does it ship?',
      answer: 'It ships in April.',
    });
  });

  it('is found again when the document comes back, and goes to the agent with the conversation', async () => {
    const { chat, claude } = setup();
    chat.follow('/repo/plan.md', 1, 'plan.md');
    await vi.waitFor(() => expect(chat.el.querySelector('.rl-chat-empty')).not.toBeNull());
    send(chat, 'When does it ship?');
    await vi.waitFor(() => expect(theirs(chat)).toHaveLength(1));
    // Another document takes the window, and then this one is opened again.
    chat.follow('/repo/other.md', 2, 'other.md');
    await vi.waitFor(() => expect(chat.el.querySelector('.rl-chat-empty')).not.toBeNull());
    chat.follow('/repo/plan.md', 3, 'plan.md');
    await vi.waitFor(() => expect(theirs(chat)).toHaveLength(1));
    send(chat, 'And the tests?');
    await vi.waitFor(() => expect(theirs(chat)).toHaveLength(2));
    const request = claude.requests.at(-1)!;
    expect(request.prompt).toContain('It ships in April.');
    expect(request.prompt).toContain('And the tests?');
    // A conversation's prompt, not a question about a selection.
    expect(request.systemPrompt).toContain('continuing conversation');
  });

  it('keeps one chat for each document', async () => {
    const { chat } = setup();
    chat.follow('/repo/plan.md', 1, 'plan.md');
    await vi.waitFor(() => expect(chat.el.querySelector('.rl-chat-empty')).not.toBeNull());
    send(chat, 'Q');
    await vi.waitFor(() => expect(theirs(chat)).toHaveLength(1));
    chat.follow('/repo/other.md', 2, 'other.md');
    await vi.waitFor(() => expect(chat.el.querySelector('.rl-chat-empty')).not.toBeNull());
    expect(theirs(chat)).toHaveLength(0);
  });

  it('goes with its document when Redlines renames it, and with a new document when it is saved', async () => {
    const { chat, store } = setup();
    chat.follow('/repo/plan.md', 1, 'plan.md');
    await vi.waitFor(() => expect(chat.el.querySelector('.rl-chat-empty')).not.toBeNull());
    send(chat, 'Q');
    await vi.waitFor(() => expect(store.kept.has('/repo/plan.md')).toBe(true));
    chat.follow('/repo/renamed.md', 1, 'renamed.md');
    await vi.waitFor(() => expect(store.kept.has('/repo/renamed.md')).toBe(true));
    expect(store.kept.has('/repo/plan.md')).toBe(false);
    expect(theirs(chat)).toHaveLength(1);
  });

  it('keeps nothing for a document with no file until it is saved', async () => {
    const { chat, store } = setup();
    chat.follow(null, 1, 'Untitled');
    await vi.waitFor(() => expect(chat.el.querySelector('.rl-chat-empty')).not.toBeNull());
    send(chat, 'Q');
    await vi.waitFor(() => expect(theirs(chat)).toHaveLength(1));
    expect(store.kept.size).toBe(0);
    chat.follow('/repo/new.md', 1, 'new.md');
    await vi.waitFor(() => expect(store.kept.has('/repo/new.md')).toBe(true));
  });

  it('lists the agent and its models in the picker, and keeps the pick with the chat', async () => {
    const { chat, claude, store } = setup();
    chat.follow('/repo/plan.md', 1, 'plan.md');
    await vi.waitFor(() =>
      expect(chat.el.querySelector('.rl-chat-who-name')?.textContent).toBe('Claude'),
    );
    chat.el.querySelector<HTMLElement>('.rl-chat-who')!.click();
    const names = () =>
      [...chat.el.querySelectorAll('.rl-chat-item-name')].map((e) => e.textContent);
    // The agent's models open under it.
    expect(names()).toEqual(['Claude', 'Default', 'Opus', 'Sonnet']);
    [...chat.el.querySelectorAll<HTMLElement>('.rl-chat-sub')][2]!.click();
    expect(chat.el.querySelector('.rl-chat-who-model')?.textContent).toBe('· Sonnet');
    send(chat, 'Q');
    await vi.waitFor(() => expect(theirs(chat)).toHaveLength(1));
    expect(claude.requests.at(-1)?.model).toBe('sonnet');
    expect(parseRecord(store.kept.get('/repo/plan.md') ?? null)).toMatchObject({
      agent: 'claude',
      model: 'sonnet',
    });
  });

  it('shows a failure on the live line, and keeps the message as one that got no answer', async () => {
    const { chat, store, claude } = setup(async function* () {
      await Promise.resolve();
      yield { type: 'error', message: 'Claude stopped.' } as const;
    });
    chat.follow('/repo/plan.md', 1, 'plan.md');
    await vi.waitFor(() => expect(chat.el.querySelector('.rl-chat-empty')).not.toBeNull());
    send(chat, 'What is the plan?');
    await vi.waitFor(() =>
      expect(chat.el.querySelector('.rl-chat-live')?.textContent).toContain('Claude stopped.'),
    );
    // The words the person wrote are still in the column, and in the history.
    expect(chat.el.querySelector('.rl-chat-bubble')?.textContent).toBe('What is the plan?');
    expect(chat.el.querySelector('.rl-chat-ended')?.textContent).toBe(
      'Couldn’t answer: Claude stopped.',
    );
    await vi.waitFor(() => expect(store.kept.has('/repo/plan.md')).toBe(true));
    expect(parseRecord(store.kept.get('/repo/plan.md') ?? null).turns).toMatchObject([
      { question: 'What is the plan?', answer: 'Claude stopped.', ended: 'failed' },
    ]);
    // It is never sent to an agent as an answer.
    expect(claude.requests).toHaveLength(1);
  });

  it('keeps a message that was stopped, as Stopped, and does not quote it to the agent', async () => {
    const { chat, store, claude } = setup(async function* ({ tools }) {
      await tools.initialize();
      // Never answers: the person stops it.
      await new Promise(() => {});
      yield { type: 'done', finalText: 'never' } as const;
    });
    chat.follow('/repo/plan.md', 1, 'plan.md');
    await vi.waitFor(() => expect(chat.el.querySelector('.rl-chat-empty')).not.toBeNull());
    send(chat, 'A long question');
    await vi.waitFor(() => expect(claude.requests).toHaveLength(1));
    chat.el.querySelector<HTMLElement>('.rl-chat-send')!.click();
    await vi.waitFor(() =>
      expect(chat.el.querySelector('.rl-chat-ended')?.textContent).toBe('Stopped.'),
    );
    expect(chat.el.querySelector('.rl-chat-bubble')?.textContent).toBe('A long question');
    await vi.waitFor(() =>
      expect(parseRecord(store.kept.get('/repo/plan.md') ?? null).turns).toMatchObject([
        { question: 'A long question', answer: 'Stopped.', ended: 'stopped' },
      ]),
    );
  });

  it('does not send on the Return that confirms an input method’s candidate', async () => {
    const { chat, claude } = setup();
    chat.follow('/repo/plan.md', 1, 'plan.md');
    await vi.waitFor(() => expect(chat.el.querySelector('.rl-chat-empty')).not.toBeNull());
    field(chat).value = 'に';
    const confirm = new KeyboardEvent('keydown', { key: 'Enter', keyCode: 229, cancelable: true });
    field(chat).dispatchEvent(confirm);
    expect(claude.requests).toHaveLength(0);
    expect(field(chat).value).toBe('に');
    // A plain Return sends.
    field(chat).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
    await vi.waitFor(() => expect(claude.requests).toHaveLength(1));
  });

  it('keeps a history it can not read aside, says so, and starts a new chat', async () => {
    const notices: string[] = [];
    const { chat, store } = setup(undefined, notices);
    await store.write('/repo/plan.md', '{"version":1,"turns":[');
    chat.follow('/repo/plan.md', 1, 'plan.md');
    await vi.waitFor(() => expect(chat.el.querySelector('.rl-chat-empty')).not.toBeNull());
    expect(store.kept.get('/repo/plan.md#unreadable')).toBe('{"version":1,"turns":[');
    expect(notices).toEqual(['This chat’s history couldn’t be read, so the chat starts anew.']);
    send(chat, 'Q');
    await vi.waitFor(() => expect(theirs(chat)).toHaveLength(1));
    // The old text is still there, beside the new chat.
    expect(store.kept.get('/repo/plan.md#unreadable')).toBe('{"version":1,"turns":[');
  });
});

describe('a message in Markdown', () => {
  const html = (text: string) => renderMarkdown(text).innerHTML;

  it('draws headings, lists, code and emphasis, and shows no mark', () => {
    const out = html(
      '## Plan\n\nIt is **late**, _very_ late, see `x`.\n\n- one\n- two\n\n1. a\n2. b\n\n```\ncode here\n```',
    );
    expect(out).toContain('rl-chat-h');
    expect(out).toContain('<strong>late</strong>');
    expect(out).toContain('<em>very</em>');
    expect(out).toContain('<code>x</code>');
    expect(out).toContain('<ul><li>one</li><li>two</li></ul>');
    expect(out).toContain('<ol><li>a</li><li>b</li></ol>');
    expect(out).toContain('<pre><code>code here</code></pre>');
    for (const raw of ['##', '**', '```']) expect(out).not.toContain(raw);
  });

  it('never makes markup of the agent’s words', () => {
    const out = html('<img src=x onerror=alert(1)> <script>x</script>');
    expect(out).not.toContain('<img');
    expect(out).not.toContain('<script');
  });

  it('shows a link’s real address on hover, so that its words can’t hide where it goes', () => {
    const root = renderMarkdown('[https://apple.com](https://evil.example/x)', {
      openLink: () => {},
    });
    expect(root.querySelector('a')?.title).toBe('https://evil.example/x');
  });

  it('links only a web address, and only through the host', () => {
    const open = vi.fn();
    const root = renderMarkdown('[a](https://x.org) [b](javascript:alert(1))', { openLink: open });
    const links = root.querySelectorAll('a');
    expect(links).toHaveLength(1);
    links[0]!.click();
    expect(open).toHaveBeenCalledWith('https://x.org');
    expect(root.textContent).toContain('[b](javascript:alert(1))');
  });
});
