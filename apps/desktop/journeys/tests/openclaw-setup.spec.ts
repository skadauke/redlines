// The OpenClaw setup in a window of its own (openclaw-setup.html): larger than Preferences, with the
// sheet's steps in a column that reads well. The page has scripted answers (src/preferences/
// dev-openclaw.ts); what is looked at is the layout of each step, and that Cancel finishes the
// sheet. In the app the window is closed by it, which a plain page can't do.

import { expect, test } from '../src/journey.ts';
import { shotName, writeShot } from '../src/shots.ts';

test.describe('the OpenClaw setup window @views', () => {
  test('its steps have room, in a window of the app’s size', async ({ start }) => {
    const j = await start({ doc: 'Hello\n', tracking: false });
    const page = await j.page.context().newPage();
    // The window opens at 780 by 720 points.
    await page.setViewportSize({ width: 780, height: 720 });
    await page.emulateMedia({ colorScheme: j.options.scheme });
    const shot = (name: string) => writeShot(page, j.info, shotName(name, j.options));

    await page.goto('/openclaw-setup.html');
    const sheet = page.locator('.rl-oc-sheet');
    await expect(sheet.getByRole('heading', { name: 'Add an OpenClaw agent' })).toBeVisible();
    await shot('setup-window-start');

    // The sheet is a column in the middle of the window, no wider than it reads well.
    const box = await sheet.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(600);
    expect(box?.width ?? 0).toBeLessThanOrEqual(680);
    // Its text is the theme's size, never under 13 points.
    const size = await sheet
      .locator('.rl-oc-sub')
      .evaluate((node) => parseFloat(getComputedStyle(node).fontSize));
    expect(size).toBeGreaterThanOrEqual(13);

    await sheet.getByRole('button', { name: 'Continue' }).click();
    await expect(sheet.getByText('Step 1 of 5')).toBeVisible();
    await shot('setup-window-this-mac');

    await sheet.getByRole('button', { name: 'Continue' }).click();
    await expect(sheet.getByText('Step 2 of 5')).toBeVisible();
    await shot('setup-window-computer');

    // Nothing is cut off at the window's sides, and the page never scrolls sideways.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow, 'no sideways scroll').toBe(false);

    // The window can be made smaller, down to its minimum, and the text wraps instead of squeezing.
    await page.setViewportSize({ width: 560, height: 480 });
    await shot('setup-window-computer-smallest');
    const small = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(small, 'no sideways scroll at the smallest').toBe(false);
  });

  test('the other steps and a failure, at the window’s size', async ({ start }) => {
    const j = await start({ doc: 'Hello\n', tracking: false });
    const page = await j.page.context().newPage();
    await page.setViewportSize({ width: 780, height: 720 });
    await page.emulateMedia({ colorScheme: j.options.scheme });
    const shot = (name: string) => writeShot(page, j.info, shotName(name, j.options));

    await page.goto('/openclaw-setup.html?oc=prompt&agent=Moby');
    await expect(page.locator('.rl-oc-sheet')).toContainText('Step 3 of 5');
    await shot('setup-window-prompt');

    await page.goto('/openclaw-setup.html?oc=approve&node=not-approved');
    await expect(page.locator('.rl-oc-fail')).toBeVisible();
    await shot('setup-window-approval-failed');

    await page.goto('/openclaw-setup.html?oc=mac&ts=missing');
    await expect(page.locator('.rl-oc-sheet')).toContainText('Tailscale');
    await shot('setup-window-tailscale-missing');

    await page.goto('/openclaw-setup.html?oc=failures');
    await shot('setup-window-failures');
  });

  // Tailscale on this Mac: each check turns green or acts, in plain words (the page's scripted
  // answers; the wait screens take what was done as a query, macSetupFor in dev-openclaw.ts).
  test('Tailscale on this Mac: every check and what it offers', async ({ start }) => {
    const j = await start({ doc: 'Hello\n', tracking: false });
    const page = await j.page.context().newPage();
    await page.setViewportSize({ width: 780, height: 720 });
    await page.emulateMedia({ colorScheme: j.options.scheme });
    const shot = (name: string) => writeShot(page, j.info, shotName(name, j.options));
    const sheet = page.locator('.rl-oc-sheet');
    const states: [string, string, RegExp, string[]][] = [
      [
        'missing',
        'ts=missing',
        /checks that Tailscale signed it and Apple notarized it/,
        ['Install Tailscale', 'Get it from the App Store instead'],
      ],
      ['installing', 'ts=missing&mac=installing', /Downloading Tailscale 1.80.2/, []],
      [
        'app-store',
        'ts=missing&mac=app-store',
        /aren’t an administrator/,
        ['Open the App Store again'],
      ],
      [
        'install-failed',
        'ts=missing&mac=install-failed',
        /isn’t signed by Tailscale/,
        ['Try again'],
      ],
      ['off', 'ts=off', /turned off or not started/, ['Open Tailscale']],
      ['waiting', 'ts=off&mac=waiting', /Waiting for Tailscale to start/, []],
      ['allow', 'ts=off&mac=allow', /Network Extensions/, ['Open Tailscale', 'Restart Tailscale']],
      ['sign-in', 'ts=signed-out', /Sign in with the same account/, ['Sign in to Tailscale']],
      [
        'signing-in',
        'ts=signed-out&mac=signing-in',
        /finish signing in/,
        ['Open the sign-in page again'],
      ],
      [
        'hung',
        'ts=signed-out&mac=hung',
        /still doesn’t start/,
        ['Restart Tailscale', 'Sign in to Tailscale'],
      ],
      ['ready', 'ts=ready', /Can see 3 other computers/, []],
    ];
    for (const [name, query, words, buttons] of states) {
      await page.goto(`/openclaw-setup.html?oc=mac&${query}`);
      await expect(sheet, name).toContainText(words);
      for (const label of buttons) {
        await expect(sheet.getByRole('button', { name: label }), `${name}: ${label}`).toBeVisible();
      }
      // There is no Download button anywhere.
      await expect(sheet.getByRole('button', { name: /Download/ })).toHaveCount(0);
      await shot(`setup-tailscale-${name}`);
    }
  });

  // The all-green path: the window looks around first, and opens straight on the Gateways it found.
  test('opens on the Gateways it found when everything passes, and on the choice when not', async ({
    start,
  }) => {
    const j = await start({ doc: 'Hello\n', tracking: false });
    const page = await j.page.context().newPage();
    await page.setViewportSize({ width: 780, height: 720 });
    await page.emulateMedia({ colorScheme: j.options.scheme });
    const shot = (name: string) => writeShot(page, j.info, shotName(name, j.options));
    const sheet = page.locator('.rl-oc-sheet');

    await page.goto('/openclaw-setup.html?discover=1');
    await expect(sheet.getByRole('heading', { name: 'Found your OpenClaws' })).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Connect to studio-mini' })).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Connect to home-server' })).toBeVisible();
    // The computer that is off is not asked about.
    await expect(sheet).not.toContainText('old-laptop');
    await shot('setup-gateways-found');
    await sheet.getByRole('button', { name: 'Connect to studio-mini' }).click();
    await expect(sheet).toContainText('Step 3 of 5');
    await expect(sheet).toContainText('studio-mini');
    await shot('setup-gateways-connect');

    // Nothing answers as OpenClaw: the choice, as ever.
    await page.goto('/openclaw-setup.html?discover=1&probe=none');
    await expect(sheet.getByRole('heading', { name: 'Add an OpenClaw agent' })).toBeVisible();
    // Tailscale is off: the choice too.
    await page.goto('/openclaw-setup.html?discover=1&ts=off');
    await expect(sheet.getByRole('heading', { name: 'Add an OpenClaw agent' })).toBeVisible();

    // The network's HTTPS certificates are off: said on the Mac's step, with the admin page.
    await page.goto('/openclaw-setup.html?oc=mac&ts=no-https');
    await expect(sheet).toContainText('HTTPS certificates are off for your network');
    await expect(sheet.getByRole('button', { name: 'Open the DNS page' })).toBeVisible();
    await shot('setup-https-off');
    await page.goto('/openclaw-setup.html?oc=mac');
    await expect(sheet).toContainText('HTTPS certificates are on for your network');
    await shot('setup-https-on');

    // No Gateway where Serve is off, and no certificates: the prompt for the agent, and the page.
    await page.goto('/openclaw-setup.html?oc=computer&ts=no-https&probe=none');
    await sheet.getByRole('radio', { name: 'studio-mini' }).click();
    await expect(sheet).toContainText('Tailscale Serve needs them');
    await expect(sheet.getByRole('button', { name: 'Copy a prompt for your agent' })).toBeVisible();
    await shot('setup-no-gateway-no-https');
  });

  test('Preferences › Agents has the card and a button for the setup, and no sheet', async ({
    start,
  }) => {
    const j = await start({ doc: 'Hello\n', tracking: false });
    const prefs = await j.page.context().newPage();
    await prefs.setViewportSize({ width: 560, height: 700 });
    await prefs.emulateMedia({ colorScheme: j.options.scheme });
    await prefs.goto('/preferences.html?oc=card');
    const connect = prefs.getByRole('button', { name: 'Connect OpenClaw…' });
    await expect(connect).toBeVisible();
    await expect(prefs.locator('.rl-oc-card')).toBeVisible();
    await writeShot(prefs, j.info, shotName('prefs-agents-openclaw', j.options));
    // In the app the button opens the window; in a page it opens the setup page in a tab.
    const opened = prefs.context().waitForEvent('page');
    await connect.click();
    const setup = await opened;
    await expect(setup.locator('.rl-oc-sheet')).toBeVisible();
    await expect(prefs.locator('.rl-oc-sheet')).toHaveCount(0);
  });
});
