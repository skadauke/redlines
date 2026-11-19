// An Ask is a turn in the document's chat (#1194): its answer shows in the bubble, with Open in
// Chat; the bubble goes by itself once the answer has had its time; the turn is in the chat,
// with the passage it was about.

import { expect, test } from '../src/journey.ts';

test.describe('Ask and the chat', () => {
  test('an Ask lands in the chat, Open in Chat shows it, and the bubble goes by itself', async ({
    start,
  }) => {
    const j = await start({
      doc: 'The importer ships in April.\n\nThe tests run in CI.\n',
      tracking: false,
      view: 'clean',
    });
    const bubble = j.page.locator('.rl-qa');

    await j.page.getByText('The importer ships in April.').dblclick();
    await j.press('Alt+Meta+a');
    await expect(bubble).toBeVisible();
    await j.page.locator('.rl-qa textarea').fill('When does it ship?');
    await j.press('Enter');
    await expect(bubble.locator('.rl-qa-answer')).toBeVisible();
    await expect(bubble.getByRole('button', { name: 'Open in Chat' })).toBeVisible();
    await j.shot('ask-bubble-with-chat');

    // The bubble leaves by itself, after a time that follows the answer's length.
    await j.page.mouse.move(700, 600);
    await expect(bubble).toBeHidden({ timeout: 30_000 });

    // The chat was not open: Open in Chat is the way to it, from a second Ask.
    await expect(j.page.locator('.rl-sidebar')).toBeHidden();
    await j.page.getByText('The tests run in CI.').dblclick();
    await j.press('Alt+Meta+a');
    await j.press('Enter');
    await expect(bubble.locator('.rl-qa-answer')).toBeVisible();
    await bubble.getByRole('button', { name: 'Open in Chat' }).click();
    await expect(bubble).toBeHidden();
    const chat = j.page.locator('.rl-chat');
    await expect(chat).toBeVisible();
    await expect(j.page.locator('.rl-chat-theirs')).toHaveCount(2);
    await expect(j.page.locator('.rl-chat-about-label').first()).toHaveText('Asked about');
    expect(await j.page.locator('.rl-chat-log').innerText()).not.toMatch(/\*\*|##|Sources:/);
    await j.shot('chat-with-asks');
  });
});
