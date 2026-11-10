import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { noSidewaysScroll, watchRequests } from './helpers';

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
    expect(path, path).toMatch(
      /^\/embed\/(redlines-embed-[\w-]+\.(js|css)|fonts\/[\w.-]+\.woff2)$/,
    );
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

// The controls and the editor under them.

const editor = (page: Page) => sheet(page).locator('.cm-content');

/** Loads the page and waits for the editor in the hero. */
async function open(page: Page) {
  await page.goto('/');
  await expect(editor(page)).toContainText('Launch plan', { timeout: 5000 });
}

/** Puts the caret just after `word` in the document, with a click there. */
async function clickAfter(page: Page, word: string) {
  const at = await page.evaluate((text) => {
    const root = document.querySelector('section[aria-labelledby="hero-title"] .cm-content')!;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const index = node.textContent?.indexOf(text) ?? -1;
      if (index < 0) continue;
      const range = document.createRange();
      range.setStart(node, index + text.length);
      range.setEnd(node, index + text.length);
      const rect = range.getBoundingClientRect();
      return { x: rect.left, y: rect.top + rect.height / 2 };
    }
    return null;
  }, word);
  expect(at, `"${word}" in the editor`).not.toBeNull();
  await page.mouse.click(at!.x, at!.y);
  await expect(editor(page)).toBeFocused();
}

const caption = (page: Page) =>
  sheet(page).locator('p', { hasText: /^(Type anywhere|Track Changes is off)/ });

test('types a tracked insertion, shows it in Raw, and resets', async ({ page }) => {
  await open(page);
  const inserts = editor(page).locator('.rl-ins');
  const before = await inserts.count();
  const markers = async () => (await editor(page).innerText()).split('<!--ins').length - 1;
  await sheet(page).getByRole('button', { name: 'Raw' }).click();
  const rawBefore = await markers();
  await sheet(page).getByRole('button', { name: 'Redlines' }).click();
  await clickAfter(page, 'importer');
  await page.keyboard.type('x');
  await expect(inserts).toHaveCount(before + 1);
  await expect(caption(page)).toHaveText('Type anywhere. Your edits are tracked, in your color.');

  await sheet(page).getByRole('button', { name: 'Raw' }).click();
  expect(await markers()).toBe(rawBefore + 1);

  await sheet(page).getByRole('button', { name: 'Reset' }).click();
  await expect(inserts).toHaveCount(before);
  await expect(sheet(page).getByRole('button', { name: 'Redlines' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(caption(page)).toHaveText('Type anywhere. Your edits are tracked, in your color.');
});

test('with Track Changes off, types plain text, and the caption says so', async ({ page }) => {
  await open(page);
  const inserts = editor(page).locator('.rl-ins');
  const before = await inserts.count();
  await sheet(page).getByRole('button', { name: 'Track Changes' }).click();
  await expect(caption(page)).toHaveText('Track Changes is off: your edits are plain text.');
  await clickAfter(page, 'importer');
  await page.keyboard.type('x');
  await expect(editor(page)).toContainText('importerx');
  await expect(inserts).toHaveCount(before);
});

test('Tab reaches the controls and the editor, and leaves it', async ({ page }) => {
  await open(page);
  await hero(page).getByRole('link', { name: 'View on GitHub' }).focus();
  const focused = () =>
    page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      return el?.matches('.cm-content') ? 'editor' : (el?.textContent ?? '').trim();
    });
  const seen: string[] = [];
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Tab');
    seen.push(await focused());
  }
  expect(seen.slice(0, 8)).toEqual([
    'Clean',
    'Redlines',
    'Raw',
    'Track Changes',
    'Comment',
    'Review',
    'Reset',
    'editor',
  ]);
  // The editor is no trap: after it comes the comment's dot in the margin (a button, the keyboard's
  // way to the note), and then the page.
  const inEditor = () => page.evaluate(() => !!document.activeElement?.closest('.cm-editor'));
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement?.className)).toContain('rl-note-dot');
  await page.keyboard.press('Tab');
  expect(await inEditor()).toBe(false);
});

// Nothing jumps when the controls appear: the bar keeps room for the rows they take.
for (const width of [320, 375, 768, 921, 1120]) {
  test(`keeps the controls' room in the bar at ${width} px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    // The module comes late, so that the fallback's bar can be measured first.
    await page.route('**/embed/*.js', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      await route.continue();
    });
    await page.goto('/');
    const bar = sheet(page).locator('> div').first();
    await expect(bar).toBeVisible();
    const before = (await bar.boundingBox())!.height;
    await expect(sheet(page).getByRole('button', { name: 'Reset' })).toBeVisible({ timeout: 5000 });
    const after = (await bar.boundingBox())!.height;
    // Within 2 px: a browser's line heights differ by a pixel.
    expect(Math.abs(after - before)).toBeLessThanOrEqual(2);
  });
}

// Review Focus 3.
// 921 and 960 px: the hero turns two-column, and the sheet is at its narrowest.
for (const width of [320, 375, 768, 921, 960, 1120]) {
  test(`Review opens the bar inside the sheet at ${width} px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await open(page);
    await sheet(page).getByRole('button', { name: 'Review' }).click();
    const bar = sheet(page).locator('.rl-review-bar');
    await expect(bar).toBeVisible();
    const box = (await bar.boundingBox())!;
    const frame = (await sheet(page).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(frame.x - 0.5);
    expect(box.x + box.width).toBeLessThanOrEqual(frame.x + frame.width + 0.5);
    expect(box.y).toBeGreaterThanOrEqual(frame.y - 0.5);
    expect(box.y + box.height).toBeLessThanOrEqual(frame.y + frame.height + 0.5);
    expect(await noSidewaysScroll(page)).toBe(true);

    const boxes = await sheet(page)
      .locator('button')
      .evaluateAll((els) =>
        els
          .filter((el) => el.getClientRects().length > 0)
          .map((el) => {
            const r = el.getBoundingClientRect();
            return {
              name: el.textContent?.trim() ?? '',
              l: r.left,
              t: r.top,
              r: r.right,
              b: r.bottom,
            };
          }),
      );
    for (const [i, a] of boxes.entries()) {
      for (const b of boxes.slice(i + 1)) {
        const apart = a.r <= b.l + 0.5 || b.r <= a.l + 0.5 || a.b <= b.t + 0.5 || b.b <= a.t + 0.5;
        expect(apart, `${a.name} and ${b.name} overlap`).toBe(true);
      }
    }
  });
}

test('Review reaches Accept by keyboard alone, and accepts a change', async ({ page }) => {
  await open(page);
  const inserts = editor(page).locator('.rl-ins');
  const before = await inserts.count();
  await sheet(page).getByRole('button', { name: 'Review' }).focus();
  await page.keyboard.press('Enter');
  const accept = sheet(page).locator('.rl-review-bar').getByRole('button', { name: 'Accept' });
  await expect(accept).toBeFocused();
  await expect(accept).toBeEnabled();
  await page.keyboard.press('Enter');
  // The first change, Ada's insertion, is plain text now.
  await expect(inserts).toHaveCount(before - 1);
  await expect(editor(page)).toContainText('We will ship the new importer');
});

/** Pastes a paragraph with a remote image into the hero with Track Changes off, and draws it. */
async function pasteRemoteImage(page: Page) {
  await open(page);
  await sheet(page).getByRole('button', { name: 'Track Changes' }).click();
  await clickAfter(page, 'importer');
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData(
      'text/html',
      '<p>See <img src="https://example.com/remote.png" alt="a chart"></p>',
    );
    data.setData('text/plain', 'See');
    document
      .querySelector('section[aria-labelledby="hero-title"] .cm-content')!
      .dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
      );
  });
  // The caret leaves the pasted line, so that its image is drawn (and, with the policy, refused:
  // the editor swaps a refused image for its alt text, which is what is looked for here).
  await page.keyboard.press('ControlOrMeta+End');
  await expect(editor(page)).toContainText('a chart');
  await page.waitForTimeout(1000);
}

// Review Focus 1.
test('fetches nothing for an image pasted from another origin', async ({ page }) => {
  const log = await watchRequests(page);
  await pasteRemoteImage(page);
  expect(log.foreign).toEqual([]);
  const policy = await page
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute('content');
  expect(policy).toContain("img-src 'self' data:");
});

// The control: without the policy the editor does ask the other origin, so the test above holds
// because of the policy and not because the editor never draws the image.
test('would fetch the pasted image without the policy', async ({ page }) => {
  const log = await watchRequests(page);
  await page.route(
    (url) => url.pathname === '/',
    async (route) => {
      const response = await route.fetch();
      // In the markup and in the payload the client renders the head from, so that the page
      // doesn't put the policy back when it hydrates.
      const html = (await response.text()).replaceAll('Content-Security-Policy', 'X-No-Policy');
      await route.fulfill({ response, body: html });
    },
  );
  await pasteRemoteImage(page);
  expect(log.foreign).toContain('https://example.com/remote.png');
});

for (const scheme of ['light', 'dark'] as const) {
  test(`has no serious or critical accessibility violations with the editor mounted, ${scheme}`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await open(page);
    const { violations } = await new AxeBuilder({ page }).include('figure.sheet').analyze();
    const bad = violations.filter(({ impact }) => impact === 'serious' || impact === 'critical');
    expect(
      bad.map(({ id, nodes }) => `${id}: ${nodes.map((n) => n.target.join(' ')).join(', ')}`),
    ).toEqual([]);
  });
}
