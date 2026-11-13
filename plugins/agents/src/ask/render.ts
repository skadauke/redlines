// An answer as the bubble shows it: the prose, light Markdown (code, bold, a bulleted list), and its
// citations as links to the passages of the document. The text is the agent's, so the DOM is built
// with `textContent` only. A citation whose words are no longer in the document, or never were, is
// plain gray text and no link.

import { parseAnswer } from './answer.ts';

export interface AnswerDeps {
  /** Whether the passage `quote` is in the document now: a citation to it is a link. */
  has(quote: string): boolean;
  /** Shows the passage `quote` in the document. */
  show(quote: string): void;
}

/** The most characters of a source's words the list shows. */
const SOURCE_SHOWN = 90;

/** Code, bold and a citation marker. */
const INLINE = /`([^`\n]+)`|\*\*([^*\n]+)\*\*|\[(\d{1,2})\]/g;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const made = document.createElement(tag);
  if (className) made.className = className;
  if (text !== undefined) made.textContent = text;
  return made;
}

/** `quote` on one line, cut for the list. */
function shown(quote: string): string {
  const flat = quote.replace(/\s+/g, ' ').trim();
  return flat.length > SOURCE_SHOWN ? `${flat.slice(0, SOURCE_SHOWN - 1).trimEnd()}…` : flat;
}

/** Draws `text` into `into`: its code, its bold words and its citations as links. */
function inline(
  into: HTMLElement,
  text: string,
  sources: ReadonlyMap<number, string>,
  deps: AnswerDeps,
): void {
  let at = 0;
  for (const match of text.matchAll(INLINE)) {
    if (match.index > at) into.append(text.slice(at, match.index));
    const [whole, code, bold, number] = match;
    if (code !== undefined) into.append(el('code', undefined, code));
    else if (bold !== undefined) into.append(el('strong', undefined, bold));
    else {
      const quote = sources.get(Number(number));
      if (quote !== undefined && deps.has(quote)) {
        const cite = el('button', 'rl-qa-cite', whole);
        cite.type = 'button';
        cite.setAttribute('aria-label', `Show passage ${number}`);
        cite.addEventListener('mousedown', (event) => event.preventDefault());
        cite.addEventListener('click', () => deps.show(quote));
        into.append(cite);
      } else {
        into.append(quote === undefined ? whole : el('span', 'rl-qa-lost', whole));
      }
    }
    at = match.index + whole.length;
  }
  if (at < text.length) into.append(text.slice(at));
}

/** Draws an answer's prose and its sources. */
export function renderAnswer(text: string, deps: AnswerDeps): HTMLElement {
  const { body, sources } = parseAnswer(text);
  const byNumber = new Map(sources.map(({ n, quote }) => [n, quote]));
  const root = el('div', 'rl-qa-answer');
  for (const block of body.split(/\n\s*\n/)) {
    const lines = block.split('\n').filter((line) => line.trim() !== '');
    if (lines.length === 0) continue;
    if (lines.every((line) => /^\s*[-*•]\s+/.test(line))) {
      const list = el('ul');
      for (const line of lines) {
        const item = el('li');
        inline(item, line.replace(/^\s*[-*•]\s+/, ''), byNumber, deps);
        list.append(item);
      }
      root.append(list);
    } else {
      const paragraph = el('p');
      inline(paragraph, lines.map((line) => line.trim()).join(' '), byNumber, deps);
      root.append(paragraph);
    }
  }
  if (sources.length > 0) {
    const list = el('div', 'rl-qa-sources');
    for (const { n, quote } of sources) {
      const label = `[${n}] “${shown(quote)}”`;
      const row = el('div', 'rl-qa-source');
      if (deps.has(quote)) {
        const link = el('button', 'rl-qa-cite', label);
        link.type = 'button';
        link.addEventListener('mousedown', (event) => event.preventDefault());
        link.addEventListener('click', () => deps.show(quote));
        row.append(link);
      } else {
        row.className = 'rl-qa-source rl-qa-lost';
        row.title = 'This passage is not in the document';
        row.textContent = label;
      }
      list.append(row);
    }
    root.append(list);
  }
  return root;
}
