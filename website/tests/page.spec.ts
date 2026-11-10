import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { noSidewaysScroll, watchRequests } from './helpers';

const QUESTION = 'Who signs off on the security review?';
const REPLY = 'Now 5, per uploader.ts:88. Fixed.';

test('reads the same with JavaScript off', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto('/');
  const hero = page
    .locator('#hero-title')
    .locator('xpath=ancestor::section')
    .locator('figure.sheet');
  await expect(hero.getByText(QUESTION)).toBeVisible();
  const agent = page.locator('#changes figure.sheet');
  await expect(agent.getByText(REPLY)).toBeVisible();
  // No sheet has a control that could be dead.
  await expect(page.locator('figure.sheet').getByRole('button')).toHaveCount(0);
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
  // The agent panel's whole run, from Ask Claude through Post to the reply.
  const agent = page.locator('#changes figure.sheet');
  await agent.getByRole('button', { name: 'Ask Claude' }).click();
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(agent.locator('.rl-embed').getByText('Now 5, per uploader.ts:88. Fixed.')).toBeVisible(
    { timeout: 5000 },
  );
  await page.waitForLoadState('networkidle');
  expect(log.foreign).toEqual([]);
  const keys = await page.evaluate(() => Object.keys(localStorage).sort());
  expect(keys).toEqual(['redlines.mark']);
});

// The page's Planned marks are the rows lib/compare.json calls planned; `npm run compare:check`
// holds that file to docs/design.md §4, so this holds the page to the file.
const planned = (
  JSON.parse(readFileSync('lib/compare.json', 'utf8')) as { rows: { redlines: string }[] }
).rows.filter((row) => row.redlines === 'planned').length;

test('marks the Planned Redlines rows, with a legend', async ({ page }) => {
  expect(planned).toBeGreaterThan(0);
  await page.goto('/');
  const compare = page.locator('#compare');
  await expect(compare.getByRole('img', { name: 'Planned' })).toHaveCount(planned);
  await expect(compare.getByText('Planned: designed, not built yet.')).toBeVisible();
});

for (const scheme of ['light', 'dark'] as const) {
  test(`has no serious or critical accessibility violations, ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto('/');
    const { violations } = await new AxeBuilder({ page }).analyze();
    const bad = violations.filter(({ impact }) => impact === 'serious' || impact === 'critical');
    expect(
      bad.map(({ id, nodes }) => `${id}: ${nodes.map((n) => n.target.join(' ')).join(', ')}`),
    ).toEqual([]);
  });
}

for (const width of [320, 375, 768, 1120]) {
  test(`fits ${width} px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    expect(await noSidewaysScroll(page)).toBe(true);
  });
}
