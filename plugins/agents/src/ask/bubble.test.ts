// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import type { LiveLine } from '../runs.ts';
import { type Bubble, type BubbleView, createBubble } from './bubble.ts';
import type { AskTurn } from './session.ts';

afterEach(() => {
  document.body.replaceChildren();
  document.head.replaceChildren();
});

const noop = () => {};
const CLAUDE = { id: 'claude', name: 'Claude' };
const CODEX = { id: 'codex', name: 'Codex' };

function make(): Bubble {
  const bubble = createBubble({
    submit: noop,
    close: noop,
    stop: noop,
    consent: noop,
    dismiss: noop,
    makeComment: noop,
    openWindow: noop,
    copy: noop,
    has: () => true,
    show: noop,
    resized: noop,
    focusDocument: noop,
  });
  document.body.append(bubble.el);
  return bubble;
}

const view = (over: Partial<BubbleView> = {}): BubbleView => ({
  turns: [],
  pending: null,
  line: null,
  draft: '',
  canOpenWindow: false,
  ...over,
});
const turn = (question: string, answer: string, agent = CLAUDE): AskTurn => ({
  question,
  answer,
  agent,
});
const running = (status: string): LiveLine => ({
  kind: 'running',
  agent: 'claude',
  agentName: 'Claude',
  status,
});

const exchangeOf = (bubble: Bubble) => {
  const found = bubble.el.querySelector<HTMLElement>('.rl-qa-exchange');
  if (!found) throw new Error('No exchange');
  return found;
};

/** The changes made to `target`'s children, however deep, until it is stopped. */
function watch(target: Element) {
  const records: MutationRecord[] = [];
  const observer = new MutationObserver((list) => records.push(...list));
  observer.observe(target, { childList: true, subtree: true });
  return {
    async changes() {
      await new Promise((resolve) => setTimeout(resolve, 0));
      observer.disconnect();
      return {
        records,
        removed: records.flatMap((record) => [...record.removedNodes]),
        added: records.flatMap((record) => [...record.addedNodes]),
      };
    },
  };
}

describe('the bubble’s exchange', () => {
  it('is a polite live region', () => {
    const bubble = make();
    expect(exchangeOf(bubble).getAttribute('aria-live')).toBe('polite');
  });

  it('names, over each answer, the agent that gave it', () => {
    const bubble = make();
    bubble.render(
      view({
        turns: [turn('What is a lien?', 'A claim.', CLAUDE), turn('Agreed?', 'Yes.', CODEX)],
      }),
    );
    const names = [...bubble.el.querySelectorAll('.rl-note-name')].map((n) => n.textContent);
    expect(names).toEqual(['Claude', 'Codex']);
    // Each in the turn of its own answer.
    const blocks = [...exchangeOf(bubble).children];
    expect(blocks.map((block) => block.querySelector('.rl-note-name')?.textContent)).toEqual([
      'Claude',
      'Codex',
    ]);
    expect(blocks.map((block) => block.querySelector('.rl-qa-answer')?.textContent)).toEqual([
      'A claim.',
      'Yes.',
    ]);
  });

  it('shows a question that waits with no name, as there is no answer to put it over', () => {
    const bubble = make();
    bubble.render(view({ pending: 'What?', line: running('Starting…') }));
    expect(exchangeOf(bubble).textContent).toBe('What?');
    expect(bubble.el.querySelector('.rl-note-name')).toBeNull();
    // An empty question is shown as what it asks.
    bubble.render(view({ pending: '  ', line: running('Starting…') }));
    expect(exchangeOf(bubble).textContent).toBe('Explain this in the context of the document.');
  });

  it('changes nothing in the exchange for a tick of the run’s status', async () => {
    const bubble = make();
    const first = turn('What is a lien?', 'A claim [1].\n\nSources:\n[1] "x"');
    bubble.render(view({ turns: [first], pending: 'And?', line: running('Reading') }));
    const exchange = exchangeOf(bubble);
    const before = [...exchange.children];
    const answerBefore = before[0]?.querySelector('.rl-qa-answer');
    const seen = watch(exchange);
    // A new array of the same turns, as the session makes one, and a new status.
    bubble.render(view({ turns: [first], pending: 'And?', line: running('Searching') }));
    bubble.render(view({ turns: [first], pending: 'And?', line: running('Thinking') }));
    const { records } = await seen.changes();
    expect(exchange.children).toHaveLength(before.length);
    before.forEach((node, at) => expect(exchange.children[at]).toBe(node));
    expect(exchange.children[0]?.querySelector('.rl-qa-answer')).toBe(answerBefore);
    // Not a node of it was touched, so nothing is said again.
    expect(records).toEqual([]);
    // The line itself did change, in place.
    expect(bubble.el.querySelector('.rl-live-line-text')?.textContent).toBe('Thinking');
  });

  it('adds a new question after the earlier turns, and its answer to it, and takes nothing away', async () => {
    const bubble = make();
    const first = turn('What is a lien?', 'A claim.');
    bubble.render(view({ turns: [first] }));
    const exchange = exchangeOf(bubble);
    const firstBlock = exchange.children[0];
    const seen = watch(exchange);

    bubble.render(view({ turns: [first], pending: 'Who holds it?', line: running('Starting…') }));
    const waiting = exchange.children[1];
    expect(waiting?.textContent).toBe('Who holds it?');

    const second = turn('Who holds it?', 'The Lender.', CODEX);
    bubble.render(view({ turns: [first, second] }));
    const { removed, added } = await seen.changes();

    // The first turn is the node it was; the question that waited is the node that was answered.
    expect(exchange.children).toHaveLength(2);
    expect(exchange.children[0]).toBe(firstBlock);
    expect(exchange.children[1]).toBe(waiting);
    expect(waiting?.querySelector('.rl-qa-answer')?.textContent).toBe('The Lender.');
    expect(waiting?.querySelector('.rl-note-name')?.textContent).toBe('Codex');
    expect(waiting?.querySelectorAll('.rl-qa-question')).toHaveLength(1);
    // The region was only added to: the waiting turn, then what answered it.
    expect(removed).toEqual([]);
    expect(added).toContain(waiting);
    expect(
      added.some((node) => node instanceof HTMLElement && node.classList.contains('rl-qa-answer')),
    ).toBe(true);
    expect(added.some((node) => node === firstBlock || firstBlock?.contains(node))).toBe(false);
  });

  it('takes away the question that was stopped, and nothing else', () => {
    const bubble = make();
    const first = turn('What is a lien?', 'A claim.');
    bubble.render(view({ turns: [first], pending: 'And?', line: running('Starting…') }));
    const exchange = exchangeOf(bubble);
    const firstBlock = exchange.children[0];
    expect(exchange.children).toHaveLength(2);
    bubble.render(view({ turns: [first] }));
    expect(exchange.children).toHaveLength(1);
    expect(exchange.children[0]).toBe(firstBlock);
    // And another question after it is a new turn.
    bubble.render(view({ turns: [first], pending: 'Again?', line: running('Starting…') }));
    expect(exchange.children).toHaveLength(2);
    expect(exchange.children[1]?.textContent).toBe('Again?');
  });

  it('draws again, from the first turn that is not the one it shows, what is not as it was', () => {
    const bubble = make();
    const one = turn('One?', 'One.');
    const two = turn('Two?', 'Two.');
    bubble.render(view({ turns: [one, two] }));
    const exchange = exchangeOf(bubble);
    const [oneBlock, twoBlock] = [...exchange.children];
    const other = turn('Other?', 'Other.', CODEX);
    bubble.render(view({ turns: [one, other] }));
    expect(exchange.children).toHaveLength(2);
    expect(exchange.children[0]).toBe(oneBlock);
    expect(exchange.children[1]).not.toBe(twoBlock);
    expect(exchange.children[1]?.textContent).toContain('Other.');
    expect(twoBlock?.isConnected).toBe(false);
    // Nothing at all: all taken away.
    bubble.render(view());
    expect(exchange.children).toHaveLength(0);
  });

  it('shows an answer that has no unsafe HTML in it, whatever the answer says', () => {
    const bubble = make();
    bubble.render(view({ turns: [turn('What?', '<img src=x onerror=alert(1)> and <b>bold</b>')] }));
    expect(exchangeOf(bubble).querySelector('img, b')).toBeNull();
    expect(exchangeOf(bubble).textContent).toContain('<img src=x onerror=alert(1)>');
  });
});
