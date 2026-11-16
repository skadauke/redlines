// The alert for an edit that can't be tracked (R6, #497): typing in front matter, or in Raw, with
// Track Changes on asks first, in a sheet, and the edit waits for the answer. Return is Cancel; Make
// Edit makes the edit without a mark. The sheet is the one interruption the app makes.

import { expect, test } from '../src/journey.ts';

const FRONT = '---\ntitle: Notes\n---\n';
const DOC = `${FRONT}\nFirst words, then more.\n`;

test.describe('the alert for an edit that can’t be tracked @views', () => {
  test('front matter asks first, Return cancels, and Make Edit makes it without a mark', async ({
    start,
  }) => {
    const j = await start({ doc: DOC, tracking: true, view: 'redlines' });
    await j.caretAfter('title: Notes');
    await j.type('X');
    const sheet = j.page.locator('.rl-sheet');
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText("This edit can't be tracked. Make it without tracking?");
    await expect(sheet).toContainText('Front matter is data that other tools read');
    // The edit waits: the file is as it was while the sheet is up.
    expect(await j.text()).toBe(DOC);
    await j.shot('sheet-front-matter');

    // Return is Cancel.
    await j.press('Enter');
    await expect(sheet).toBeHidden();
    expect(await j.text()).toBe(DOC);

    await j.type('X');
    await expect(sheet).toBeVisible();
    await j.page.waitForTimeout(200);
    await sheet.getByRole('button', { name: 'Make Edit' }).click();
    await expect(sheet).toBeHidden();
    expect(await j.text()).toBe(DOC.replace('Notes', 'NotesX'));
  });

  test('Raw asks once for a word, and the answer holds for the run', async ({ start }) => {
    const j = await start({ doc: DOC, tracking: true, view: 'raw' });
    await j.caretAfter('then more');
    await j.type('a');
    const sheet = j.page.locator('.rl-sheet');
    await expect(sheet).toContainText("Raw shows the file's own text");
    await j.shot('sheet-raw');
    await sheet.getByRole('button', { name: 'Make Edit' }).click();
    await expect(sheet).toBeHidden();
    await j.type('bc');
    await expect(sheet).toBeHidden();
    expect(await j.text()).toBe(DOC.replace('then more', 'then moreabc'));
  });
});
