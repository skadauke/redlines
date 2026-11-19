// #1160: in a long selection, every line that is drawn is drawn selected, whatever block it is
// in (a paragraph, heading, list, task, quote, code block, table, picture, math, HTML block, callout,
// footnote, front matter) and however far it has been scrolled since the selection was made. A long
// document of every kind of block is selected whole and scrolled screen by screen; every line whole
// in the window must lie inside the browser's selection and have the selection's color drawn on it.

import { expect, test, type Journey, type ViewName } from '../src/journey.ts';

declare global {
  interface Window {
    __redlinesImages?: { opened: string[]; replace(path: string, blob: Blob): void };
  }
}

const BLOCKS = [
  'Plain paragraph words here.',
  '## Heading words here',
  '- list item words\n- second item words\n  - nested item words',
  '1. numbered words\n2. second numbered words',
  '- [ ] task words here',
  '> quote words here\n>\n> second quote words',
  '```js\nconst code = 1;\nconst more = 2;\n```',
  '| Head A | Head B |\n| --- | --- |\n| cell one | cell two |\n| cell three | cell four |',
  '![A red square](red.png)',
  '$$\nx^2 + y^2\n$$',
  '<div>html block words</div>',
  '---',
  '> [!NOTE]\n> callout words here',
  '[^1]: footnote words here',
  'A line with **bold** and *italic* and `code` and a [link](https://example.org).',
];

const FRONT = '---\ntitle: Front matter words\n---\n\n';
const longDoc = (rounds: number) =>
  FRONT +
  Array.from({ length: rounds }, (_, n) =>
    BLOCKS.map((block) => `${block}\n\nText after ${n}.`).join('\n\n'),
  ).join('\n\n') +
  '\n';

interface Row {
  top: number;
  height: number;
  left: number;
  width: number;
  text: string;
  inside: boolean;
}

/** The lines now drawn, with whether the browser's selection reaches each. */
const rowsOf = (j: Journey) =>
  j.page.evaluate(() => {
    const { view } = window.__redlines!.editor;
    const selection = getSelection()!;
    const range = selection.rangeCount ? selection.getRangeAt(0) : null;
    const rows: Row[] = [];
    for (const line of view.contentDOM.querySelectorAll<HTMLElement>(':scope > .cm-line')) {
      const box = line.getBoundingClientRect();
      // Only the lines whole in the window, under the title bar.
      if (box.top < 60 || box.bottom > window.innerHeight - 2 || box.height < 3) continue;
      if (!line.textContent?.trim() && !line.querySelector('img')) continue;
      rows.push({
        top: box.top,
        height: box.height,
        left: box.left,
        width: box.width,
        text: (line.textContent ?? '').slice(0, 30),
        inside: !!range?.intersectsNode(line),
      });
    }
    return rows;
  });

/** How many pixels of each box turned the selection's color between two screenshots. */
async function changed(j: Journey, a: Buffer, b: Buffer, rows: Row[]): Promise<number[]> {
  return j.page.evaluate(
    async ({ a, b, rows }) => {
      const draw = async (data: string) => {
        const bitmap = await createImageBitmap(
          await (await fetch(`data:image/png;base64,${data}`)).blob(),
        );
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const context = canvas.getContext('2d')!;
        context.drawImage(bitmap, 0, 0);
        return { context, scale: bitmap.width / window.innerWidth };
      };
      const first = await draw(a);
      const second = await draw(b);
      return rows.map((row) => {
        const s = first.scale;
        const box = [
          Math.round(row.left * s),
          Math.round(Math.max(row.top, 0) * s),
          Math.max(1, Math.round(row.width * s)),
          Math.max(1, Math.round(row.height * s)),
        ] as const;
        const one = first.context.getImageData(...box).data;
        const two = second.context.getImageData(...box).data;
        let count = 0;
        for (let i = 0; i < one.length; i += 4) {
          // The system's selection color, and a pixel the screenshot before did not have of it.
          const blue = (d: Uint8ClampedArray) =>
            d[i + 2]! > 235 && d[i]! > 150 && d[i]! < 205 && d[i + 1]! > 190 && d[i + 1]! < 230;
          if (blue(two) && !blue(one)) count++;
        }
        return count;
      });
    },
    { a: a.toString('base64'), b: b.toString('base64'), rows },
  );
}

for (const view of ['clean', 'redlines', 'simple'] as ViewName[]) {
  test(`every drawn line of a long selection is drawn selected, ${view} (#1160)`, async ({
    start,
  }) => {
    // One 800 ms wait for the selection's repaint per screen: CI's runner is slower than 30 s.
    test.setTimeout(60_000);
    const j = await start({ doc: longDoc(3), tracking: false, view });
    await j.page.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 120;
      canvas.height = 60;
      const context = canvas.getContext('2d')!;
      context.fillStyle = '#c33';
      context.fillRect(0, 0, 120, 60);
      const blob = await new Promise<Blob>((done) => canvas.toBlob((b) => done(b!), 'image/png'));
      window.__redlinesImages!.replace('red.png', blob);
    });
    await j.settle();
    await j.caretAtEnd();
    const total = await j.page.evaluate(() => {
      let scroller: HTMLElement | null = window.__redlines!.editor.view.contentDOM;
      while (scroller && scroller.scrollHeight <= scroller.clientHeight) {
        scroller = scroller.parentElement;
      }
      return scroller ? scroller.scrollHeight : 0;
    });
    const go = (top: number) =>
      j.page.evaluate((top) => {
        let scroller: HTMLElement | null = window.__redlines!.editor.view.contentDOM;
        while (scroller && scroller.scrollHeight <= scroller.clientHeight) {
          scroller = scroller.parentElement;
        }
        if (scroller) scroller.scrollTop = top;
      }, top);
    const screens: number[] = [];
    for (let top = 0; top < total; top += 600) screens.push(top);
    const before: Buffer[] = [];
    for (const top of screens) {
      await go(top);
      await j.page.waitForTimeout(80);
      before.push(await j.page.screenshot());
    }
    // The selection of the whole document, as a long drag or shift-click leaves it.
    await j.page.evaluate(() => {
      const { view } = window.__redlines!.editor;
      view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });
    });
    await j.settle();
    const bad: string[] = [];
    for (const [n, top] of screens.entries()) {
      await go(top);
      await j.page.waitForTimeout(800);
      const rows = await rowsOf(j);
      const after = await j.page.screenshot();
      const counts = await changed(j, before[n]!, after, rows);
      rows.forEach((row, i) => {
        if (!row.inside) bad.push(`outside the selection: "${row.text}" at ${top}`);
        else if (counts[i]! < 8) bad.push(`not drawn selected: "${row.text}" at ${top}`);
      });
    }
    expect(bad, 'lines that are not drawn selected').toEqual([]);
  });
}
