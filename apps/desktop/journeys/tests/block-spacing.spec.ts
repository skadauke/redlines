// The space between a table, a quote, a code block and an alert that follow each other (#1183): the
// same as between paragraphs, in every look and at every text size. What is measured is what is
// drawn: a table's box, a quote's bar, a code block's tint and an alert's tint, and the gap between
// one and the next.

import { expect, test } from '../src/journey.ts';

const DOC = [
  '# Copy out',
  '',
  'The **bold** word, some `inline code`, and a plan.',
  '',
  '| Left | Centered | Right |',
  '| :--- | :---: | ---: |',
  '| a | b | c |',
  '',
  '> A quote, and a line of code under it.',
  '',
  '```js',
  'const total = items.length;',
  '```',
  '',
  '| Left | Right |',
  '| :--- | ---: |',
  '| a | b |',
  '',
  '| Another | table |',
  '| :--- | ---: |',
  '| c | d |',
  '',
  '> A quote after a table.',
  '',
  '> [!NOTE]',
  '> An alert after a quote.',
  '',
  '```js',
  'const two = 2;',
  '```',
  '',
  'The end.',
  '',
].join('\n');

interface Box {
  what: string;
  top: number;
  bottom: number;
}

test.describe('the space between blocks @blocks', () => {
  test('a table, a quote, a code block and an alert are apart as paragraphs are', async ({
    start,
  }) => {
    const j = await start({ doc: DOC, tracking: false, view: 'redlines' });
    await j.page.setViewportSize({ width: 1000, height: 1400 });
    await j.caretAtEnd();
    await j.page.waitForTimeout(400);
    const boxes = await j.page.evaluate((): { boxes: Box[]; paragraph: number } => {
      const px = (value: string) => parseFloat(value) || 0;
      const children = [
        ...document.querySelectorAll<HTMLElement>(
          '.cm-content > .cm-line, .cm-content > .rl-tbl-scroll',
        ),
      ];
      const out: Box[] = [];
      const join = (what: string, top: number, bottom: number) => {
        const last = out.at(-1);
        // The lines of one block are one box (a quote's, a code block's, an alert's).
        if (last && last.what === what && Math.abs(top - last.bottom) < 1) last.bottom = bottom;
        else out.push({ what, top, bottom });
      };
      for (const el of children) {
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        if (el.classList.contains('rl-tbl-scroll')) {
          // The table's rows, inside the room around them and the spacer that may stand above.
          const rows = [...el.querySelectorAll('.rl-trow')];
          if (rows.length === 0) continue;
          join(
            'table',
            rows[0]!.getBoundingClientRect().top,
            rows.at(-1)!.getBoundingClientRect().bottom,
          );
        } else if (el.classList.contains('rl-quote')) {
          // The bar is clipped to the text's own lines: the space above and below is not drawn.
          const above = /\brl-space-(?:block|h1|heading)\b/.test(el.className);
          const below = /-below\b/.test(el.className);
          join(
            'quote',
            rect.top + (above ? px(style.paddingTop) : 0),
            rect.bottom - (below ? px(style.paddingBottom) : 0),
          );
        } else if (el.classList.contains('rl-codeblock')) {
          // Under a tinted box the space is padding on the first line, clipped out of the tint.
          const apart = /-apart\b/.test(el.className);
          const clipped = /-clip\b/.test(el.className);
          join(
            'code',
            rect.top + (apart ? px(style.paddingTop) : 0),
            rect.bottom - (clipped ? px(style.paddingBottom) : 0),
          );
        } else if (el.classList.contains('rl-callout')) {
          const apart = /-apart\b/.test(el.className);
          join('alert', rect.top + (apart ? px(style.paddingTop) - 10 * 1 : 0), rect.bottom);
        }
      }
      const para = [...document.querySelectorAll<HTMLElement>('.cm-line.rl-space-block')].find(
        (el) =>
          el.textContent?.startsWith('The **bold**') || el.textContent?.startsWith('The bold'),
      );
      return { boxes: out, paragraph: para ? px(getComputedStyle(para).paddingTop) : 16 };
    });
    // The pairs that follow each other in the file, and nothing between them but a blank line.
    expect(boxes.boxes.map((box) => box.what)).toEqual([
      'table',
      'quote',
      'code',
      'table',
      'table',
      'quote',
      'alert',
      'code',
    ]);
    for (let i = 1; i < boxes.boxes.length; i++) {
      const gap = boxes.boxes[i]!.top - boxes.boxes[i - 1]!.bottom;
      // The space a paragraph has above it (its padding), less a pixel for the rounding; a table's
      // own 6 px of room are already outside what is measured.
      expect(
        gap,
        `${boxes.boxes[i - 1]!.what} to ${boxes.boxes[i]!.what} is as far apart as paragraphs`,
      ).toBeGreaterThanOrEqual(boxes.paragraph - 1);
    }
    await j.shot('block-spacing');
  });
});
