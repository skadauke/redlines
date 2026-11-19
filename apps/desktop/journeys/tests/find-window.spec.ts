// Find is a window you can move, Esc in the document closes it, and its matches are a soft gray with
// no box (#1189).

import { expect, test, type Journey } from '../src/journey.ts';

const DOC = [
  'The cat sat on the mat.',
  '',
  'A second cat slept by the door, and a third cat watched.',
  '',
  'Last of all, the cat left.',
  '',
].join('\n');

const panel = (j: Journey) => j.page.locator('.rl-find-bar');

test.describe('the Find window @views', () => {
  test('moves by its edge, and stays there', async ({ start }) => {
    const j = await start({ doc: DOC, tracking: false, view: 'clean' });
    await j.press('ControlOrMeta+f');
    await j.type('cat');
    await expect(panel(j)).toBeVisible();
    const before = (await panel(j).boundingBox())!;
    // The bar's own padding, above the first row: no control.
    const grab = { x: before.x + before.width / 2, y: before.y + 2 };
    await j.page.mouse.move(grab.x, grab.y);
    await j.page.mouse.down();
    await j.page.mouse.move(grab.x - 400, grab.y + 260, { steps: 6 });
    await j.page.mouse.up();
    const after = (await panel(j).boundingBox())!;
    expect(Math.round(before.x - after.x)).toBe(400);
    expect(Math.round(after.y - before.y)).toBe(260);
    await j.shot('moved');
    // Typing still goes to the box, and Esc in the document closes it.
    await j.type('s');
    await j.click('second');
    await j.press('Escape');
    await expect(panel(j)).toBeHidden();
    // Open again: where it was left.
    await j.press('ControlOrMeta+f');
    const again = (await panel(j).boundingBox())!;
    expect(Math.round(again.x)).toBe(Math.round(after.x));
    expect(Math.round(again.y)).toBe(Math.round(after.y));
  });

  test('draws its matches with no box, the current one stronger', async ({ start }) => {
    const j = await start({ doc: DOC, tracking: false, view: 'clean' });
    await j.press('ControlOrMeta+f');
    await j.type('cat');
    const look = (selector: string) =>
      j.page
        .locator(selector)
        .first()
        .evaluate((node) => {
          const style = getComputedStyle(node);
          return {
            outline: style.outlineStyle,
            radius: style.borderTopLeftRadius,
            background: style.backgroundColor,
          };
        });
    const match = await look('.rl-find-match:not(.rl-find-current)');
    const current = await look('.rl-find-current');
    expect(match.outline).toBe('none');
    expect(current.outline).toBe('none');
    expect(match.radius).toBe('0px');
    expect(match.background).not.toBe(current.background);
    await j.shot('matches');
  });
});
