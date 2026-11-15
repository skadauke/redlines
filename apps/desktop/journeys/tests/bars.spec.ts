// Change bars: a hand over a bar, and every bar thickens while the pointer is over any.

import { expect, test, type Journey } from '../src/journey.ts';

const DOC = 'Alpha beta\n\nGamma delta\n\nEpsilon zeta\n';

/** A document with a tracked change on its first and last paragraphs, in Redlines. */
async function withBars(start: (o: object) => Promise<Journey>, scheme?: 'light' | 'dark') {
  const j = await start({
    doc: DOC,
    tracking: true,
    view: 'redlines',
    ...(scheme ? { scheme } : {}),
  });
  await j.caretAfter('Alpha');
  await j.type(' one');
  await j.caretAfter('Epsilon');
  await j.type(' two');
  return j;
}

/** The widths of the bars drawn, and the centers of their first and last. */
async function bars(j: Journey) {
  return j.page.evaluate(() => {
    const segs = [...document.querySelectorAll<HTMLElement>('.rl-bar-seg')];
    return {
      widths: segs.map((s) => s.getBoundingClientRect().width),
      centers: segs.map((s) => {
        const r = s.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }),
    };
  });
}

test.describe('change bars @views', () => {
  test('the pointer is a hand over a bar, and all bars thicken while it is over one', async ({
    start,
  }) => {
    const j = await withBars(start);
    const rest = await bars(j);
    expect(rest.widths.length, 'two bars are drawn').toBe(2);
    const thin = Math.max(...rest.widths);
    await j.shot('bars-at-rest');

    const [first, last] = rest.centers;
    await j.page.mouse.move(first!.x, first!.y);
    const over = await j.page.evaluate(
      ([x, y]) => getComputedStyle(document.elementFromPoint(x!, y!)!).cursor,
      [first!.x, first!.y],
    );
    expect(over, 'the cursor over a bar is a hand').toBe('pointer');
    const hot = await bars(j);
    expect(
      hot.widths.every((w, i) => w > rest.widths[i]!),
      'every bar is thicker while over one',
    ).toBe(true);
    await j.shot('bars-pointer-over');

    // Over the other bar, the same.
    await j.page.mouse.move(last!.x, last!.y);
    expect((await bars(j)).widths.every((w) => w > thin)).toBe(true);

    // Away from the bars, back to rest, and the text's cursor.
    await j.page.mouse.move(rest.centers[0]!.x + 200, rest.centers[0]!.y);
    const away = await bars(j);
    expect(
      away.widths.every((w, i) => w === rest.widths[i]),
      'bars are back to 2 px',
    ).toBe(true);
    const cursor = await j.page.evaluate(
      ([x, y]) => getComputedStyle(document.elementFromPoint(x!, y!)!).cursor,
      [rest.centers[0]!.x + 200, rest.centers[0]!.y],
    );
    expect(cursor).not.toBe('pointer');
  });

  test('a click on a bar still switches the look', async ({ start }) => {
    const j = await withBars(start);
    const { centers } = await bars(j);
    await j.page.mouse.click(centers[0]!.x, centers[0]!.y);
    expect((await j.uiState())['view']).toBe('simple');
    // And the bars still thicken in the simple look.
    await j.settle();
    const again = await bars(j);
    const thin = Math.max(...again.widths);
    // The pointer is already there: it leaves and comes back, as a hand does.
    await j.page.mouse.move(again.centers[0]!.x + 200, again.centers[0]!.y);
    await j.page.mouse.move(again.centers[0]!.x, again.centers[0]!.y);
    expect((await bars(j)).widths.every((w) => w > thin)).toBe(true);
  });
});
