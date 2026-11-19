// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fillPrintPage,
  imagesLoaded,
  fitTableColumns,
  keepHeadingsWithNext,
  splitLongCode,
  SHORT_CODE_LINES,
  PRINT_ID,
  plainPageHtml,
  printContainer,
  printPage,
} from './print.ts';

const immediately = (callback: () => void) => callback();

afterEach(() => document.body.replaceChildren());

describe('the print container', () => {
  it('is made once, as the last child of the body', () => {
    document.body.append(document.createElement('main'));
    const container = printContainer();
    document.body.append(document.createElement('footer'));
    expect(container.id).toBe(PRINT_ID);
    expect(printContainer()).toBe(container);
    expect(document.querySelectorAll(`#${PRINT_ID}`)).toHaveLength(1);
  });

  it('holds the page until it is released', async () => {
    const release = await fillPrintPage('<p>Hello</p>');
    expect(printContainer().innerHTML).toBe('<p>Hello</p>');
    release();
    expect(printContainer().innerHTML).toBe('');
  });

  it('lets an older page’s release leave a newer page alone', async () => {
    const first = await fillPrintPage('<p>One</p>');
    const second = await fillPrintPage('<p>Two</p>');
    first();
    expect(printContainer().innerHTML).toBe('<p>Two</p>');
    second();
    expect(printContainer().innerHTML).toBe('');
  });

  it('waits for images, and gives up on a slow one', async () => {
    vi.useFakeTimers();
    try {
      const root = document.createElement('div');
      root.innerHTML = '<img src="a.png"><img src="b.png">';
      const [a, b] = Array.from(root.querySelectorAll('img'));
      let done = false;
      void imagesLoaded(root, 1000).then(() => (done = true));
      Object.defineProperty(a, 'complete', { value: false });
      Object.defineProperty(b, 'complete', { value: false });
      await vi.advanceTimersByTimeAsync(1500);
      expect(done).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('draws a text file as it is, escaped', () => {
    expect(plainPageHtml('a < b && c')).toBe(
      '<div data-redlines><pre><code>a &lt; b &amp;&amp; c</code></pre></div>',
    );
  });
});

describe('fitTableColumns', () => {
  it('gives each column one share in every row, wide enough for its longest short word', () => {
    const root = document.createElement('div');
    root.innerHTML =
      '<table><thead><tr><th>Name</th><th>About</th></tr></thead><tbody>' +
      '<tr><td>Row 39</td><td>' +
      'a long sentence of words '.repeat(6) +
      '</td></tr>' +
      '<tr><td>Row 4</td><td>short</td></tr></tbody></table>';
    fitTableColumns(root);
    const grow = (cell: Element) => Number((cell as HTMLElement).style.flexGrow);
    const cells = Array.from(root.querySelectorAll('tr')).map((row) => Array.from(row.children));
    for (const column of [0, 1]) {
      expect(new Set(cells.map((row) => grow(row[column]!))).size).toBe(1);
    }
    expect(grow(cells[0]![0]!)).toBeGreaterThanOrEqual(6);
    expect(grow(cells[0]![1]!)).toBeGreaterThan(grow(cells[0]![0]!) * 3);
  });
});

describe('keepHeadingsWithNext', () => {
  const page = (html: string) => {
    const root = document.createElement('div');
    root.innerHTML = html;
    keepHeadingsWithNext(root);
    return root;
  };

  it('puts a heading and the paragraph after it in one box', () => {
    const root = page('<p>a</p><h2>H</h2><p>b</p><p>c</p>');
    expect(root.innerHTML).toBe('<p>a</p><div class="rl-keep"><h2>H</h2><p>b</p></div><p>c</p>');
  });

  it('gives a table’s head and first row to the box, and the rest to a table of its own', () => {
    const root = page(
      '<h2>T</h2><table><thead><tr><th>h</th></tr></thead><tbody><tr><td>1</td></tr><tr><td>2</td></tr></tbody></table>',
    );
    const box = root.querySelector('.rl-keep');
    expect(box?.querySelectorAll('tr')).toHaveLength(2);
    expect(root.querySelectorAll('table')).toHaveLength(2);
    expect(root.querySelectorAll('tr')).toHaveLength(3);
  });

  it('leaves a heading at the end, or before a list or a long code block, as it is', () => {
    expect(page('<p>a</p><h2>B</h2>').innerHTML).toBe('<p>a</p><h2>B</h2>');
    expect(page('<h2>B</h2><ul><li>x</li></ul>').innerHTML).toBe('<h2>B</h2><ul><li>x</li></ul>');
    // A long block would leave a gap in a box.
    expect(page('<h2>B</h2><pre class="rl-long">x</pre>').innerHTML).toBe(
      '<h2>B</h2><pre class="rl-long">x</pre>',
    );
  });

  it('keeps a heading with a short code block or a picture whole', () => {
    expect(page('<h2>B</h2><pre>x</pre>').innerHTML).toBe(
      '<div class="rl-keep"><h2>B</h2><pre>x</pre></div>',
    );
    expect(page('<h2>B</h2><p><img src="a.png"></p>').innerHTML).toBe(
      '<div class="rl-keep"><h2>B</h2><p><img src="a.png"></p></div>',
    );
  });

  it('keeps a chain of headings with what follows the last', () => {
    const root = page('<h1>A</h1><h2>B</h2><h3>C</h3><p>text</p><p>more</p>');
    const outer = root.querySelector('.rl-keep');
    expect(outer?.firstElementChild?.tagName).toBe('H1');
    expect(outer?.querySelectorAll('h1, h2, h3, p')).toHaveLength(4);
    expect(root.children).toHaveLength(2);
  });
});

describe('splitLongCode', () => {
  const lines = (n: number) => Array.from({ length: n }, (_, i) => `line ${i}`).join('\n');
  const pre = (n: number) => {
    const root = document.createElement('div');
    root.innerHTML = `<pre><code>${lines(n)}\n</code></pre>`;
    splitLongCode(root);
    return root.querySelector('pre')!;
  };

  it('marks a block of more than the short length, and no other', () => {
    expect(pre(SHORT_CODE_LINES).classList.contains('rl-long')).toBe(false);
    expect(pre(SHORT_CODE_LINES + 1).classList.contains('rl-long')).toBe(true);
  });

  it('is done before a page is filled, so that a heading is not boxed with a long block', async () => {
    const release = await fillPrintPage(`<h2>H</h2><pre>${lines(60)}</pre>`);
    expect(printContainer().querySelector('.rl-keep')).toBeNull();
    release();
  });
});

describe('printPage', () => {
  const setup = () => {
    const events: string[] = [];
    const editorDom = document.createElement('div');
    const titleBar = document.createElement('div');
    const elsewhere = document.createElement('div');
    document.body.append(editorDom, titleBar, elsewhere);
    const prepare = vi.fn(() => {
      events.push('prepare');
      return Promise.resolve(() => events.push('release'));
    });
    const print = vi.fn(() => {
      events.push('print');
      return Promise.resolve();
    });
    const parts = { print, prepare, back: [editorDom, titleBar], frame: immediately };
    return { events, editorDom, titleBar, elsewhere, parts };
  };
  const key = (target: Element) =>
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
  const click = (target: Element) =>
    target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

  it('puts the page in place before it asks for the dialog, a frame earlier', async () => {
    const { events, parts } = setup();
    let frameComes: () => void = () => {};
    const printing = printPage({ ...parts, frame: (callback) => (frameComes = callback) });
    await Promise.resolve();
    await Promise.resolve();
    expect(events).toEqual(['prepare']);
    frameComes();
    await printing;
    expect(events).toEqual(['prepare', 'print']);
  });

  it('keeps the page while the dialog is open, losing and regaining focus', async () => {
    const { events, parts } = setup();
    await printPage(parts);
    window.dispatchEvent(new Event('blur'));
    window.dispatchEvent(new Event('focus'));
    expect(events).toEqual(['prepare', 'print']);
  });

  it('lets go on the system’s afterprint', async () => {
    const { events, parts } = setup();
    await printPage(parts);
    window.dispatchEvent(new Event('afterprint'));
    expect(events).toEqual(['prepare', 'print', 'release']);
  });

  it('lets go at the person’s next key in the editor, and not at one elsewhere', async () => {
    const { events, parts, editorDom, elsewhere } = setup();
    await printPage(parts);
    key(elsewhere);
    click(elsewhere);
    expect(events).not.toContain('release');
    key(editorDom);
    expect(events).toEqual(['prepare', 'print', 'release']);
  });

  it('lets go at a click in the editor or the title bar, once', async () => {
    for (const part of ['editorDom', 'titleBar'] as const) {
      const setups = setup();
      await printPage(setups.parts);
      click(setups[part]);
      click(setups[part]);
      window.dispatchEvent(new Event('afterprint'));
      expect(setups.events.filter((event) => event === 'release')).toHaveLength(1);
    }
  });

  it('lets go at once when printing fails', async () => {
    const { events, parts, editorDom } = setup();
    await expect(
      printPage({ ...parts, print: () => Promise.reject(new Error('no printer')) }),
    ).rejects.toThrow('no printer');
    expect(events).toEqual(['prepare', 'release']);
    key(editorDom);
    expect(events).toEqual(['prepare', 'release']);
  });
});
