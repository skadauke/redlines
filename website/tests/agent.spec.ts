import { expect, test, type Page } from '@playwright/test';
import { noSidewaysScroll } from './helpers';

// The agent panel: the real editor with a scripted Claude the visitor asks. Run after
// `npm run embed && npm run build`.

const REPLY = 'Now 5, per uploader.ts:88. Fixed.';
const sheet = (page: Page) => page.locator('#changes figure.sheet');
const editor = (page: Page) => sheet(page).locator('.cm-content');
/** The editor's side of the sheet: the fallback under it is hidden, with the same words. */
const live = (page: Page) => sheet(page).locator('.rl-embed');

/** Loads the page, scrolls to the panel and waits for its editor. */
async function open(page: Page) {
  await page.goto('/');
  await page.locator('#changes').scrollIntoViewIfNeeded();
  await expect(editor(page)).toContainText('Uploads retry', { timeout: 8000 });
}

/** Asks Claude, and posts the question from the keyboard. */
async function ask(page: Page) {
  await sheet(page).getByRole('button', { name: 'Ask Claude' }).click();
  await expect(sheet(page).locator('textarea')).toHaveValue(/@Claude is this still right/);
  await page.keyboard.press('ControlOrMeta+Enter');
}

test('Ask Claude, then Post from the keyboard, brings a reply and a tracked edit', async ({
  page,
}) => {
  await open(page);
  await ask(page);
  await expect(editor(page).locator('.rl-ins')).toContainText('5', { timeout: 5000 });
  await expect(live(page).getByText(REPLY)).toBeVisible();
});

test('shows the live line, Stop and the reply with no click on a dot', async ({ page }) => {
  await open(page);
  await ask(page);
  await expect(live(page).getByRole('button', { name: 'Stop' })).toBeVisible({ timeout: 3000 });
  await expect(live(page).getByText(REPLY)).toBeVisible({ timeout: 5000 });
});

test('Stop works from the keyboard', async ({ page }) => {
  await open(page);
  await ask(page);
  const stop = sheet(page).getByRole('button', { name: 'Stop' });
  await expect(stop).toBeVisible({ timeout: 3000 });
  // The note opened by itself, with the keyboard still in the document: Stop is a few Tabs away,
  // after the note's own Reply and Resolve.
  for (let i = 0; i < 4 && !(await stop.evaluate((el) => el === document.activeElement)); i++) {
    await page.keyboard.press('Tab');
  }
  await expect(stop).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(live(page).getByText('Stopped.')).toBeVisible();
  await page.waitForTimeout(2500);
  await expect(live(page).getByText(REPLY)).toHaveCount(0);
});

test('Accept works from the keyboard', async ({ page }) => {
  await open(page);
  await ask(page);
  await expect(editor(page).locator('.rl-ins')).toContainText('5', { timeout: 5000 });
  const review = sheet(page).getByRole('button', { name: 'Review' });
  await review.focus();
  await page.keyboard.press('Enter');
  const accept = sheet(page).locator('.rl-review-bar').getByRole('button', { name: 'Accept' });
  await expect(accept).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(editor(page).locator('.rl-ins')).toHaveCount(0);
  await expect(editor(page)).toContainText('Uploads retry 5 times with backoff');
});

// Review Focus 3.
test('the agent panel fits 320 px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await open(page);
  await ask(page);
  await expect(editor(page).locator('.rl-ins')).toContainText('5', { timeout: 5000 });
  await expect(live(page).getByText(REPLY)).toBeVisible();
  await sheet(page).getByRole('button', { name: 'Review' }).click();
  const bar = sheet(page).locator('.rl-review-bar');
  await expect(bar).toBeVisible();
  const box = (await bar.boundingBox())!;
  const frame = (await sheet(page).boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(frame.x - 0.5);
  expect(box.x + box.width).toBeLessThanOrEqual(frame.x + frame.width + 0.5);
  expect(box.y + box.height).toBeLessThanOrEqual(frame.y + frame.height + 0.5);
  expect(await noSidewaysScroll(page)).toBe(true);

  const boxes = await sheet(page)
    .locator('button')
    .evaluateAll((els) =>
      els
        .filter((el) => el.getClientRects().length > 0)
        .map((el) => {
          const r = el.getBoundingClientRect();
          return { name: el.textContent?.trim() ?? '', l: r.left, t: r.top, r: r.right, b: r.bottom };
        }),
    );
  for (const [i, a] of boxes.entries()) {
    for (const b of boxes.slice(i + 1)) {
      const apart = a.r <= b.l + 0.5 || b.r <= a.l + 0.5 || a.b <= b.t + 0.5 || b.b <= a.t + 0.5;
      expect(apart, `${a.name} and ${b.name} overlap`).toBe(true);
    }
  }
});
