import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { watchRequests } from './helpers';

// The hero's demo panel: the real editor, loaded after the page, with a fallback when it can't be.
// Run after `npm run embed && npm run build`.

const QUESTION = 'Who signs off on the security review?';
const hero = (page: Page) => page.locator('section[aria-labelledby="hero-title"]');
const sheet = (page: Page) => hero(page).locator('figure.sheet');

/** The bundle's files, as the build's manifest names them. */
function bundle() {
  const manifest = JSON.parse(readFileSync('out/embed/manifest.json', 'utf8')) as Record<
    string,
    { file: string; isEntry?: boolean }
  >;
  const entry = Object.values(manifest).find((each) => each.isEntry)!;
  return { js: `/embed/${entry.file}` };
}

test('mounts the editor once the page has loaded', async ({ page }) => {
  const order: string[] = [];
  page.on('load', () => order.push('load'));
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/embed/')) order.push('embed');
  });
  await page.goto('/');
  await expect(sheet(page).locator('.cm-content')).toContainText('Launch plan', { timeout: 5000 });
  expect(order.indexOf('embed')).toBeGreaterThan(order.indexOf('load'));
  await expect(sheet(page).getByText(QUESTION).first()).toBeHidden();
});

test('loads one module for the page', async ({ page }) => {
  const log = await watchRequests(page);
  await page.goto('/');
  await expect(sheet(page).locator('.cm-content')).toBeVisible({ timeout: 5000 });
  await page.waitForLoadState('networkidle');
  expect(log.embed.filter((path) => path === bundle().js)).toHaveLength(1);
});

test('requests only its own files', async ({ page }) => {
  const log = await watchRequests(page);
  await page.goto('/');
  await expect(sheet(page).locator('.cm-content')).toBeVisible({ timeout: 5000 });
  await page.waitForLoadState('networkidle');
  expect(log.foreign).toEqual([]);
  expect(log.embed.length).toBeGreaterThan(0);
  for (const path of log.embed) {
    expect(path, path).toMatch(/^\/embed\/(redlines-embed-[\w-]+\.(js|css)|fonts\/[\w.-]+\.woff2)$/);
  }
});

/** The fallback stays: shown, no editor, no error on the page. */
async function expectFallback(page: Page, errors: Error[]) {
  await page.waitForTimeout(3000);
  await expect(sheet(page).getByText(QUESTION)).toBeVisible();
  await expect(sheet(page).locator('.cm-content')).toHaveCount(0);
  await expect(sheet(page).getByRole('button')).toHaveCount(0);
  expect(errors).toEqual([]);
}

test('keeps the fallback when the embed cannot load', async ({ page }) => {
  const errors: Error[] = [];
  page.on('pageerror', (error) => errors.push(error));
  await page.route('**/embed/**', (route) => route.abort());
  await page.goto('/');
  await expectFallback(page, errors);
});

// Review Focus 4.
test('keeps the fallback when mountDemo throws', async ({ page }) => {
  const errors: Error[] = [];
  page.on('pageerror', (error) => errors.push(error));
  await page.route('**/embed/*.js', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: "export function mountDemo() { throw new Error('test') }",
    }),
  );
  await page.goto('/');
  await expectFallback(page, errors);
});

test('keeps the fallback without IntersectionObserver', async ({ page }) => {
  const errors: Error[] = [];
  page.on('pageerror', (error) => errors.push(error));
  await page.addInitScript(() => {
    delete (window as { IntersectionObserver?: unknown }).IntersectionObserver;
  });
  await page.goto('/');
  await expectFallback(page, errors);
});
