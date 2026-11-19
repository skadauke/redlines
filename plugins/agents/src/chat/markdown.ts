// An agent's chat message as plain rendered Markdown (#1194): paragraphs, headings, bulleted and
// numbered lists, quotes, fenced code, and inline code, bold, italic and links. The text is the
// agent's, so the DOM is built with `textContent` only and never with markup, and a link is drawn
// only for an address that is a web page.

export interface MarkdownDeps {
  /** Opens a web address; without it a link is drawn as its text. */
  openLink?: (url: string) => void;
}

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

/** Code, a link, bold, then italic; the first that starts earliest wins. */
const INLINE =
  /`([^`\n]+)`|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|\*\*([^*\n]+)\*\*|__([^_\n]+)__|(?<![\w*])\*([^*\s][^*\n]*?)\*(?![\w*])|(?<![\w_])_([^_\s][^_\n]*?)_(?![\w_])/g;

function inline(into: HTMLElement, text: string, deps: MarkdownDeps): void {
  let at = 0;
  for (const match of text.matchAll(INLINE)) {
    if (match.index > at) into.append(text.slice(at, match.index));
    const [, code, label, url, bold, bold2, italic, italic2] = match;
    if (code !== undefined) into.append(el('code', undefined, code));
    else if (label !== undefined && url !== undefined) {
      if (deps.openLink) {
        const link = el('a', undefined, label);
        link.href = url;
        // The words may say one address and the link go to another: the real one shows on hover.
        link.title = url;
        link.addEventListener('click', (event) => {
          event.preventDefault();
          deps.openLink?.(url);
        });
        into.append(link);
      } else into.append(label);
    } else if (bold !== undefined || bold2 !== undefined) {
      into.append(el('strong', undefined, bold ?? bold2));
    } else into.append(el('em', undefined, italic ?? italic2));
    at = match.index + match[0].length;
  }
  if (at < text.length) into.append(text.slice(at));
}

const FENCE = /^\s{0,3}(```+|~~~+)\s*([\w+-]*)\s*$/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const BULLET = /^(\s*)[-*•+]\s+(.*)$/;
const NUMBERED = /^(\s*)(\d{1,6})[.)]\s+(.*)$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;

/** Draws `text` as the agent's message. */
export function renderMarkdown(text: string, deps: MarkdownDeps = {}): HTMLElement {
  const root = el('div', 'rl-chat-md');
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length === 0) return;
    const p = el('p');
    inline(p, paragraph.join(' '), deps);
    root.append(p);
    paragraph = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const fence = FENCE.exec(line);
    if (fence) {
      flush();
      const marker = fence[1] ?? '```';
      const code: string[] = [];
      for (i++; i < lines.length && !(lines[i] ?? '').trimStart().startsWith(marker); i++) {
        code.push(lines[i] ?? '');
      }
      const pre = el('pre');
      pre.append(el('code', undefined, code.join('\n')));
      root.append(pre);
      continue;
    }
    if (line.trim() === '') {
      flush();
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      const level = Math.min(6, (heading[1] ?? '#').length);
      const h = el('div', `rl-chat-h rl-chat-h${Math.min(level, 3)}`);
      h.setAttribute('role', 'heading');
      h.setAttribute('aria-level', String(level));
      inline(h, heading[2] ?? '', deps);
      root.append(h);
      continue;
    }
    if (RULE.test(line)) {
      flush();
      root.append(el('hr'));
      continue;
    }
    if (QUOTE.test(line)) {
      flush();
      const quoted: string[] = [];
      for (; i < lines.length; i++) {
        const q = QUOTE.exec(lines[i] ?? '');
        if (!q) break;
        quoted.push(q[1] ?? '');
      }
      i--;
      const block = el('blockquote');
      inline(block, quoted.join(' ').trim(), deps);
      root.append(block);
      continue;
    }
    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    if (bullet || numbered) {
      flush();
      const list = el(bullet ? 'ul' : 'ol');
      if (numbered && Number(numbered[2]) !== 1) list.setAttribute('start', numbered[2] ?? '1');
      for (; i < lines.length; i++) {
        const next = lines[i] ?? '';
        const item = (bullet ? BULLET : NUMBERED).exec(next);
        if (item) {
          const li = el('li');
          inline(li, (bullet ? item[2] : item[3]) ?? '', deps);
          list.append(li);
        } else if (next.trim() !== '' && /^\s+\S/.test(next) && list.lastElementChild) {
          // A wrapped line of the item above.
          const li = list.lastElementChild as HTMLElement;
          li.append(' ');
          inline(li, next.trim(), deps);
        } else break;
      }
      i--;
      root.append(list);
      continue;
    }
    paragraph.push(line.trim());
  }
  flush();
  return root;
}
