// An answer as the bubble shows it: the prose, light Markdown (code, bold, bulleted and numbered
// lists), and its citations as links to the passages of the document. The text is the agent's, so the
// DOM is built with `textContent` only. A citation whose words are no longer in the document, or
// never were, is plain text and no link.

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
/** A line of a bulleted list: `-`, `*` or `•`, white space, then the item. Indented ones are the same list. */
const BULLET = /^\s*[-*•]\s+(.*)$/;
/** A line of a numbered list: `1.` or `1)`, white space, then the item. */
const NUMBERED = /^\s*(\d{1,6})[.)]\s+(.*)$/;

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

/** What a run of lines is: the lines of a paragraph, or the items of a list. */
type Group =
  | { kind: 'text'; items: string[] }
  | { kind: 'bullets' | 'numbers'; items: string[]; start: number };

/**
 * Sorts the lines of a block into paragraphs and lists, line by line: a list may follow a line of
 * text directly, with no blank line between. Lines that start `- `, `* ` or `• ` make a bulleted
 * list, and lines that start `1. ` or `1) ` a numbered one, whatever the depth they are indented
 * to: a list inside a list is flattened into it. Any other line is text, joined to the line before
 * it, but an indented one under an item goes on with the item.
 */
function grouped(lines: readonly string[]): Group[] {
  const groups: Group[] = [];
  for (const line of lines) {
    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    const last = groups.at(-1);
    if (bullet || numbered) {
      const kind = bullet ? 'bullets' : 'numbers';
      const item = (bullet ? bullet[1] : numbered?.[2]) ?? '';
      if (last?.kind === kind) last.items.push(item);
      else groups.push({ kind, items: [item], start: numbered ? Number(numbered[1]) : 1 });
    } else if (last && last.kind !== 'text' && /^\s/.test(line)) {
      const at = last.items.length - 1;
      last.items[at] = `${last.items[at] ?? ''} ${line.trim()}`;
    } else if (last?.kind === 'text') {
      last.items.push(line.trim());
    } else {
      groups.push({ kind: 'text', items: [line.trim()] });
    }
  }
  return groups;
}

/** Draws an answer's prose and its sources. */
export function renderAnswer(text: string, deps: AnswerDeps): HTMLElement {
  const { body, sources } = parseAnswer(text);
  const byNumber = new Map(sources.map(({ n, quote }) => [n, quote]));
  const root = el('div', 'rl-qa-answer');
  for (const block of body.split(/\n\s*\n/)) {
    const lines = block.split('\n').filter((line) => line.trim() !== '');
    for (const group of grouped(lines)) {
      if (group.kind === 'text') {
        const paragraph = el('p');
        inline(paragraph, group.items.join(' '), byNumber, deps);
        root.append(paragraph);
        continue;
      }
      const list = el(group.kind === 'bullets' ? 'ul' : 'ol');
      // A list that a blank line cut in two goes on from where it was, not from 1.
      if (group.kind === 'numbers' && group.start !== 1) {
        list.setAttribute('start', String(group.start));
      }
      for (const item of group.items) {
        const entry = el('li');
        inline(entry, item, byNumber, deps);
        list.append(entry);
      }
      root.append(list);
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
