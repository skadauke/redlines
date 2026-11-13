// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderAnswer } from './render.ts';

afterEach(() => document.body.replaceChildren());

const present = new Set(['the Lender shall hold a first lien', 'until paid in full']);

function draw(text: string, shown = vi.fn()) {
  const root = renderAnswer(text, { has: (quote) => present.has(quote), show: shown });
  document.body.append(root);
  return { root, shown };
}

describe('renderAnswer', () => {
  it('draws paragraphs, and joins the lines of one', () => {
    const { root } = draw('A lien is a claim\non property.\n\nIt lasts until paid.');
    expect([...root.querySelectorAll('p')].map((p) => p.textContent)).toEqual([
      'A lien is a claim on property.',
      'It lasts until paid.',
    ]);
  });

  it('draws a bulleted list', () => {
    const { root } = draw('Three things:\n\n- one\n- two\n* three');
    expect([...root.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
      'one',
      'two',
      'three',
    ]);
  });

  /** The blocks of an answer, as `tag: text`, for `list` and `paragraph` shapes at a glance. */
  const shape = (root: HTMLElement) =>
    [...root.children]
      .filter((child) => !child.classList.contains('rl-qa-sources'))
      .map((child) =>
        child.tagName === 'UL' || child.tagName === 'OL'
          ? `${child.tagName.toLowerCase()}: ${[...child.children].map((li) => li.textContent).join(' | ')}`
          : `${child.tagName.toLowerCase()}: ${child.textContent}`,
      );

  it('draws bullets that follow a line of text directly, with no blank line', () => {
    const { root } = draw('The obligations are:\n- pay on time\n- keep the property insured');
    expect(shape(root)).toEqual([
      'p: The obligations are:',
      'ul: pay on time | keep the property insured',
    ]);
  });

  it('draws a numbered list, with a blank line before it or none', () => {
    expect(shape(draw('1. x\n2. y').root)).toEqual(['ol: x | y']);
    expect(
      shape(draw('The steps are:\n\n1. pay on time\n2. keep the property insured').root),
    ).toEqual(['p: The steps are:', 'ol: pay on time | keep the property insured']);
    expect(shape(draw('The steps are:\n1) pay\n2) insure').root)).toEqual([
      'p: The steps are:',
      'ol: pay | insure',
    ]);
  });

  it('goes on counting from the number a numbered list starts at', () => {
    // A blank line between the items of a list makes a block of each: each keeps its own number.
    const { root } = draw('1. first\n\n2. second\n\n3. third');
    const lists = [...root.querySelectorAll('ol')];
    expect(lists).toHaveLength(3);
    expect(lists.map((list) => list.getAttribute('start'))).toEqual([null, '2', '3']);
    expect(draw('4. d\n5. e').root.querySelector('ol')?.getAttribute('start')).toBe('4');
  });

  it('draws bullets, numbers and text in the order they are written', () => {
    const { root } = draw('Intro:\n- a\n- b\nThen:\n1. x\n2. y\nDone.\n\n* last\n• dot\n1. again');
    expect(shape(root)).toEqual([
      'p: Intro:',
      'ul: a | b',
      'p: Then:',
      'ol: x | y',
      'p: Done.',
      'ul: last | dot',
      'ol: again',
    ]);
  });

  it('flattens an indented bullet into the list it is in', () => {
    const { root } = draw('- one\n  - nested\n    * deeper\n- two');
    expect(shape(root)).toEqual(['ul: one | nested | deeper | two']);
  });

  it('goes on with an item on an indented line under it', () => {
    const { root } = draw('- one that\n  goes on\n- two\nA new paragraph.');
    expect(shape(root)).toEqual(['ul: one that goes on | two', 'p: A new paragraph.']);
  });

  it('draws an answer with nothing special as paragraphs', () => {
    const { root } = draw(
      'Plain words, 1.5 times a rate of 3.2%.\nA dash - in the middle, and *emphasis* here.\n-5 degrees is cold.\n\nA second paragraph.',
    );
    expect(shape(root)).toEqual([
      'p: Plain words, 1.5 times a rate of 3.2%. A dash - in the middle, and *emphasis* here. -5 degrees is cold.',
      'p: A second paragraph.',
    ]);
    expect(root.querySelector('ul, ol')).toBeNull();
  });

  it('draws code, bold and citations inside the items of a list', () => {
    const { root, shown } = draw(
      'Read:\n- the `lien` and **first** claim [1]\n- until paid [2]\n\nSources:\n[1] "the Lender shall hold a first lien"\n[2] "words that are not there"',
    );
    const items = [...root.querySelectorAll('li')];
    expect(items[0]?.querySelector('code')?.textContent).toBe('lien');
    expect(items[0]?.querySelector('strong')?.textContent).toBe('first');
    items[0]?.querySelector<HTMLButtonElement>('.rl-qa-cite')?.click();
    expect(shown).toHaveBeenCalledWith('the Lender shall hold a first lien');
    // The one that isn't in the document is plain text.
    expect(items[1]?.querySelector('.rl-qa-cite')).toBeNull();
    expect(items[1]?.querySelector('.rl-qa-lost')?.textContent).toBe('[2]');
  });

  it('makes no HTML of the text of a list item either', () => {
    const { root } = draw('- <img src=x onerror=alert(1)>\n1. <b>bold</b>');
    expect(root.querySelector('img, b')).toBeNull();
    expect([...root.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
      '<img src=x onerror=alert(1)>',
      '<b>bold</b>',
    ]);
  });

  it('draws code and bold, and nothing else of Markdown', () => {
    const { root } = draw('The `lien` is **first**, and *this* stays.');
    expect(root.querySelector('code')?.textContent).toBe('lien');
    expect(root.querySelector('strong')?.textContent).toBe('first');
    expect(root.textContent).toContain('*this*');
  });

  it('never makes HTML of the answer’s text', () => {
    const { root } = draw('<img src=x onerror=alert(1)> and <b>bold</b> **and <i>this</i>**');
    expect(root.querySelector('img')).toBeNull();
    expect(root.querySelector('b')).toBeNull();
    expect(root.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('makes a citation a link when its passage is in the document, and shows the passage on a click', () => {
    const shown = vi.fn();
    const { root } = draw(
      'A lien is a claim [1], held until paid [2].\n\nSources:\n[1] "the Lender shall hold a first lien"\n[2] "until paid in full"',
      shown,
    );
    const cites = [...root.querySelectorAll<HTMLButtonElement>('p .rl-qa-cite')];
    expect(cites.map((cite) => cite.textContent)).toEqual(['[1]', '[2]']);
    cites[0]?.click();
    expect(shown).toHaveBeenCalledWith('the Lender shall hold a first lien');
    cites[1]?.click();
    expect(shown).toHaveBeenLastCalledWith('until paid in full');
  });

  it('lists the sources, as links where the document has the passage', () => {
    const { root } = draw('It is so [1].\n\nSources:\n[1] "the Lender shall hold a first lien"');
    const link = root.querySelector<HTMLButtonElement>('.rl-qa-sources button');
    expect(link?.textContent).toBe('[1] “the Lender shall hold a first lien”');
  });

  it('leaves a citation to a passage that is not there as plain gray text', () => {
    const { root } = draw('It is so [1].\n\nSources:\n[1] "words the agent made up"');
    expect(root.querySelector('p .rl-qa-cite')).toBeNull();
    expect(root.querySelector('p .rl-qa-lost')?.textContent).toBe('[1]');
    const source = root.querySelector('.rl-qa-sources .rl-qa-lost');
    expect(source?.textContent).toBe('[1] “words the agent made up”');
    expect(source?.getAttribute('title')).toBe('This passage is not in the document');
    expect(root.querySelector('.rl-qa-sources button')).toBeNull();
  });

  it('leaves a marker that no source answers as it is written', () => {
    const { root } = draw('Something [3] odd.');
    expect(root.querySelector('.rl-qa-cite')).toBeNull();
    expect(root.querySelector('p')?.textContent).toBe('Something [3] odd.');
  });

  it('cuts a long source for the list', () => {
    const quote = 'word '.repeat(60).trim();
    const { root } = draw(`Body [1].\n\nSources:\n[1] "${quote}"`);
    const row = root.querySelector('.rl-qa-source')?.textContent ?? '';
    expect(row.endsWith('…”')).toBe(true);
    expect(row.length).toBeLessThan(110);
  });

  it('keeps the keyboard where it is when a citation is pressed', () => {
    const { root } = draw('So [1].\n\nSources:\n[1] "until paid in full"');
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    root.querySelector('.rl-qa-cite')?.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
  });
});
