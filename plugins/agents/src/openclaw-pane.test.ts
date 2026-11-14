// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isLocalGateway,
  openClawAgents,
  openClawCommand,
  renderOpenClaw,
  type OpenClawAgent,
  type OpenClawDeps,
  type OpenClawInput,
} from './openclaw-pane.ts';
import type { SkillInstalled, SkillState } from './skill-controls.ts';

afterEach(() => document.body.replaceChildren());

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const moby: OpenClawAgent = {
  id: 'moby',
  name: 'Moby',
  url: 'wss://gateway.example.org',
  tokenFile: '/Users/ada/.moby-token',
  agent: 'moby',
};
const local: OpenClawAgent = {
  id: 'rex',
  name: 'Rex',
  url: 'ws://127.0.0.1:18789',
  tokenFile: '/Users/ada/.rex-token',
};

function setup(start: OpenClawAgent[] = [], extra: Partial<OpenClawDeps> = {}) {
  let list = start;
  const add = vi.fn<(input: OpenClawInput) => Promise<OpenClawAgent[]>>((input) => {
    list = [
      ...list,
      {
        id: input.name.toLowerCase(),
        name: input.name,
        url: input.url,
        tokenFile: input.tokenFile,
        ...(input.agent === undefined ? {} : { agent: input.agent }),
      },
    ];
    return Promise.resolve(list);
  });
  const remove = vi.fn<(id: string) => Promise<OpenClawAgent[]>>((id) => {
    list = list.filter((agent) => agent.id !== id);
    return Promise.resolve(list);
  });
  const deps: OpenClawDeps = {
    list: () => Promise.resolve(list),
    add,
    remove,
    ...extra,
  };
  let alive = true;
  const showGeneral = vi.fn();
  const forgetAnswers = vi.fn<(id: string) => void>();
  const section = renderOpenClaw(deps, { alive: () => alive, showGeneral, forgetAnswers });
  document.body.append(section);
  return { section, add, remove, showGeneral, forgetAnswers, stop: () => (alive = false) };
}

const buttons = (section: HTMLElement) =>
  [...section.querySelectorAll('button')].map((button) => button.textContent);
const press = (section: HTMLElement, text: string) => {
  const found = [...section.querySelectorAll('button')].find(
    (button) => button.textContent === text,
  );
  if (!found) throw new Error(`no button ${text}`);
  found.click();
};
const field = (section: HTMLElement, label: string) =>
  section.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
const type = (input: HTMLInputElement, value: string) => {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

describe('the OpenClaw section', () => {
  it('lists each agent with its Gateway, its token file’s path and its agent', async () => {
    const { section } = setup([moby, local]);
    await settle();
    expect(section.dataset['row']).toBe('OpenClaw');
    const items = [...section.querySelectorAll('.rl-pref-item')].map((item) => item.textContent);
    expect(items[0]).toContain('Moby');
    expect(items[0]).toContain('wss://gateway.example.org');
    expect(items[0]).toContain('/Users/ada/.moby-token');
    expect(items[0]).toContain('OpenClaw agent: moby');
    expect(items[1]).toContain('Rex');
    expect(items[1]).not.toContain('OpenClaw agent');
    expect(buttons(section)).toEqual(['Remove', 'Remove', 'Add OpenClaw Agent…']);
  });

  it('says what an OpenClaw agent is sent, that it changes nothing, and that the token is never read', async () => {
    const { section } = setup();
    await settle();
    const text = section.textContent ?? '';
    expect(text).toContain(
      'the document and that comment thread go to the Gateway, wherever it runs',
    );
    expect(text).toContain('posted as a reply');
    expect(text).toContain('It can’t change the document');
    expect(text).toContain('never reads the file');
    expect(text).toContain('installed on this Mac');
  });

  it('adds an agent from its name, its Gateway and its token file, once all three are given', async () => {
    const { section, add } = setup();
    await settle();
    press(section, 'Add OpenClaw Agent…');
    expect(buttons(section)).toEqual(['Add', 'Cancel']);
    const addButton = () =>
      [...section.querySelectorAll('button')].find((b) => b.textContent === 'Add')!;
    expect(addButton().disabled).toBe(true);
    type(field(section, 'Name'), '  Moby ');
    type(field(section, 'Gateway address'), 'wss://gateway.example.org');
    expect(addButton().disabled).toBe(true);
    type(field(section, 'Token file'), '/Users/ada/.moby-token');
    expect(addButton().disabled).toBe(false);
    addButton().click();
    await settle();
    // Trimmed, with no agent where none was named.
    expect(add).toHaveBeenCalledWith({
      name: 'Moby',
      url: 'wss://gateway.example.org',
      tokenFile: '/Users/ada/.moby-token',
    });
    expect(add.mock.calls[0]?.[0]).not.toHaveProperty('agent');
    // The form closes and the list has it.
    expect(section.querySelector('input')).toBeNull();
    expect(section.querySelector('.rl-pref-item')?.textContent).toContain('Moby');
  });

  it('passes the agent the person names in OpenClaw', async () => {
    const { section, add } = setup();
    await settle();
    press(section, 'Add OpenClaw Agent…');
    type(field(section, 'Name'), 'Moby');
    type(field(section, 'Gateway address'), 'ws://127.0.0.1:18789');
    type(field(section, 'Token file'), '/Users/ada/.moby-token');
    type(field(section, 'OpenClaw agent'), 'moby');
    press(section, 'Add');
    await settle();
    expect(add).toHaveBeenCalledWith({
      name: 'Moby',
      url: 'ws://127.0.0.1:18789',
      tokenFile: '/Users/ada/.moby-token',
      agent: 'moby',
    });
  });

  it('says why an agent wasn’t added, and keeps what was typed to try again', async () => {
    const { section, add } = setup();
    await settle();
    add.mockImplementationOnce(() => Promise.reject(new Error('There is no token file at /x.')));
    press(section, 'Add OpenClaw Agent…');
    type(field(section, 'Name'), 'Moby');
    type(field(section, 'Gateway address'), 'wss://gateway.example.org');
    type(field(section, 'Token file'), '/x');
    press(section, 'Add');
    await settle();
    expect(section.textContent).toContain('There is no token file at /x.');
    expect(field(section, 'Token file').value).toBe('/x');
    // Add is ready again, and a second go goes through; the failure is gone.
    expect(
      [...section.querySelectorAll('button')].find((b) => b.textContent === 'Add')!.disabled,
    ).toBe(false);
    press(section, 'Add');
    await settle();
    expect(section.textContent).not.toContain('There is no token file');
    expect(section.querySelector('.rl-pref-item')?.textContent).toContain('Moby');
  });

  it('says so when the host can’t even try', async () => {
    const { section, add } = setup();
    await settle();
    add.mockImplementationOnce(() => {
      throw new Error('Not in the app.');
    });
    press(section, 'Add OpenClaw Agent…');
    type(field(section, 'Name'), 'Moby');
    type(field(section, 'Gateway address'), 'wss://g');
    type(field(section, 'Token file'), '/x');
    press(section, 'Add');
    await settle();
    expect(section.textContent).toContain('Not in the app.');
  });

  it('keeps the focus in the section when the button that had it goes', async () => {
    const { section } = setup([moby, local]);
    await settle();
    const focused = () => document.activeElement?.textContent;
    const pressed = (text: string, label?: string) => {
      const found = [...section.querySelectorAll('button')].find(
        (button) =>
          button.textContent === text &&
          (label === undefined || button.getAttribute('aria-label') === label),
      );
      found?.focus();
      found?.click();
    };
    // Remove: the next agent's Remove, and the Add button once none is left.
    pressed('Remove', 'Remove Moby');
    await settle();
    expect(section.contains(document.activeElement)).toBe(true);
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Remove Rex');
    pressed('Remove', 'Remove Rex');
    await settle();
    expect(focused()).toBe('Add OpenClaw Agent…');
    // Cancel, and Add: the button that opens the form.
    pressed('Add OpenClaw Agent…');
    pressed('Cancel');
    expect(focused()).toBe('Add OpenClaw Agent…');
    pressed('Add OpenClaw Agent…');
    type(field(section, 'Name'), 'Moby');
    type(field(section, 'Gateway address'), 'wss://gateway.example.org');
    type(field(section, 'Token file'), '/Users/ada/.moby-token');
    pressed('Add');
    await settle();
    expect(focused()).toBe('Add OpenClaw Agent…');
  });

  it('hands the id of a removed agent over, so that what it was allowed goes with it', async () => {
    const { section, remove, forgetAnswers } = setup([moby, local]);
    await settle();
    press(section, 'Remove');
    await settle();
    expect(remove).toHaveBeenCalledWith('moby');
    expect(forgetAnswers).toHaveBeenCalledExactlyOnceWith('moby');
  });

  it('forgets nothing of an agent that is still there, because the host said no', async () => {
    const { section, remove, forgetAnswers } = setup([moby]);
    await settle();
    remove.mockImplementationOnce(() => Promise.reject(new Error('Not now.')));
    press(section, 'Remove');
    await settle();
    expect(section.textContent).toContain('Not now.');
    expect(forgetAnswers).not.toHaveBeenCalled();
    expect(section.querySelector('.rl-pref-item')?.textContent).toContain('Moby');
  });

  it('cancels adding, and removes an agent', async () => {
    const { section, remove } = setup([moby]);
    await settle();
    press(section, 'Add OpenClaw Agent…');
    press(section, 'Cancel');
    expect(section.querySelector('input')).toBeNull();
    expect(buttons(section)).toEqual(['Remove', 'Add OpenClaw Agent…']);
    press(section, 'Remove');
    await settle();
    expect(remove).toHaveBeenCalledWith('moby');
    expect(section.querySelector('.rl-pref-item')).toBeNull();
    expect(section.querySelector('[aria-label="Remove Moby"]')).toBeNull();
  });

  it('draws nothing late once it is tidied up', async () => {
    const { section, stop } = setup([moby]);
    stop();
    await settle();
    expect(section.querySelector('.rl-pref-item')).toBeNull();
  });

  it('says so when it can’t list the agents', async () => {
    const section = renderOpenClaw(
      { list: () => Promise.reject(new Error('no app')), add: vi.fn(), remove: vi.fn() },
      { alive: () => true },
    );
    document.body.append(section);
    await settle();
    expect(section.textContent).toContain('Couldn’t list the OpenClaw agents: no app');
  });
});

describe('the OpenClaw skill', () => {
  const folder = '~/.openclaw/skills/redlines';
  const missing: SkillState = { folder, state: 'missing', message: null };
  const installed: SkillInstalled = { folder, commandLine: { found: 'onPath' } };
  const host = () => ({
    status: vi.fn<() => Promise<SkillState>>(() => Promise.resolve(missing)),
    install: vi.fn<() => Promise<SkillInstalled>>(() => Promise.resolve(installed)),
  });

  it('is offered for a Gateway on this Mac, and installs in OpenClaw’s own folder', async () => {
    const skill = host();
    const { section } = setup([local], { skill });
    await settle();
    expect(section.textContent).toContain('Redlines skill: not installed.');
    // An address on this Mac may be the end of a tunnel, and the note says what the skill is for.
    expect(section.textContent).toContain('The skill is for an OpenClaw that runs on this Mac.');
    expect(section.textContent).toContain('tunnel at 127.0.0.1');
    press(section, 'Install Skill');
    await settle();
    expect(skill.install).toHaveBeenCalledTimes(1);
    expect(section.textContent).toContain(
      'Redlines skill installed in ~/.openclaw/skills/redlines.',
    );
  });

  it('is not offered where every Gateway is on another machine, which reads that machine’s folders', async () => {
    const skill = host();
    const { section } = setup([moby], { skill });
    await settle();
    expect(skill.status).not.toHaveBeenCalled();
    expect(section.textContent).not.toContain('skill');
    expect(buttons(section)).not.toContain('Install Skill');
  });

  it('comes and goes with the agents on this Mac', async () => {
    const skill = host();
    const { section } = setup([], { skill });
    await settle();
    expect(buttons(section)).not.toContain('Install Skill');
    press(section, 'Add OpenClaw Agent…');
    type(field(section, 'Name'), 'Rex');
    type(field(section, 'Gateway address'), 'ws://localhost:18789');
    type(field(section, 'Token file'), '/Users/ada/.rex-token');
    press(section, 'Add');
    await settle();
    expect(buttons(section)).toContain('Install Skill');
    press(section, 'Remove');
    await settle();
    expect(buttons(section)).not.toContain('Install Skill');
  });
});

describe('an OpenClaw Gateway on this Mac', () => {
  it('is one whose host is the machine’s own, and no other', () => {
    for (const url of [
      'ws://127.0.0.1:18789',
      'ws://localhost:18789',
      'ws://LOCALHOST',
      'ws://[::1]:18789',
      'wss://localhost/gateway',
    ]) {
      expect(isLocalGateway(url), url).toBe(true);
    }
    for (const url of [
      'wss://gateway.example.org',
      'ws://192.168.1.20:18789',
      'ws://127.0.0.1.example.org',
      'ws://localhost.example.org',
      'ws://example.org/127.0.0.1',
      'ws://user@127.0.0.1',
      '',
      'localhost',
    ]) {
      expect(isLocalGateway(url), url).toBe(false);
    }
  });
});

describe('the command that adds one', () => {
  it('is openclaw acp with the Gateway and the token file, in that order, and the agent after them', () => {
    expect(
      openClawCommand({
        name: 'Moby',
        url: 'wss://gateway.example.org',
        tokenFile: '/Users/ada/.moby-token',
      }),
    ).toBe('openclaw acp --url wss://gateway.example.org --token-file /Users/ada/.moby-token');
    expect(
      openClawCommand({
        name: 'Moby',
        url: ' ws://127.0.0.1:18789 ',
        tokenFile: '/Users/ada/.moby-token',
        agent: ' moby ',
      }),
    ).toBe(
      'openclaw acp --url ws://127.0.0.1:18789 --token-file /Users/ada/.moby-token --session agent:moby:main',
    );
    // An empty agent is no agent.
    expect(
      openClawCommand({ name: 'M', url: 'wss://g', tokenFile: '/t', agent: '  ' }),
    ).not.toContain('--session');
  });

  it('quotes a path with a space, as the host reads it, and never puts a token on the line', () => {
    const command = openClawCommand({
      name: 'Moby',
      url: 'wss://gateway.example.org',
      tokenFile: '/Users/ada/My Tokens/moby token',
    });
    expect(command).toBe(
      "openclaw acp --url wss://gateway.example.org --token-file '/Users/ada/My Tokens/moby token'",
    );
    expect(command).not.toMatch(/--token(?!-file)|--password/);
    // A name with a single quote in it goes in double quotes, and with both is no name at all.
    expect(openClawCommand({ name: 'M', url: 'wss://g', tokenFile: "/Users/o'neil/t" })).toContain(
      '"/Users/o\'neil/t"',
    );
    expect(() =>
      openClawCommand({ name: 'M', url: 'wss://g', tokenFile: `/Users/o'n"eil/t` }),
    ).toThrow('both kinds of quote');
  });
});

describe('the agents the host lists', () => {
  it('are the entries that the host says are OpenClaw’s bridge, with their Gateway and token file', () => {
    const entries = [
      {
        id: 'moby',
        name: 'Moby',
        args: [
          'acp',
          '--url',
          'wss://gateway.example.org',
          '--token-file',
          '/Users/ada/.t',
          '--session',
          'agent:moby:main',
        ],
        bridge: { agent: 'moby' },
      },
      {
        id: 'rex',
        name: 'Rex',
        args: ['acp', '--url', 'ws://127.0.0.1:18789', '--token-file', '/Users/ada/.r'],
        bridge: {},
      },
      // Not a bridge: an agent of any other kind.
      { id: 'gemini', name: 'Gemini', args: ['--experimental-acp'] },
      // A bridge with nothing of the Gateway in it is not one this can show.
      { id: 'odd', name: 'Odd', args: ['acp'], bridge: {} },
    ];
    expect(openClawAgents(entries)).toEqual([
      {
        id: 'moby',
        name: 'Moby',
        url: 'wss://gateway.example.org',
        tokenFile: '/Users/ada/.t',
        agent: 'moby',
      },
      { id: 'rex', name: 'Rex', url: 'ws://127.0.0.1:18789', tokenFile: '/Users/ada/.r' },
    ]);
  });
});
