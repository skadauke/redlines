// Preferences › Agents (#557, #558): a card for each agent with its Handle, and a handle that
// changes what the @ picker of a comment box offers. The page has a scripted agent with the id
// `claude` where the app has Claude Code, and no programs to look for, so the cards say they
// couldn't check; what is looked at here is the handle.

import { expect, test } from '../src/journey.ts';
import { shotName, writeShot } from '../src/shots.ts';

test.describe('the agents pane @views', () => {
  test('a handle changes the name the picker offers, and a taken one is refused', async ({
    start,
  }) => {
    const j = await start({ doc: 'Hello world, this is a sentence.\n', tracking: false });
    const prefs = await j.page.context().newPage();
    await prefs.setViewportSize({ width: 900, height: 700 });
    await prefs.goto('/preferences.html');
    await prefs.emulateMedia({ colorScheme: j.options.scheme });
    const shot = (name: string) => writeShot(prefs, j.info, shotName(name, j.options));
    await prefs.getByRole('tab', { name: 'Agents' }).click();
    const claude = prefs.locator('[data-handle-of="claude"]');
    await expect(claude).toBeVisible();
    await expect(claude.getByLabel('Handle')).toHaveValue('claude');
    await expect(claude).toContainText('Shown as Claude');
    await shot('agents-pane');

    // Another agent's handle is refused, with a note, and the old one comes back.
    await claude.getByLabel('Handle').fill('codex');
    await claude.getByLabel('Handle').blur();
    await expect(claude).toContainText('Another agent is @codex.');
    await expect(claude.getByLabel('Handle')).toHaveValue('claude');
    await shot('agents-pane-handle-refused');

    await claude.getByLabel('Handle').fill('ada');
    await claude.getByLabel('Handle').blur();
    await expect(claude).toContainText('Shown as Ada');
    await shot('agents-pane-handle-ada');

    // The document window asks the settings at its next look: the picker offers Ada.
    await j.page.bringToFront();
    await j.selectText('sentence');
    await j.page.keyboard.press('Meta+Alt+m');
    await j.page.keyboard.type('@');
    const row = j.page.locator('.rl-picker-row').first();
    await expect(row).toContainText('Ada');
    await j.shot('agents-picker-ada');

    // The Model of an agent (#530): Default, then the models its program takes.
    const model = prefs.getByLabel('Model for Claude Code');
    await expect(model.locator('option')).toHaveText(['Default', 'Opus', 'Sonnet', 'Haiku']);
    await model.selectOption('opus');
    await shot('agents-pane-model');

    // The Default agent (#528): the first control of the pane, once two agents are set up.
    await prefs.bringToFront();
    const chooser = prefs.getByLabel('Default agent');
    await expect(chooser).toBeVisible();
    await expect(chooser.locator('option')).toHaveText(['Ada', 'Codex']);
    await chooser.selectOption('codex');
    await shot('agents-pane-default-agent');
  });
});
