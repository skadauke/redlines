// Images: one alone in its paragraph is drawn the same, centered, with Track Changes on or off.

import { expect, test } from '../src/journey.ts';

test.describe('images @blocks', () => {
  for (const tracking of [false, true]) {
    test(`an image alone in its paragraph is centered, Track Changes ${tracking ? 'on' : 'off'}`, async ({
      start,
    }) => {
      const j = await start({ doc: 'Intro\n\n', tracking, view: 'redlines' });
      await j.caretAtEnd();
      await j.paste('![A cat](https://example.com/cat.png)');
      await j.press('Enter', 'Enter');
      await j.type('After');
      await j.settle();
      await j.shot(`image-alone-${tracking ? 'tracked' : 'plain'}`);
      const image = j.page.locator('.rl-image');
      await expect(image, 'the image is drawn').toHaveCount(1);
      await expect(image, 'it is drawn as an image alone in its paragraph').toHaveClass(
        /rl-image-own/,
      );
      // Its middle is the column's middle.
      const [box, column] = await j.page.evaluate(() => {
        const rect = (el: Element | null) => el!.getBoundingClientRect();
        const img = rect(document.querySelector('.rl-image'));
        const line = rect(document.querySelector('.rl-image')!.closest('.cm-line'));
        return [img.left + img.width / 2, line.left + line.width / 2];
      });
      expect(Math.abs(box! - column!), 'it is centered in the column').toBeLessThan(2);
    });
  }

  test('an image among words stays in its line', async ({ start }) => {
    const j = await start({
      doc: 'Words ![A cat](https://example.com/cat.png) more words\n',
      tracking: false,
      view: 'redlines',
    });
    await j.caretAtStart();
    await expect(j.page.locator('.rl-image')).not.toHaveClass(/rl-image-own/);
  });
});
