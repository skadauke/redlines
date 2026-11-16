// The sidebar's edge is dragged to resize it, and dragged shut to close it (#680).

import { expect, test } from '../src/journey.ts';

test.describe('the sidebar width', () => {
  test('is dragged by its edge, kept, and closed by a drag past the minimum', async ({ start }) => {
    const j = await start({ doc: 'One two three\n', tracking: false, view: 'clean' });
    const aside = j.page.locator('.rl-sidebar');
    const edge = j.page.locator('.rl-sidebar-resize');
    const width = async () => (await aside.boundingBox())?.width ?? -1;
    const drag = async (to: number) => {
      const box = await edge.boundingBox();
      if (!box) throw new Error('No edge');
      const y = box.y + box.height / 2;
      const x = box.x + box.width / 2;
      await j.page.mouse.move(x, y);
      await j.page.mouse.down();
      await j.page.mouse.move((x + to) / 2, y, { steps: 4 });
      await j.page.mouse.move(to, y, { steps: 4 });
      await j.page.mouse.up();
    };

    await j.press('Control+Meta+s');
    await expect(aside).toBeVisible();
    await expect.poll(width).toBe(240);
    await expect(edge).toHaveCSS('cursor', 'col-resize');

    await drag(340);
    await expect.poll(width).toBeGreaterThan(330);
    expect(await width()).toBeLessThan(350);
    await j.shot('sidebar-wide');

    // Kept: closed with the keys and opened again, it is as wide as it was.
    const kept = await width();
    await j.press('Control+Meta+s');
    await expect.poll(width).toBe(0);
    await j.press('Control+Meta+s');
    await expect.poll(width).toBe(kept);

    await drag(60);
    await expect(j.page.locator('.rl-app')).toHaveAttribute('data-sidebar', 'closed');
    await expect.poll(width).toBe(0);
    await j.shot('sidebar-dragged-shut');

    // Open again, it has the width it had before the drag that closed it.
    await j.press('Control+Meta+s');
    await expect.poll(width).toBe(kept);
  });
});
