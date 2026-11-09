// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import {
  findCitations,
  renderCommentText,
  resolveCitation,
  type CommentTextDeps,
} from './comment-text.ts';

const LINKS: Record<string, string> = {
  '/proj/docs/notes/out.ts': '/outside/x.ts',
};

const agent = { handle: 'claude-bo', name: 'Claude', agent: true } as const;
const bo = { handle: 'bo', name: 'Bo Chen' } as const;

const FILES = new Set([
  '/proj/src/importer.ts',
  '/proj/importer.ts',
  '/proj/docs/format.md',
  '/proj/docs/notes/a.ts',
  '/etc/passwd',
  '/outside/x.ts',
  '/proj/logo.png',
  '/proj/docs/paper.pdf',
  '/proj/a.zip',
  '/proj/docs.d',
]);

let unique = 0;

/**
 * Deps for a document of its own, so that what one test finds isn't remembered by the next. As the
 * app has them, a document opens in a window, an image or a PDF in its default app, and any other
 * file nowhere.
 */
function deps(over: Partial<CommentTextDeps> = {}): CommentTextDeps & {
  opened: string[];
  asked: string[];
  refused: string[];
} {
  const opened: string[] = [];
  const asked: string[] = [];
  const refused: string[] = [];
  const document = `/proj/docs/design-${unique++}.md`;
  return {
    opened,
    asked,
    refused,
    documentPath: () => document,
    projectFolder: () => Promise.resolve('/proj'),
    realPath: (path) => {
      const real = LINKS[path] ?? path;
      return FILES.has(real) || real === '/proj'
        ? Promise.resolve(real)
        : Promise.reject(new Error('no'));
    },
    opensIn: (path) =>
      /\.(md|txt)$/.test(path) ? 'window' : /\.(png|pdf)$/.test(path) ? 'default' : 'none',
    open: (path, line) => opened.push(`${path}:${line ?? ''}`),
    openDefault: (path, root) => asked.push(`${path} in ${root}`),
    cannotOpen: (path) => refused.push(path),
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

  it('opens a document at its line when the link is clicked', async () => {
    const d = deps();
    const el = renderCommentText({ by: 'bo', text: 'See format.md:42.' }, bo, d);
    await settle();
    const [link] = links(el);
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    link!.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(d.opened).toEqual(['/proj/docs/format.md:42']);
    expect(d.refused).toEqual([]);
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
    const attach = (el: Node) => document.body.append(el);
    const spy = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.querySelector('a') ? 40 : 20;
    });
    try {
      // A link that doesn't change the height (the same here as a one-line note) isn't modelled;
      // a note without a file to link never asks.
      const quiet = vi.fn();
      attach(
        renderCommentText({ by: 'bo', text: 'Plain words, gone.ts', resized: quiet }, bo, deps()),
      );
      await settle();
      expect(quiet).not.toHaveBeenCalled();
      const grew = vi.fn();
      attach(
        renderCommentText({ by: 'bo', text: 'See src/importer.ts:1', resized: grew }, bo, deps()),
      );
      await settle();
      expect(grew).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });

  it('does not ask again when the links leave the size as it was', async () => {
    const spy = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(20);
    try {
      const resized = vi.fn();
      document.body.append(
        renderCommentText({ by: 'bo', text: 'See src/importer.ts:1', resized }, bo, deps()),
      );
      await settle();
      expect(resized).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('links every file inside the project, and leaves a link out of it plain', async () => {
    const text = 'a.zip docs.d logo.png docs/notes/out.ts src/importer.ts';
    const d = deps();
    const el = renderCommentText({ by: 'bo', text }, bo, d);
    await settle();
    // docs/notes/out.ts is a link to a file outside the project, and docs.d no file name a
    // citation has (one letter after the dot).
    expect(links(el).map((a) => a.textContent)).toEqual(['a.zip', 'logo.png', 'src/importer.ts']);
  });

  it('opens an image and a PDF in their default app, never in a window', async () => {
    const d = deps();
    const el = renderCommentText({ by: 'bo', text: 'logo.png and paper.pdf' }, bo, d);
    await settle();
    for (const link of links(el)) link.click();
    expect(d.asked).toEqual(['/proj/logo.png in /proj', '/proj/docs/paper.pdf in /proj']);
    expect(d.opened).toEqual([]);
    expect(d.refused).toEqual([]);
  });

  it('says the app doesn’t open code or any other such file, and opens nothing', async () => {
    const d = deps();
    const el = renderCommentText({ by: 'bo', text: 'See src/importer.ts:42 and a.zip.' }, bo, d);
    await settle();
    const [code, archive] = links(el);
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    code!.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    archive!.click();
    expect(d.refused).toEqual(['/proj/src/importer.ts', '/proj/a.zip']);
    expect(d.opened).toEqual([]);
    expect(d.asked).toEqual([]);
  });

  it('keeps More open and asks for the project once, across equivalent deps', async () => {
    const calls: string[] = [];
    const base = deps();
    const make = () => ({
      ...base,
      projectFolder: (path: string) => {
        calls.push(path);
        return Promise.resolve('/proj');
      },
    });
    const entry = { id: 'r5tw', by: 'claude-bo', text: 'Short, src/importer.ts.\n\nThe rest.' };
    const el = renderCommentText(entry, agent, make());
    [...el.querySelectorAll('button')].find((b) => b.textContent === 'More')!.click();
    await settle();
    const again = renderCommentText({ ...entry }, agent, make());
    await settle();
    expect(again.textContent).toContain('The rest.');
    expect(calls).toHaveLength(1);
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
