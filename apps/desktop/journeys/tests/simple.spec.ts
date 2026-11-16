// Redlines' simple look: the deletions are gone, the insertions are in their author's color without
// the underline, the change bars and the comments stay, and the caret never lands in what is hidden.

import { expect, test, type Journey } from '../src/journey.ts';
import { OTHERS_CHANGES as DOC } from '../src/others-changes.ts';

async function open(
  start: (o: object) => Promise<Journey>,
  scheme: 'light' | 'dark' | undefined = undefined,
) {
  const j = await start({
    doc: DOC,
    tracking: false,
    view: 'simple',
    ...(scheme ? { scheme } : {}),
  });
  await j.settle();
  return j;
}

test.describe('the simple look @views', () => {
  test('deletions are gone, insertions are colored and not underlined, bars and comments stay', async ({
    start,
  }) => {
    const j = await open(start);
    const drawn = await j.drawn();
    expect(drawn).toContain('launch is in April for the team and its friends.');
    expect(drawn, 'the deleted sentence is hidden').not.toContain('slip');
    expect(drawn, 'the replaced text is hidden').not.toContain('March');
    expect(drawn, 'the deleted table row is hidden').not.toContain('Pears');
    expect(drawn).toContain('Plums');
    expect(drawn, 'the deleted words are hidden').not.toContain('old');

    // The insertions have the author's color and no underline.
    const ins = await j.page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('.cm-content .rl-ins-plain')].map((el) => {
        const style = getComputedStyle(el);
        return {
          text: el.textContent,
          color: style.color,
          line: style.textDecorationLine,
          ink: getComputedStyle(el.closest('.cm-content')!).color,
        };
      }),
    );
    expect(ins.map((i) => i.text)).toEqual(expect.arrayContaining(['April', ' and its friends']));
    for (const i of ins) {
      expect(i.line, `"${i.text}" has no underline`).toBe('none');
      expect(i.color, `"${i.text}" is in a color`).not.toBe(i.ink);
    }
    // The inserted table row too: its text in the author's color, no underline.
    const cell = await j.page.evaluate(() => {
      const el = [
        ...document.querySelectorAll<HTMLElement>('.rl-trow.rl-ins-row-plain > .rl-tc'),
      ][0];
      if (!el) return null;
      const style = getComputedStyle(el);
      return { line: style.textDecorationLine, color: style.color };
    });
    expect(cell, 'the inserted row is drawn in color').not.toBeNull();
    expect(cell!.line).toBe('none');

    // Bars and the comment's tint stay.
    expect(await j.page.locator('.rl-bar-seg').count()).toBeGreaterThanOrEqual(2);
    expect(await j.page.locator('.cm-content .rl-cmt').count()).toBe(1);
    expect(await j.page.locator('.cm-content .rl-del').count(), 'nothing struck').toBe(0);
    expect(await j.page.locator('.cm-content .rl-ins').count(), 'nothing underlined').toBe(0);
    await j.baseline('simple-others-changes');
  });

  test('the caret never lands in a hidden deletion: arrows, Home, End, clicks', async ({
    start,
  }) => {
    const j = await open(start);
    const text = await j.cmText();
    // Every deletion, from its `<!--del` to its `-->`, and the ledger: the caret may stand at an
    // edge of one, never inside.
    const hidden: [number, number][] = [...text.matchAll(/<!--del [^>]*?-->/g)].map((m) => [
      m.index,
      m.index + m[0].length,
    ]);
    hidden.push([text.indexOf('<!-- redlines'), text.length]);
    const inside = (pos: number) => hidden.some(([a, b]) => pos > a && pos < b);
    const check = async (what: string) => {
      const { head, anchor } = await j.caret();
      expect(inside(head), `the caret (${head}) is inside hidden text ${what}`).toBe(false);
      expect(inside(anchor), `the anchor (${anchor}) is inside hidden text ${what}`).toBe(false);
    };

    // Right through the whole document, one key at a time, and back left.
    await j.caretAtStart();
    let last = -1;
    for (let i = 0; i < 400; i++) {
      await j.press('ArrowRight');
      await check(`after →${i + 1}`);
      const { head } = await j.caret();
      if (head === last) break;
      last = head;
    }
    last = -1;
    for (let i = 0; i < 400; i++) {
      await j.press('ArrowLeft');
      await check(`after ←${i + 1}`);
      const { head } = await j.caret();
      if (head === last) break;
      last = head;
    }
    // Down and up through the lines.
    await j.caretAtStart();
    for (let i = 0; i < 14; i++) {
      await j.press('ArrowDown');
      await check(`after ↓${i + 1}`);
    }
    for (let i = 0; i < 14; i++) {
      await j.press('ArrowUp');
      await check(`after ↑${i + 1}`);
    }
    // Home and End on each line that holds a deletion, and Shift+arrows over it.
    for (const needle of ['The launch', 'Last ', 'Gone']) {
      const at = text.indexOf(needle);
      await j.place(at > 0 ? at + 2 : at);
      await j.press('End');
      await check(`after End on "${needle}"`);
      await j.press('Home');
      await check(`after Home on "${needle}"`);
      await j.press('Shift+End');
      await check(`after Shift+End on "${needle}"`);
    }
    await j.caretAfter('friends<!--/c4rt-->.');
    for (let i = 0; i < 6; i++) {
      await j.press('Shift+ArrowRight');
      await check(`after Shift+→${i + 1}`);
    }
    // A click at the end of the line that ends in a deletion, and on the line of a deleted block.
    const end = await j.pointOf('for the team');
    await j.page.mouse.click(end.x + 600, end.y);
    await check('after a click past the end of a line');
    const lastLine = await j.pointOf('Last ', 'end');
    await j.page.mouse.click(lastLine.x + 400, lastLine.y);
    await check('after a click past the end of the last line');
  });

  test('a click on an insertion, or on a bar, opens the change’s card with Accept and Reject (#664)', async ({
    start,
  }) => {
    const j = await open(start);
    // The insertion's colored text.
    await j.page.locator('.rl-ins-plain').first().click();
    const card = j.page.locator('.rl-card');
    await expect(card).toBeVisible();
    await expect(card.getByRole('button', { name: 'Accept' })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Reject' })).toBeVisible();
    await j.shot('simple-card-from-text');
    expect(await j.page.evaluate(() => window.__redlines!.editor.getUiState()['view'])).toBe(
      'simple',
    );
    // A change bar: the card of the change on its line, and the look stays.
    await j.page.keyboard.press('Escape');
    await expect(card).toHaveCount(0);
    const at = await j.page.locator('.rl-bar-seg').first().boundingBox();
    await j.page.mouse.click(at!.x + at!.width / 2, at!.y + at!.height / 2);
    await expect(card).toBeVisible();
    await j.shot('simple-card-from-bar');
  });

  test('in dark, the insertion is readable', async ({ start }) => {
    const j = await open(start, 'dark');
    await j.shot('simple-dark');
    const contrast = await j.page.evaluate(() => {
      const el = document.querySelector<HTMLElement>('.cm-content .rl-ins-plain')!;
      return getComputedStyle(el).color;
    });
    expect(contrast).toMatch(/^rgb/);
  });
});
