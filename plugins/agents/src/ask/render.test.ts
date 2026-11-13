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
