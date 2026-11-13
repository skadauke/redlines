// @vitest-environment happy-dom
import { createEditor, type Editor, undo } from '@redlines/editor';
import { newestView, parse } from '@redlines/format';
import type { AgentScope, ProjectRoot } from '@redlines/plugin-api';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeProvider, fakeRelay, type FakeScript } from '../fake-provider.ts';
import { createMacAgents } from '../mac-agents.ts';
import { type Ask, createAsk, type AskOptions } from './index.ts';

const ada = { handle: 'ada', name: 'Ada Lovelace' };
const DOC =
  '# Loan\n\nThe Lender shall hold a first lien on the property until paid in full.\n\nThe Borrower shall pay on time.\n';
const REPO: ProjectRoot = { folder: '/repo', isRepo: true, tooBroad: false };

const mounted: { editor: Editor; ask: Ask }[] = [];

afterEach(() => {
  for (const { editor, ask } of mounted.splice(0)) {
    ask.destroy();
    editor.destroy();
  }
  document.body.replaceChildren();
  document.head.replaceChildren();
});

/** An agent that reads the document, then answers with `text` as its last message. */
const answers = (text: string): FakeScript =>
  async function* ({ tools }) {
    await tools.initialize();
    await tools.call('view', {});
    yield { type: 'done', finalText: text };
  };

interface Options {
  doc?: string;
  script?: FakeScript;
  /** Codex too, for a follow-up that names it. */
  codex?: FakeScript;
  /** What Claude can be held to reading: its folder, or, as an agent the person added, the Mac. */
  reads?: 'folder' | 'machine';
  scope?: 'folder' | 'document';
  consent?: Record<string, AgentScope | 'no'>;
  window?: boolean;
  view?: 'clean' | 'raw' | 'redlines';
  generation?: { value: number };
}

function mount(options: Options = {}) {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, {
    doc: options.doc ?? DOC,
    author: ada,
    ...(options.view ? { view: options.view } : {}),
  });
  // happy-dom fires `selectionchange` while CodeMirror writes a focused editor's selection, in the
  // middle of the update that writes it: the keyboard stays out of the editor here.
  const focus = vi.spyOn(editor.view, 'focus').mockImplementation(() => {});
  const relay = fakeRelay();
  const claude = fakeProvider({
    relay,
    script: options.script ?? answers('A lien is a claim.'),
    ...(options.reads ? { readLimit: options.reads } : {}),
  });
  const codex = options.codex
    ? fakeProvider({ relay, id: 'codex', name: 'Codex', script: options.codex })
    : null;
  const agents = createMacAgents(codex ? [claude, codex] : [claude], relay);
  const generation = options.generation ?? { value: 0 };
  const notices: string[] = [];
  const consent: Record<string, AgentScope | 'no'> = { ...options.consent };
  const opened: string[] = [];
  const copied: string[] = [];
  const shown: string[] = [];
  const preferences: string[] = [];
  const attached: HTMLTextAreaElement[] = [];
  const base: AskOptions = {
    agents,
    author: ada,
    document: {
      path: () => '/repo/loan.md',
      generation: () => generation.value,
      read: () => editor.getDoc(),
    },
    projectRoot: () => Promise.resolve(REPO),
    settings: {
      defaultScope: () => options.scope ?? 'document',
      consent: (agent, folder) => consent[`${agent}|${folder}`],
      setConsent: (agent, folder, answer) => {
        consent[`${agent}|${folder}`] = answer;
      },
    },
    notice: (message) => notices.push(message),
    showThread: (thread) => {
      shown.push(thread);
      return true;
    },
    openPreferences: () => {
      preferences.push('agents');
    },
    copy: (text) => {
      copied.push(text);
    },
    attachToField: (field) => {
      attached.push(field);
      return () => {};
    },
    ...(options.window === false ? {} : { openInNewWindow: (text: string) => opened.push(text) }),
  };
  const ask = createAsk(editor, base);
  mounted.push({ editor, ask });
  return {
    editor,
    ask,
    claude,
    codex,
    notices,
    opened,
    copied,
    shown,
    preferences,
    attached,
    focus,
    generation,
  };
}

const bubble = () => document.querySelector<HTMLElement>('.rl-qa');
const field = () => document.querySelector<HTMLTextAreaElement>('.rl-qa textarea');
const answerOf = () => document.querySelector<HTMLElement>('.rl-qa-answer');
const label = (name: string) =>
  document.querySelector<HTMLButtonElement>(`.rl-qa button[aria-label="${name}"]`);
const button = (text: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('.rl-qa button')].find(
    (candidate) => candidate.textContent === text,
  );

/** Selects `text` in the document. */
function select(editor: Editor, text: string): void {
  const from = editor.view.state.doc.toString().indexOf(text);
  if (from < 0) throw new Error(`No "${text}" in the document`);
  editor.view.dispatch({ selection: { anchor: from, head: from + text.length } });
}

/** Types a question into the field and presses Return. */
function ask(question: string): void {
  const box = field();
  if (!box) throw new Error('No field to ask in');
  box.value = question;
  box.dispatchEvent(new Event('input', { bubbles: true }));
  box.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
  );
}

const answered = () => vi.waitFor(() => expect(answerOf()).not.toBeNull(), { timeout: 2000 });

function key(name: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key: name,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  document.body.dispatchEvent(event);
  return event;
}

describe('the command', () => {
  it('is Ask… in the Format menu beside Add Comment, with its key', () => {
    const { editor } = mount();
    const command = editor.commands.list().find(({ id }) => id === 'ask.start');
    expect(command).toMatchObject({
      title: 'Ask…',
      shortcut: 'Mod-Alt-a',
      menu: 'format',
      group: 'comment',
    });
  });

  it('opens the box at the selection, with the keyboard in it and the text tinted', () => {
    const { editor, ask: asking } = mount();
    select(editor, 'first lien');
    expect(editor.commands.run('ask.start')).toBe(true);
    expect(asking.isOpen()).toBe(true);
    expect(bubble()).not.toBeNull();
    expect(bubble()?.parentElement).toBe(editor.view.scrollDOM);
    expect(document.activeElement).toBe(field());
    expect(field()?.placeholder).toBe('Ask about this, or press Return');
    // The text it is about stays tinted, though the keyboard is in the box.
    const tinted = [...editor.view.dom.querySelectorAll('.rl-qa-target')].map(
      (el) => el.textContent,
    );
    expect(tinted.join('')).toBe('first lien');
  });

  it('is about the word under the caret when nothing is selected', () => {
    const { editor } = mount();
    const at = editor.view.state.doc.toString().indexOf('Lender') + 2;
    editor.view.dispatch({ selection: { anchor: at } });
    expect(editor.commands.run('ask.start')).toBe(true);
    const tinted = [...editor.view.dom.querySelectorAll('.rl-qa-target')].map(
      (el) => el.textContent,
    );
    expect(tinted.join('')).toBe('Lender');
  });

  it('says so, and opens nothing, with no text to ask about', () => {
    // On a blank line there is no word.
    const { editor, notices } = mount({ doc: 'a\n\n\nb\n' });
    editor.view.dispatch({ selection: { anchor: 3 } });
    expect(editor.commands.run('ask.start')).toBe(false);
    expect(notices).toEqual(['Select some text to ask about.']);
    expect(bubble()).toBeNull();
  });

  it('is not for Raw, where a selection holds markers', () => {
    const { editor, notices } = mount({ view: 'raw' });
    select(editor, 'first lien');
    expect(editor.commands.run('ask.start')).toBe(false);
    expect(notices).toEqual(['Ask works on the text as it reads. Show Clean or Redlines first.']);
    expect(bubble()).toBeNull();
  });

  it('opens one box at a time', () => {
    const { editor } = mount();
    select(editor, 'first lien');
    editor.commands.run('ask.start');
    select(editor, 'Borrower');
    editor.commands.run('ask.start');
    expect(document.querySelectorAll('.rl-qa')).toHaveLength(1);
    const tinted = [...editor.view.dom.querySelectorAll('.rl-qa-target')].map(
      (el) => el.textContent,
    );
    expect(tinted.join('')).toBe('Borrower');
  });

  it('gives the field the @ picker', () => {
    const { editor, attached } = mount();
    select(editor, 'first lien');
    editor.commands.run('ask.start');
    expect(attached).toEqual([field()]);
  });
});

describe('asking', () => {
  it('shows the question and the answer, with who answered, and writes nothing to the file', async () => {
    const { editor } = mount();
    const before = editor.getDoc();
    select(editor, 'first lien');
    editor.commands.run('ask.start');
    ask('What is a lien?');
    // The box gives way to the question and the run's line.
    expect(document.querySelector('.rl-qa-question')?.textContent).toBe('What is a lien?');
    expect(document.querySelector('.rl-qa-composer')?.hasAttribute('hidden')).toBe(true);
    await answered();
    expect(answerOf()?.textContent).toBe('A lien is a claim.');
    expect(document.querySelector('.rl-qa .rl-note-name')?.textContent).toBe('Claude');
    expect(editor.getDoc()).toBe(before);
    expect(parse(editor.getDoc()).ledger.comments).toEqual([]);
    // Undo has nothing of it to take back.
    expect(undo(editor.view)).toBe(false);
  });

  it('shows what the agent is doing while it works, with Stop', async () => {
    let release: () => void = () => {};
    const { editor } = mount({
      script: async function* ({ tools }) {
        await tools.initialize();
        yield { type: 'status', text: 'Reading loan.md' };
        await new Promise<void>((resolve) => (release = resolve));
        yield { type: 'done', finalText: 'Done.' };
      },
    });
    select(editor, 'first lien');
    editor.commands.run('ask.start');
    ask('What?');
    await vi.waitFor(() =>
      expect(document.querySelector('.rl-live-line-text')?.textContent).toContain(
        'Reading loan.md',
      ),
    );
    expect(button('Stop')).toBeDefined();
    release();
    await answered();
    expect(document.querySelector('.rl-live-line')).toBeNull();
  });

  it('explains the text when the question is empty', async () => {
    const { editor, claude } = mount();
    select(editor, 'first lien');
    editor.commands.run('ask.start');
    ask('');
    await answered();
    expect(claude.requests[0]?.prompt).toBe('Explain this in the context of the document.');
    expect(document.querySelector('.rl-qa-question')?.textContent).toBe(
      'Explain this in the context of the document.',
    );
  });

  it('tells the agent what was selected, as quoted text', async () => {
    const { editor, claude } = mount();
    select(editor, 'first lien');
    editor.commands.run('ask.start');
    ask('What?');
    await answered();
    expect(claude.requests[0]?.systemPrompt).toContain('> first lien');
  });

  it('keeps Shift-Return for a new line in the question, and only Return asks', async () => {
    const { editor, claude } = mount();
    select(editor, 'first lien');
    editor.commands.run('ask.start');
    // The control: Return asks. The question is on the bubble at once, and the provider is asked
    // once the agents are looked up, a moment after: the moment is measured, and waited again.
    const box = field();
    if (!box) throw new Error('No field to ask in');
    box.value = 'What is a lien?';
    const pressed = performance.now();
    box.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    expect(document.querySelector('.rl-qa-question')?.textContent).toBe('What is a lien?');
    await vi.waitFor(() => expect(claude.requests).toHaveLength(1));
    const moment = performance.now() - pressed;
    await answered();

    // Another question, with Shift-Return: nothing asks, the question stays in the field, and the
    // field is left the key, which makes the new line.
    select(editor, 'Borrower');
    editor.commands.run('ask.start');
    const next = field();
    if (!next) throw new Error('No field to ask in');
    next.value = 'Who pays?';
    const shifted = new KeyboardEvent('keydown', {
      key: 'Enter',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    next.dispatchEvent(shifted);
    expect(shifted.defaultPrevented).toBe(false);
    expect(document.querySelector('.rl-qa-question')).toBeNull();
    expect(document.querySelector('.rl-qa-composer')?.hasAttribute('hidden')).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, Math.max(50, moment * 3)));
    expect(claude.requests).toHaveLength(1);
    expect(next.value).toBe('Who pays?');
  });

  it('shows a failure on the agent’s line, and brings the question back to ask again', async () => {
    const { editor } = mount({
      script: async function* ({ tools }) {
        await tools.initialize();
        yield { type: 'error', message: 'Claude has hit its usage limit. Try again later.' };
      },
    });
    select(editor, 'first lien');
    editor.commands.run('ask.start');
    ask('What is a lien?');
    await vi.waitFor(() =>
      expect(document.querySelector('.rl-live-line-failed')?.textContent).toContain('usage limit'),
    );
    // The question is in the box again, to ask once more.
    await vi.waitFor(() => expect(field()?.value).toBe('What is a lien?'));
    // A usage limit is not for Preferences to put right: no way there is offered.
    expect(button('Open Preferences')).toBeUndefined();
  });

  it('offers to open Preferences for a failure they can put right', async () => {
    const { editor, preferences } = mount({
      script: async function* ({ tools }) {
        await tools.initialize();
        yield { type: 'error', message: 'Claude isn’t signed in.', setup: true };
      },
    });
    select(editor, 'first lien');
    editor.commands.run('ask.start');
    ask('What is a lien?');
    await vi.waitFor(() => expect(button('Open Preferences')).toBeDefined());
    expect(preferences).toEqual([]);
    button('Open Preferences')?.click();
    expect(preferences).toEqual(['agents']);
  });

  it('asks the first-run question in the bubble, and goes on when the folder is allowed', async () => {
    const { editor, claude } = mount({ scope: 'folder' });
    select(editor, 'first lien');
    editor.commands.run('ask.start');
    ask('What?');
    await vi.waitFor(() =>
      expect(document.querySelector('.rl-qa .rl-ask-title')?.textContent).toBe(
        'Allow Claude to read this folder?',
      ),
    );
    expect(claude.requests).toHaveLength(0);
    button('Allow')?.click();
    await answered();
    expect(claude.requests[0]?.scope).toBe('folder');
  });
});

describe('citations', () => {
  const CITED =
    'The lender holds a lien [1] until the debt is paid [2].\n\nSources:\n[1] "a first lien on the property"\n[2] "until paid in full"';

  it('are links to the passages, which select them in the document', async () => {
    const { editor } = mount({ script: answers(CITED) });
    select(editor, 'first lien');
    editor.commands.run('ask.start');
    ask('What?');
    await answered();
    const links = [...document.querySelectorAll<HTMLButtonElement>('.rl-qa-answer p .rl-qa-cite')];
    expect(links.map((link) => link.textContent)).toEqual(['[1]', '[2]']);
    links[1]?.click();
    const { from, to } = editor.view.state.selection.main;
    expect(editor.view.state.sliceDoc(from, to)).toBe('until paid in full');
    // The bubble stays, and its text is still tinted.
    expect(bubble()).not.toBeNull();
    links[0]?.click();
    expect(editor.view.state.sliceDoc(...rangeOf(editor))).toBe('a first lien on the property');
  });

  it('are plain text where the passage is not in the document', async () => {
    const { editor } = mount({
      script: answers('It is so [1].\n\nSources:\n[1] "words that are not in the document"'),
    });
    select(editor, 'first lien');
    editor.commands.run('ask.start');
    ask('What?');
    await answered();
    expect(document.querySelector('.rl-qa-answer p .rl-qa-cite')).toBeNull();
    expect(document.querySelector('.rl-qa-source.rl-qa-lost')).not.toBeNull();
  });

  it('say so when the passage went from the document after the answer', async () => {
    const { editor, notices } = mount({ script: answers(CITED) });
    select(editor, 'first lien');
    editor.commands.run('ask.start');
    ask('What?');
    await answered();
    const at = editor.view.state.doc.toString().indexOf('until paid in full');
    editor.view.dispatch({
      changes: { from: at, to: at + 'until paid in full'.length, insert: 'soon' },
    });
    document.querySelectorAll<HTMLButtonElement>('.rl-qa-answer p .rl-qa-cite')[1]?.click();
    expect(notices).toEqual(['That passage is no longer in the document.']);
  });
});

/** The main selection's range. */
function rangeOf(editor: Editor): [number, number] {
  const { from, to } = editor.view.state.selection.main;
  return [from, to];
}

describe('putting it away', () => {
  it('goes on Esc, and the keyboard goes back to the text', () => {
    const { editor, ask: asking, focus } = mount();
    select(editor, 'first lien');
    editor.commands.run('ask.start');
    focus.mockClear();
    const event = key('Escape');
    expect(event.defaultPrevented).toBe(true);
    expect(asking.isOpen()).toBe(false);
    expect(bubble()).toBeNull();
    expect(editor.view.dom.querySelector('.rl-qa-target')).toBeNull();
    expect(focus).toHaveBeenCalled();
  });

  it('goes on a press elsewhere, and leaves the keyboard where the press put it', () => {
    const { editor, focus } = mount();
    select(editor, 'first lien');
    editor.commands.run('ask.start');
    focus.mockClear();
    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(bubble()).toBeNull();
    expect(focus).not.toHaveBeenCalled();
  });

  it('stays for a press inside it', () => {
    const { editor } = mount();
    select(editor, 'first lien');
    editor.commands.run('ask.start');
    field()?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(bubble()).not.toBeNull();
  });

  it('goes on Cancel', () => {
    const { editor } = mount();
    select(editor, 'first lien');
    editor.commands.run('ask.start');
    button('Cancel')?.click();
    expect(bubble()).toBeNull();
  });

  it('stays when something nearer took the Esc, and goes on one that nobody took', () => {
    const { editor, ask: asking } = mount();
    select(editor, 'first lien');
    editor.commands.run('ask.start');
    // The @ picker, or a text box, takes an Esc it has a use for, and says so.
    document.body.addEventListener('keydown', (event) => event.preventDefault(), { once: true });
    const taken = key('Escape');
    expect(taken.defaultPrevented).toBe(true);
    expect(asking.isOpen()).toBe(true);
    expect(bubble()).not.toBeNull();
    // An Esc that ends an input method's composition is the input method's.
    key('Escape', { isComposing: true });
    expect(asking.isOpen()).toBe(true);
    // Nobody took this one.
    key('Escape');
    expect(asking.isOpen()).toBe(false);
    expect(bubble()).toBeNull();
  });

  it('stops the run, and writes nothing, when it goes while the agent works', async () => {
    let signal: AbortSignal | undefined;
    const { editor } = mount({
      script: async function* ({ tools, signal: given }) {
        await tools.initialize();
        signal = given;
        await new Promise<void>((resolve) => given.addEventListener('abort', () => resolve()));
        yield { type: 'done', finalText: 'too late' };
      },
    });
    const before = editor.getDoc();
    select(editor, 'first lien');
    editor.commands.run('ask.start');
    ask('What?');
    await vi.waitFor(() => expect(signal).toBeDefined());
    key('Escape');
    expect(signal?.aborted).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(bubble()).toBeNull();
    expect(editor.getDoc()).toBe(before);
  });

  it('goes when another document takes this one’s place', () => {
    const generation = { value: 0 };
    const { editor, ask: asking } = mount({ generation });
    select(editor, 'first lien');
    editor.commands.run('ask.start');
    generation.value = 1;
    editor.view.dispatch({ selection: { anchor: 0 } });
    expect(asking.isOpen()).toBe(false);
  });

  it('goes when the text it is about is all gone', () => {
    const { editor, ask: asking } = mount();
    select(editor, 'first lien');
    editor.commands.run('ask.start');
    const at = editor.view.state.doc.toString().indexOf('first lien');
    editor.view.dispatch({ changes: { from: at, to: at + 'first lien'.length } });
    expect(asking.isOpen()).toBe(false);
  });

  it('keeps the text tinted where the text moves', () => {
    const { editor } = mount();
    select(editor, 'first lien');
    editor.commands.run('ask.start');
    editor.view.dispatch({ changes: { from: 0, insert: 'Added line.\n\n' } });
    const tinted = [...editor.view.dom.querySelectorAll('.rl-qa-target')].map(
      (el) => el.textContent,
    );
    expect(tinted.join('')).toBe('first lien');
  });
});

describe('stopping', () => {
  it('brings the question back into the field after Stop, to ask again', async () => {
    const { editor } = mount({
      script: async function* ({ tools, signal }) {
        await tools.initialize();
        await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve()));
        yield { type: 'done', finalText: 'too late' };
      },
    });
    select(editor, 'first lien');
    editor.commands.run('ask.start');
    ask('What is a lien?');
    await vi.waitFor(() => expect(button('Stop')).toBeDefined());
    button('Stop')?.click();
    await vi.waitFor(() => expect(field()?.value).toBe('What is a lien?'));
    expect(document.querySelector('.rl-qa-answer')).toBeNull();
    expect(bubble()).not.toBeNull();
  });
});

describe('follow-up', () => {
  it('has a field after the answer, and answers with the earlier exchange as context', async () => {
    const { editor, claude } = mount();
    select(editor, 'first lien');
    editor.commands.run('ask.start');
    ask('What is a lien?');
    await answered();
    // The keyboard is back in the field for the follow-up.
    expect(document.activeElement).toBe(field());
    expect(field()?.placeholder).toBe('Ask a follow-up');
    expect(field()?.hasAttribute('hidden')).toBe(false);
    // The question that was answered is not asked again: the field is empty.
    expect(field()?.value).toBe('');
    ask('Who holds it?');
    await vi.waitFor(() => expect(claude.requests).toHaveLength(2));
    expect(claude.requests[1]?.prompt).toContain('What is a lien?');
    expect(claude.requests[1]?.prompt).toContain('A lien is a claim.');
    await vi.waitFor(() => expect(document.querySelectorAll('.rl-qa-answer')).toHaveLength(2));
    expect([...document.querySelectorAll('.rl-qa-question')].map((q) => q.textContent)).toEqual([
      'What is a lien?',
      'Who holds it?',
    ]);
  });

  it('asks nothing when Return is pressed in the empty follow-up field', async () => {
    const { editor, claude, notices } = mount();
    select(editor, 'first lien');
    editor.commands.run('ask.start');
    ask('What is a lien?');
    await answered();
    expect(document.activeElement).toBe(field());
    // A stray Return, and one after a space: no run, no turn, no notice, and the keyboard stays.
    const enter = () =>
      field()?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      );
    enter();
    const box = field();
    if (box) box.value = '  ';
    enter();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(claude.requests).toHaveLength(1);
    expect(document.querySelectorAll('.rl-qa-question')).toHaveLength(1);
    expect(document.querySelectorAll('.rl-qa-answer')).toHaveLength(1);
    expect(document.querySelector('.rl-qa-composer')?.hasAttribute('hidden')).toBe(false);
    expect(notices).toEqual([]);
    expect(document.activeElement).toBe(field());
    // The Ask button, pressed on an empty field, is the same.
    button('Ask')?.click();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(claude.requests).toHaveLength(1);
    // The first question may be empty, though: that is the one that explains.
    select(editor, 'Borrower');
    editor.commands.run('ask.start');
    ask('');
    await vi.waitFor(() => expect(claude.requests).toHaveLength(2));
    expect(claude.requests[1]?.prompt).toBe('Explain this in the context of the document.');
  });

  it('names the agent that gave each answer, when a follow-up goes to another', async () => {
    const { editor, claude, codex } = mount({ codex: answers('Codex agrees.') });
    select(editor, 'first lien');
    editor.commands.run('ask.start');
    ask('What is a lien?');
    await answered();
    ask('@Codex do you agree?');
    await vi.waitFor(() => expect(document.querySelectorAll('.rl-qa-answer')).toHaveLength(2));
    // Each header is its own answer's agent's, not the latest's.
    expect(
      [...document.querySelectorAll('.rl-qa .rl-note-name')].map((n) => n.textContent),
    ).toEqual(['Claude', 'Codex']);
    expect([...document.querySelectorAll('.rl-qa-answer')].map((a) => a.textContent)).toEqual([
      'A lien is a claim.',
      'Codex agrees.',
    ]);
    expect(claude.requests).toHaveLength(1);
    expect(codex?.requests).toHaveLength(1);
  });
});

describe('keeping an answer', () => {
  it('Make Comment: the question is the person’s comment and the answer the agent’s reply, as one step', async () => {
    const { editor, shown, ask: asking } = mount();
    const before = editor.getDoc();
    select(editor, 'first lien');
    editor.commands.run('ask.start');
    ask('What is a lien?');
    await answered();
    label('Make Comment')?.click();
    const { ledger } = parse(editor.getDoc());
    expect(ledger.comments).toHaveLength(1);
    const [thread] = ledger.comments;
    expect(thread).toMatchObject({ by: 'ada', text: 'What is a lien?', quote: 'first lien' });
    expect(thread?.replies).toMatchObject([{ by: 'claude-ada', text: 'A lien is a claim.' }]);
    expect(ledger.people.find((person) => person.handle === 'claude-ada')).toMatchObject({
      name: 'Claude',
      agent: true,
      for: 'ada',
    });
    // The text of the document is as it was; the thread's anchor is the only mark.
    expect(newestView(editor.getDoc()).text).toBe(newestView(before).text);
    expect(shown).toEqual([thread?.id]);
    expect(asking.isOpen()).toBe(false);
    // One step: a single Undo takes the whole thread back.
    expect(undo(editor.view)).toBe(true);
    expect(editor.getDoc()).toBe(before);
    expect(undo(editor.view)).toBe(false);
  });

  it('Make Comment: an empty question is the explanation it asked for', async () => {
    const { editor } = mount();
    select(editor, 'first lien');
    editor.commands.run('ask.start');
    ask('');
    await answered();
    label('Make Comment')?.click();
    expect(parse(editor.getDoc()).ledger.comments[0]?.text).toBe(
      'Explain this in the context of the document.',
    );
  });

  it('Make Comment: follow-ups are replies, in turn, of the person and the agent', async () => {
    const { editor } = mount();
    select(editor, 'first lien');
    editor.commands.run('ask.start');
    ask('What is a lien?');
    await answered();
    ask('Who holds it?');
    await vi.waitFor(() => expect(document.querySelectorAll('.rl-qa-answer')).toHaveLength(2));
    label('Make Comment')?.click();
    const [thread] = parse(editor.getDoc()).ledger.comments;
    expect(thread?.text).toBe('What is a lien?');
    expect(thread?.replies.map(({ by, text }) => [by, text])).toEqual([
      ['claude-ada', 'A lien is a claim.'],
      ['ada', 'Who holds it?'],
      ['claude-ada', 'A lien is a claim.'],
    ]);
  });

  it('Make Comment: each reply is its own agent’s, when a follow-up went to another', async () => {
    const { editor, ask: asking } = mount({ codex: answers('Codex agrees.') });
    const before = editor.getDoc();
    select(editor, 'first lien');
    editor.commands.run('ask.start');
    ask('What is a lien?');
    await answered();
    ask('@Codex do you agree?');
    await vi.waitFor(() => expect(document.querySelectorAll('.rl-qa-answer')).toHaveLength(2));
    label('Make Comment')?.click();
    const { ledger } = parse(editor.getDoc());
    const [thread] = ledger.comments;
    // Claude's answer is Claude's, the person's question is theirs, and Codex's answer is Codex's.
    expect(thread?.replies.map(({ by, text }) => [by, text])).toEqual([
      ['claude-ada', 'A lien is a claim.'],
      ['ada', 'do you agree?'],
      ['codex-ada', 'Codex agrees.'],
    ]);
    // Both agents are among the people, each acting for the person who asked.
    expect(
      ledger.people
        .filter(({ agent }) => agent === true)
        .map(({ handle, name, for: by }) => [handle, name, by]),
    ).toEqual([
      ['claude-ada', 'Claude', 'ada'],
      ['codex-ada', 'Codex', 'ada'],
    ]);
    expect(asking.isOpen()).toBe(false);
    // One Undo takes the whole thread back.
    expect(undo(editor.view)).toBe(true);
    expect(editor.getDoc()).toBe(before);
    expect(undo(editor.view)).toBe(false);
  });

  it('Make Comment: a refusal says why, and keeps the bubble', async () => {
    const doc = 'Text.\n\n```\nlet lien = 1;\n```\n';
    const { editor, notices, ask: asking } = mount({ doc });
    select(editor, 'lien');
    editor.commands.run('ask.start');
    ask('What?');
    await answered();
    label('Make Comment')?.click();
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatch(/code/i);
    expect(asking.isOpen()).toBe(true);
    expect(parse(editor.getDoc()).ledger.comments).toEqual([]);
  });

  it('Open in New Window: the question, the text and the answer, as a document', async () => {
    const { editor, opened, ask: asking } = mount();
    select(editor, 'first lien');
    editor.commands.run('ask.start');
    ask('What is a lien?');
    await answered();
    label('Open in New Window')?.click();
    expect(opened).toEqual(['# What is a lien?\n\n> first lien\n\nA lien is a claim.\n']);
    expect(asking.isOpen()).toBe(false);
  });

  it('Open in New Window: not offered where the host cannot open a window with text', async () => {
    const { editor } = mount({ window: false });
    select(editor, 'first lien');
    editor.commands.run('ask.start');
    ask('What?');
    await answered();
    expect(label('Open in New Window')).toBeNull();
    expect(label('Make Comment')).not.toBeNull();
    expect(label('Copy')).not.toBeNull();
  });

  it('Copy: the answer as text', async () => {
    const { editor, copied, notices } = mount();
    select(editor, 'first lien');
    editor.commands.run('ask.start');
    ask('What?');
    await answered();
    label('Copy')?.click();
    await vi.waitFor(() => expect(notices).toEqual(['Copied the answer.']));
    expect(copied).toEqual(['A lien is a claim.']);
  });

  it('has no actions until there is an answer, and none while the next is being answered', async () => {
    const { editor } = mount();
    select(editor, 'first lien');
    editor.commands.run('ask.start');
    expect(label('Copy')).toBeNull();
    ask('What?');
    expect(label('Copy')).toBeNull();
    await answered();
    expect(label('Copy')).not.toBeNull();
  });
});
