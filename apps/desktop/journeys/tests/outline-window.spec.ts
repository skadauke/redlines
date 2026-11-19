// The title bar's outline button opens the outline as a window, at every text size (#1193), also
// where the margin has no room for the outline's lines.

import { expect, test, type Journey } from '../src/journey.ts';

const DOC = [
  '# Plan',
  '',
  'Intro text.',
  '',
  '## Scope',
  '',
  'What is in.',
  '',
  '### Not in scope',
  '',
  'What is out.',
  '',
  '## Schedule',
  '',
  'When.',
  '',
].join('\n');

const button = (j: Journey) => j.page.getByRole('button', { name: 'Outline', exact: true });
const window_ = (j: Journey) => j.page.locator('.rl-outline[data-floating="true"]');

test.describe('the outline window @views', () => {
  for (const textSize of [1, 4]) {
    test(`opens from the button at ${textSize * 100}% text, goes to a heading and away`, async ({
      start,
    }) => {
      const j = await start({ doc: DOC, tracking: false, view: 'clean', textSize });
      await expect(window_(j)).toHaveCount(0);
      await expect(button(j)).toHaveAttribute('aria-pressed', 'false');
      await button(j).click();
      await expect(window_(j)).toBeVisible();
      await expect(button(j)).toHaveAttribute('aria-pressed', 'true');
      await expect(window_(j).locator('.rl-outline-item')).toHaveText([
        'Plan',
        'Scope',
        'Not in scope',
        'Schedule',
      ]);
      // Under the button, inside the window, over the page.
      const size = j.page.viewportSize();
      const [card, control] = await Promise.all([
        window_(j).locator('.rl-outline-panel').boundingBox(),
        button(j).boundingBox(),
      ]);
      expect(card!.y).toBeGreaterThanOrEqual(control!.y + control!.height);
      expect(card!.x + card!.width).toBeLessThanOrEqual(size!.width);
      expect(card!.x).toBeGreaterThanOrEqual(0);
      await j.shot(`outline-window-${textSize * 100}`);
      await window_(j)
        .getByRole('button', { name: /^Schedule/ })
        .click();
      await expect(window_(j)).toHaveCount(0);
      await expect(button(j)).toHaveAttribute('aria-pressed', 'false');
      expect((await j.caret()).lineText).toBe('## Schedule');
    });
  }

  test('is put away by the button again, by Esc and by a press in the text', async ({ start }) => {
    const j = await start({ doc: DOC, tracking: false, view: 'clean' });
    await button(j).click();
    await expect(window_(j)).toBeVisible();
    await button(j).click();
    await expect(window_(j)).toHaveCount(0);
    await button(j).click();
    await j.press('Escape');
    await expect(window_(j)).toHaveCount(0);
    await button(j).click();
    await j.click('Intro');
    await expect(window_(j)).toHaveCount(0);
  });
});
