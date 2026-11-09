import { describe, expect, it, vi } from 'vitest';
import { openCitation } from './citation-open.ts';

const setUp = () => ({
  allowDocument: vi.fn<(path: string) => Promise<void>>(() => Promise.resolve()),
  openInNewWindow: vi.fn(),
  notice: vi.fn(),
});

describe('openCitation', () => {
  it('allows a Markdown file before it opens the window', async () => {
    const deps = setUp();
    const order: string[] = [];
    deps.allowDocument.mockImplementation(() => {
      order.push('allow');
      return Promise.resolve();
    });
    deps.openInNewWindow.mockImplementation(() => order.push('open'));
    await openCitation(deps, '/p/docs/a.md', 4);
    expect(order).toEqual(['allow', 'open']);
    expect(deps.openInNewWindow).toHaveBeenCalledWith('/p/docs/a.md', 4);
  });

  it('allows a plain text file before it opens the window, as it does Markdown', async () => {
    const deps = setUp();
    const order: string[] = [];
    deps.allowDocument.mockImplementation((path) => {
      order.push(`allow ${path}`);
      return Promise.resolve();
    });
    deps.openInNewWindow.mockImplementation((path: string) => order.push(`open ${path}`));
    await openCitation(deps, '/p/notes.txt', 7);
    expect(order).toEqual(['allow /p/notes.txt', 'open /p/notes.txt']);
    expect(deps.openInNewWindow).toHaveBeenCalledWith('/p/notes.txt', 7);
  });

  it('shows the app’s refusal and opens nothing', async () => {
    const deps = setUp();
    deps.allowDocument.mockRejectedValue('“a.md” is outside this folder.');
    await openCitation(deps, '/p/a.md');
    expect(deps.notice).toHaveBeenCalledWith('“a.md” is outside this folder.');
    expect(deps.openInNewWindow).not.toHaveBeenCalled();
  });

  it('says it could not open the file when the refusal has no line', async () => {
    const deps = setUp();
    deps.allowDocument.mockRejectedValue(new Error('no'));
    await openCitation(deps, '/p/a.md');
    expect(deps.notice).toHaveBeenCalledWith('Couldn’t open “a.md”.');
  });

  it('opens other text without asking the app to allow it', async () => {
    const deps = setUp();
    await openCitation(deps, '/p/src/a.ts', 2);
    expect(deps.allowDocument).not.toHaveBeenCalled();
    expect(deps.openInNewWindow).toHaveBeenCalledWith('/p/src/a.ts', 2);
  });
});
