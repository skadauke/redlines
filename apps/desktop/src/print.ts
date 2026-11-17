// Printing a window's page, and saving it as a PDF, which is the print dialog's button. What is
// printed is not the editor: the editor draws only the lines in view, and carries the screen's
// colors, rails and marks. The document is drawn again as clean HTML (`documentHtml` of
// `@redlines/editor`: as it reads now, with no marks) into a container that only a printed page
// shows (`print.css`), and the system is asked for its dialog once the images in it are loaded.
// The container is emptied when the dialog is done with, which is when the person is working again.

/** The id of the container whose content a printed page holds, and nothing else. */
export const PRINT_ID = 'rl-print';

/** The longest the dialog waits for the images of the page. */
export const IMAGE_WAIT_MS = 8000;

/** The container for the printed page, made on first use as the last child of the body. */
export function printContainer(doc: Document = document): HTMLElement {
  const found = doc.getElementById(PRINT_ID);
  if (found) return found;
  const container = doc.createElement('div');
  container.id = PRINT_ID;
  container.setAttribute('aria-hidden', 'true');
  doc.body.append(container);
  return container;
}

/** The number of the last page put in the container. */
let fills = 0;

/** Resolves when every image under `root` has loaded or failed, or after `timeout` ms. */
export function imagesLoaded(root: ParentNode, timeout = IMAGE_WAIT_MS): Promise<void> {
  const pending = Array.from(root.querySelectorAll('img')).filter(
    (image) => !image.complete || image.naturalWidth === 0,
  );
  const unfinished = pending.filter((image) => !image.complete);
  if (!unfinished.length) return Promise.resolve();
  return new Promise((resolve) => {
    let left = unfinished.length;
    const done = () => {
      if (--left <= 0) {
        clearTimeout(timer);
        resolve();
      }
    };
    const timer = setTimeout(resolve, timeout);
    for (const image of unfinished) {
      image.addEventListener('load', done, { once: true });
      image.addEventListener('error', done, { once: true });
    }
  });
}

/**
 * Puts `html` in the print container and waits for its images; the returned function empties the
 * container again.
 */
export async function fillPrintPage(html: string, doc: Document = document): Promise<() => void> {
  const container = printContainer(doc);
  container.innerHTML = html;
  fitTableColumns(container);
  keepHeadingsWithNext(container);
  // A release only empties the page it filled: an older print's hold may let go later, under a
  // newer page that is being written to a PDF.
  const mine = String(++fills);
  container.dataset['fill'] = mine;
  await imagesLoaded(container);
  return () => {
    if (container.dataset['fill'] === mine) container.replaceChildren();
  };
}

/** A text or code file's page: its text as it is, in the page's code face, long lines wrapped. */
export function plainPageHtml(text: string): string {
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<div data-redlines><pre><code>${escaped}</code></pre></div>`;
}

/**
 * Gives every column of every table one share of its row's width, worked out once from the whole
 * table, so that the columns are the same on every page: a column is as wide as its longest word
 * needs (up to 14 characters, and a little over), or as its text is long on average (up to 40),
 * whichever is more. Cells wrap at spaces; only a longer unbroken string, such as an address, is
 * broken anywhere (print.css).
 */
export function fitTableColumns(root: ParentNode): void {
  for (const table of Array.from(root.querySelectorAll('table'))) {
    const rows = Array.from(table.querySelectorAll('tr'));
    const columns = Math.max(0, ...rows.map((row) => row.children.length));
    for (let column = 0; column < columns; column++) {
      const texts = rows.flatMap((row) => {
        const text = row.children[column]?.textContent?.trim();
        return text ? [text] : [];
      });
      const longest = Math.max(
        0,
        ...texts.flatMap((text) => text.split(/\s+/).map((w) => w.length)),
      );
      const average = texts.reduce((sum, text) => sum + text.length, 0) / Math.max(1, texts.length);
      const share = Math.max(Math.min(longest, 14) + 3, Math.min(average, 40), 5);
      for (const row of rows) {
        const cell = row.children[column];
        if (cell instanceof HTMLElement) cell.style.flexGrow = String(Math.round(share * 10) / 10);
      }
    }
  }
}

/**
 * Keeps each heading with the start of what follows it, which WebKit's own `break-after: avoid`
 * does not (a heading is left alone at the foot of a page). The heading and the next block go in a
 * box that is not split; a table gives its head and first row, and the rest follows as a table of
 * its own, since a whole long table in the box would move to the next page and leave a gap.
 */
export function keepHeadingsWithNext(root: ParentNode): void {
  for (const heading of Array.from(root.querySelectorAll('h1, h2, h3, h4, h5, h6'))) {
    const next = heading.nextElementSibling;
    // Only a paragraph or a table: a long list or code block in the box would leave a gap.
    if (!next || !/^(?:P|TABLE)$/.test(next.tagName)) continue;
    const wrap = heading.ownerDocument.createElement('div');
    wrap.className = 'rl-keep';
    heading.before(wrap);
    wrap.append(heading);
    if (next.tagName !== 'TABLE') {
      wrap.append(next);
      continue;
    }
    const start = next.cloneNode(false) as HTMLElement;
    const head = next.querySelector('thead');
    const body = next.querySelector('tbody');
    if (head) start.append(head);
    const first = body?.querySelector('tr');
    if (first) {
      const part = heading.ownerDocument.createElement('tbody');
      part.append(first);
      start.append(part);
    }
    wrap.append(start);
    if (!body?.querySelector('tr')) next.remove();
  }
}

export interface PrintParts {
  /** The host's print: opens the dialog, and resolves without waiting for it to close. */
  print: () => Promise<void>;
  /** Puts the page to be printed in place, and returns what takes it away (`fillPrintPage`). */
  prepare: () => Promise<() => void>;
  /** Where a key or a click shows that the person is back in the document. */
  back: readonly EventTarget[];
  /** `requestAnimationFrame`. */
  frame?: (callback: () => void) => unknown;
}

/**
 * Prints the page: the document is drawn into the print container, the dialog is asked for after a
 * frame, and the container stays until the dialog is done with: the system's `afterprint` if it
 * comes, or else the person's next key or click in `back`, the parts of the window they work in,
 * which can't happen while the sheet is up, so they are back in the document. Nothing else ends
 * it: not a time, and not the window losing and regaining the focus, which app switching does
 * too (the system lays the pages out when the dialog opens and when its settings change, which is
 * as late as that). Resolves once the dialog is asked for; the page goes later by itself.
 */
export async function printPage({
  print,
  prepare,
  back,
  frame = (callback) => requestAnimationFrame(callback),
}: PrintParts): Promise<void> {
  const release = await prepare();
  let done = false;
  const stop = () => {
    if (done) return;
    done = true;
    window.removeEventListener('afterprint', stop);
    for (const part of back) {
      part.removeEventListener('keydown', stop, true);
      part.removeEventListener('mousedown', stop, true);
    }
    release();
  };
  try {
    await new Promise<void>((resolve) => frame(resolve));
    window.addEventListener('afterprint', stop);
    for (const part of back) {
      part.addEventListener('keydown', stop, true);
      part.addEventListener('mousedown', stop, true);
    }
    await print();
  } catch (error) {
    // No dialog will come.
    stop();
    throw error;
  }
}
