// #1159: a drag selection past the window's top or bottom scrolls the document with it, faster the
// farther past the edge the pointer is (CodeMirror's own drag scrolling), and keeps growing the
// selection while it scrolls.

import { expect, test, type Journey } from '../src/journey.ts';

const paragraphs = (n: number) =>
  Array.from({ length: n }, (_, i) => `Paragraph ${i + 1} has some words in it.`).join('\n\n') +
  '\n';

/** The scroll position of whatever scrolls the document, and the selection's size. */
const state = (j: Journey) =>
  j.page.evaluate(() => {
    const { view } = window.__redlines!.editor;
    let scroller: HTMLElement | null = view.contentDOM;
    while (scroller && scroller.scrollHeight <= scroller.clientHeight) {
      scroller = scroller.parentElement;
    }
    const { anchor, head } = view.state.selection.main;
    return { top: scroller?.scrollTop ?? 0, anchor, head };
  });

const STARTS: Record<string, string> = {
  paragraph: 'Opening words\n\n',
  list: '- Opening words\n- another item\n\n',
  quote: '> Opening words\n\n',
  heading: '# Opening words\n\n',
  code: '```\nOpening words\n```\n\n',
  'front matter': '---\ntitle: Opening words\n---\n\n',
  picture: '![Opening words](picture.png)\n\n',
  math: '$$\nOpening words\n$$\n\n',
  table: '| A | B |\n| --- | --- |\n| Opening words | two |\n\n',
};

test.describe('dragging a selection past the edge @selection', () => {
  for (const [kind, head] of Object.entries(STARTS)) {
    for (const tracking of [false, true]) {
      test(`a drag that starts in ${kind} scrolls past the bottom, Track Changes ${tracking ? 'on' : 'off'} (#1159)`, async ({
        start,
      }) => {
        const j = await start({ doc: `${head}${paragraphs(300)}`, tracking, view: 'clean' });
        const height = await j.page.evaluate(() => window.innerHeight);
        const at = (await j.cmText()).indexOf('Opening words') + 3;
        const from = await j.pointAt(at);
        await j.page.mouse.move(from.x + 2, from.y);
        await j.page.mouse.down();
        await j.page.mouse.move(from.x + 20, height - 100, { steps: 6 });
        await j.page.mouse.move(from.x + 20, height + 10, { steps: 4 });
        await j.page.waitForTimeout(600);
        const now = await state(j);
        await j.page.mouse.up();
        expect(now.top, `scrolled (${JSON.stringify(now)})`).toBeGreaterThan(100);
        expect(now.head, 'the selection grew').toBeGreaterThan(now.anchor + 500);
      });
    }
  }

  for (const tracking of [false, true]) {
    test(`past the bottom, then the top, scrolls and selects, Track Changes ${tracking ? 'on' : 'off'} (#1159)`, async ({
      start,
    }) => {
      const j = await start({ doc: paragraphs(300), tracking, view: 'clean' });
      const height = await j.page.evaluate(() => window.innerHeight);
      const from = await j.pointOf('Paragraph 3 ');
      await j.page.mouse.move(from.x + 2, from.y);
      await j.page.mouse.down();
      // A little way past the bottom edge.
      await j.page.mouse.move(from.x + 20, height - 100, { steps: 6 });
      await j.page.mouse.move(from.x + 20, height + 10, { steps: 4 });
      await j.page.waitForTimeout(600);
      const near = await state(j);
      console.log('NEAR', JSON.stringify(near), height);
      expect(near.top, 'the document scrolled').toBeGreaterThan(100);
      expect(near.head, 'the selection grew with it').toBeGreaterThan(near.anchor + 500);
      // Farther past the edge goes faster.
      await j.page.mouse.move(from.x + 20, height + 150, { steps: 4 });
      const mark = await state(j);
      await j.page.waitForTimeout(600);
      const far = await state(j);
      const farSpeed = far.top - mark.top;
      await j.page.mouse.move(from.x + 20, height + 10, { steps: 4 });
      const mark2 = await state(j);
      await j.page.waitForTimeout(600);
      const nearSpeed = (await state(j)).top - mark2.top;
      expect(farSpeed, 'farther is faster').toBeGreaterThan(nearSpeed * 1.5);
      // Back past the top: it scrolls up again and the selection shrinks.
      await j.page.mouse.move(from.x + 20, -60, { steps: 8 });
      const before = await state(j);
      await j.page.waitForTimeout(800);
      const up = await state(j);
      expect(up.top, 'scrolled back up').toBeLessThan(before.top - 100);
      await j.page.mouse.up();
      expect(up.head, 'the selection followed it up').toBeLessThan(far.head);
    });
  }
});
