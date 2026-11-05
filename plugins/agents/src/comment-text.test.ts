// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import {
  findCitations,
  renderCommentText,
  resolveCitation,
  type CommentTextDeps,
} from './comment-text.ts';

const agent = { handle: 'claude-bo', name: 'Claude', agent: true } as const;
const bo = { handle: 'bo', name: 'Bo Chen' } as const;

const FILES = new Set([
  '/proj/src/importer.ts',
  '/proj/importer.ts',
  '/proj/docs/format.md',
  '/proj/docs/notes/a.ts',
  '/etc/passwd',
  '/outside/x.ts',
]);

function deps(over: Partial<CommentTextDeps> = {}): CommentTextDeps & { opened: string[] } {
  const opened: string[] = [];
  return {
    opened,
    documentPath: () => '/proj/docs/design.md',
    projectFolder: () => Promise.resolve('/proj'),
    exists: (path) => Promise.resolve(FILES.has(path)),
    open: (path, line) => opened.push(`${path}:${line ?? ''}`),
    ...over,
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const links = (el: Node) => [...(el as HTMLElement).querySelectorAll('a')];

describe('findCitations', () => {
  it('finds a file with a line, a path, and a path in a folder', () => {
    const text = 'CRLF handled in importer.ts:42, see docs/format.md and src/a.ts:3.';
    const found = findCitations(text);
    expect(found.map(({ path, line }) => [path, line])).toEqual([
      ['importer.ts', 42],
      ['docs/format.md', undefined],
      ['src/a.ts', 3],
    ]);
    const [first] = found;
    expect(text.slice(first!.from, first!.to)).toBe('importer.ts:42');
  });

  it('leaves out abbreviations, numbers, URLs and a full stop', () => {
    expect(findCitations('Fine, e.g. this, i.e. that, 1.5 times, v1.2.3, done.')).toEqual([]);
    expect(findCitations('See https://example.com/a/b.ts:3 and http://x.org/y.md.')).toEqual([]);
  });

  it('does not take a sentence full stop into the path', () => {
    const [found] = findCitations('Look at src/a.ts.');
    expect(found).toEqual({ from: 8, to: 16, path: 'src/a.ts' });
  });
});

describe('resolveCitation', () => {
  it('tries the document folder, then the project root, and nothing outside it', () => {
    expect(resolveCitation('importer.ts', '/proj/docs', '/proj')).toEqual([
      '/proj/docs/importer.ts',
      '/proj/importer.ts',
    ]);
    expect(resolveCitation('../src/importer.ts', '/proj/docs', '/proj')).toEqual([
      '/proj/src/importer.ts',
    ]);
    expect(resolveCitation('../../etc/passwd', '/proj/docs', '/proj')).toEqual([]);
    expect(resolveCitation('/etc/passwd', '/proj/docs', '/proj')).toEqual([]);
    expect(resolveCitation('/proj/src/importer.ts', '/proj/docs', '/proj')).toEqual([
      '/proj/src/importer.ts',
    ]);
  });
});

describe('renderCommentText', () => {
  const longer = 'Fixed in importer.ts:42.\n\nThe parser read CRLF as two breaks.\n\nAlso a.ts.';

  it("folds an agent's comment after its first paragraph", () => {
    const el = renderCommentText({ by: 'claude-bo', text: longer }, agent, deps());
    expect(el.textContent).toContain('Fixed in importer.ts:42.');
    expect(el.textContent).not.toContain('The parser');
    expect(el.textContent).toContain('More');
  });

  it("never folds a person's comment", () => {
    const el = renderCommentText({ by: 'bo', text: longer }, bo, deps());
    expect(el.textContent).toContain('The parser read CRLF');
    expect(el.textContent).not.toContain('More');
  });

  it('does not fold a comment that has one paragraph', () => {
    const el = renderCommentText({ by: 'claude-bo', text: 'Done.' }, agent, deps());
    expect(el.textContent).toBe('Done.');
  });

  it('opens More in place, and saves nothing about it', () => {
    const d = deps();
    const resized = vi.fn();
    const entry = { by: 'claude-bo', text: longer, resized };
    const el = renderCommentText(entry, agent, d);
    const more = [...el.querySelectorAll('button')].find((b) => b.textContent === 'More')!;
    more.click();
    expect(el.textContent).toContain('The parser read CRLF');
    expect(resized).toHaveBeenCalledTimes(1);
    // Drawn again, as a note is: it is still open.
    const again = renderCommentText(entry, agent, d);
    expect(again.textContent).toContain('The parser read CRLF');
    // Another comment is not opened by it.
    const other = renderCommentText({ by: 'claude-bo', text: 'Hi.\n\nMore here.' }, agent, d);
    expect(other.textContent).not.toContain('More here.');
  });

  it('draws plain first, then links a file that exists inside the project', async () => {
    const text =
      'importer.ts:42 and ../../etc/passwd and /etc/passwd and gone.ts and /outside/x.ts';
    const resized = vi.fn();
    const el = renderCommentText({ by: 'bo', text, resized }, bo, deps());
    expect(links(el)).toEqual([]);
    expect(el.textContent).toBe(text);
    await settle();
    // importer.ts is found at the project root, not next to the document.
    expect(links(el).map((a) => a.textContent)).toEqual(['importer.ts:42']);
    expect(el.textContent).toBe(text);
  });

  it('opens the file at its line when the link is clicked', async () => {
    const d = deps();
    const el = renderCommentText({ by: 'bo', text: 'See src/importer.ts:42.' }, bo, d);
    await settle();
    const [link] = links(el);
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    link!.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(d.opened).toEqual(['/proj/src/importer.ts:42']);
  });

  it('links a file named inside the folded part too', async () => {
    const el = renderCommentText(
      { by: 'claude-bo', text: 'Short.\n\nSee docs/format.md:9.' },
      agent,
      deps(),
    );
    await settle();
    [...el.querySelectorAll('button')].find((b) => b.textContent === 'More')!.click();
    expect(links(el).map((a) => a.textContent)).toEqual(['docs/format.md:9']);
  });

  it('asks the rail to measure again only when a size changed', async () => {
    const resized = vi.fn();
    let height = 20;
    const proto = HTMLElement.prototype;
    const spy = vi.spyOn(proto, 'offsetHeight', 'get').mockImplementation(() => height);
    try {
      renderCommentText({ by: 'bo', text: 'Plain words.', resized }, bo, deps());
      await settle();
      expect(resized).not.toHaveBeenCalled();
      const exists = vi.fn(() => {
        height = 40;
        return Promise.resolve(true);
      });
      renderCommentText({ by: 'bo', text: 'See src/importer.ts:1', resized }, bo, deps({ exists }));
      await settle();
      expect(resized).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });

  it('builds the text without markup, whatever the comment holds', async () => {
    const text = '<img src=x onerror=alert(1)> src/importer.ts:1 <b>';
    const el = renderCommentText({ by: 'bo', text }, bo, deps());
    await settle();
    expect(el.textContent).toBe(text);
    expect(el.querySelector('img, b')).toBeNull();
  });

  it('stays plain with no folder to resolve against', async () => {
    const el = renderCommentText(
      { by: 'bo', text: 'src/importer.ts:1' },
      bo,
      deps({ documentPath: () => null, projectFolder: () => Promise.resolve(null) }),
    );
    await settle();
    expect(links(el)).toEqual([]);
  });
});
