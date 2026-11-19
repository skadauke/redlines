// The document's chat in the sidebar (#1194): its second view, a message and its answer from the
// page's scripted agent, the picker of the agent and its model, and the foot.

import { expect, test } from '../src/journey.ts';

test.describe('the chat', () => {
  test('is the sidebar’s second view, answers in Markdown, and has a foot', async ({ start }) => {
    const j = await start({
      doc: 'The importer ships in April.\n\nThe tests run in CI.\n',
      tracking: false,
      view: 'clean',
      query: '?models',
    });
    const aside = j.page.locator('.rl-sidebar');
    const chat = j.page.locator('.rl-chat');

    await j.press('Control+Meta+s');
    await expect(aside).toBeVisible();
    await expect(chat).toBeHidden();
    await j.shot('chat-files-view');

    await j.page.getByRole('tab', { name: 'Chat' }).click();
    await expect(chat).toBeVisible();
    await expect(j.page.locator('.rl-chat-empty')).toBeVisible();
    await expect(j.page.locator('.rl-sidebar-foot')).toBeVisible();
    await j.shot('chat-empty');

    const field = j.page.locator('.rl-chat-field');
    await field.fill('What does this document say?');
    await field.press('Enter');
    await expect(j.page.locator('.rl-chat-bubble')).toHaveText('What does this document say?');
    await expect(j.page.locator('.rl-chat-live')).toContainText('Reading the document');
    await j.shot('chat-working');
    await expect(j.page.locator('.rl-chat-theirs')).toContainText('scripted answer');
    // Markdown is drawn, never shown as marks.
    await expect(j.page.locator('.rl-chat-md strong')).toHaveText('tracked changes');
    expect(await j.page.locator('.rl-chat-log').innerText()).not.toMatch(/\*\*|##|`/);
    await j.shot('chat-answered');

    // The picker: the agents, and each one's models.
    await j.page.locator('.rl-chat-who').click();
    await expect(j.page.locator('.rl-chat-menu')).toBeVisible();
    await expect(j.page.getByRole('menuitemradio', { name: 'Sonnet' })).toBeVisible();
    await j.shot('chat-picker-models');
    await j.page.getByRole('menuitemradio', { name: 'Sonnet' }).click();
    await expect(j.page.locator('.rl-chat-who-model')).toHaveText('· Sonnet');
    await j.page.locator('.rl-chat-who').click();
    await j.press('Escape');
    await expect(j.page.locator('.rl-chat-menu')).toBeHidden();

    // ⌃⌘C closes the sidebar while the chat shows, and opens it at the chat again.
    await j.press('Control+Meta+c');
    await expect.poll(async () => (await aside.boundingBox())?.width ?? -1).toBe(0);
    await j.press('Control+Meta+c');
    await expect(chat).toBeVisible();
    await expect(j.page.locator('.rl-chat-theirs')).toHaveCount(1);
  });
});
