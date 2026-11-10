import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { noSidewaysScroll, watchRequests } from './helpers';

const QUESTION = 'Who signs off on the security review?';

test('reads the same with JavaScript off', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto('/');
  const sheet = page.locator('#hero-title').locator('xpath=ancestor::section').locator('figure.sheet');
  await expect(sheet.getByText(QUESTION)).toBeVisible();
  await expect(sheet.getByRole('button')).toHaveCount(0);
  await context.close();
});

test('asks nothing of another origin, and keeps only redlines.mark', async ({ page }) => {
  const log = await watchRequests(page);
  await page.goto('/');
  // The whole page, so that everything that loads near the viewport has loaded.
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < height; y += 500) {
    await page.evaluate((to) => window.scrollTo(0, to), y);
    await page.waitForTimeout(50);
  }
  await page.waitForLoadState('networkidle');
  expect(log.foreign).toEqual([]);
  const keys = await page.evaluate(() => Object.keys(localStorage).sort());
  expect(keys).toEqual(['redlines.mark']);
});

test('marks two Redlines rows Planned, with a legend', async ({ page }) => {
  await page.goto('/');
  const compare = page.locator('#compare');
  await expect(compare.getByRole('img', { name: 'Planned' })).toHaveCount(2);
  await expect(compare.getByText('Planned: designed, not built yet.')).toBeVisible();
});

for (const scheme of ['light', 'dark'] as const) {
  test(`has no serious or critical accessibility violations, ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto('/');
    const { violations } = await new AxeBuilder({ page }).analyze();
    const bad = violations.filter(({ impact }) => impact === 'serious' || impact === 'critical');
    expect(bad.map(({ id, nodes }) => `${id}: ${nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
  });
}

for (const width of [320, 375, 768, 1120]) {
  test(`fits ${width} px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    expect(await noSidewaysScroll(page)).toBe(true);
  });
}
