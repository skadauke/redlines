// The first-launch onboarding (#1206, design §5.11a) on the dev page, where `?onboarding` runs it
// with installs that only say so: the four screens, and the three cards of the tour, each with a
// picture in the look the run is in. It asserts what each screen offers and that the sheet ends.

import type { Page } from '@playwright/test';
import { expect, test } from '../src/journey.ts';

/** The page in the look of the run (what `start` does for the other journeys), with a quiet window. */
async function open(page: Page): Promise<void> {
  const scheme = test.info().project.name.startsWith('dark') ? 'dark' : 'light';
  await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
  await page.addInitScript((appearance) => {
    localStorage.setItem(
      'redlines.settings',
      JSON.stringify({ appearance, textSize: 1, showWordCount: false }),
    );
  }, scheme);
  await page.goto('/?onboarding');
}

test('the onboarding: you, your agent, set up this Mac, and the tour', async ({ page }) => {
  const look = test.info().project.name;
  const shot = (name: string) =>
    expect(page).toHaveScreenshot(`onboarding-${name}-${look}.png`, { timeout: 10_000 });
  await open(page);
  const sheet = page.locator('.rl-onb');
  await expect(sheet).toBeVisible();

  // 1. You.
  await expect(sheet).toContainText('Who are you?');
  await expect(sheet.getByLabel('Handle')).not.toHaveValue('');
  await shot('1-you');
  await sheet.getByRole('button', { name: 'Continue' }).click();

  // 2. Your agent.
  await expect(sheet).toContainText('Your agent');
  await expect(sheet.locator('select')).toBeVisible();
  await shot('2-agent');
  await sheet.getByRole('button', { name: 'Continue' }).click();

  // 3. Set up this Mac: the three rows, then what each install said.
  await expect(sheet).toContainText('Set up this Mac');
  await expect(sheet.locator('.rl-onb-install')).toHaveCount(3);
  await shot('3-setup');
  await sheet.getByRole('button', { name: 'Install and Continue' }).click();
  await expect(sheet.locator('.rl-onb-install-result').nth(2)).toContainText('Installed');
  await shot('3-setup-done');
  await sheet.getByRole('button', { name: 'Continue' }).click();

  // 4. The tour: the pen, the views button, the command palette.
  const card = page.locator('.rl-tour-card');
  await expect(card).toContainText('The Redlines pen');
  await expect(page.locator('[data-tour="pen"]')).toHaveClass(/rl-tour-target/);
  await shot('4a-pen');
  await card.getByRole('button', { name: 'Next' }).click();
  await expect(card).toContainText('Views');
  await shot('4b-views');
  await card.getByRole('button', { name: 'Next' }).click();
  await expect(card).toContainText('command palette');
  await shot('4c-palette');
  await card.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('.rl-tour-card')).toHaveCount(0);
  await expect(page.locator('.rl-tour-target')).toHaveCount(0);
  await expect(page.locator('.rl-sheet-backdrop')).toHaveCount(0);
});

test('Skip Setup ends the onboarding from the first screen', async ({ page }) => {
  await open(page);
  await page.locator('.rl-onb').getByRole('button', { name: 'Skip Setup' }).click();
  await expect(page.locator('.rl-sheet-backdrop')).toHaveCount(0);
  await expect(page.locator('.rl-tour-card')).toHaveCount(0);
});
