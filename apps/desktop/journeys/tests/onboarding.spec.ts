// The first-launch onboarding (#1206, design §5.11a), in its two windows on the dev page. The first
// three screens are the Preferences window's Welcome mode (`/preferences.html?welcome`, where the
// installs only say so); the tour is the document window's (`/?onboarding`). Each screen and card
// has a picture in the look the run is in.

import type { Page } from '@playwright/test';
import { expect, test } from '../src/journey.ts';

/** The page in the look of the run (what `start` does for the other journeys), with a quiet window. */
async function open(page: Page, url: string): Promise<void> {
  const scheme = test.info().project.name.startsWith('dark') ? 'dark' : 'light';
  await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
  await page.addInitScript((appearance) => {
    localStorage.setItem(
      'redlines.settings',
      JSON.stringify({ appearance, textSize: 1, showWordCount: false }),
    );
  }, scheme);
  await page.goto(url);
}

test('the Welcome mode of Preferences: you, your agent, and set up this Mac', async ({ page }) => {
  const look = test.info().project.name;
  // Each screen is reached with the keyboard: after a mouse click WebKit draws the focus ring of the
  // select (or leaves it out) as its timing falls, and the pointer is left over whichever button
  // the next card puts there (hovered, or not). The pointer is also moved to an empty place.
  const shot = async (name: string) => {
    await page.mouse.move(2, 790);
    await expect.soft(page).toHaveScreenshot(`onboarding-${name}-${look}.png`, { timeout: 10_000 });
  };
  await open(page, '/preferences.html?welcome');
  const sheet = page.locator('.rl-onb');
  await expect(sheet).toBeVisible();

  // 1. You.
  await expect(sheet).toContainText('Who are you?');
  await expect(sheet.getByLabel('Handle')).not.toHaveValue('');
  await shot('1-you');
  await sheet.getByRole('button', { name: 'Continue' }).press('Enter');

  // 2. Your agent.
  await expect(sheet).toContainText('Your agent');
  await expect(sheet.locator('select')).toBeVisible();
  // The card focuses the select itself, and WebKit draws its ring or not as its timing falls (the
  // runner's pictures differ): leave and enter it by key, which always draws the ring.
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(sheet.locator('select')).toBeFocused();
  expect(await sheet.locator('select').evaluate((el) => el.matches(':focus-visible'))).toBe(true);
  await shot('2-agent');
  await sheet.getByRole('button', { name: 'Continue' }).press('Enter');

  // 3. Set up this Mac: the three rows, then what each install said.
  await expect(sheet).toContainText('Set up this Mac');
  await expect(sheet.locator('.rl-onb-install')).toHaveCount(3);
  await shot('3-setup');
  await sheet.getByRole('button', { name: 'Install and Continue' }).press('Enter');
  await expect(sheet.locator('.rl-onb-install-result').nth(2)).toContainText('Installed');
  await shot('3-setup-done');
  await sheet.getByRole('button', { name: 'Continue' }).press('Enter');
  await expect(page.locator('.rl-sheet-backdrop')).toHaveCount(0);
  // It tells the document window, which then runs the tour, and is done for good.
  expect(await page.evaluate(() => localStorage.getItem('redlines.onboarding'))).toBe('done');
  expect(await page.evaluate(() => localStorage.getItem('redlines.welcome-result'))).toContain(
    'finished',
  );
});

test('Skip Setup ends the Welcome mode from the first screen, and says it was skipped', async ({
  page,
}) => {
  await open(page, '/preferences.html?welcome');
  await page.locator('.rl-onb').getByRole('button', { name: 'Skip Setup' }).click();
  await expect(page.locator('.rl-sheet-backdrop')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('redlines.welcome-result'))).toContain(
    'skipped',
  );
});

test('the tour: the pen, the views button and the command palette', async ({ page }) => {
  const look = test.info().project.name;
  const shot = (name: string) =>
    expect.soft(page).toHaveScreenshot(`onboarding-${name}-${look}.png`, { timeout: 10_000 });
  await open(page, '/?onboarding');
  const card = page.locator('.rl-tour-card');
  await expect(card).toContainText('The Redlines pen');
  await expect(page.locator('[data-tour="pen"]')).toHaveClass(/rl-tour-target/);
  await shot('4a-pen');
  await card.getByRole('button', { name: 'Next' }).click();
  await expect(card).toContainText('Views');
  await shot('4b-views');
  await card.getByRole('button', { name: 'Next' }).click();
  await expect(card).toContainText('⇧⌘P');
  await shot('4c-palette');
  await card.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('.rl-tour-card')).toHaveCount(0);
  await expect(page.locator('.rl-tour-target')).toHaveCount(0);
});
