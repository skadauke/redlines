// About Redlines: the icon changes mark when it is clicked, and draws no red line.

import { expect, test } from '../src/journey.ts';
import { shotName, writeShot } from '../src/shots.ts';

test.describe('about @views', () => {
  test('clicking the icon changes the mark, with no red line drawn across it', async ({
    start,
  }) => {
    const j = await start({ doc: 'Hello\n', tracking: false });
    const { page } = j;
    await page.goto('/about.html');
    // The journeys run with reduced motion; the full animation is what is looked at here.
    await page.emulateMedia({ colorScheme: j.options.scheme, reducedMotion: 'no-preference' });
    // About has no editor to settle, so its shots are taken as they are.
    const shot = (name: string) => writeShot(page, j.info, shotName(name, j.options));
    const icon = page.locator('#icon');
    await expect(icon.locator('img')).toHaveCount(1);
    await shot('about-before');
    await icon.click();
    // A moment in, where the old animation had its red lines across the marks.
    await page.waitForTimeout(150);
    await shot('about-mid-change');
    await expect(icon.locator(':scope > :not(img)'), 'no red line is drawn').toHaveCount(0);
    await expect(icon.locator('img')).toHaveCount(1, { timeout: 2000 });
    await shot('about-after');
    await expect(page.locator('#name')).toHaveText('Redlines');
  });
});
